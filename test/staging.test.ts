import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, COINJOIN_DAY, SETTLE_DAY } from "../src/engine/economy";
import { PERSONAS } from "../src/scenario/cast";

const owners = (eco: Economy): Set<number> => {
  const s = new Set<number>();
  for (const c of eco.chain.coins.values()) {
    if (c.owner !== null) s.add(c.owner);
  }
  return s;
};

test("the town grows as the story needs it: nobody acts before they arrive", () => {
  const eco = new Economy("welcome");
  eco.runTo(35);

  // before day 36 only the first community exists on chain
  const present = owners(eco);
  for (const u of [4, 5, 6, 7, 8, 9]) assert.ok(!present.has(u), `u${u} on chain by day 35`);
  assert.ok([0, 1, 2, 3].every((u) => present.has(u)));
  for (const e of eco.events) {
    assert.ok(e.payer <= 3, `event by ${e.payer} before arrival`);
    assert.ok(e.payee === null || e.payee <= 3, `event to ${e.payee} before arrival`);
  }

  // the studio trio moves in on day 36: savings plus the income they earned
  // before the move, all stamped with the day
  eco.runTo(36);
  const heidiSavings = [...eco.chain.coins.values()].filter((c) => c.owner === 7);
  assert.ok(heidiSavings.length > PERSONAS[7]!.roots.length, "arrival stake missing");
  assert.ok(heidiSavings.every((c) => c.entered === 36 && c.producer === null));

  // in time for rent day, and the bike-shop crowd in time for the first
  // cross-community coinjoin
  eco.runTo(COINJOIN_DAY + 3);
  const late = owners(eco);
  for (const u of [4, 5, 6]) assert.ok(late.has(u), `u${u} missing after arrival`);
  assert.ok(eco.events.some((e) => e.form === "settlement" && e.day >= SETTLE_DAY));
  assert.ok(eco.events.some((e) => e.form === "coinjoin"), "no coinjoin after COINJOIN_DAY");
});

test("staged arrivals replay deterministically", () => {
  const a = new Economy("welcome");
  a.runTo(80);
  const b = new Economy("welcome");
  b.runTo(80);
  assert.equal(a.chain.describe(), b.chain.describe());
});
