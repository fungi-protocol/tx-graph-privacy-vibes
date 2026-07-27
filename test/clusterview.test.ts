// The contracted view's truth paint and repartition animation: paint
// is the town's ground truth over the lens's partition (a mixed vertex
// renders every true owner, largest share first), and a heuristic
// toggle animates old discs merging into / splitting out of the new
// ones. Both are pure geometry/bookkeeping — neither feeds any
// analysis — but their honesty is load-bearing: the slices must sum to
// the whole cluster, and every fragment must come from a real old disc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { truthSlices, transitionFragments, layoutClusterGraph, fitClusterLayout, pileOffset, pileScale, discRadius, contractedEdges, contractedScene, incidenceId } from "../src/ui/clusterview";
import { type Clustering } from "../src/analysis/clusters";
import { clusterObserver, clusterSingletons } from "../src/analysis/clusters";
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
  return { rep, members, rank, changeGuess: new Map(), links: [] } as unknown as Clustering;
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

// #108: when "point out mistakes" is off, the discs wear the observer's
// own bookkeeping — the same color function drives disc fill and slices,
// so a coloring that is constant per cluster (the observer's palette)
// collapses every disc to a single slice, and only a genuinely mixed
// attribution (disclosed grants naming different people inside one
// cluster) renders a divided disc. Truth pies are the mistakes-mode
// grading, not the default.
test("truthSlices under a per-cluster color function: one slice per disc; grant mixes still show (#108)", () => {
  const cl = partition([["a1", "a2", "b1"], ["c1"]]);
  // the observer's palette: every member of a cluster shares its rep's color
  const palette = (id: string): string => (cl.rep.get(id) === "a1" ? "#e5726c" : "#565b64");
  for (const rep of ["a1", "c1"]) {
    const s = truthSlices(cl, rep, palette);
    assert.equal(s.length, 1, `${rep}: the observer's own reading is undivided`);
    assert.equal(s[0]!.frac, 1);
    assert.equal(s[0]!.color, palette(rep));
  }
  // a grant attributing b1 to someone else honestly divides the disc
  const granted = (id: string): string => (id === "b1" ? "#7ab648" : palette(id));
  const mixed = truthSlices(cl, "a1", granted);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed[0], { color: "#e5726c", frac: 2 / 3 });
  assert.deepEqual(mixed[1], { color: "#7ab648", frac: 1 / 3 });
});

test("fitClusterLayout: a similarity map into the target rect — centered, aspect kept, radii scaled", () => {
  const cl = partition([["a1", "a2"], ["b1", "b2"], ["c1"]]);
  const lay = layoutClusterGraph(cl);
  const target = { x: 1000, y: 2000, w: 500, h: 300 };
  const fit = fitClusterLayout(lay, target);
  const k = Math.min(target.w / lay.bounds.w, target.h / lay.bounds.h);
  // bounds scale uniformly and center on the target's center
  assert.ok(Math.abs(fit.bounds.w - lay.bounds.w * k) < 1e-9);
  assert.ok(Math.abs(fit.bounds.h - lay.bounds.h * k) < 1e-9);
  assert.ok(Math.abs(fit.bounds.x + fit.bounds.w / 2 - (target.x + target.w / 2)) < 1e-9);
  assert.ok(Math.abs(fit.bounds.y + fit.bounds.h / 2 - (target.y + target.h / 2)) < 1e-9);
  // every node keeps its relative position and scales its radius
  for (const [rep, n0] of lay.nodes) {
    const n = fit.nodes.get(rep)!;
    assert.ok(Math.abs(n.r - n0.r * k) < 1e-9);
    const relX = (n0.x - (lay.bounds.x + lay.bounds.w / 2)) * k;
    assert.ok(Math.abs(n.x - (target.x + target.w / 2) - relX) < 1e-9);
  }
  // a degenerate target is refused rather than collapsing the layout
  assert.equal(fitClusterLayout(lay, { x: 0, y: 0, w: 0, h: 5 }), lay);
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

test("transitionFragments carry their member coins: the pieces partition the new cluster (#95)", () => {
  const oldCl = partition([["a1", "a2"], ["b1", "b2"]]);
  const oldClay = layoutClusterGraph(oldCl);
  const merged = partition([["a1", "a2", "b1", "b2"]]);
  const mf = transitionFragments(oldCl, oldClay, merged).get("a1")!;
  const all = mf.flatMap((f) => f.coins).sort();
  assert.deepEqual(all, ["a1", "a2", "b1", "b2"]);
  for (const f of mf) {
    const from = oldCl.rep.get(f.coins[0]!);
    assert.ok(f.coins.every((id) => oldCl.rep.get(id) === from),
      "each piece's coins all come from one old cluster");
  }
});

test("pileOffset: a cluster's scaled stack of coin dots packs inside its layout radius (#95, #107)", () => {
  for (const n of [1, 2, 5, 10, 50, 200, 1000]) {
    const rim = discRadius(n);
    const k = pileScale(n, rim);
    const dotR = Math.max(1.8, 5 * k);
    for (let i = 0; i < n; i++) {
      const o = pileOffset(i);
      assert.ok(Math.hypot(o.dx, o.dy) * k + dotR <= rim + 1e-9,
        `dot ${i} of ${n} stays inside the rim`);
    }
  }
});

test("discRadius plateaus: still growing, but ever slower, and never caption-dwarfing (#107)", () => {
  let prevR = discRadius(2);
  for (const n of [8, 32, 128, 512, 2048]) {
    const r = discRadius(n);
    assert.ok(r > prevR, `radius keeps growing at ${n}`);
    // area tracks ~sqrt(n): quadrupling the coins grows the radius by
    // well under the doubling a sqrt(n) law would give
    assert.ok(r / prevR < 1.45, `quadrupling coins at ${n} grows r only ${(r / prevR).toFixed(2)}x`);
    prevR = r;
  }
  // a monster cluster still reads as a disc beside its caption, not a
  // billboard behind it
  assert.ok(discRadius(10000) < 110, `10k-coin disc stays modest, got ${discRadius(10000)}`);
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
    // link different people together somewhere by day 115
    assert.ok(mixed >= 1, `${seed}: no mixed cluster to expose`);
  }
});

// #107: the contracted graph's edge semantics. Each transaction pinches
// to a junction: every distinct input cluster feeds it, it fans out to
// every output cluster the inputs don't already own. A coin is spent at
// most once, so on the singleton ring a coin keeps at most ONE outgoing
// strand — the fan-out to several outputs belongs to the junction, not
// to the coin — and a co-funding input is never left dangling.
test("contractedEdges on singletons: one outgoing strand per coin, no orphaned inputs (#107)", () => {
  const eco = new Economy("welcome");
  eco.runTo(35);
  const cl = clusterSingletons(eco.chain);
  const edges = contractedEdges(eco.chain, cl);
  const outStrands = new Map<string, number>();
  for (const e of edges) {
    for (const f of e.from) outStrands.set(f, (outStrands.get(f) ?? 0) + 1);
    // outputs never double as sources of the same edge
    for (const t of e.to) assert.ok(!e.from.includes(t), `${t} both feeds and receives ${e.tid}`);
  }
  for (const [id, n] of outStrands) {
    assert.ok(n <= 1, `coin ${id} grew ${n} outgoing strands from one spend`);
  }
  // every spent coin feeds its spending transaction's edge — co-funders
  // included (the repro: t25 spends t12o2 AND t20o2; both must appear)
  for (const e of edges) {
    const tx = eco.chain.txs.get(e.tid)!;
    assert.deepEqual([...e.from].sort(), [...new Set(tx.inputs)].sort(),
      `${e.tid} lists every input as a source on the singleton ring`);
  }
});

test("contractedEdges under a coarse partition: co-clustered inputs collapse to one source, internal transfers vanish (#107)", () => {
  // a1 pays: two inputs one cluster, change back to itself, payment out
  const cl = partition([["i1", "i2", "c1"], ["p1"]]);
  const chain = {
    order: ["t1"],
    txs: new Map([["t1", { id: "t1", inputs: ["i1", "i2"], outputs: ["p1", "c1"] }]]),
  } as never;
  const edges = contractedEdges(chain, cl);
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0]!.from, [cl.rep.get("i1")]);
  assert.deepEqual(edges[0]!.to, [cl.rep.get("p1")]);
  // fully internal tx contracts away
  const internal = contractedEdges({
    order: ["t2"],
    txs: new Map([["t2", { id: "t2", inputs: ["i1"], outputs: ["c1"] }]]),
  } as never, cl);
  assert.equal(internal.length, 0);
});

// The contracted scene is the stable semantic layer the layouts and the
// draw path consume: derived once per (chain, clustering) pair, cached
// on the clustering object, re-derived only when the chain grows. Each
// incidence — a strand between a cluster vertex and a transaction's
// junction — has a stable id, so a transition can animate the SAME
// strand across layout modes instead of re-deriving topology from
// geometry (#115 contract).
test("contractedScene: memoized per (chain, clustering); incidence ids are direction-tagged and stable", () => {
  const eco = new Economy("welcome");
  eco.runTo(30);
  const cl = clusterSingletons(eco.chain);
  const a = contractedScene(eco.chain, cl);
  const b = contractedScene(eco.chain, cl);
  assert.equal(a, b, "same chain + same clustering returns the identical array");
  assert.deepEqual(a, contractedEdges(eco.chain, cl), "the scene IS the contracted edge set");
  // the chain grows under the same clustering object → fresh derivation
  eco.runTo(35);
  const c = contractedScene(eco.chain, clusterSingletons(eco.chain));
  assert.ok(c.length > a.length, "new transactions appear in the re-derived scene");
  // incidence ids: direction-tagged, so an input strand and an output
  // strand touching the same (tx, cluster) pair never collide
  assert.equal(incidenceId("t1", "a", "in"), "a>t1");
  assert.equal(incidenceId("t1", "a", "out"), "t1>a");
  assert.notEqual(incidenceId("t1", "a", "in"), incidenceId("t1", "a", "out"));
});

// #107: "the clustered vs. unclustered layout is mainly a function of
// the heuristics that are enabled, if all are disabled then that's
// equivalent to unclustered" — the observer's map with every heuristic
// switched off IS the bottom of the refinement lattice.
test("observer with all heuristics off equals the singleton partition (#107)", () => {
  const eco = new Economy("welcome");
  eco.runTo(35);
  const off = clusterObserver(eco.chain, (d) => eco.prices[d],
    { reuse: false, cioh: false, change: false, subsum: false, remeet: false });
  const bottom = clusterSingletons(eco.chain);
  assert.equal(off.members.size, bottom.members.size);
  for (const [rep, members] of off.members) {
    assert.deepEqual(members, bottom.members.get(rep),
      `cluster ${rep} is a bare singleton with every heuristic off`);
  }
});
