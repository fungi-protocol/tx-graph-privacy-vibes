// The viewstate adapter (#141 slice 3): the bridge between the #115
// control model (view / arrange / chord / grouping — what the knobs
// and fragments speak until the slice 4 switchover) and the engine's
// five-dimension cells. Pure translation, no wiring.
//
// Two deliberate asymmetries:
// - The chord ring is ALWAYS the sequenced circle cell. The ltr/force
//   choice under chord orders the ring (time vs fewest crossings) but
//   is not an engine axis — curve x force settles to the sequenced
//   curve (slice 1); the ordering is a registry mode, and flipping it
//   replays as a REPARTITION catch-up, exactly like a lens change.
// - Grouping composes with any graph layout (#141 slice 4d matched
//   the UI to the engine here): a clustered plane cell is the band or
//   the force map. cellOf translates faithfully whatever combination
//   the ViewState holds.
import { type ViewState, type Arrange, canonical } from "../ui/viewstate";
import {
  type EngineViewState, type GraphCell,
  CARDS, PLANE, CIRCLE, graphCell, canonicalCell,
} from "./state";

/** the engine cell a #115 ViewState names */
export function cellOf(vs: ViewState): EngineViewState {
  const v = canonical(vs);
  if (v.view === "cards") return CARDS;
  const grouping = v.grouping === "clustered" ? "clustered" as const : "ungrouped" as const;
  if (v.chord) return graphCell(CIRCLE, "sequenced", grouping);
  return graphCell(PLANE, v.arrange === "force" ? "force" : "sequenced", grouping);
}

/** the #115 ViewState a cell displays as. `arrangeMemo` carries the
 *  ltr/force knob where the cell does not determine it: under the
 *  chord ring (where it orders the ring) and under cards (where the
 *  stored knobs persist untouched). Transient cells read as their
 *  nearest stable picture — the line as the graph it is flattening
 *  toward, segments as the chord ring the modal opened from. */
export function viewStateOf(cell: EngineViewState, arrangeMemo: Arrange): ViewState {
  const c = canonicalCell(cell);
  if (c.view === "cards") {
    return canonical({ view: "cards", arrange: arrangeMemo, chord: false, grouping: "unclustered" });
  }
  const grouping = c.grouping === "clustered" ? "clustered" as const : "unclustered" as const;
  if (c.layout.plane) {
    return canonical({
      view: "graph", chord: false, grouping,
      arrange: c.arrange === "force" ? "force" : "ltr",
    });
  }
  // every curve cell wears the ring's knobs: the line is mid-flatten,
  // segments are the modal over the ring
  return canonical({ view: "graph", chord: true, grouping, arrange: arrangeMemo });
}

/** the registry's ring-ordering mode for a cell: the arrange memo
 *  orders curve layouts (time vs fewest crossings); plane cells order
 *  themselves (their arrangement IS the cell's axis) */
export function ringMode(cell: GraphCell, arrangeMemo: Arrange): "time" | "force" {
  if (cell.layout.plane) return cell.arrange === "force" ? "force" : "time";
  return arrangeMemo === "force" ? "force" : "time";
}
