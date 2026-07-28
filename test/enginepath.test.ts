import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type EngineViewState, type GraphCell,
  CARDS, BRIDGE, PLANE, LINE, CIRCLE, segments,
  graphCell, presetCell, canonicalCell, sameCell, cellClass,
  stableDestinations, derivedCoins, derivedTx,
} from "../src/engine/state";
import { pathBetween } from "../src/engine/path";
import { INVERSE, type Leg } from "../src/engine/legs";

const band = graphCell(PLANE, "sequenced", "clustered");
const bipartite = BRIDGE;
const chordC = presetCell("chord", "clustered");
const chordU = presetCell("chord", "ungrouped");
const forceU = presetCell("force", "ungrouped");
const forceC = presetCell("force", "clustered");
const lineU = graphCell(LINE, "sequenced", "ungrouped");

function kinds(legs: Leg[]): string[] {
  return legs.map((l) => l.kind);
}

test("capability table: the seven destinations are stable, aliases normalize", () => {
  const dests = stableDestinations();
  assert.equal(dests.length, 7);
  for (const d of dests) assert.equal(cellClass(d), "stable", JSON.stringify(d));
  // the band alias: curve(line)·seq·clustered names the same picture
  const alias = graphCell(LINE, "sequenced", "clustered");
  assert.ok(sameCell(alias, band));
  assert.deepEqual(canonicalCell(alias), band);
  // ungrouped line is NOT an alias — it is the flatten waypoint
  assert.equal(cellClass(lineU), "transient");
  assert.ok(!sameCell(lineU, bipartite));
  // pills off the bipartite cells are invalid; resting tx vertices on
  // the curve are invalid; ungrouped columns are invalid
  assert.equal(cellClass({ ...chordU, coins: "pill" }), "invalid");
  assert.equal(cellClass({ ...chordU, tx: "vertex" }), "invalid");
  assert.equal(cellClass(graphCell(segments(4), "sequenced", "ungrouped")), "invalid");
  assert.equal(cellClass(graphCell(segments(4), "sequenced", "clustered")), "transient");
});

test("pathBetween identity: same cell (band→band via the alias) is the empty path", () => {
  assert.deepEqual(pathBetween(band, band), []);
  assert.deepEqual(pathBetween(band, graphCell(LINE, "sequenced", "clustered")), []);
  assert.deepEqual(pathBetween(CARDS, CARDS), []);
  assert.deepEqual(pathBetween(chordC, chordC), []);
});

test("the canonical composed gesture: cards → clusters-on-circle and its exact reverse", () => {
  const entry = pathBetween(CARDS, chordC);
  assert.deepEqual(kinds(entry),
    ["MORPH", "DETAIL", "UNBUNDLE", "FLATTEN", "CURL", "STACK"]);
  // grouping arrives LAST; the stack happens on the ring
  const stack = entry[entry.length - 1]!;
  assert.ok(!((stack.from as GraphCell).layout).plane);
  const exit = pathBetween(chordC, CARDS);
  assert.deepEqual(kinds(exit),
    ["UNSTACK", "UNCURL", "UNFLATTEN", "PINCH", "DETAIL", "MORPH"]);
  // reversal symmetry: the exit is the entry's inverse kinds, reversed
  assert.deepEqual(kinds(exit), kinds(entry).reverse().map((k) => INVERSE[k as keyof typeof INVERSE]));
});

test("chord is always entered by CURL, preceded by FLATTEN except from the band", () => {
  for (const src of [bipartite, forceU, forceC] as GraphCell[]) {
    const p = kinds(pathBetween(src, src.grouping === "clustered" ? chordC : chordU));
    const curlAt = p.indexOf("CURL");
    assert.ok(curlAt >= 1, `${JSON.stringify(src)} → chord runs CURL`);
    assert.equal(p[curlAt - 1], "FLATTEN");
  }
  // the band already lies on the line: CURL alone
  assert.deepEqual(kinds(pathBetween(band, chordC)), ["CURL"]);
  assert.deepEqual(kinds(pathBetween(chordC, band)), ["UNCURL"]);
});

test("grouping toggle: single leg on the curve; detail legs compose in the plane", () => {
  assert.deepEqual(kinds(pathBetween(chordU, chordC)), ["STACK"]);
  assert.deepEqual(kinds(pathBetween(chordC, chordU)), ["UNSTACK"]);
  // the plane flips the derived axes too: in place first, then stack
  assert.deepEqual(kinds(pathBetween(bipartite, band)), ["DETAIL", "UNBUNDLE", "STACK"]);
  assert.deepEqual(kinds(pathBetween(band, bipartite)), ["UNSTACK", "PINCH", "DETAIL"]);
  assert.deepEqual(kinds(pathBetween(forceU, forceC)), ["DETAIL", "UNBUNDLE", "STACK"]);
});

test("view toggle bridges through BRIDGE only, other graph states normalize first", () => {
  const fromForce = pathBetween(forceU, CARDS);
  assert.deepEqual(kinds(fromForce), ["REARRANGE", "MORPH"]);
  assert.ok(sameCell(fromForce[0]!.to, BRIDGE));
  const toForce = pathBetween(CARDS, forceU);
  assert.deepEqual(kinds(toForce), ["MORPH", "REARRANGE"]);
  assert.ok(sameCell(toForce[0]!.to, BRIDGE));
  // leaving cards continues to the stored destination in one plan
  const toBand = pathBetween(CARDS, band);
  assert.deepEqual(kinds(toBand), ["MORPH", "DETAIL", "UNBUNDLE", "STACK"]);
});

test("totality: every stable/transient source reaches every destination through defined cells", () => {
  const sources: EngineViewState[] = [
    ...stableDestinations(),
    lineU,                                        // flatten waypoint / hold
    graphCell(LINE, "sequenced", "clustered"),    // band alias
    { ...lineU, coins: "pill" },                  // tutorial-pinned line pills
    { ...bipartite, coins: "disk", tx: "edgeset" }, // mid-gesture pose (hold)
    graphCell(segments(4), "sequenced", "clustered"), // modal geometry
    graphCell(CIRCLE, "force", "clustered"),      // internal curve+force
  ];
  const targets = stableDestinations();
  for (const s of sources) {
    for (const t of targets) {
      const legs = pathBetween(s, t);
      // chains connect: each leg starts where the previous ended
      for (let i = 1; i < legs.length; i++) {
        assert.ok(sameCell(legs[i]!.from, legs[i - 1]!.to),
          `chain break ${JSON.stringify(s)}→${JSON.stringify(t)} at ${i}`);
      }
      // every visited cell is defined (stable or transient), never invalid
      for (const l of legs) {
        assert.notEqual(cellClass(l.from), "invalid");
        assert.notEqual(cellClass(l.to), "invalid");
      }
      // the path ends at the canonical target
      const end = legs.length > 0 ? legs[legs.length - 1]!.to : s;
      assert.ok(sameCell(end, t),
        `${JSON.stringify(s)} → ${JSON.stringify(t)} ends at ${JSON.stringify(end)}`);
    }
  }
});

test("derived detail axes are zoom-free functions of layout×grouping", () => {
  assert.equal(derivedCoins(PLANE, "ungrouped"), "pill");
  assert.equal(derivedTx(PLANE, "ungrouped"), "vertex");
  for (const layout of [CIRCLE, LINE]) {
    assert.equal(derivedCoins(layout, "ungrouped"), "disk");
    assert.equal(derivedTx(layout, "ungrouped"), "edgeset");
  }
  assert.equal(derivedCoins(PLANE, "clustered"), "disk");
  assert.equal(derivedTx(PLANE, "clustered"), "edgeset");
});

test("invalid cells are rejected, not planned around", () => {
  assert.throws(() => pathBetween({ ...chordU, coins: "pill" }, CARDS));
  assert.throws(() => pathBetween(CARDS, graphCell(segments(3), "sequenced", "ungrouped")));
});
