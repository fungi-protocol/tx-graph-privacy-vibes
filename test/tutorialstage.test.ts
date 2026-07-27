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
  step({ id: "first-observer", view: 1, lens: 1 }),
  step({ id: "singleton-ring", view: 3, lens: 1 }),
  step({ id: "clustered-ring", view: 2, lens: 1 }),
  step({ id: "back-to-cards", view: 0 }),
];

test("staged controls: each appears with the step that introduces it", () => {
  assert.deepEqual([...widgetRevealsAt(steps, 0)], []);
  assert.deepEqual([...widgetRevealsAt(steps, 1)], []);
  assert.deepEqual([...widgetRevealsAt(steps, 2)].sort(), ["layout", "view"]);
  assert.deepEqual([...widgetRevealsAt(steps, 3)].sort(), ["layout", "lens", "view"]);
  assert.deepEqual([...widgetRevealsAt(steps, 4)].sort(),
    ["cluster", "layout", "lens", "uncluster", "view"]);
});

test("staged controls: a prefix property — jumps land on the walked path, later steps never hide", () => {
  for (let i = 0; i + 1 < steps.length; i++) {
    const now = widgetRevealsAt(steps, i);
    const next = widgetRevealsAt(steps, i + 1);
    for (const w of now) assert.ok(next.has(w), `${w} vanished at ${i + 1}`);
  }
  // a chapter returning to the cards keeps everything introduced
  assert.equal(widgetRevealsAt(steps, steps.length - 1).size, 5);
  // out-of-range indexes clamp instead of throwing
  assert.equal(widgetRevealsAt(steps, 999).size, 5);
  assert.equal(widgetRevealsAt(steps, -1).size, 0);
  assert.equal(widgetRevealsAt([], 3).size, 0);
});
