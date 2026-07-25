import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { PERSONAS } from "../src/scenario/cast";

// Characterization of the execution layer: how wallets pick coins is
// behavior (varied by the seeded dice), and the variation keeps wallets
// looking like wallets — a spread of coins, the occasional multi-input
// spend — instead of collapsing into one endlessly peeled coin.
// Bounds probed across six seeds at the defaults.

const CHECKPOINTS = [30, 60, 90, 118];

function walletSizes(eco: Economy): number[] {
  const held = new Map<number, number>();
  for (const c of eco.chain.utxos()) {
    if (c.owner !== null) held.set(c.owner, (held.get(c.owner) ?? 0) + 1);
  }
  return [...held.values()].sort((a, b) => a - b);
}

test("wallets hold a spread of coins at every tutorial checkpoint", () => {
  for (const seed of ["golden", "welcome", "silver"]) {
    const eco = new Economy(seed);
    for (const day of CHECKPOINTS) {
      eco.runTo(day);
      const sizes = walletSizes(eco);
      // the town grows as the story needs it (#15): only personas who have
      // moved in are expected to hold coins
      const arrived = PERSONAS.filter((p) => (p.arrives ?? 0) <= day).length;
      assert.ok(sizes.length >= arrived, `${seed} d${day}: someone's wallet emptied out`);
      assert.ok(sizes[0]! >= 1, `${seed} d${day}: a persona holds nothing`);
      assert.ok(sizes[Math.floor(sizes.length / 2)]! >= 4,
        `${seed} d${day}: median wallet peeled down to ${sizes[Math.floor(sizes.length / 2)]} coins`);
    }
  }
});

test("some spends take more than one input — occasionally, not mostly", () => {
  for (const seed of ["golden", "welcome", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(130);
    const unil = eco.events.filter((e) =>
      e.form === "unilateral" && !e.memo.startsWith("batch"));
    const multi = unil.filter((e) => eco.chain.txs.get(e.tid)!.inputs.length >= 2).length;
    const share = multi / unil.length;
    assert.ok(share >= 0.05, `${seed}: only ${multi}/${unil.length} multi-input spends`);
    assert.ok(share <= 0.6, `${seed}: ${multi}/${unil.length} spends consolidate — wallets read as frantic`);
  }
});

test("selection variation is deterministic per seed", () => {
  const a = new Economy("golden");
  const b = new Economy("golden");
  a.runTo(60);
  b.runTo(60);
  assert.equal(a.chain.describe(), b.chain.describe());
  // and it genuinely varies: not every spend is the single smallest coin
  const multi = a.chain.order.filter((tid) => a.chain.txs.get(tid)!.inputs.length >= 2);
  assert.ok(multi.length > 0, "no spend ever took a second coin");
});
