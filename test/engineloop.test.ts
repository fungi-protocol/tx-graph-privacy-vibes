import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARDS, BRIDGE, graphCell, presetCell, sameCell, PLANE,
} from "../src/engine/state";
import {
  createEngine, request, tick, integrate, restPoint,
  enterNsModal, exitNsModal,
} from "../src/engine/engine";
import { legDurationMs, LEG_DURATION_MS, timing, CATCHUP_ACCEL, LEG_CAMERA, planCameraCue } from "../src/engine/legs";

const chordC = presetCell("chord", "clustered");
const forceU = presetCell("force", "ungrouped");
const band = graphCell(PLANE, "sequenced", "clustered");

function runToRest(e: ReturnType<typeof createEngine>, stepMs = 50, cap = 10_000): number {
  let elapsed = 0;
  while (tick(e, stepMs) && elapsed < cap) elapsed += stepMs;
  return elapsed;
}

test("durations: one table, one speed knob, acceleration composes on top", () => {
  assert.equal(legDurationMs("CURL"), LEG_DURATION_MS.CURL);
  assert.equal(legDurationMs("CURL", true), LEG_DURATION_MS.CURL / CATCHUP_ACCEL);
  timing.speed = 2;
  try {
    assert.equal(legDurationMs("CURL"), LEG_DURATION_MS.CURL / 2);
    assert.equal(legDurationMs("CURL", true), LEG_DURATION_MS.CURL / 2 / CATCHUP_ACCEL);
  } finally {
    timing.speed = 1;
  }
});

test("a gesture from idle plans and runs to the committed rest state", () => {
  const e = createEngine(CARDS);
  request(e, chordC);
  assert.ok(e.active, "motion started");
  assert.ok(sameCell(e.committed, chordC), "committed is the destination");
  runToRest(e);
  assert.equal(e.active, null);
  assert.ok(sameCell(e.committed, chordC));
});

test("preemption: the active leg accelerates to its endpoint, queued legs drop, one plan resumes", () => {
  const e = createEngine(CARDS);
  request(e, chordC); // MORPH, DETAIL, UNBUNDLE, FLATTEN, CURL, STACK
  tick(e, 100); // mid-MORPH
  const before = e.active!;
  assert.equal(before.legs[before.index]!.kind, "MORPH");
  request(e, forceU); // preempt
  assert.equal(e.active!.legs.length, e.active!.index + 1, "queued legs dropped");
  assert.equal(e.active!.speed, CATCHUP_ACCEL);
  assert.ok(e.pending && sameCell(e.pending, forceU));
  // re-preemption keeps the same factor — never compounds
  request(e, chordC);
  assert.equal(e.active!.speed, CATCHUP_ACCEL);
  assert.ok(e.pending && sameCell(e.pending, chordC), "intents coalesce to the last");
  // the accelerated MORPH finishes at BRIDGE, then ONE plan runs from there
  const restBefore = restPoint(e);
  assert.ok(sameCell(restBefore, BRIDGE));
  runToRest(e);
  assert.equal(e.pending, null);
  assert.ok(sameCell(e.committed, chordC), "run ends at the last intent");
});

test("integration: keyed, monotone, view moves only via a queued catch-up leg", () => {
  const e = createEngine(chordC, "keyA");
  // a result for a key not displayed updates the cache silently
  integrate(e, { key: "keyB", revision: 1 });
  assert.equal(e.catchUpDue, false);
  tick(e, 16);
  assert.equal(e.active, null, "nothing moves for an undisplayed key");
  // a newer displayed-key revision owes one catch-up leg at rest
  integrate(e, { key: "keyA", revision: 1 });
  integrate(e, { key: "keyA", revision: 2 }); // coalesces — still one leg
  tick(e, 16);
  assert.ok(e.active, "catch-up leg queued at rest");
  assert.equal(e.active!.legs[0]!.kind, "REPARTITION");
  assert.equal(e.active!.legs.length, 1);
  runToRest(e);
  // an older revision arriving late is absorbed silently
  integrate(e, { key: "keyA", revision: 1 });
  tick(e, 16);
  assert.equal(e.active, null);
});

test("#13: REPARTITION legs carry zero camera delta; a gesture's plan carries at most one fit", () => {
  // the camera table's rule rows: repartitions and in-place detail
  // legs move the camera not at all
  assert.equal(LEG_CAMERA.REPARTITION, "none");
  assert.equal(LEG_CAMERA.DETAIL, "none");
  // the engine's own catch-up leg is a REPARTITION plan — camera-free
  const e = createEngine(chordC, "k");
  integrate(e, { key: "k", revision: 1 });
  tick(e, 16);
  assert.ok(e.active, "catch-up leg in flight");
  assert.equal(planCameraCue(e.active!.legs), "none",
    "a worker landing repartitions with zero camera delta");
  runToRest(e);
  // a gesture's plan (uncurl out of the ring) owes the one final fit
  request(e, band);
  assert.equal(planCameraCue(e.active!.legs), "fit");
});

test("catch-up waits for the active motion; cards needs no leg", () => {
  const e = createEngine(chordC, "k");
  request(e, band);
  integrate(e, { key: "k", revision: 1 });
  assert.ok(e.active && e.active.legs[0]!.kind === "UNCURL", "gesture still in flight");
  runToRest(e); // rest at band, then the owed catch-up starts
  assert.ok(sameCell(e.committed, band));
  // runToRest drained the catch-up too — verify by re-owing one
  integrate(e, { key: "k", revision: 2 });
  tick(e, 16);
  assert.ok(e.active);
  assert.equal(e.active!.legs[0]!.kind, "REPARTITION");
  runToRest(e);
  const cards = createEngine(CARDS, "k");
  integrate(cards, { key: "k", revision: 1 });
  tick(cards, 16);
  assert.equal(cards.active, null, "cards redraws without a leg");
});

test("ns modal: entered only from chord×clusters at rest; gestures reject; catch-up defers to exit", () => {
  const e = createEngine(forceU, "k");
  assert.equal(enterNsModal(e, 0), false, "not chord×clusters");
  request(e, chordC);
  assert.equal(enterNsModal(e, 0), false, "not at rest");
  runToRest(e);
  assert.equal(enterNsModal(e, 3), true);
  assert.deepEqual(e.modal, { kind: "ns", cursor: 3 });
  request(e, forceU); // layout-affecting gesture during the modal
  assert.equal(e.active, null, "rejected");
  assert.ok(sameCell(e.committed, chordC));
  integrate(e, { key: "k", revision: 1 });
  tick(e, 16);
  assert.equal(e.active, null, "catch-up deferred inside the modal");
  exitNsModal(e);
  tick(e, 16);
  assert.ok(e.active && e.active.legs[0]!.kind === "REPARTITION", "deferred catch-up runs on exit");
});
