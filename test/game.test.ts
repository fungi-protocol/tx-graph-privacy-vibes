import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, GAME_DAY, type Intervention } from "../src/engine/economy";
import { encodeFragment, decodeFragment, type FragmentState } from "../src/ui/fragment";

function judyPlays(seed: string, interventions: Intervention[] = []): Economy {
  const eco = new Economy(seed);
  eco.manual = 9;
  eco.manualFrom = GAME_DAY - 1;
  eco.interventions = interventions;
  return eco;
}

test("a waiting player's rent settles through the GAME_DAY cycle", () => {
  for (const seed of ["golden", "welcome", "gamma", "alpha"]) {
    const eco = judyPlays(seed);
    eco.runTo(GAME_DAY + 3);
    const ev = eco.events.find((e) =>
      e.form === "settlement" && e.payer === 9 && e.memo === "studio rent" && e.day >= GAME_DAY);
    assert.ok(ev, `${seed}: the played rent never settled`);
  }
});

// the GAME_DAY rent is a story beat with a stable schedule ID
const RENT_ID = `${GAME_DAY}.s0`;

test("an intervention overrides the default: rent paid at once, no cycle for it", () => {
  const eco = judyPlays("golden", [
    { day: GAME_DAY + 1, id: RENT_ID, plan: "unilateral" },
  ]);
  eco.runTo(GAME_DAY + 1);
  const ev = eco.events.find((e) =>
    e.payer === 9 && e.memo === "studio rent" && e.day === GAME_DAY + 1);
  assert.ok(ev, "the chosen plan was not executed");
  assert.equal(ev!.form, "unilateral");
});

test("same seed + same interventions replay to the same chain", () => {
  const ivs: Intervention[] = [
    { day: GAME_DAY + 1, id: RENT_ID, plan: "unilateral" },
  ];
  const a = judyPlays("golden", ivs.map((i) => ({ ...i })));
  const b = judyPlays("golden", ivs.map((i) => ({ ...i })));
  a.runTo(GAME_DAY + 8);
  b.runTo(GAME_DAY + 8);
  assert.equal(a.chain.describe(), b.chain.describe());
  const c = judyPlays("golden");
  c.runTo(GAME_DAY + 8);
  assert.notEqual(a.chain.describe(), c.chain.describe(), "the intervention changed nothing");
});

test("peeking at the decision menu never perturbs the run", () => {
  const a = judyPlays("golden");
  a.runTo(GAME_DAY);
  for (let k = 0; k < 3; k++) a.candidates(9);
  a.runTo(GAME_DAY + 6);
  const b = judyPlays("golden");
  b.runTo(GAME_DAY + 6);
  assert.equal(a.chain.describe(), b.chain.describe());
});

test("the played agent takes over only from manualFrom", () => {
  // before the takeover day the dice run Judy exactly as they always did
  const a = judyPlays("golden");
  a.runTo(GAME_DAY - 2);
  const b = new Economy("golden");
  b.runTo(GAME_DAY - 2);
  assert.equal(a.chain.describe(), b.chain.describe());
});

test("parameters change the world: no rates, no transactions", () => {
  const eco = new Economy("golden", { oblRate: 0, extRate: 0 });
  eco.runTo(59); // the settlement-day injection is the first scripted moment
  assert.equal(eco.chain.order.length, 0);
});

test("wealth scales everyone's starting coins", () => {
  const base = new Economy("golden");
  const rich = new Economy("golden", { wealth: 2 });
  const r1 = base.chain.coins.get("r1")!;
  assert.equal(rich.chain.coins.get("r1")!.value, r1.value * 2);
});

test("consolidation spends carry the warning flag", () => {
  // small starting coins force multi-coin spends before the first payday;
  // probed across seeds — richer defaults may go long stretches without one
  const eco = new Economy("golden", { wealth: 0.25 });
  eco.runTo(40);
  const flagged = eco.events.filter((e) => e.why.includes("⚠"));
  assert.ok(flagged.length > 0, "no consolidation was ever flagged");
  for (const e of flagged.filter((f) => f.form === "unilateral")) {
    const tx = eco.chain.txs.get(e.tid)!;
    const producers = new Set(tx.inputs.map((c) => eco.chain.coins.get(c)!.producer));
    assert.ok(tx.inputs.length >= 2 && producers.size > 1,
      `${e.tid} flagged but spends a single past`);
  }
});

test("the fragment carries params, the played agent, and every choice", async () => {
  const state: FragmentState = {
    seed: "golden",
    p: { f: 2, w: 0.5 },
    m: [9, GAME_DAY - 1],
    i: [[GAME_DAY + 1, RENT_ID, "unilateral"]],
    sc: 1,
    n: GAME_DAY + 2,
  };
  const frag = await encodeFragment(state);
  const back = await decodeFragment(`#${frag}`);
  assert.deepEqual(back, state);
});
