import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { buildIntroChain } from "../src/scenario/intro";

test("payment with change: conservation and fee are exact", () => {
  const chain = new Chain();
  chain.addRoot("r1", 1_000_000, 0);
  const fee = txfee(1, 2, 2.0);
  const tx = chain.addTx("t1", 1, ["r1"], [
    { owner: 1, value: 250_000 },
    { owner: 0, value: 1_000_000 - 250_000 - fee },
  ], 2.0);
  assert.equal(tx.fee, fee);
  assert.equal(chain.coins.get("t1o1")!.value, 250_000);
  assert.equal(chain.coins.get("r1")!.dest, "t1");
});

test("wrong fee is rejected", () => {
  const chain = new Chain();
  chain.addRoot("r1", 1_000_000, 0);
  assert.throws(
    () => chain.addTx("t1", 1, ["r1"], [{ owner: 1, value: 999_000 }], 2.0),
    /fee/,
  );
});

test("double-spend is rejected", () => {
  const chain = new Chain();
  chain.addRoot("r1", 1_000_000, 0);
  const fee = txfee(1, 1, 1.0);
  chain.addTx("t1", 1, ["r1"], [{ owner: 1, value: 1_000_000 - fee }], 1.0);
  assert.throws(
    () => chain.addTx("t2", 2, ["r1"], [{ owner: 1, value: 1_000_000 - fee }], 1.0),
    /double-spend/,
  );
});

test("an input listed twice is rejected, not double-counted", () => {
  // summing ["r1","r1"] would inflate supply by r1's value; dest
  // assignment is idempotent so nothing else would catch it
  const chain = new Chain();
  chain.addRoot("r1", 1_000_000, 0);
  const fee = txfee(2, 1, 1.0);
  assert.throws(
    () => chain.addTx("t1", 1, ["r1", "r1"], [{ owner: 1, value: 2_000_000 - fee }], 1.0),
    /listed twice/,
  );
});

test("a rejected transaction mutates nothing", () => {
  const chain = new Chain();
  chain.addRoot("r1", 1_000_000, 0);
  // occupy the would-be output id so the commit-time namespace check
  // would fire after inputs were already marked spent under the old order
  chain.addRoot("t1o1", 5_000, 1);
  const fee = txfee(1, 1, 1.0);
  assert.throws(
    () => chain.addTx("t1", 1, ["r1"], [{ owner: 1, value: 1_000_000 - fee }], 1.0),
    /duplicate coin/,
  );
  assert.equal(chain.coins.get("r1")!.dest, null, "input marked spent by a rejected tx");
  assert.equal(chain.txs.size, 0);
});

test("unknown input is rejected", () => {
  const chain = new Chain();
  assert.throws(
    () => chain.addTx("t1", 1, ["ghost"], [{ owner: 0, value: 1 }], 1.0),
    /unknown input/,
  );
});

test("intro chain is valid and stable", () => {
  const chain = buildIntroChain();
  assert.equal(chain.order.length, 3);
  // every non-root coin's producer/dest links are consistent
  for (const coin of chain.coins.values()) {
    if (coin.producer) assert.ok(chain.txs.get(coin.producer)!.outputs.includes(coin.id));
    if (coin.dest) assert.ok(chain.txs.get(coin.dest)!.inputs.includes(coin.id));
  }
  // unspent set: Alice's café change, the café's coin, Bob's change, the shop's coin
  assert.equal(chain.utxos().length, 4);
  // the digest is deterministic (two builds agree)
  assert.equal(chain.describe(), buildIntroChain().describe());
});
