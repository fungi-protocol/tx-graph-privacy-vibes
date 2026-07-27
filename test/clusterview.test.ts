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
import { type Chain } from "../src/model/chain";

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
test("contractedScene: memoized per (chain, clustering); both invalidation paths re-derive; incidence ids are direction-tagged", () => {
  const cl = partition([["i1", "i2", "c1"], ["p1"]]);
  const chainOf = (order: string[], txs: [string, { id: string; inputs: string[]; outputs: string[] }][]): Chain =>
    ({ order, txs: new Map(txs) }) as never;
  const t1: [string, { id: string; inputs: string[]; outputs: string[] }] =
    ["t1", { id: "t1", inputs: ["i1", "i2"], outputs: ["p1", "c1"] }];
  const chain = chainOf(["t1"], [t1]);
  const a = contractedScene(chain, cl);
  assert.equal(contractedScene(chain, cl), a, "same chain + same clustering returns the identical array");
  assert.deepEqual(a, contractedEdges(chain, cl), "the scene IS the contracted edge set");
  // invalidation path 1: the SAME chain object grows in place
  chain.order.push("t2");
  chain.txs.set("t2", { id: "t2", inputs: ["p1"], outputs: ["c1"] } as never);
  const grown = contractedScene(chain, cl);
  assert.notEqual(grown, a, "in-place growth re-derives");
  assert.equal(grown.length, contractedEdges(chain, cl).length);
  // invalidation path 2: a DIFFERENT chain object of the same length
  // must not reuse the stale scene (t2 spends p1 across clusters here)
  const other = chainOf(["t1", "t2"],
    [t1, ["t2", { id: "t2", inputs: ["c1"], outputs: ["p1"] }]]);
  const swapped = contractedScene(other, cl);
  assert.notEqual(swapped, grown, "a different chain of equal length re-derives");
  assert.deepEqual(swapped, contractedEdges(other, cl));
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

// #115 animation-continuity substrate: the semantic scene names every
// strand (incidence id); an arrangement only assigns geometry. The
// renderer looks each strand's endpoints up in the layout's node map,
// so a layout that misses a rep the scene references would silently
// drop that strand — a strand appearing or disappearing merely because
// the arrangement changed, exactly what the contract forbids. Every
// arrangement of the same partition must therefore cover the scene's
// reps, and the incidence-id set is identical across all of them.
test("every arrangement covers the scene: identical incidence ids across ring, force ring, fitted ring, and columns (#115)", async () => {
  const { layoutClusterColumns, layoutClusterBand, layoutClusterForceMap } = await import("../src/ui/clusterview");
  const { partitionColumns } = await import("../src/analysis/nssocial");
  const eco = new Economy("golden");
  eco.runTo(60);
  const chain = eco.chain;
  for (const cl of [clusterObserver(chain, (d) => eco.prices[d]), clusterSingletons(chain)]) {
    const scene = contractedScene(chain, cl);
    assert.ok(scene.length >= 10, `only ${scene.length} contracted edges at day 60`);
    const ids = new Set<string>();
    for (const e of scene) {
      for (const r of e.from) ids.add(incidenceId(e.tid, r, "in"));
      for (const r of e.to) ids.add(incidenceId(e.tid, r, "out"));
    }
    const cols = partitionColumns(cl, chain, 2);
    const lanes = new Map([...cols].map(([rep, c]) => [rep, [c]]));
    const arrangements = {
      ring: layoutClusterGraph(cl, chain, "time"),
      forceRing: layoutClusterGraph(cl, chain, "force"),
      fitted: fitClusterLayout(layoutClusterGraph(cl, chain, "time"),
        { x: 0, y: 0, w: 800, h: 600 }),
      columns: layoutClusterColumns(cl, chain, lanes, 2, "time"),
      band: layoutClusterBand(cl, chain, "time"),
      forceBand: layoutClusterBand(cl, chain, "force"),
      forceMap: layoutClusterForceMap(cl, chain),
    };
    for (const [name, clay] of Object.entries(arrangements)) {
      const drawable = new Set<string>();
      for (const e of scene) {
        for (const r of e.from) if (clay.nodes.has(r)) drawable.add(incidenceId(e.tid, r, "in"));
        for (const r of e.to) if (clay.nodes.has(r)) drawable.add(incidenceId(e.tid, r, "out"));
      }
      assert.equal(drawable.size, ids.size,
        `${name} drops ${ids.size - drawable.size} of ${ids.size} strands`);
    }
  }
});

// The two uncurled arrangements of the contracted map (#115): the band
// is the ring's timeline left unbent, the force map a deterministic
// relaxation of it. Geometry only — same scene, same partition.
test("band keeps the timeline order left to right; force map is deterministic (#115)", async () => {
  const { layoutClusterBand, layoutClusterForceMap } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(60);
  const chain = eco.chain;
  const cl = clusterObserver(chain, (d) => eco.prices[d]);
  const day = (id: string): number => {
    const c = chain.coins.get(id)!;
    return c.producer ? chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const earliest = (rep: string): number =>
    Math.min(...cl.members.get(rep)!.map(day));
  const band = layoutClusterBand(cl, chain, "time");
  const byX = [...band.nodes.values()].sort((a, b) => a.x - b.x);
  for (let i = 1; i < byX.length; i++) {
    assert.ok(earliest(byX[i]!.rep) >= earliest(byX[i - 1]!.rep),
      `band vertex ${byX[i]!.rep} sits right of a later cluster`);
  }
  // one row: every vertex on the same line, inside the bounds, with
  // the arc room left below the row
  for (const n of band.nodes.values()) {
    assert.equal(n.y, 0);
    assert.ok(n.x - n.r >= band.bounds.x && n.x + n.r <= band.bounds.x + band.bounds.w);
  }
  assert.ok(band.bounds.y + band.bounds.h >= 280, "no arc room under the band");
  // the force map settles into the same picture every time, and keeps
  // every disc inside its bounds
  const f1 = layoutClusterForceMap(cl, chain);
  const f2 = layoutClusterForceMap(cl, chain);
  for (const [rep, n] of f1.nodes) {
    const m = f2.nodes.get(rep)!;
    assert.equal(n.x, m.x);
    assert.equal(n.y, m.y);
    assert.ok(n.x - n.r >= f1.bounds.x && n.x + n.r <= f1.bounds.x + f1.bounds.w);
    assert.ok(n.y - n.r >= f1.bounds.y && n.y + n.r <= f1.bounds.y + f1.bounds.h);
  }
  // relaxation actually moved things off the starting ring
  const ring = layoutClusterGraph(cl, chain, "time");
  const moved = [...f1.nodes.values()]
    .filter((n) => Math.hypot(n.x - ring.nodes.get(n.rep)!.x, n.y - ring.nodes.get(n.rep)!.y) > 5);
  assert.ok(moved.length > f1.nodes.size / 2, "force map barely differs from the ring");
});

// #129: the incidence-geometry interpolation the #115 contract promised.
// strandGeometry assigns each incidence id ONE drawable quadratic per
// arrangement; a transition then interpolates identical ids' shapes.
const evalQuad = (q: { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number }, t: number): { x: number; y: number } => {
  const u = 1 - t;
  return {
    x: u * u * q.x0 + 2 * u * t * q.cx + t * t * q.x1,
    y: u * u * q.y0 + 2 * u * t * q.cy + t * t * q.y1,
  };
};

test("strandGeometry keys exactly the scene's incidence ids, in every arrangement (#129)", async () => {
  const { strandGeometry, layoutClusterColumns, layoutClusterBand, layoutClusterForceMap } = await import("../src/ui/clusterview");
  const { partitionColumns } = await import("../src/analysis/nssocial");
  const eco = new Economy("golden");
  eco.runTo(60);
  const chain = eco.chain;
  for (const cl of [clusterObserver(chain, (d) => eco.prices[d]), clusterSingletons(chain)]) {
    const ids = new Set<string>();
    for (const e of contractedScene(chain, cl)) {
      for (const r of e.from) ids.add(incidenceId(e.tid, r, "in"));
      for (const r of e.to) ids.add(incidenceId(e.tid, r, "out"));
    }
    const cols = partitionColumns(cl, chain, 2);
    const lanes = new Map([...cols].map(([rep, c]) => [rep, [c]]));
    const arrangements = {
      ring: layoutClusterGraph(cl, chain, "time"),
      columns: layoutClusterColumns(cl, chain, lanes, 2, "time"),
      band: layoutClusterBand(cl, chain, "time"),
      forceMap: layoutClusterForceMap(cl, chain),
    };
    for (const [name, clay] of Object.entries(arrangements)) {
      const geo = strandGeometry(chain, cl, clay);
      assert.equal(geo.size, ids.size, `${name}: ${geo.size} strands for ${ids.size} incidences`);
      for (const id of ids) {
        const s = geo.get(id);
        assert.ok(s, `${name} missing strand ${id}`);
        assert.equal(s!.id, id);
        for (const v of [s!.quad.x0, s!.quad.y0, s!.quad.cx, s!.quad.cy, s!.quad.x1, s!.quad.y1]) {
          assert.ok(Number.isFinite(v), `${name} strand ${id} has a non-finite coordinate`);
        }
      }
    }
  }
});

test("a two-party edge's split strands render the original curve and join seamlessly (#129)", async () => {
  const { splitQuad, strandGeometry } = await import("../src/ui/clusterview");
  // de Casteljau split fidelity on an arbitrary quad
  const q = { x0: 3, y0: -7, cx: 40, cy: 55, x1: 120, y1: 10 };
  const { a, b } = splitQuad(q);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const whole = evalQuad(q, t);
    const piece = t <= 0.5 ? evalQuad(a, t * 2) : evalQuad(b, (t - 0.5) * 2);
    assert.ok(Math.abs(whole.x - piece.x) < 1e-9 && Math.abs(whole.y - piece.y) < 1e-9,
      `split diverges from the whole at t=${t}`);
  }
  // in the real scene: each two-party edge's in-strand ends where its
  // out-strand starts, and only multi-party strands carry a junction
  const eco = new Economy("golden");
  eco.runTo(60);
  const chain = eco.chain;
  const cl = clusterObserver(chain, (d) => eco.prices[d]);
  const geo = strandGeometry(chain, cl, layoutClusterGraph(cl, chain, "time"));
  let pairs = 0;
  for (const e of contractedScene(chain, cl)) {
    if (e.from.length !== 1 || e.to.length !== 1) continue;
    const sin = geo.get(incidenceId(e.tid, e.from[0]!, "in"))!;
    const sout = geo.get(incidenceId(e.tid, e.to[0]!, "out"))!;
    assert.equal(sin.junction, false);
    assert.equal(sout.junction, false);
    assert.ok(Math.abs(sin.quad.x1 - sout.quad.x0) < 1e-9 && Math.abs(sin.quad.y1 - sout.quad.y0) < 1e-9,
      `strands of ${e.tid} do not join`);
    pairs += 1;
  }
  assert.ok(pairs >= 5, `only ${pairs} two-party edges at day 60`);
  for (const e of contractedScene(chain, cl)) {
    if (e.from.length + e.to.length <= 2) continue;
    for (const r of e.from) assert.equal(geo.get(incidenceId(e.tid, r, "in"))!.junction, true);
    for (const r of e.to) assert.equal(geo.get(incidenceId(e.tid, r, "out"))!.junction, true);
  }
});

test("the transition interpolates identical ids: t=0 IS the old shape, t=1 the new, t=1/2 the midpoint (#129)", async () => {
  const { strandGeometry, lerpQuad, layoutClusterBand } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(60);
  const chain = eco.chain;
  const cl = clusterObserver(chain, (d) => eco.prices[d]);
  const oldGeo = strandGeometry(chain, cl, layoutClusterGraph(cl, chain, "time"));
  const newGeo = strandGeometry(chain, cl, layoutClusterBand(cl, chain, "time"));
  // same partition -> the id sets are identical: nothing appears or
  // disappears from a pure arrangement change (chord <-> band)
  assert.deepEqual([...oldGeo.keys()].sort(), [...newGeo.keys()].sort());
  for (const [id, o] of oldGeo) {
    const n = newGeo.get(id)!;
    const at0 = lerpQuad(o.quad, n.quad, 0);
    const at1 = lerpQuad(o.quad, n.quad, 1);
    const mid = lerpQuad(o.quad, n.quad, 0.5);
    assert.deepEqual(at0, o.quad, `${id} at t=0 is not the old shape`);
    assert.deepEqual(at1, n.quad, `${id} at t=1 is not the new shape`);
    assert.ok(Math.abs(mid.cx - (o.quad.cx + n.quad.cx) / 2) < 1e-9);
    assert.ok(Math.abs(mid.x0 - (o.quad.x0 + n.quad.x0) / 2) < 1e-9);
  }
});
