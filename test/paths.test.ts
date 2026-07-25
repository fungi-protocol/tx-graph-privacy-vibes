import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { maxflow2, counterfactualOrigins } from "../src/analysis/paths";
import { traceCoins, traceTx } from "../src/analysis/trace";
import { clusterObserver } from "../src/analysis/clusters";

const f = (nIn: number, nOut: number): number => txfee(nIn, nOut, 1);

// a diamond: one root fans out through two parallel arms that remerge
function diamond(): Chain {
  const c = new Chain();
  c.addRoot("r", 1_000_000, 0);
  c.addTx("t1", 1, ["r"], [
    { owner: 0, value: 500_000 },
    { owner: 0, value: 500_000 - f(1, 2) },
  ], 1);
  c.addTx("t2", 2, ["t1o1"], [{ owner: 0, value: 500_000 - f(1, 1) }], 1);
  c.addTx("t3", 2, ["t1o2"], [{ owner: 0, value: 500_000 - f(1, 2) - f(1, 1) }], 1);
  c.addTx("t4", 3, ["t2o1", "t3o1"], [
    { owner: 0, value: 1_000_000 - f(1, 2) - 2 * f(1, 1) - f(2, 1) },
  ], 1);
  return c;
}

test("maxflow2 counts vertex-disjoint routes", () => {
  const c = diamond();
  assert.equal(maxflow2(c, "t1", "t4"), 2); // both arms
  assert.equal(maxflow2(c, "t1", "t2"), 1); // a single edge
  assert.equal(maxflow2(c, "t2", "t3"), 0); // parallel arms don't touch
  assert.equal(maxflow2(c, "t1", "t1"), 2); // src == snk: trivially robust
});

test("an internal cut vertex caps the count at one", () => {
  // r -> t1 -> t2 (bottleneck) -> t3/t4 -> t5: everything crosses t2
  const c = new Chain();
  c.addRoot("r", 1_000_000, 0);
  const v1 = 1_000_000 - f(1, 1);
  c.addTx("t1", 1, ["r"], [{ owner: 0, value: v1 }], 1);
  c.addTx("t2", 2, ["t1o1"], [
    { owner: 0, value: 500_000 },
    { owner: 0, value: v1 - 500_000 - f(1, 2) },
  ], 1);
  c.addTx("t3", 3, ["t2o1"], [{ owner: 0, value: 500_000 - f(1, 1) }], 1);
  c.addTx("t4", 3, ["t2o2"], [{ owner: 0, value: v1 - 500_000 - f(1, 2) - f(1, 1) }], 1);
  c.addTx("t5", 4, ["t3o1", "t4o1"], [
    { owner: 0, value: v1 - f(1, 2) - 2 * f(1, 1) - f(2, 1) },
  ], 1);
  assert.equal(maxflow2(c, "t1", "t5"), 1);
});

test("counterfactualOrigins separates robust roots from threads", () => {
  // r's two arms stay separate all the way to the merge; s comes in on
  // a single thread through t6
  const c = new Chain();
  c.addRoot("r", 1_000_000, 0);
  c.addRoot("s", 200_000, 1);
  c.addTx("t1", 1, ["r"], [
    { owner: 0, value: 500_000 },
    { owner: 0, value: 500_000 - f(1, 2) },
  ], 1);
  c.addTx("t2", 2, ["t1o1"], [{ owner: 0, value: 500_000 - f(1, 1) }], 1);
  c.addTx("t3", 2, ["t1o2"], [{ owner: 0, value: 500_000 - f(1, 2) - f(1, 1) }], 1);
  c.addTx("t6", 2, ["s"], [{ owner: 1, value: 200_000 - f(1, 1) }], 1);
  const merged =
    1_000_000 - f(1, 2) - 2 * f(1, 1) + 200_000 - f(1, 1) - f(3, 1);
  c.addTx("t7", 3, ["t2o1", "t3o1", "t6o1"], [{ owner: 0, value: merged }], 1);
  const o = counterfactualOrigins(c, "t7o1");
  assert.deepEqual(o.roots.sort(), ["r", "s"]);
  // r reaches t7 through both arms; s only through t6
  assert.ok(o.robust.has("r"));
  assert.ok(!o.robust.has("s"));
});

test("a root coin has no past to count", () => {
  const c = diamond();
  const o = counterfactualOrigins(c, "r");
  assert.equal(o.robust.size, 0);
});

test("joint trace: intersection fully lit, union partly", () => {
  // m's two outputs seed both sides; a joins one side, b the other
  const c = new Chain();
  c.addRoot("a", 500_000, 0);
  c.addRoot("b", 500_000, 1);
  c.addRoot("m", 900_000, 2);
  c.addTx("t1", 1, ["m"], [
    { owner: 2, value: 400_000 },
    { owner: 2, value: 500_000 - f(1, 2) },
  ], 1);
  c.addTx("tA", 2, ["a", "t1o1"], [{ owner: 0, value: 900_000 - f(2, 1) }], 1);
  c.addTx("tB", 2, ["b", "t1o2"], [
    { owner: 1, value: 1_000_000 - f(1, 2) - f(2, 1) },
  ], 1);
  const t = traceCoins(c, ["tAo1", "tBo1"]);
  // the traced coins themselves are always full
  assert.ok(t.full.coins.has("tAo1") && t.full.coins.has("tBo1"));
  // m feeds both pasts; a and b only one each
  assert.ok(t.full.coins.has("m"));
  assert.ok(!t.full.coins.has("a") && !t.full.coins.has("b"));
  assert.ok(t.partial.coins.has("a") && t.partial.coins.has("b"));
  // full is a subset of partial
  for (const x of t.full.coins) assert.ok(t.partial.coins.has(x));
  for (const x of t.full.txs) assert.ok(t.partial.txs.has(x));
});

test("a transaction traces all its inputs together", () => {
  const c = diamond();
  const t = traceTx(c, "t4");
  assert.ok(t.full.txs.has("t4"));
  assert.ok(t.full.coins.has("r"), "the shared origin is in the intersection");
  const single = traceCoins(c, ["t2o1"]);
  assert.deepEqual([...single.full.coins].sort(), [...single.partial.coins].sort());
});

test("under a clustering, the intersection is cluster-wise", () => {
  // the doc's two-coinjoin picture: Alice funds both sessions from one
  // pre-coinjoin history; her spend of one output from each intersects
  // to that history alone
  const c = new Chain();
  c.addRoot("alice", 1_800_000, 0);
  c.addRoot("bob", 850_000, 1);
  c.addRoot("carol", 820_000, 2);
  c.addRoot("dave", 970_000, 3);
  c.addRoot("erin", 930_000, 4);
  c.addTx("aw", 1, ["alice"], [
    { owner: 0, value: 800_000 },
    { owner: 0, value: 1_000_000 - f(1, 2) },
  ], 1);
  // equal-denomination joins the observer declines to partition
  const cjFee = f(3, 6);
  const share = Math.floor(cjFee / 3);
  const rem = cjFee - share * 3;
  c.addTx("cj1", 2, ["awo1", "bob", "carol"], [
    { owner: 0, value: 500_000 }, { owner: 0, value: 300_000 - share },
    { owner: 1, value: 500_000 }, { owner: 1, value: 350_000 - share },
    { owner: 2, value: 500_000 }, { owner: 2, value: 320_000 - share - rem },
  ], 1);
  c.addTx("cj2", 2, ["awo2", "dave", "erin"], [
    { owner: 0, value: 500_000 }, { owner: 0, value: 500_000 - f(1, 2) - share },
    { owner: 3, value: 500_000 }, { owner: 3, value: 470_000 - share },
    { owner: 4, value: 500_000 }, { owner: 4, value: 430_000 - share - rem },
  ], 1);
  // alice links one output of each
  c.addTx("sp", 3, ["cj1o1", "cj2o1"], [{ owner: 0, value: 1_000_000 - f(2, 1) }], 1);
  const cl = clusterObserver(c);
  const t = traceTx(c, "sp", cl);
  // alice's pre-coinjoin root is the only cluster both pasts touch
  assert.ok(t.full.coins.has("alice"));
  assert.ok(t.full.txs.has("aw"));
  for (const other of ["bob", "carol", "dave", "erin"]) {
    assert.ok(!t.full.coins.has(other), `${other} leaked into the intersection`);
    assert.ok(t.partial.coins.has(other), `${other} missing from the union`);
  }
});
