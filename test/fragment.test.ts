import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFragment, decodeFragment } from "../src/ui/fragment";

test("fragment round-trip", async () => {
  const fragment = await encodeFragment({ seed: "the naked economy" });
  const state = await decodeFragment(`#${fragment}`);
  assert.deepEqual(state, { seed: "the naked economy" });
});

test("fragment round-trip with unicode seed", async () => {
  const fragment = await encodeFragment({ seed: "コイン☂ジョイン" });
  const state = await decodeFragment(fragment);
  assert.deepEqual(state, { seed: "コイン☂ジョイン" });
});

test("missing fragment decodes to null", async () => {
  assert.equal(await decodeFragment(""), null);
  assert.equal(await decodeFragment("#other=1"), null);
});

test("fragment is url-safe", async () => {
  const fragment = await encodeFragment({ seed: "x".repeat(500) });
  assert.match(fragment, /^s=[A-Za-z0-9_-]+$/);
});
