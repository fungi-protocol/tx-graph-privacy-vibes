import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ViewState, DEFAULT_VIEW_STATE, canonical, knobs,
  contracted, contractedArrangement,
  withView, withLayout, withGrouping,
  fromLegacy, toLegacy, fragmentView, viewFromFragment,
  viewFromStep, dispatchPlan,
} from "../src/ui/viewstate";

const states: ViewState[] = [];
for (const view of ["cards", "graph"] as const)
  for (const arrange of ["ltr", "force"] as const)
    for (const chord of [false, true])
      for (const grouping of ["clustered", "unclustered"] as const)
        states.push({ view, arrange, chord, grouping });
const legal = states.map(canonical);

test("canonical: chord implies graph; canonical states are fixed points", () => {
  for (const vs of legal) {
    if (vs.chord) assert.equal(vs.view, "graph");
    assert.deepEqual(canonical(vs), vs);
  }
  assert.equal(
    canonical({ view: "cards", arrange: "ltr", chord: true, grouping: "clustered" }).view,
    "graph",
  );
});

test("knobs: chord shows as the layout, otherwise the arrangement", () => {
  const chordy = withLayout(DEFAULT_VIEW_STATE, "chord");
  assert.deepEqual(knobs(chordy), { view: "graph", layout: "chord", grouping: "unclustered" });
  const forcey = withLayout(DEFAULT_VIEW_STATE, "force");
  assert.deepEqual(knobs(forcey), { view: "graph", layout: "force", grouping: "unclustered" });
  assert.deepEqual(knobs(DEFAULT_VIEW_STATE), { view: "cards", layout: "ltr", grouping: "unclustered" });
});

test("knob gestures keep every state canonical and remember the arrangement", () => {
  for (const vs of legal) {
    for (const v of ["cards", "graph"] as const) {
      const next = withView(vs, v);
      assert.deepEqual(next, canonical(next));
      assert.equal(next.arrange, vs.arrange); // arrangement survives view flips
      if (v === "cards") assert.equal(next.chord, false); // no chord over cards
    }
    for (const l of ["ltr", "force", "chord"] as const) {
      const next = withLayout(vs, l);
      assert.deepEqual(next, canonical(next));
      assert.equal(next.view, "graph"); // choosing a layout implies the graph
      assert.equal(knobs(next).layout, l);
      if (l === "chord") assert.equal(next.arrange, vs.arrange); // remembered under the ring
    }
    for (const g of ["clustered", "unclustered"] as const) {
      assert.equal(withGrouping(vs, g).grouping, g);
    }
  }
});

test("grouping composes with any layout (#141 slice 4d): the gesture rewrites only the grouping", () => {
  // the checkbox contracts the current picture in place instead of
  // detouring through the chord ring
  for (const vs of legal) {
    for (const g of ["clustered", "unclustered"] as const) {
      const next = withGrouping(vs, g);
      assert.deepEqual(next, { ...vs, grouping: g }, JSON.stringify(vs));
    }
  }
  // checking under ltr lands the band, under force the force map
  const ltr: ViewState = { view: "graph", arrange: "ltr", chord: false, grouping: "unclustered" };
  assert.equal(contractedArrangement(withGrouping(ltr, "clustered")), "band");
  const force: ViewState = { ...ltr, arrange: "force" };
  assert.equal(contractedArrangement(withGrouping(force, "clustered")), "map");
  // unchecking under chord stays on the ring — the singleton ring, not
  // an expansion
  const ring: ViewState = { view: "graph", arrange: "ltr", chord: true, grouping: "clustered" };
  const singleton = withGrouping(ring, "unclustered");
  assert.equal(singleton.chord, true);
  assert.equal(contractedArrangement(singleton), "ring");
  assert.equal(contracted(singleton), true);
});

test("chord round trip: enter chord from anywhere, expand back to the graph", () => {
  for (const vs of legal.filter((s) => !s.chord)) {
    const inChord = withLayout(vs, "chord");
    const back = withLayout(inChord, inChord.arrange);
    assert.equal(back.view, "graph"); // expanding lands in the graph, even from cards
    assert.equal(back.arrange, vs.arrange);
    assert.equal(back.chord, false);
  }
});

test("legacy bridge: identity where legacy can represent the state, documented folds elsewhere", () => {
  for (const vs of legal) {
    const back = fromLegacy(toLegacy(vs));
    if (vs.view !== "graph" || vs.chord || vs.grouping === "unclustered") {
      // states the legacy flags can express — except a hidden grouping
      // preference outside the contracted map, which legacy never kept
      const expect = contracted(vs) || vs.grouping === "unclustered"
        ? vs : { ...vs, grouping: "unclustered" };
      assert.deepEqual(back, expect, JSON.stringify(vs));
    } else {
      // clustered band/map: legacy can only say "the contracted map
      // shows" — it comes back as the chord ring of the same partition
      assert.deepEqual(back, { ...vs, chord: true }, JSON.stringify(vs));
    }
  }
  // legacy chord-over-cards folds into graph+chord
  const folded = fromLegacy({ targetView: 0, collapsed: true, forceLayout: false, unclustered: false });
  assert.deepEqual(folded, { view: "graph", arrange: "ltr", chord: true, grouping: "clustered" });
  // a legacy uncollapsed graph is the plain coin graph even when the
  // remembered unclustered flag was off
  const plain = fromLegacy({ targetView: 1, collapsed: false, forceLayout: false, unclustered: false });
  assert.equal(plain.grouping, "unclustered");
  assert.equal(contracted(plain), false);
});

test("fragment bridge: v/fd/uc reproduces the rendered picture for every canonical state", () => {
  for (const vs of legal) {
    const f = fragmentView(vs);
    const back = viewFromFragment(f.v, f.fd, f.uc);
    // the encoding is the picture: re-encoding the decode is a fixed
    // point, and everything visible survives the round trip
    assert.deepEqual(fragmentView(back), f, JSON.stringify(vs));
    assert.equal(back.view, vs.view);
    assert.equal(back.arrange, vs.arrange);
    assert.equal(contracted(back), contracted(vs));
    assert.equal(contractedArrangement(back), contractedArrangement(vs));
    if (vs.view === "graph") assert.deepEqual(back, vs);
  }
  // the four v values name the four pictures
  assert.equal(fragmentView({ view: "graph", arrange: "ltr", chord: false, grouping: "clustered" }).v, 3);
  assert.equal(fragmentView({ view: "graph", arrange: "ltr", chord: true, grouping: "clustered" }).v, 2);
  assert.equal(fragmentView({ view: "graph", arrange: "ltr", chord: false, grouping: "unclustered" }).v, 1);
  // absent fields decode to the default state
  assert.deepEqual(viewFromFragment(undefined, undefined, undefined), DEFAULT_VIEW_STATE);
});

test("tutorial bridge: a step's view state is a pure function of its code (#130)", () => {
  // a step dispatch lands in the same picture whatever the user
  // toggled before it — the arrangement resets to the default, so a
  // shared step fragment reproduces one canonical view
  assert.deepEqual(viewFromStep(0), { view: "cards", arrange: "ltr", chord: false, grouping: "unclustered" });
  assert.deepEqual(viewFromStep(1), { view: "graph", arrange: "ltr", chord: false, grouping: "unclustered" });
  assert.deepEqual(viewFromStep(2), { view: "graph", arrange: "ltr", chord: true, grouping: "clustered" });
  assert.deepEqual(viewFromStep(3), { view: "graph", arrange: "ltr", chord: true, grouping: "unclustered" });
});

test("dispatchPlan: replaying the ops reproduces the target state", () => {
  const apply = (vs: ViewState, ops: ReturnType<typeof dispatchPlan>): ViewState => {
    let s = vs;
    for (const o of ops) {
      if (o.op === "chord") s = { ...s, chord: o.on };
      else if (o.op === "view") s = { ...s, view: o.view };
      else if (o.op === "arrange") s = { ...s, arrange: o.arrange };
      else s = { ...s, grouping: o.grouping };
    }
    return s;
  };
  for (const a of legal) for (const b of legal) {
    assert.deepEqual(apply(a, dispatchPlan(a, b)), b, `plan ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    if (a === b) assert.equal(dispatchPlan(a, b).length, 0);
  }
});

test("dispatchPlan ordering: expand first, contract last, grouping settles before a contraction", () => {
  for (const a of legal) for (const b of legal) {
    const ops = dispatchPlan(a, b);
    const idx = (op: string): number => ops.findIndex((o) => o.op === op);
    const chordOp = ops.find((o) => o.op === "chord") as { op: "chord"; on: boolean } | undefined;
    if (chordOp && !chordOp.on) assert.equal(ops[0], chordOp); // expansion runs first
    if (chordOp && chordOp.on) assert.equal(ops[ops.length - 1], chordOp); // contraction runs last
    if (idx("grouping") >= 0 && chordOp?.on) {
      assert.ok(idx("grouping") < idx("chord")); // ring is final before the collapse flies to it
    }
    assert.ok(ops.length <= 4);
  }
});

test("contracted/contractedArrangement: the four pictures of the graph view", () => {
  const g = (chord: boolean, grouping: "clustered" | "unclustered", arrange: "ltr" | "force" = "ltr"): ViewState =>
    ({ view: "graph", arrange, chord, grouping });
  assert.equal(contractedArrangement(g(true, "clustered")), "ring");
  assert.equal(contractedArrangement(g(true, "unclustered")), "ring"); // singleton ring
  assert.equal(contractedArrangement(g(false, "clustered", "ltr")), "band");
  assert.equal(contractedArrangement(g(false, "clustered", "force")), "map");
  assert.equal(contractedArrangement(g(false, "unclustered")), null); // the plain coin graph
  assert.equal(contracted({ ...g(true, "clustered"), view: "cards", chord: false }), false);
  assert.equal(contractedArrangement(DEFAULT_VIEW_STATE), null);
});
