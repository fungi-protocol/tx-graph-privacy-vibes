// The #115-viewstate <-> engine-cell adapter (#141 slice 3): every
// knob-reachable ViewState names a stable cell and translates back
// losslessly (modulo the arrange memo it explicitly externalizes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellOf, viewStateOf, ringMode } from "../src/engine/adapter";
import {
  CARDS, BRIDGE, PLANE, LINE, CIRCLE, segments, graphCell, presetCell,
  sameCell, cellClass,
} from "../src/engine/state";
import {
  type ViewState, canonical, withGrouping, withLayout, DEFAULT_VIEW_STATE,
  fragmentView, viewFromFragment,
} from "../src/ui/viewstate";

test("cellOf: the knob-reachable states map onto the stable cells", () => {
  const cases: [ViewState, ReturnType<typeof cellOf>][] = [
    [{ view: "cards", arrange: "ltr", chord: false, grouping: "unclustered" }, CARDS],
    [{ view: "graph", arrange: "ltr", chord: false, grouping: "unclustered" }, BRIDGE],
    [{ view: "graph", arrange: "force", chord: false, grouping: "unclustered" }, presetCell("force", "ungrouped")],
    [{ view: "graph", arrange: "ltr", chord: true, grouping: "clustered" }, presetCell("chord", "clustered")],
    [{ view: "graph", arrange: "ltr", chord: true, grouping: "unclustered" }, presetCell("chord", "ungrouped")],
    [{ view: "graph", arrange: "ltr", chord: false, grouping: "clustered" }, presetCell("layered", "clustered")],
    [{ view: "graph", arrange: "force", chord: false, grouping: "clustered" }, presetCell("force", "clustered")],
  ];
  for (const [vs, want] of cases) {
    const got = cellOf(vs);
    assert.ok(sameCell(got, want), `${JSON.stringify(vs)} -> ${JSON.stringify(got)}`);
    assert.equal(cellClass(got), "stable");
  }
  // the ring ordering is NOT an engine axis: chord+force names the
  // same sequenced circle, the ordering rides the registry mode
  const chordForce: ViewState = { view: "graph", arrange: "force", chord: true, grouping: "clustered" };
  assert.ok(sameCell(cellOf(chordForce), presetCell("chord", "clustered")));
});

test("viewStateOf: cells translate back, the arrange memo fills what the cell leaves open", () => {
  for (const arrange of ["ltr", "force"] as const) {
    // stable round trip: cellOf(viewStateOf(cell)) is the same cell
    for (const cell of [CARDS, BRIDGE, presetCell("force", "clustered"),
      presetCell("chord", "ungrouped"), presetCell("layered", "clustered")]) {
      const vs = viewStateOf(cell, arrange);
      assert.ok(sameCell(cellOf(vs), cell),
        `${JSON.stringify(cell)} via ${JSON.stringify(vs)}`);
    }
    // under chord and cards the memo carries the knob
    assert.equal(viewStateOf(CARDS, arrange).arrange, arrange);
    assert.equal(viewStateOf(presetCell("chord", "clustered"), arrange).arrange, arrange);
  }
  // plane cells determine their own arrange, memo ignored
  assert.equal(viewStateOf(presetCell("force", "clustered"), "ltr").arrange, "force");
  assert.equal(viewStateOf(BRIDGE, "force").arrange, "ltr");
  // transient cells read as their nearest stable picture
  const lineU = viewStateOf(graphCell(LINE, "sequenced", "ungrouped"), "ltr");
  assert.deepEqual(lineU, canonical({ view: "graph", arrange: "ltr", chord: true, grouping: "unclustered" }));
  const cols = viewStateOf(graphCell(segments(3), "sequenced", "clustered"), "ltr");
  assert.equal(cols.chord, true);
  assert.equal(cols.grouping, "clustered");
  // the band alias normalizes to the plane before translating
  const band = viewStateOf(graphCell(LINE, "sequenced", "clustered"), "force");
  assert.deepEqual(band, canonical({ view: "graph", arrange: "ltr", chord: false, grouping: "clustered" }));
});

test("ringMode: curve cells take the memo, plane cells their own axis", () => {
  assert.equal(ringMode(presetCell("chord", "clustered"), "force"), "force");
  assert.equal(ringMode(presetCell("chord", "ungrouped"), "ltr"), "time");
  assert.equal(ringMode(BRIDGE, "force"), "time");
  assert.equal(ringMode(presetCell("force", "clustered"), "ltr"), "force");
});

test("the fragment names the canonical cell (#141 slice 4c): v/fd/uc round-trips every reachable stable cell", () => {
  // slice 4c resolution: no schema bump is needed — the v5 wire triple
  // already determines the canonical cell uniquely. The one ViewState
  // the triple cannot carry (a clusters grouping remembered under the
  // cards view) is not a READ state either: viewStateOf(CARDS) always
  // reports unclustered (#140 collapsed cards-clustered deliberately),
  // so what the app can show, the fragment can say.
  const stable = [
    CARDS, BRIDGE,
    presetCell("force", "ungrouped"),
    presetCell("layered", "clustered"), presetCell("force", "clustered"),
    presetCell("chord", "ungrouped"), presetCell("chord", "clustered"),
  ];
  for (const memo of ["ltr", "force"] as const) {
    for (const cell of stable) {
      const vs = viewStateOf(cell, memo);
      const f = fragmentView(vs);
      const back = viewFromFragment(f.v, f.fd, f.uc);
      // the decoded ViewState IS the encoded one: nothing readable is lost
      assert.deepEqual(back, vs, `${JSON.stringify(cell)} memo=${memo}`);
      // and it names the same cell — the fragment encodes the cell
      assert.ok(sameCell(cellOf(back), cell), `${JSON.stringify(cell)} memo=${memo}`);
      // the memo itself survives through fd wherever the cell leaves it open
      assert.equal(back.arrange, vs.arrange);
    }
  }
});

test("knob gestures compose with the adapter: every #115 rewrite lands on a stable cell", () => {
  let vs = DEFAULT_VIEW_STATE;
  const walk = [
    (s: ViewState) => withLayout(s, "chord"),
    (s: ViewState) => withGrouping(s, "clustered"),
    (s: ViewState) => withLayout(s, "force"),
    (s: ViewState) => withGrouping(s, "unclustered"),
    (s: ViewState) => withLayout(s, "ltr"),
  ];
  for (const step of walk) {
    vs = step(vs);
    assert.equal(cellClass(cellOf(vs)), "stable", JSON.stringify(vs));
  }
});
