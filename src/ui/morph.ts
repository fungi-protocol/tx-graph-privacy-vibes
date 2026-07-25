// Draws the transaction graph anywhere between the block-explorer view
// (t = 0) and the bipartite view (t = 1). Every entity keeps its identity
// across the morph: a coin's producing box glides to its coin vertex, the
// duplicate input slots fly into that same vertex while fading, tx cards
// shrink to square nodes, and the output edges fade in.
import { type Chain, type Coin, type Tx } from "../model/chain";
import { fmtSats } from "../core/sats";
import { OWNER_TEXT } from "../scenario/intro";
import { type Layout, type Rect, type Hit, coinColor, castName } from "./blockview";
import { type BipLayout } from "./bipartite";

/**
 * What knowledge the drawing assumes: the omniscient paint shows true
 * owners and narrative labels; an observer paint may only use what is
 * public (amounts, fees, structure) plus its own inferences.
 */
export interface Paint {
  coinFill(coin: Coin): string;
  coinText(coin: Coin): string;
  coinCaption(coin: Coin): string;
  txMemo(tx: Tx): string | null;
  /** when every input belongs to one cluster/owner under this lens, the
   *  transaction itself is attributable — tint it that color */
  txAttribution?(tx: Tx, chain: Chain): string | null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

function rounded(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

function bezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const dx = Math.max(40, (x1 - x0) / 2);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
}

type Pt = { x: number; y: number };

/**
 * Sample a spline through the given points (piecewise cubic, horizontal
 * tangents at every point — the same flavor as the plain bezier) at n
 * points per segment. Used to blend two differently-routed versions of
 * the same edge pointwise during the morph.
 */
function sampleSpline(pts: Pt[], n: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s]!, b = pts[s + 1]!;
    const dx = Math.max(40, (b.x - a.x) / 2);
    for (let i = 1; i <= n; i++) {
      const u = i / n, v = 1 - u;
      out.push({
        x: v * v * v * a.x + 3 * v * v * u * (a.x + dx) + 3 * v * u * u * (b.x - dx) + u * u * u * b.x,
        y: v * v * v * a.y + 3 * v * v * u * a.y + 3 * v * u * u * b.y + u * u * u * b.y,
      });
    }
  }
  return out;
}

/**
 * Draw an edge that may be routed through layout waypoints in either view:
 * both versions are sampled to the same resolution and blended pointwise,
 * so the routing morphs along with everything else.
 */
function routedEdge(
  ctx: CanvasRenderingContext2D,
  from: Pt,
  to: Pt,
  wpsA: Pt[] | undefined,
  wpsB: Pt[] | undefined,
  t: number,
): void {
  const a = wpsA ?? [], b = wpsB ?? [];
  if (!a.length && !b.length) {
    bezier(ctx, from.x, from.y, to.x, to.y);
    return;
  }
  const n = Math.min(10, Math.max(6, 24 / (Math.max(a.length, b.length) + 1)));
  const pa = t >= 1 ? null : sampleSpline([from, ...a, to], n);
  const pb = t <= 0 ? null : sampleSpline([from, ...b, to], n);
  let pts: Pt[];
  if (!pa) pts = pb!;
  else if (!pb) pts = pa;
  else {
    // resample to a common length by index interpolation
    const m = Math.max(pa.length, pb.length);
    const at = (ps: Pt[], f: number): Pt => {
      const k = f * (ps.length - 1), i = Math.floor(k), u = k - i;
      const p = ps[i]!, q = ps[Math.min(i + 1, ps.length - 1)]!;
      return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
    };
    pts = Array.from({ length: m }, (_, i) => {
      const f = i / (m - 1);
      const p = at(pa, f), q = at(pb, f);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    });
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
}

export const OMNISCIENT: Paint = {
  coinFill: coinColor,
  coinText: (c) => (c.owner === null ? "#111" : OWNER_TEXT[c.owner] ?? "#111"),
  coinCaption: (c) => `${castName(c.owner)}${c.label ? " · " + c.label : ""}`,
  txMemo: (t) => t.memo ?? null,
  txAttribution: (t, ch) => commonInputFill(ch, t, coinColor),
};

/** Attribution helper: the common fill of all input coins, or null. */
export function commonInputFill(chain: Chain, tx: Tx, fill: (c: Coin) => string): string | null {
  let color: string | null = null;
  for (const cid of tx.inputs) {
    const f = fill(chain.coins.get(cid)!);
    if (color === null) color = f;
    else if (color !== f) return null;
  }
  return color;
}

/** A coin's single morphing frame: producing box -> bipartite vertex. */
export function coinRectAt(block: Layout, bip: BipLayout, id: string, t: number): Rect | null {
  const from = block.coinBoxes.find((cb) => cb.coin === id && cb.role !== "in")?.rect;
  const to = bip.coins.get(id);
  if (!from || !to) return null;
  return lerpRect(from, to, t);
}

export function txRectAt(block: Layout, bip: BipLayout, id: string, t: number): Rect | null {
  const from = block.txs.get(id);
  const to = bip.txs.get(id);
  if (!from || !to) return null;
  return lerpRect(from, to, t);
}

export interface MorphDrawOptions {
  hover?: Hit | null;
  /**
   * joint-trace highlight: the intersection (full) at full strength, the
   * union (partial) partly lit, everything else gently dimmed (not too
   * dim) — or hidden entirely when hideDim is set
   */
  highlight?: {
    full: { coins: Set<string>; txs: Set<string> };
    partial: { coins: Set<string>; txs: Set<string> };
  } | null;
  hideDim?: boolean;
  /** knowledge lens; defaults to the omniscient paint */
  paint?: Paint;
  /** the clicked coins / transaction: outlined so the seeds of the trace
   *  stand apart from everything the trace lights up */
  selected?: { coins: Set<string>; txs: Set<string> } | null;
}

const DIM = 0.45;
const PARTIAL = 0.8;
/** dimmed entities also lose their color — gray reads as "not involved"
 *  far better than darkness alone */
const MUTED_FILL = "#3a3e46";
const MUTED_TEXT = "#71767f";

export function drawMorph(
  ctx: CanvasRenderingContext2D,
  chain: Chain,
  block: Layout,
  bip: BipLayout,
  t: number,
  opts: MorphDrawOptions = {},
): void {
  const hover = opts.hover ?? null;
  const hoverCoin = hover?.kind === "coin" ? hover.id : null;
  const hl = opts.highlight ?? null;
  const dim = opts.hideDim ? 0 : DIM;
  const paint = opts.paint ?? OMNISCIENT;
  const coinAlpha = (id: string): number =>
    !hl ? 1 : hl.full.coins.has(id) ? 1 : hl.partial.coins.has(id) ? PARTIAL : dim;
  const txAlpha = (id: string): number =>
    !hl ? 1 : hl.full.txs.has(id) ? 1 : hl.partial.txs.has(id) ? PARTIAL : dim;
  // outside the union: gray, not merely faint
  const coinMuted = (id: string): boolean => hl !== null && !hl.partial.coins.has(id);
  const txMuted = (id: string): boolean => hl !== null && !hl.partial.txs.has(id);
  const sel = opts.selected ?? null;
  // when the intersection is a proper subset of the union, alpha alone
  // reads poorly — ring the shared origins in gold so they stand apart
  const ringing = hl !== null &&
    (hl.partial.coins.size > hl.full.coins.size || hl.partial.txs.size > hl.full.txs.size);
  const ring = (r: Rect, radius: number): void => {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, radius + 4);
    ctx.strokeStyle = "#edc948";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  };
  const coinAt = (id: string): Rect => coinRectAt(block, bip, id, t)!;
  const txAt = (id: string): Rect => txRectAt(block, bip, id, t)!;

  // --- input edges: coin -> spending tx ---
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const txr = txAt(tid);
    for (const cid of tx.inputs) {
      const coin = chain.coins.get(cid)!;
      const from = coinAt(cid);
      // in the block view the edge lands on the input slot; that slot flies
      // into the coin vertex as t -> 1 while the edge target becomes the node
      const slot = block.coinBoxes.find((cb) => cb.coin === cid && cb.role === "in")?.rect;
      const to = lerpRect(slot ?? txr, txr, t);
      const emphasized = hoverCoin === cid;
      ctx.globalAlpha = coinAlpha(cid);
      routedEdge(
        ctx,
        { x: from.x + from.w, y: from.y + from.h / 2 },
        { x: to.x, y: to.y + to.h / 2 },
        block.routes.get(`in:${cid}`),
        bip.routes.get(`in:${cid}`),
        t,
      );
      ctx.strokeStyle = (coinMuted(cid) ? MUTED_FILL : paint.coinFill(coin)) + (emphasized ? "" : "b0");
      ctx.lineWidth = emphasized ? 3.5 : 1.8;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // --- output edges: tx -> coin (only exist in the bipartite reading) ---
  if (t > 0.01) {
    ctx.save();
    ctx.globalAlpha = t;
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const txr = txAt(tid);
      for (const cid of tx.outputs) {
        const coin = chain.coins.get(cid)!;
        const to = coinAt(cid);
        const emphasized = hoverCoin === cid;
        ctx.globalAlpha = t * coinAlpha(cid);
        routedEdge(
          ctx,
          { x: txr.x + txr.w, y: txr.y + txr.h / 2 },
          { x: to.x, y: to.y + to.h / 2 },
          undefined,
          bip.routes.get(`out:${cid}`),
          1,
        );
        ctx.strokeStyle = (coinMuted(cid) ? MUTED_FILL : paint.coinFill(coin)) + (emphasized ? "" : "b0");
        ctx.lineWidth = emphasized ? 3.5 : 1.8;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // --- tx vertices (cards shrinking to squares) ---
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const frame = txAt(tid);
    if (ringing && hl!.full.txs.has(tid)) ring(frame, lerp(8, 10, t));
    ctx.globalAlpha = txAlpha(tid);
    rounded(ctx, frame, lerp(8, 10, t));
    ctx.fillStyle = "#26292f";
    ctx.fill();
    const attributed = txMuted(tid) ? null : paint.txAttribution?.(tx, chain) ?? null;
    if (attributed) {
      // all inputs from one cluster: the record itself wears the color
      rounded(ctx, frame, lerp(8, 10, t));
      ctx.fillStyle = attributed + "38";
      ctx.fill();
    }
    const hovered = hover?.kind === "tx" && hover.id === tid;
    const picked = sel?.txs.has(tid) ?? false;
    ctx.strokeStyle = hovered ? "#d8dade" : picked ? "#ffffff" :
      attributed ? attributed : txMuted(tid) ? "#3f434b" : "#4a4e57";
    ctx.lineWidth = hovered ? 2 : picked ? 2.5 : attributed ? 1.6 : 1.2;
    ctx.stroke();
    ctx.textBaseline = "middle";
    if (t < 0.5) {
      // card header: memo and fee
      ctx.save();
      ctx.globalAlpha = (1 - 2 * t) * txAlpha(tid);
      ctx.fillStyle = "#9aa0ab";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`${tid} — ${paint.txMemo(tx) ?? "transaction"}`, frame.x + 10, frame.y + 17);
      ctx.fillStyle = "#6d727d";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`fee ${fmtSats(tx.fee)} sats @ ${tx.feerate} sat/vb`, frame.x + 10, frame.y + 33);
      ctx.restore();
    } else {
      // square node: bare id; memo and fee move to the caption below so
      // no information is lost relative to the card
      ctx.save();
      ctx.globalAlpha = (2 * t - 1) * txAlpha(tid);
      ctx.fillStyle = "#9aa0ab";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(tid, frame.x + frame.w / 2, frame.y + frame.h / 2);
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = "#8b919c";
      const memo = paint.txMemo(tx);
      if (memo) ctx.fillText(memo, frame.x + frame.w / 2, frame.y + frame.h + 12);
      ctx.fillStyle = "#6d727d";
      ctx.fillText(`fee ${fmtSats(tx.fee)} @ ${tx.feerate} sat/vb`, frame.x + frame.w / 2, frame.y + frame.h + (memo ? 24 : 12));
      ctx.restore();
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;

  // --- fading duplicate input slots (block view only) ---
  if (t < 0.99) {
    ctx.save();
    for (const cb of block.coinBoxes) {
      if (cb.role !== "in") continue;
      const coin = chain.coins.get(cb.coin)!;
      const rect = lerpRect(cb.rect, coinAt(cb.coin), t);
      ctx.globalAlpha = (1 - t) * coinAlpha(cb.coin);
      drawCoinBox(ctx, coin, rect, hoverCoin === cb.coin, false, t, paint);
    }
    ctx.restore();
  }

  // --- coin vertices ---
  for (const coin of chain.coins.values()) {
    const rect = coinAt(coin.id);
    const unspent = coin.dest === null;
    if (ringing && hl!.full.coins.has(coin.id)) ring(rect, lerp(10, 17, t));
    ctx.globalAlpha = coinAlpha(coin.id);
    drawCoinBox(ctx, coin, rect, hoverCoin === coin.id, unspent, t, paint);
    // caption: whose coin / what for (or whatever the lens can say)
    const caption = paint.coinCaption(coin);
    if (caption) {
      ctx.fillStyle = "#8b919c";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(caption, rect.x + rect.w / 2, rect.y + rect.h + 12);
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;
}

function drawCoinBox(
  ctx: CanvasRenderingContext2D,
  coin: Coin,
  rect: Rect,
  focused: boolean,
  unspent: boolean,
  t: number,
  paint: Paint,
): void {
  rounded(ctx, rect, lerp(10, 17, t));
  ctx.fillStyle = paint.coinFill(coin);
  ctx.fill();
  ctx.strokeStyle = focused ? "#ffffff" : unspent ? "#111111" : "#333333";
  ctx.lineWidth = focused ? 2.5 : unspent ? 3 : 1;
  ctx.stroke();
  ctx.fillStyle = paint.coinText(coin);
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(fmtSats(coin.value), rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.textAlign = "left";
}

/** Hit-test whichever view (or in-between) is showing. */
export function hitTestMorph(
  chain: Chain,
  block: Layout,
  bip: BipLayout,
  t: number,
  wx: number,
  wy: number,
): Hit | null {
  const inRect = (r: Rect): boolean => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
  for (const coin of chain.coins.values()) {
    const r = coinRectAt(block, bip, coin.id, t);
    if (r && inRect(r)) return { kind: "coin", id: coin.id };
  }
  if (t < 0.5) {
    for (const cb of block.coinBoxes) {
      if (cb.role === "in" && inRect(cb.rect)) return { kind: "coin", id: cb.coin };
    }
  }
  for (const tid of chain.order) {
    const r = txRectAt(block, bip, tid, t);
    if (r && inRect(r)) return { kind: "tx", id: tid };
  }
  return null;
}
