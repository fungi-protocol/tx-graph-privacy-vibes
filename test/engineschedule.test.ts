// The model-based schedule test (#141 slice 1): a deterministic driver
// over the failure-producing permutations — rapid knob reversals,
// integration events landing mid-motion, modal entry/exit — sampling
// at every tick and asserting the engine's invariants throughout:
// every rest cell is defined, motion never cuts (a preemption
// accelerates the ACTIVE leg to its own endpoint; the replacement plan
// starts exactly there), and every run ends at the canonical target of
// the last intent.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type EngineViewState, CARDS, graphCell, presetCell, sameCell, cellClass, PLANE,
} from "../src/engine/state";
import {
  createEngine, request, tick, integrate, restPoint,
  enterNsModal, exitNsModal, type DisplayEngine,
} from "../src/engine/engine";

const DESTS: EngineViewState[] = [
  CARDS,
  presetCell("layered", "ungrouped"),
  presetCell("layered", "clustered"),
  presetCell("force", "ungrouped"),
  presetCell("force", "clustered"),
  presetCell("chord", "ungrouped"),
  presetCell("chord", "clustered"),
];

type Action =
  | { at: number; do: "gesture"; dest: number }
  | { at: number; do: "integrate"; key: string; revision: number }
  | { at: number; do: "nsEnter" } | { at: number; do: "nsExit" };

/** run one scripted schedule, asserting invariants at every tick */
function run(schedule: Action[], horizonMs: number): DisplayEngine {
  const e = createEngine(CARDS, "shown");
  let lastIntent: EngineViewState = CARDS;
  let modalHeld = false;
  const pendingByTime = [...schedule].sort((a, b) => a.at - b.at);
  let cursor = 0;
  let prevActiveKind: string | null = null;
  for (let t = 0; t <= horizonMs; t += 16) {
    while (cursor < pendingByTime.length && pendingByTime[cursor]!.at <= t) {
      const a = pendingByTime[cursor]!;
      cursor += 1;
      if (a.do === "gesture") {
        const wasActive = e.active;
        const restBefore = wasActive ? restPoint(e) : e.committed;
        request(e, DESTS[a.dest]!);
        if (e.modal.kind === "none") {
          lastIntent = DESTS[a.dest]!;
          if (wasActive) {
            // acceleration, never a cut: the rest point is unchanged by
            // the preemption — the active leg still lands where it was
            // going, and only then does the new plan start
            assert.ok(sameCell(restPoint(e), restBefore),
              "preemption must not retarget the active leg");
          }
        }
      } else if (a.do === "integrate") {
        integrate(e, { key: a.key, revision: a.revision });
      } else if (a.do === "nsEnter") {
        // entry queues the OPEN leg itself (slice 5); the schedule's
        // exits request the ring afterward, as the UI does
        modalHeld = enterNsModal(e, 0, 3);
      } else {
        exitNsModal(e);
        modalHeld = false;
      }
    }
    tick(e, 16);
    // invariants at every sample:
    assert.notEqual(cellClass(e.committed), "invalid");
    if (e.active) {
      const a = e.active;
      assert.ok(a.index >= 0 && a.index < a.legs.length);
      assert.ok(a.progress >= 0 && a.progress <= 1);
      assert.notEqual(cellClass(a.legs[a.index]!.from), "invalid");
      assert.notEqual(cellClass(a.legs[a.index]!.to), "invalid");
      prevActiveKind = a.legs[a.index]!.kind;
    }
  }
  void prevActiveKind;
  // drain: no further inputs — the engine must settle
  let guard = 0;
  while (tick(e, 50) && guard++ < 10_000) { /* settle */ }
  assert.equal(e.active, null, "engine settles once inputs stop");
  assert.equal(e.pending, null);
  if (!modalHeld) {
    assert.ok(sameCell(e.committed, lastIntent),
      `run ends at the last intent: ${JSON.stringify(e.committed)} vs ${JSON.stringify(lastIntent)}`);
  }
  return e;
}

test("rapid knob reversals coalesce to the last intent", () => {
  run([
    { at: 0, do: "gesture", dest: 6 },     // cards → chord clustered
    { at: 100, do: "gesture", dest: 1 },   // reverse mid-MORPH
    { at: 150, do: "gesture", dest: 6 },   // re-reverse
    { at: 200, do: "gesture", dest: 3 },   // force ungrouped
    { at: 230, do: "gesture", dest: 0 },   // back to cards
    { at: 260, do: "gesture", dest: 4 },   // force clustered — final
  ], 4_000);
});

test("integration events land during and after retargets without moving the view mid-gesture", () => {
  const e = run([
    { at: 0, do: "gesture", dest: 6 },
    { at: 300, do: "integrate", key: "shown", revision: 1 },
    { at: 400, do: "gesture", dest: 2 },
    { at: 500, do: "integrate", key: "shown", revision: 2 },
    { at: 520, do: "integrate", key: "other", revision: 9 },
  ], 8_000);
  assert.equal(e.catchUpDue, false, "owed catch-up ran at rest");
  assert.equal(e.revisions.get("shown"), 2);
  assert.equal(e.revisions.get("other"), 9);
});

test("modal entry/exit with results landing inside defers catch-up to exit", () => {
  run([
    { at: 0, do: "gesture", dest: 6 },
    { at: 6_000, do: "nsEnter" },          // at rest on chord×clusters
    { at: 6_100, do: "integrate", key: "shown", revision: 1 },
    { at: 6_200, do: "gesture", dest: 1 }, // disabled input — rejected
    { at: 6_400, do: "nsExit" },
    { at: 6_500, do: "gesture", dest: 6 }, // settle where the modal was
  ], 10_000);
});

test("every destination pair survives a mid-flight reversal to a third destination", () => {
  for (let a = 0; a < DESTS.length; a++) {
    for (let b = 0; b < DESTS.length; b++) {
      if (a === b) continue;
      const c = (b + 1) % DESTS.length;
      run([
        { at: 0, do: "gesture", dest: a },
        { at: 3_500, do: "gesture", dest: b },  // possibly mid-flight
        { at: 3_600, do: "gesture", dest: c === a ? b : c },
      ], 6_000);
    }
  }
});
