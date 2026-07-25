import { test } from "node:test";
import assert from "node:assert/strict";
import { DENOMS, DUST, isDenomination, bruteDecomps } from "../src/denom/denominations";
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

test("bruteDecomps: well-formed candidates — ≤6 denomination parts, change above dust", () => {
  const rng = new Rng("brute");
  for (let i = 0; i < 500; i++) {
    const v = 250_000 + rng.int(3_000_000);
    const opts = bruteDecomps(v);
    assert.ok(opts.length >= 1, `${v}: no decomposition`);
    const seen = new Set<string>();
    for (const { parts, residual } of opts) {
      assert.ok(parts.length >= 1 && parts.length <= 6, `${v}: ${parts.length} parts`);
      assert.ok(parts.every((d) => isDenomination(d)), `${v}: non-denomination part`);
      assert.equal(parts.reduce((s, d) => s + d, 0) + residual, v);
      assert.ok(residual >= DUST, `${v}: residual ${residual} below dust — no dust change`);
      const key = parts.join(",");
      assert.ok(!seen.has(key), `${v}: duplicate variant`);
      seen.add(key);
    }
  }
});

test("bruteDecomps approximates well without running the arity up", () => {
  // the greedy radix expansion needed 5 or 6 parts (some near dust) for
  // values like these; the searched combinations get within 0.5% with 4
  // or fewer, and never resort to dust-scale parts
  const rng = new Rng("brute-arity");
  for (let i = 0; i < 200; i++) {
    const v = 250_000 + rng.int(3_000_000);
    const best = bruteDecomps(v)[0]!;
    assert.ok(best.residual <= Math.max(DUST, Math.floor(v / 200)),
      `${v}: best residual ${best.residual} misses the closeness bar`);
    assert.ok(best.parts.length <= 4, `${v}: best needs ${best.parts.length} parts`);
    assert.ok(best.parts.every((d) => d >= 512), `${v}: dust-scale part`);
  }
});

test("bruteDecomps offers several variants for a healthy balance", () => {
  assert.ok(bruteDecomps(650_000).length >= 2, "one option would fingerprint its chooser");
});

test("bruteDecomps on a dust-scale target finds nothing", () => {
  assert.deepEqual(bruteDecomps(700), []);
});
