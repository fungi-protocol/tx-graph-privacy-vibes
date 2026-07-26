import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy, INTERSECT_DAY } from "../src/engine/economy";
import { ancestry } from "../src/analysis/ancestry";
import { counterfactualOrigins } from "../src/analysis/paths";
import { clusterObserver } from "../src/analysis/clusters";

// the moments chapter 7 narrates must occur on their own by its minDay
let cached: Economy | null = null;
function eco115(): Economy {
  if (!cached) {
    cached = new Economy("golden");
    cached.runTo(115);
  }
  return cached;
}

test("the tidying-up slip lands on INTERSECT_DAY: one owner, two sessions", () => {
  const eco = eco115();
  const ev = eco.events.find((e) => e.memo === "tidying up the wallet");
  assert.ok(ev, "no consolidation slip was injected");
  assert.equal(ev!.day, INTERSECT_DAY);
  const tx = eco.chain.txs.get(ev!.tid)!;
  assert.equal(tx.inputs.length, 2);
  const coins = tx.inputs.map((c) => eco.chain.coins.get(c)!);
  assert.equal(coins[0]!.owner, coins[1]!.owner, "the slip must be one wallet's");
  assert.notEqual(coins[0]!.producer, coins[1]!.producer);
  for (const c of coins) assert.ok(eco.coinjoins.has(c.producer!), `${c.id} is not a session output`);
});

test("the slip's two pasts pass through different sessions", () => {
  // pinned to the default seed the tutorial rides: the staging hunts a
  // fully divergent pair (tier 2) first, and welcome's record has one;
  // golden's post-wallet history offers only one-sided divergence
  const eco = new Economy("welcome");
  eco.runTo(115);
  const ev = eco.events.find((e) => e.memo === "tidying up the wallet")!;
  const tx = eco.chain.txs.get(ev.tid)!;
  const per = tx.inputs.map((c) => {
    const a = ancestry(eco.chain, c);
    return new Set([...a.txs].filter((t) => eco.coinjoins.has(t)));
  });
  // each side has a session of its own that the other side never touches
  assert.ok([...per[0]!].some((s) => !per[1]!.has(s)));
  assert.ok([...per[1]!].some((s) => !per[0]!.has(s)));
});

test("coinjoin change gets spent beside a coinjoined coin by day 115", () => {
  const eco = eco115();
  const sessions = new Set(eco.coinjoins.keys());
  const toxic = eco.chain.order.some((tid) => {
    const tx = eco.chain.txs.get(tid)!;
    if (tx.inputs.length < 2 || sessions.has(tid)) return false;
    const coins = tx.inputs.map((c) => eco.chain.coins.get(c)!);
    return coins.some((c) => c.label === "coinjoin change") &&
      coins.some((c) => c.label !== "coinjoin change" && c.producer !== null && sessions.has(c.producer));
  });
  assert.ok(toxic, "no toxic-change moment for the chapter to frame");
});

test("the session itself never links its change to its inputs", () => {
  // chapter 7's toxic-change step relies on this: the cautious observer
  // shown on screen declines to link change through the session — only an
  // amount analyst (or a later co-spend) hands it back to its owner
  const eco = eco115();
  const cl = clusterObserver(eco.chain);
  // unspent change of underdetermined sessions only: a later co-spend may
  // (rightly) link via CIOH, and a determined session's amounts already
  // hand the observer the full sub-transaction mapping
  const change = [...eco.chain.coins.values()].filter(
    (c) => c.label === "coinjoin change" && c.dest === null &&
      !eco.coinjoins.get(c.producer!)!.determined);
  assert.ok(change.length > 0, "no unspent coinjoin change to test");
  for (const c of change) {
    const rep = cl.rep.get(c.id) ?? c.id;
    const cluster = new Set(cl.members.get(rep) ?? [c.id]);
    for (const i of eco.chain.txs.get(c.producer!)!.inputs) {
      assert.ok(!cluster.has(i),
        `${c.id} was linked to session input ${i} by the session itself`);
    }
  }
});

test("a session output has several candidate origins, some robust", () => {
  const eco = eco115();
  const session = [...eco.coinjoins.keys()].find((t) => t !== eco.naiveTid)!;
  const out = eco.chain.txs.get(session)!.outputs[0]!;
  const o = counterfactualOrigins(eco.chain, out);
  assert.ok(o.roots.length >= 3, `only ${o.roots.length} candidate origins behind a 3+-party session`);
  assert.ok(o.robust.size <= o.roots.length);
});

test("the opening exhibit has faces to count across tutorial seeds (#104)", async () => {
  // "The candidate origins" opens on a fresh output of the dense
  // session: its inputs must arrive from several distinct clusters on
  // the observer's map, so the Guess-Who board is visible in one frame
  const { selectDenseCoinjoin } = await import("../src/scenario/coinjoinSteps");
  const { freshOrigin } = await import("../src/scenario/intersectionSteps");
  for (const seed of ["golden", "welcome", "silver", "alpha"]) {
    const eco = new Economy(seed);
    eco.runTo(115);
    const tid = selectDenseCoinjoin(eco.coinjoins, eco.naiveTid ?? undefined);
    assert.ok(tid, `seed ${seed}: no dense session by day 115`);
    const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
    const hit = freshOrigin(eco.chain, (id) => cl.rep.get(id) ?? id, tid!);
    assert.ok(hit, `seed ${seed}: no denominated output on the dense session`);
    assert.ok(hit!.clusters >= 2,
      `seed ${seed}: the session's inputs share one cluster (${hit!.clusters})`);
    assert.notEqual(eco.chain.coins.get(hit!.out)!.label, "coinjoin change");
  }
});
