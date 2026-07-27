// The control model of the display (#115): three user-facing knobs —
// view (cards | graph), layout (ltr | force | chord, graph only), and
// grouping (clustered | unclustered, contracted map only) — over one
// canonical state. main.ts keeps its tween scalars and setters; this
// module owns WHAT the knobs mean: which states are representable,
// how a knob gesture rewrites the state, and in what order the
// primitive transitions must run so every change animates as one
// continuous move (grouping settles before a contraction forms, an
// expansion completes before the view morphs away).
//
// "chord" is the contracted cluster map: the timeline wrapped around
// a circle, every partition class one disc. It is a graph layout, so
// choosing it implies view = graph — there is no chord-over-cards
// state, and expanding always lands back in the graph. The ltr/force
// choice is REMEMBERED while chord is active (`arrange`): it is what
// expanding restores, and it also orders the ring (time order for
// ltr, fewest crossings for force), so a fragment or a return trip
// reproduces the same picture.

/** cards = the block-explorer drawing; graph = the bipartite drawing */
export type View = "cards" | "graph";
/** the two arrangements of the uncontracted graph */
export type Arrange = "ltr" | "force";
/** the user-facing layout knob: the two arrangements plus the
 *  contracted cluster map */
export type GraphLayout = Arrange | "chord";
/** the partition shown by the contracted map: the active lens's
 *  clustering, or the lattice bottom (every coin a singleton) */
export type Grouping = "clustered" | "unclustered";

export interface ViewState {
  readonly view: View;
  /** which uncontracted arrangement is (or will be, on expand) shown;
   *  in chord it orders the ring: time (ltr) vs fewest crossings
   *  (force) */
  readonly arrange: Arrange;
  /** the contracted cluster map is showing (implies view = graph) */
  readonly chord: boolean;
  readonly grouping: Grouping;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  view: "cards", arrange: "ltr", chord: false, grouping: "clustered",
};

/** enforce the invariant: chord is a graph layout, so chord ⇒ graph */
export function canonical(vs: ViewState): ViewState {
  return vs.chord && vs.view !== "graph" ? { ...vs, view: "graph" } : vs;
}

/** the three-knob reading of the state, as the controls display it */
export function knobs(vs: ViewState): { view: View; layout: GraphLayout; grouping: Grouping } {
  return { view: vs.view, layout: vs.chord ? "chord" : vs.arrange, grouping: vs.grouping };
}

// --- knob gestures: pure rewrites, each returns a canonical state ---

/** the view knob; switching to cards leaves the contracted map (chord
 *  is a graph layout, cards has none) */
export function withView(vs: ViewState, view: View): ViewState {
  return canonical({ ...vs, view, chord: view === "graph" && vs.chord });
}

/** the layout knob; choosing any layout implies the graph view */
export function withLayout(vs: ViewState, layout: GraphLayout): ViewState {
  return layout === "chord"
    ? canonical({ ...vs, view: "graph", chord: true })
    : canonical({ ...vs, view: "graph", chord: false, arrange: layout });
}

export function withGrouping(vs: ViewState, grouping: Grouping): ViewState {
  return { ...vs, grouping };
}

// --- legacy bridge: the flag set main.ts stores between slices ---

export interface LegacyViewFlags {
  targetView: 0 | 1;
  collapsed: boolean;
  forceLayout: boolean;
  unclustered: boolean;
}

/** legacy allowed a contraction over the cards view; canonical() folds
 *  that into graph+chord, so expanding lands in the graph */
export function fromLegacy(f: LegacyViewFlags): ViewState {
  return canonical({
    view: f.targetView === 1 ? "graph" : "cards",
    arrange: f.forceLayout ? "force" : "ltr",
    chord: f.collapsed,
    grouping: f.unclustered ? "unclustered" : "clustered",
  });
}

export function toLegacy(vs: ViewState): LegacyViewFlags {
  return {
    targetView: vs.view === "graph" ? 1 : 0,
    collapsed: vs.chord,
    forceLayout: vs.arrange === "force",
    unclustered: vs.grouping === "unclustered",
  };
}

// --- fragment bridge: the shared-link encoding (v / fd / uc) ---

/** fragment `v`: 0 = cards, 1 = graph, 2 = the contracted map */
export function fragmentView(vs: ViewState): { v: 0 | 1 | 2; fd: 0 | 1; uc: 0 | 1 } {
  return {
    v: vs.chord ? 2 : vs.view === "graph" ? 1 : 0,
    fd: vs.arrange === "force" ? 1 : 0,
    uc: vs.grouping === "unclustered" ? 1 : 0,
  };
}

export function viewFromFragment(v: number | undefined, fd: number | undefined, uc: number | undefined): ViewState {
  return canonical({
    view: v === 1 || v === 2 ? "graph" : "cards",
    arrange: fd === 1 ? "force" : "ltr",
    chord: v === 2,
    grouping: uc === 1 ? "unclustered" : "clustered",
  });
}

// --- tutorial bridge: a step's view code (0..3) ---

/** 0 = cards, 1 = graph, 2 = contracted map, 3 = the same map held at
 *  the lattice bottom (the singleton ring). Steps never choose the
 *  arrangement, so it carries over. */
export function viewFromStep(vs: ViewState, code: 0 | 1 | 2 | 3): ViewState {
  return canonical({
    ...vs,
    view: code >= 1 ? "graph" : "cards",
    chord: code >= 2,
    grouping: code === 3 ? "unclustered" : "clustered",
  });
}

// --- the dispatch plan: primitive transitions, in animation order ---

/** one primitive transition main.ts knows how to animate */
export type ViewOp =
  | { op: "chord"; on: boolean }
  | { op: "view"; view: View }
  | { op: "arrange"; arrange: Arrange }
  | { op: "grouping"; grouping: Grouping };

/** the ordered primitive transitions that take `cur` to `next`:
 *  an expansion runs first (back into the graph before anything else
 *  moves), then the view morph, then the arrangement glide, then the
 *  grouping — settled BEFORE a contraction forms, so the collapse
 *  flies straight to its final ring instead of repartitioning midway —
 *  and the contraction itself last. */
export function dispatchPlan(cur: ViewState, next: ViewState): ViewOp[] {
  const ops: ViewOp[] = [];
  if (cur.chord && !next.chord) ops.push({ op: "chord", on: false });
  if (cur.view !== next.view) ops.push({ op: "view", view: next.view });
  if (cur.arrange !== next.arrange) ops.push({ op: "arrange", arrange: next.arrange });
  if (cur.grouping !== next.grouping) ops.push({ op: "grouping", grouping: next.grouping });
  if (!cur.chord && next.chord) ops.push({ op: "chord", on: true });
  return ops;
}
