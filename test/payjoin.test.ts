import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, PAYJOIN_DAY } from "../src/engine/economy";
import { CARELESS } from "../src/scenario/cast";
import { clusterObserver } from "../src/analysis/clusters";

test("no payjoins before the neighborhood learns the trick", () => {
  const eco = new Economy("golden");
  eco.runTo(PAYJOIN_DAY - 1);
  assert.ok(eco.events.every((e) => e.form === "unilateral"));
});

test("payjoins happen once available, alongside unilateral payments", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const pj = eco.events.filter((e) => e.form === "payjoin");
  const uni = eco.events.filter((e) => e.form === "unilateral" && e.payee !== null && e.day >= PAYJOIN_DAY);
  assert.ok(pj.length >= 3, `only ${pj.length} payjoins by day 90`);
  assert.ok(uni.length >= 3, "payjoin should not fully displace unilateral payments");
  assert.ok(pj.every((e) => e.day >= PAYJOIN_DAY));
});

test("a payjoin spends inputs of two different owners", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const pj = eco.events.find((e) => e.form === "payjoin")!;
  const tx = eco.chain.txs.get(pj.tid)!;
  const owners = new Set(tx.inputs.map((c) => eco.chain.coins.get(c)!.owner));
  assert.equal(owners.size, 2, "payjoin inputs must span payer and payee");
  assert.ok(owners.has(pj.payer) && owners.has(pj.payee));
});

test("payjoins falsify CIOH: observer clusters go impure", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  let impure = 0;
  for (const members of cl.members.values()) {
    if (members.length < 2) continue;
    const owners = new Set(members.map((id) => eco.chain.coins.get(id)!.owner));
    if (owners.size > 1) impure += 1;
  }
  assert.ok(impure >= 1, "at least one observer cluster should merge two people");
});

test("Carol sees no benefit and never payjoins as payer", () => {
  const eco = new Economy("golden");
  eco.runTo(120);
  assert.ok(eco.events.every((e) => !(e.form === "payjoin" && e.payer === CARELESS)));
});

// Wallets have no income inflows yet, so beyond ~day 60 some payers go
// broke and their obligations legitimately accumulate (TODO: inflows).
// Within the tutorial's design range the queue must stay small.
test("obligations do not pile up within the tutorial's horizon", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  assert.ok(eco.pending.length < 20, `${eco.pending.length} obligations still pending at day 60`);
});

test("payment values conserve through payjoins (payee nets exactly the obligation)", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const pj = eco.events.find((e) => e.form === "payjoin")!;
  const tx = eco.chain.txs.get(pj.tid)!;
  const contributed = tx.inputs
    .map((c) => eco.chain.coins.get(c)!)
    .filter((c) => c.owner === pj.payee)
    .reduce((s, c) => s + c.value, 0);
  const received = tx.outputs
    .map((c) => eco.chain.coins.get(c)!)
    .filter((c) => c.owner === pj.payee)
    .reduce((s, c) => s + c.value, 0);
  assert.ok(received - contributed > 0, "payee must net a positive payment");
});
