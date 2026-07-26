// Force-directed bipartite layout: the d3-style alternative to the layered
// left-to-right arrangement. No ranks, no columns — coins and transactions
// are bodies repelling each other, edges are springs, and a weak gravity
// keeps disconnected components on one canvas. Time is no longer an axis,
// which is exactly the appeal on large dense graphs: communities and hubs
// become visible as spatial clumps instead of stretching into a timeline.
//
// Deterministic by construction: initial positions are hashed from node
// ids (no Math.random), the iteration count is fixed by graph size, and
// the arithmetic has no data-dependent ordering — the same chain always
// lays out the same way, which the determinism check and shareable
// fragments both rely on.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Rect } from "./blockview";
import { hashSeed } from "../core/prng";
import { type BipLayout, COIN_W, COIN_H, TX_W, TX_H } from "./bipartite";

/** ideal spring length — a little more than a coin pill's diagonal */
const SPRING = 150;
/** weak pull toward the centroid, keeps stray components from drifting off */
const GRAVITY = 0.03;

export function layoutForce(chain: Chain): BipLayout {
  const ids: string[] = [];
  const isTx: boolean[] = [];
  const index = new Map<string, number>();
  const add = (id: string, tx: boolean): void => {
    index.set(id, ids.length);
    ids.push(id);
    isTx.push(tx);
  };
  for (const coin of chain.coins.values()) add(coin.id, false);
  for (const tid of chain.order) add(tid, true);

  const edges: [number, number][] = [];
  for (const tid of chain.order) {
    const t = index.get(tid)!;
    const tx = chain.txs.get(tid)!;
    for (const cid of tx.inputs) edges.push([index.get(cid)!, t]);
    for (const cid of tx.outputs) edges.push([t, index.get(cid)!]);
  }

  const n = ids.length;
  const x = new Float64Array(n), y = new Float64Array(n);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  // seed positions in a disc sized to the graph: hashed, not random, so a
  // node keeps its starting corner from one day's layout to the next and
  // the day-transition blend has coherent motion to interpolate
  const R = SPRING * Math.sqrt(n) * 0.5;
  for (let i = 0; i < n; i++) {
    const [h1, h2] = hashSeed(ids[i]!);
    const a = (h1 / 4294967296) * Math.PI * 2;
    const r = R * Math.sqrt(h2 / 4294967296);
    x[i] = Math.cos(a) * r;
    y[i] = Math.sin(a) * r;
  }

  // Fruchterman–Reingold with linear cooling; O(n²) per pass is fine at
  // this tool's scale (hundreds of nodes), so no quadtree
  const iters = n <= 250 ? 300 : Math.max(80, Math.floor(75000 / n));
  const k2 = SPRING * SPRING;
  for (let pass = 0; pass < iters; pass++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = x[i]! - x[j]!, vy = y[i]! - y[j]!;
        let d2 = vx * vx + vy * vy;
        if (d2 < 1e-4) { vx = ((i * 37 + j) % 13) - 6; vy = ((i * 53 + j) % 11) - 5; d2 = vx * vx + vy * vy; }
        const f = k2 / d2;
        dx[i]! += vx * f; dy[i]! += vy * f;
        dx[j]! -= vx * f; dy[j]! -= vy * f;
      }
    }
    for (const [a, b] of edges) {
      const vx = x[b]! - x[a]!, vy = y[b]! - y[a]!;
      const d = Math.sqrt(vx * vx + vy * vy) || 1;
      const f = d / SPRING;
      dx[a]! += vx * f; dy[a]! += vy * f;
      dx[b]! -= vx * f; dy[b]! -= vy * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i]! -= x[i]! * GRAVITY;
      dy[i]! -= y[i]! * GRAVITY;
    }
    const temp = SPRING * 1.5 * (1 - pass / iters) + 2;
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
      const step = Math.min(d, temp);
      x[i]! += (dx[i]! / d) * step;
      y[i]! += (dy[i]! / d) * step;
    }
  }

  const coins = new Map<CoinId, Rect>();
  const txs = new Map<TxId, Rect>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const w = isTx[i] ? TX_W : COIN_W, h = isTx[i] ? TX_H : COIN_H;
    const rect: Rect = { x: x[i]! - w / 2, y: y[i]! - h / 2, w, h };
    minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    if (isTx[i]) txs.set(ids[i]!, rect);
    else coins.set(ids[i]!, rect);
  }

  // straight edges: with no columns there are no corridors to route through
  return {
    coins, txs, routes: new Map(),
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
