// #84: the shared analysis pipeline is exactly the composition main.ts
// used to run inline — the base clustering with the grant read as a
// payment identifier, the grant state compounded over it, the two
// propagation matchers on the fused map, and the link grading. The
// worker and the page both call runAnalysis, so this parity is what
// guarantees a job computed off the main thread installs the same
// results a synchronous toggle would have produced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { runAnalysis, observerOpts, type AnalysisKnobs } from "../src/analysis/pipeline";
import { clusterObserver, gradeLinks, TELL_ALL, TELL_AUX } from "../src/analysis/clusters";
import {
  observerGrants, grantAttribution, grantMerges, clusterGrantOwners,
} from "../src/analysis/auxinfo";
import { nsApply, nsSocialRun, type NsEvent } from "../src/analysis/nssocial";
import { nfRun } from "../src/analysis/nsnetflix";

const SEED = "golden";
function economy(days = 60): Economy {
  const eco = new Economy(SEED);
  eco.runTo(days);
  return eco;
}

const ALL_ON: AnalysisKnobs = {
  reuse: true, cioh: true, change: true, subsum: true, remeet: true,
  kycObs: false, auxFrac: 0,
};

test("plain observer: the bundle's clustering is clusterObserver's, and nothing else is computed", () => {
  const eco = economy();
  const priceAt = (d: number): number | undefined => eco.prices[d];
  const b = runAnalysis(eco.chain, priceAt, SEED, ALL_ON, { ns: null, nf: null, mistakes: false });
  const direct = clusterObserver(eco.chain, priceAt, { reuse: true, cioh: true, change: true, subsum: true });
  assert.deepEqual(b.cl.rep, direct.rep);
  assert.deepEqual(b.cl.links, direct.links);
  assert.equal(b.grantMap, null);
  assert.equal(b.grant, null);
  assert.equal(b.nsEvents, null);
  assert.equal(b.nfEvents, null);
  assert.equal(b.mistakes, null);
});

test("knob translation: caps, bar and tells reach clusterObserver exactly as main.ts spreads them", () => {
  const eco = economy();
  const priceAt = (d: number): number | undefined => eco.prices[d];
  const knobs: AnalysisKnobs = {
    ...ALL_ON, ciohMaxInputs: 3, changeEvidence: 2, changeTells: TELL_ALL & ~TELL_AUX,
  };
  const b = runAnalysis(eco.chain, priceAt, SEED, knobs, { ns: null, nf: null, mistakes: true });
  const direct = clusterObserver(eco.chain, priceAt, {
    reuse: true, cioh: true, change: true, subsum: true,
    ciohMaxInputs: 3, changeEvidence: 2, changeTells: TELL_ALL & ~TELL_AUX,
  });
  assert.deepEqual(b.cl.rep, direct.rep);
  assert.deepEqual(b.mistakes, gradeLinks(eco.chain, direct.links));
});

test("grant + matchers: the same composition, in the same order, on the same fused base", () => {
  const eco = economy();
  const priceAt = (d: number): number | undefined => eco.prices[d];
  const knobs: AnalysisKnobs = { ...ALL_ON, kycObs: true, auxFrac: 0.1 };
  const manual: NsEvent[] = [];
  const b = runAnalysis(eco.chain, priceAt, SEED, knobs, {
    ns: { threshold: 0.5, parts: 2 },
    nf: { threshold: 0.65, applyNs: true, nsCursor: Number.MAX_SAFE_INTEGER, nsManual: manual },
    mistakes: true,
  });
  // the composition main.ts's memo callbacks run
  const grants = observerGrants(eco.chain, SEED, 0.1, true);
  const cl = clusterObserver(eco.chain, priceAt, observerOpts(knobs, grants));
  const fused = nsApply(cl, grantMerges(grants, cl));
  const ns = nsSocialRun(fused, eco.chain, 0.5, 2);
  const nf = nfRun(nsApply(fused, ns), eco.chain, 0.65);
  assert.deepEqual(b.grantMap, grants);
  assert.deepEqual(b.grant!.attr, grantAttribution(grants, cl));
  assert.deepEqual(b.grant!.owners, clusterGrantOwners(grants, cl));
  assert.deepEqual(b.grant!.fused.rep, fused.rep);
  assert.deepEqual(b.nsEvents, ns);
  assert.deepEqual(b.nfEvents, nf);
  assert.deepEqual(b.mistakes, gradeLinks(eco.chain, cl.links));
});

test("nf replay position: a partial ns prefix changes the matcher's base the same way the display's cursor does", () => {
  const eco = economy();
  const priceAt = (d: number): number | undefined => eco.prices[d];
  // threshold 0.3: golden at the app default 0.5 stalls honestly since
  // #132 (every candidate an exact tie), and this test only needs a run
  // long enough to cut a prefix from
  const full = runAnalysis(eco.chain, priceAt, SEED, ALL_ON, {
    ns: { threshold: 0.3, parts: 2 },
    nf: { threshold: 0.65, applyNs: true, nsCursor: Number.MAX_SAFE_INTEGER, nsManual: [] },
    mistakes: false,
  });
  const run = full.nsEvents!;
  assert.ok(run.length >= 2, "the golden economy should yield at least two ns events");
  const cut = 1;
  const partial = runAnalysis(eco.chain, priceAt, SEED, ALL_ON, {
    ns: { threshold: 0.3, parts: 2 },
    nf: { threshold: 0.65, applyNs: true, nsCursor: cut, nsManual: [] },
    mistakes: false,
  });
  const base = clusterObserver(eco.chain, priceAt, observerOpts(ALL_ON, null));
  const expected = nfRun(nsApply(base, run.slice(0, cut)), eco.chain, 0.65);
  assert.deepEqual(partial.nfEvents, expected);
});

test("a truncated chain analyzes like the display's rewound view: same record prefix, same results", () => {
  const eco = economy(60);
  const priceAt = (d: number): number | undefined => eco.prices[d];
  const visible = eco.chain.through(40, Infinity);
  const b = runAnalysis(visible, priceAt, SEED, ALL_ON, { ns: null, nf: null, mistakes: true });
  // an economy only run to day 40 holds the same record (append-only,
  // deterministic), so a worker that ran further and truncated matches
  const shorter = new Economy(SEED);
  shorter.runTo(40);
  const direct = clusterObserver(shorter.chain, (d) => shorter.prices[d], observerOpts(ALL_ON, null));
  assert.deepEqual(b.cl.rep, direct.rep);
  assert.deepEqual(b.mistakes, gradeLinks(shorter.chain, direct.links));
});
