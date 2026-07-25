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

export const OMNISCIENT: Paint = {
  coinFill: coinColor,
  coinText: (c) => (c.owner === null ? "#111" : OWNER_TEXT[c.owner] ?? "#111"),
  coinCaption: (c) => `${castName(c.owner)}${c.label ? " · " + c.label : ""}`,
  txMemo: (t) => t.memo ?? null,
};

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
}

const DIM = 0.3;
const PARTIAL = 0.55;

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
      bezier(ctx, from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
      ctx.strokeStyle = paint.coinFill(coin) + (emphasized ? "" : "b0");
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
        bezier(ctx, txr.x + txr.w, txr.y + txr.h / 2, to.x, to.y + to.h / 2);
        ctx.strokeStyle = paint.coinFill(coin) + (emphasized ? "" : "b0");
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
    ctx.globalAlpha = txAlpha(tid);
    rounded(ctx, frame, lerp(8, 10, t));
    ctx.fillStyle = "#26292f";
    ctx.fill();
    const hovered = hover?.kind === "tx" && hover.id === tid;
    ctx.strokeStyle = hovered ? "#d8dade" : "#4a4e57";
    ctx.lineWidth = hovered ? 2 : 1.2;
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
