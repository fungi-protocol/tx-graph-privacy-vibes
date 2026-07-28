// The display engine (#141 slice 1): one queue of legs, one clock,
// preemption by acceleration, async results by monotone catch-up.
// Pure — time arrives as an argument, rendering is the caller's
// problem; the engine only says which leg is in flight and how far.
import { type EngineViewState, canonicalCell, sameCell, cellClass } from "./state";
import { type Leg, legDurationMs, CATCHUP_ACCEL } from "./legs";
import { pathBetween } from "./path";

/** the ns-social replay modal: engine-owned, so every consumer asks
 *  one place whether layout-affecting inputs are disabled. cursor =
 *  the replay position (event index). */
export type Modal = { kind: "none" } | { kind: "ns"; cursor: number };

/** an integration event: something the data model finished that may
 *  change what the current view shows. The engine does not interpret
 *  keys — it only knows that a newer revision for the DISPLAYED key
 *  means one queued catch-up leg (REPARTITION or entrances), and that
 *  revisions coalesce: catch-up always targets the newest, never
 *  animating through intermediates one by one. */
export interface IntegrationEvent {
  /** cache key: enabled-analysis set + day + params (mapSig/matchSig/
   *  chainKey composed by the caller) */
  key: string;
  /** monotone revision — a late result is never wrong, only possibly
   *  subsumed by a newer one */
  revision: number;
}

interface ActiveMotion {
  legs: Leg[];
  /** index of the leg in flight */
  index: number;
  /** progress through the active leg, 0..1 */
  progress: number;
  /** 1 = authored pace; CATCHUP_ACCEL once preempted */
  speed: number;
}

export interface DisplayEngine {
  /** the rest state the current motion (if any) is headed to; with no
   *  motion, the state on screen */
  committed: EngineViewState;
  active: ActiveMotion | null;
  /** the latest intent that arrived during motion — rapid gestures
   *  coalesce here, and ONE plan runs from the next rest point */
  pending: EngineViewState | null;
  modal: Modal;
  /** the cache key whose result the view currently displays */
  displayedKey: string;
  /** newest integrated revision per key (monotone) */
  revisions: Map<string, number>;
  /** a catch-up leg is owed to the view (coalesced; boolean, not a
   *  queue — catch-up targets the newest revision by construction) */
  catchUpDue: boolean;
}

export function createEngine(initial: EngineViewState, displayedKey = ""): DisplayEngine {
  const start = canonicalCell(initial);
  if (cellClass(start) === "invalid") throw new Error("engine: invalid initial cell");
  return {
    committed: start, active: null, pending: null,
    modal: { kind: "none" }, displayedKey,
    revisions: new Map(), catchUpDue: false,
  };
}

/** where the engine will next be at rest: the end of the active leg
 *  (mid-leg poses are never planning inputs — a preempted motion
 *  accelerates to its ACTIVE leg's endpoint, a defined cell, and the
 *  replacement plan starts there; queued-but-unstarted legs drop) */
export function restPoint(e: DisplayEngine): EngineViewState {
  return e.active ? e.active.legs[e.active.index]!.to : e.committed;
}

/** a user gesture (knob, keyboard, fragment arriving mid-session).
 *  Idle: plan and start. In motion: overwrite pending (coalescing) and
 *  accelerate — the animation hurries, it never cuts. While the ns
 *  modal is open, layout-affecting gestures are rejected (the modal's
 *  controls are disabled at the UI, and the engine backstops it). */
export function request(e: DisplayEngine, nextRaw: EngineViewState): void {
  if (e.modal.kind === "ns") return;
  const next = canonicalCell(nextRaw);
  if (cellClass(next) === "invalid") throw new Error("engine: invalid target cell");
  if (e.active) {
    // drop queued legs; the active leg accelerates to its endpoint
    e.active.legs = e.active.legs.slice(0, e.active.index + 1);
    e.active.speed = CATCHUP_ACCEL; // fixed: re-preemption never compounds
    e.pending = next;
    return;
  }
  if (sameCell(e.committed, next)) return;
  startPlan(e, next);
}

/** jump with no motion (fragment restore, tutorial resets, tests):
 *  the engine lands at the cell instantly, dropping any plan. The ns
 *  modal backstop applies as for request. */
export function snapTo(e: DisplayEngine, cell: EngineViewState): void {
  if (e.modal.kind === "ns") return;
  const c = canonicalCell(cell);
  if (cellClass(c) === "invalid") throw new Error("engine: invalid snap cell");
  e.committed = c;
  e.active = null;
  e.pending = null;
}

function startPlan(e: DisplayEngine, target: EngineViewState): void {
  const legs = pathBetween(e.committed, target);
  if (legs.length === 0) { e.committed = canonicalCell(target); return; }
  e.active = { legs, index: 0, progress: 0, speed: 1 };
  e.committed = canonicalCell(target);
}

/** integrate an async result (worker landing, day step, heuristic
 *  recompute). Monotone: an older revision for a known key is absorbed
 *  silently. A result for a key not displayed updates the cache and
 *  moves nothing; a newer result for the displayed key owes the view
 *  one catch-up leg, run when the engine is next at rest (behind the
 *  active motion, subject to the acceleration rule). Inside the ns
 *  modal, catch-up defers until exit. */
export function integrate(e: DisplayEngine, ev: IntegrationEvent): void {
  const known = e.revisions.get(ev.key) ?? -1;
  if (ev.revision <= known) return;
  e.revisions.set(ev.key, ev.revision);
  if (ev.key === e.displayedKey) e.catchUpDue = true;
}

/** advance the clock. Returns true while motion continues. The caller
 *  ticks with real elapsed milliseconds; leg durations come off the
 *  one table via the global speed knob. */
export function tick(e: DisplayEngine, dtMs: number): boolean {
  if (!e.active) {
    maybeCatchUp(e);
    return e.active !== null;
  }
  let remaining = dtMs;
  while (remaining > 0 && e.active) {
    const a = e.active;
    const legT = legDurationMs(a.legs[a.index]!.kind, a.speed > 1);
    const step = (remaining / legT);
    if (a.progress + step < 1) {
      a.progress += step;
      remaining = 0;
      break;
    }
    remaining -= (1 - a.progress) * legT;
    a.progress = 0;
    a.index += 1;
    if (a.index >= a.legs.length) {
      e.active = null;
      if (e.pending) {
        const next = e.pending;
        e.pending = null;
        // one plan from the rest point (the finished leg's endpoint)
        const rest = a.legs[a.legs.length - 1]!.to;
        e.committed = rest;
        if (!sameCell(rest, next)) startPlan(e, next);
        else e.committed = canonicalCell(next);
      }
    }
  }
  if (!e.active) maybeCatchUp(e);
  return e.active !== null;
}

/** the owed catch-up runs only at rest, as its own queued leg (the
 *  view glides to the newest integrated revision — REPARTITION in a
 *  clustered geometry; the caller renders it) */
function maybeCatchUp(e: DisplayEngine): void {
  if (!e.catchUpDue || e.modal.kind === "ns" || e.pending) return;
  e.catchUpDue = false;
  const here = e.committed;
  if (here.view !== "graph") return; // cards redraw needs no leg
  e.active = {
    legs: [{ kind: "REPARTITION", from: here, to: here }],
    index: 0, progress: 0, speed: 1,
  };
}

/** enter the ns replay modal (only from chord × clusters; the caller
 *  writes those knobs first — entry IS an explicit navigation) */
export function enterNsModal(e: DisplayEngine, cursor: number): boolean {
  if (e.modal.kind === "ns") return true;
  const here = e.committed;
  const chordClusters = here.view === "graph" && !here.layout.plane
    && here.layout.shape.curve === "circle" && here.grouping === "clustered";
  if (!chordClusters || e.active) return false;
  e.modal = { kind: "ns", cursor };
  return true;
}

/** leave the modal; a deferred catch-up (analyses that landed during
 *  the replay) runs as usual once the close motion rests */
export function exitNsModal(e: DisplayEngine): void {
  if (e.modal.kind !== "ns") return;
  e.modal = { kind: "none" };
}
