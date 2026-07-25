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

/** Ring layout: multi-coin clusters around an inner ellipse, largest
 *  first, sized by members; the anonymous singletons — dust the partition
 *  resolved nothing about — form a sparse outer halo instead of inflating
 *  the ring until the real clusters vanish. */
export function layoutClusterGraph(cl: Clustering): ClusterLayout {
  const reps = [...cl.members.keys()].sort((a, b) => cl.rank.get(a)! - cl.rank.get(b)!);
  const inner = reps.filter((r) => cl.members.get(r)!.length >= 2);
  const halo = reps.filter((r) => cl.members.get(r)!.length < 2);
  const n = Math.max(1, inner.length);
  const R = Math.max(320, (n * 130) / (2 * Math.PI));
  const nodes = new Map<CoinId, ClusterNode>();
  inner.forEach((rep, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const size = cl.members.get(rep)!.length;
    nodes.set(rep, {
      rep,
      x: Math.cos(a) * R * 1.35,
      y: Math.sin(a) * R,
      r: 12 + 7 * Math.sqrt(size),
      size,
    });
  });
  const H = R * 1.45;
  halo.forEach((rep, i) => {
    const a = (i / Math.max(1, halo.length)) * 2 * Math.PI - Math.PI / 2;
    nodes.set(rep, { rep, x: Math.cos(a) * H * 1.35, y: Math.sin(a) * H, r: 5, size: 1 });
  });
  const O = halo.length > 0 ? H : R;
  return {
    nodes,
    bounds: { x: -O * 1.35 - 80, y: -O - 80, w: 2 * O * 1.35 + 160, h: 2 * O + 160 },
  };
}

function bezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  // bow transfer edges toward the ring's center so parallel edges read
  const mx = (x0 + x1) / 2 / 2, my = (y0 + y1) / 2 / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
}

/**
 * Draw the contraction morph: t = 0 is the current graph drawing (whatever
 * mix of block and bipartite the morph phase shows), t = 1 the contracted
 * cluster graph — one dimension flattened, the helix seen end-on. Coin
 * vertices glide into their cluster's disc and fade; transfer edges fade in.
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
): void {
  const transT = trans ? trans.t : 1;
  const nodeOf = (id: CoinId): ClusterNode => clay.nodes.get(cl.rep.get(id)!)!;

  // residual transfer edges (one per tx output whose source differs);
  // during a repartition tween they fade in with the settling discs
  ctx.save();
  ctx.globalAlpha = Math.max(0, t * 0.75) * (0.25 + 0.75 * transT);
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const from = nodeOf(tx.inputs[0]!);
    for (const out of tx.outputs) {
      const to = nodeOf(out);
      if (to === from) continue; // self-transfer (same inferred cluster) contracts away
      bezier(ctx, from.x, from.y, to.x, to.y);
      ctx.strokeStyle = paint.color(tx.inputs[0]!) + "70";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  ctx.restore();

  // coins gliding into their cluster's disc
  if (t < 0.98) {
    ctx.save();
    ctx.globalAlpha = 1 - t;
    for (const coin of chain.coins.values()) {
      const from = coinRectAt(block, bip, coin.id, morphT)!;
      const node = nodeOf(coin.id);
      const x = from.x + (node.x - (from.x + from.w / 2)) * t;
      const y = from.y + (node.y - (from.y + from.h / 2)) * t;
      const w = from.w * (1 - 0.8 * t), h = from.h * (1 - 0.8 * t);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fillStyle = paint.color(coin.id);
      ctx.fill();
    }
    // tx squares fade toward the midpoint of their transfer
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
    ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * t);
    const r = node.r * (0.4 + 0.6 * t);
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
    if (t > 0.6 && transT > 0.6 && label) {
      ctx.globalAlpha = ((t - 0.6) / 0.4) * ((transT - 0.6) / 0.4);
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
      ctx.fillText(`holds ${fmtSats(total)} sats`, node.x, node.y + node.r + 24);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;
}

export function hitTestClusters(clay: ClusterLayout, wx: number, wy: number): CoinId | null {
  for (const node of clay.nodes.values()) {
    const dx = wx - node.x, dy = wy - node.y;
    if (dx * dx + dy * dy <= node.r * node.r) return node.rep;
  }
  return null;
}
