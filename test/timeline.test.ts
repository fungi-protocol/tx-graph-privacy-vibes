// #17 dated parameter patches: the engine reads the params in effect per
// day, so a change dated mid-run steers the future and leaves the days
// already lived bit-identical — no hindsight re-rolls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";

function txsThrough(eco: Economy, day: number): string {
  const rows = [...eco.chain.txs.values()]
    .filter((t) => t.timestep <= day)
    .map((t) => JSON.stringify({ id: t.id, day: t.timestep, in: t.inputs, out: t.outputs }));
  return rows.join("\n");
}

test("paramsAt applies patches in day order, from their day forward", () => {
  const eco = new Economy("golden");
  eco.timeline = [
    { day: 50, patch: { oblRate: 0.2 } },
    { day: 20, patch: { oblRate: 0.15, feeLevel: 2 } },
  ];
  assert.equal(eco.paramsAt(19).oblRate, 0.09); // base, before any patch
  assert.equal(eco.paramsAt(20).oblRate, 0.15); // inclusive of its day
  assert.equal(eco.paramsAt(49).feeLevel, 2);
  assert.equal(eco.paramsAt(50).oblRate, 0.2); // later patch wins
  assert.equal(eco.paramsAt(50).feeLevel, 2); // untouched keys carry forward
  assert.equal(eco.paramsAt(50).extRate, 0.05); // base where never patched
});

test("a dated patch leaves the days before it bit-identical", () => {
  const plain = new Economy("golden");
  plain.runTo(70);
  const patched = new Economy("golden");
  patched.timeline = [{ day: 40, patch: { oblRate: 0.25, extRate: 0.15, feeLevel: 3 } }];
  patched.runTo(70);
  assert.equal(txsThrough(patched, 39), txsThrough(plain, 39));
  // and the patch actually did something: the futures diverge
  assert.notEqual(txsThrough(patched, 70), txsThrough(plain, 70));
});

test("zeroing the rates from a day forward silences the new schedule", () => {
  const eco = new Economy("golden");
  eco.timeline = [{ day: 30, patch: { oblRate: 0, extRate: 0 } }];
  eco.runTo(80);
  // no event settles an edge obligation or purchase scheduled on/after
  // day 30 (story beats and income are rng-free and keep arriving)
  const late = eco.events.filter((e) =>
    (e.oblIds ?? []).some((id) => {
      const day = Number(id.split(".")[0]);
      const kind = id.split(".")[1]?.[0];
      return day >= 30 && (kind === "e" || kind === "x");
    }));
  assert.deepEqual(late.map((e) => e.oblIds), []);
});

test("replay with the same timeline is deterministic", () => {
  const mk = (): Economy => {
    const eco = new Economy("silver");
    eco.timeline = [{ day: 25, patch: { feeVol: 2.5 } }, { day: 45, patch: { oblRate: 0.12 } }];
    eco.runTo(90);
    return eco;
  };
  const a = mk(), b = mk();
  assert.equal(txsThrough(a, 90), txsThrough(b, 90));
  assert.equal(a.events.length, b.events.length);
});

test("the exchange rate is a parameter, and a dated fx patch moves it forward-only", () => {
  const plain = new Economy("golden");
  plain.runTo(70);
  // fiat amounts are what they are; a cheaper bitcoin costs more sats per bill
  const cheap = new Economy("golden", { fx: 0.5 });
  cheap.runTo(10);
  assert.equal(cheap.prices[5]!, plain.prices[5]! * 0.5);

  const patched = new Economy("golden");
  patched.timeline = [{ day: 40, patch: { fx: 2 } }];
  patched.runTo(70);
  assert.equal(txsThrough(patched, 39), txsThrough(plain, 39)); // the past stands
  assert.equal(patched.prices[39]!, plain.prices[39]!); // the rate too, until the patch
  assert.equal(patched.prices[45]!, plain.prices[45]! * 2); // the market drift is shared
  assert.notEqual(txsThrough(patched, 70), txsThrough(plain, 70)); // sats amounts moved
});
