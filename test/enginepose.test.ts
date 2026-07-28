// The map pose (#141 slice 3d): five sub-scalars read off the engine,
// exact at rest, continuous across every leg boundary — including the
// plans where flightT rides STACK (bridge -> band has no FLATTEN) or
// REARRANGE (the curve -> force-plane exit), which a per-leg-kind
// ownership table would miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { restPose, mapPose, type MapPose } from "../src/engine/pose";
import { createEngine, request, tick, integrate, type DisplayEngine } from "../src/engine/engine";
import { CARDS, BRIDGE, presetCell, type EngineViewState } from "../src/engine/state";

const KEYS = ["dotT", "pinchT", "flightT", "curlT", "stackT"] as const;

function samePose(a: MapPose, b: MapPose, msg: string): void {
  for (const k of KEYS) assert.equal(a[k], b[k], `${msg}: ${k}`);
}

/** tick to rest, sampling the pose each frame */
function run(e: DisplayEngine, dt = 40): MapPose[] {
  const out: MapPose[] = [mapPose(e)];
  while (e.active || e.pending) {
    tick(e, dt);
    out.push(mapPose(e));
  }
  return out;
}

test("rest poses: exact per stable cell", () => {
  const cases: [EngineViewState, MapPose][] = [
    [CARDS, { dotT: 0, pinchT: 0, flightT: 0, curlT: 0, stackT: 0 }],
    [BRIDGE, { dotT: 0, pinchT: 0, flightT: 0, curlT: 0, stackT: 0 }],
    [presetCell("force", "ungrouped"), { dotT: 0, pinchT: 0, flightT: 0, curlT: 0, stackT: 0 }],
    [presetCell("chord", "ungrouped"), { dotT: 1, pinchT: 1, flightT: 1, curlT: 1, stackT: 0 }],
    [presetCell("chord", "clustered"), { dotT: 1, pinchT: 1, flightT: 1, curlT: 1, stackT: 1 }],
    [presetCell("layered", "clustered"), { dotT: 1, pinchT: 1, flightT: 1, curlT: 0, stackT: 1 }],
    [presetCell("force", "clustered"), { dotT: 1, pinchT: 1, flightT: 1, curlT: 0, stackT: 1 }],
  ];
  for (const [cell, want] of cases) {
    samePose(restPose(cell), want, JSON.stringify(cell));
    samePose(mapPose(createEngine(cell)), want, "engine at rest");
  }
});

test("bridge -> ring: scalars rise one at a time, in leg order", () => {
  const e = createEngine(BRIDGE);
  request(e, presetCell("chord", "clustered"));
  const poses = run(e);
  let prev = poses[0]!;
  for (const p of poses) {
    for (const k of KEYS) {
      assert.ok(p[k] >= prev[k] - 1e-12, `${k} monotone: ${prev[k]} -> ${p[k]}`);
    }
    // sequential: a later scalar only moves once every earlier one is done
    if (p.pinchT > 0) assert.equal(p.dotT, 1);
    if (p.flightT > 0) assert.equal(p.pinchT, 1);
    if (p.curlT > 0) assert.equal(p.flightT, 1);
    if (p.stackT > 0) assert.equal(p.curlT, 1);
    prev = p;
  }
  samePose(poses[poses.length - 1]!, restPose(presetCell("chord", "clustered")), "at rest");
});

test("ring -> band: ONE uncurl over standing discs — only curlT moves", () => {
  const e = createEngine(presetCell("chord", "clustered"));
  request(e, presetCell("layered", "clustered"));
  const poses = run(e);
  for (const p of poses) {
    assert.equal(p.dotT, 1);
    assert.equal(p.pinchT, 1);
    assert.equal(p.flightT, 1, "the discs never leave their slots");
    assert.equal(p.stackT, 1, "the stacks never open");
  }
  assert.equal(poses[poses.length - 1]!.curlT, 0);
});

test("bridge -> band: no FLATTEN in the plan — flightT rides the STACK leg", () => {
  const e = createEngine(BRIDGE);
  request(e, presetCell("layered", "clustered"));
  assert.ok(e.active!.legs.every((l) => l.kind !== "FLATTEN" && l.kind !== "CURL"));
  const poses = run(e);
  for (const p of poses) {
    assert.equal(p.curlT, 0);
    // the flight into the timeline discs IS the stacking motion
    assert.ok(Math.abs(p.flightT - p.stackT) < 1e-9, `${p.flightT} vs ${p.stackT}`);
  }
  samePose(poses[poses.length - 1]!, restPose(presetCell("layered", "clustered")), "at rest");
});

test("ring -> force map: flightT comes home on the REARRANGE leg", () => {
  const e = createEngine(presetCell("chord", "ungrouped"));
  request(e, presetCell("force", "ungrouped"));
  assert.ok(e.active!.legs.every((l) => l.kind !== "UNFLATTEN"));
  const poses = run(e);
  const last = poses[poses.length - 1]!;
  samePose(last, restPose(presetCell("force", "ungrouped")), "at rest");
});

test("cards -> ring: the pose holds all-zero through the MORPH", () => {
  const e = createEngine(CARDS);
  request(e, presetCell("chord", "clustered"));
  let sawMorphMid = false;
  while (e.active) {
    tick(e, 30);
    const a = e.active;
    const p = mapPose(e);
    if (a && a.legs[a.index]!.kind === "MORPH" && a.progress > 0 && a.progress < 1) {
      samePose(p, restPose(CARDS), "mid-MORPH");
      sawMorphMid = true;
    }
  }
  assert.ok(sawMorphMid, "the MORPH leg was observed mid-flight");
  samePose(mapPose(e), restPose(presetCell("chord", "clustered")), "at rest");
});

test("ring -> cards: the exact reverse, every scalar falls monotonically", () => {
  const e = createEngine(presetCell("chord", "clustered"));
  request(e, CARDS);
  const poses = run(e, 30);
  let prev = poses[0]!;
  for (const p of poses) {
    for (const k of KEYS) {
      assert.ok(p[k] <= prev[k] + 1e-12, `${k} falls: ${prev[k]} -> ${p[k]}`);
    }
    prev = p;
  }
  samePose(poses[poses.length - 1]!, restPose(CARDS), "at rest");
});

test("continuity: no scalar ever jumps across a frame", () => {
  const trips: [EngineViewState, EngineViewState][] = [
    [BRIDGE, presetCell("layered", "clustered")],
    [presetCell("layered", "clustered"), BRIDGE],
    [presetCell("chord", "ungrouped"), presetCell("force", "ungrouped")],
    [presetCell("chord", "clustered"), CARDS],
    [CARDS, presetCell("force", "clustered")],
    [presetCell("force", "clustered"), presetCell("chord", "ungrouped")],
  ];
  const dt = 40;
  const bound = dt / 400 + 1e-9; // the shortest leg (DETAIL) sets the fastest slope
  for (const [from, to] of trips) {
    const e = createEngine(from);
    request(e, to);
    const poses = run(e, dt);
    for (let i = 1; i < poses.length; i++) {
      for (const k of KEYS) {
        const step = Math.abs(poses[i]![k] - poses[i - 1]![k]);
        assert.ok(step <= bound, `${JSON.stringify([from, to])}: ${k} jumps ${step}`);
      }
    }
  }
});

test("catch-up REPARTITION: the pose holds constant", () => {
  const e = createEngine(presetCell("chord", "clustered"), "k");
  integrate(e, { key: "k", revision: 1 });
  tick(e, 16);
  assert.ok(e.active);
  const rest = restPose(presetCell("chord", "clustered"));
  while (e.active) {
    tick(e, 40);
    samePose(mapPose(e), rest, "during catch-up");
  }
});

test("preemption: scalars stay finite in [0,1] and land on the target's rest pose", () => {
  const e = createEngine(BRIDGE);
  request(e, presetCell("chord", "clustered"));
  for (let i = 0; i < 12; i++) tick(e, 40);
  request(e, CARDS); // mid-flight: truncate, accelerate, coalesce
  while (e.active || e.pending) {
    tick(e, 40);
    const p = mapPose(e);
    for (const k of KEYS) {
      assert.ok(Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 1, `${k}=${p[k]}`);
    }
  }
  samePose(mapPose(e), restPose(CARDS), "at rest");
});
