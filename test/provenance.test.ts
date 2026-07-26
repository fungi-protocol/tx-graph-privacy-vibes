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
  // a ~ change: rests on the change guess AND on CIOH — the guess only
  // fires once every input reads as one spender, so removing either
  // method kills the claim
  const ac = removeOneMethod(c, price, "a", "t1o2");
  assert.equal(ac.get("subtx"), true);
  assert.equal(ac.get("cioh"), false);
  assert.equal(ac.get("change"), false);
});

test("closure: blocking one heuristic does not restore privacy, on every tutorial seed", () => {
  // the careless first coinjoin is welded by the sub-transaction
  // analysis (unique partition). Disable it and the weld between a
  // participant's two inputs SURVIVES — plain CIOH takes over (welding
  // the other participants in too, wrongly, but the coins stay linked).
  // Blocking the stronger method does not un-link what a cruder one
  // still links. Held on every seed the tutorial reaches, not just the
  // default one.
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(COINJOIN_DAY);
    assert.ok(eco.naiveTid, `${seed}: no naive coinjoin`);
    const tx = eco.chain.txs.get(eco.naiveTid!)!;
    const owner = (id: string): number | null => eco.chain.coins.get(id)!.owner;
    const byOwner = new Map<number, string[]>();
    for (const id of tx.inputs) {
      const o = owner(id)!;
      byOwner.set(o, [...(byOwner.get(o) ?? []), id]);
    }
    const multi = [...byOwner.values()].find((ids) => ids.length >= 2);
    assert.ok(multi, `${seed}: no participant contributed two inputs`);
    const [a, b] = [multi![0]!, multi![1]!];
    const p = (d: number): number => eco.prices[d]!;
    const cl = clusterObserver(eco.chain, p);
    const chainOfInference = support(cl, a, b)!;
    assert.ok(chainOfInference.some((w) => w.method === "subtx" && w.tx === eco.naiveTid),
      `${seed}: the naive coinjoin weld should rest on the sub-transaction analysis`);
    assert.equal(withoutMethod(eco.chain, p, "subtx", a, b), true,
      `${seed}: removing the sub-transaction analysis must not restore privacy here`);
  }
});

test("with every method disabled the ledger is empty and all coins are singletons", () => {
  const c = paymentChain();
  const cl = clusterObserver(c, price, { cioh: false, change: false, subsum: false });
  assert.equal(cl.welds.length, 0);
  for (const id of c.coins.keys()) {
    assert.equal(cl.members.get(cl.rep.get(id)!)!.length, 1);
  }
});
