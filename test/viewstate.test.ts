import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type ViewState, DEFAULT_VIEW_STATE, canonical, knobs,
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
  assert.deepEqual(knobs(chordy), { view: "graph", layout: "chord", grouping: "clustered" });
  const forcey = withLayout(DEFAULT_VIEW_STATE, "force");
  assert.deepEqual(knobs(forcey), { view: "graph", layout: "force", grouping: "clustered" });
  assert.deepEqual(knobs(DEFAULT_VIEW_STATE), { view: "cards", layout: "ltr", grouping: "clustered" });
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

test("chord round trip: enter chord from anywhere, expand back to the graph", () => {
  for (const vs of legal.filter((s) => !s.chord)) {
    const inChord = withLayout(vs, "chord");
    const back = withLayout(inChord, inChord.arrange);
    assert.equal(back.view, "graph"); // expanding lands in the graph, even from cards
    assert.equal(back.arrange, vs.arrange);
    assert.equal(back.chord, false);
  }
});

test("legacy bridge: toLegacy∘fromLegacy is identity on canonical states", () => {
  for (const vs of legal) {
    assert.deepEqual(fromLegacy(toLegacy(vs)), vs);
  }
  // legacy chord-over-cards folds into graph+chord
  const folded = fromLegacy({ targetView: 0, collapsed: true, forceLayout: false, unclustered: false });
  assert.deepEqual(folded, { view: "graph", arrange: "ltr", chord: true, grouping: "clustered" });
});

test("fragment bridge: v/fd/uc round-trips every canonical state", () => {
  for (const vs of legal) {
    const f = fragmentView(vs);
    assert.deepEqual(viewFromFragment(f.v, f.fd, f.uc), vs);
  }
  // absent fields decode to the default state
  assert.deepEqual(viewFromFragment(undefined, undefined, undefined), DEFAULT_VIEW_STATE);
});

test("tutorial bridge: step view codes 0..3, arrangement carried over", () => {
  const base: ViewState = { view: "graph", arrange: "force", chord: true, grouping: "unclustered" };
  assert.deepEqual(viewFromStep(base, 0), { view: "cards", arrange: "force", chord: false, grouping: "clustered" });
  assert.deepEqual(viewFromStep(base, 1), { view: "graph", arrange: "force", chord: false, grouping: "clustered" });
  assert.deepEqual(viewFromStep(base, 2), { view: "graph", arrange: "force", chord: true, grouping: "clustered" });
  assert.deepEqual(viewFromStep(base, 3), { view: "graph", arrange: "force", chord: true, grouping: "unclustered" });
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
