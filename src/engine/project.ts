// The legacy-scalar projection (#141 slice 3c): what viewT and
// collapseT read off the engine, so the existing renderer keeps
// painting while the engine becomes the one clock. Pure — the slice-4
// switchover deletes the stored scalars and reads these instead;
// slice 3d starts rendering legs directly and drops phase cutoffs.
import { type EngineViewState } from "./state";
import { type DisplayEngine } from "./engine";
import { LEG_DURATION_MS, type LegKind } from "./legs";

export interface LegacyScalars {
  /** the destination view of the current intent (pending wins) */
  targetView: 0 | 1;
  /** 0 = cards, 1 = the bipartite graph; rides MORPH legs */
  viewT: number;
  /** whether the intent's endpoint is in the map vocabulary */
  collapsed: boolean;
  /** contraction progress; rides the contraction-family legs */
  collapseT: number;
}

/** the map vocabulary: cells the contracted-map renderer paints — any
 *  curve layout, or the clustered plane (band / force map). The
 *  bipartite plane (BRIDGE, force-ungrouped) and the cards are not. */
export function mapValue(cell: EngineViewState): 0 | 1 {
  if (cell.view === "cards") return 0;
  return !cell.layout.plane || cell.grouping === "clustered" ? 1 : 0;
}

function viewValue(cell: EngineViewState): 0 | 1 {
  return cell.view === "cards" ? 0 : 1;
}

/** the legs that ARE the contraction (either direction — a scalar
 *  walk is monotone from its plan's start value to its end value, so
 *  direction lives in those endpoints, not in the kind) */
const CONTRACT_FAMILY = new Set<LegKind>([
  "DETAIL", "PINCH", "UNBUNDLE",
  "FLATTEN", "UNFLATTEN", "CURL", "UNCURL", "STACK", "UNSTACK",
]);

/** walk one scalar across the active plan: v0 at the plan's first
 *  cell, v1 at its last, advancing only through the legs of `family`,
 *  each weighted by its authored duration (the same table the clock
 *  reads, so the scalar and the motion agree about pace). Neutral
 *  legs hold the value. */
function familyScalar(
  e: DisplayEngine,
  family: (k: LegKind) => boolean,
  value: (c: EngineViewState) => number,
): number {
  if (!e.active) return value(e.committed);
  const a = e.active;
  const v0 = value(a.legs[0]!.from);
  const v1 = value(a.legs[a.legs.length - 1]!.to);
  if (v0 === v1) return v1;
  let total = 0, done = 0;
  for (let i = 0; i < a.legs.length; i++) {
    const leg = a.legs[i]!;
    if (!family(leg.kind)) continue;
    const w = LEG_DURATION_MS[leg.kind];
    total += w;
    if (i < a.index) done += w;
    else if (i === a.index) done += w * a.progress;
  }
  if (total === 0) return v1;
  return v0 + (v1 - v0) * (done / total);
}

/** the legacy render scalars, read off the engine each frame */
export function projectScalars(e: DisplayEngine): LegacyScalars {
  const intent = e.pending ?? e.committed;
  return {
    targetView: viewValue(intent),
    viewT: familyScalar(e, (k) => k === "MORPH", viewValue),
    collapsed: mapValue(intent) === 1,
    collapseT: familyScalar(e, (k) => CONTRACT_FAMILY.has(k), mapValue),
  };
}
