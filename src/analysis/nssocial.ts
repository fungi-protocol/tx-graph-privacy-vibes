// Narayanan–Shmatikov-style social-network analysis over the contracted
// cluster graph (De-anonymizing Social Networks, 2009). The original
// setting matches two different graphs of the same people — an anonymous
// one and an auxiliary one — by structure alone: nodes whose neighbors
// map to each other are probably the same person. Here the observer
// plays that game against their own record (#131, writeup :593-605):
// the TRANSACTION history is cut into contiguous epochs and each
// epoch's subgraph is contracted separately, so every epoch presents a
// somewhat different view of the pseudonym graph. A cluster active in
// several epochs appears in several views, and the observer's own
// clustering already links those appearances — the epoch-spanning
// clusters are the SEEDS the propagation grows from (KYC-grant fusions
// ride in the same way, through the base clustering). The algorithm
// then asks which vertex of one epoch's view is the same entity as a
// vertex of another, scoring candidate pairs by how much their
// per-epoch neighborhoods agree once seeds and prior matches are taken
// into account. A match is a claim of shared ownership, so accepting
// one MERGES the two clusters. The iteration revisits its own
// conclusions: a merge changes every neighborhood it touches, so later
// sweeps can push a previously accepted pair back below the threshold
// and split it apart again.
//
// The propagation works on the cartesian product of the per-epoch
// component profiles — O((n·k)²) score evaluations per sweep.
// Acceptance is the paper's own gate (see matching.ts, the #112
// criterion registered with the reviewers): a pair is accepted only
// when the two sides are each other's unique best partner AND each
// best stands clear of its runner-up by the eccentricity bar. All of a
// sweep's decisions are made against the sweep-start state and applied
// together, so the accepted match set is a pure function of the
// scores — representative labels and evaluation order never enter it,
// and label/order-sensitive candidates (exact ties, flat score sets)
// abstain.
//
// Match decisions are their own typed records (NsEvent), NOT Links: the
// link ledger holds single-transaction observations, while a match rests
// on the whole shape of the graph and can be retracted.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Clustering } from "./clusters";
import { acceptReciprocal, type ScoredPair } from "./matching";

/** one step of the propagation, replayable and undoable: a merge maps
 *  two cluster-graph vertices to one entity, a split retracts a merge
 *  the evidence no longer supports */
export interface NsEvent {
  kind: "merge" | "split";
  /** the two BASE cluster representatives the step joins or parts */
  a: CoinId;
  b: CoinId;
  /** the similarity score the step was decided on */
  score: number;
  /** true when a user accepted a pair the threshold alone would not
   *  admit — recorded so the display can say so */
  forced?: boolean;
}

/**
 * The partition strategy: split the cluster-graph vertices into `parts`
 * contiguous runs of the timeline (each vertex placed by its cluster's
 * earliest coin). Two parts read as "match the later epoch's pseudonyms
 * against the earlier one's" — the auxiliary-graph story told inside a
 * single chain. Returns rep -> column index (0-based).
 */
export function partitionColumns(
  cl: Clustering,
  chain: Chain,
  parts: number,
): Map<CoinId, number> {
  const day = (id: CoinId): number => {
    const c = chain.coins.get(id)!;
    return c.producer ? chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const reps = [...cl.members.keys()];
  const earliest = new Map<CoinId, number>();
  // same-day ties break on the cluster's smallest member id: a property
  // of the member SET, so the column assignment cannot shift when a
  // cluster is renamed after a different representative (#112 gate)
  const anchor = new Map<CoinId, CoinId>();
  for (const rep of reps) {
    let e = Infinity;
    let lo = rep;
    for (const id of cl.members.get(rep)!) {
      e = Math.min(e, day(id));
      if (id < lo) lo = id;
    }
    earliest.set(rep, e);
    anchor.set(rep, lo);
  }
  reps.sort((a, b) =>
    earliest.get(a)! - earliest.get(b)! || (anchor.get(a)! < anchor.get(b)! ? -1 : 1));
  const k = Math.max(1, Math.floor(parts));
  const out = new Map<CoinId, number>();
  reps.forEach((rep, i) =>
    out.set(rep, Math.min(k - 1, Math.floor((i * k) / Math.max(1, reps.length)))));
  return out;
}

/** weighted adjacency of the contracted graph: one edge per transaction
 *  output whose source vertex differs, counted in both directions —
 *  the same multigraph the ring layout seriates by */
export function clusterAdjacency(
  cl: Clustering,
  chain: Chain,
): Map<CoinId, Map<CoinId, number>> {
  const adj = new Map<CoinId, Map<CoinId, number>>();
  const bump = (a: CoinId, b: CoinId): void => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    // a refined partition can leave a transaction's inputs in several
    // clusters (sub-transaction readings, CIOH abstentions): every
    // distinct input cluster funds the outputs, not just inputs[0]'s
    const froms = new Set<CoinId>();
    for (const i of tx.inputs) froms.add(cl.rep.get(i)!);
    for (const out of tx.outputs) {
      const to = cl.rep.get(out)!;
      for (const from of froms) {
        if (to === from) continue;
        bump(from, to);
        bump(to, from);
      }
    }
  }
  return adj;
}

/** deterministic epoch assignment (#131): the transaction history in
 *  chain order, cut into `parts` equal-count runs — balanced by
 *  activity, contiguous in time, and free of any labeling choice */
export function txEpochs(chain: Chain, parts: number): Map<TxId, number> {
  const k = Math.max(1, Math.floor(parts));
  const n = Math.max(1, chain.order.length);
  const out = new Map<TxId, number>();
  chain.order.forEach((tid, i) => out.set(tid, Math.min(k - 1, Math.floor((i * k) / n))));
  return out;
}

/** the writeup's "contract each subgraph separately" (#131): one
 *  weighted adjacency per epoch, holding only that epoch's
 *  transactions' edges (same multi-input rule as clusterAdjacency). A
 *  cluster active in several epochs appears in several maps — those
 *  are the epoch-spanning vertices whose known correspondence seeds
 *  the propagation. */
export function epochAdjacency(
  cl: Clustering,
  chain: Chain,
  epochOf: Map<TxId, number>,
  parts: number,
): Map<CoinId, Map<CoinId, number>>[] {
  const k = Math.max(1, Math.floor(parts));
  const adjs: Map<CoinId, Map<CoinId, number>>[] = [];
  for (let e = 0; e < k; e++) adjs.push(new Map());
  const bump = (adj: Map<CoinId, Map<CoinId, number>>, a: CoinId, b: CoinId): void => {
    let m = adj.get(a);
    if (!m) adj.set(a, (m = new Map()));
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const tid of chain.order) {
    const adj = adjs[epochOf.get(tid)!]!;
    const tx = chain.txs.get(tid)!;
    const froms = new Set<CoinId>();
    for (const i of tx.inputs) froms.add(cl.rep.get(i)!);
    for (const out of tx.outputs) {
      const to = cl.rep.get(out)!;
      for (const from of froms) {
        if (to === from) continue;
        bump(adj, from, to);
        bump(adj, to, from);
      }
    }
  }
  return adjs;
}

/** the match state at any point of a replay: which merges are active */
export function activePairs(events: NsEvent[]): [CoinId, CoinId][] {
  const key = (a: CoinId, b: CoinId): string => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const on = new Map<string, [CoinId, CoinId]>();
  for (const e of events) {
    if (e.kind === "merge") on.set(key(e.a, e.b), [e.a, e.b]);
    else on.delete(key(e.a, e.b));
  }
  return [...on.values()];
}

/** connected components over the active merge edges: rep -> component
 *  leader (smallest member id). Vertices without matches lead themselves. */
export function matchComponents(
  reps: Iterable<CoinId>,
  pairs: [CoinId, CoinId][],
): Map<CoinId, CoinId> {
  const parent = new Map<CoinId, CoinId>();
  const find = (x: CoinId): CoinId => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const [a, b] of pairs) {
    if (parent.get(a) === undefined) parent.set(a, a);
    if (parent.get(b) === undefined) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const out = new Map<CoinId, CoinId>();
  for (const rep of reps) out.set(rep, parent.get(rep) === undefined ? rep : find(rep));
  return out;
}

/**
 * The similarity score, in [0, 1]: cosine over the two sides' weighted
 * neighbor vectors, with every neighbor read through the current match
 * state (matched clusters count as ONE coordinate — this is what makes
 * the propagation iterative: each accepted match sharpens the score of
 * the pairs around it). The two sides themselves are excluded from the
 * vectors, so a direct transfer between them is not self-evidence.
 * `sideOf` maps a base rep to its side's component leader; pass the
 * leaders of the two candidate components as `a` and `b`.
 */
export function nsSimilarity(
  adj: Map<CoinId, Map<CoinId, number>>,
  comp: Map<CoinId, CoinId>,
  membersOf: (leader: CoinId) => CoinId[],
  a: CoinId,
  b: CoinId,
): number {
  const vector = (leader: CoinId): Map<CoinId, number> => {
    const v = new Map<CoinId, number>();
    for (const rep of membersOf(leader)) {
      const nbrs = adj.get(rep);
      if (!nbrs) continue;
      for (const [o, w] of nbrs) {
        const c = comp.get(o) ?? o;
        if (c === a || c === b) continue;
        v.set(c, (v.get(c) ?? 0) + w);
      }
    }
    return v;
  };
  const va = vector(a), vb = vector(b);
  let dot = 0, na = 0, nb = 0;
  for (const w of va.values()) na += w * w;
  for (const w of vb.values()) nb += w * w;
  if (na === 0 || nb === 0) return 0;
  for (const [k, w] of va) {
    const u = vb.get(k);
    if (u !== undefined) dot += w * u;
  }
  return dot / Math.sqrt(na * nb);
}

/** everything a replay position needs to score further pairs: the
 *  component map and the members of each component */
export function matchState(
  cl: Clustering,
  events: NsEvent[],
): { comp: Map<CoinId, CoinId>; membersOf: (leader: CoinId) => CoinId[] } {
  const comp = matchComponents(cl.members.keys(), activePairs(events));
  const byLeader = new Map<CoinId, CoinId[]>();
  for (const [rep, leader] of comp) {
    const g = byLeader.get(leader);
    if (g) g.push(rep);
    else byLeader.set(leader, [rep]);
  }
  return { comp, membersOf: (leader) => byLeader.get(leader) ?? [leader] };
}

/** everything one run position needs to score candidates: the
 *  per-(component, epoch) neighbor vectors, neighbors read through the
 *  current match state. A component's epoch-e vector sums its base
 *  reps' epoch-e edges; components silent in an epoch have no vector
 *  there. */
function epochProfiles(
  adjs: Map<CoinId, Map<CoinId, number>>[],
  comp: Map<CoinId, CoinId>,
  membersOf: (leader: CoinId) => CoinId[],
): Map<CoinId, (Map<CoinId, number> | null)[]> {
  const leaders = [...new Set(comp.values())].sort();
  const out = new Map<CoinId, (Map<CoinId, number> | null)[]>();
  for (const l of leaders) {
    const perEpoch: (Map<CoinId, number> | null)[] = [];
    for (const adj of adjs) {
      let v: Map<CoinId, number> | null = null;
      for (const rep of membersOf(l)) {
        const nbrs = adj.get(rep);
        if (!nbrs) continue;
        if (!v) v = new Map();
        for (const [o, w] of nbrs) {
          const c = comp.get(o) ?? o;
          v.set(c, (v.get(c) ?? 0) + w);
        }
      }
      perEpoch.push(v);
    }
    out.set(l, perEpoch);
  }
  return out;
}

/** cosine of two epoch profiles with the two candidate components
 *  excluded from both — a direct transfer between the candidates is
 *  not self-evidence, exactly as in nsSimilarity */
function profileCosine(
  va: Map<CoinId, number>,
  vb: Map<CoinId, number>,
  a: CoinId,
  b: CoinId,
): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, w] of va) {
    if (k === a || k === b) continue;
    na += w * w;
    const u = vb.get(k);
    if (u !== undefined) dot += w * u;
  }
  for (const [k, w] of vb) {
    if (k === a || k === b) continue;
    nb += w * w;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** one scoring rule for accept and keep alike, so the two can never
 *  drift apart: every cross-epoch profile pair of distinct components,
 *  gate-keyed by "epoch:leader" */
function makeScoredUnder(
  adjs: Map<CoinId, Map<CoinId, number>>[],
  k: number,
): (comp: Map<CoinId, CoinId>, membersOf: (leader: CoinId) => CoinId[]) => ScoredPair[] {
  return (
    comp: Map<CoinId, CoinId>,
    membersOf: (leader: CoinId) => CoinId[],
  ): ScoredPair[] => {
    const prof = epochProfiles(adjs, comp, membersOf);
    const leaders = [...prof.keys()];
    const scored: ScoredPair[] = [];
    for (let i = 0; i < leaders.length - 1; i++) {
      for (let j = i + 1; j < leaders.length; j++) {
        const a = leaders[i]!, b = leaders[j]!;
        const pa = prof.get(a)!, pb = prof.get(b)!;
        for (let e = 0; e < k; e++) {
          for (let f = 0; f < k; f++) {
            if (e === f) continue;
            const va = pa[e], vb = pb[f];
            if (!va || !vb) continue;
            const s = profileCosine(va, vb, a, b);
            if (s > 0) scored.push({ a: `${e}:${a}`, b: `${f}:${b}`, score: s });
          }
        }
      }
    }
    return scored;
  };
}

/** an accepted gate pair names two per-epoch profiles; the component
 *  leaders behind them are the merge claim */
const leaderOf = (key: string): CoinId => key.slice(key.indexOf(":") + 1) as CoinId;

/** the split pass: every active match re-judged as if still open, all
 *  against the same start state, splits applied together. A kept
 *  match must clear the FULL gate against the current alternatives —
 *  through ANY cross-epoch profile pair — exactly as a new match would. */
function makeSplitPass(
  cl: Clustering,
  adjs: Map<CoinId, Map<CoinId, number>>[],
  k: number,
  threshold: number,
): (active: [CoinId, CoinId][]) => NsEvent[] {
  const scoredUnder = makeScoredUnder(adjs, k);
  return (active: [CoinId, CoinId][]): NsEvent[] => {
    const splits: NsEvent[] = [];
    for (const [a, b] of active) {
      const others = active.filter(([x, y]) => !(x === a && y === b) && !(x === b && y === a));
      const compWo = matchComponents(cl.members.keys(), others);
      const byLeader = new Map<CoinId, CoinId[]>();
      for (const [rep, leader] of compWo) {
        const g = byLeader.get(leader);
        if (g) g.push(rep);
        else byLeader.set(leader, [rep]);
      }
      const membersOf = (l: CoinId): CoinId[] => byLeader.get(l) ?? [l];
      const la = compWo.get(a)!, lb = compWo.get(b)!;
      let best = 0;
      let kept = false;
      for (const p of acceptReciprocal(scoredUnder(compWo, membersOf), threshold)) {
        const pa = leaderOf(p.a), pb = leaderOf(p.b);
        if ((pa === la && pb === lb) || (pa === lb && pb === la)) {
          kept = true;
          best = Math.max(best, p.score);
        }
      }
      if (!kept) {
        // the score recorded on the retraction: the pair's best
        // remaining cross-epoch agreement, the value that failed
        for (const p of scoredUnder(compWo, membersOf)) {
          const pa = leaderOf(p.a), pb = leaderOf(p.b);
          if ((pa === la && pb === lb) || (pa === lb && pb === la)) best = Math.max(best, p.score);
        }
        splits.push({ kind: "split", a, b, score: best });
      }
    }
    return splits;
  };
}

/** the splits one split pass would emit from `events`' final state —
 *  empty means the state is stable: no active match the gate would
 *  refuse to re-accept. Exposed so the capped-run exit contract
 *  (accuracy/049) is testable against the public surface. */
export function nsRejudge(
  cl: Clustering,
  chain: Chain,
  threshold: number,
  parts: number,
  events: NsEvent[],
): NsEvent[] {
  const k = Math.max(1, Math.floor(parts));
  const adjs = epochAdjacency(cl, chain, txEpochs(chain, k), k);
  return makeSplitPass(cl, adjs, k, threshold)(activePairs(events));
}

/**
 * The full deterministic run (#131 epoch-correspondence model). Each
 * sweep is decided wholesale against the sweep-start state: first
 * every active match is re-judged as if it were still open (components
 * with only that edge removed) under the SAME acceptance gate a new
 * match must pass — scored against the current alternatives,
 * reciprocal unique best, eccentricity — and all the ones that could
 * not be re-accepted split together (accuracy/048: asymmetric
 * accept/retain criteria would make the fixed point depend on the
 * order evidence arrived, the defect class the #112 criterion bans;
 * the paper's revisitation applies the same match logic when it
 * revises earlier mappings). Then the merge pass scores every
 * CROSS-EPOCH pair of component profiles — (C₁ as epoch e saw it,
 * C₂ as a DIFFERENT epoch e′ saw it), never two views from the same
 * epoch, which is the same record twice, not two views — and the gate
 * (matching.ts) admits its matches together; an accepted profile pair
 * is a claim its two components are one user, so the event stays a
 * merge of base representatives. Repeat until a sweep changes nothing.
 *
 * The dynamics need not have a fixed point: two matches accepted
 * together can each fail the gate once the OTHER is applied (the
 * other's fusion raises a runner-up into contest), so "both matched"
 * and "neither" can alternate forever. When a sweep-start state
 * repeats, the run stops at the just-split state — the matches whose
 * standing depends on which of their competitors is currently applied
 * are exactly the contested ones, and the gate's answer to contest is
 * abstention. And when the sweep budget runs out instead (accuracy/049
 * rider), the run exits through final split passes, so the returned
 * state never holds a match the gate would not re-accept.
 */
export function nsSocialRun(
  cl: Clustering,
  chain: Chain,
  threshold: number,
  parts = 2,
  maxSweeps = 8,
): NsEvent[] {
  const k = Math.max(1, Math.floor(parts));
  const adjs = epochAdjacency(cl, chain, txEpochs(chain, k), k);
  const events: NsEvent[] = [];
  const scoredUnder = makeScoredUnder(adjs, k);
  const splitPass = makeSplitPass(cl, adjs, k, threshold);
  const visited = new Set<string>();
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    const active = activePairs(events);

    // a sweep-start state seen before means the dynamics cycle (merges
    // and splits undoing each other); stop here, on the just-split
    // side of the cycle — contested matches abstain
    const key = active
      .map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`))
      .sort()
      .join(";");
    if (visited.has(key)) break;
    visited.add(key);

    const splits = splitPass(active);
    if (splits.length > 0) {
      events.push(...splits);
      continue; // re-derive the state before merging further
    }

    // merge pass: gate the cross-epoch profile pairs against the
    // sweep-start state, then apply the admitted merges together —
    // several profile pairs may back the same component pair, which
    // merges once, on its best score
    const state = matchState(cl, events);
    const admitted = new Map<string, NsEvent>();
    for (const p of acceptReciprocal(scoredUnder(state.comp, state.membersOf), threshold)) {
      const la = leaderOf(p.a), lb = leaderOf(p.b);
      const [lo, hi] = la < lb ? [la, lb] : [lb, la];
      const prev = admitted.get(`${lo}|${hi}`);
      if (!prev || p.score > prev.score) {
        admitted.set(`${lo}|${hi}`, { kind: "merge", a: lo, b: hi, score: p.score });
      }
    }
    if (admitted.size === 0) break;
    events.push(...[...admitted.keys()].sort().map((kk) => admitted.get(kk)!));
  }
  // exit through split passes (accuracy/049): when the sweep budget ran
  // out mid-flight the last merges were never re-judged, and a cycle
  // stop can in principle land on a state carrying a contested match.
  // Split passes alone are removal-only, so this terminates — and on a
  // state that is already stable (the ordinary fixed-point exit) the
  // first pass is empty. The returned state never holds a match the
  // gate would not re-accept.
  for (;;) {
    const splits = splitPass(activePairs(events));
    if (splits.length === 0) break;
    events.push(...splits);
  }
  return events;
}

/**
 * Apply a replay position to the base clustering: clusters matched by
 * the active merges fuse into one vertex (members concatenated, the
 * smallest representative leads), rank recomputed by size. The link
 * ledger and change guesses pass through untouched — matches are not
 * links, and the base observations still stand on their own.
 *
 * In lattice terms (#125) this is a JOIN: the coarsest partition both
 * the base clustering and the active-pair partition refine — the
 * transitive union of the base's claims with the matcher's. Stacking a
 * matcher on a heuristic clustering composes the same way stacking
 * heuristic checkboxes does. (Pinned against partition.ts's join in
 * the tests; the leader here stays the smallest rep id, a labeling
 * choice the partition itself does not depend on.)
 */
export function nsApply(cl: Clustering, events: NsEvent[]): Clustering {
  const comp = matchComponents(cl.members.keys(), activePairs(events));
  const members = new Map<CoinId, CoinId[]>();
  for (const [rep, own] of cl.members) {
    const leader = comp.get(rep) ?? rep;
    const g = members.get(leader);
    if (g) g.push(...own);
    else members.set(leader, [...own]);
  }
  const rep = new Map<CoinId, CoinId>();
  for (const [leader, ids] of members) {
    ids.sort((a, b) => (a < b ? -1 : 1));
    for (const id of ids) rep.set(id, leader);
  }
  const ranked = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<CoinId, number>();
  ranked.forEach(([r], i) => rank.set(r, i + 1));
  return { rep, members, rank, changeGuess: cl.changeGuess, payGuess: cl.payGuess, changeReads: cl.changeReads, links: cl.links };
}
