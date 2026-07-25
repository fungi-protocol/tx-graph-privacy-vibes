import { test } from "node:test";
import assert from "node:assert/strict";
import { auxGraph, propagationStep, targetGraph, type WGraph } from "../src/analysis/propagation";
import { clusterObserver } from "../src/analysis/clusters";
import { clusterOwner, gradeAcceptances, outsiderEdges, pureClusterSeeds } from "../src/scenario/synthesisStaging";
import { Economy } from "../src/engine/economy";
import { type Edge } from "../src/scenario/cast";

function graph(edges: [string, string][], extra: string[] = []): WGraph {
  const g: WGraph = { nodes: [], adj: new Map() };
  const ensure = (n: string): void => {
    if (!g.adj.has(n)) { g.adj.set(n, new Map()); g.nodes.push(n); }
  };
  for (const [a, b] of edges) {
    ensure(a); ensure(b);
    g.adj.get(a)!.set(b, (g.adj.get(a)!.get(b) ?? 0) + 1);
    g.adj.get(b)!.set(a, (g.adj.get(b)!.get(a) ?? 0) + 1);
  }
  for (const n of extra) ensure(n);
  return g;
}

test("two corroborating mapped neighbors make a standout; the rest abstain", () => {
  // cX trades with both seeded clusters; agent x trades with both
  // seeded agents. The distractor y touches only one seed, so x stands
  // out over the zero-padded candidate domain. The isolated cW has no
  // mapped neighbors at all.
  const target = graph([["cA", "cX"], ["cB", "cX"]], ["cW"]);
  const aux = graph([["a", "x"], ["b", "x"], ["a", "y"]]);
  const res = propagationStep(target, aux, new Map([["cA", "a"], ["cB", "b"]]));
  assert.deepEqual([...res.accepted.entries()], [["cX", "x"]]);
  const cx = res.verdicts.find((v) => v.node === "cX")!;
  assert.ok(Number.isFinite(cx.eccentricity) && cx.eccentricity >= 1.5);
  const cw = res.verdicts.find((v) => v.node === "cW")!;
  assert.equal(cw.outcome.kind, "abstained");
  assert.equal((cw.outcome as { reason: string }).reason, "no-signal");
});

test("a single positive candidate earns a finite eccentricity over the padded domain", () => {
  // the retired convention gave a lone positive score infinite
  // eccentricity; the paper's domain pads the other unmapped candidates
  // as zeros, so the standout is finite — and can still be accepted
  const target = graph([["c0", "c1"], ["c2", "c3"]]);
  const aux = graph([["0", "1"], ["2", "3"]]);
  const res = propagationStep(target, aux, new Map([["c0", "0"]]));
  const c1 = res.verdicts.find((v) => v.node === "c1")!;
  assert.equal(c1.outcome.kind, "accepted");
  assert.ok(Number.isFinite(c1.eccentricity), "eccentricity must be finite");
  assert.ok(c1.eccentricity >= 1.5);
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
  // only ONE counterparty (plus an uninvolved agent to stand out over):
  // each cluster's forward score points at that one agent, and the
  // reverse match cannot tell the clusters apart — abstain, both times
  const target = graph([["cA", "cX"], ["cB", "cX"]]);
  const aux = graph([["a", "x"]], ["b"]);
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

test("the town's graphs are buildable and one sweep runs with honest, graded outcomes", () => {
  const eco = new Economy("golden");
  eco.runTo(115);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const tg = targetGraph(eco.chain, cl);
  assert.ok(tg.nodes.length >= 5, `only ${tg.nodes.length} pseudonym nodes`);
  const agents = eco.cast.map((_, i) => i);
  // the outsider's degraded proxy: only the big arrangements are
  // known, never the cast's own edge list
  const known = outsiderEdges(eco.edges as Edge[], 300);
  assert.ok(known.length < (eco.edges as Edge[]).length,
    "degradation must actually drop relationships");
  assert.ok(known.length > 0, "the outsider must know something");
  const aux = auxGraph(known, agents);
  // seeds: the largest PURE clusters — a mixed cluster has no single
  // true image, so staging may not seed one (out-of-band knowledge,
  // as seeds always are; purity checked against latent truth)
  const owner = (id: string): number | null => eco.chain.coins.get(id)!.owner;
  const seeds = pureClusterSeeds(cl, owner, 2);
  assert.equal(seeds.size, 2, "two pure seed clusters must exist");
  for (const rep of seeds.keys()) {
    assert.notEqual(clusterOwner(cl, rep, owner), null, "seed cluster must be pure");
  }
  const res = propagationStep(tg, aux, seeds);
  assert.ok(res.verdicts.length >= 3, "sweep examined almost nothing");
  // every acceptance carried a real, finite standout and a reverse
  // agreement; abstentions are first-class and expected at this scale
  for (const v of res.verdicts) {
    if (v.outcome.kind === "accepted") {
      assert.ok(Number.isFinite(v.eccentricity) && v.eccentricity >= 1.5,
        `${v.node}: accepted without a finite standout`);
      assert.equal(v.ranked[0]!.candidate, v.outcome.mapped);
    }
  }
  // grade what was accepted against latent truth — truth judges the
  // analysis, never feeds it. False and undefined acceptances are
  // legitimate outcomes; the grade just has to be well-defined
  const grades = gradeAcceptances(cl, res.accepted, owner);
  assert.equal(grades.size, res.accepted.size);
  for (const g of grades.values()) {
    assert.ok(["correct", "false", "undefined"].includes(g));
  }
});
