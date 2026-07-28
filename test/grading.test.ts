import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeMap } from "../src/analysis/grading";
import { type Clustering } from "../src/analysis/observer";

// a Clustering with just the partition filled in — gradeMap reads
// only rep/members
function clustering(groups: string[][]): Clustering {
  const rep = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const g of groups) {
    for (const id of g) rep.set(id, g[0]!);
    members.set(g[0]!, [...g]);
  }
  return {
    rep, members, rank: new Map(),
    changeGuess: new Map(), payGuess: new Map(), changeReads: new Map(),
    links: [],
  };
}

test("gradeMap: totals, tail callouts, and gathered counts", () => {
  // owners: a1..a4 -> 0, b1..b3 -> 1, c1 -> 2, x1 -> null
  const owner = (id: string): number | null =>
    id.startsWith("a") ? 0 : id.startsWith("b") ? 1 : id.startsWith("c") ? 2 : null;
  // largest stack (4): three of owner 0 + one stray of owner 1;
  // second stack (2): one of owner 1 + the outside coin;
  // singletons: a4, b3, c1 — claim nothing
  const cl = clustering([
    ["a1", "a2", "a3", "b1"],
    ["b2", "x1"],
    ["a4"], ["b3"], ["c1"],
  ]);
  const g = gradeMap(cl, owner)!;
  assert.equal(g.stacks, 2);
  assert.equal(g.stacked, 6);
  // b1 is misplaced in the big stack; the 2-stack splits 1/1, one wrong
  assert.equal(g.misplaced, 2);
  assert.equal(g.largest, 4);
  assert.equal(g.misplacedInLargest, 1);
  assert.equal(g.median, 3); // sizes [2,4] -> 3
  // owner 0 holds 4 coins, best stack gathers 3; owner 1 holds 3, best
  // gathers 1 (b1/b2/b3 all apart); owner 2 and null hold 1 each — out
  assert.equal(g.gathered, 4);
  assert.equal(g.gatherable, 7);
});

test("gradeMap: a perfect map grades clean", () => {
  const owner = (id: string): number | null => (id.startsWith("a") ? 0 : 1);
  const g = gradeMap(clustering([["a1", "a2", "a3"], ["b1", "b2"]]), owner)!;
  assert.equal(g.misplaced, 0);
  assert.equal(g.misplacedInLargest, 0);
  assert.equal(g.gathered, 5);
  assert.equal(g.gatherable, 5);
});

test("gradeMap: all singletons means no map to grade", () => {
  assert.equal(gradeMap(clustering([["a1"], ["b1"]]), () => 0), null);
});
