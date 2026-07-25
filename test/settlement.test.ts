import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, SETTLE_DAY } from "../src/engine/economy";
import { CARELESS, PERSONAS } from "../src/scenario/cast";
import { agentKnowledge } from "../src/analysis/knowledge";

function ecoAt(day: number): Economy {
  const eco = new Economy("golden");
  eco.runTo(day);
  return eco;
}

test("no settlements before the neighborhood starts netting", () => {
  const eco = ecoAt(SETTLE_DAY - 1);
  assert.ok(eco.events.every((e) => e.form !== "settlement"));
});

test("settlements happen, including a three-party one", () => {
  const eco = ecoAt(100);
  const tids = new Set(eco.events.filter((e) => e.form === "settlement").map((e) => e.tid));
  assert.ok(tids.size >= 2, `only ${tids.size} settlements by day 100`);
  const threeParty = [...tids].some((tid) => eco.chain.txs.get(tid)!.inputs.length >= 3);
  assert.ok(threeParty, "no three-party settlement by day 100");
});

test("a settlement settles several obligations in one transaction", () => {
  const eco = ecoAt(100);
  const byTid = new Map<string, number>();
  for (const e of eco.events) {
    if (e.form === "settlement") byTid.set(e.tid, (byTid.get(e.tid) ?? 0) + 1);
  }
  for (const [tid, n] of byTid) assert.ok(n >= 2, `${tid} settled only ${n} obligation`);
});

test("every participant contributes coins and takes exactly one output", () => {
  const eco = ecoAt(100);
  const tids = new Set(eco.events.filter((e) => e.form === "settlement").map((e) => e.tid));
  for (const tid of tids) {
    const tx = eco.chain.txs.get(tid)!;
    const inOwners = tx.inputs.map((c) => eco.chain.coins.get(c)!.owner);
    const outOwners = tx.outputs.map((c) => eco.chain.coins.get(c)!.owner);
    assert.equal(new Set(outOwners).size, outOwners.length, "one output per participant");
    assert.deepEqual([...new Set(inOwners)].sort(), [...new Set(outOwners)].sort());
    for (const u of new Set(inOwners)) {
      assert.ok(inOwners.filter((o) => o === u).length <= 2, "at most two coins each");
    }
    const parts = eco.events.filter((e) => e.tid === tid);
    assert.ok(parts.every((e) => e.payer !== null && e.payee !== null), "settlements are internal");
  }
});

test("rent day: the studio cycle settles in full, and its nets shrink below the gross", () => {
  const eco = ecoAt(80);
  // find a settlement with as many obligations as parties — a full cycle
  const byTid = new Map<string, { payers: Set<number>; payees: Set<number>; n: number }>();
  for (const e of eco.events) {
    if (e.form !== "settlement") continue;
    const g = byTid.get(e.tid) ?? { payers: new Set(), payees: new Set(), n: 0 };
    g.payers.add(e.payer);
    g.payees.add(e.payee!);
    g.n += 1;
    byTid.set(e.tid, g);
  }
  const cycle = [...byTid.entries()].find(([, g]) =>
    g.n >= 3 && g.payers.size === g.n &&
    [...g.payers].sort().join() === [...g.payees].sort().join());
  assert.ok(cycle, "no full-cycle settlement by day 80");
  const [tid, g] = cycle!;
  // ...so no output is a payment: in particular Judy's net is strictly
  // smaller than the rent she owed, because the logo fee flows back
  const tx = eco.chain.txs.get(tid)!;
  const day = eco.events.find((e) => e.tid === tid)!.day;
  const rentSats = Math.round((850 * 1e8) / eco.prices[day]!);
  const inBy = new Map<number, number>();
  for (const c of tx.inputs) {
    const coin = eco.chain.coins.get(c)!;
    inBy.set(coin.owner!, (inBy.get(coin.owner!) ?? 0) + coin.value);
  }
  const outBy = new Map(tx.outputs.map((c) => [eco.chain.coins.get(c)!.owner!, eco.chain.coins.get(c)!.value]));
  if (g.payers.has(9)) {
    const net = outBy.get(9)! - inBy.get(9)!;
    assert.ok(Math.abs(net) < rentSats, `Judy's net ${net} should be smaller than the rent ${rentSats}`);
  }
});

test("whoever sees no privacy benefit is never a settlement party", () => {
  const eco = ecoAt(120);
  const tids = new Set(eco.events.filter((e) => e.form === "settlement").map((e) => e.tid));
  for (const tid of tids) {
    const tx = eco.chain.txs.get(tid)!;
    for (const c of tx.inputs) {
      const owner = eco.chain.coins.get(c)!.owner!;
      assert.notEqual(owner, CARELESS);
      assert.ok(PERSONAS[owner]!.stats.privacy > 0);
    }
  }
});

test("a settlement insider can attribute the whole transaction", () => {
  const eco = ecoAt(100);
  const ev = eco.events.find((e) => e.form === "settlement")!;
  const tx = eco.chain.txs.get(ev.tid)!;
  const k = agentKnowledge(eco.chain, eco.events, ev.payer);
  for (const id of [...tx.inputs, ...tx.outputs]) {
    const a = k.coins.get(id)!;
    assert.ok(a?.direct, `insider is blind to ${id}`);
    assert.equal(a.owner, eco.chain.coins.get(id)!.owner);
  }
  assert.ok(k.txs.has(ev.tid));
});
