import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { Economy } from "../src/engine/economy";

/** a 3-day toy chain: t1 on day 1 spends a root, t2 on day 2 spends t1's
 *  change, t3 on day 3 spends t1's payment output */
function toyChain(): Chain {
  const c = new Chain();
  c.addRoot("r1", 100_000, 0);
  c.addTx("t1", 1, ["r1"], [
    { owner: 1, value: 40_000 },
    { owner: 0, value: 60_000 - txfee(1, 2, 2) },
  ], 2);
  c.addTx("t2", 2, ["t1o2"], [
    { owner: 2, value: 20_000 },
    { owner: 0, value: 60_000 - txfee(1, 2, 2) - 20_000 - txfee(1, 2, 2) },
  ], 2);
  c.addTx("t3", 3, ["t1o1"], [
    { owner: 3, value: 40_000 - txfee(1, 1, 2) },
  ], 2);
  return c;
}

test("through(day) hides later transactions and re-opens later spends", () => {
  const chain = toyChain();
  const cut = chain.through(1);

  // only day-1 history remains
  assert.deepEqual(cut.order, ["t1"]);
  assert.ok(!cut.txs.has("t2") && !cut.txs.has("t3"));

  // coins produced after the cursor vanish; earlier ones stay
  assert.ok(!cut.coins.has("t2o1"));
  assert.ok(cut.coins.has("r1") && cut.coins.has("t1o1") && cut.coins.has("t1o2"));

  // a coin spent in the cursor's future reads as unspent again
  assert.equal(cut.coins.get("t1o1")!.dest, null);
  assert.equal(cut.coins.get("t1o2")!.dest, null);
  // one consumed on or before the cursor stays consumed
  assert.equal(cut.coins.get("r1")!.dest, "t1");

  // the truncation is a view: the full record is untouched
  assert.equal(chain.coins.get("t1o1")!.dest, "t3");
  assert.deepEqual(chain.order, ["t1", "t2", "t3"]);
});

test("through(day) at the frontier reproduces the whole record", () => {
  const chain = toyChain();
  assert.equal(chain.through(3).describe(), chain.describe());
  assert.equal(chain.through(99).describe(), chain.describe());
});

test("rewinding an economy shows exactly the prefix it recorded", () => {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cut = eco.chain.through(40);

  const ref = new Economy("welcome");
  ref.runTo(40);
  // same transactions in the same order, same spent/unspent frontier
  assert.equal(cut.describe(), ref.chain.describe());
  assert.deepEqual(
    cut.utxos().map((c) => c.id).sort(),
    ref.chain.utxos().map((c) => c.id).sort(),
  );
});
