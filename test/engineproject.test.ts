// The legacy-scalar projection (#141 slice 3c): the engine's leg
// queue reads back as the viewT / collapseT scalars the current
// renderer paints from — exact at rest, monotone in flight, MORPH
// moving only viewT and the contraction family only collapseT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectScalars, mapValue } from "../src/engine/project";
import { createEngine, request, tick, integrate } from "../src/engine/engine";
import {
  CARDS, BRIDGE, presetCell, graphCell, PLANE, CIRCLE,
} from "../src/engine/state";

test("at rest: scalars exact per stable cell", () => {
  const cases: [Parameters<typeof createEngine>[0], 0 | 1, 0 | 1][] = [
    [CARDS, 0, 0],
    [BRIDGE, 1, 0],
    [presetCell("force", "ungrouped"), 1, 0],
    [presetCell("chord", "ungrouped"), 1, 1],
    [presetCell("chord", "clustered"), 1, 1],
    [presetCell("layered", "clustered"), 1, 1], // the band
    [presetCell("force", "clustered"), 1, 1],   // the force map
  ];
  for (const [cell, wantView, wantMap] of cases) {
    const e = createEngine(cell);
    const s = projectScalars(e);
    assert.equal(s.viewT, wantView, JSON.stringify(cell));
    assert.equal(s.collapseT, wantMap, JSON.stringify(cell));
    assert.equal(s.collapsed, wantMap === 1);
    assert.equal(s.targetView, wantView);
    assert.equal(mapValue(cell), wantMap);
  }
});

test("bridge -> ring: collapseT climbs monotonically, viewT holds at 1", () => {
  const e = createEngine(BRIDGE);
  request(e, presetCell("chord", "clustered"));
  assert.ok(e.active);
  let prev = 0;
  while (e.active) {
    tick(e, 40);
    const s = projectScalars(e);
    assert.equal(s.viewT, 1);
    assert.equal(s.targetView, 1);
    assert.equal(s.collapsed, true, "collapsed flips at intent time");
    assert.ok(s.collapseT >= prev - 1e-12 && s.collapseT <= 1, `monotone: ${s.collapseT}`);
    prev = s.collapseT;
  }
  assert.equal(projectScalars(e).collapseT, 1);
});

test("cards -> ring: MORPH rides viewT first, the contraction follows", () => {
  const e = createEngine(CARDS);
  request(e, presetCell("chord", "clustered"));
  assert.ok(e.active);
  let prevV = 0, prevC = 0, sawMorphOnly = false;
  while (e.active) {
    tick(e, 30);
    const s = projectScalars(e);
    assert.ok(s.viewT >= prevV - 1e-12 && s.collapseT >= prevC - 1e-12, "both monotone");
    // while the morph is in flight the contraction has not begun
    if (s.viewT > 0.1 && s.viewT < 0.9) {
      assert.equal(s.collapseT, 0, "collapseT waits for the morph");
      sawMorphOnly = true;
    }
    // and once contraction moves, the morph is done
    if (s.collapseT > 0) assert.equal(s.viewT, 1);
    prevV = s.viewT; prevC = s.collapseT;
  }
  assert.ok(sawMorphOnly, "the morph leg was observed mid-flight");
  const s = projectScalars(e);
  assert.equal(s.viewT, 1);
  assert.equal(s.collapseT, 1);
});

test("ring -> cards: the exact reverse — collapseT falls to 0 before viewT moves", () => {
  const e = createEngine(presetCell("chord", "clustered"));
  request(e, CARDS);
  assert.ok(e.active);
  let prevV = 1, prevC = 1;
  while (e.active) {
    tick(e, 30);
    const s = projectScalars(e);
    assert.equal(s.targetView, 0);
    assert.equal(s.collapsed, false);
    assert.ok(s.viewT <= prevV + 1e-12 && s.collapseT <= prevC + 1e-12, "both fall");
    if (s.viewT < 1) assert.equal(s.collapseT, 0, "the map is gone before the morph");
    prevV = s.viewT; prevC = s.collapseT;
  }
  const s = projectScalars(e);
  assert.equal(s.viewT, 0);
  assert.equal(s.collapseT, 0);
});

test("in-map rearrangement: scalars hold constant through the motion", () => {
  const e = createEngine(presetCell("layered", "clustered"));
  request(e, presetCell("force", "clustered"));
  assert.ok(e.active);
  while (e.active) {
    tick(e, 40);
    const s = projectScalars(e);
    assert.equal(s.viewT, 1);
    assert.equal(s.collapseT, 1, "band -> force map never leaves the map");
  }
});

test("catch-up REPARTITION: scalars constant, no NaN", () => {
  const e = createEngine(presetCell("chord", "clustered"), "k");
  integrate(e, { key: "k", revision: 1 });
  tick(e, 16);
  assert.ok(e.active);
  assert.equal(e.active!.legs[0]!.kind, "REPARTITION");
  while (e.active) {
    tick(e, 40);
    const s = projectScalars(e);
    assert.equal(s.viewT, 1);
    assert.equal(s.collapseT, 1);
  }
});

test("preemption: scalars stay in [0,1], targetView reflects the pending intent", () => {
  const e = createEngine(BRIDGE);
  request(e, presetCell("chord", "clustered"));
  for (let i = 0; i < 10; i++) tick(e, 40);
  request(e, CARDS); // mid-contraction: drop queue, accelerate, coalesce
  assert.ok(e.pending);
  const mid = projectScalars(e);
  assert.equal(mid.targetView, 0, "the pending intent names the destination");
  assert.equal(mid.collapsed, false);
  while (e.active || e.pending) {
    tick(e, 40);
    const s = projectScalars(e);
    for (const v of [s.viewT, s.collapseT]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${v}`);
    }
  }
  const s = projectScalars(e);
  assert.equal(s.viewT, 0);
  assert.equal(s.collapseT, 0);
});
