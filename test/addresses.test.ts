import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain, addrKey, addrText, type Coin } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { Economy } from "../src/engine/economy";
import { CARELESS } from "../src/scenario/cast";
import { clusterObserver } from "../src/analysis/clusters";
import { withoutMethod } from "../src/analysis/provenance";

/** a payment (0 pays 1) then a payjoin-shaped spend: 0 and 1 both bring
 *  an input; the payment output carries both users' funds */
function toyChain(): Chain {
  const c = new Chain();
  c.addRoot("r1", 500_000, 0);
  c.addRoot("r2", 300_000, 1);
  c.addTx("t1", 1, ["r1"], [
    { owner: 1, value: 120_000 },
    { owner: 0, value: 500_000 - 120_000 - txfee(1, 2, 2) },
  ], 2);
  const pay = 120_000 + 50_000; // payee's input rides along inside
  c.addTx("t2", 2, ["t1o2", "t1o1"], [
    { owner: 1, value: pay, funders: [0, 1] },
    { owner: 0, value: (500_000 - 120_000 - txfee(1, 2, 2)) - 50_000 - txfee(2, 2, 2), funders: [0] },
  ], 2);
  c.assignAddresses(new Set());
  return c;
}

test("address derivation: branch follows whose funds an output carries", () => {
  const chain = toyChain();
  const a = (id: string): Coin["addr"] => chain.coins.get(id)!.addr;

  // deposits from outside land on the external branch
  assert.deepEqual(a("r1"), { who: 0, branch: "external", index: 0 });
  assert.deepEqual(a("r2"), { who: 1, branch: "external", index: 0 });
  // a payment received is external; change back to the payer is internal
  assert.equal(a("t1o1")!.branch, "external");
  assert.equal(a("t1o1")!.who, 1);
  assert.equal(a("t1o2")!.branch, "internal");
  assert.equal(a("t1o2")!.who, 0);
  // the payjoin-shaped payment output carries two users' funds: a
  // receive, external — not the payee's wallet paying itself
  assert.equal(a("t2o1")!.branch, "external");
  assert.equal(a("t2o2")!.branch, "internal");
  // fresh discipline: indices advance per (owner, branch)
  assert.equal(a("t2o1")!.index, 2); // owner 1's third external (after r2, t1o1)
  assert.equal(a("t2o2")!.index, 1); // owner 0's second internal (after t1o2)
});

test("remove-one-method: a reuse-only link dissolves when the method is off", () => {
  const c = new Chain();
  c.addRoot("r1", 100_000, 5);
  c.addRoot("r2", 80_000, 5);
  c.assignAddresses(new Set([5]));
  assert.equal(addrKey(c.coins.get("r1")!.addr!), addrKey(c.coins.get("r2")!.addr!));
  const cl = clusterObserver(c);
  assert.equal(cl.rep.get("r1"), cl.rep.get("r2"));
  // two unspent savings share nothing but the address: no transaction
  // exists for any other method to read
  assert.equal(withoutMethod(c, undefined, "reuse", "r1", "r2"), false);
  assert.equal(withoutMethod(c, undefined, "cioh", "r1", "r2"), true);
});

test("fresh wallets never share an address; the walk is stable as the chain grows", () => {
  const eco = new Economy("welcome");
  eco.runTo(20);
  const early = new Map(
    [...eco.chain.coins.values()].map((c) => [c.id, addrKey(c.addr!)]),
  );
  eco.runTo(40);
  const reused = new Map<string, string[]>();
  for (const c of eco.chain.coins.values()) {
    assert.ok(c.addr, `${c.id} has no address`);
    const k = addrKey(c.addr);
    reused.set(k, [...(reused.get(k) ?? []), c.id]);
    // a coin's address never changes once assigned (day 20 vs day 40)
    const before = early.get(c.id);
    if (before !== undefined) assert.equal(k, before, `${c.id} moved address`);
  }
  // every address holding two or more coins belongs to a reuser — in the
  // default cast, Carol and no one else
  for (const [k, ids] of reused) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      assert.equal(eco.chain.coins.get(id)!.owner, CARELESS, `${k} shared by a fresh wallet`);
    }
  }
  // and Carol reuses for real: one address, all her coins on it
  const carols = [...eco.chain.coins.values()].filter((c) => c.owner === CARELESS);
  assert.ok(carols.length >= 3, "Carol has too few coins to exercise reuse");
  assert.equal(new Set(carols.map((c) => addrKey(c.addr!))).size, 1);
  assert.deepEqual(carols[0]!.addr, { who: CARELESS, branch: "external", index: 0 });
});

test("the observer links reused addresses with no inference at all", () => {
  const eco = new Economy("welcome");
  eco.runTo(30);
  // reuse alone: everything the map welds is a genuinely shared address
  const cl = clusterObserver(eco.chain, undefined,
    { reuse: true, cioh: false, change: false, subsum: false });
  const carols = [...eco.chain.coins.values()].filter((c) => c.owner === CARELESS).map((c) => c.id);
  const reps = new Set(carols.map((id) => cl.rep.get(id)!));
  assert.equal(reps.size, 1, "Carol's coins should share one cluster");
  // the welds carry the address observed, not a transaction
  const welds = cl.welds.filter((w) => w.method === "reuse");
  assert.ok(welds.length >= 1);
  for (const w of welds) {
    assert.equal(w.tx, undefined);
    assert.match(w.addr!, /^bc1p[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/);
    // inference-free means never wrong: one true owner per weld
    assert.equal(new Set(w.coins.map((c) => eco.chain.coins.get(c)!.owner)).size, 1);
  }
  // no one else clusters: reuse finds Carol and only Carol
  for (const [rep, members] of cl.members) {
    if (members.length < 2) continue;
    assert.equal(eco.chain.coins.get(rep)!.owner, CARELESS);
  }
});

test("addrText is deterministic, bech32m-flavored, and blind to the path", () => {
  const a = { who: 3, branch: "external" as const, index: 7 };
  assert.equal(addrText(a), addrText({ ...a }));
  assert.match(addrText(a), /^bc1p[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/);
  // nearby paths land on unrelated strings
  assert.notEqual(addrText(a), addrText({ ...a, index: 8 }));
  assert.notEqual(addrText(a), addrText({ ...a, branch: "internal" }));
  assert.notEqual(addrText(a), addrText({ ...a, who: 4 }));
});
