// Chapter 8 guarantees: the synthesis chapter narrates specific
// outcomes, and per accuracy's exhibit ruling each one is pinned on
// every tutorial seed — the staged sweep's featured acceptance grades
// FALSE (the gate passes and the answer is wrong), the elimination
// beat's claim survives the sub-transaction analysis's removal (one
// observation read two ways), the rent spine has more than one form
// to tally, and the hand-built miniature accepts CORRECTLY.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { clusterObserver } from "../src/analysis/clusters";
import { synthesisSweepExhibit, clusterOwner } from "../src/scenario/synthesisStaging";
import { claimExhibit, rentForms, premiseDemo, counterpartyExhibit } from "../src/scenario/synthesisSteps";

const SEEDS = ["welcome", "golden", "gamma", "alpha", "silver"];
const DAY = 115; // the chapter's minDay

function town(seed: string): {
  eco: Economy;
  cl: ReturnType<typeof clusterObserver>;
  ownerOf: (id: string) => number | null;
} {
  const eco = new Economy(seed);
  eco.runTo(DAY);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  return { eco, cl, ownerOf: (id) => eco.chain.coins.get(id)?.owner ?? null };
}

test("the narrated sweep features a pure-cluster FALSE acceptance on every tutorial seed", () => {
  for (const seed of SEEDS) {
    const { eco, cl, ownerOf } = town(seed);
    const agents = eco.cast.map((_, i) => i);
    const ex = synthesisSweepExhibit(eco.chain, cl, eco.edges, agents, ownerOf);
    assert.ok(ex.featured, `${seed}: no featured acceptance`);
    // the prose says the acceptance cleared every gate and is WRONG:
    // a pure cluster (single true owner) mapped to a different agent
    assert.equal(ex.featured!.grade, "false", `${seed}: featured grade`);
    const owner = clusterOwner(cl, ex.featured!.node, ownerOf);
    assert.notEqual(owner, null, `${seed}: featured cluster must be pure`);
    assert.notEqual(String(owner), ex.featured!.agent, `${seed}: owner vs accepted`);
    // it really was accepted by the sweep, with a finite standout
    assert.equal(ex.result.accepted.get(ex.featured!.node), ex.featured!.agent);
    assert.ok(Number.isFinite(ex.featured!.eccentricity) && ex.featured!.eccentricity >= 1.5);
    // and abstention dominates: the sweep is a trickle, not a flood
    assert.ok(ex.result.accepted.size <= 2, `${seed}: ${ex.result.accepted.size} acceptances`);
  }
});

test("the elimination beat's claim exists and survives removing the sub-transaction analysis on every seed", () => {
  for (const seed of SEEDS) {
    const { eco, cl } = town(seed);
    assert.ok(eco.naiveTid, `${seed}: no careless coinjoin`);
    const c = claimExhibit(eco.chain, cl, (d) => eco.prices[d], eco.naiveTid!);
    assert.ok(c, `${seed}: no claim exhibit`);
    // the support is the sub-transaction weld, assumption named
    assert.ok(c!.support.length >= 1);
    assert.ok(c!.support.some((w) => w.method === "subtx" && w.assumption === "one-owner-per-part"),
      `${seed}: support should include the subtx weld with its named assumption`);
    // the narrated survival: CIOH reads the same transaction
    assert.equal(c!.rom.get("subtx"), true, `${seed}: claim should survive subtx removal`);
  }
});

test("Judy's rent has more than one form to tally by the chapter's day, on every seed", () => {
  for (const seed of SEEDS) {
    const eco = new Economy(seed);
    eco.runTo(DAY);
    const forms = rentForms(eco.events);
    const total = [...forms.values()].reduce((a, b) => a + b, 0);
    assert.ok(total >= 3, `${seed}: only ${total} rent payments`);
    assert.ok(forms.size >= 2, `${seed}: only ${forms.size} distinct forms`);
  }
});

test("the hand-built miniature accepts its one mapping CORRECTLY with a finite standout", () => {
  const d = premiseDemo();
  assert.equal(d.accepted.size, 1);
  assert.equal(d.accepted.get("cX"), "x");
  assert.ok(Number.isFinite(d.eccentricity) && d.eccentricity >= 1.5);
  assert.ok(d.score > 0);
});

test("the counterparty card's map is non-trivial on every seed: Heidi holds a compounding map of Judy's coins", () => {
  for (const seed of SEEDS) {
    const eco = new Economy(seed);
    eco.runTo(DAY);
    const c = counterpartyExhibit(eco.chain, eco.events, 7, 9);
    assert.ok(c.directOthers >= 20, `${seed}: ${c.directOthers} direct`);
    assert.ok(c.ofTarget >= 10, `${seed}: ${c.ofTarget} of Judy's`);
    assert.ok(c.targetRemaining >= 1, `${seed}: ${c.targetRemaining} remaining`);
    // the map is a subset chain: remaining ⊆ of-target ⊆ direct
    assert.ok(c.targetRemaining <= c.ofTarget && c.ofTarget <= c.directOthers);
  }
});
