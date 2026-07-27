// Transition seam of the clusterview split (#115): interpolation state
// for the animated repartition. Purely cosmetic — both endpoints are
// honestly computed partitions; the tween never feeds any analysis.
import { type CoinId } from "../model/chain";
import { type Clustering } from "../analysis/clusters";
import { type ClusterLayout, type Strand } from "./clusterlayout";

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
 *  new disc. */
export interface ClusterTransition {
  t: number; // 0 = old discs, 1 = settled new layout
  fragments: Map<CoinId, { x: number; y: number; r: number; coins: CoinId[] }[]>;
  /** the OLD arrangement's strand shapes, keyed by incidence id (#129):
   *  when present, the renderer interpolates each strand from this
   *  shape to the new arrangement's, so an edge morphs from where it
   *  was to where it is going. A strand only in the old map fades out
   *  and one only in the new map fades in — by the #115 contract that
   *  happens exactly when the partition itself changed. */
  strands?: Map<string, Strand>;
}

/** start-state fragments for animating oldCl/oldClay -> newCl: for each
 *  new cluster, one fragment per old disc its members came from, sized
 *  by the share of that old disc it takes with it and carrying the
 *  member coins it brings — a vertex is a stack of coins, so the tween
 *  glides the coins themselves rather than crossfading discs */
export function transitionFragments(
  oldCl: Clustering,
  oldClay: ClusterLayout,
  newCl: Clustering,
): Map<CoinId, { x: number; y: number; r: number; coins: CoinId[] }[]> {
  const out = new Map<CoinId, { x: number; y: number; r: number; coins: CoinId[] }[]>();
  for (const [rep, members] of newCl.members) {
    const byOld = new Map<CoinId, CoinId[]>();
    for (const id of members) {
      const o = oldCl.rep.get(id);
      if (o === undefined) continue;
      const l = byOld.get(o);
      if (l) l.push(id); else byOld.set(o, [id]);
    }
    const frags: { x: number; y: number; r: number; coins: CoinId[] }[] = [];
    for (const [o, ids] of byOld) {
      const node = oldClay.nodes.get(o);
      if (!node) continue;
      const share = ids.length / oldCl.members.get(o)!.length;
      frags.push({ x: node.x, y: node.y, r: Math.max(5, node.r * Math.sqrt(share)), coins: ids });
    }
    if (frags.length > 0) out.set(rep, frags);
  }
  return out;
}
