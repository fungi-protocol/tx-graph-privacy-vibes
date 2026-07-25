import { test } from "node:test";
import assert from "node:assert/strict";
import { DENOMS, DUST, isDenomination, radixBelow, radixDecomps } from "../src/denom/denominations";
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

test("radixDecomps: whole balance into ≤6 denominations, residual below the smallest", () => {
  const rng = new Rng("radix-whole");
  for (let i = 0; i < 500; i++) {
    const v = 250_000 + rng.int(3_000_000);
    const opts = radixDecomps(v);
    assert.ok(opts.length >= 1, `${v}: no decomposition`);
    const seen = new Set<string>();
    for (const parts of opts) {
      assert.ok(parts.length >= 1 && parts.length <= 6, `${v}: ${parts.length} parts`);
      assert.ok(parts.every((d) => isDenomination(d)), `${v}: non-denomination part`);
      const residual = v - parts.reduce((s, d) => s + d, 0);
      assert.ok(residual >= DUST, `${v}: residual ${residual} below dust`);
      assert.ok(residual < DENOMS[0]! + DUST, `${v}: residual ${residual} is change under another name`);
      const key = parts.join(",");
      assert.ok(!seen.has(key), `${v}: duplicate variant`);
      seen.add(key);
    }
  }
});

test("radixDecomps offers several variants for a healthy balance", () => {
  assert.ok(radixDecomps(650_000).length >= 2, "one option would fingerprint its chooser");
});

test("radixDecomps on a dust-scale target finds nothing", () => {
  assert.deepEqual(radixDecomps(700), []);
});
