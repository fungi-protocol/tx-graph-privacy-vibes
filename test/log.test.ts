// #126: the event log is the simulation's primary state; the chain is a
// derived index and rewinding time is a prefix slice of the log.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { eventDay } from "../src/engine/log";

test("rewind equals replay: a log prefix reproduces the world (#126)", () => {
  const eco = new Economy("log-invariant");
  eco.runTo(30);

  // the log and its derived indexes stay in step
  assert.equal(eco.log.events.filter((e) => e.k === "tx").length, eco.chain.order.length);
  assert.equal(eco.log.notes.length, eco.events.length);

  // days never decrease along the log — the prefix rule depends on it
  let last = -Infinity;
  for (const e of eco.log.events) {
    const d = eventDay(e);
    assert.ok(d >= last, `log not day-monotonic: ${d} after ${last}`);
    last = d;
  }

  // a full-length replay rebuilds the live index exactly, truth included
  const whole = eco.log.replay();
  eco.decorate(whole);
  assert.equal(whole.describe(), eco.chain.describe());
  assert.equal(whole.describeTruth(), eco.chain.describeTruth());

  // a prefix replay, decorated by the same pure walks, reproduces the
  // time cursor's PUBLIC record at every cut. (The truth side is not
  // compared at prefixes: the cursor view shares coin objects with the
  // full history, so exchange routing driven by later flows — a deposit
  // marking coins it spent — stays visible when rewound, by design.)
  for (const day of [0, 7, 19, 30]) {
    const replayed = eco.log.replay(eco.log.prefixThrough(day));
    eco.decorate(replayed);
    assert.equal(replayed.describe(), eco.chain.through(day).describe(),
      `day ${day}: replayed prefix must match the cursor view`);
  }
});
