// Block-explorer view: each transaction is a card with nested boxes — inputs
// down the left, outputs down the right — and a coin is an EDGE connecting
// the output box where it was created to the input box where it was spent.
// This is the foundational rendering; other views generalize from it.
import { type Chain, type Coin, type CoinId, type TxId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { OWNER_TEXT, EXTERNAL_COLOR, CAST } from "../scenario/intro";
import { ownerColor } from "../scenario/cast";

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

  // one column per transaction, in confirmation order; roots sit in a
  // column of their own to the left
  const rootIds = [...chain.coins.values()].filter((c) => c.producer === null).map((c) => c.id);
  let rootY = 0;
  for (const cid of rootIds) {
    const rect: Rect = { x: 0, y: rootY, w: SLOT_W, h: SLOT_H };
    roots.set(cid, rect);
    coinBoxes.push({ coin: cid, rect, role: "root" });
    rootY += SLOT_H + 3 * SLOT_GAP;
  }

  const outBox = new Map<CoinId, Rect>();
  for (const cid of rootIds) outBox.set(cid, roots.get(cid)!);

  chain.order.forEach((tid, i) => {
    const tx = chain.txs.get(tid)!;
    const rows = Math.max(tx.inputs.length, tx.outputs.length);
    const h = HEADER_H + PAD + rows * (SLOT_H + SLOT_GAP);
    const x = SLOT_W + COL_GAP + i * (CARD_W + COL_GAP);
    const y = i * 30;
    const frame: Rect = { x, y, w: CARD_W, h };
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
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [...txs.values(), ...roots.values()]) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { txs, roots, coinBoxes, edges, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
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
