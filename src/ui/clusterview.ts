// The contracted graph (doc: "by edge contraction ... all of the coins of a
// particular cluster are fused into just one vertex representing the cluster
// itself. The residual edges of this now multigraph correspond to transfers
// of Bitcoin."). With incomplete clustering this is a pseudonym graph, not
// yet a user network.
import { type Chain, type CoinId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { type Clustering } from "../analysis/clusters";
import { type Layout, type Rect } from "./blockview";
import { type BipLayout } from "./bipartite";
import { coinRectAt, txRectAt } from "./morph";

export interface ClusterNode {
  rep: CoinId;
  x: number;
  y: number;
  r: number;
  size: number;
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

/** how the active lens NAMES the contracted vertices — truth (owner
 *  names), inference ("cluster 3"), or one participant's ledger
 *  ("Heidi · known"). The topology carries the lens's information;
 *  PAINT is always the town's ground truth (the grading direction:
 *  truth judging the partition, shown to the learner, never fed to any
 *  analysis) — so a vertex the lens wrongly merged renders as a
 *  multi-color disc, and cluster collapse is visible at a glance. */
export interface ClusterPaint {
  /** the true owner's color of one coin (edges, gliding coins) */
  color(id: CoinId): string;
  /** the true owner mix of a vertex's members, fractions summing to 1,
   *  largest first — one entry means the cluster is pure */
  slices(rep: CoinId): { color: string; frac: number }[];
  /** caption under the disc; "" = an anonymous vertex, left unlabeled */
  label(rep: CoinId): string;
  /** short text inside the disc */
  center(rep: CoinId): string;
  /** optional grading line under the caption — truth judging the
   *  partition (shown to the learner, never fed to any analysis) */
  score?(rep: CoinId): string;
}

/** the true-owner color mix of a cluster's members, largest share
 *  first — the pure "paint is ground truth" computation, shared by
 *  every lens */
export function truthSlices(
  cl: Clustering,
  rep: CoinId,
  colorOf: (id: CoinId) => string,
): { color: string; frac: number }[] {
  const members = cl.members.get(rep) ?? [rep];
  const byColor = new Map<string, number>();
  for (const id of members) {
    const c = colorOf(id);
    byColor.set(c, (byColor.get(c) ?? 0) + 1);
  }
  return [...byColor.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([color, n]) => ({ color, frac: n / members.length }));
}

/** One vertex of the ANIMATED repartition: where a piece of a new
 *  cluster disc starts when a heuristic toggle merges or splits the
 *  map. Each new vertex begins as the fragments of the old discs its
 *  members came from — a merge shows discs gliding together, a split
 *  shows one disc coming apart — and every fragment converges on the
 *  new disc. Purely cosmetic: both endpoints are honestly computed
 *  partitions; the tween never feeds anything. */
export interface ClusterTransition {
  t: number; // 0 = old discs, 1 = settled new layout
  fragments: Map<CoinId, { x: number; y: number; r: number }[]>;
}

/** start-state fragments for animating oldCl/oldClay -> newCl: for each
 *  new cluster, one fragment per old disc its members came from, sized
 *  by the share of that old disc it takes with it */
export function transitionFragments(
  oldCl: Clustering,
  oldClay: ClusterLayout,
  newCl: Clustering,
): Map<CoinId, { x: number; y: number; r: number }[]> {
  const out = new Map<CoinId, { x: number; y: number; r: number }[]>();
  for (const [rep, members] of newCl.members) {
    const byOld = new Map<CoinId, number>();
    for (const id of members) {
      const o = oldCl.rep.get(id);
      if (o !== undefined) byOld.set(o, (byOld.get(o) ?? 0) + 1);
    }
    const frags: { x: number; y: number; r: number }[] = [];
    for (const [o, n] of byOld) {
      const node = oldClay.nodes.get(o);
      if (!node) continue;
      const share = n / oldCl.members.get(o)!.length;
      frags.push({ x: node.x, y: node.y, r: Math.max(5, node.r * Math.sqrt(share)) });
    }
    if (frags.length > 0) out.set(rep, frags);
  }
  return out;
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

  // arc room by kind: a cluster's slot is its diameter plus a wide
  // gap, a singleton's just its own footprint plus a sliver
  const items = order.map((rep) => {
    const size = cl.members.get(rep)!.length;
    const r = size >= 2 ? 12 + 7 * Math.sqrt(size) : 5;
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
    const r = size >= 2 ? 12 + 7 * Math.sqrt(size) : 5;
    return 2 * r + (size >= 2 ? 64 : 14);
  };
  const LANE_W = 620;
  const laneX = (i: number): number => (i - (parts - 1) / 2) * LANE_W;

  // per-lane vertical packing, every lane centered on y = 0
  const laneOrder: CoinId[][] = Array.from({ length: parts }, () => []);
  for (const rep of reps) {
    for (const lane of lanes.get(rep) ?? [0]) laneOrder[Math.min(lane, parts - 1)]!.push(rep);
  }
  if (mode === "force") {
    // linear-barycenter sweeps: within each lane, re-sort by the mean
    // current y of a vertex's transfer neighbors (wherever they sit)
    const adj = new Map<CoinId, Map<CoinId, number>>();
    const bump = (a: CoinId, b: CoinId): void => {
      let m = adj.get(a);
      if (!m) adj.set(a, (m = new Map()));
      m.set(b, (m.get(b) ?? 0) + 1);
    };
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const from = cl.rep.get(tx.inputs[0]!)!;
      for (const out of tx.outputs) {
        const to = cl.rep.get(out)!;
        if (to === from) continue;
        bump(from, to);
        bump(to, from);
      }
    }
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
    const r = size >= 2 ? 12 + 7 * Math.sqrt(size) : 5;
    const a = acc.get(rep) ?? { sx: 0, sy: 0, n: 1 };
    const x = a.sx / Math.max(1, a.n), y = a.sy / Math.max(1, a.n);
    nodes.set(rep, { rep, x, y, r, size });
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
  // weighted adjacency over the contracted vertices, one edge per tx
  // output whose source vertex differs
  const adj = new Map<CoinId, Map<CoinId, number>>();
  const bump = (a: CoinId, b: CoinId): void => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const from = cl.rep.get(tx.inputs[0]!)!;
    for (const out of tx.outputs) {
      const to = cl.rep.get(out)!;
      if (to === from) continue;
      bump(from, to);
      bump(to, from);
    }
  }
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

function bezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): { tx: number; ty: number } {
  // bow transfer edges gently toward the ring's center so parallel edges
  // read — gently, so short rim-neighbor edges (the common case once the
  // ring is seriated by edge weight) hug the rim instead of all diving
  // through the middle
  const mx = ((x0 + x1) / 2) * 0.72, my = ((y0 + y1) / 2) * 0.72;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  // end tangent (from the control point), for the flow-of-funds arrow
  return { tx: x1 - mx, ty: y1 - my };
}

/** a small arrowhead at (x1, y1) along the (tx, ty) direction */
function arrowAt(ctx: CanvasRenderingContext2D, x1: number, y1: number, tx: number, ty: number, size = 7): void {
  const d = Math.hypot(tx, ty) || 1;
  const ux = tx / d, uy = ty / d;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * size - uy * size * 0.55, y1 - uy * size + ux * size * 0.55);
  ctx.lineTo(x1 - ux * size + uy * size * 0.55, y1 - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw the contraction morph: t = 0 is the current graph drawing (whatever
 * mix of block and bipartite the morph phase shows), t = 1 the contracted
 * cluster graph — one dimension flattened, the helix seen end-on. With a
 * `ring` (the singleton layout) the morph passes THROUGH the bottom of the
 * refinement lattice: each coin first flies to its own slot on the time
 * ring — the layered timeline wrapping around the circle — and only then
 * stacks into its cluster's disc; expanding unstacks first. Transfer edges
 * fade in with the discs. `hover` names a vertex under the pointer: its
 * edges and neighbors hold full strength while the rest of the drawing
 * recedes.
 */
export function drawContraction(
  ctx: CanvasRenderingContext2D,
  chain: Chain,
  block: Layout,
  bip: BipLayout,
  morphT: number,
  clay: ClusterLayout,
  cl: Clustering,
  t: number,
  paint: ClusterPaint,
  trans?: ClusterTransition,
  hover?: CoinId,
  ring?: ClusterLayout,
): void {
  const transT = trans ? trans.t : 1;
  // with a ring waypoint the disc-side of the morph compresses into the
  // second leg: nothing stacks until the coins have reached the ring
  const RING_PHASE = 0.55;
  const discT = ring ? Math.max(0, (t - RING_PHASE) / (1 - RING_PHASE)) : t;
  const nodeOf = (id: CoinId): ClusterNode => clay.nodes.get(cl.rep.get(id)!)!;
  const hov = hover !== undefined && clay.nodes.has(hover) ? hover : undefined;
  const neighbors = new Set<CoinId>();
  if (hov !== undefined) {
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const from = cl.rep.get(tx.inputs[0]!)!;
      for (const out of tx.outputs) {
        const to = cl.rep.get(out)!;
        if (to === from) continue;
        if (from === hov) neighbors.add(to);
        else if (to === hov) neighbors.add(from);
      }
    }
  }

  // residual transfer edges (one per tx output whose source differs);
  // during a repartition tween they fade in with the settling discs
  ctx.save();
  ctx.globalAlpha = Math.max(0, discT * 0.75) * (0.25 + 0.75 * transT);
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const from = nodeOf(tx.inputs[0]!);
    for (const out of tx.outputs) {
      const to = nodeOf(out);
      if (to === from) continue; // self-transfer (same inferred cluster) contracts away
      const touched = hov !== undefined && (from.rep === hov || to.rep === hov);
      const tan = bezier(ctx, from.x, from.y, to.x, to.y);
      const color = paint.color(tx.inputs[0]!) + (touched ? "e8" : hov !== undefined ? "16" : "70");
      ctx.strokeStyle = color;
      ctx.lineWidth = touched ? 2.6 : 1.6;
      ctx.stroke();
      // flow-of-funds arrow, parked on the receiving disc's rim so the
      // disc painted on top doesn't swallow it
      const d = Math.hypot(tan.tx, tan.ty) || 1;
      ctx.fillStyle = color;
      arrowAt(ctx,
        to.x - (tan.tx / d) * (to.r + 3), to.y - (tan.ty / d) * (to.r + 3),
        tan.tx, tan.ty);
    }
  }
  ctx.restore();

  // coins gliding into their cluster's disc — with a ring, via their own
  // slot on it: fly to the timeline-on-a-circle first, stack second
  if (t < 0.98) {
    ctx.save();
    for (const coin of chain.coins.values()) {
      const from = coinRectAt(block, bip, coin.id, morphT)!;
      const node = nodeOf(coin.id);
      const cx0 = from.x + from.w / 2, cy0 = from.y + from.h / 2;
      const slot = ring?.nodes.get(coin.id);
      let cx: number, cy: number, k: number, alpha: number;
      if (slot) {
        if (t < RING_PHASE) {
          const s = t / RING_PHASE;
          cx = cx0 + (slot.x - cx0) * s;
          cy = cy0 + (slot.y - cy0) * s;
          k = 1 - 0.5 * s;
          alpha = 1;
        } else {
          const s = discT;
          cx = slot.x + (node.x - slot.x) * s;
          cy = slot.y + (node.y - slot.y) * s;
          k = 0.5 - 0.3 * s;
          alpha = 1 - s;
        }
      } else {
        cx = cx0 + (node.x - cx0) * t;
        cy = cy0 + (node.y - cy0) * t;
        k = 1 - 0.8 * t;
        alpha = 1 - t;
      }
      const w = from.w * k, h = from.h * k;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 12);
      ctx.fillStyle = paint.color(coin.id);
      ctx.fill();
    }
    // tx squares fade toward the midpoint of their transfer
    ctx.globalAlpha = 1 - t;
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const from = txRectAt(block, bip, tid, morphT)!;
      const a = nodeOf(tx.inputs[0]!), b = nodeOf(tx.outputs[0]!);
      const tx2 = (a.x + b.x) / 2, ty2 = (a.y + b.y) / 2;
      const x = from.x + (tx2 - (from.x + from.w / 2)) * t;
      const y = from.y + (ty2 - (from.y + from.h / 2)) * t;
      ctx.beginPath();
      ctx.roundRect(x, y, from.w * (1 - 0.8 * t), from.h * (1 - 0.8 * t), 8);
      ctx.fillStyle = "#26292f";
      ctx.fill();
      ctx.strokeStyle = "#4a4e57";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // cluster discs: paint is the ground truth — a pure cluster is one
  // color, a wrongly-merged one shows every true owner as a pie slice
  const disc = (x: number, y: number, r: number, slices: { color: string; frac: number }[]): void => {
    if (slices.length <= 1) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = slices[0]?.color ?? "#e8e5da";
      ctx.fill();
    } else {
      let a = -Math.PI / 2;
      for (const s of slices) {
        const a1 = a + s.frac * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, a, a1);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        a = a1;
      }
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  for (const node of clay.nodes.values()) {
    const focus =
      hov === undefined || node.rep === hov || neighbors.has(node.rep) ? 1 : 0.3;
    ctx.globalAlpha = (ring ? discT : Math.min(1, 0.25 + 0.75 * t)) * focus;
    if (ctx.globalAlpha <= 0) continue;
    const r = node.r * (0.4 + 0.6 * discT);
    const slices = paint.slices(node.rep);
    const frags = transT < 1 ? trans!.fragments.get(node.rep) : undefined;
    if (frags && frags.length > 0) {
      // repartition in flight: the old discs' pieces glide and grow
      // into this vertex (merges converge, splits pull apart)
      for (const f of frags) {
        disc(f.x + (node.x - f.x) * transT, f.y + (node.y - f.y) * transT,
          f.r + (r - f.r) * transT, slices);
      }
    } else {
      disc(node.x, node.y, r, slices);
    }
    const label = paint.label(node.rep);
    if (discT > 0.6 && transT > 0.6 && label) {
      ctx.globalAlpha = ((discT - 0.6) / 0.4) * ((transT - 0.6) / 0.4) * focus;
      const total = cl.members.get(node.rep)!
        .map((id) => chain.coins.get(id)!)
        .filter((c) => c.dest === null)
        .reduce((s, c) => s + c.value, 0);
      ctx.fillStyle = "#111";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(paint.center(node.rep), node.x, node.y);
      ctx.fillStyle = "#8b919c";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`${label} · ${node.size} coin${node.size === 1 ? "" : "s"}`, node.x, node.y + node.r + 12);
      // a cluster of only-spent coins holds nothing — say so by silence
      // rather than captioning most of the drawing "holds 0 sats"
      if (total > 0) ctx.fillText(`holds ${fmtSats(total)} sats`, node.x, node.y + node.r + 24);
      const score = paint.score?.(node.rep);
      if (score) ctx.fillText(score, node.x, node.y + node.r + (total > 0 ? 36 : 24));
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;
}

export function hitTestClusters(clay: ClusterLayout, wx: number, wy: number): CoinId | null {
  for (const node of clay.nodes.values()) {
    const dx = wx - node.x, dy = wy - node.y;
    // singleton discs are tiny; give the pointer a little grace
    const r = Math.max(node.r, 10);
    if (dx * dx + dy * dy <= r * r) return node.rep;
  }
  return null;
}
