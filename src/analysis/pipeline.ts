// The one road every heavy analysis takes (#84): a pure function from
// the visible chain and the observer's knob settings to the results the
// display memoizes — the base clustering, the knowledge-grant state, the
// two propagation matchers' runs, and the weld grading. main.ts runs it
// synchronously when the results are cheap or already cached; the
// analysis worker runs the very same code off the main thread when they
// are not. Keeping both callers on one function is the point: the worker
// can never drift from what the page would have computed itself.
import { type Chain, type CoinId, type Owner, type TxId } from "../model/chain";
import { clusterObserver, gradeWelds, type Clustering, type Heuristics, type Mistake } from "./clusters";
import { observerGrants, grantAttribution, grantMerges, clusterGrantOwners } from "./auxinfo";
import { nsSocialRun, nsApply, type NsEvent } from "./nssocial";
import { nfRun, type NfEvent } from "./nsnetflix";
import { type Attribution } from "./knowledge";

/** the observer-map knobs, already resolved to what clusterObserver
 *  reads: the caller settles its own defaults (the CIOH cap's "off"
 *  position, the evidence bar's floor) before handing them over */
export interface AnalysisKnobs {
  reuse: boolean;
  cioh: boolean;
  change: boolean;
  subsum: boolean;
  /** repeated co-membership: inputs of a coinjoin-shaped transaction
   *  issued by one earlier coinjoin-shaped transaction read as one
   *  participant's, and count as one combined input in the
   *  sub-transaction search */
  remeet: boolean;
  /** absent = no cap */
  ciohMaxInputs?: number;
  /** absent = a single tell decides */
  changeEvidence?: number;
  /** absent = all tells enabled */
  changeTells?: number;
  /** the statistical-fingerprinting knob's intra-transaction reading:
   *  divergent input fingerprints veto the one-owner welds */
  fingerprints?: boolean;
  kycObs: boolean;
  auxFrac: number;
}

/** which downstream results the caller needs beyond the base map */
export interface AnalysisWants {
  ns: { threshold: number; parts: number } | null;
  nf: {
    threshold: number;
    /** whether the matcher's base has the ns-social replay applied —
     *  the caller's nsActive(), which the worker cannot know itself */
    applyNs: boolean;
    /** the replay position; pass Infinity for "the whole run" when the
     *  caller is about to pin its cursor to the end */
    nsCursor: number;
    nsManual: NsEvent[];
  } | null;
  mistakes: boolean;
}

export interface GrantResults {
  attr: Map<CoinId, Attribution>;
  owners: Map<CoinId, Owner>;
  fused: Clustering;
}

export interface AnalysisBundle {
  cl: Clustering;
  /** the granted set itself; null when no grant is in force */
  grantMap: Map<CoinId, Owner> | null;
  grant: GrantResults | null;
  nsEvents: NsEvent[] | null;
  nfEvents: NfEvent[] | null;
  mistakes: Map<TxId, Mistake[]> | null;
}

/** the Heuristics options exactly as main.ts's clustering() spreads
 *  them — shared so the sync path and the worker cannot disagree */
export function observerOpts(
  knobs: AnalysisKnobs,
  grants: Map<CoinId, Owner> | null,
): Heuristics {
  return {
    reuse: knobs.reuse,
    cioh: knobs.cioh,
    change: knobs.change,
    subsum: knobs.subsum,
    remeet: knobs.remeet,
    ...(knobs.ciohMaxInputs !== undefined ? { ciohMaxInputs: knobs.ciohMaxInputs } : {}),
    ...(knobs.changeEvidence !== undefined ? { changeEvidence: knobs.changeEvidence } : {}),
    ...(knobs.changeTells !== undefined ? { changeTells: knobs.changeTells } : {}),
    ...(knobs.fingerprints ? { fingerprints: true } : {}),
    ...(grants ? { grants } : {}),
  };
}

export function runAnalysis(
  chain: Chain,
  priceAt: ((day: number) => number | undefined) | undefined,
  seed: string,
  knobs: AnalysisKnobs,
  wants: AnalysisWants,
): AnalysisBundle {
  const grantMap = knobs.kycObs || knobs.auxFrac > 0
    ? observerGrants(chain, seed, knobs.auxFrac, knobs.kycObs)
    : null;
  const cl = clusterObserver(chain, priceAt, observerOpts(knobs, grantMap));
  const grant: GrantResults | null = grantMap
    ? {
        attr: grantAttribution(grantMap, cl),
        owners: clusterGrantOwners(grantMap, cl),
        fused: nsApply(cl, grantMerges(grantMap, cl)),
      }
    : null;
  const base = grant ? grant.fused : cl;
  const nsEvents = wants.ns
    ? nsSocialRun(base, chain, wants.ns.threshold, wants.ns.parts)
    : null;
  let nfEvents: NfEvent[] | null = null;
  if (wants.nf) {
    let nfBase = base;
    if (wants.nf.applyNs && nsEvents) {
      // the same prefix-plus-live-manual composition as main.ts's
      // nsEvents(): stale manual entries drop out silently
      const cut = Math.min(wants.nf.nsCursor, nsEvents.length);
      const live = wants.nf.nsManual.filter(
        (e) => base.members.has(e.a) && base.members.has(e.b));
      nfBase = nsApply(base, [...nsEvents.slice(0, cut), ...live]);
    }
    nfEvents = nfRun(nfBase, chain, wants.nf.threshold);
  }
  const mistakes = wants.mistakes ? gradeWelds(chain, cl.welds) : null;
  return { cl, grantMap, grant, nsEvents, nfEvents, mistakes };
}
