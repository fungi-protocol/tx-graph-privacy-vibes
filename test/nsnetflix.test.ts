import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { clusterObserver } from "../src/analysis/clusters";
import { nfStats, nfSimilarity, nfRun, dayMedians, NF_MIN_SPENDS, type NfStats } from "../src/analysis/nsnetflix";
import { nsApply } from "../src/analysis/nssocial";

function golden(days: number) {
  const eco = new Economy("golden");
  eco.runTo(days);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  return { eco, cl };
}

function synth(over: Partial<NfStats>): NfStats {
  return {
    amounts: new Array(24).fill(0),
    temporal: new Array(8).fill(0),
    drift: new Array(8).fill(0),
    feeAbs: new Array(12).fill(0),
    feeRel: new Array(8).fill(0),
    script: new Array(4).fill(0),
    habits: new Array(4).fill(0),
    spends: 0,
    ...over,
  };
}

test("ns-netflix: matching fee policies agree, clashing ones do not", () => {
  // two Ledgerline-shaped records: every bid in the same premium bucket
  const till1 = synth({ feeRel: [0, 0, 0, 0, 0, 9, 0, 0] });
  const till2 = synth({ feeRel: [0, 0, 0, 0, 0, 5, 0, 0] });
  // a Pelican-shaped record: always under the market
  const miser = synth({ feeRel: [7, 2, 0, 0, 0, 0, 0, 0] });
  assert.ok(nfSimilarity(till1, till2) > 0.99);
  assert.ok(nfSimilarity(till1, miser) < 0.2);
  // no evidence at all reads as no similarity, not as a perfect match
  assert.equal(nfSimilarity(synth({}), synth({})), 0);
});

test("ns-netflix: the day-median context covers every active day", () => {
  const { eco } = golden(60);
  const med = dayMedians(eco.chain);
  for (const tx of eco.chain.txs.values()) {
    assert.ok((med.get(tx.timestep) ?? 0) > 0, `no median for day ${tx.timestep}`);
  }
});

test("ns-netflix: every cluster gets a fingerprint from the public record", () => {
  const { eco, cl } = golden(80);
  const stats = nfStats(cl, eco.chain);
  assert.equal(stats.size, cl.members.size);
  // amounts and temporal always have evidence (every cluster holds coins);
  // scores stay within cosine's range
  for (const [rep, st] of stats) {
    assert.ok(st.amounts.some((x) => x > 0), `${rep} has no amount evidence`);
    assert.ok(st.temporal.some((x) => x > 0), `${rep} has no temporal evidence`);
    const s = nfSimilarity(st, st);
    assert.ok(s > 0.99 && s <= 1.0001, `self-similarity ${s}`);
  }
});

test("ns-netflix: a threshold above cosine's ceiling admits nothing", () => {
  const { eco, cl } = golden(60);
  assert.equal(nfRun(cl, eco.chain, 1.01).length, 0);
});

test("ns-netflix: the greedy run is deterministic, ranked, and never revisits", () => {
  const { eco, cl } = golden(80);
  const a = nfRun(cl, eco.chain, 0.75);
  const b = nfRun(cl, eco.chain, 0.75);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0, "expected at least one behavioral match at 0.75");
  const seen = new Set<string>();
  let prev = Infinity;
  for (const e of a) {
    assert.ok(e.score <= prev, "events must come best-first");
    prev = e.score;
    assert.ok(!seen.has(e.a) && !seen.has(e.b), `${e.a}+${e.b} revisits a matched vertex`);
    seen.add(e.a);
    seen.add(e.b);
    assert.ok(e.score >= 0.75);
  }
});

test("ns-netflix: thin records are never matched — no spends, no fingerprint", () => {
  // most of the map is unspent singletons whose one-hot amount/temporal
  // vectors collide by coincidence; the evidence gate keeps them out
  // even with the threshold at the floor
  const { eco, cl } = golden(80);
  const stats = nfStats(cl, eco.chain);
  const events = nfRun(cl, eco.chain, 0);
  for (const e of events) {
    assert.ok(stats.get(e.a)!.spends >= NF_MIN_SPENDS, `${e.a} matched on a thin record`);
    assert.ok(stats.get(e.b)!.spends >= NF_MIN_SPENDS, `${e.b} matched on a thin record`);
  }
  const thin = [...cl.members.keys()].filter((r) => stats.get(r)!.spends < NF_MIN_SPENDS);
  assert.ok(thin.length > 0, "expected thin-record clusters on the map");
});

test("ns-netflix: events apply through the same fusion as ns-social", () => {
  const { eco, cl } = golden(80);
  const events = nfRun(cl, eco.chain, 0.75);
  const merged = nsApply(cl, events.map((e) => ({ kind: "merge" as const, ...e })));
  assert.equal(merged.members.size, cl.members.size - events.length);
  for (const e of events) {
    assert.equal(merged.rep.get(e.a), merged.rep.get(e.b));
  }
});
