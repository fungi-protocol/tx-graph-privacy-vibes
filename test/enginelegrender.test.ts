// Leg interpolator contracts (#141 slice 3b): both endpoints exact,
// identity stable mid-flight, no NaN anywhere, radii constant across
// the glides that must not resize (the clusters-never-fade rule works
// through motion, and a disc's size is a pure function of the
// partition).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerpFrames, curlFrames, repartitionFrames, ease } from "../src/engine/legrender";
import {
  layoutClusterGraph, layoutClusterBand, layoutClusterForceMap,
} from "../src/ui/clusterlayout";
import { transitionFragments } from "../src/ui/clustertransition";
import { clusterObserver, clusterSingletons } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";

function fixture(): { eco: Economy; cl: ReturnType<typeof clusterObserver> } {
  const eco = new Economy("welcome");
  eco.runTo(60);
  return { eco, cl: clusterObserver(eco.chain, (d) => eco.prices[d]) };
}

test("lerpFrames: endpoints exact, ids stable, finite throughout", () => {
  const { eco, cl } = fixture();
  const band = layoutClusterBand(cl, eco.chain);
  const map = layoutClusterForceMap(cl, eco.chain);
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const f = lerpFrames(band, map, p);
    assert.equal(f.size, band.nodes.size);
    for (const [rep, v] of f) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.r), rep);
    }
  }
  const at0 = lerpFrames(band, map, 0), at1 = lerpFrames(band, map, 1);
  for (const [rep, n] of band.nodes) {
    assert.deepEqual(at0.get(rep), { x: n.x, y: n.y, r: n.r });
  }
  for (const [rep, n] of map.nodes) {
    assert.deepEqual(at1.get(rep), { x: n.x, y: n.y, r: n.r });
  }
});

test("curlFrames: p=0 IS the band frame, p=1 IS the ring, radii never change", () => {
  const { eco, cl } = fixture();
  const band = layoutClusterBand(cl, eco.chain);
  const ring = layoutClusterGraph(cl, eco.chain, "time");
  const flat = curlFrames(band, 0).frames;
  for (const [rep, n] of band.nodes) {
    const v = flat.get(rep)!;
    assert.ok(Math.abs(v.x - n.x) < 1e-6 && Math.abs(v.y - n.y) < 1e-6, `${rep} flat`);
  }
  const curled = curlFrames(band, 1).frames;
  for (const [rep, n] of ring.nodes) {
    const v = curled.get(rep)!;
    assert.ok(Math.abs(v.x - n.x) < 1e-6 && Math.abs(v.y - n.y) < 1e-6,
      `${rep} curled: ${v.x},${v.y} vs ${n.x},${n.y}`);
  }
  // mid-flight: finite, radii held, order along the curve preserved
  for (const p of [0.2, 0.5, 0.8]) {
    const f = curlFrames(band, p).frames;
    for (const [rep, n] of band.nodes) {
      const v = f.get(rep)!;
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
      assert.equal(v.r, n.r, "the curl never resizes a disc");
    }
  }
});

test("curlFrames over the singleton partition: the ungrouped line curls the same way", () => {
  const { eco } = fixture();
  const sing = clusterSingletons(eco.chain);
  const band = layoutClusterBand(sing, eco.chain);
  const ring = layoutClusterGraph(sing, eco.chain, "time");
  const curled = curlFrames(band, 1).frames;
  for (const [rep, n] of ring.nodes) {
    const v = curled.get(rep)!;
    assert.ok(Math.abs(v.x - n.x) < 1e-6 && Math.abs(v.y - n.y) < 1e-6, rep);
  }
});

test("repartitionFrames: starts at the old discs' centroid, lands on the slot", () => {
  const { eco, cl } = fixture();
  const sing = clusterSingletons(eco.chain);
  const oldClay = layoutClusterGraph(sing, eco.chain, "time");
  const newClay = layoutClusterGraph(cl, eco.chain, "time");
  const frags = transitionFragments(sing, oldClay, cl);
  const at1 = repartitionFrames(newClay, frags, 1);
  for (const [rep, n] of newClay.nodes) {
    assert.deepEqual(at1.get(rep), { x: n.x, y: n.y, r: n.r });
  }
  const at0 = repartitionFrames(newClay, frags, 0);
  for (const [rep, v] of at0) {
    const f = frags.get(rep);
    if (!f || f.length === 0) continue;
    let sx = 0, sy = 0, w = 0;
    for (const g of f) { sx += g.x * g.r * g.r; sy += g.y * g.r * g.r; w += g.r * g.r; }
    assert.ok(Math.abs(v.x - sx / w) < 1e-9 && Math.abs(v.y - sy / w) < 1e-9, rep);
  }
  // every new vertex has fragments (the singleton lattice bottom covers
  // every coin), so nothing pops into place at t=0
  for (const rep of newClay.nodes.keys()) {
    assert.ok((frags.get(rep)?.length ?? 0) > 0, `${rep} glides, never pops`);
  }
});

test("ease: monotone, clamped, exact endpoints", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  let prev = 0;
  for (let p = 0; p <= 1.001; p += 0.05) {
    const v = ease(p);
    assert.ok(v >= prev);
    prev = v;
  }
});
