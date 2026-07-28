// The map pose (#141 slice 3d): the five sub-scalars the contracted
// renderer draws from. A per-family fraction (project.ts) cannot
// express these — ring -> band is one UNCURL over clustered discs (the
// band alias) with no UNFLATTEN or UNSTACK anywhere in it — and a
// per-leg-kind ownership table under-moves flightT too: bridge -> band
// has no FLATTEN (its STACK carries coins from the plane straight into
// timeline discs), and the curve -> force-plane exit flies home on a
// REARRANGE. What IS total: every leg's endpoints are defined cells,
// so the pose is the lerp between the active leg's endpoint rest
// poses. Exact at every leg boundary by construction; each leg moves
// exactly the scalars its endpoints disagree on.
import { type EngineViewState } from "./state";
import { type DisplayEngine } from "./engine";
import { mapValue } from "./project";

export interface MapPose {
  /** coins as bare disks (1) vs full pills (0) — rides DETAIL */
  dotT: number;
  /** tx squares dissolved into junctions — rides PINCH/UNBUNDLE */
  pinchT: number;
  /** coins away from their plane-graph positions, at their line/disc
   *  slots — rides FLATTEN/UNFLATTEN, and STACK/REARRANGE where the
   *  plan enters or leaves the plane through those legs */
  flightT: number;
  /** the line bent into the ring — rides CURL/UNCURL */
  curlT: number;
  /** singleton dots gathered into their cluster discs — rides
   *  STACK/UNSTACK */
  stackT: number;
}

/** the pose a cell holds at rest */
export function restPose(cell: EngineViewState): MapPose {
  if (cell.view === "cards") {
    return { dotT: 0, pinchT: 0, flightT: 0, curlT: 0, stackT: 0 };
  }
  return {
    dotT: cell.coins === "disk" ? 1 : 0,
    pinchT: cell.tx === "edgeset" ? 1 : 0,
    flightT: mapValue(cell),
    curlT: !cell.layout.plane && cell.layout.shape.curve !== "line" ? 1 : 0,
    stackT: cell.grouping === "clustered" ? 1 : 0,
  };
}

/** the pose right now: the committed cell's rest pose at rest, else
 *  the active leg's endpoint poses interpolated by its progress —
 *  endpoint-exact (the boundary pose IS the cell's rest pose, bit for
 *  bit; the interpolant only exists strictly inside a leg) */
export function mapPose(e: DisplayEngine): MapPose {
  if (!e.active) return restPose(e.committed);
  const leg = e.active.legs[e.active.index]!;
  const a = restPose(leg.from);
  const p = e.active.progress;
  if (p <= 0) return a;
  if (p >= 1) return restPose(leg.to);
  const b = restPose(leg.to);
  return {
    dotT: a.dotT + (b.dotT - a.dotT) * p,
    pinchT: a.pinchT + (b.pinchT - a.pinchT) * p,
    flightT: a.flightT + (b.flightT - a.flightT) * p,
    curlT: a.curlT + (b.curlT - a.curlT) * p,
    stackT: a.stackT + (b.stackT - a.stackT) * p,
  };
}
