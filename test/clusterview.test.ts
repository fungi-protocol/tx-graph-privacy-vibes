// The contracted view's truth paint and repartition animation: paint
// is the town's ground truth over the lens's partition (a mixed vertex
// renders every true owner, largest share first), and a heuristic
// toggle animates old discs merging into / splitting out of the new
// ones. Both are pure geometry/bookkeeping — neither feeds any
// analysis — but their honesty is load-bearing: the slices must sum to
// the whole cluster, and every fragment must come from a real old disc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { truthSlices, transitionFragments, layoutClusterGraph } from "../src/ui/clusterview";
import { type Clustering } from "../src/analysis/clusters";
import { clusterObserver } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";

function partition(groups: string[][]): Clustering {
  const rep = new Map<string, string>();
  const members = new Map<string, string[]>();
  const rank = new Map<string, number>();
  [...groups]
    .sort((a, b) => b.length - a.length)
    .forEach((g, i) => {
      members.set(g[0]!, g);
      rank.set(g[0]!, i + 1);
      for (const id of g) rep.set(id, g[0]!);
    });
  return { rep, members, rank, changeGuess: new Map(), welds: [] } as unknown as Clustering;
}

test("truthSlices: a pure cluster is one slice, a mixed one lists every owner largest-first summing to 1", () => {
  const cl = partition([["a1", "a2", "b1"], ["c1"]]);
  const colorOf = (id: string): string => (id.startsWith("a") ? "#aaa" : id.startsWith("b") ? "#bbb" : "#ccc");
  const mixed = truthSlices(cl, "a1", colorOf);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed[0], { color: "#aaa", frac: 2 / 3 });
  assert.deepEqual(mixed[1], { color: "#bbb", frac: 1 / 3 });
  assert.ok(Math.abs(mixed.reduce((s, x) => s + x.frac, 0) - 1) < 1e-12);
  const pure = truthSlices(cl, "c1", colorOf);
  assert.equal(pure.length, 1);
  assert.deepEqual(pure[0], { color: "#ccc", frac: 1 });
});

test("transitionFragments: a merge starts as both old discs, a split starts as one disc twice", () => {
  const oldCl = partition([["a1", "a2"], ["b1", "b2"]]);
  const oldClay = layoutClusterGraph(oldCl);
  // merge: one new cluster swallowing both old ones -> two fragments,
  // each at its old disc's position with its full old radius
  const merged = partition([["a1", "a2", "b1", "b2"]]);
  const mf = transitionFragments(oldCl, oldClay, merged);
  const frags = mf.get("a1")!;
  assert.equal(frags.length, 2);
  const oldA = oldClay.nodes.get("a1")!, oldB = oldClay.nodes.get("b1")!;
  for (const o of [oldA, oldB]) {
    assert.ok(frags.some((f) => f.x === o.x && f.y === o.y && Math.abs(f.r - o.r) < 1e-9),
      "each fragment starts at a real old disc");
  }
  // split: the reverse direction — each new cluster starts as a piece
  // of the same old disc (they glide apart from one point)
  const wide = partition([["a1", "a2", "b1", "b2"]]);
  const wideClay = layoutClusterGraph(wide);
  const sf = transitionFragments(wide, wideClay, oldCl);
  const fa = sf.get("a1")!, fb = sf.get("b1")!;
  assert.equal(fa.length, 1);
  assert.equal(fb.length, 1);
  assert.equal(fa[0]!.x, fb[0]!.x);
  assert.equal(fa[0]!.y, fb[0]!.y);
  const whole = wideClay.nodes.get("a1")!;
  assert.ok(fa[0]!.r < whole.r, "a piece is smaller than the disc it leaves");
});

test("truth paint stays honest on a real run: every observer vertex's slices sum to 1 and mixed vertices exist to expose", () => {
  for (const seed of ["welcome", "golden"]) {
    const eco = new Economy(seed);
    eco.runTo(115);
    const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
    const colorOf = (id: string): string => String(eco.chain.coins.get(id)!.owner ?? "~");
    let mixed = 0;
    for (const rep of cl.members.keys()) {
      const slices = truthSlices(cl, rep, colorOf);
      assert.ok(slices.length >= 1);
      assert.ok(Math.abs(slices.reduce((s, x) => s + x.frac, 0) - 1) < 1e-9, `${seed}: fractions sum to 1`);
      for (let i = 1; i < slices.length; i++) {
        assert.ok(slices[i - 1]!.frac >= slices[i]!.frac, `${seed}: largest share first`);
      }
      if (slices.length > 1) mixed += 1;
    }
    // the device has something to show: the observer's map really does
    // weld different people together somewhere by day 115
    assert.ok(mixed >= 1, `${seed}: no mixed cluster to expose`);
  }
});
