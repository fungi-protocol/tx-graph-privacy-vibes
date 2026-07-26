import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { clusterObserver } from "../src/analysis/clusters";
import {
  partitionColumns, clusterAdjacency, nsSimilarity, nsSocialRun, nsApply,
  matchComponents, matchState, activePairs, type NsEvent,
} from "../src/analysis/nssocial";
import { layoutClusterColumns } from "../src/ui/clusterview";

function golden(days: number) {
  const eco = new Economy("golden");
  eco.runTo(days);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  return { eco, cl };
}

test("ns-social: the partition splits the timeline into contiguous columns", () => {
  const { eco, cl } = golden(60);
  const col = partitionColumns(cl, eco.chain, 2);
  assert.equal(col.size, cl.members.size);
  const counts = [0, 0];
  for (const c of col.values()) counts[c]!++;
  // both epochs populated, and the halves are as even as parity allows
  assert.ok(counts[0]! > 0 && counts[1]! > 0);
  assert.ok(Math.abs(counts[0]! - counts[1]!) <= 1);
});

test("ns-social: similarity favors the pair with the shared neighborhood", () => {
  // hand-built contracted graph: a and b both trade heavily with n1 and
  // n2; c trades with strangers. No chain needed — the score reads the
  // adjacency alone.
  const adj = new Map([
    ["a", new Map([["n1", 3], ["n2", 2]])],
    ["b", new Map([["n1", 2], ["n2", 3]])],
    ["c", new Map([["x1", 4], ["x2", 1]])],
    ["n1", new Map([["a", 3], ["b", 2]])],
    ["n2", new Map([["a", 2], ["b", 3]])],
    ["x1", new Map([["c", 4]])],
    ["x2", new Map([["c", 1]])],
  ]) as Map<string, Map<string, number>>;
  const comp = matchComponents(adj.keys(), []);
  const membersOf = (l: string) => [l];
  const twins = nsSimilarity(adj, comp, membersOf, "a", "b");
  const strangers = nsSimilarity(adj, comp, membersOf, "a", "c");
  assert.ok(twins > 0.9, `twins score ${twins}`);
  assert.equal(strangers, 0);
});

test("ns-social: matches count as one coordinate once accepted", () => {
  // d neighbors n1; e neighbors n2; with n1 and n2 matched, d and e
  // suddenly share a neighborhood
  const adj = new Map([
    ["d", new Map([["n1", 2]])],
    ["e", new Map([["n2", 2]])],
    ["n1", new Map([["d", 2]])],
    ["n2", new Map([["e", 2]])],
  ]) as Map<string, Map<string, number>>;
  const before = matchComponents(adj.keys(), []);
  const membersOf1 = (l: string) => [l];
  assert.equal(nsSimilarity(adj, before, membersOf1, "d", "e"), 0);
  const after = matchComponents(adj.keys(), [["n1", "n2"]]);
  const membersOf2 = (l: string) => (l === "n1" ? ["n1", "n2"] : [l]);
  assert.equal(nsSimilarity(adj, after, membersOf2, "d", "e"), 1);
});

test("ns-social: a threshold above cosine's ceiling admits nothing", () => {
  const { eco, cl } = golden(60);
  const events = nsSocialRun(cl, eco.chain, 1.01);
  assert.equal(events.length, 0);
});

test("ns-social: the run is deterministic and merges only across columns", () => {
  const { eco, cl } = golden(80);
  const a = nsSocialRun(cl, eco.chain, 0.4);
  const b = nsSocialRun(cl, eco.chain, 0.4);
  assert.deepEqual(a, b);
  const col = partitionColumns(cl, eco.chain, 2);
  // replay: at every merge, the two components' column sets are disjoint
  const seen: NsEvent[] = [];
  for (const e of a) {
    if (e.kind === "merge") {
      const { comp, membersOf } = matchState(cl, seen);
      const cols = (l: string) => new Set(membersOf(comp.get(l)!).map((r) => col.get(r)!));
      const ca = cols(e.a), cb = cols(e.b);
      for (const c of cb) assert.ok(!ca.has(c), `merge ${e.a}+${e.b} shares column ${c}`);
    }
    seen.push(e);
  }
});

test("ns-social: a moderate threshold finds at least one match on golden", () => {
  const { eco, cl } = golden(80);
  const events = nsSocialRun(cl, eco.chain, 0.4);
  assert.ok(events.some((e) => e.kind === "merge"),
    "expected the propagation to admit at least one pair at 0.4");
});

test("ns-social: nsApply fuses matched clusters and preserves every coin", () => {
  const { eco, cl } = golden(80);
  const events = nsSocialRun(cl, eco.chain, 0.4);
  const merged = nsApply(cl, events);
  const before = [...cl.members.values()].reduce((s, m) => s + m.length, 0);
  const after = [...merged.members.values()].reduce((s, m) => s + m.length, 0);
  assert.equal(after, before);
  assert.equal(merged.rep.size, cl.rep.size);
  const pairs = activePairs(events);
  assert.equal(merged.members.size, cl.members.size - pairs.length);
  for (const [a, b] of pairs) {
    assert.equal(merged.rep.get(a), merged.rep.get(b), `${a} and ${b} should share a vertex`);
  }
  // ranks are a permutation of 1..k
  const ranks = [...merged.rank.values()].sort((x, y) => x - y);
  ranks.forEach((r, i) => assert.equal(r, i + 1));
});

test("ns-social: a split retracts the merge in the applied clustering", () => {
  const { cl } = golden(60);
  const reps = [...cl.members.keys()].sort();
  const [a, b] = [reps[0]!, reps[1]!];
  const merged = nsApply(cl, [{ kind: "merge", a, b, score: 0.5 }]);
  assert.equal(merged.rep.get(a), merged.rep.get(b));
  const split = nsApply(cl, [
    { kind: "merge", a, b, score: 0.5 },
    { kind: "split", a, b, score: 0.1 },
  ]);
  assert.notEqual(split.rep.get(a), split.rep.get(b));
  assert.equal(split.members.size, cl.members.size);
});

test("ns-social: the partitioned circle opens into columns, matches span lanes", () => {
  const { eco, cl } = golden(80);
  const col = partitionColumns(cl, eco.chain, 2);
  const reps = [...cl.members.keys()];
  const a = reps.find((r) => col.get(r) === 0)!;
  const b = reps.find((r) => col.get(r) === 1)!;
  const events: NsEvent[] = [{ kind: "merge", a, b, score: 0.9 }];
  const applied = nsApply(cl, events);
  const lanes = new Map<string, number[]>();
  for (const rep of applied.members.keys()) lanes.set(rep, []);
  for (const [baseRep, lane] of col) {
    const leader = applied.rep.get(baseRep)!;
    const l = lanes.get(leader)!;
    if (!l.includes(lane)) l.push(lane);
  }
  for (const l of lanes.values()) l.sort((x, y) => x - y);
  const clay = layoutClusterColumns(applied, eco.chain, lanes, 2);
  // unmatched vertices sit on their lane's x; the fused pair between them
  const xs = new Set<number>();
  const fused = applied.rep.get(a)!;
  for (const node of clay.nodes.values()) {
    if (node.rep === fused) continue;
    xs.add(node.x);
  }
  assert.equal(xs.size, 2, `expected two lanes, got x values ${[...xs].join(", ")}`);
  const [x0, x1] = [...xs].sort((p, q) => p - q);
  assert.ok(x0! < x1!);
  const mid = clay.nodes.get(fused)!;
  assert.ok(Math.abs(mid.x - (x0! + x1!) / 2) < 1e-6,
    `fused vertex at ${mid.x}, lanes at ${x0} and ${x1}`);
  // deterministic
  const again = layoutClusterColumns(applied, eco.chain, lanes, 2);
  for (const [rep, n] of clay.nodes) {
    const m = again.nodes.get(rep)!;
    assert.deepEqual({ x: n.x, y: n.y }, { x: m.x, y: m.y }, `${rep} moved`);
  }
});

test("ns-social: within a lane no two vertices share a slot", () => {
  const { eco, cl } = golden(60);
  const col = partitionColumns(cl, eco.chain, 2);
  const lanes = new Map<string, number[]>();
  for (const [rep, lane] of col) lanes.set(rep, [lane]);
  const clay = layoutClusterColumns(cl, eco.chain, lanes, 2);
  const byLane = new Map<number, { y: number; r: number }[]>();
  for (const node of clay.nodes.values()) {
    const g = byLane.get(node.x) ?? [];
    g.push({ y: node.y, r: node.r });
    byLane.set(node.x, g);
  }
  for (const g of byLane.values()) {
    g.sort((p, q) => p.y - q.y);
    for (let i = 1; i < g.length; i++) {
      assert.ok(g[i]!.y - g[i]!.r >= g[i - 1]!.y + g[i - 1]!.r,
        `vertices overlap vertically at y=${g[i]!.y}`);
    }
  }
});
