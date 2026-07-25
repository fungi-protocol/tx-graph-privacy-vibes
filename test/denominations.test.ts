import { test } from "node:test";
import assert from "node:assert/strict";
import { DENOMS, DUST, isDenomination, radixBelow, decomps } from "../src/denom/denominations";
import { Rng } from "../src/core/prng";

test("the pinned set: 56 hamming-weight-1 values between dust and 1 BTC", () => {
  assert.equal(DENOMS.length, 56);
  assert.equal(DENOMS[0], 512); // the first power of two above dust
  assert.equal(DENOMS[DENOMS.length - 1], 100_000_000);
  for (const d of DENOMS) assert.ok(d >= DUST && d <= 100_000_000);
  // spot checks, one per series
  for (const d of [1024, 729, 4374, 5000, 20_000_000, 86_093_442]) {
    assert.ok(isDenomination(d), `${d} should be a denomination`);
  }
  assert.ok(!isDenomination(300));
  assert.ok(!isDenomination(1_000_001));
  // sorted, unique
  for (let i = 1; i < DENOMS.length; i++) assert.ok(DENOMS[i]! > DENOMS[i - 1]!);
});

test("radix decomposition from below: at most 6 parts, residual below the smallest denomination", () => {
  const rng = new Rng("radix");
  for (let i = 0; i < 500; i++) {
    const v = 1_000 + rng.int(2_000_000);
    const { parts, residual } = radixBelow(v);
    assert.ok(parts.length <= 6, `${v}: ${parts.length} parts`);
    assert.ok(parts.every((d) => isDenomination(d)), `${v}: non-denomination part`);
    assert.equal(parts.reduce((s, d) => s + d, 0) + residual, v);
    assert.ok(residual < 512, `${v}: residual ${residual}`);
  }
});

test("decomps offers denomination-plus-guarded-change splits, plain change always included", () => {
  const ivs = [700_000, 450_000, 900_000];
  const opts = decomps(650_000, ivs);
  assert.ok(opts.length >= 2, "should find denomination splits for a healthy target");
  assert.deepEqual(opts[opts.length - 1], [], "plain change is the fallback");
  for (const ds of opts.slice(0, -1)) {
    assert.equal(ds.length, 1);
    assert.ok(isDenomination(ds[0]!));
    const change = 650_000 - ds[0]!;
    assert.ok(change >= 60_000, "change must not be dust-adjacent");
    for (const iv of ivs) assert.ok(Math.abs(change - iv) >= 3_000, "change must not match an input");
  }
});

test("decomps on a tiny target degrades to plain change", () => {
  assert.deepEqual(decomps(120_000, [500_000]), [[]]);
});
