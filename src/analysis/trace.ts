// Joint tracing with the corrected highlight semantics: when several
// coins are traced together, the INTERSECTION of their ancestries is the
// interesting part — origins every one of them could descend from — and
// gets full emphasis; the union is context, partly lit; everything else
// is dimmed. Under an observer's eyes the candidate origins are not coins
// but clusters, so the intersection is taken cluster-wise: a cluster
// counts as shared when each traced coin's past touches any coin of it.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { ancestry, type Ancestry } from "./ancestry";
import { type Clustering } from "./clusters";

export interface Trace {
  /** the intersection (plus the traced coins themselves): fully lit */
  full: Ancestry;
  /** the union of all traced ancestries: partly lit; a superset of full */
  partial: Ancestry;
}

/** Trace several coins together; one coin degenerates to its ancestry. */
export function traceCoins(chain: Chain, seeds: CoinId[], cl?: Clustering): Trace {
  const traces = seeds.map((s) => ancestry(chain, s));
  const partial: Ancestry = { coins: new Set(), txs: new Set() };
  for (const t of traces) {
    for (const c of t.coins) partial.coins.add(c);
    for (const x of t.txs) partial.txs.add(x);
  }
  if (traces.length <= 1) {
    return { full: { coins: new Set(partial.coins), txs: new Set(partial.txs) }, partial };
  }

  const full: Ancestry = { coins: new Set(seeds), txs: new Set() };
  if (cl) {
    // cluster-wise: which clusters does every traced past touch?
    const repsOf = (t: Ancestry): Set<CoinId> => {
      const reps = new Set<CoinId>();
      for (const c of t.coins) reps.add(cl.rep.get(c) ?? c);
      return reps;
    };
    const repSets = traces.map(repsOf);
    const shared = [...repSets[0]!].filter((r) => repSets.every((s) => s.has(r)));
    const sharedSet = new Set(shared);
    for (const c of partial.coins) {
      if (sharedSet.has(cl.rep.get(c) ?? c)) full.coins.add(c);
    }
  } else {
    for (const c of traces[0]!.coins) {
      if (traces.every((t) => t.coins.has(c))) full.coins.add(c);
    }
  }
  for (const x of traces[0]!.txs) {
    if (traces.every((t) => t.txs.has(x))) full.txs.add(x);
  }
  return { full, partial };
}

/** Trace all of a transaction's inputs together (plus the tx itself). */
export function traceTx(chain: Chain, tid: TxId, cl?: Clustering): Trace {
  const t = traceCoins(chain, chain.txs.get(tid)?.inputs ?? [], cl);
  t.full.txs.add(tid);
  t.partial.txs.add(tid);
  return t;
}
