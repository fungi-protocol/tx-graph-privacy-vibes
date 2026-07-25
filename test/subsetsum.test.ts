import { test } from "node:test";
import assert from "node:assert/strict";
import { subsetSums, ambiguity, subTransactionMapping } from "../src/analysis/subsetsum";

const BTC = 1e8;

test("subsetSums enumerates every nonempty subset, sorted", () => {
  assert.deepEqual(subsetSums([1, 2, 4]), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(subsetSums([5, 5]), [5, 10]); // duplicates collapse
  assert.deepEqual(subsetSums([]), []);
});

test("the document's bad coinjoin: 0.1 + 0.3 = 0.4 and 2 + 5 = 7, uniquely", () => {
  const ivs = [0.1 * BTC, 0.3 * BTC, 2 * BTC, 5 * BTC];
  const ovs = [0.4 * BTC, 7 * BTC];
  const m = subTransactionMapping(ivs, ovs, 0);
  assert.equal(m.kind, "unique");
  if (m.kind !== "unique") return;
  assert.equal(m.parts.length, 2);
  const small = m.parts.find((p) => p.outs.includes(0))!;
  assert.deepEqual(small.ins, [0, 1]); // 0.1 + 0.3 fund 0.4
  const big = m.parts.find((p) => p.outs.includes(1))!;
  assert.deepEqual(big.ins, [2, 3]); // 2 + 5 fund 7
});

test("the document's underdetermined coinjoin: three mappings balance, so it is ambiguous", () => {
  // 0.7 can be funded by 0.3+0.4, by 0.2+0.5, or by 0.1+0.2+0.4
  const ivs = [0.1 * BTC, 0.4 * BTC, 0.2 * BTC, 0.5 * BTC, 0.3 * BTC];
  const ovs = [0.7 * BTC, 0.8 * BTC];
  assert.equal(subTransactionMapping(ivs, ovs, 0).kind, "ambiguous");
});

test("a payjoin-shaped transaction reads as atomic: the payment crosses every split", () => {
  // payer in 600k pays 250k; payee contributes 180k, takes 430k; change 340k
  const fee = 10_000;
  const m = subTransactionMapping([600_000, 180_000], [430_000, 600_000 - 250_000 - fee], fee);
  assert.equal(m.kind, "atomic");
});

test("fee tolerance: a unique split still resolves when each side pays its share", () => {
  const fee = 900;
  // two parties, each takes back gross minus half the fee
  const ivs = [200_000, 300_000, 1_500_000, 3_100_000];
  const ovs = [500_000 - 450, 4_600_000 - 450];
  const m = subTransactionMapping(ivs, ovs, fee);
  assert.equal(m.kind, "unique");
});

test("ambiguity: coverage by denominated outputs vs none by careless ones", () => {
  const ivs = [800_000, 900_000, 1_000_000];
  // careless: every value more than the tolerance away from any combination
  assert.equal(ambiguity(ivs, [800_600, 900_600, 998_000]), 0);
  // denominated with multiplicity: everything is covered
  const dense = ambiguity(ivs, [500_000, 300_000, 500_000, 400_000, 500_000, 500_000]);
  assert.equal(dense, 1);
  // the doc's bad coinjoin: only the true groupings (and their union) match
  const bad = ambiguity([10e6, 30e6, 200e6, 500e6], [40e6, 700e6]);
  assert.ok(bad > 0 && bad < 0.25, `${bad}`);
});

test("oversized transactions are inconclusive, not claimed ambiguous", () => {
  // nothing was enumerated, so nothing is proven: the verdict must say
  // the search gave up, not assert that several readings balance
  const ivs = Array.from({ length: 11 }, (_, i) => 100_000 + i);
  const ovs = Array.from({ length: 11 }, (_, i) => 100_000 + i);
  assert.equal(subTransactionMapping(ivs, ovs, 0).kind, "inconclusive");
});

test("reviewer's fixture: a uniquely-partitioned oversized tx is still only inconclusive", () => {
  // 11 power-of-two inputs partition uniquely (binary representation),
  // but the size guard bails before discovering that: the verdict must
  // admit ignorance, and callers must not score or narrate it as
  // ambiguous — the unique mapping here would make that claim false
  const ivs = Array.from({ length: 11 }, (_, i) => (1 << i) * 1000);
  const low = ivs.slice(0, 5).reduce((a, b) => a + b, 0);
  const high = ivs.slice(5).reduce((a, b) => a + b, 0);
  assert.equal(subTransactionMapping(ivs, [low, high], 0).kind, "inconclusive");
});

test("proven ambiguity still reads ambiguous, not inconclusive", () => {
  // two identical parties: swapping their outputs gives a second reading
  const m = subTransactionMapping([100_000, 100_000], [100_000, 100_000], 0);
  assert.equal(m.kind, "ambiguous");
});
