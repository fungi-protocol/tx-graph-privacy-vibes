// Transition legs (#141 slice 1): the named motions pathBetween plans
// with, and the one duration table every consumer reads.
import { type EngineViewState } from "./state";

/** every leg is an existing mechanism or a named greenfield one:
 *  MORPH cards↔bipartite; REARRANGE within a plane family; DETAIL the
 *  in-place pill↔disk crossfade; FLATTEN/UNFLATTEN plane↔line;
 *  CURL/UNCURL line↔circle (the shared curve parameterization);
 *  STACK/UNSTACK the grouping toggle in the current arrangement;
 *  OPEN/CLOSE circle↔segments (the ns modal); REPARTITION a data
 *  catch-up within any clustered geometry (queued by the engine, never
 *  planned by pathBetween); PINCH/UNBUNDLE the tx vertex↔edge-set
 *  change through the former vertex position. */
export type LegKind =
  | "MORPH" | "REARRANGE" | "DETAIL"
  | "FLATTEN" | "UNFLATTEN" | "CURL" | "UNCURL"
  | "STACK" | "UNSTACK" | "OPEN" | "CLOSE"
  | "REPARTITION" | "PINCH" | "UNBUNDLE";

/** one leg of a plan: a motion from one defined cell to another. Both
 *  ends are always defined cells of the capability table (stable or
 *  transient) — mid-leg poses are never planning inputs. */
export interface Leg {
  kind: LegKind;
  from: EngineViewState;
  to: EngineViewState;
}

/** each leg kind's inverse — used by the reversal-symmetry contract
 *  (the exit gesture is the exact reverse of the entry) */
export const INVERSE: Record<LegKind, LegKind> = {
  MORPH: "MORPH", REARRANGE: "REARRANGE", DETAIL: "DETAIL",
  FLATTEN: "UNFLATTEN", UNFLATTEN: "FLATTEN",
  CURL: "UNCURL", UNCURL: "CURL",
  STACK: "UNSTACK", UNSTACK: "STACK",
  OPEN: "CLOSE", CLOSE: "OPEN",
  REPARTITION: "REPARTITION",
  PINCH: "UNBUNDLE", UNBUNDLE: "PINCH",
};

// --- the duration table (owner directive 2026-07-28: animation speed
// is parameterizable in the code). Per-leg durations live in this one
// exported table; every consumer reads effective duration through
// legDurationMs, which folds in the single global speed knob — a later
// settings feature writes timing.speed and nothing else. The values
// follow the visual-continuity steer (~1.2–1.5s per positional leg;
// detail legs shorter because they run in place).

export const LEG_DURATION_MS: Record<LegKind, number> = {
  MORPH: 1300,
  REARRANGE: 1200,
  DETAIL: 400,
  FLATTEN: 1200, UNFLATTEN: 1200,
  CURL: 1500, UNCURL: 1500,
  STACK: 1500, UNSTACK: 1500,
  OPEN: 1400, CLOSE: 1400,
  REPARTITION: 1200,
  PINCH: 600, UNBUNDLE: 600,
};

// --- the camera table (#141 slice 4f). A gesture carries at most ONE
// camera flight, targeting the FINAL rest state's fit — intermediate
// waypoints get no separate fit, so multi-leg gestures never pump the
// zoom. Whether a plan carries that one flight at all is a property of
// its legs: REPARTITION legs carry zero camera delta (#13 — a lens or
// heuristic repartition re-forms the map about the standing anchor at
// the standing zoom), and the detail legs run in place.
export const LEG_CAMERA: Record<LegKind, "fit" | "none"> = {
  MORPH: "fit", REARRANGE: "fit", DETAIL: "none",
  FLATTEN: "fit", UNFLATTEN: "fit", CURL: "fit", UNCURL: "fit",
  STACK: "fit", UNSTACK: "fit", OPEN: "fit", CLOSE: "fit",
  REPARTITION: "none", PINCH: "none", UNBUNDLE: "none",
};

/** the one-flight-per-gesture rule, read off a plan: "fit" when any
 *  leg moves the picture enough to owe the final rest state its one
 *  framing, "none" for plans of purely in-place legs (the engine's
 *  own catch-up REPARTITION above all) */
export function planCameraCue(legs: readonly { kind: LegKind }[]): "fit" | "none" {
  return legs.some((l) => LEG_CAMERA[l.kind] === "fit") ? "fit" : "none";
}

/** the one global animation-speed knob: 1 = authored pace, 2 = twice
 *  as fast. Mutable by design — a settings feature writes it. */
export const timing = { speed: 1 };

/** preemption acceleration: a fixed multiplier on the active leg when
 *  a new intent arrives mid-motion. Re-preemption while already
 *  accelerated keeps the same factor — it never compounds, never cuts. */
export const CATCHUP_ACCEL = 4;

/** effective wall-clock duration of a leg right now */
export function legDurationMs(kind: LegKind, accelerated = false): number {
  const speed = timing.speed > 0 ? timing.speed : 1;
  return LEG_DURATION_MS[kind] / speed / (accelerated ? CATCHUP_ACCEL : 1);
}
