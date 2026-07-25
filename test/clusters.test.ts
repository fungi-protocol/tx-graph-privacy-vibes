import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";

const PRICE = 100_000; // $100k/BTC: 1000 sats = $1
const at = (): number => PRICE;

test("CIOH unions the inputs of a multi-input transaction", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 0);
  c.addRoot("z", 500_000, 1);
  const fee = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 350_000 },
    { owner: 0, value: 150_000 - fee },
  ], 2);
  const cl = clusterObserver(c);
  assert.equal(cl.rep.get("a"), cl.rep.get("b"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("z"));
});

test("round-USD output marks the other output as change", () => {
  const c = new Chain();
  c.addRoot("a", 1_000_000, 0);
  const fee = txfee(1, 2, 2);
  // payment $100 = 100,000 sats (round); change is whatever is left (not round)
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  const cl = clusterObserver(c, at);
  const guess = cl.changeGuess.get("t1");
  assert.equal(guess, "t1o2");
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o1"));
});

test("two round outputs yield no change guess", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  // both outputs round in USD: $100 and $200
  c.addRoot("a", 100_000 + 200_000 + fee, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 200_000 },
  ], 2);
  const cl = clusterObserver(c, at);
  assert.equal(cl.changeGuess.get("t1"), undefined);
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o1"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o2"));
});

test("no price series disables the change heuristic", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  const cl = clusterObserver(c);
  assert.equal(cl.changeGuess.size, 0);
});

test("clusters are ranked by size, largest first", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 0);
  c.addRoot("d", 400_000, 0);
  c.addRoot("z", 500_000, 1);
  const fee = txfee(3, 2, 2);
  c.addTx("t1", 1, ["a", "b", "d"], [
    { owner: 1, value: 500_000 },
    { owner: 0, value: 400_000 - fee },
  ], 2);
  const cl = clusterObserver(c);
  const big = cl.rep.get("a")!;
  assert.equal(cl.rank.get(big), 1);
  assert.equal(cl.members.get(big)!.length, 3);
});

test("on the economy, change guesses are mostly right but not gospel", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  let right = 0, wrong = 0;
  for (const [, guess] of cl.changeGuess) {
    if (eco.chain.coins.get(guess)!.label === "change") right += 1;
    else wrong += 1;
  }
  assert.ok(right + wrong >= 10, `only ${right + wrong} change guesses in 60 days`);
  assert.ok(right / (right + wrong) >= 0.8,
    `change heuristic accuracy ${right}/${right + wrong} below 80%`);
});

test("cluster graph layout covers every cluster and stays in bounds", async () => {
  const { layoutClusterGraph } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const clay = layoutClusterGraph(cl);
  assert.equal(clay.nodes.size, cl.members.size);
  for (const node of clay.nodes.values()) {
    assert.ok(node.x - node.r >= clay.bounds.x && node.x + node.r <= clay.bounds.x + clay.bounds.w);
    assert.ok(node.y - node.r >= clay.bounds.y && node.y + node.r <= clay.bounds.y + clay.bounds.h);
    assert.ok(node.size >= 1);
  }
});

test("observer clustering is deterministic", () => {
  const a = new Economy("golden");
  a.runTo(30);
  const b = new Economy("golden");
  b.runTo(30);
  const ca = clusterObserver(a.chain, (d) => a.prices[d]);
  const cb = clusterObserver(b.chain, (d) => b.prices[d]);
  assert.deepEqual([...ca.rep.entries()], [...cb.rep.entries()]);
  assert.deepEqual([...ca.changeGuess.entries()], [...cb.changeGuess.entries()]);
});
