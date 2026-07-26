import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { PERSONAS, WALLETS, walletOf, walletFee, buildCast, MAX_POP } from "../src/scenario/cast";

test("wallets: every persona's product exists, and the default is Hearth", () => {
  for (const p of PERSONAS) {
    assert.ok(WALLETS[p.wallet ?? "hearth"], `${p.name} runs an unknown wallet ${p.wallet}`);
    assert.ok(p.walletWhy, `${p.name} never says why`);
  }
  const { personas } = buildCast("welcome", MAX_POP);
  for (const p of personas) {
    assert.equal(walletOf(p).name, WALLETS[p.wallet ?? "hearth"]!.name);
  }
});

test("wallets: the fee policies are distinguishable fingerprints", () => {
  const base = 2.6;
  const draws = Array.from({ length: 200 }, (_, i) => i / 200);
  const mean = (key: string) =>
    draws.reduce((s, d) => s + WALLETS[key]!.fee(base, d), 0) / draws.length;
  // relative-to-market ordering: the miser under, the till over, the
  // instant button well over
  assert.ok(mean("pelican") < base, "Pelican bids under the market");
  assert.ok(mean("hearth") > mean("pelican"));
  assert.ok(mean("ledgerline") > base, "Ledgerline pays its premium");
  assert.ok(mean("brightpay") > mean("ledgerline"), "Brightpay pays for the button");
  // pelican and brightpay bid whole sats; ledgerline ignores the dice
  for (const d of draws) {
    assert.equal(WALLETS["pelican"]!.fee(base, d) % 1, 0);
    assert.equal(WALLETS["brightpay"]!.fee(base, d) % 1, 0);
    assert.equal(WALLETS["ledgerline"]!.fee(base, d), WALLETS["ledgerline"]!.fee(base, 1 - d));
  }
  // foxglove's scatter is the widest — the width is its own signature
  const spread = (key: string) => {
    const bids = draws.map((d) => WALLETS[key]!.fee(base, d));
    return Math.max(...bids) - Math.min(...bids);
  };
  assert.ok(spread("foxglove") > spread("hearth") * 1.5);
  // nobody bids below the relay floor
  for (const key of Object.keys(WALLETS)) {
    assert.ok(WALLETS[key]!.fee(0.8, 0) >= 0.8 * 0.6, `${key} underbids at the floor`);
  }
});

test("wallets: the policy reads on chain — per-payer relative feerates", () => {
  const eco = new Economy("golden");
  eco.runTo(80);
  // day-median feerate as the observer's prevailing-rate estimate
  const byDay = new Map<number, number[]>();
  for (const tx of eco.chain.txs.values()) {
    const g = byDay.get(tx.timestep) ?? [];
    g.push(tx.feerate);
    byDay.set(tx.timestep, g);
  }
  const median = new Map<number, number>();
  for (const [day, rates] of byDay) {
    const s = [...rates].sort((a, b) => a - b);
    median.set(day, s[Math.floor(s.length / 2)]!);
  }
  // events name the payer; average each persona's relative bid
  const rel = new Map<number, number[]>();
  for (const ev of eco.events) {
    // only the forms where the payer's own wallet sets the bid
    if (ev.form !== "unilateral" && ev.form !== "payjoin") continue;
    const tx = eco.chain.txs.get(ev.tid);
    if (!tx) continue;
    const m = median.get(tx.timestep)!;
    if (m <= 0) continue;
    const g = rel.get(ev.payer) ?? [];
    g.push(tx.feerate / m);
    rel.set(ev.payer, g);
  }
  const meanRel = (u: number) => {
    const g = rel.get(u) ?? [];
    assert.ok(g.length >= 3, `agent ${u} paid too rarely to read (${g.length})`);
    return g.reduce((s, x) => s + x, 0) / g.length;
  };
  const bob = meanRel(1); // pelican
  const carol = meanRel(2); // brightpay
  assert.ok(bob < carol,
    `Pelican should read under Brightpay (Bob ${bob.toFixed(2)} vs Carol ${carol.toFixed(2)})`);
});
