// Layout seam of the clusterview split (#115): arrangements of the
// contracted graph. Everything here computes GEOMETRY ONLY from the
// semantic scene (scene.ts) and the partition — which strands exist is
// never decided here, so switching arrangements can animate identical
// incidence ids instead of re-deriving topology.
import { type Chain, type CoinId } from "../model/chain";
import { type Clustering } from "../analysis/clusters";
import { type Rect } from "./blockview";
import { contractedScene } from "./scene";

export interface ClusterNode {
  rep: CoinId;
  x: number;
  y: number;
  r: number;
  size: number;
  /** column-layout only: the epochs (lanes) this vertex holds a slot
   *  in — one entry for a vertex living in its own epoch, several for
   *  a vertex the matching fused across epochs. Absent on the ring.
   *  The renderer reads it to pick an edge's shape: an edge inside one
   *  lane threads like an arc diagram, an edge between lanes runs
   *  straight, the bipartite reading. */
  lanes?: number[];
}

export interface ClusterLayout {
  nodes: Map<CoinId, ClusterNode>;
  bounds: Rect;
}

/** Similarity-map a cluster layout into a target world rect: scaled to
 *  fit, centered on the target's center. The contraction forms its
 *  circle where the camera already looks — the coins travel, the
 *  viewport doesn't. */
export function fitClusterLayout(lay: ClusterLayout, target: Rect): ClusterLayout {
  const b = lay.bounds;
  if (b.w <= 0 || b.h <= 0 || target.w <= 0 || target.h <= 0) return lay;
  const k = Math.min(target.w / b.w, target.h / b.h);
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const tx = target.x + target.w / 2, ty = target.y + target.h / 2;
  const nodes = new Map<CoinId, ClusterNode>();
  for (const [rep, n] of lay.nodes) {
    nodes.set(rep, { ...n, x: tx + (n.x - bx) * k, y: ty + (n.y - by) * k, r: n.r * k });
  }
  return {
    nodes,
    bounds: { x: tx - (b.w / 2) * k, y: ty - (b.h / 2) * k, w: b.w * k, h: b.h * k },
  };
}

/** where the i-th coin of a cluster sits inside its vertex: a sunflower
 *  packing (golden-angle spiral) — a cluster is drawn as a STACK of its
 *  member coins, dots packed inside the vertex's rim, not an abstract
 *  disc. Offsets are unscaled: the renderer multiplies them (and the
 *  dot radius) by pileScale so the pile fits the plateauing disc. */
export function pileOffset(i: number): { dx: number; dy: number } {
  if (i === 0) return { dx: 0, dy: 0 };
  const a = i * 2.399963229728653;
  const r = 5.6 * Math.sqrt(i);
  return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
}

/** a cluster disc's radius: grows with membership but plateaus (area
 *  ~ sqrt of the coin count) so a big cluster stays in the same visual
 *  register as its caption instead of dwarfing it */
export function discRadius(size: number): number {
  return size >= 2 ? 12 + 9 * Math.pow(size, 0.25) : 5;
}

/** how much a cluster's sunflower pile (and its coin dots) must shrink
 *  to fit inside the disc — 1 for small stacks, tightening as the
 *  plateauing radius stops keeping up with the sqrt-growing pile */
export function pileScale(size: number, r: number): number {
  if (size < 2) return 1;
  return Math.min(1, (r - 2) / (5.6 * Math.sqrt(size - 1) + 5));
}

/** weighted adjacency over the contracted vertices, one edge per
 *  scene strand pair — the attraction both barycenter passes read */
function transferAdjacency(chain: Chain, cl: Clustering): Map<CoinId, Map<CoinId, number>> {
  const adj = new Map<CoinId, Map<CoinId, number>>();
  const bump = (a: CoinId, b: CoinId): void => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const e of contractedScene(chain, cl)) {
    for (const from of e.from) {
      for (const to of e.to) {
        bump(from, to);
        bump(to, from);
      }
    }
  }
  return adj;
}

/** the shared seriation of the contracted vertices: chain-rank order,
 *  refined to earliest-coin (timeline) order when the chain is at
 *  hand; "force" runs the circular-barycenter sweeps on top so
 *  transfer neighbors end up adjacent. Without a chain the rank order
 *  stands (tests, and the repartition tween's synthetic partitions). */
function seriation(cl: Clustering, chain: Chain | undefined, mode: "time" | "force"): CoinId[] {
  let order = [...cl.members.keys()].sort((a, b) => cl.rank.get(a)! - cl.rank.get(b)!);
  if (chain) {
    const day = (id: CoinId): number => {
      const c = chain.coins.get(id)!;
      return c.producer ? chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
    };
    const earliest = new Map<CoinId, number>();
    for (const [rep, members] of cl.members) {
      let e = Infinity;
      for (const id of members) e = Math.min(e, day(id));
      earliest.set(rep, e);
    }
    order = order.sort((a, b) => earliest.get(a)! - earliest.get(b)! || (a < b ? -1 : 1));
    if (mode === "force") order = crossingMinimizedOrder(cl, chain, order);
  }
  return order;
}

/** Ring layout: every partition vertex — multi-coin clusters and the
 *  anonymous singletons alike — sits on ONE ellipse, spaced by kind:
 *  clusters (>= 2 coins) claim wide arcs so they read apart, while the
 *  singletons — dust the partition resolved nothing about — pack
 *  tight. The default ("time") ring is the TIMELINE bent around a
 *  circle: each vertex sits by its earliest coin, running clockwise
 *  from just left of six o'clock all the way around to just before it,
 *  a small gap between the ends. The bottom of the refinement lattice
 *  (every coin a singleton) is then literally the coin graph's
 *  vertices laid out by time, and any partial clustering keeps visual
 *  cohesion with it — the layered graph's left-to-right order,
 *  wrapped. "force" instead orders the ring to reduce edge crossings:
 *  starting from the time order, a few circular-barycenter sweeps pull
 *  each vertex toward the mean angle of its transfer neighbors, so
 *  connected vertices end up near each other and edges hug the rim.
 *  Without a chain the rank order stands (tests, and the repartition
 *  tween's synthetic partitions). */
export function layoutClusterGraph(
  cl: Clustering,
  chain?: Chain,
  mode: "time" | "force" = "time",
): ClusterLayout {
  const order = seriation(cl, chain, mode);

  // arc room by kind: a cluster's slot is its diameter plus a wide
  // gap, a singleton's just its own footprint plus a sliver
  const items = order.map((rep) => {
    const size = cl.members.get(rep)!.length;
    const r = discRadius(size);
    return { rep, r, size, width: 2 * r + (size >= 2 ? 90 : 12) };
  });

  const nodes = new Map<CoinId, ClusterNode>();
  const total = Math.max(1, items.reduce((s, it) => s + it.width, 0));
  const gapW = Math.max(80, total * 0.04); // the seam at six o'clock
  const T = total + gapW;
  const R = Math.max(320, T / (2 * Math.PI));
  let cum = 0;
  for (const it of items) {
    // six o'clock is PI/2 in screen coordinates (y down); the gap
    // straddles it, so the first vertex lands just left of it and the
    // last just right, the timeline running clockwise between them
    const a = Math.PI / 2 + ((gapW / 2 + cum + it.width / 2) / T) * 2 * Math.PI;
    cum += it.width;
    nodes.set(it.rep, { rep: it.rep, x: Math.cos(a) * R * 1.35, y: Math.sin(a) * R, r: it.r, size: it.size });
  }
  const M = 50 + items.reduce((m, it) => Math.max(m, it.r), 0);
  return {
    nodes,
    bounds: { x: -R * 1.35 - M, y: -R - M, w: 2 * R * 1.35 + 2 * M, h: 2 * R + 2 * M },
  };
}

/** Band layout: the ring's timeline left unbent — every partition
 *  vertex on one horizontal row, earliest coin first, spaced by kind
 *  exactly like the ring (clusters claim wide slots, singletons pack
 *  tight). The bounds leave the row's room BELOW it, so the renderer's
 *  center-seeking bow turns each transfer edge into an arc under the
 *  timeline, deeper the longer its span — an arc diagram of the
 *  contracted graph, the left-to-right reading of the same scene the
 *  ring bends around a circle. */
export function layoutClusterBand(
  cl: Clustering,
  chain?: Chain,
  mode: "time" | "force" = "time",
): ClusterLayout {
  const order = seriation(cl, chain, mode);
  const items = order.map((rep) => {
    const size = cl.members.get(rep)!.length;
    const r = discRadius(size);
    return { rep, r, size, width: 2 * r + (size >= 2 ? 90 : 12) };
  });
  const nodes = new Map<CoinId, ClusterNode>();
  const total = Math.max(1, items.reduce((s, it) => s + it.width, 0));
  let cum = 0;
  for (const it of items) {
    nodes.set(it.rep, { rep: it.rep, x: cum + it.width / 2, y: 0, r: it.r, size: it.size });
    cum += it.width;
  }
  const maxR = items.reduce((m, it) => Math.max(m, it.r), 0);
  const M = 50 + maxR;
  const drop = Math.max(280, total * 0.22); // arc room under the row
  return {
    nodes,
    bounds: { x: -M, y: -maxR - M, w: total + 2 * M, h: maxR + M + drop },
  };
}

/** Force map: the contracted graph placed freely — vertices start on
 *  the timeline ring and relax under springs along their transfer
 *  edges plus pairwise repulsion, so connected clusters pull together
 *  and strangers drift apart. Deterministic: the start state is the
 *  time ring and every sweep is a fixed-order pass, no randomness —
 *  the same (chain, partition) always settles into the same map. */
export function layoutClusterForceMap(cl: Clustering, chain: Chain): ClusterLayout {
  const start = layoutClusterGraph(cl, chain, "time");
  const reps = [...start.nodes.keys()];
  const pos = new Map<CoinId, { x: number; y: number }>();
  for (const [rep, n] of start.nodes) pos.set(rep, { x: n.x, y: n.y });
  const adj = transferAdjacency(chain, cl);
  const radius = (rep: CoinId): number => start.nodes.get(rep)!.r;
  for (let it = 0; it < 120; it++) {
    const cool = 1 - it / 120;
    // attraction along transfer edges toward a touching-plus-gap rest
    // length, stronger for heavier edges (capped so a busy pair cannot
    // slingshot)
    for (const [a, m] of adj) {
      const pa = pos.get(a)!;
      for (const [b, w] of m) {
        const pb = pos.get(b)!;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.hypot(dx, dy) || 1;
        const rest = radius(a) + radius(b) + 110;
        const k = 0.012 * Math.min(3, w) * cool * (d - rest) / d;
        pa.x += dx * k; pa.y += dy * k;
        pb.x -= dx * k; pb.y -= dy * k;
      }
    }
    // pairwise repulsion, felt only in each other's neighborhood — a
    // plain O(n^2) pass; the contracted graph stays small enough
    for (let i = 0; i < reps.length; i++) {
      const pa = pos.get(reps[i]!)!;
      for (let j = i + 1; j < reps.length; j++) {
        const pb = pos.get(reps[j]!)!;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d2 = dx * dx + dy * dy;
        const reach = radius(reps[i]!) + radius(reps[j]!) + 120;
        if (d2 >= reach * reach || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const k = 0.5 * cool * (reach - d) / (d * reach) * reach;
        pa.x -= (dx / d) * k; pa.y -= (dy / d) * k;
        pb.x += (dx / d) * k; pb.y += (dy / d) * k;
      }
    }
  }
  const nodes = new Map<CoinId, ClusterNode>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rep of reps) {
    const p = pos.get(rep)!;
    const n = start.nodes.get(rep)!;
    nodes.set(rep, { ...n, x: p.x, y: p.y });
    minX = Math.min(minX, p.x - n.r); maxX = Math.max(maxX, p.x + n.r);
    minY = Math.min(minY, p.y - n.r); maxY = Math.max(maxY, p.y + n.r);
  }
  const M = 60;
  return {
    nodes,
    bounds: { x: minX - M, y: minY - M, w: maxX - minX + 2 * M, h: maxY - minY + 2 * M },
  };
}

/** Column layout for the ns-social partition: each column is one of the
 *  ring's circles cut open into a vertical line segment, side by side,
 *  with a correspondence between them. A vertex sits in the lane of its
 *  column; a vertex the matching fused across columns spans them —
 *  placed at the mean of the slots it holds in each, which is exactly
 *  the "merged horizontally" reading of an accepted match. Within a
 *  lane the order follows the layout button's usual rule: "time" is the
 *  timeline (earliest coin first), "force" runs linear-barycenter
 *  sweeps pulling transfer neighbors toward each other so the mapping
 *  edges run shorter. `lanes` names each vertex's columns (from the
 *  base partition, BEFORE matching fused anything). */
export function layoutClusterColumns(
  cl: Clustering,
  chain: Chain,
  lanes: Map<CoinId, number[]>,
  parts: number,
  mode: "time" | "force" = "time",
): ClusterLayout {
  const day = (id: CoinId): number => {
    const c = chain.coins.get(id)!;
    return c.producer ? chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const earliest = new Map<CoinId, number>();
  for (const [rep, members] of cl.members) {
    let e = Infinity;
    for (const id of members) e = Math.min(e, day(id));
    earliest.set(rep, e);
  }
  const reps = [...cl.members.keys()]
    .sort((a, b) => earliest.get(a)! - earliest.get(b)! || (a < b ? -1 : 1));

  const slotH = (rep: CoinId): number => {
    const size = cl.members.get(rep)!.length;
    const r = discRadius(size);
    return 2 * r + (size >= 2 ? 64 : 14);
  };

  // per-lane vertical packing, every lane centered on y = 0
  const laneOrder: CoinId[][] = Array.from({ length: parts }, () => []);
  for (const rep of reps) {
    for (const lane of lanes.get(rep) ?? [0]) laneOrder[Math.min(lane, parts - 1)]!.push(rep);
  }
  // lane spacing follows the content: a tall epoch would otherwise
  // scale the whole drawing down until the columns sat shoulder to
  // shoulder (the viewport fit is uniform), so the gap grows with the
  // tallest lane, keeping the drawing's aspect steady however long
  // the columns run
  const tallest = laneOrder.reduce(
    (m, order) => Math.max(m, order.reduce((s, rep) => s + slotH(rep), 0)), 1);
  const LANE_W = Math.max(620, (tallest * 1.2) / Math.max(1, parts));
  const laneX = (i: number): number => (i - (parts - 1) / 2) * LANE_W;
  if (mode === "force") {
    // linear-barycenter sweeps: within each lane, re-sort by the mean
    // current y of a vertex's transfer neighbors (wherever they sit)
    const adj = transferAdjacency(chain, cl);
    for (let sweep = 0; sweep < 8; sweep++) {
      // a fused vertex's working position is its mean index over lanes
      const pos = new Map<CoinId, { s: number; n: number }>();
      for (const order of laneOrder) {
        order.forEach((rep, i) => {
          const p = pos.get(rep) ?? { s: 0, n: 0 };
          p.s += i;
          p.n += 1;
          pos.set(rep, p);
        });
      }
      const y = new Map<CoinId, number>();
      for (const [rep, p] of pos) y.set(rep, p.s / p.n);
      for (const order of laneOrder) {
        const key = new Map<CoinId, number>();
        for (const rep of order) {
          const nbrs = adj.get(rep);
          if (!nbrs || nbrs.size === 0) {
            key.set(rep, y.get(rep)!);
            continue;
          }
          let sum = 0, w = 0;
          for (const [o, ww] of nbrs) {
            if (y.get(o) === undefined) continue;
            sum += y.get(o)! * ww;
            w += ww;
          }
          key.set(rep, w > 0 ? sum / w : y.get(rep)!);
        }
        order.sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : 1));
      }
    }
  }

  // a fused vertex holds a slot in every lane it spans; its drawn
  // position is the mean of those slots
  const acc = new Map<CoinId, { sx: number; sy: number; n: number }>();
  for (let lane = 0; lane < parts; lane++) {
    const order = laneOrder[lane]!;
    const total = order.reduce((s, rep) => s + slotH(rep), 0);
    let cum = -total / 2;
    for (const rep of order) {
      const h = slotH(rep);
      const y = cum + h / 2;
      cum += h;
      const a = acc.get(rep) ?? { sx: 0, sy: 0, n: 0 };
      a.sx += laneX(lane);
      a.sy += y;
      a.n += 1;
      acc.set(rep, a);
    }
  }
  const nodes = new Map<CoinId, ClusterNode>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rep of reps) {
    const size = cl.members.get(rep)!.length;
    const r = discRadius(size);
    const a = acc.get(rep) ?? { sx: 0, sy: 0, n: 1 };
    const x = a.sx / Math.max(1, a.n), y = a.sy / Math.max(1, a.n);
    nodes.set(rep, { rep, x, y, r, size, lanes: lanes.get(rep) ?? [0] });
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  }
  const M = 80;
  return {
    nodes,
    bounds: { x: minX - M, y: minY - M, w: maxX - minX + 2 * M, h: maxY - minY + 2 * M },
  };
}

/** the "force" ring order: iterative circular-barycenter sweeps.
 *  Neighbors on the transfer multigraph attract; each sweep re-sorts
 *  the ring by the weighted mean angle of every vertex's neighbors
 *  (isolated vertices keep their current angle), which shortens edges
 *  and untangles crossings without leaving the circle. Deterministic:
 *  fixed sweep count, ties broken by id. */
function crossingMinimizedOrder(cl: Clustering, chain: Chain, start: CoinId[]): CoinId[] {
  const adj = transferAdjacency(chain, cl);
  let order = start;
  const n = order.length;
  if (n < 3) return order;
  for (let sweep = 0; sweep < 8; sweep++) {
    const angle = new Map<CoinId, number>();
    order.forEach((rep, i) => angle.set(rep, (i / n) * 2 * Math.PI));
    const key = new Map<CoinId, number>();
    for (const rep of order) {
      const nbrs = adj.get(rep);
      if (!nbrs || nbrs.size === 0) {
        key.set(rep, angle.get(rep)!);
        continue;
      }
      // circular mean of neighbor angles, weighted by transfer count
      let sx = 0, sy = 0;
      for (const [o, w] of nbrs) {
        const a = angle.get(o)!;
        sx += Math.cos(a) * w;
        sy += Math.sin(a) * w;
      }
      key.set(rep, sx === 0 && sy === 0 ? angle.get(rep)!
        : (Math.atan2(sy, sx) + 2 * Math.PI) % (2 * Math.PI));
    }
    order = [...order].sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : 1));
  }
  return order;
}
