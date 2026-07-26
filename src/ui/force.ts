// Force-directed bipartite layout: the d3-style alternative to the layered
// left-to-right arrangement. No ranks, no columns — coins and transactions
// are bodies repelling each other, edges are springs, and a weak gravity
// keeps disconnected components on one canvas. Time is no longer an axis,
// which is exactly the appeal on large dense graphs: communities and hubs
// become visible as spatial clumps instead of stretching into a timeline —
// the flow of funds is carried by arrowheads on the edges instead.
//
// Deterministic by construction: initial positions are hashed from node
// ids (no Math.random), the iteration count is fixed by graph size, and
// the arithmetic has no data-dependent ordering — the same chain always
// lays out the same way, which the determinism check and shareable
// fragments both rely on.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { type Rect } from "./blockview";
import { hashSeed } from "../core/prng";
import { type BipLayout, COIN_W, COIN_H, TX_W, TX_H } from "./bipartite";

/** ideal spring length — a little more than a coin pill's diagonal */
const SPRING = 150;
/** repulsion constant: deliberately stronger than the classic k² so the
 *  drawing spreads and edges get room to run straight */
const REPULSE = 2.4 * SPRING * SPRING;
/** weak pull toward the centroid, keeps stray components from drifting off */
const GRAVITY = 0.03;
/** clear margin kept between any two node frames, and between a node's
 *  frame and a passing edge */
const CLEARANCE = 10;

/** a coin pill's width, sized to its value label (the layered view's
 *  fixed COIN_W clips long amounts; here nothing constrains the width) */
export function coinPillW(value: number): number {
  return Math.max(64, 22 + 7.4 * fmtSats(value).length);
}

/**
 * `shown` restricts the simulation to a sub-graph (the hide filter's
 * survivors): only those nodes repel, spring and count toward the
 * bounds. Everything else still gets a rect — hidden nodes are drawn
 * at alpha 0, so the renderer must find them — parked at its hashed
 * seed position outside the physics.
 */
export function layoutForce(chain: Chain, shown?: Set<string>): BipLayout {
  const ids: string[] = [];
  const isTx: boolean[] = [];
  const ws: number[] = [];
  const hs: number[] = [];
  const index = new Map<string, number>();
  const parked: { id: string; tx: boolean; w: number; h: number }[] = [];
  const add = (id: string, tx: boolean, w: number, h: number): void => {
    if (shown && !shown.has(id)) {
      parked.push({ id, tx, w, h });
      return;
    }
    index.set(id, ids.length);
    ids.push(id);
    isTx.push(tx);
    ws.push(w);
    hs.push(h);
  };
  for (const coin of chain.coins.values()) add(coin.id, false, coinPillW(coin.value), COIN_H);
  for (const tid of chain.order) add(tid, true, TX_W, TX_H);

  const edges: [number, number][] = [];
  for (const tid of chain.order) {
    const t = index.get(tid);
    if (t === undefined) continue;
    const tx = chain.txs.get(tid)!;
    for (const cid of tx.inputs) {
      const c = index.get(cid);
      if (c !== undefined) edges.push([c, t]);
    }
    for (const cid of tx.outputs) {
      const c = index.get(cid);
      if (c !== undefined) edges.push([t, c]);
    }
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
  for (let pass = 0; pass < iters; pass++) {
    dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = x[i]! - x[j]!, vy = y[i]! - y[j]!;
        let d2 = vx * vx + vy * vy;
        if (d2 < 1e-4) { vx = ((i * 37 + j) % 13) - 6; vy = ((i * 53 + j) % 11) - 5; d2 = vx * vx + vy * vy; }
        const f = REPULSE / d2;
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

  // Post passes: hard constraints the springs only approximate.
  // (a) no two node frames overlap — overlapping pairs separate along
  //     their center line until their inflated frames clear;
  // (b) an edge bending around a vertex costs energy — a node sitting on
  //     a foreign edge's straight path is pushed off it perpendicularly,
  //     so the mostly-straight edges actually read as straight lines.
  const relaxPasses = 40;
  for (let pass = 0; pass < relaxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const needW = (ws[i]! + ws[j]!) / 2 + CLEARANCE;
        const needH = (hs[i]! + hs[j]!) / 2 + CLEARANCE;
        let vx = x[j]! - x[i]!, vy = y[j]! - y[i]!;
        const ox = needW - Math.abs(vx), oy = needH - Math.abs(vy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (vx === 0 && vy === 0) { vx = ((i * 37 + j) % 13) - 6; vy = ((i * 53 + j) % 11) - 5 || 1; }
        // separate along the axis of least intrusion
        if (ox < oy) {
          const s = (ox / 2 + 0.5) * Math.sign(vx || 1);
          x[i]! -= s; x[j]! += s;
        } else {
          const s = (oy / 2 + 0.5) * Math.sign(vy || 1);
          y[i]! -= s; y[j]! += s;
        }
      }
    }
    if (pass % 2 === 1) {
      for (const [a, b] of edges) {
        const ax = x[a]!, ay = y[a]!, bx = x[b]!, by = y[b]!;
        const ex = bx - ax, ey = by - ay;
        const len2 = ex * ex + ey * ey;
        if (len2 < 1) continue;
        for (let i = 0; i < n; i++) {
          if (i === a || i === b) continue;
          const t = ((x[i]! - ax) * ex + (y[i]! - ay) * ey) / len2;
          if (t <= 0.05 || t >= 0.95) continue;
          const px = ax + ex * t, py = ay + ey * t;
          let nx = x[i]! - px, ny = y[i]! - py;
          const d = Math.sqrt(nx * nx + ny * ny);
          const need = Math.min(ws[i]!, hs[i]!) / 2 + CLEARANCE;
          if (d >= need) continue;
          moved = true;
          if (d < 1e-3) { nx = -ey; ny = ex; }
          const dn = Math.sqrt(nx * nx + ny * ny) || 1;
          const push = (need - d) * 0.6;
          x[i]! += (nx / dn) * push;
          y[i]! += (ny / dn) * push;
        }
      }
    }
    if (!moved) break;
  }

  const coins = new Map<CoinId, Rect>();
  const txs = new Map<TxId, Rect>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const w = ws[i]!, h = hs[i]!;
    const rect: Rect = { x: x[i]! - w / 2, y: y[i]! - h / 2, w, h };
    minX = Math.min(minX, rect.x); minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w); maxY = Math.max(maxY, rect.y + rect.h);
    if (isTx[i]) txs.set(ids[i]!, rect);
    else coins.set(ids[i]!, rect);
  }
  // hidden nodes: positioned (the renderer looks every node up) but out
  // of the physics and the bounds — the camera frames only the shown
  for (const p of parked) {
    const [h1, h2] = hashSeed(p.id);
    const a = (h1 / 4294967296) * Math.PI * 2;
    const r = R * Math.sqrt(h2 / 4294967296);
    const rect: Rect = { x: Math.cos(a) * r - p.w / 2, y: Math.sin(a) * r - p.h / 2, w: p.w, h: p.h };
    if (p.tx) txs.set(p.id as TxId, rect);
    else coins.set(p.id as CoinId, rect);
  }

  // straight edges, anchored on whichever perimeter point faces the other
  // end (radial), with arrowheads carrying the direction time used to
  return {
    coins, txs, routes: new Map(), radial: true,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}
