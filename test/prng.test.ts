import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng, hashSeed } from "../src/core/prng";

test("same seed, same stream", () => {
  const a = new Rng("hello"), b = new Rng("hello");
  for (let i = 0; i < 1000; i++) assert.equal(a.u32(), b.u32());
});

test("different seeds diverge", () => {
  const a = new Rng("hello"), b = new Rng("hello!");
  let same = 0;
  for (let i = 0; i < 100; i++) if (a.u32() === b.u32()) same++;
  assert.ok(same < 3);
});

test("hashSeed avalanche on similar strings", () => {
  assert.notDeepEqual(hashSeed("a"), hashSeed("b"));
  assert.notDeepEqual(hashSeed(""), hashSeed(" "));
});

test("next() in [0, 1)", () => {
  const r = new Rng("range");
  for (let i = 0; i < 1000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
  }
});

test("int(n) in [0, n)", () => {
  const r = new Rng("int");
  const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) {
    const x = r.int(7);
    assert.ok(x >= 0 && x < 7 && Number.isInteger(x));
    seen.add(x);
  }
  assert.equal(seen.size, 7);
});

test("weighted respects zero weights", () => {
  const r = new Rng("w");
  for (let i = 0; i < 200; i++) assert.equal(r.weighted([0, 1, 0]), 1);
});

test("poisson mean roughly lambda", () => {
  const r = new Rng("poisson");
  const n = 5000;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += r.poisson(3);
  assert.ok(Math.abs(sum / n - 3) < 0.15, `mean ${sum / n}`);
});

test("fork gives independent but deterministic streams", () => {
  const a = new Rng("root").fork("x");
  const b = new Rng("root").fork("x");
  const c = new Rng("root").fork("y");
  assert.equal(a.u32(), b.u32());
  assert.notEqual(a.u32(), c.u32());
});
