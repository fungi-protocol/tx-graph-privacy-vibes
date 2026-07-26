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

test("force layout: shown set restricts the physics, not the rect table", () => {
  const eco = new Economy("golden");
  eco.runTo(30);
  // keep one transaction's neighborhood: the tx, its inputs and outputs
  const tid = eco.chain.order[Math.floor(eco.chain.order.length / 2)]!;
  const tx = eco.chain.txs.get(tid)!;
  const shown = new Set<string>([tid, ...tx.inputs, ...tx.outputs]);
  const bip = layoutForce(eco.chain, shown);
  // every node still resolves — the renderer looks all of them up
  assert.equal(bip.coins.size, eco.chain.coins.size);
  assert.equal(bip.txs.size, eco.chain.txs.size);
  // the camera frames only the shown sub-graph: every shown rect sits
  // inside the bounds, and the bounds are tight around shown rects only
  const rectOf = (id: string) => bip.coins.get(id) ?? bip.txs.get(id)!;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of shown) {
    const r = rectOf(id)!;
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  assert.equal(bip.bounds.x, minX);
  assert.equal(bip.bounds.y, minY);
  assert.equal(bip.bounds.w, maxX - minX);
  assert.equal(bip.bounds.h, maxY - minY);
  // shown nodes still keep clear of one another
  const frames = [...shown].map((id) => ({ id, r: rectOf(id)! }));
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
