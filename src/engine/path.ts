// pathBetween (#141 slice 1): plan the legs from one rest state to
// another. Total over every stable AND transient source (a tutorial
// hold or a preempted leg's endpoint can be the starting point), and
// its outputs visit only defined cells — invalid cells are unreachable
// by construction.
import {
  type EngineViewState, type GraphCell,
  canonicalCell, sameCell, cellClass, graphCell, derivedCoins, derivedTx,
  BRIDGE, PLANE, LINE, CIRCLE,
} from "./state";
import { type Leg, type LegKind } from "./legs";

function leg(kind: LegKind, from: EngineViewState, to: EngineViewState): Leg {
  return { kind, from, to };
}

/** the line waypoint of a family: the current picture collapsed onto
 *  the time axis. Always sequenced — FLATTEN lands on the time-ordered
 *  line ("which starts out as a time axis going left to right"). */
function lineCell(grouping: GraphCell["grouping"]): GraphCell {
  return {
    view: "graph", layout: LINE, arrange: "sequenced", grouping,
    coins: derivedCoins(LINE, grouping), tx: derivedTx(LINE, grouping),
  };
}

/** legs that lower the detail axes in place — pills shrink to disks,
 *  tx vertices dissolve into edge bundles (the micro-order's first
 *  phase, strictly before any positional leg leaves the plane) */
function detailDown(cell: GraphCell): Leg[] {
  const out: Leg[] = [];
  let cur = cell;
  if (cell.coins === "pill") {
    const next = { ...cur, coins: "disk" as const };
    out.push(leg("DETAIL", cur, next));
    cur = next;
  }
  if (cur.tx === "vertex") {
    const next = { ...cur, tx: "edgeset" as const };
    out.push(leg("UNBUNDLE", cur, next));
    cur = next;
  }
  return out;
}

/** the exit reverse, in place: bundles pinch back into transaction
 *  vertices, then disks grow back into pills */
function detailUp(from: GraphCell, target: GraphCell): Leg[] {
  const out: Leg[] = [];
  let cur = from;
  if (target.tx === "vertex" && cur.tx === "edgeset") {
    const next = { ...cur, tx: "vertex" as const };
    out.push(leg("PINCH", cur, next));
    cur = next;
  }
  if (target.coins === "pill" && cur.coins === "disk") {
    const next = { ...cur, coins: "pill" as const };
    out.push(leg("DETAIL", cur, next));
    cur = next;
  }
  return out;
}

type Family = "plane" | "line" | "circle" | "segments";
function family(cell: GraphCell): Family {
  return cell.layout.plane ? "plane" : cell.layout.shape.curve;
}

/** plan within the graph view at a FIXED grouping (the caller has
 *  already sequenced any grouping change around this) */
function layoutLegs(from: GraphCell, to: GraphCell): Leg[] {
  if (sameCell(from, to)) return [];
  const out: Leg[] = [];
  let cur = from;
  const step = (kind: LegKind, next: GraphCell): void => {
    out.push(leg(kind, cur, next));
    cur = next;
  };
  const grouping = from.grouping;

  // a segments shape closes to the ring before anything else moves
  // (the modal geometry is only ever entered/left through the circle)
  if (family(cur) === "segments") step("CLOSE", { ...cur, layout: CIRCLE });
  // the internal curve+force cells settle to the sequenced curve first
  if (!cur.layout.plane && cur.arrange === "force" && !sameCell(cur, to)) {
    step("REARRANGE", { ...cur, arrange: "sequenced" });
  }
  if (sameCell(cur, to)) return out;

  // a segments target opens from the ring as the last move
  if (family(to) === "segments") {
    const ring = graphCell(CIRCLE, "sequenced", grouping);
    out.push(...layoutLegs(cur, ring));
    if (out.length > 0) cur = out[out.length - 1]!.to as GraphCell;
    out.push(leg("OPEN", cur, to));
    return out;
  }

  switch (family(cur)) {
    case "plane": {
      if (family(to) === "plane") {
        if (cur.arrange !== to.arrange) step("REARRANGE", { ...cur, arrange: to.arrange });
        for (const l of detailUp(cur, to)) { out.push(l); cur = l.to as GraphCell; }
        return out;
      }
      // plane → curve: detail legs in place, then FLATTEN, then CURL —
      // except from the band, which already lies on the line (its
      // canonical cell IS the line picture), so it curls directly
      for (const l of detailDown(cur)) { out.push(l); cur = l.to as GraphCell; }
      const isBand = grouping === "clustered" && cur.arrange === "sequenced";
      if (!isBand) step("FLATTEN", lineCell(grouping));
      else cur = lineCell(grouping); // same picture, curve-family name
      if (family(to) === "circle") step("CURL", { ...cur, layout: CIRCLE });
      return out;
    }
    case "line": {
      // a tutorial hold can pin pills onto the line; they shrink back
      // to disks in place before the line moves anywhere
      for (const l of detailDown(cur)) { out.push(l); cur = l.to as GraphCell; }
      if (family(to) === "circle") { step("CURL", { ...cur, layout: CIRCLE }); return out; }
      // line → plane: UNFLATTEN re-separates (or REARRANGE to force);
      // the clustered sequenced target IS the band = this very line
      return exitToPlane();
    }
    case "circle": {
      if (family(to) === "line") { step("UNCURL", { ...cur, layout: LINE }); return out; }
      step("UNCURL", lineCell(grouping));
      return exitToPlane();
    }
    case "segments":
      return out; // unreachable: closed above
  }

  function exitToPlane(): Leg[] {
    const bandTarget = grouping === "clustered" && to.arrange === "sequenced";
    if (bandTarget) {
      cur = graphCell(PLANE, "sequenced", "clustered");
    } else {
      // arriving from the curve the detail axes stay lowered until the
      // in-place legs re-form them (the exact reverse of entry)
      const landed: GraphCell = {
        ...graphCell(PLANE, to.arrange, grouping),
        coins: "disk", tx: "edgeset",
      };
      step(to.arrange === "sequenced" ? "UNFLATTEN" : "REARRANGE", landed);
    }
    for (const l of detailUp(cur, to)) { out.push(l); cur = l.to as GraphCell; }
    return out;
  }
}

/** plan between any two graph cells: fixed axis order — grouping OFF
 *  first (ungroup before moving), layout/arrangement in the middle,
 *  grouping ON last. Single-axis changes stay single-leg (a grouped
 *  layout change stays grouped throughout — the band curls to the
 *  ring as discs). */
function graphLegs(from: GraphCell, to: GraphCell): Leg[] {
  const out: Leg[] = [];
  let cur = from;
  if (from.grouping === "clustered" && to.grouping === "ungrouped") {
    // the modal segments geometry has no ungrouped form — close to the
    // ring first (still clustered), and unstack there
    if (family(cur) === "segments") {
      const ring: GraphCell = { ...cur, layout: CIRCLE };
      out.push(leg("CLOSE", cur, ring));
      cur = ring;
    }
    const unstacked: GraphCell = { ...cur, grouping: "ungrouped", coins: "disk", tx: "edgeset" };
    out.push(leg("UNSTACK", cur, unstacked));
    cur = unstacked;
    if (family(cur) === "plane" && family(to) === "plane" && cur.arrange === to.arrange) {
      // staying put in the plane: the derived axes re-form right here
      // (grouping-off's second phase: UNSTACK, then PINCH + DETAIL)
      for (const l of detailUp(cur, to)) { out.push(l); cur = l.to as GraphCell; }
    }
  }
  const sameGroupingTarget: GraphCell = cur.grouping === to.grouping ? to : {
    ...to, grouping: cur.grouping,
    coins: derivedCoins(to.layout, cur.grouping),
    tx: derivedTx(to.layout, cur.grouping),
  };
  const moved = layoutLegs(cur, sameGroupingTarget);
  for (const l of moved) { out.push(l); cur = l.to as GraphCell; }
  if (from.grouping === "ungrouped" && to.grouping === "clustered") {
    // in the plane the derived axes flip with the grouping: DETAIL +
    // UNBUNDLE run in place first, then STACK — the same principle as
    // plane→curve entry. On the curve both sides are already
    // disk + edge-set, so the toggle is the single STACK leg.
    for (const l of detailDown(cur)) { out.push(l); cur = l.to as GraphCell; }
    out.push(leg("STACK", cur, to));
  }
  return out;
}

/** The planner. Both ends normalize to canonical cells; the result is
 *  [] exactly when they name the same picture (band→band included).
 *  cards trips pass through BRIDGE — the one graph state the card
 *  columns morph into — as a mandatory waypoint; the stored knobs are
 *  the caller's business and are never touched here. Throws on invalid
 *  cells: the planner's domain is defined cells only. */
export function pathBetween(fromRaw: EngineViewState, toRaw: EngineViewState): Leg[] {
  const from = canonicalCell(fromRaw), to = canonicalCell(toRaw);
  if (cellClass(from) === "invalid" || cellClass(to) === "invalid") {
    throw new Error("pathBetween: invalid cell");
  }
  if (sameCell(from, to)) return [];
  if (from.view === "cards") {
    return [leg("MORPH", from, BRIDGE),
      ...(to.view === "cards" ? [] : graphLegs(BRIDGE, to))];
  }
  if (to.view === "cards") {
    return [...graphLegs(from, BRIDGE), leg("MORPH", BRIDGE, to)];
  }
  return graphLegs(from, to);
}
