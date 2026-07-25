import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleForDay, incomeFor, INCOME_EVERY } from "../src/engine/schedule";
import { Economy, DEFAULT_PARAMS } from "../src/engine/economy";
import { buildCast } from "../src/scenario/cast";

test("income covers each persona's expected deficit with headroom", () => {
  const town = buildCast("golden", 14);
  const income = incomeFor(DEFAULT_PARAMS, town.personas, town.edges);
  assert.equal(income.length, 14);
  for (const v of income) assert.ok(v >= 60, "everyone earns something from outside");
  // Grace (6) runs the town's steepest deficit: invoices out, small sales in
  assert.ok(income[6]! > income[0]!, "the bike shop out-earns the salaried");
});

test("paydays are staggered and rng-free, with stable inflow IDs", () => {
  const town = buildCast("golden", 10);
  const seen = new Set<number>();
  for (let day = 1; day <= INCOME_EVERY; day++) {
    const s = scheduleForDay("golden", DEFAULT_PARAMS, town.personas, town.edges, day);
    for (const inf of s.inflows) {
      assert.equal(inf.id, `${day}.i${inf.owner}`);
      assert.ok(!seen.has(inf.owner), `${inf.owner} paid twice in one period`);
      seen.add(inf.owner);
    }
  }
  assert.equal(seen.size, 10, "someone never got paid");
});

test("solvency: scheduled obligations stay fundable across the horizon", () => {
  // the carefully-scoped guarantee: at the defaults and modest sweeps,
  // over the tutorial horizon, no obligation ever slips its due date for
  // lack of funds — whatever the behavior dice do. No claim is made for
  // arbitrary parameters or deliberate starvation via manual play.
  for (const seed of ["welcome", "golden", "alpha", "silver"]) {
    for (const params of [{}, { wealth: 0.5 }, { oblRate: 0.15 }, { pop: 14 }]) {
      const eco = new Economy(seed, params);
      eco.runTo(150);
      assert.deepEqual(eco.underfunded, [],
        `${seed} ${JSON.stringify(params)}: ${eco.underfunded.length} due-day slips`);
    }
  }
});

test("manual play does not shift anyone's paydays or amounts", () => {
  const a = new Economy("golden");
  const b = new Economy("golden");
  b.manual = 9;
  b.manualFrom = 0;
  a.runTo(60);
  b.runTo(60);
  const roots = (eco: Economy): string[] =>
    [...eco.chain.coins.values()]
      .filter((c) => c.producer === null)
      .map((c) => `${c.id}:${c.owner}:${c.value}`)
      .sort();
  assert.deepEqual(roots(a), roots(b));
});
