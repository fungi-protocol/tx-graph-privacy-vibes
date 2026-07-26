// Tracing with per-lens semantics. Two questions get answered at once and
// drawn as tiers: what pasts could these funds have (the light cone — the
// union of apparent ancestries, partly lit) and what does the viewer's
// knowledge single out within or beyond it (fully lit, ringed when the
// two differ). What "single out" means depends on who is looking:
//
// - Ground truth (all-seeing): the true causal flow of funds — from each
//   output, only the producing transaction's inputs owned by whoever
//   actually funded it. The truth is one path structure within the cloud
//   of apparent paths, which is the whole lesson of the lens.
// - Third-party observer: candidate origins are not coins but clusters.
//   Tracing several coins together intersects the cluster sets their
//   cones touch, and every member coin of a surviving cluster is a
//   candidate — the sense in which Goldfeder et al. define intersection
//   attacks on coinjoins. Cluster members can lie outside the union of
//   cones, so `full` is NOT always a subset of `partial`.
// - A participant (or anyone without clustering): coins intersect
//   coin-wise — origins every traced coin could descend from.
//
// A single traced coin has only one apparent set, so there is nothing to
// intersect or union: for the observer and participant lenses `full`
// degenerates to the seed itself, while ground truth still shows the true
// flow within the cone.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { ancestry, trueFlow, type Ancestry } from "./ancestry";
import { type Clustering } from "./clusters";

export interface Trace {
  /** what the viewer's knowledge singles out: fully lit, ringed when it
   *  differs from partial. Usually within partial, but an observer's
   *  cluster expansion can reach coins outside every traced cone. */
  full: Ancestry;
  /** the union of the traced coins' light cones: partly lit */
  partial: Ancestry;
}

export interface TraceOptions {
  /** ground truth: full = the union of the seeds' true flows */
  truth?: boolean;
  /** observer knowledge: intersect cluster-wise and expand to members */
  cl?: Clustering;
}

/** Trace several coins together under one lens's knowledge. */
export function traceCoins(chain: Chain, seeds: CoinId[], opts: TraceOptions = {}): Trace {
  const cones = seeds.map((s) => ancestry(chain, s));
  const partial: Ancestry = { coins: new Set(), txs: new Set() };
  for (const t of cones) {
    for (const c of t.coins) partial.coins.add(c);
    for (const x of t.txs) partial.txs.add(x);
  }

  if (opts.truth) {
    const full: Ancestry = { coins: new Set(), txs: new Set() };
    for (const s of seeds) {
      const flow = trueFlow(chain, s);
      for (const c of flow.coins) full.coins.add(c);
      for (const x of flow.txs) full.txs.add(x);
    }
    return { full, partial };
  }

  const full: Ancestry = { coins: new Set(seeds), txs: new Set() };
  if (cones.length <= 1) return { full, partial }; // one set: nothing to intersect

  if (opts.cl) {
    // cluster-wise: which clusters does every traced cone touch? every
    // member of a surviving cluster is a candidate origin, whether or
    // not any cone reaches it
    const cl = opts.cl;
    const repsOf = (t: Ancestry): Set<CoinId> => {
      const reps = new Set<CoinId>();
      for (const c of t.coins) reps.add(cl.rep.get(c) ?? c);
      return reps;
    };
    const repSets = cones.map(repsOf);
    const shared = [...repSets[0]!].filter((r) => repSets.every((s) => s.has(r)));
    for (const r of shared) {
      for (const c of cl.members.get(r) ?? [r]) {
        if (chain.coins.has(c)) full.coins.add(c);
      }
    }
  } else {
    for (const c of cones[0]!.coins) {
      if (cones.every((t) => t.coins.has(c))) full.coins.add(c);
    }
  }
  for (const x of cones[0]!.txs) {
    if (cones.every((t) => t.txs.has(x))) full.txs.add(x);
  }
  return { full, partial };
}

/** Trace all of a transaction's inputs together (plus the tx itself). */
export function traceTx(chain: Chain, tid: TxId, opts: TraceOptions = {}): Trace {
  const t = traceCoins(chain, chain.txs.get(tid)?.inputs ?? [], opts);
  t.full.txs.add(tid);
  t.partial.txs.add(tid);
  return t;
}
