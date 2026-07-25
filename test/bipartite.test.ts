import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIntroChain } from "../src/scenario/intro";
import { layoutBipartite } from "../src/ui/bipartite";

test("bipartite layout: every coin and tx gets a vertex", () => {
  const chain = buildIntroChain();
  const bip = layoutBipartite(chain);
  assert.equal(bip.coins.size, chain.coins.size);
  assert.equal(bip.txs.size, chain.txs.size);
});

test("bipartite layout: time flows left to right", () => {
  const chain = buildIntroChain();
  const bip = layoutBipartite(chain);
  // a coin sits strictly right of its producer and strictly left of its spender
  for (const coin of chain.coins.values()) {
    const c = bip.coins.get(coin.id)!;
    if (coin.producer) {
      const p = bip.txs.get(coin.producer)!;
      assert.ok(c.x > p.x + p.w, `${coin.id} left of its producer`);
    }
    if (coin.dest) {
      const d = bip.txs.get(coin.dest)!;
      assert.ok(c.x + c.w < d.x, `${coin.id} right of its spender`);
    }
  }
});

test("bipartite layout: no overlapping vertices", () => {
  const chain = buildIntroChain();
  const bip = layoutBipartite(chain);
  const rects = [...bip.coins.values(), ...bip.txs.values()];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!, b = rects[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `vertex ${i} overlaps vertex ${j}`);
    }
  }
});
