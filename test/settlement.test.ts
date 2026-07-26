import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, SETTLE_DAY } from "../src/engine/economy";
import { CARELESS, PERSONAS } from "../src/scenario/cast";
import { agentKnowledge } from "../src/analysis/knowledge";
import { selectSettlementExhibit, settlementVerdict } from "../src/scenario/settlementSteps";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";

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

test("a settlement insider knows the transaction; what they learn beyond it follows the party count", () => {
  const eco = ecoAt(100);
  const parties = (tid: string): Set<number> => {
    const p = new Set<number>();
    for (const e of eco.events) {
      if (e.tid !== tid || e.form !== "settlement") continue;
      p.add(e.payer);
      p.add(e.payee!);
    }
    return p;
  };
  const tids = [...new Set(eco.events.filter((e) => e.form === "settlement").map((e) => e.tid))];
  const multi = tids.find((t) => parties(t).size >= 3);
  assert.ok(multi, "no 3+-party settlement by day 100");
  // 3+ parties: what an insider learns about the others depends on the
  // protocol that constructed the transaction — unmodeled, so the
  // insider records the transaction and nothing else. Compare against
  // a history WITHOUT the settlement: a coin can be directly known
  // through some other payment, so the honest claim is that the
  // settlement itself added no attributions.
  {
    const without = eco.events.filter((e) => e.tid !== multi);
    for (const u of parties(multi!)) {
      const kAll = agentKnowledge(eco.chain, eco.events, u);
      const kSans = agentKnowledge(eco.chain, without, u);
      assert.deepEqual(kAll.coins, kSans.coins,
        `settlement ${multi} added attributions for insider ${u}`);
      assert.ok(kAll.txs.has(multi!));
      assert.ok(!kSans.txs.has(multi!));
      assert.equal(kAll.txs.size, kSans.txs.size + 1);
    }
  }
  // exactly 2 parties: elimination is protocol-independent — each side
  // strips their own coins and the rest is the other's
  const pair = tids.find((t) => parties(t).size === 2);
  if (pair) {
    const tx = eco.chain.txs.get(pair)!;
    const u = [...parties(pair)][0]!;
    const k = agentKnowledge(eco.chain, eco.events, u);
    for (const id of [...tx.inputs, ...tx.outputs]) {
      const a = k.coins.get(id)!;
      assert.ok(a?.direct, `pair insider is blind to ${id}`);
      assert.equal(a.owner, eco.chain.coins.get(id)!.owner);
    }
  }
});

test("the chapter's exhibit settlement yields the narrated verdict on every tutorial seed", () => {
  // "The amounts are gone" displays the computed verdict for the
  // selected settlement; the title is only honest if no tutorial seed's
  // exhibit comes back with a unique split. Same template as the
  // naive-coinjoin guarantee.
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(60); // the chapter's minDay
    const ev = selectSettlementExhibit(eco.events, eco.chain);
    assert.ok(ev, `${seed}: no settlement exhibit by day 60`);
    const v = settlementVerdict(eco.chain, ev!.tid);
    assert.ok(v === "atomic" || v === "ambiguous",
      `${seed}: exhibit verdict "${v}" would make the title overclaim`);
  }
});

test("netting is offsetting: a 4-party non-cycle settlement shows the gradient", () => {
  // A→B 500k, B→C 400k, C→D 300k — a chain, no cycle anywhere. B and C
  // each mix incoming and outgoing obligations and net down; the
  // endpoints A and D have nothing to offset and move roughly their
  // gross. Everyone contributes one coin, takes one output, and shares
  // the fee — the same construction the economy uses.
  const c = new Chain();
  const oblAB = 500_000, oblBC = 400_000, oblCD = 300_000;
  const contrib = [700_000, 650_000, 600_000, 550_000]; // A B C D inputs
  contrib.forEach((v, i) => c.addRoot(`r${i}`, v, i));
  const fee = txfee(4, 4, 1);
  const share = Math.floor(fee / 4);
  const last = fee - 3 * share; // rounding remainder on the last party
  const net = [-oblAB, oblAB - oblBC, oblBC - oblCD, oblCD]; // A B C D
  const outs = contrib.map((v, i) => ({
    owner: i,
    value: v + net[i]! - (i === 3 ? last : share),
  }));
  c.addTx("s1", 1, ["r0", "r1", "r2", "r3"], outs, 1);
  // gross flow per participant: the largest single obligation they touch
  const gross = [oblAB, Math.max(oblAB, oblBC), Math.max(oblBC, oblCD), oblCD];
  // the middle parties offset: net well below gross
  for (const i of [1, 2]) {
    assert.ok(Math.abs(net[i]!) < gross[i]! / 2,
      `party ${i} mixes in+out and should net down (net ${net[i]}, gross ${gross[i]})`);
  }
  // the endpoints have nothing to offset: net equals their obligation
  assert.equal(Math.abs(net[0]!), oblAB);
  assert.equal(Math.abs(net[3]!), oblCD);
  // and the on-chain outputs really carry those nets (conservation held
  // by addTx; this pins the narrated arithmetic to the transaction)
  const tx = c.txs.get("s1")!;
  tx.outputs.forEach((id, i) => {
    assert.equal(c.coins.get(id)!.value, contrib[i]! + net[i]! - (i === 3 ? last : share));
  });
});
