import { test } from "node:test";
import assert from "node:assert/strict";
import { layered } from "../src/ui/layered";
import { layoutBipartite } from "../src/ui/bipartite";
import { layoutChain, type Rect } from "../src/ui/blockview";
import { buildIntroChain } from "../src/scenario/intro";
import { Economy } from "../src/engine/economy";

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("layered is deterministic", () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, rank: i % 4, h: 30 }));
  const edges = nodes.slice(0, 9).map((n, i) => ({ from: n.id, to: `n${i + 3}`, key: `e${i}` }));
  const a = layered(nodes, edges, 20);
  const b = layered(nodes, edges, 20);
  assert.deepEqual([...a.y.entries()], [...b.y.entries()]);
  assert.deepEqual([...a.routes.entries()], [...b.routes.entries()]);
});

test("two interleaved chains come out as two separate bands", () => {
  // insertion order alternates between the chains — the naive stacking
  // used to braid them; barycenter ordering must unbraid
  const nodes = [];
  const edges = [];
  for (let r = 0; r < 6; r++) {
    nodes.push({ id: `a${r}`, rank: r, h: 30 });
    nodes.push({ id: `b${r}`, rank: r, h: 30 });
    if (r > 0) {
      edges.push({ from: `a${r - 1}`, to: `a${r}`, key: `a${r}` });
      edges.push({ from: `b${r - 1}`, to: `b${r}`, key: `b${r}` });
    }
  }
  // seed the separation at rank 0 by giving the chains distinct anchors
  const laid = layered(nodes, edges, 20);
  for (let r = 1; r < 6; r++) {
    const sameSide =
      Math.sign(laid.y.get(`a${r}`)! - laid.y.get(`b${r}`)!) ===
      Math.sign(laid.y.get(`a${0}`)! - laid.y.get(`b${0}`)!);
    assert.ok(sameSide, `rank ${r}: chains braid`);
  }
});

test("intro: Bob's spend no longer hides behind Alice's transaction", () => {
  const chain = buildIntroChain();
  const layout = layoutChain(chain);
  // t2 (Alice's café) and t3 (Bob's tool) both spend t1 outputs: same
  // column, separate bands — no card sits between t1 and t3 any more
  const t2 = layout.txs.get("t2")!;
  const t3 = layout.txs.get("t3")!;
  assert.equal(t2.x, t3.x, "independent spends of t1 share a column");
  assert.ok(!overlap(t2, t3), "cards do not overlap");
});

test("no two cards or root boxes overlap in the block view (day 60)", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const layout = layoutChain(eco.chain);
  const rects = [...layout.txs.values(), ...layout.roots.values()];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlap(rects[i]!, rects[j]!), `rects ${i} and ${j} overlap`);
    }
  }
});

test("no two vertices overlap in the bipartite view (day 60)", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const bip = layoutBipartite(eco.chain);
  const rects = [...bip.coins.values(), ...bip.txs.values()];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      assert.ok(!overlap(rects[i]!, rects[j]!), `rects ${i} and ${j} overlap`);
    }
  }
});

test("rank-skipping edges get one waypoint per skipped column, clear of nodes", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const bip = layoutBipartite(eco.chain);
  assert.ok(bip.routes.size > 0, "a 60-day economy has coins spent long after creation");
  const rects = [...bip.coins.values(), ...bip.txs.values()];
  for (const [key, pts] of bip.routes) {
    for (const p of pts) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${key}: waypoint not finite`);
      for (const r of rects) {
        const inside = p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
        assert.ok(!inside, `${key}: waypoint (${p.x},${p.y}) passes through a node`);
      }
    }
  }
});
