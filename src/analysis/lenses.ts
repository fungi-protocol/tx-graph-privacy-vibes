// The non-observer cluster constructors (#122b): the partitions the
// other lenses contract to — singletons (the bare structure), the true
// by-owner partition (the all-seeing lens), and one participant's
// knowledge — assembled into the same Clustering shape the observer's
// pipeline emits, so every view speaks one vocabulary.
import { type Chain, type CoinId } from "../model/chain";
import { type Clustering } from "./observer";

/** assemble a Clustering from a coin -> group assignment; coins keyed
 *  null stay singletons. Rank is by size, as in the observer's map. */
function partitionBy(chain: Chain, keyOf: (id: CoinId) => string | null): Clustering {
  const groups = new Map<string, CoinId[]>();
  const rep = new Map<CoinId, CoinId>();
  const members = new Map<CoinId, CoinId[]>();
  for (const id of chain.coins.keys()) {
    const key = keyOf(id);
    if (key === null) {
      rep.set(id, id);
      members.set(id, [id]);
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(id);
    else groups.set(key, [id]);
  }
  for (const g of groups.values()) {
    const r = g[0]!;
    members.set(r, g);
    for (const id of g) rep.set(id, r);
  }
  const ranked = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<CoinId, number>();
  ranked.forEach(([r], i) => rank.set(r, i + 1));
  return { rep, members, rank, changeGuess: new Map(), payGuess: new Map(), changeReads: new Map(), links: [] };
}

/**
 * The bottom of the partition refinement lattice: every coin its own
 * vertex, nothing linked — the coin graph itself, dressed as a cluster
 * graph. Every lens's partition refines down to this, so it is the
 * natural waypoint for animating between the transaction graph and any
 * clustered view.
 */
export function clusterSingletons(chain: Chain): Clustering {
  return partitionBy(chain, () => null);
}

/**
 * The true wallet partition — what the all-seeing lens contracts to: one
 * vertex per person (the doc's user graph, reached by edge contraction),
 * every one of them labeled, plus a single vertex for the outside world's
 * merchants. No heuristics, no gray unknowns: this is the ground truth
 * the observer's pseudonym graph is trying to approximate.
 */
export function clusterByOwner(chain: Chain): Clustering {
  return partitionBy(chain, (id) => {
    const o = chain.coins.get(id)!.owner;
    return o === null ? "x" : `u${o}`;
  });
}

/**
 * One participant's contraction of the graph: coins they can attribute
 * fuse per believed owner — direct evidence (fixed points) and
 * cluster-propagated guesses kept apart, a suspicion is not a fact —
 * and everything else stays an anonymous singleton, exactly as blind as
 * the bare structure.
 */
export function clusterByKnowledge(
  chain: Chain,
  attributions: Map<CoinId, { owner: number | null; direct: boolean }>,
): Clustering {
  return partitionBy(chain, (id) => {
    const a = attributions.get(id);
    return a ? `${a.owner === null ? "x" : a.owner}/${a.direct ? "k" : "g"}` : null;
  });
}
