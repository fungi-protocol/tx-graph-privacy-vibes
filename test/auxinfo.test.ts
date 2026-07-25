// The aux-info knowledge grant (#38): "suppose the adversary learns
// user U's coins" — the assumption is the only truth that enters; what
// follows is computed reachability on the public graph. Both decay
// branches must be REAL: additive (only the granted roots fall; a
// robustly connected past holds the rest) pinned on a hand-built chain,
// multiplicative (granted coins sever routes and origins the grant
// never named fall for free) pinned there AND live on every tutorial
// seed's exhibit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { auxInfoDecay } from "../src/analysis/auxinfo";
import { Economy } from "../src/engine/economy";

const f = (nIn: number, nOut: number): number => txfee(nIn, nOut, 1);

// three roots feeding one join, then a spend: r0 is the target's, r1 is
// U's, r2 reaches the join ONLY through a hop that consolidates it with
// U's coin (the fracture bait). A second variant routes r2 directly, so
// the same grant only costs its own root (the additive case).
function world(fractureBait: boolean): Chain {
  const c = new Chain();
  c.addRoot("r0", 1_000_000, 0);
  c.addRoot("r1", 1_000_000, 1);
  c.addRoot("r2", 1_000_000, 2);
  // U consolidates r1 with r2's descendant — or r2 rides alone
  c.addTx("h2", 1, ["r2"], [{ owner: 2, value: 1_000_000 - f(1, 1) }], 1);
  const joinIns = fractureBait
    ? (c.addTx("h1", 2, ["r1", "h2o1"], [{ owner: 1, value: 2_000_000 - f(1, 1) - f(2, 1) }], 1),
      ["r0", "h1o1"])
    : ["r0", "r1", "h2o1"];
  const inTotal = fractureBait ? 3_000_000 - f(1, 1) - f(2, 1) : 3_000_000 - f(1, 1);
  c.addTx("join", 2, joinIns, [
    { owner: 0, value: 1_500_000 },
    { owner: 1, value: inTotal - 1_500_000 - f(joinIns.length, 2) },
  ], 1);
  c.addTx("spend", 3, ["joino1"], [{ owner: 0, value: 1_500_000 - f(1, 1) }], 1);
  return c;
}

test("additive decay: only the granted root falls when routes hold", () => {
  const c = world(false);
  const granted = new Set(["r1"]); // U's coins: just the root here
  const d = auxInfoDecay(c, "spendo1", granted);
  assert.deepEqual(d, { before: 3, granted: 1, fractured: 0, after: 2 });
});

test("multiplicative decay: a granted boundary coin severs an origin the grant never named", () => {
  const c = world(true);
  // U's coins: root r1 AND the consolidation output h1o1 — the only
  // route from r2 to the join passes through it
  const d = auxInfoDecay(c, "spendo1", new Set(["r1", "h1o1"]));
  assert.equal(d.before, 3);
  assert.equal(d.granted, 1);           // r1 itself
  assert.equal(d.fractured, 1);         // r2 falls without being named
  assert.equal(d.after, 1);             // only the target's own root survives
});

test("the books balance: granted + fractured + after == before, for every grant", () => {
  const eco = new Economy("golden");
  eco.runTo(115);
  const chain = eco.chain;
  const slip = eco.events.find((e) => e.memo === "tidying up the wallet")!;
  const cid = chain.txs.get(slip.tid)!.inputs[0]!;
  const byOwner = new Map<number, Set<string>>();
  for (const [id, c] of chain.coins) {
    if (c.owner === null) continue;
    const s = byOwner.get(c.owner);
    if (s) s.add(id);
    else byOwner.set(c.owner, new Set([id]));
  }
  for (const [u, granted] of byOwner) {
    const d = auxInfoDecay(chain, cid, granted);
    assert.equal(d.granted + d.fractured + d.after, d.before, `user ${u}`);
  }
});

test("the exhibit's multiplicative branch is live on every tutorial seed", () => {
  // mirrors auxGrantExhibit's staging: exclude the traced coin's owner,
  // require a stake, prefer fracture. Every seed must offer a grant
  // whose cut pays beyond its own size — the numbers the step displays.
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(115);
    const chain = eco.chain;
    const slip = eco.events.find((e) => e.memo === "tidying up the wallet");
    assert.ok(slip && chain.txs.has(slip.tid), `${seed}: traced-coin exhibit exists`);
    const cid = chain.txs.get(slip!.tid)!.inputs[0]!;
    const target = chain.coins.get(cid)!.owner;
    const byOwner = new Map<number, Set<string>>();
    for (const [id, c] of chain.coins) {
      if (c.owner === null || c.owner === target) continue;
      const s = byOwner.get(c.owner);
      if (s) s.add(id);
      else byOwner.set(c.owner, new Set([id]));
    }
    let bestFracture = 0;
    for (const granted of byOwner.values()) {
      const d = auxInfoDecay(chain, cid, granted);
      if (d.granted > 0) bestFracture = Math.max(bestFracture, d.fractured);
    }
    assert.ok(bestFracture > 0, `${seed}: some auxiliary name fractures the traced past`);
  }
});
