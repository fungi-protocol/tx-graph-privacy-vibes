// Bipartite view: coins AND transactions are both vertices, as in the
// diagram-E pictures. A coin vertex sits between the transaction that made
// it and the transaction that spent it. Layout is stratified by time
// (topological depth) — the first instance of the pluggable stratification
// the views are built around.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Rect } from "./blockview";

export interface BipLayout {
  /** coin vertex frames (world coords, pill-sized) */
  coins: Map<CoinId, Rect>;
  /** tx vertex frames (small squares) */
  txs: Map<TxId, Rect>;
  bounds: Rect;
}

export const COIN_W = 122;
export const COIN_H = 34;
export const TX_W = 64;
export const TX_H = 48;
const X_GAP = 120;
const Y_GAP = 46;

/** Column pitch: alternating coin and tx columns share one rhythm. */
const COL_W = Math.max(COIN_W, TX_W) + X_GAP;

export function layoutBipartite(chain: Chain): BipLayout {
  // depth: roots 0; tx = 1 + max(input coin depths); coin = producer + 1
  const coinDepth = new Map<CoinId, number>();
  const txDepth = new Map<TxId, number>();
  for (const coin of chain.coins.values()) {
    if (coin.producer === null) coinDepth.set(coin.id, 0);
  }
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const d = 1 + Math.max(...tx.inputs.map((c) => coinDepth.get(c) ?? 0));
    txDepth.set(tid, d);
    for (const cid of tx.outputs) coinDepth.set(cid, d + 1);
  }

  // stack each column top-down in deterministic order (chain order)
  const columns = new Map<number, { kind: "coin" | "tx"; id: string }[]>();
  const push = (d: number, kind: "coin" | "tx", id: string): void => {
    const col = columns.get(d) ?? [];
    col.push({ kind, id });
    columns.set(d, col);
  };
  for (const coin of chain.coins.values()) {
    if (coin.producer === null) push(0, "coin", coin.id);
  }
  for (const tid of chain.order) {
    push(txDepth.get(tid)!, "tx", tid);
    for (const cid of chain.txs.get(tid)!.outputs) push(coinDepth.get(cid)!, "coin", cid);
  }

  const coins = new Map<CoinId, Rect>();
  const txs = new Map<TxId, Rect>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [d, items] of columns) {
    const colH = items.reduce((s, it) => s + (it.kind === "coin" ? COIN_H : TX_H) + Y_GAP, -Y_GAP);
    let y = -colH / 2;   // centre each column vertically
    for (const it of items) {
      const w = it.kind === "coin" ? COIN_W : TX_W;
      const h = it.kind === "coin" ? COIN_H : TX_H;
      const rect: Rect = { x: d * COL_W + (COL_W - X_GAP - w) / 2, y, w, h };
      if (it.kind === "coin") coins.set(it.id, rect);
      else txs.set(it.id, rect);
      minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
      y += h + Y_GAP;
    }
  }
  return { coins, txs, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
