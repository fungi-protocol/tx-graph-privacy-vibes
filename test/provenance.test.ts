import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver } from "../src/analysis/clusters";
import { support, removeOneMethod, withoutMethod } from "../src/analysis/provenance";
import { Economy, COINJOIN_DAY } from "../src/engine/economy";

// a payment whose two-output shape feeds the round-USD change guess:
// inputs a+b, outputs a round-USD payment and the change. CIOH welds
// a~b; the change guess welds change~a. Price pinned so 500_000 sats
// reads as exactly $50.
function paymentChain(): Chain {
  const c = new Chain();
  c.addRoot("a", 600_000, 0);
  c.addRoot("b", 245_000, 0);
  const fee = txfee(2, 2, 1);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 500_000 },              // the round payment ($50)
    { owner: 0, value: 345_000 - fee },        // the change ($34.48 — not round)
  ], 1);
  return c;
}
const price = (): number => 10_000; // $10k/BTC: 500k sats = $50

test("welds are recorded with their method and base observation", () => {
  const c = paymentChain();
  const cl = clusterObserver(c, price);
  assert.equal(cl.welds.length, 2);
  const methods = cl.welds.map((w) => w.method).sort();
  assert.deepEqual(methods, ["change", "cioh"]);
  for (const w of cl.welds) {
    assert.equal(w.tx, "t1");
    // every weld's coins really do share the cluster it claims
    const reps = new Set(w.coins.map((id) => cl.rep.get(id)));
    assert.equal(reps.size, 1, `${w.method}: weld not honored by the map`);
  }
});

test("support exhibits a chain of inference back to base observations", () => {
  const c = paymentChain();
  const cl = clusterObserver(c, price);
  // a ~ b rests on CIOH alone
  const ab = support(cl, "a", "b")!;
  assert.deepEqual(ab.map((w) => w.method), ["cioh"]);
  // a ~ change rests on the change guess alone
  const ac = support(cl, "a", "t1o2")!;
  assert.deepEqual(ac.map((w) => w.method), ["change"]);
  // the payment output is never welded to anything
  assert.equal(support(cl, "a", "t1o1"), null);
  assert.equal(cl.rep.get("t1o1"), "t1o1");
});

test("remove-one-method: each claim names the method it cannot survive without", () => {
  const c = paymentChain();
  // a ~ b: survives losing the change guess (CIOH still welds the
  // inputs), dies with CIOH disabled
  const ab = removeOneMethod(c, price, "a", "b");
  assert.equal(ab.get("change"), true);
  assert.equal(ab.get("subtx"), true);
  assert.equal(ab.get("cioh"), false);
  // a ~ change: the reverse — it rests on the change guess
  const ac = removeOneMethod(c, price, "a", "t1o2");
  assert.equal(ac.get("cioh"), true);
  assert.equal(ac.get("change"), false);
});

test("closure: blocking one heuristic does not restore privacy in the running economy", () => {
  // the careless first coinjoin is welded by the sub-transaction
  // analysis (unique partition). Disable it and the weld between
  // Frank's two inputs SURVIVES — plain CIOH takes over (welding Ivan
  // in too, wrongly, but Frank's coins stay linked). Blocking the
  // stronger method does not un-link what a cruder one still links.
  const eco = new Economy("golden");
  eco.runTo(COINJOIN_DAY);
  const tx = eco.chain.txs.get(eco.naiveTid!)!;
  const owner = (id: string): number | null => eco.chain.coins.get(id)!.owner;
  const frank = tx.inputs.filter((id) => owner(id) === 5);
  assert.equal(frank.length, 2);
  const p = (d: number): number => eco.prices[d]!;
  const cl = clusterObserver(eco.chain, p);
  const chainOfInference = support(cl, frank[0]!, frank[1]!)!;
  assert.ok(chainOfInference.some((w) => w.method === "subtx" && w.tx === eco.naiveTid),
    "the naive coinjoin weld should rest on the sub-transaction analysis");
  assert.equal(withoutMethod(eco.chain, p, "subtx", frank[0]!, frank[1]!), true,
    "removing the sub-transaction analysis must not restore privacy here");
});

test("with every method disabled the ledger is empty and all coins are singletons", () => {
  const c = paymentChain();
  const cl = clusterObserver(c, price, { cioh: false, change: false, subsum: false });
  assert.equal(cl.welds.length, 0);
  for (const id of c.coins.keys()) {
    assert.equal(cl.members.get(cl.rep.get(id)!)!.length, 1);
  }
});
