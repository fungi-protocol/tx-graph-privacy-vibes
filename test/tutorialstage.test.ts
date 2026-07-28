import { test } from "node:test";
import assert from "node:assert/strict";
import { widgetRevealsAt, type TutorialStep } from "../src/ui/tutorial";

const step = (over: Partial<TutorialStep>): TutorialStep => ({
  id: over.id ?? "step", title: "t", html: "<p>x</p>", ...over,
});

// a miniature tour with the same staging shape as the real one: cards
// first, then the graph, then the observer, then the contracted map
const steps: TutorialStep[] = [
  step({ id: "cards-a", view: 0 }),
  step({ id: "cards-b", view: 0 }),
  step({ id: "first-graph", view: 1 }),
  step({ id: "town", view: 1, stages: ["cast"] }),
  step({ id: "first-observer", view: 1, lens: 1 }),
  step({ id: "singleton-ring", view: 3, lens: 1 }),
  step({ id: "clustered-ring", view: 2, lens: 1 }),
  step({ id: "back-to-cards", view: 0 }),
  step({ id: "sandbox", view: 1, stages: ["params"] }),
];

test("staged controls: the full reveal schedule, one control per introducing step", () => {
  assert.deepEqual([...widgetRevealsAt(steps, 0)], []);
  assert.deepEqual([...widgetRevealsAt(steps, 1)], []);
  // the bipartite slide introduces the view knob and the layout knob
  // (layered|force) together — the chord position stays hidden
  assert.deepEqual([...widgetRevealsAt(steps, 2)].sort(), ["layout", "view"]);
  // the cast panel appears with the step that names it
  assert.deepEqual([...widgetRevealsAt(steps, 3)].sort(), ["cast", "layout", "view"]);
  assert.deepEqual([...widgetRevealsAt(steps, 4)].sort(), ["cast", "layout", "lens", "view"]);
  // the ring's introduction stages the chord position ONLY — the
  // grouping controls wait for the step that stacks the ring
  assert.deepEqual([...widgetRevealsAt(steps, 5)].sort(),
    ["cast", "chord", "layout", "lens", "view"]);
  assert.deepEqual([...widgetRevealsAt(steps, 6)].sort(),
    ["cast", "chord", "cluster", "layout", "lens", "uncluster", "view"]);
  // the params panel with the sandbox hand-over
  assert.ok(widgetRevealsAt(steps, 8).has("params"));
});

test("a tour that stacks without ever showing the bare ring still stages the chord", () => {
  const direct = [step({ id: "graph", view: 1 }), step({ id: "map", view: 2 })];
  assert.deepEqual([...widgetRevealsAt(direct, 1)].sort(),
    ["chord", "cluster", "layout", "uncluster", "view"]);
});

test("staged controls: a prefix property — jumps land on the walked path, later steps never hide", () => {
  for (let i = 0; i + 1 < steps.length; i++) {
    const now = widgetRevealsAt(steps, i);
    const next = widgetRevealsAt(steps, i + 1);
    for (const w of now) assert.ok(next.has(w), `${w} vanished at ${i + 1}`);
  }
  // a chapter returning to the cards keeps everything introduced
  assert.equal(widgetRevealsAt(steps, steps.length - 1).size, 8);
  // out-of-range indexes clamp instead of throwing
  assert.equal(widgetRevealsAt(steps, 999).size, 8);
  assert.equal(widgetRevealsAt(steps, -1).size, 0);
  assert.equal(widgetRevealsAt([], 3).size, 0);
});
