import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { clusterObserver } from "../src/analysis/clusters";
import { agentKnowledge } from "../src/analysis/knowledge";

function ecoAt(day: number): Economy {
  const eco = new Economy("golden");
  eco.runTo(day);
  return eco;
}

test("an agent knows every coin they ever owned", () => {
  const eco = ecoAt(60);
  const k = agentKnowledge(eco.chain, eco.events, 0);
  for (const c of eco.chain.coins.values()) {
    if (c.owner !== 0) continue;
    assert.deepEqual(k.coins.get(c.id), { owner: 0, direct: true });
  }
});

test("a payjoin payee knows exactly which inputs were the payer's", () => {
  const eco = ecoAt(90);
  const pj = eco.events.find((e) => e.form === "payjoin")!;
  const tx = eco.chain.txs.get(pj.tid)!;
  const k = agentKnowledge(eco.chain, eco.events, pj.payee!);
  for (const id of tx.inputs) {
    const truth = eco.chain.coins.get(id)!.owner;
    const a = k.coins.get(id)!;
    assert.equal(a.direct, true);
    assert.equal(a.owner, truth, "the counterparty attribution must be the ground truth");
  }
  assert.ok(k.txs.has(pj.tid));
});

test("an agent only knows the memos of payments they took part in", () => {
  const eco = ecoAt(60);
  const k = agentKnowledge(eco.chain, eco.events, 4);
  for (const tid of k.txs) {
    const ev = eco.events.find((e) => e.tid === tid)!;
    assert.ok(ev.payer === 4 || ev.payee === 4);
  }
  assert.ok(k.txs.size > 0, "Erin took part in payments by day 60");
});

test("direct knowledge compounds and never decays", () => {
  const early = ecoAt(45);
  const late = ecoAt(90);
  for (let u = 0; u < 10; u++) {
    const a = agentKnowledge(early.chain, early.events, u);
    const b = agentKnowledge(late.chain, late.events, u);
    for (const [id, attr] of a.coins) {
      if (!attr.direct) continue;
      const still = b.coins.get(id);
      assert.ok(still?.direct, `${id} was known to agent ${u} at day 45 but not at day 90`);
      assert.equal(still.owner, attr.owner);
    }
    assert.ok(b.coins.size >= a.coins.size);
  }
});

test("fixed points seed the public clustering into 'likely' attributions", () => {
  const eco = ecoAt(90);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  let seeded = 0, wrong = 0;
  for (let u = 0; u < 10; u++) {
    const k = agentKnowledge(eco.chain, eco.events, u, cl);
    for (const [id, attr] of k.coins) {
      if (attr.direct) continue;
      seeded += 1;
      if (attr.owner !== eco.chain.coins.get(id)!.owner) wrong += 1;
    }
  }
  assert.ok(seeded > 0, "clustering should extend someone's direct knowledge");
  // heuristics, not proofs: seeded guesses may be wrong, but if every
  // single one were, the seeding would be teaching noise
  assert.ok(wrong < seeded, `all ${seeded} seeded attributions are wrong`);
});

test("a conflicted cluster (the payjoin weld) earns no guess", () => {
  const eco = ecoAt(90);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const pj = eco.events.find((e) => e.form === "payjoin")!;
  const tx = eco.chain.txs.get(pj.tid)!;
  // a bystander with direct knowledge about both parties must not
  // attribute the welded cluster to either one
  const bystander = [...Array(10).keys()].find((u) => u !== pj.payer && u !== pj.payee)!;
  const k = agentKnowledge(eco.chain, eco.events, bystander, cl);
  const rep = cl.rep.get(tx.inputs[0]!)!;
  const owners = new Set(
    cl.members.get(rep)!.map((id) => k.coins.get(id)).filter((a) => a?.direct).map((a) => a!.owner),
  );
  if (owners.size > 1) {
    for (const id of cl.members.get(rep)!) {
      assert.notEqual(k.coins.get(id)?.direct, false, "no seeded guess inside a conflicted cluster");
    }
  }
});
