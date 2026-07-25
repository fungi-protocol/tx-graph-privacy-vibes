import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { PERSONAS, BASE_EDGES, BASE_POP, MAX_POP, buildCast, ownerColor, OWNER_COLORS } from "../src/scenario/cast";
import { encodeFragment, decodeFragment, type FragmentState } from "../src/ui/fragment";
import { setCastNames, OMNISCIENT } from "../src/scenario/omniscient";

test("pop 10 is exactly the fixed cast and edges", () => {
  const town = buildCast("golden", 10);
  assert.deepEqual(town.personas, PERSONAS);
  assert.deepEqual(town.edges, BASE_EDGES);
});

test("the default economy ignores population machinery entirely", () => {
  const a = new Economy("golden");
  const b = new Economy("golden", { pop: 10 });
  a.runTo(60);
  b.runTo(60);
  assert.equal(a.chain.describe(), b.chain.describe());
});

test("11–14 add the archetypes in order, with their habits on file", () => {
  const town = buildCast("golden", 14);
  const names = town.personas.slice(BASE_POP).map((p) => p.name);
  assert.deepEqual(names, ["Kai", "Lena", "Max", "Nadia"]);
  assert.equal(town.personas[10]!.rootLabel, "coinbase reward");
  assert.equal(town.personas[13]!.batches, true);
  assert.equal(town.personas[12]!.stats.privacy, 5);
  // every archetype brings edges that reference its own index
  for (const u of [10, 11, 12, 13]) {
    assert.ok(town.edges.some((e) => e.payer === u || e.payee === u),
      `archetype ${u} has no edges`);
  }
});

test("townsfolk are seeded: same seed same town, different seed different town", () => {
  const a = buildCast("golden", MAX_POP);
  const b = buildCast("golden", MAX_POP);
  const c = buildCast("other", MAX_POP);
  assert.equal(a.personas.length, MAX_POP);
  assert.deepEqual(a.personas, b.personas);
  assert.deepEqual(a.edges, b.edges);
  assert.notDeepEqual(c.personas.slice(BASE_POP + 4), a.personas.slice(BASE_POP + 4));
});

test("the batching desk pays several dues in one transaction", () => {
  // all four tutorial seeds produce at least one batch by day 150 — Nadia
  // is the last arrival (#15, day 108), so the window starts late
  for (const seed of ["golden", "welcome", "gamma", "alpha"]) {
    const eco = new Economy(seed, { pop: 14 });
    eco.runTo(150);
    const batch = eco.events.find((e) => e.payer === 13 && e.memo.startsWith("batch payout"));
    assert.ok(batch, `${seed}: Nadia never batched`);
    const tx = eco.chain.txs.get(batch!.tid)!;
    // two payouts plus change; the same regular may be owed twice, so the
    // recipients need not be distinct — the batch shape is what matters
    assert.ok(tx.outputs.length >= 3, "a batch pays at least two dues plus change");
    for (const o of tx.outputs.slice(0, -1)) {
      assert.notEqual(eco.chain.coins.get(o)!.owner, 13, "payout outputs belong to payees");
    }
  }
});

test("the miner mostly holds; the market stall turns over", () => {
  const eco = new Economy("golden", { pop: 14 });
  eco.runTo(130);
  const kai = eco.events.filter((e) => e.payer === 10).length;
  const lenaReceipts = eco.events.filter((e) => e.payee === 11).length;
  assert.ok(kai < lenaReceipts / 2,
    `Kai (${kai} spends) should be far quieter than Lena's till (${lenaReceipts} receipts)`);
  assert.ok([...eco.chain.coins.values()].some((c) => c.label === "coinbase reward"));
});

test("a full town runs deterministically", () => {
  const a = new Economy("gamma", { pop: MAX_POP });
  const b = new Economy("gamma", { pop: MAX_POP });
  a.runTo(90);
  b.runTo(90);
  assert.equal(a.cast.length, MAX_POP);
  assert.equal(a.chain.describe(), b.chain.describe());
});

test("owner colors stay tableau for the ten and stay distinct beyond", () => {
  for (let u = 0; u < 10; u++) assert.equal(ownerColor(u), OWNER_COLORS[u]);
  const all = new Set(Array.from({ length: MAX_POP }, (_, u) => ownerColor(u)));
  assert.equal(all.size, MAX_POP);
});

test("the all-seeing lens captions a grown cast by name", () => {
  // regression: the default paint once fell back to "user 13" past the ten
  const eco = new Economy("golden", { pop: 14 });
  setCastNames(eco.cast.map((p) => p.name));
  const caption = OMNISCIENT.coinCaption({
    id: "x", owner: 13, value: 1, producer: null, dest: null, label: "desk payout",
  } as never);
  assert.equal(caption, "Nadia · desk payout");
  setCastNames(eco.cast.slice(0, 10).map((p) => p.name)); // restore-ish
});

test("population rides the fragment", async () => {
  const state: FragmentState = { seed: "golden", p: { pp: 14 }, m: [13, 40] };
  const back = await decodeFragment(await encodeFragment(state));
  assert.deepEqual(back, state);
});
