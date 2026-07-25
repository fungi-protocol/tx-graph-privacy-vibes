// Staging for the synthesis demonstration — the two places latent
// truth is legitimately consulted, both OUTSIDE the analysis:
//
//   - Seed purity. The paper's premise is a deterministic 1-1 mapping
//     between the graphs' nodes; a mixed-owner cluster has no single
//     true image, so seeding it is seeding a falsehood. Staging picks
//     seeds among PURE clusters (every member coin one owner) using the
//     sim's ground truth — the out-of-band identification a real seed
//     would come from.
//
//   - Grading. After a sweep, each accepted mapping is classified
//     against latent truth: "correct" (the cluster is pure and its
//     owner is the accepted agent), "false" (pure, different owner),
//     or "undefined" (a mixed cluster — no single true answer exists).
//     Grading is the permitted direction of the latent-truth rule:
//     truth judges the analysis, never feeds it.
//
// A third staging concern, on the OTHER side of the truth line: the
// analyst's auxiliary graph must be a degraded proxy for the town's
// relationships, never the cast's own edge list — the paper's setting
// is two graphs from different, imperfect sources. outsiderEdges()
// models what an outsider plausibly hears about: the big arrangements
// (rent, invoices, commissioned work), not the small favors.
import { type CoinId } from "../model/chain";
import { type Clustering } from "../analysis/clusters";
import { type Edge } from "./cast";

/** the relationships an outsider knows: those whose typical amount can
 *  reach `minUsd` (big arrangements are talked about, small favors are
 *  not). Deterministic, and honest about direction: degrading the aux
 *  graph makes propagation HARDER, so results with it are a floor. */
export function outsiderEdges(edges: Edge[], minUsd: number): Edge[] {
  return edges.filter((e) => e.memos.some(([, , hi]) => hi >= minUsd));
}

/** the single owner of every coin in the cluster, or null if mixed
 *  (or if any member is unowned) */
export function clusterOwner(
  cl: Clustering,
  rep: CoinId,
  ownerOf: (id: CoinId) => number | null,
): number | null {
  let owner: number | null = null;
  for (const id of cl.members.get(rep) ?? []) {
    const o = ownerOf(id);
    if (o === null) return null;
    if (owner === null) owner = o;
    else if (o !== owner) return null;
  }
  return owner;
}

/** the `n` largest PURE clusters, as seed mappings rep -> agent id
 *  (as a string, matching auxGraph's node names). Distinct owners:
 *  seeding two clusters to one agent would itself assert a weld the
 *  observer never made. */
export function pureClusterSeeds(
  cl: Clustering,
  ownerOf: (id: CoinId) => number | null,
  n: number,
): Map<string, string> {
  const seeds = new Map<string, string>();
  const used = new Set<number>();
  const bySize = [...cl.members.entries()]
    .filter(([, m]) => m.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  for (const [rep] of bySize) {
    if (seeds.size >= n) break;
    const owner = clusterOwner(cl, rep, ownerOf);
    if (owner === null || used.has(owner)) continue;
    seeds.set(rep, String(owner));
    used.add(owner);
  }
  return seeds;
}

export type Grade = "correct" | "false" | "undefined";

/** classify each accepted mapping against latent truth */
export function gradeAcceptances(
  cl: Clustering,
  accepted: Map<string, string>,
  ownerOf: (id: CoinId) => number | null,
): Map<string, Grade> {
  const grades = new Map<string, Grade>();
  for (const [rep, agent] of accepted) {
    const owner = clusterOwner(cl, rep, ownerOf);
    grades.set(rep, owner === null ? "undefined"
      : String(owner) === agent ? "correct" : "false");
  }
  return grades;
}
