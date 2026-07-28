// The five-dimension display model (#141 slice 1): the ViewState sum
// type, the capability table, and the canonical encoding. Pure data —
// this module (like everything under src/engine/) imports no DOM.
//
// The graph view is a product of five orthogonal display dimensions:
// layout (the embedding target: the plane, or a one-dimensional curve
// further shaped as a line, a circle, or k segments), arrangement (the
// position policy: time-sequenced or force-directed), grouping (coins
// bunched into their lens-cluster classes or not), coin detail (the
// labeled pill or the small disk), and transaction rendering (an
// explicit vertex, or dissolved into its in×out edge set). The cards
// view is a separate variant, not a product cell: it composes with
// none of the graph axes.

/** the shape a curve layout is bent into. The line is the time axis
 *  (the flatten waypoint and the arc-threading diagram); the circle is
 *  the chord ring; segments(k) is the ns-social replay's k epoch
 *  columns — cluster-level only, modal only. */
export type CurveShape =
  | { curve: "line" }
  | { curve: "circle" }
  | { curve: "segments"; k: number };

export type EngineLayout = { plane: true } | { plane: false; shape: CurveShape };

export type EngineArrangement = "sequenced" | "force";
export type EngineGrouping = "ungrouped" | "clustered";
/** coin vertex detail: the pill carries amount + script type; the disk
 *  is the small undecorated circle. (A cluster's aggregate circle is a
 *  "disc" — different word, different thing.) */
export type CoinDetail = "pill" | "disk";
/** a transaction is a directed hyper-edge; drawn as a vertex (the
 *  bipartite drawing) or dissolved into its in×out edge set */
export type TxRender = "vertex" | "edgeset";

export interface GraphCell {
  view: "graph";
  layout: EngineLayout;
  arrange: EngineArrangement;
  grouping: EngineGrouping;
  coins: CoinDetail;
  tx: TxRender;
}

/** the display state: a sum, not a product — cards carries no graph
 *  axes (the stored knobs persist OUTSIDE the ViewState; see the knob
 *  model in slice 4) */
export type EngineViewState = { view: "cards" } | GraphCell;

export const PLANE: EngineLayout = { plane: true };
export const LINE: EngineLayout = { plane: false, shape: { curve: "line" } };
export const CIRCLE: EngineLayout = { plane: false, shape: { curve: "circle" } };
export function segments(k: number): EngineLayout {
  return { plane: false, shape: { curve: "segments", k } };
}

export const CARDS: EngineViewState = { view: "cards" };

/** derived detail axes: (plane ∧ ungrouped) IS the bipartite drawing —
 *  pills and transaction vertices; everything else draws disks and
 *  edge sets. The predicate is zoom-free by design: no zoom level ever
 *  changes representation. */
export function derivedCoins(layout: EngineLayout, grouping: EngineGrouping): CoinDetail {
  return layout.plane && grouping === "ungrouped" ? "pill" : "disk";
}
export function derivedTx(layout: EngineLayout, grouping: EngineGrouping): TxRender {
  return layout.plane && grouping === "ungrouped" ? "vertex" : "edgeset";
}

/** build a graph cell with the derived detail defaults */
export function graphCell(
  layout: EngineLayout,
  arrange: EngineArrangement,
  grouping: EngineGrouping,
): GraphCell {
  return {
    view: "graph", layout, arrange, grouping,
    coins: derivedCoins(layout, grouping),
    tx: derivedTx(layout, grouping),
  };
}

/** the one state the cards morph bridges to: the layered bipartite.
 *  BRIDGE is a mandatory waypoint of every cards trip — entering cards
 *  normalizes here first, leaving cards passes through here on the way
 *  to the stored destination. It never overwrites the stored knobs. */
export const BRIDGE: GraphCell = graphCell(PLANE, "sequenced", "ungrouped");

// --- knob presets: the exposed layout knob picks (layout, arrangement)
// pairs; grouping is its own knob. 7 exposed destinations = cards +
// 3 presets × 2 groupings.

export type LayoutPreset = "layered" | "force" | "chord";

export function presetCell(preset: LayoutPreset, grouping: EngineGrouping): GraphCell {
  switch (preset) {
    case "layered": return graphCell(PLANE, "sequenced", grouping);
    case "force": return graphCell(PLANE, "force", grouping);
    case "chord": return graphCell(CIRCLE, "sequenced", grouping);
  }
}

// --- canonical encoding ---

/** Normalize a state to its canonical cell. The one alias in the
 *  space: curve(line)·sequenced·clustered draws the SAME picture as
 *  plane·sequenced·clustered (the band IS the uncurled ring — discs on
 *  a timeline), so the planner normalizes it to the plane cell. This
 *  makes band→band the empty path and the encoding unambiguous.
 *  (curve(line)·sequenced·UNGROUPED is NOT an alias: disks on a line
 *  differ from the bipartite's pills and transaction boxes.) */
export function canonicalCell(vs: EngineViewState): EngineViewState {
  if (vs.view === "cards") return vs;
  if (!vs.layout.plane && vs.layout.shape.curve === "line"
      && vs.arrange === "sequenced" && vs.grouping === "clustered") {
    return { ...vs, layout: PLANE };
  }
  return vs;
}

// --- the capability table ---

/** stable: a knob-reachable destination the engine may rest at.
 *  transient: reachable only as a waypoint, tutorial hold, or the ns
 *  modal — the planner may pass through or hold here, never rest here
 *  unprompted. invalid: unrepresentable; the planner must never emit
 *  it. */
export type CellClass = "stable" | "transient" | "invalid";

export function cellClass(vs: EngineViewState): CellClass {
  if (vs.view === "cards") return "stable";
  const { layout, arrange, grouping, coins, tx } = vs;
  const bipartite = layout.plane && grouping === "ungrouped";
  // detail-axis validity first: pill only in the bipartite cells, plus
  // the line as a tutorial-hold pinned variant; a RESTING tx vertex
  // exists only in the bipartite cells (the ring's junction vertices
  // were confusing — that lesson is a rule here, not a preference)
  const lineUngrouped = !layout.plane && layout.shape.curve === "line" && grouping === "ungrouped";
  if (coins === "pill" && !bipartite && !lineUngrouped) return "invalid";
  if (tx === "vertex" && !bipartite) return "invalid";
  if (bipartite && (coins === "disk" || tx === "edgeset")) {
    // representable only as a mid-gesture pose (DETAIL/UNBUNDLE run in
    // place before leaving the plane); as a cell it is a hold at most
    return "transient";
  }
  if (layout.plane) return "stable";
  switch (layout.shape.curve) {
    case "circle":
      return arrange === "sequenced" ? "stable" : "transient";
    case "line":
      // the ungrouped line is the flatten waypoint / tutorial hold; a
      // pill-detail line is the pinned tutorial variant. The clustered
      // sequenced line is the band alias (canonicalCell normalizes it).
      return "transient";
    case "segments":
      // columns are cluster-level: the ns replay modal only
      return grouping === "clustered" && arrange === "sequenced" ? "transient" : "invalid";
  }
}

export function sameLayout(a: EngineLayout, b: EngineLayout): boolean {
  if (a.plane || b.plane) return a.plane === b.plane;
  if (a.shape.curve !== b.shape.curve) return false;
  return a.shape.curve !== "segments"
    || a.shape.k === (b.shape as { curve: "segments"; k: number }).k;
}

/** structural equality over canonical cells */
export function sameCell(a: EngineViewState, b: EngineViewState): boolean {
  const x = canonicalCell(a), y = canonicalCell(b);
  if (x.view === "cards" || y.view === "cards") return x.view === y.view;
  return sameLayout(x.layout, y.layout)
    && x.arrange === y.arrange && x.grouping === y.grouping
    && x.coins === y.coins && x.tx === y.tx;
}

/** the 7 exposed destinations (cards + 3 presets × 2 groupings) */
export function stableDestinations(): EngineViewState[] {
  const out: EngineViewState[] = [CARDS];
  for (const p of ["layered", "force", "chord"] as const) {
    for (const g of ["ungrouped", "clustered"] as const) out.push(presetCell(p, g));
  }
  return out;
}
