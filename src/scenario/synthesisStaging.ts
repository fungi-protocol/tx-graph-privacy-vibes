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
import { type Chain, type CoinId } from "../model/chain";
import { type Clustering } from "../analysis/clusters";
import { auxGraph, propagationStep, targetGraph, type SweepResult } from "../analysis/propagation";
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

/** the `n` largest PURE clusters after passing over the `skip`
 *  largest, as seed mappings rep -> agent id (as a string, matching
 *  auxGraph's node names). Distinct owners: seeding two clusters to
 *  one agent would itself assert a weld the observer never made.
 *  `skip` is a staging dial with the same license as `n`: WHICH pure
 *  clusters an analyst happens to hold out-of-band names for is
 *  arbitrary, so the exhibit may pick among them. */
export function pureClusterSeeds(
  cl: Clustering,
  ownerOf: (id: CoinId) => number | null,
  n: number,
  skip = 0,
): Map<string, string> {
  const seeds = new Map<string, string>();
  const used = new Set<number>();
  const bySize = [...cl.members.entries()]
    .filter(([, m]) => m.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  let passed = 0;
  for (const [rep] of bySize) {
    if (seeds.size >= n) break;
    const owner = clusterOwner(cl, rep, ownerOf);
    if (owner === null || used.has(owner)) continue;
    if (passed < skip) { passed += 1; continue; }
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

/** everything the narrated-sweep step needs, staged deterministically:
 *  scan seed choices (counts 2..8, passing over up to 4 of the largest
 *  pure clusters) and pick the first whose single sweep
 *  produces a FALSE-graded acceptance — a pure cluster accepted for
 *  the wrong owner, the outcome accuracy's ruling asks the chapter to
 *  foreground ("the gate passed and the answer is wrong"). Grading
 *  used to SELECT an exhibit is the permitted direction of the
 *  latent-truth rule, same as picking the proven-ambiguous coinjoin.
 *  Falls back to an undefined-graded acceptance (named as such), then
 *  to whatever sweep ran, so the step always has something honest to
 *  display. */
export interface SweepExhibit {
  seeds: Map<string, string>;
  result: SweepResult;
  grades: Map<string, Grade>;
  /** the acceptance the prose foregrounds, if any */
  featured?: { node: string; agent: string; grade: Grade; eccentricity: number };
}

export function synthesisSweepExhibit(
  chain: Chain,
  cl: Clustering,
  edges: Edge[],
  agents: number[],
  ownerOf: (id: CoinId) => number | null,
): SweepExhibit {
  const tg = targetGraph(chain, cl);
  const aux = auxGraph(outsiderEdges(edges, 300), agents);
  let fallback: SweepExhibit | null = null;
  for (let skip = 0; skip <= 4; skip++)
  for (let n = 2; n <= 8; n++) {
    const seeds = pureClusterSeeds(cl, ownerOf, n, skip);
    if (seeds.size < 2) continue;
    const result = propagationStep(tg, aux, seeds);
    const grades = gradeAcceptances(cl, result.accepted, ownerOf);
    const pick = (want: Grade): SweepExhibit | null => {
      for (const [node, grade] of grades) {
        if (grade !== want) continue;
        const v = result.verdicts.find((x) => x.node === node)!;
        if (v.outcome.kind !== "accepted") continue;
        return { seeds, result, grades, featured: { node, agent: v.outcome.mapped, grade, eccentricity: v.eccentricity } };
      }
      return null;
    };
    const withFalse = pick("false");
    if (withFalse) return withFalse;
    fallback = fallback ?? pick("undefined") ?? (result.verdicts.length > 0 ? { seeds, result, grades } : null);
  }
  return fallback ?? { seeds: new Map(), result: { verdicts: [], accepted: new Map() }, grades: new Map() };
}
