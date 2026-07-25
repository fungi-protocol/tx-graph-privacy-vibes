import { test } from "node:test";
import assert from "node:assert/strict";
import { auxGraph, propagationStep, targetGraph, type WGraph } from "../src/analysis/propagation";
import { clusterObserver } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";
import { type Edge } from "../src/scenario/cast";

function graph(edges: [string, string][]): WGraph {
  const g: WGraph = { nodes: [], adj: new Map() };
  const ensure = (n: string): void => {
    if (!g.adj.has(n)) { g.adj.set(n, new Map()); g.nodes.push(n); }
  };
  for (const [a, b] of edges) {
    ensure(a); ensure(b);
    g.adj.get(a)!.set(b, (g.adj.get(a)!.get(b) ?? 0) + 1);
    g.adj.get(b)!.set(a, (g.adj.get(b)!.get(a) ?? 0) + 1);
  }
  return g;
}

test("a seed propagates along matching structure: one sweep maps the line", () => {
  // pseudonym graph and relationship graph are the same path; one seed
  // in the middle identifies everyone — each acceptance re-scores the
  // rest within the sweep (global state, not a frontier walk)
  const target = graph([["c0", "c1"], ["c1", "c2"], ["c2", "c3"]]);
  const aux = graph([["0", "1"], ["1", "2"], ["2", "3"]]);
  const res = propagationStep(target, aux, new Map([["c1", "1"]]));
  assert.deepEqual([...res.accepted.entries()].sort(),
    [["c0", "0"], ["c2", "2"], ["c3", "3"]]);
  for (const v of res.verdicts) {
    assert.equal(v.outcome.kind, "accepted");
    assert.ok(v.eccentricity >= 1.5);
  }
});

test("symmetry earns an abstention: two indistinguishable candidates, no acceptance", () => {
  // the seed's two counterparties have identical structure — no
  // standout, so a careful analyst abstains rather than guessing
  const target = graph([["cA", "cX"], ["cB", "cX"]]);
  const aux = graph([["a", "x"], ["b", "x"]]);
  const res = propagationStep(target, aux, new Map([["cX", "x"]]));
  assert.equal(res.accepted.size, 0);
  for (const v of res.verdicts) {
    assert.equal(v.outcome.kind, "abstained");
    assert.equal((v.outcome as { reason: string }).reason, "below-threshold");
  }
});

test("the reverse match vetoes a one-sided standout", () => {
  // two pseudonym clusters both trade with the seed, but the town knows
  // only ONE counterparty: each cluster's forward score points at that
  // one agent, and the reverse match cannot tell the clusters apart —
  // abstain, both times
  const target = graph([["cA", "cX"], ["cB", "cX"]]);
  const aux = graph([["a", "x"]]);
  const res = propagationStep(target, aux, new Map([["cX", "x"]]));
  assert.equal(res.accepted.size, 0);
  const reasons = res.verdicts.map((v) =>
    v.outcome.kind === "abstained" ? v.outcome.reason : v.outcome.kind);
  assert.deepEqual(reasons, ["reverse-mismatch", "reverse-mismatch"]);
});

test("no mapped neighbors means no signal, not a guess", () => {
  const target = graph([["c0", "c1"], ["c2", "c3"]]);
  const aux = graph([["0", "1"], ["2", "3"]]);
  const res = propagationStep(target, aux, new Map([["c0", "0"]]));
  const far = res.verdicts.filter((v) => v.node === "c2" || v.node === "c3");
  assert.equal(far.length, 2);
  for (const v of far) {
    assert.equal(v.outcome.kind, "abstained");
    assert.equal((v.outcome as { reason: string }).reason, "no-signal");
  }
});

test("the town's graphs are buildable and one sweep runs with honest outcomes", () => {
  const eco = new Economy("golden");
  eco.runTo(115);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const tg = targetGraph(eco.chain, cl);
  assert.ok(tg.nodes.length >= 5, `only ${tg.nodes.length} pseudonym nodes`);
  const agents = eco.cast.map((_, i) => i);
  const aux = auxGraph(eco.edges as Edge[], agents);
  assert.ok(aux.adj.get("1")!.size >= 1, "Bob has relationships");
  // seed: the two largest clusters, identified by their majority owner
  // (out-of-band knowledge, as seeds always are)
  const owner = (id: string): number | null => eco.chain.coins.get(id)!.owner;
  const majority = (r: string): string => {
    const counts = new Map<number, number>();
    for (const id of cl.members.get(r)!) {
      const o = owner(id);
      if (o !== null) counts.set(o, (counts.get(o) ?? 0) + 1);
    }
    return String([...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  };
  const big = [...cl.members.entries()].filter(([, m]) => m.length >= 2)
    .sort((a, b) => b[1].length - a[1].length).slice(0, 2).map(([r]) => r);
  const seeds = new Map(big.map((r) => [r, majority(r)]));
  const res = propagationStep(tg, aux, seeds);
  assert.ok(res.verdicts.length >= 3, "sweep examined almost nothing");
  // every acceptance carried a real standout and a reverse agreement;
  // abstentions are first-class and expected at this scale
  for (const v of res.verdicts) {
    if (v.outcome.kind === "accepted") {
      assert.ok(v.eccentricity >= 1.5, `${v.node}: accepted below threshold`);
      assert.equal(v.ranked[0]!.candidate, v.outcome.mapped);
    }
  }
});
