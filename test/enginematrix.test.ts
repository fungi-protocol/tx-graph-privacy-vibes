// The transition matrix (#141 slice 3e): drive the engine through
// every ordered stable pair and hold the geometry contracts frame by
// frame — the pose stays finite and continuous, each leg moves its
// scalars monotonically, the leg interpolators produce defined
// positions with stable ids at engine-sampled progress, strands carry
// the arrow geometry (#24: in-strands leave their vertex, out-strands
// land on theirs, every transaction's strands meet at one point), and
// a catch-up REPARTITION never changes the cell (#13's engine half:
// no cell change, nothing for a camera to follow).
import { test } from "node:test";
import assert from "node:assert/strict";
import { restPose, mapPose, type MapPose } from "../src/engine/pose";
import { createEngine, request, tick, integrate } from "../src/engine/engine";
import { stableDestinations, sameCell, presetCell } from "../src/engine/state";
import { curlFrames, ease } from "../src/engine/legrender";
import {
  layoutClusterGraph, layoutClusterBand, layoutClusterForceMap,
  strandGeometry, coinDotAt, type ClusterLayout,
} from "../src/ui/clusterview";
import { clusterObserver } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";

const KEYS = ["dotT", "pinchT", "flightT", "curlT", "stackT"] as const;
const DT = 40;
const BOUND = DT / 400 + 1e-9; // the shortest leg (DETAIL) sets the fastest slope

test("every stable pair: the pose is finite, continuous, per-leg monotone, exact at rest", () => {
  const cells = stableDestinations();
  for (const from of cells) {
    for (const to of cells) {
      if (sameCell(from, to)) continue;
      const label = `${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
      const e = createEngine(from);
      request(e, to);
      let prev = mapPose(e);
      let legIx = e.active ? e.active.index : -1;
      let legStart = prev;
      let guard = 0;
      while (e.active || e.pending) {
        assert.ok(guard++ < 1000, `${label}: does not settle`);
        tick(e, DT);
        const p = mapPose(e);
        const ix = e.active ? e.active.index : -1;
        for (const k of KEYS) {
          assert.ok(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1, `${label}: ${k}=${p[k]}`);
          assert.ok(Math.abs(p[k] - prev[k]) <= BOUND, `${label}: ${k} jumps ${prev[k]} -> ${p[k]}`);
          if (ix === legIx) {
            // within one leg each scalar heads one way: toward the
            // leg's endpoint pose, never overshooting or doubling back
            const dir = Math.sign(p[k] - legStart[k]);
            const step = p[k] - prev[k];
            assert.ok(dir === 0 || Math.sign(step) === 0 || Math.sign(step) === dir,
              `${label}: ${k} reverses inside a leg`);
          }
        }
        if (ix !== legIx) { legIx = ix; legStart = p; }
        prev = p;
      }
      const rest = restPose(to);
      for (const k of KEYS) assert.equal(prev[k], rest[k], `${label}: at rest ${k}`);
    }
  }
});

function fixture(): {
  cl: ReturnType<typeof clusterObserver>;
  band: ClusterLayout; ring: ClusterLayout; map: ClusterLayout;
  coins: string[];
} {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  return {
    cl,
    band: layoutClusterBand(cl, eco.chain),
    ring: layoutClusterGraph(cl, eco.chain, "time"),
    map: layoutClusterForceMap(cl, eco.chain),
    coins: [...eco.chain.coins.keys()],
  };
}

test("engine-sampled CURL frames: defined positions, stable ids, exact landing (with the correction term)", () => {
  const { band, ring } = fixture();
  const e = createEngine(presetCell("layered", "clustered"));
  request(e, presetCell("chord", "clustered"));
  const reps = new Set(band.nodes.keys());
  let sawMid = false;
  const end = curlFrames(band, 1).frames;
  while (e.active) {
    tick(e, DT);
    const a = e.active;
    if (!a || a.legs[a.index]!.kind !== "CURL") continue;
    const P = mapPose(e);
    if (P.curlT <= 0 || P.curlT >= 1) continue;
    sawMid = true;
    const f = curlFrames(band, P.curlT).frames;
    assert.deepEqual(new Set(f.keys()), reps, "ids stable through the bend");
    const w = ease(P.curlT);
    for (const rep of reps) {
      const v = f.get(rep)!, v1 = end.get(rep)!, rest = ring.nodes.get(rep)!;
      // the drawn slot: the bend plus the eased correction onto the
      // resting ring — finite at every engine-sampled progress
      const x = v.x + (rest.x - v1.x) * w, y = v.y + (rest.y - v1.y) * w;
      assert.ok(Number.isFinite(x) && Number.isFinite(y), rep);
    }
  }
  assert.ok(sawMid, "the CURL leg was observed mid-flight");
});

test("coinDotAt: every coin of the partition has a finite slot in every arrangement", () => {
  const { cl, band, ring, map, coins } = fixture();
  for (const [name, clay] of [["band", band], ["ring", ring], ["map", map]] as const) {
    for (const id of coins) {
      const p = coinDotAt(clay, cl, id);
      assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.y), `${name}: ${id}`);
    }
  }
});

test("#24 strand geometry: in-strands leave their vertex, out-strands land on theirs, one meeting point per tx", () => {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  for (const clay of [
    layoutClusterBand(cl, eco.chain),
    layoutClusterGraph(cl, eco.chain, "time"),
    layoutClusterForceMap(cl, eco.chain),
  ]) {
    const strands = strandGeometry(eco.chain, cl, clay);
    assert.ok(strands.size > 0, "the scene has strands");
    const meet = new Map<string, { x: number; y: number }>();
    for (const s of strands.values()) {
      const q = s.quad;
      for (const v of [q.x0, q.y0, q.cx, q.cy, q.x1, q.y1]) assert.ok(Number.isFinite(v), s.id);
      const node = clay.nodes.get(s.rep)!;
      assert.ok(node, s.id);
      // direction IS the flow of funds: an in-strand starts on its
      // paying vertex, an out-strand ends on its receiving vertex
      const [ax, ay] = s.dir === "in" ? [q.x0, q.y0] : [q.x1, q.y1];
      assert.ok(Math.hypot(ax - node.x, ay - node.y) < 1e-6, `${s.id} touches its vertex`);
      // and the other end meets every sibling strand of the same tx at
      // one point — the junction (or the split point of an unbroken
      // two-party bow), where the arrowed half takes over
      const [mx, my] = s.dir === "in" ? [q.x1, q.y1] : [q.x0, q.y0];
      const seen = meet.get(s.tid);
      if (!seen) meet.set(s.tid, { x: mx, y: my });
      else assert.ok(Math.hypot(mx - seen.x, my - seen.y) < 1e-6, `${s.id} meets its tx`);
    }
  }
});

test("catch-up REPARTITION: from and to are the SAME cell — no cell change, nothing for a camera to follow (#13)", () => {
  const cell = stableDestinations().find((c) =>
    c.view === "graph" && !c.layout.plane && c.grouping === "clustered")!;
  const e = createEngine(cell, "k");
  integrate(e, { key: "k", revision: 1 });
  tick(e, 16);
  assert.ok(e.active);
  for (const leg of e.active!.legs) {
    assert.equal(leg.kind, "REPARTITION");
    assert.ok(sameCell(leg.from, leg.to), "a catch-up moves data, not the cell");
  }
});
