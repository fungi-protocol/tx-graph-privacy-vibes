import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { PERSONAS } from "../src/scenario/cast";
import { ancestry, txAncestry } from "../src/analysis/ancestry";

test("same seed, same economy", () => {
  const a = new Economy("golden");
  const b = new Economy("golden");
  a.runTo(30);
  b.runTo(30);
  assert.equal(a.chain.describe(), b.chain.describe());
  assert.deepEqual(a.events, b.events);
});

test("different seeds diverge", () => {
  const a = new Economy("golden");
  const b = new Economy("silver");
  a.runTo(30);
  b.runTo(30);
  assert.notEqual(a.chain.describe(), b.chain.describe());
});

test("runTo is an idempotent fast-forward", () => {
  const a = new Economy("golden");
  a.runTo(15);
  a.runTo(30);
  const b = new Economy("golden");
  b.runTo(30);
  assert.equal(a.chain.describe(), b.chain.describe());
});

test("the economy actually transacts, and stays in bounds", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  assert.ok(eco.chain.order.length >= 10, `only ${eco.chain.order.length} txs in 30 days`);
  for (const ev of eco.events) {
    assert.ok(ev.payer >= 0 && ev.payer < PERSONAS.length);
    assert.ok(ev.payee === null || (ev.payee >= 0 && ev.payee < PERSONAS.length));
    assert.ok(ev.day >= 1 && ev.day <= 30);
    assert.ok(ev.memo.length > 0);
    assert.ok(ev.why.length > 0);
  }
});

test("conservation: every sat in a UTXO came from a root, less fees", () => {
  // the economy is open — income roots arrive from outside town — so the
  // invariant is against everything that ever entered, not the day-0 total
  const eco = new Economy("golden");
  eco.runTo(30);
  const fees = [...eco.chain.txs.values()].reduce((s, t) => s + t.fee, 0);
  const entered = [...eco.chain.coins.values()]
    .filter((c) => c.producer === null)
    .reduce((s, c) => s + c.value, 0);
  const held = eco.chain.utxos().reduce((s, c) => s + c.value, 0);
  assert.equal(held + fees, entered);
  // and income did arrive: pay period one has passed
  assert.ok([...eco.chain.coins.values()].some((c) => c.producer === null && c.id.startsWith("r.")),
    "no income root ever landed");
});

test("ancestry walks back to roots and only roots lack producers", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  const lastTid = eco.chain.order[eco.chain.order.length - 1]!;
  const lastTx = eco.chain.txs.get(lastTid)!;
  const coin = lastTx.outputs[0]!;
  const a = ancestry(eco.chain, coin);
  assert.ok(a.coins.has(coin));
  assert.ok(a.txs.has(lastTid));
  const roots = [...a.coins].filter((c) => eco.chain.coins.get(c)!.producer === null);
  assert.ok(roots.length >= 1, "trace must reach at least one root");
  // every non-root ancestor's producer is in the traced tx set
  for (const c of a.coins) {
    const p = eco.chain.coins.get(c)!.producer;
    if (p !== null) assert.ok(a.txs.has(p), `${c} produced by untraced ${p}`);
  }
});

test("tx ancestry is the union of its inputs' ancestries", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  const two = eco.chain.order.find((tid) => eco.chain.txs.get(tid)!.inputs.length === 2);
  if (!two) return; // seed produced no 2-input tx in 30 days; fine
  const tx = eco.chain.txs.get(two)!;
  const a = txAncestry(eco.chain, two);
  for (const input of tx.inputs) {
    const ia = ancestry(eco.chain, input);
    for (const c of ia.coins) assert.ok(a.coins.has(c));
    for (const t of ia.txs) assert.ok(a.txs.has(t));
  }
  assert.ok(a.txs.has(two));
});
