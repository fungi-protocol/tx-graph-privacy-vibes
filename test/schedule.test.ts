import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleForDay, SETTLE_DAY, GAME_DAY } from "../src/engine/schedule";
import { Economy, DEFAULT_PARAMS, type EconomyParams } from "../src/engine/economy";
import { buildCast } from "../src/scenario/cast";

const town = buildCast("golden", 10);

test("the schedule is a pure function of seed, params, and day", () => {
  for (const day of [1, 17, SETTLE_DAY, GAME_DAY, 130]) {
    const a = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    const b = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    assert.deepEqual(a, b);
  }
  // a different seed is a different universe (somewhere in the horizon)
  const differs = Array.from({ length: 60 }, (_, d) => d + 1).some((day) => {
    const a = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    const b = scheduleForDay("silver", DEFAULT_PARAMS, town.personas, town.edges, day);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
  assert.ok(differs, "two seeds produced identical 60-day schedules");
});

test("schedule IDs are unique per day and match the stable format", () => {
  for (let day = 1; day <= 130; day++) {
    const s = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    const ids = [...s.obligations, ...s.purchases].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `day ${day}: duplicate ids`);
    for (const id of ids) {
      assert.match(id, /^\d+\.[esx]\d+(\.\d+)?$/, `day ${day}: ${id}`);
      assert.ok(id.startsWith(`${day}.`), `day ${day}: ${id} names another day`);
    }
  }
});

test("story beats appear on their days with fixed IDs", () => {
  const settle = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, SETTLE_DAY);
  assert.ok(settle.obligations.some((o) => o.id === `${SETTLE_DAY}.s0` && o.memo === "studio rent"));
  const game = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, GAME_DAY);
  assert.ok(game.obligations.some((o) => o.id === `${GAME_DAY}.s0` && o.memo === "studio rent"));
});

test("fee and wealth parameters never touch the schedule", () => {
  for (const day of [3, 40, 91]) {
    const a = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    const noisy: EconomyParams = { ...DEFAULT_PARAMS, feeLevel: 3, feeVol: 2.5, wealth: 0.25 };
    const b = scheduleForDay("golden", noisy, town.personas, town.edges, day);
    assert.deepEqual(a, b);
  }
});

/** every scheduled obligation an economy ever saw: settled (events),
 *  still pending, or rolled into a re-invoice — purchases excluded, since
 *  an unfundable purchase simply doesn't happen */
function obligationUniverse(eco: Economy): string[] {
  const ids = new Set<string>([
    ...eco.events.flatMap((e) => e.oblIds ?? []),
    ...eco.pending.map((o) => o.id),
    ...eco.cancelled,
  ]);
  return [...ids].filter((id) => !id.includes(".x")).sort();
}

test("how people pay never changes what they owe", () => {
  // wealth and the fee market steer every behavior draw — coin selection,
  // form choices, session formation — but the obligation universe is fixed
  const a = new Economy("golden");
  const b = new Economy("golden", { wealth: 0.5, feeLevel: 2, feeVol: 2 });
  a.runTo(130);
  b.runTo(130);
  assert.deepEqual(obligationUniverse(a), obligationUniverse(b));
  assert.ok(obligationUniverse(a).length > 50, "suspiciously small universe");
  // and the markets drift identically at equal parameters, whatever
  // behavior consumed: manual play perturbs behavior draws only
  const c = new Economy("golden");
  c.manual = 9;
  c.manualFrom = 0;
  c.runTo(130);
  assert.deepEqual(c.prices, a.prices);
  assert.deepEqual(obligationUniverse(c), obligationUniverse(a));
});

test("economy obligations all come from the schedule", () => {
  const eco = new Economy("golden");
  eco.runTo(70);
  for (const o of eco.pending) {
    const day = Number(o.id.split(".")[0]);
    const s = scheduleForDay("golden", DEFAULT_PARAMS, eco.cast, town.edges, day);
    const match = s.obligations.find((x) => x.id === o.id);
    assert.ok(match, `${o.id} not in its day's schedule`);
    assert.equal(match!.memo, o.memo);
    assert.equal(match!.usd, o.usd);
  }
});
