// One Narayanan–Shmatikov-style propagation step over the town.
//
// The mechanism of arXiv:0903.3276 §5.2, run at toy scale as a
// DEMONSTRATION: the observer holds a pseudonym graph (clusters,
// connected by the payments visible between them) and an auxiliary
// graph (the town's recurring relationships — who tends to do business
// with whom), plus a few seed identifications obtained out of band.
// Candidate mappings are scored by their mapped neighbors; eccentricity
// — (max − max₂)/σ over a candidate set — measures how sharply the best
// candidate stands out; a mapping is accepted only when the standout
// clears the threshold AND the reverse match agrees, otherwise the
// analyst abstains. Each sweep examines EVERY unmapped cluster with the
// complete current state — acceptance is global, not a walk along
// adjacent edges — and each acceptance changes the scores the next
// sweep sees.
//
// Honesty rules, per the numeric policy: scores, ranks and
// eccentricities are shown as what they are — never normalized into
// probabilities (the paper itself declined probabilistic mappings).
// False acceptances are possible and stay visible; abstention is a
// first-class outcome. And N–S propagation is one inspectable,
// source-grounded way to synthesize evidence — the concrete approach
// the paper identified for the sparse regime — not the definition or
// ceiling of what a capable adversary can do.
//
// Deviations from the paper, disclosed:
//   - Eccentricity domain: the paper's listing initializes a zero
//     score for EVERY right-graph node, so σ includes those zeros. We
//     compute over the unmapped candidates (§5.2's prose scopes the
//     step to unmapped nodes, and mapped images can never score);
//     zeros are padded to that domain. Positive-only σ — an earlier
//     draft here — is a different statistic, systematically biased
//     toward ACCEPTANCE in the sparse regime.
//   - Both graphs are undirected here; the paper's are directed.
//   - Edge weights define adjacency only; the damping uses degree.
//   - Nodes are examined in graph order and acceptances apply
//     mid-sweep, so the outcome is order-dependent (the paper's
//     iteration shares that property).
//   - theta = 1.5 is this demonstration's choice; the paper explores
//     thresholds rather than fixing one.
//   - The paper's revisiting of already-accepted mappings is omitted
//     at this scale (seeds are ground truth here and sweeps are few).
import { type Chain, type CoinId } from "../model/chain";
import { type Clustering } from "./clusters";
import { type Edge } from "../scenario/cast";

/** an undirected weighted graph over node ids */
export interface WGraph {
  nodes: string[];
  /** node -> neighbor -> weight */
  adj: Map<string, Map<string, number>>;
}

function addEdge(g: WGraph, a: string, b: string, w: number): void {
  if (a === b || w <= 0) return;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    let m = g.adj.get(x);
    if (!m) { m = new Map(); g.adj.set(x, m); }
    m.set(y, (m.get(y) ?? 0) + w);
  }
}

function ensureNode(g: WGraph, n: string): void {
  if (!g.adj.has(n)) { g.adj.set(n, new Map()); g.nodes.push(n); }
}

/**
 * The observer's pseudonym graph: nodes are the non-singleton clusters
 * of `cl` (named by representative coin), and an edge joins two
 * clusters whenever a transaction spends coins of one and creates
 * coins of the other — a visible payment between pseudonyms. Weight
 * counts such transactions. Built from the public chain alone.
 *
 * Singleton clusters are excluded as a MODEL CHOICE, not by the
 * paper's warrant: §4.5's "no hope for singletons" covers degree-zero
 * nodes, and a one-coin cluster does have payment edges. The reason
 * here is scale — at toy size, hundreds of one-coin pseudonyms with a
 * single edge each would drown the demonstration in no-signal
 * abstentions without changing any acceptance. What is discarded with
 * them: the payments into and out of those single coins. Read the
 * sweep's abstention counts knowing those edges are not on the board.
 */
export function targetGraph(chain: Chain, cl: Clustering): WGraph {
  const g: WGraph = { nodes: [], adj: new Map() };
  const clusterOf = (id: CoinId): string | null => {
    const r = cl.rep.get(id);
    if (r === undefined) return null;
    return cl.members.get(r)!.length >= 2 ? r : null;
  };
  for (const r of cl.members.keys()) {
    if (cl.members.get(r)!.length >= 2) ensureNode(g, r);
  }
  for (const tx of chain.txs.values()) {
    const from = new Set(tx.inputs.map(clusterOf).filter((x): x is string => x !== null));
    const to = new Set(tx.outputs.map(clusterOf).filter((x): x is string => x !== null));
    for (const f of from) {
      for (const t of to) {
        if (f !== t) addEdge(g, f, t, 1);
      }
    }
  }
  return g;
}

/**
 * The auxiliary graph: recurring relationships, weighted by obligation
 * rate. What to pass matters: the paper's auxiliary graph comes from a
 * different, imperfect source, and propagation has to work despite the
 * mismatch — so an analyst's aux graph is built from a DEGRADED edge
 * list (see synthesisStaging's outsiderEdges), never the cast's own.
 * Passing the full list models an insider who knows every arrangement.
 */
export function auxGraph(edges: Edge[], agents: number[]): WGraph {
  const g: WGraph = { nodes: [], adj: new Map() };
  for (const u of agents) ensureNode(g, String(u));
  for (const e of edges) {
    addEdge(g, String(e.payer), String(e.payee), e.rate ?? 1);
  }
  return g;
}

/** the verdict for one examined node in a sweep */
export interface NodeVerdict {
  node: string;
  /** candidates ranked by score, best first (score shown as-is) */
  ranked: { candidate: string; score: number }[];
  /** (max − max₂)/σ over the zero-padded candidate domain (every
   *  unmapped candidate counts, non-scoring ones as zeros); NaN when
   *  the domain has fewer than two candidates */
  eccentricity: number;
  outcome:
    | { kind: "accepted"; mapped: string }
    | { kind: "abstained"; reason: "no-signal" | "below-threshold" | "reverse-mismatch" };
}

export interface SweepResult {
  /** every unmapped node examined this sweep, in graph order */
  verdicts: NodeVerdict[];
  /** the mappings accepted this sweep (node -> aux node) */
  accepted: Map<string, string>;
}

/** (max − max₂)/σ, the paper's standout measure, computed over the
 *  full candidate domain: `domain` is the number of unmapped candidate
 *  nodes, and non-scoring candidates count as zeros (the paper's
 *  listing initializes a zero score per node; σ includes those zeros).
 *  A single positive score among zeros thus earns a finite, honest
 *  eccentricity — no special case. With fewer than two candidates in
 *  the domain there is nothing to stand out against: NaN. */
function eccentricity(scores: number[], domain: number): number {
  if (domain < 2) return NaN;
  const padded = [...scores];
  while (padded.length < domain) padded.push(0);
  const max = Math.max(...padded);
  const rest = [...padded];
  rest.splice(rest.indexOf(max), 1);
  const max2 = Math.max(...rest);
  const mean = padded.reduce((a, b) => a + b, 0) / padded.length;
  const sd = Math.sqrt(padded.reduce((a, b) => a + (b - mean) ** 2, 0) / padded.length);
  return sd === 0 ? 0 : (max - max2) / sd;
}

/** score every unmapped `to`-node as a candidate image of `n`:
 *  each mapped neighbor of `n` whose image neighbors the candidate
 *  contributes, damped by the image's degree (√deg, as in the paper —
 *  a busy hub says less about any one neighbor) */
function matchScores(
  n: string,
  from: WGraph,
  to: WGraph,
  mapping: Map<string, string>,
  mappedImages: Set<string>,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [nbr] of from.adj.get(n) ?? []) {
    const image = mapping.get(nbr);
    if (image === undefined) continue;
    for (const [cand] of to.adj.get(image) ?? []) {
      if (mappedImages.has(cand)) continue;
      const damp = Math.sqrt(to.adj.get(cand)!.size || 1);
      scores.set(cand, (scores.get(cand) ?? 0) + 1 / damp);
    }
  }
  return scores;
}

/**
 * One global sweep of N–S-style propagation: examine every unmapped
 * target node against the complete current state, accept the mappings
 * that clear the eccentricity threshold and the reverse match, abstain
 * on the rest. Call again to let the accepted mappings re-score the
 * remainder; a step may accept nothing (a stall is a real outcome).
 * `theta` is the eccentricity threshold; the paper's revisiting of
 * already-accepted mappings is omitted at this scale (seeds are ground
 * truth here and sweeps are few).
 */
export function propagationStep(
  target: WGraph,
  aux: WGraph,
  mapping: Map<string, string>,
  theta = 1.5,
): SweepResult {
  const verdicts: NodeVerdict[] = [];
  const accepted = new Map<string, string>();
  const work = new Map(mapping);
  const images = new Set(work.values());
  const inverse = new Map<string, string>();
  for (const [k, v] of work) inverse.set(v, k);

  for (const node of target.nodes) {
    if (work.has(node)) continue;
    const scores = matchScores(node, target, aux, work, images);
    const ranked = [...scores.entries()]
      .map(([candidate, score]) => ({ candidate, score }))
      .sort((a, b) => b.score - a.score || (a.candidate < b.candidate ? -1 : 1));
    const domain = aux.nodes.filter((n) => !images.has(n)).length;
    const ecc = eccentricity(ranked.map((r) => r.score), domain);
    const verdict = (outcome: NodeVerdict["outcome"]): void => {
      verdicts.push({ node, ranked, eccentricity: ecc, outcome });
    };
    if (ranked.length === 0) { verdict({ kind: "abstained", reason: "no-signal" }); continue; }
    if (!(ecc >= theta)) { verdict({ kind: "abstained", reason: "below-threshold" }); continue; }
    const best = ranked[0]!.candidate;
    // reverse match: map the candidate back and demand it lands here
    const back = matchScores(best, aux, target, inverse, new Set(inverse.values()));
    const backRanked = [...back.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const backDomain = target.nodes.filter((n) => !work.has(n)).length;
    const backEcc = eccentricity(backRanked.map(([, s]) => s), backDomain);
    if (backRanked.length === 0 || backRanked[0]![0] !== node || !(backEcc >= theta)) {
      verdict({ kind: "abstained", reason: "reverse-mismatch" });
      continue;
    }
    verdict({ kind: "accepted", mapped: best });
    accepted.set(node, best);
    work.set(node, best);
    images.add(best);
    inverse.set(best, node);
  }
  return { verdicts, accepted };
}
