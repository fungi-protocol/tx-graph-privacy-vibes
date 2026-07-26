import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain, addrText, type ScriptKind } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver, TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";
import { PERSONAS, WALLETS, walletScript, walletTraits } from "../src/scenario/cast";
import { nfStats } from "../src/analysis/nsnetflix";

const PRICE = 100_000; // $100k/BTC: 1000 sats = $1
const at = (): number => PRICE;

test("addrText prefixes follow the script family", () => {
  const a = { who: 3, branch: "external" as const, index: 7 };
  const pre = (script: ScriptKind): string => addrText({ ...a, script });
  assert.match(pre("legacy"), /^1[^1]/);
  assert.match(pre("compat"), /^3/);
  assert.match(pre("segwit"), /^bc1q/);
  assert.match(pre("taproot"), /^bc1p/);
});

test("assignAddresses records each wallet's script; assignTxTraits the builder's habits", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addRoot("b", 500_000, 1);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 123_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  const scripts: ScriptKind[] = ["segwit", "taproot"];
  c.assignAddresses(new Set(), (who) => scripts[who!]!);
  assert.equal(c.coins.get("a")!.addr!.script, "segwit");
  assert.equal(c.coins.get("t1o1")!.addr!.script, "taproot"); // the payee's wallet
  assert.equal(c.coins.get("t1o2")!.addr!.script, "segwit"); // change stays home
  c.assignTxTraits((who) =>
    who === 0 ? { locktime: "tip", lowR: true } : { locktime: "zero", lowR: false });
  const t1 = c.txs.get("t1")!;
  assert.equal(t1.locktime, "tip"); // the builder holds the first input
  assert.deepEqual(t1.sigLowR, [true]);
});

test("wallet migration: pre-story savings sit on the former wallet's script", () => {
  const dave = PERSONAS.findIndex((p) => p.name === "Dave");
  const p = PERSONAS[dave]!;
  assert.equal(p.walletBefore, "hearth");
  assert.equal(walletScript(p, true), WALLETS["hearth"]!.script);
  assert.equal(walletScript(p, false), WALLETS["foxglove"]!.script);
  assert.notEqual(walletScript(p, true), walletScript(p, false));
  // and the economy's record shows the seam: his savings on the old
  // family, everything the story produced for him on the new one
  const eco = new Economy("welcome");
  eco.runTo(30);
  const daves = [...eco.chain.coins.values()].filter((c) => c.owner === dave);
  // pre-story savings entered before day 1; income deposits and change
  // arrive during the story, on the current wallet
  const savings = daves.filter((c) => c.producer === null && (c.entered ?? -1) <= 0);
  const later = daves.filter((c) => c.producer !== null || (c.entered ?? -1) > 0);
  assert.ok(savings.length >= 2 && later.length >= 1, "Dave has too little history");
  for (const c of savings) assert.equal(c.addr!.script, WALLETS["hearth"]!.script);
  for (const c of later) assert.equal(c.addr!.script, WALLETS["foxglove"]!.script);
  // habits are the CURRENT wallet's — imported keys, new software
  const t = walletTraits(p);
  assert.deepEqual(t, WALLETS["foxglove"]!.traits);
});

test("script tell: an output paying a foreign family reads as the payment", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  // both outputs odd in dollars and BTC: no amount tell can fire
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 123_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  c.assignAddresses(new Set(), (who) => (who === 0 ? "segwit" : "taproot"));
  const cl = clusterObserver(c, at);
  assert.deepEqual(cl.payGuess.get("t1"), ["t1o1"]);
  assert.deepEqual(cl.changeGuess.get("t1"), ["t1o2"]);
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  // switched off, the same record says nothing
  const off = clusterObserver(c, at, { changeTells: TELL_USD | TELL_BTC | TELL_AUX });
  assert.equal(off.payGuess.get("t1"), undefined);
  assert.equal(off.changeGuess.get("t1"), undefined);
  assert.notEqual(off.rep.get("a"), off.rep.get("t1o2"));
});

test("script tell: a same-family record is silent, and the tell counts toward the bar", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 123_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  // everyone segwit: the tell has nothing to read
  c.assignAddresses(new Set(), () => "segwit");
  assert.equal(clusterObserver(c, at, { changeTells: TELL_SCRIPT })
    .payGuess.get("t1"), undefined);
  // a foreign-family AND round-dollar payment: two kinds clear bar 2
  const d = new Chain();
  d.addRoot("a", 1_000_000, 0);
  d.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 }, // $150
    { owner: 0, value: 850_000 - fee },
  ], 2);
  d.assignAddresses(new Set(), (who) => (who === 0 ? "segwit" : "compat"));
  assert.deepEqual(clusterObserver(d, at, { changeEvidence: 2 })
    .changeGuess.get("t1"), ["t1o2"]);
  // the amount tell alone does not clear it
  const only = clusterObserver(d, at,
    { changeEvidence: 2, changeTells: TELL_ALL & ~TELL_SCRIPT });
  assert.equal(only.changeGuess.get("t1"), undefined);
});

test("ns-netflix vectors carry script families and building habits", () => {
  const eco = new Economy("welcome");
  eco.runTo(30);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
  const stats = nfStats(cl, eco.chain);
  let scripted = 0, habitual = 0;
  for (const st of stats.values()) {
    assert.equal(st.script.length, 4);
    assert.equal(st.habits.length, 4);
    if (st.script.some((n) => n > 0)) scripted++;
    if (st.habits.some((n) => n > 0)) habitual++;
  }
  assert.ok(scripted > 0, "no cluster carries a script fingerprint");
  assert.ok(habitual > 0, "no cluster carries a habit fingerprint");
});

test("fingerprint veto: divergent input families make CIOH abstain (#103)", () => {
  const c = new Chain();
  const fee = txfee(2, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addRoot("b", 500_000, 1);
  // two owners' coins in one spend, both outputs amount-mute
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 623_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  c.assignAddresses(new Set(), (who) => (who === 0 ? "segwit" : "taproot"));
  // without the fingerprint knob CIOH links the payjoin's lie
  const naive = clusterObserver(c, at);
  assert.equal(naive.rep.get("a"), naive.rep.get("b"));
  assert.ok(naive.links.some((w) => w.method === "cioh" && w.tx === "t1"));
  // with it, two families in one spend read as two wallets: abstention
  const sharp = clusterObserver(c, at, { fingerprints: true });
  assert.notEqual(sharp.rep.get("a"), sharp.rep.get("b"));
  assert.ok(!sharp.links.some((w) => w.method === "cioh" && w.tx === "t1"));
});

test("fingerprint veto: homogeneous families keep CIOH, and a migration misfires (#103)", () => {
  // same-family inputs: the check is quiet, the link stands — a payjoin
  // between users of one product keeps its cover
  const c = new Chain();
  const fee = txfee(2, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addRoot("b", 500_000, 1);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 623_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  c.assignAddresses(new Set(), () => "segwit");
  const cl = clusterObserver(c, at, { fingerprints: true });
  assert.equal(cl.rep.get("a"), cl.rep.get("b"));
  // the misfire: ONE user co-spends coins from their old and new
  // wallets, and the check misreads the migration as collaboration —
  // the observer misses a true link (an abstention, so nothing for the
  // mistakes grading to flag)
  const d = new Chain();
  d.addRoot("old", 1_000_000, 0);
  d.addRoot("new", 500_000, 0);
  d.addTx("t1", 1, ["old", "new"], [
    { owner: 1, value: 623_457 },
    { owner: 0, value: 876_543 - fee },
  ], 2);
  d.assignAddresses(new Set(), (_who, _day, root) => (root ? "segwit" : "taproot"));
  // hand-tune: the two roots sit on different families (old savings vs
  // fresh wallet), as Dave's migration leaves them
  d.coins.get("new")!.addr!.script = "taproot";
  d.coins.get("old")!.addr!.script = "segwit";
  const mig = clusterObserver(d, at, { fingerprints: true });
  assert.notEqual(mig.rep.get("old"), mig.rep.get("new"));
});

test("ns-social has matches to show at the post-settlement chapter across tutorial seeds (#103)", async () => {
  const { nsSocialRun } = await import("../src/analysis/nssocial");
  for (const seed of ["golden", "welcome", "silver", "alpha"]) {
    const eco = new Economy(seed);
    eco.runTo(60);
    const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
    const run = nsSocialRun(cl, eco.chain, 0.5, 2);
    assert.ok(run.length >= 1, `seed ${seed}: no ns-social matches at day 60`);
  }
});
