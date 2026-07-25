// Bipartite view: coins AND transactions are both vertices, as in the
// diagram-E pictures. A coin vertex sits between the transaction that made
// it and the transaction that spent it. Ranks come from topological depth
// (time flows left to right); the vertical arrangement and the routing of
// rank-skipping edges come from the dot-style layered layout, so separate
// flows stay in separate bands instead of crossing behind each other.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Rect } from "./blockview";
import { layered, type LayeredNode, type LayeredEdge } from "./layered";

export interface BipLayout {
  /** coin vertex frames (world coords, pill-sized) */
  coins: Map<CoinId, Rect>;
  /** tx vertex frames (small squares) */
  txs: Map<TxId, Rect>;
  /**
   * routed waypoints for rank-skipping edges, keyed "in:<coin>" (coin ->
   * spending tx) and "out:<coin>" (tx -> coin); each waypoint is a world
   * point in an intermediate column's clear corridor
   */
  routes: Map<string, { x: number; y: number }[]>;
  bounds: Rect;
}

export const COIN_W = 122;
export const COIN_H = 34;
export const TX_W = 64;
export const TX_H = 48;
const X_GAP = 120;
const Y_GAP = 46;
/** caption space hanging under coin vertices, kept clear of neighbors */
const CAPTION_H = 14;

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

  const nodes: LayeredNode[] = [];
  const edges: LayeredEdge[] = [];
  for (const coin of chain.coins.values()) {
    if (coin.producer === null) nodes.push({ id: coin.id, rank: 0, h: COIN_H + CAPTION_H });
  }
  for (const tid of chain.order) {
    nodes.push({ id: tid, rank: txDepth.get(tid)!, h: TX_H + CAPTION_H });
    const tx = chain.txs.get(tid)!;
    for (const cid of tx.outputs) {
      nodes.push({ id: cid, rank: coinDepth.get(cid)!, h: COIN_H + CAPTION_H });
      edges.push({ from: tid, to: cid, key: `out:${cid}` });
    }
    for (const cid of tx.inputs) {
      edges.push({ from: cid, to: tid, key: `in:${cid}` });
    }
  }

  const laid = layered(nodes, edges, Y_GAP - CAPTION_H);

  const xAt = (rank: number, w: number): number => rank * COL_W + (COL_W - X_GAP - w) / 2;
  const colCenter = (rank: number): number => rank * COL_W + (COL_W - X_GAP) / 2;

  const coins = new Map<CoinId, Rect>();
  const txs = new Map<TxId, Rect>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const placeRect = (rect: Rect): Rect => {
    minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    return rect;
  };
  for (const coin of chain.coins.values()) {
    const d = coinDepth.get(coin.id)!;
    coins.set(coin.id, placeRect({ x: xAt(d, COIN_W), y: laid.y.get(coin.id)!, w: COIN_W, h: COIN_H }));
  }
  for (const tid of chain.order) {
    const d = txDepth.get(tid)!;
    txs.set(tid, placeRect({ x: xAt(d, TX_W), y: laid.y.get(tid)!, w: TX_W, h: TX_H }));
  }

  const routes = new Map<string, { x: number; y: number }[]>();
  for (const [key, ys] of laid.routes) {
    const endRank = key.startsWith("in:")
      ? txDepth.get(chain.coins.get(key.slice(3))!.dest!)!
      : coinDepth.get(key.slice(4))!;
    const startRank = endRank - ys.length - 1;
    routes.set(key, ys.map((y, i) => ({ x: colCenter(startRank + 1 + i), y })));
  }

  return { coins, txs, routes, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
