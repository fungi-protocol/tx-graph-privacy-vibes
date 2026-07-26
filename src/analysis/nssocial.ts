// Narayanan–Shmatikov-style social-network analysis over the contracted
// cluster graph (De-anonymizing Social Networks, 2009). The original
// setting matches two different graphs of the same people — an anonymous
// one and an auxiliary one — by structure alone: nodes whose neighbors
// map to each other are probably the same person. Here the observer
// plays that game against their own map: the cluster graph is PARTITIONED
// (default: into two halves by time, an earlier and a later epoch), and
// the algorithm asks which vertex in one column is the same entity as a
// vertex in another, scoring candidate pairs by how much their
// neighborhoods agree once prior matches are taken into account. A match
// is a claim of shared ownership, so accepting one MERGES the two
// clusters. The iteration revisits its own conclusions: a merge changes
// every neighborhood it touches, so later sweeps can push a previously
// accepted pair back below the threshold and split it apart again.
//
// The propagation works on the cartesian product of the unmapped nodes —
// O(n²) score evaluations per sweep — and the order of evaluation is in
// principle arbitrary; this implementation fixes a deterministic order
// (sorted representatives, best partner first) so runs replay exactly.
//
// Match decisions are their own typed records (NsEvent), NOT Welds: the
// weld ledger holds single-transaction observations, while a match rests
// on the whole shape of the graph and can be retracted.
import { type Chain, type CoinId } from "../model/chain";
import { type Clustering } from "./clusters";

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
  for (const rep of reps) {
    let e = Infinity;
    for (const id of cl.members.get(rep)!) e = Math.min(e, day(id));
    earliest.set(rep, e);
  }
  reps.sort((a, b) => earliest.get(a)! - earliest.get(b)! || (a < b ? -1 : 1));
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
    const from = cl.rep.get(tx.inputs[0]!)!;
    for (const out of tx.outputs) {
      const to = cl.rep.get(out)!;
      if (to === from) continue;
      bump(from, to);
      bump(to, from);
    }
  }
  return adj;
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

/**
 * The full deterministic run: sweep the cartesian product of unmapped
 * cross-column components, merging every pair whose score clears the
 * threshold (best partner first), then RE-EXAMINE the accepted matches —
 * the merges changed the neighborhoods they were scored in, so a pair
 * that no longer clears the threshold splits back apart. Repeat until a
 * sweep changes nothing (bounded, so a flip-flopping pair cannot spin
 * forever). Components only pair up when their column sets are disjoint:
 * two vertices of one column are two pseudonyms of the SAME epoch, and
 * this analysis has no evidence language for merging those.
 */
export function nsSocialRun(
  cl: Clustering,
  chain: Chain,
  threshold: number,
  parts = 2,
): NsEvent[] {
  const col = partitionColumns(cl, chain, parts);
  const adj = clusterAdjacency(cl, chain);
  const events: NsEvent[] = [];
  const MAX_SWEEPS = 6;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let changed = false;
    const leaders = [...new Set(matchState(cl, events).comp.values())].sort();

    // split pass: every active match rechecked in the current state
    for (const [a, b] of activePairs(events)) {
      // score the pair as if it were still open: components with this
      // edge removed
      const others = activePairs(events).filter(([x, y]) => !(x === a && y === b) && !(x === b && y === a));
      const compWo = matchComponents(cl.members.keys(), others);
      const byLeader = new Map<CoinId, CoinId[]>();
      for (const [rep, leader] of compWo) {
        const g = byLeader.get(leader);
        if (g) g.push(rep);
        else byLeader.set(leader, [rep]);
      }
      const s = nsSimilarity(adj, compWo, (l) => byLeader.get(l) ?? [l], compWo.get(a)!, compWo.get(b)!);
      if (s < threshold) {
        events.push({ kind: "split", a, b, score: s });
        changed = true;
      }
    }
    if (changed) continue; // re-derive the state before merging further

    // merge pass: for each unmapped leader, the best-scoring partner in
    // a column-disjoint component; ties break toward the smaller id
    for (const a of leaders) {
      const state = matchState(cl, events);
      if (state.comp.get(a) !== a) continue; // absorbed by an earlier merge this sweep
      const colsA = new Set(state.membersOf(a).map((r) => col.get(r)!));
      let best: { b: CoinId; s: number } | null = null;
      for (const b of [...new Set(state.comp.values())].sort()) {
        if (b === a || state.comp.get(b) !== b) continue;
        const colsB = new Set(state.membersOf(b).map((r) => col.get(r)!));
        if ([...colsB].some((c) => colsA.has(c))) continue;
        const s = nsSimilarity(adj, state.comp, state.membersOf, a, b);
        if (s >= threshold && (best === null || s > best.s || (s === best.s && b < best.b))) {
          best = { b, s };
        }
      }
      if (best) {
        events.push({ kind: "merge", a, b: best.b, score: best.s });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return events;
}

/**
 * Apply a replay position to the base clustering: clusters matched by
 * the active merges fuse into one vertex (members concatenated, the
 * smallest representative leads), rank recomputed by size. The weld
 * ledger and change guesses pass through untouched — matches are not
 * welds, and the base observations still stand on their own.
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
  return { rep, members, rank, changeGuess: cl.changeGuess, payGuess: cl.payGuess, welds: cl.welds };
}
