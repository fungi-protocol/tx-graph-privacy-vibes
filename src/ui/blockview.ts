// Block-explorer view: each transaction is a card with nested boxes — inputs
// down the left, outputs down the right — and a coin is an EDGE connecting
// the output box where it was created to the input box where it was spent.
// This is the foundational rendering; other views generalize from it.
import { type Chain, type Coin, type CoinId, type TxId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { OWNER_TEXT, EXTERNAL_COLOR, CAST } from "../scenario/intro";
import { ownerColor } from "../scenario/cast";
import { layered, type LayeredNode, type LayeredEdge } from "./layered";

export interface Rect { x: number; y: number; w: number; h: number }

export interface Hit { kind: "coin" | "tx" | "cluster"; id: string }

export interface Layout {
  /** tx card frames (world coords) */
  txs: Map<TxId, Rect>;
  /** free-standing boxes for root coins */
  roots: Map<CoinId, Rect>;
  /** every rendered coin box: root box, output slot, input slot */
  coinBoxes: { coin: CoinId; rect: Rect; role: "root" | "in" | "out" }[];
  /** coin edges: producing box -> consuming box */
  edges: { coin: CoinId; from: Rect; to: Rect }[];
  /** routed waypoints for column-skipping edges, keyed "in:<coin>" */
  routes: Map<string, { x: number; y: number }[]>;
  /** bounding box of everything */
  bounds: Rect;
}

const CARD_W = 300;
const SLOT_W = 122;
const SLOT_H = 34;
const SLOT_GAP = 26;   // leaves room for the caption under each box
const HEADER_H = 30;
const PAD = 10;
const COL_GAP = 170;

export function layoutChain(chain: Chain): Layout {
  const txs = new Map<TxId, Rect>();
  const roots = new Map<CoinId, Rect>();
  const coinBoxes: Layout["coinBoxes"] = [];
  const edges: Layout["edges"] = [];

  // ranks come from ancestry, not confirmation order: transactions that
  // don't depend on each other share a column, and the layered layout
  // keeps each flow in its own horizontal band (roots included, so a
  // root coin sits beside the flow that spends it)
  const rootIds = [...chain.coins.values()].filter((c) => c.producer === null).map((c) => c.id);
  const sourceOf = new Map<CoinId, string>(); // root coin id or producer tx id
  for (const cid of rootIds) sourceOf.set(cid, cid);
  const rankOf = new Map<string, number>();
  for (const cid of rootIds) rankOf.set(cid, 0);
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const d = 1 + Math.max(0, ...tx.inputs.map((c) => rankOf.get(sourceOf.get(c) ?? "") ?? 0));
    rankOf.set(tid, d);
    for (const cid of tx.outputs) sourceOf.set(cid, tid);
  }

  const cardH = (tid: TxId): number => {
    const tx = chain.txs.get(tid)!;
    const rows = Math.max(tx.inputs.length, tx.outputs.length);
    return HEADER_H + PAD + rows * (SLOT_H + SLOT_GAP);
  };
  const nodes: LayeredNode[] = [
    ...rootIds.map((cid) => ({ id: cid, rank: 0, h: SLOT_H + SLOT_GAP })),
    ...chain.order.map((tid) => ({ id: tid, rank: rankOf.get(tid)!, h: cardH(tid) })),
  ];
  // edges anchor at their actual slot, not the card centre: the port is the
  // slot's y-centre as a fraction of the node height, so an edge leaving a
  // lower output slot orders (and aligns) below one leaving a higher slot
  const slotPort = (row: number, h: number): number =>
    (HEADER_H + PAD + row * (SLOT_H + SLOT_GAP) + SLOT_H / 2) / h;
  const ledges: LayeredEdge[] = [];
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    tx.inputs.forEach((cid, r) => {
      const src = sourceOf.get(cid);
      if (!src) return;
      const coin = chain.coins.get(cid)!;
      const fromPort = coin.producer === null
        ? (SLOT_H / 2) / (SLOT_H + SLOT_GAP)
        : slotPort(chain.txs.get(coin.producer)!.outputs.indexOf(cid), cardH(coin.producer));
      ledges.push({ from: src, to: tid, key: `in:${cid}`, fromPort, toPort: slotPort(r, cardH(tid)) });
    });
  }
  const laid = layered(nodes, ledges, 44);

  // column x: roots occupy a slim column 0, every later rank a card column
  const colX = (rank: number): number =>
    rank === 0 ? 0 : SLOT_W + COL_GAP + (rank - 1) * (CARD_W + COL_GAP);

  for (const cid of rootIds) {
    const rect: Rect = { x: 0, y: laid.y.get(cid)!, w: SLOT_W, h: SLOT_H };
    roots.set(cid, rect);
    coinBoxes.push({ coin: cid, rect, role: "root" });
  }

  const outBox = new Map<CoinId, Rect>();
  for (const cid of rootIds) outBox.set(cid, roots.get(cid)!);

  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const x = colX(rankOf.get(tid)!);
    const y = laid.y.get(tid)!;
    const frame: Rect = { x, y, w: CARD_W, h: cardH(tid) };
    txs.set(tid, frame);

    tx.inputs.forEach((cid, r) => {
      const rect: Rect = { x: x + PAD, y: y + HEADER_H + PAD + r * (SLOT_H + SLOT_GAP), w: SLOT_W, h: SLOT_H };
      coinBoxes.push({ coin: cid, rect, role: "in" });
      const from = outBox.get(cid);
      if (from) edges.push({ coin: cid, from, to: rect });
    });
    tx.outputs.forEach((cid, r) => {
      const rect: Rect = { x: x + CARD_W - PAD - SLOT_W, y: y + HEADER_H + PAD + r * (SLOT_H + SLOT_GAP), w: SLOT_W, h: SLOT_H };
      coinBoxes.push({ coin: cid, rect, role: "out" });
      outBox.set(cid, rect);
    });
  }

  // waypoints for edges that skip card columns, routed through the gaps
  const routes = new Map<string, { x: number; y: number }[]>();
  for (const [key, ys] of laid.routes) {
    const cid = key.slice(3);
    const endRank = rankOf.get(chain.coins.get(cid)!.dest!)!;
    const startRank = endRank - ys.length - 1;
    routes.set(key, ys.map((wy, i) => {
      const r = startRank + 1 + i;
      return { x: colX(r) + CARD_W / 2, y: wy };
    }));
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [...txs.values(), ...roots.values()]) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { txs, roots, coinBoxes, edges, routes, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

function rounded(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
}

// the live cast can outgrow the fixed ten; main.ts keeps this current
let castNames: readonly string[] = CAST;
export function setCastNames(names: readonly string[]): void {
  castNames = names;
}

export function castName(owner: number | null): string {
  return owner === null ? "external" : castNames[owner] ?? `resident #${owner + 1}`;
}

export interface DrawOptions {
  hover?: Hit | null;
}

/** Draw in world coordinates (caller sets the camera transform). */
export function drawChain(ctx: CanvasRenderingContext2D, chain: Chain, layout: Layout, opts: DrawOptions = {}): void {
  const hover = opts.hover ?? null;
  const hoverCoin = hover?.kind === "coin" ? hover.id : null;

  // coin edges beneath everything
  for (const e of layout.edges) {
    const coin = chain.coins.get(e.coin)!;
    const x0 = e.from.x + e.from.w, y0 = e.from.y + e.from.h / 2;
    const x1 = e.to.x, y1 = e.to.y + e.to.h / 2;
    const dx = Math.max(40, (x1 - x0) / 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x0 + dx, y0, x1 - dx, y1, x1, y1);
    const emphasized = hoverCoin === e.coin;
    ctx.strokeStyle = coinColor(coin) + (emphasized ? "" : "b0");
    ctx.lineWidth = emphasized ? 3.5 : 1.8;
    ctx.stroke();
  }

  // tx cards
  for (const [tid, frame] of layout.txs) {
    const tx = chain.txs.get(tid)!;
    rounded(ctx, frame, 8);
    ctx.fillStyle = "#26292f";
    ctx.fill();
    ctx.strokeStyle = hover?.kind === "tx" && hover.id === tid ? "#d8dade" : "#4a4e57";
    ctx.lineWidth = hover?.kind === "tx" && hover.id === tid ? 2 : 1.2;
    ctx.stroke();
    ctx.fillStyle = "#9aa0ab";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tid} — ${tx.memo ?? "transaction"}`, frame.x + PAD, frame.y + HEADER_H / 2 + 2);
    ctx.fillStyle = "#6d727d";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(`fee ${fmtSats(tx.fee)} sats @ ${tx.feerate} sat/vb`, frame.x + PAD, frame.y + HEADER_H + PAD / 2 - 2);
  }

  // coin boxes
  for (const cb of layout.coinBoxes) {
    const coin = chain.coins.get(cb.coin)!;
    const focused = hoverCoin === cb.coin;
    rounded(ctx, cb.rect, 10);
    ctx.fillStyle = coinColor(coin);
    ctx.fill();
    const unspent = coin.dest === null && cb.role !== "in";
    ctx.strokeStyle = focused ? "#ffffff" : unspent ? "#111111" : "#333333";
    ctx.lineWidth = focused ? 2.5 : unspent ? 3 : 1;
    ctx.stroke();
    ctx.fillStyle = coin.owner === null ? "#111" : OWNER_TEXT[coin.owner] ?? "#111";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const cx = cb.rect.x + cb.rect.w / 2;
    ctx.textAlign = "center";
    ctx.fillText(fmtSats(coin.value), cx, cb.rect.y + cb.rect.h / 2);
    ctx.textAlign = "left";
    // small caption under root and output boxes: whose coin / what for
    if (cb.role !== "in") {
      ctx.fillStyle = "#8b919c";
      ctx.font = "10px system-ui, sans-serif";
      const caption = `${castName(coin.owner)}${coin.label ? " · " + coin.label : ""}`;
      ctx.textAlign = "center";
      ctx.fillText(caption, cx, cb.rect.y + cb.rect.h + 12);
      ctx.textAlign = "left";
    }
  }
}

export function coinColor(coin: Coin): string {
  return coin.owner === null ? EXTERNAL_COLOR : ownerColor(coin.owner);
}

export function hitTest(layout: Layout, wx: number, wy: number): Hit | null {
  const inRect = (r: Rect): boolean => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
  for (const cb of layout.coinBoxes) if (inRect(cb.rect)) return { kind: "coin", id: cb.coin };
  for (const [tid, frame] of layout.txs) if (inRect(frame)) return { kind: "tx", id: tid };
  return null;
}

/** Rect of a coin's primary (producing) box, for tutorial camera focus. */
export function coinAnchor(layout: Layout, id: CoinId): Rect | null {
  const box = layout.coinBoxes.find((cb) => cb.coin === id && cb.role !== "in") ??
    layout.coinBoxes.find((cb) => cb.coin === id);
  return box?.rect ?? null;
}
