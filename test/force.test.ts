import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIntroChain } from "../src/scenario/intro";
import { Economy } from "../src/engine/economy";
import { layoutForce, coinPillW } from "../src/ui/force";
import { fmtSats } from "../src/core/sats";

test("force layout: every coin and tx gets a vertex, flagged radial", () => {
  const chain = buildIntroChain();
  const bip = layoutForce(chain);
  assert.equal(bip.coins.size, chain.coins.size);
  assert.equal(bip.txs.size, chain.txs.size);
  assert.equal(bip.radial, true);
});

test("force layout: coin pills fit their value labels", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  const bip = layoutForce(eco.chain);
  for (const coin of eco.chain.coins.values()) {
    const r = bip.coins.get(coin.id)!;
    assert.equal(r.w, coinPillW(coin.value));
    // the fit rule itself: wider labels get wider pills
    assert.ok(r.w >= 22 + 7 * fmtSats(coin.value).length, `${coin.id} pill too narrow`);
  }
});

test("force layout: no two node frames overlap", () => {
  const eco = new Economy("golden");
  eco.runTo(40);
  const bip = layoutForce(eco.chain);
  const frames = [
    ...[...bip.coins.entries()].map(([id, r]) => ({ id, r })),
    ...[...bip.txs.entries()].map(([id, r]) => ({ id, r })),
  ];
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const a = frames[i]!.r, b = frames[j]!.r;
      const overlap =
        a.x < b.x + b.w && b.x < a.x + a.w &&
        a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${frames[i]!.id} overlaps ${frames[j]!.id}`);
    }
  }
});

test("force layout: deterministic — same chain, same drawing", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  const a = layoutForce(eco.chain);
  const b = layoutForce(eco.chain);
  for (const [id, ra] of a.coins) {
    const rb = b.coins.get(id)!;
    assert.deepEqual(ra, rb, `coin ${id} moved between runs`);
  }
  for (const [id, ra] of a.txs) {
    const rb = b.txs.get(id)!;
    assert.deepEqual(ra, rb, `tx ${id} moved between runs`);
  }
});
