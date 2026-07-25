import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFragment, decodeFragment, sanitize, SCHEMA_VERSION } from "../src/ui/fragment";

test("fragment round-trip", async () => {
  const fragment = await encodeFragment({ seed: "the naked economy" });
  const state = await decodeFragment(`#${fragment}`);
  assert.deepEqual(state, { seed: "the naked economy" });
});

test("fragment round-trip with unicode seed", async () => {
  const fragment = await encodeFragment({ seed: "コイン☂ジョイン" });
  const state = await decodeFragment(fragment);
  assert.deepEqual(state, { seed: "コイン☂ジョイン" });
});

test("fragment round-trip with camera, tutorial step, and reference", async () => {
  const full = {
    seed: "welcome",
    t: 4,
    cam: [766, 94, 0.775] as [number, number, number],
    ref: { wx: 521, wy: 100, sel: "coin:t1o2" },
  };
  assert.deepEqual(await decodeFragment(`#${await encodeFragment(full)}`), full);
});

test("observer heuristics bitmask round-trips and is clamped", async () => {
  const full = { seed: "welcome", l: 1, ov: 3 };
  assert.deepEqual(await decodeFragment(`#${await encodeFragment(full)}`), full);
  const craft = (state: unknown): Promise<unknown> =>
    encodeFragment(state as Parameters<typeof encodeFragment>[0]).then(decodeFragment);
  const wild = await craft({ seed: "ok", ov: 999 }) as Record<string, unknown>;
  assert.equal(wild.ov, 7);
  const neg = await craft({ seed: "ok", ov: -4 }) as Record<string, unknown>;
  assert.equal(neg.ov, 0);
});

test("missing fragment decodes to null", async () => {
  assert.equal(await decodeFragment(""), null);
  assert.equal(await decodeFragment("#other=1"), null);
});

test("fragment is url-safe", async () => {
  const fragment = await encodeFragment({ seed: "x".repeat(500) });
  assert.match(fragment, /^s=[A-Za-z0-9_-]+$/);
});

test("hostile fragments degrade, never crash: shape and bounds are enforced", async () => {
  const craft = (state: unknown): Promise<unknown> =>
    encodeFragment(state as Parameters<typeof encodeFragment>[0]).then(decodeFragment);

  // wrong shapes are rejected outright
  assert.equal(await craft([1, 2, 3]), null);
  assert.equal(await craft({ seed: 42 }), null);
  assert.equal(await craft({ seed: "x".repeat(65) }), null);

  // numbers are clamped into the app's real ranges
  const wild = await craft({
    seed: "ok", n: 9e9, t: 1e6, v: 99, sc: -5,
    cam: [1e12, -1e12, 0], p: { o: 100, pp: 1e6 },
    m: [1e9, -3],
    // one well-formed choice; then garbage, a non-schedule id, and a
    // pre-M10 5-tuple (memo/due matching) — all dropped
    i: [[119, "118.s0", "wait"], "garbage", [1, "not-an-id", "wait"], [1, 0, "rent", 2, "wait"]],
  }) as Record<string, unknown>;
  assert.equal(wild.n, 3650);
  assert.equal(wild.t, 500);
  assert.equal(wild.v, 2);
  assert.equal(wild.sc, 0);
  assert.deepEqual(wild.cam, [1e7, -1e7, 0.01]);
  assert.deepEqual(wild.p, { o: 0.3, pp: 64 });
  assert.deepEqual(wild.m, [64, 0]);
  assert.deepEqual(wild.i, [[119, "118.s0", "wait"]]); // malformed entries dropped

  // non-finite values vanish rather than propagate
  const nan = await craft({ seed: "ok", n: Infinity, cam: [1, 2, NaN] }) as Record<string, unknown>;
  assert.equal(nan.n, undefined);
  assert.equal(nan.cam, undefined);
});

test("schema version travels on the wire but never reaches the app", async () => {
  assert.ok(SCHEMA_VERSION >= 2);
  const back = await decodeFragment(`#${await encodeFragment({ seed: "ok", n: 5 })}`);
  assert.deepEqual(back, { seed: "ok", n: 5 }); // sv consumed, not emitted
});

test("migrations key on the declared version", () => {
  // a fragment declaring v1 loses its interventions (memo/due matching,
  // unreplayable against the re-derived schedule)
  const v1 = sanitize({ seed: "ok", sv: 1, i: [[119, "118.s0", "wait"]] });
  assert.equal(v1!.i, undefined);
  // no declared version = the last pre-versioning schema (v2): kept
  const v2 = sanitize({ seed: "ok", i: [[119, "118.s0", "wait"]] });
  assert.deepEqual(v2!.i, [[119, "118.s0", "wait"]]);
  // a fragment from a future app version parses best-effort
  const future = sanitize({ seed: "ok", sv: 99, n: 7, someFutureField: true });
  assert.deepEqual(future, { seed: "ok", n: 7 });
});

test("dated parameter patches round-trip and are clamped like the base params", async () => {
  const fragment = await encodeFragment({
    seed: "welcome",
    pt: [[31, { f: 3 }], [60, { o: 0.2, e: 0.1 }]],
  });
  const state = await decodeFragment(fragment);
  assert.deepEqual(state, { seed: "welcome", pt: [[31, { f: 3 }], [60, { o: 0.2, e: 0.1 }]] });

  const hostile = sanitize({
    seed: "x",
    pt: [
      [0, { f: 2 }],            // day below 1: clamped to 1, like every bound
      [40, { f: 99, o: -5 }],   // values clamped into the knob ranges
      [50, { w: 2, pp: 40 }],   // identity params are not live: ignored
      "junk", [60, null],       // malformed entries skipped
    ],
  });
  assert.deepEqual(hostile?.pt, [[1, { f: 2 }], [40, { o: 0, f: 4 }]]);
});
