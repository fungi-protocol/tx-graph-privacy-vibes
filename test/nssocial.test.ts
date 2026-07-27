import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver } from "../src/analysis/clusters";
import {
  partitionColumns, clusterAdjacency, nsSimilarity, nsSocialRun, nsApply,
  matchComponents, matchState, activePairs, txEpochs, epochAdjacency,
  nsRejudge, type NsEvent,
} from "../src/analysis/nssocial";
import { fromGroups, join, samePartition } from "../src/analysis/partition";
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

test("ns-social: the run is deterministic and every merge clears the threshold on cross-epoch evidence", () => {
  const { eco, cl } = golden(110);
  const a = nsSocialRun(cl, eco.chain, 0.4);
  const b = nsSocialRun(cl, eco.chain, 0.4);
  assert.deepEqual(a, b);
  // the merge pass only scores CROSS-epoch profile pairs (#131), so an
  // unforced merge's recorded score is cross-epoch agreement — and it
  // must have cleared the bar
  for (const e of a) {
    if (e.kind === "merge" && !e.forced) {
      assert.ok(e.score >= 0.4, `merge ${e.a}+${e.b} scored ${e.score} below the threshold`);
    }
  }
});

test("ns-social: a moderate threshold finds at least one match on golden", () => {
  const { eco, cl } = golden(110);
  const events = nsSocialRun(cl, eco.chain, 0.4);
  assert.ok(events.some((e) => e.kind === "merge"),
    "expected the propagation to admit at least one pair at 0.4");
});

test("ns-social: epoch-spanning clusters exist and seed the correspondence (#131)", () => {
  const { eco, cl } = golden(80);
  const epochOf = txEpochs(eco.chain, 2);
  // the epoch cut is contiguous in chain order and both halves are real
  let last = 0;
  const counts = [0, 0];
  for (const tid of eco.chain.order) {
    const e = epochOf.get(tid)!;
    assert.ok(e >= last, "epochs must be contiguous in chain order");
    last = e;
    counts[e]!++;
  }
  assert.ok(counts[0]! > 0 && counts[1]! > 0);
  assert.ok(Math.abs(counts[0]! - counts[1]!) <= 1);
  // some clusters are active in BOTH epoch views — the seeds the old
  // whole-cluster-to-one-column model could not express
  const adjs = epochAdjacency(cl, eco.chain, epochOf, 2);
  const spanning = [...cl.members.keys()].filter((r) => adjs[0]!.has(r) && adjs[1]!.has(r));
  assert.ok(spanning.length > 0, "expected at least one epoch-spanning cluster");
  // and the per-epoch adjacencies decompose the global one: summing a
  // rep's epoch edges gives exactly its clusterAdjacency row
  const whole = clusterAdjacency(cl, eco.chain);
  for (const rep of cl.members.keys()) {
    const sum = new Map<string, number>();
    for (const adj of adjs) {
      for (const [o, w] of adj.get(rep) ?? []) sum.set(o, (sum.get(o) ?? 0) + w);
    }
    assert.deepEqual(
      [...sum.entries()].sort(),
      [...(whole.get(rep) ?? new Map()).entries()].sort(),
      `epoch adjacencies of ${rep} do not sum to the whole`);
  }
});

test("ns-social: the accepted match set is invariant under relabeling and shuffled order (#112)", () => {
  const { eco, cl } = golden(110);
  // (a) random representative relabeling: rename every cluster after
  // its LARGEST member instead of the smallest, and (b) shuffle the
  // map insertion order (deterministically, by reversed sort) so any
  // iteration-order sensitivity would surface
  const relabeled: typeof cl = (() => {
    const entries = [...cl.members.entries()].map(([, ids]) => {
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : 1));
      const newRep = sorted[sorted.length - 1]!;
      return [newRep, sorted] as const;
    });
    entries.sort((a, b) => (a[0] < b[0] ? 1 : -1)); // reversed insertion order
    const members = new Map(entries.map(([r, ids]) => [r, [...ids]]));
    const rep = new Map<string, string>();
    for (const [r, ids] of members) for (const id of ids) rep.set(id, r);
    const rank = new Map<string, number>();
    [...members.keys()].forEach((r, i) => rank.set(r, i + 1));
    return { rep, members, rank, changeGuess: cl.changeGuess, payGuess: cl.payGuess, changeReads: cl.changeReads, links: cl.links } as typeof cl;
  })();
  const signature = (c: typeof cl, evs: NsEvent[]): string =>
    [...nsApply(c, evs).members.values()]
      .map((m) => [...m].sort().join(",")).sort().join(";");
  const evA = nsSocialRun(cl, eco.chain, 0.4, 2);
  const evB = nsSocialRun(relabeled, eco.chain, 0.4, 2);
  assert.ok(activePairs(evA).length > 0, "need a non-trivial accepted set to pin");
  assert.equal(signature(cl, evA), signature(relabeled, evB),
    "the accepted match partition changed under relabeling/reordering");
});

test("ns-social: a capped run exits through the split pass — no match survives the gate would refuse (#131 rider, accuracy/049)", () => {
  const { eco, cl } = golden(80);
  // 4 epochs at a low bar produces contested dynamics (merges whose
  // standing depends on each other); cap the sweeps so the run cannot
  // reach its fixed point and must exit through the final split passes
  for (const maxSweeps of [1, 2, 3]) {
    const events = nsSocialRun(cl, eco.chain, 0.4, 4, maxSweeps);
    const leftover = nsRejudge(cl, eco.chain, 0.4, 4, events);
    assert.deepEqual(leftover, [],
      `maxSweeps=${maxSweeps}: the capped run returned matches the gate would retract`);
  }
  // and the uncapped run's fixed point (or cycle stop) is stable too
  const full = nsSocialRun(cl, eco.chain, 0.4, 4);
  assert.deepEqual(nsRejudge(cl, eco.chain, 0.4, 4, full), []);
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

test("clusterAdjacency: every distinct input cluster funds the outputs, not just inputs[0]'s (#124)", () => {
  const chain = new Chain();
  chain.addRoot("a", 1_000_000, 0);
  chain.addRoot("b", 500_000, 1);
  const fee = txfee(2, 1, 2);
  chain.addTx("t1", 1, ["a", "b"], [{ owner: 2, value: 1_500_000 - fee }], 2);
  // a refined partition keeps the two inputs apart (a CIOH abstention):
  // three clusters, the payment output alone in the third
  const members = new Map([["a", ["a"]], ["b", ["b"]], ["t1o1", ["t1o1"]]]);
  const rep = new Map([["a", "a"], ["b", "b"], ["t1o1", "t1o1"]]);
  const rank = new Map([["a", 1], ["b", 2], ["t1o1", 3]]);
  const cl = { rep, members, rank, changeGuess: new Map(), payGuess: new Map(), changeReads: new Map(), links: [] };
  const adj = clusterAdjacency(cl as never, chain);
  // both funding clusters see the payment cluster — the inputs[0]-only
  // reading dropped b's edge entirely
  assert.equal(adj.get("a")?.get("t1o1"), 1);
  assert.equal(adj.get("b")?.get("t1o1"), 1);
  assert.equal(adj.get("t1o1")?.get("a"), 1);
  assert.equal(adj.get("t1o1")?.get("b"), 1);
  // no edge between the two funders: co-spending is CIOH's claim, and
  // this partition abstained from it
  assert.equal(adj.get("a")?.get("b"), undefined);
});

test("ns-social: nsApply IS the lattice join of the base partition with the match partition (#125)", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const base = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const events = nsSocialRun(base, eco.chain, 0.5, 2);
  assert.ok(activePairs(events).length > 0, "the run must accept something for the join to be non-trivial");
  const fused = nsApply(base, events);
  // project both sides onto the indexed coin universe and compare as
  // partitions: nsApply's fusion must equal join(base, active pairs)
  const ids = [...eco.chain.coins.keys()];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const asGroups = (mm: Map<string, string[]>): number[][] =>
    [...mm.values()].map((g) => g.map((c) => idx.get(c)!));
  const pBase = fromGroups(ids.length, asGroups(base.members));
  const pPairs = fromGroups(ids.length, activePairs(events).map(([a, b]) => [idx.get(a)!, idx.get(b)!]));
  const pFused = fromGroups(ids.length, asGroups(fused.members));
  assert.ok(samePartition(pFused, join(pBase, pPairs)),
    "nsApply's fusion diverges from the lattice join");
});

test("ns-social: a contested match is retracted by the same gate, and the cycle stops (#132)", () => {
  // golden at day 80 with 4 epochs, threshold 0.4: the propagation
  // accepts several matches whose fusions then contest one of them —
  // it fails the gate once the others are applied. The split pass
  // re-runs the FULL acceptance gate (accuracy/044 §ns-social, /047,
  // /048), so the contested match is retracted; re-merging it would
  // revisit a seen state, so the run stops on the just-split,
  // conservative side instead of churning to the sweep bound.
  const { eco, cl } = golden(80);
  const events = nsSocialRun(cl, eco.chain, 0.4, 4);
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const merged = new Set<string>();
  for (const e of events) {
    if (e.kind === "merge") {
      assert.ok(!merged.has(key(e.a, e.b)),
        `${e.a}+${e.b} merged twice: the cycle did not stop`);
      merged.add(key(e.a, e.b));
    } else {
      assert.ok(merged.has(key(e.a, e.b)),
        `${e.a}+${e.b} split without a preceding merge`);
    }
  }
  assert.ok(events.some((e) => e.kind === "split"),
    "expected the contested pair of propagation matches to be retracted");
  assert.ok(activePairs(events).length >= 1,
    "the uncontested match should survive the retractions");
});
