import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain, addrText, scriptLabel, scriptTitle, type ScriptKind } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver, clusterByOwner, TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";
import { PERSONAS, WALLETS, walletScript, walletTraits } from "../src/scenario/cast";
import { nfStats, nfSimilarity, type NfStats } from "../src/analysis/nsnetflix";

function synthNf(over: Partial<NfStats>): NfStats {
  return {
    amounts: new Array(24).fill(0), temporal: new Array(8).fill(0),
    drift: new Array(8).fill(0), hours: new Array(8).fill(0),
    feeAbs: new Array(12).fill(0), feeRel: new Array(8).fill(0),
    script: new Array(4).fill(0), habits: new Array(4).fill(0), spends: 0,
    ...over,
  };
}

const PRICE = 100_000; // $100k/BTC: 1000 sats = $1
const at = (): number => PRICE;

test("addrText prefixes follow the script type", () => {
  const a = { who: 3, branch: "external" as const, index: 7 };
  const pre = (script: ScriptKind): string => addrText({ ...a, script });
  assert.match(pre("legacy"), /^1[^1]/);
  assert.match(pre("compat"), /^3/);
  assert.match(pre("segwit"), /^bc1q/);
  assert.match(pre("taproot"), /^bc1p/);
});

test("user-facing script names carry the real taxonomy: segwit is a version family, taproot is segwit v1 (#118)", () => {
  assert.equal(scriptLabel("legacy"), "P2PKH");
  assert.equal(scriptLabel("compat"), "P2SH");
  assert.equal(scriptLabel("segwit"), "P2WPKH");
  assert.equal(scriptLabel("taproot"), "P2TR");
  assert.equal(scriptTitle("legacy"), "P2PKH (legacy)");
  assert.equal(scriptTitle("compat"), "P2SH-wrapped segwit");
  assert.equal(scriptTitle("segwit"), "P2WPKH (segwit v0)");
  assert.equal(scriptTitle("taproot"), "P2TR (segwit v1, taproot)");
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

test("ns-netflix has matches to show at the behavioral-matching chapter across tutorial seeds (#112)", async () => {
  const { nfRun } = await import("../src/analysis/nsnetflix");
  for (const seed of ["golden", "welcome", "silver", "alpha"]) {
    const eco = new Economy(seed);
    eco.runTo(55); // the chapter's minDay, at the app's default threshold
    const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
    const run = nfRun(cl, eco.chain, 0.65);
    assert.ok(run.length >= 1, `seed ${seed}: no ns-netflix matches at day 55`);
  }
});

test("ns-social has matches to show at the post-settlement chapter on the app's default seed (#103)", async () => {
  const { nsSocialRun, activePairs } = await import("../src/analysis/nssocial");
  // the chapter narrates the live run and has an honest branch for a
  // stall, but the DEFAULT path (seed "welcome", the app's default
  // threshold) must actually show the method working
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
  const run = nsSocialRun(cl, eco.chain, 0.5, 2);
  assert.ok(activePairs(run).length >= 1, "default seed: no ns-social matches at day 60");
  // the other tutorial seeds need a defined run, not necessarily
  // matches — since #132 the gate abstains where every candidate is an
  // exact tie or a sole option, and "golden" at 0.5 stalls honestly
  for (const seed of ["golden", "silver", "alpha"]) {
    const eco2 = new Economy(seed);
    eco2.runTo(60);
    const cl2 = clusterObserver(eco2.chain, (d) => eco2.prices[d]!);
    assert.ok(Array.isArray(nsSocialRun(cl2, eco2.chain, 0.5, 2)), `seed ${seed}: run failed`);
  }
});

// --- #94: temporal habits — the time of day is a habit of the person ---

test("assignTxMinutes: every transaction stamped, in the initiator's window, and the walk replays exactly (#94)", () => {
  const eco = new Economy("golden");
  eco.runTo(90);
  const again = new Economy("golden");
  again.runTo(90);
  let inWindow = 0;
  for (const tx of eco.chain.txs.values()) {
    assert.notEqual(tx.minute, undefined, `${tx.id} left unstamped`);
    assert.ok(tx.minute! >= 0 && tx.minute! < 1440, `${tx.id} minute ${tx.minute}`);
    assert.equal(again.chain.txs.get(tx.id)!.minute, tx.minute, `${tx.id} replayed differently`);
    const who = eco.chain.coins.get(tx.inputs[0]!)!.owner;
    if (who === null) continue;
    const w = eco.cast[who]!.hours;
    if (!w) continue;
    const [s, e] = w;
    const h = tx.minute! / 60;
    const inside = s <= e ? h >= s && h < e : h >= s || h < e; // wrap past midnight
    assert.ok(inside, `${tx.id}: ${eco.cast[who]!.name} broadcast at ${h.toFixed(2)}h outside [${s}, ${e})`);
    inWindow += 1;
  }
  assert.ok(inWindow > 20, `only ${inWindow} windowed transactions checked`);
});

test("a wrapping window really wraps: Dave's night-owl spends land after 21h or before 3h, on both sides some nights (#94)", () => {
  const eco = new Economy("golden");
  eco.runTo(120);
  const daves = [...eco.chain.txs.values()]
    .filter((tx) => eco.chain.coins.get(tx.inputs[0]!)!.owner === 3);
  assert.ok(daves.length >= 5, `Dave initiated only ${daves.length} transactions`);
  let late = 0, early = 0;
  for (const tx of daves) {
    const h = tx.minute! / 60;
    assert.ok(h >= 21 || h < 3, `Dave broadcast at ${h.toFixed(2)}h`);
    if (h >= 21) late += 1;
    else early += 1;
  }
  assert.ok(late > 0 && early > 0, `the wrap never exercised both sides (late ${late}, early ${early})`);
});

test("nfStats: the hours block counts the initiator's spends by 3-hour window, and no one else's (#94)", () => {
  const c = new Chain();
  c.addRoot("a", 1_000_000, 0);
  c.addRoot("b", 500_000, 1);
  const fee = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 2, value: 700_000 },
    { owner: 0, value: 800_000 - fee },
  ], 2);
  c.txs.get("t1")!.minute = 10 * 60 + 30; // 10:30 -> bucket 3 (09:00-12:00)
  const cl = clusterByOwner(c);
  const stats = nfStats(cl, c);
  const owner0 = stats.get(cl.rep.get("a")!)!;
  const owner1 = stats.get(cl.rep.get("b")!)!;
  assert.deepEqual(owner0.hours, [0, 0, 0, 1, 0, 0, 0, 0], "initiator's window uncounted");
  assert.deepEqual(owner1.hours, [0, 0, 0, 0, 0, 0, 0, 0], "co-funder charged with the initiator's habit");
});

test("nfSimilarity: matching waking-hours rhythms agree, disjoint ones do not (#94)", () => {
  const dayShift1 = synthNf({ hours: [0, 0, 0, 6, 4, 2, 0, 0] });
  const dayShift2 = synthNf({ hours: [0, 0, 0, 3, 5, 1, 0, 0] });
  const nightOwl = synthNf({ hours: [4, 0, 0, 0, 0, 0, 0, 5] });
  assert.ok(nfSimilarity(dayShift1, dayShift2) > 0.8);
  assert.ok(nfSimilarity(dayShift1, nightOwl) < 0.1);
});

test("the habit survives clustering: Grace's true cluster keeps all its hours mass in business windows (#94)", () => {
  const eco = new Economy("golden");
  eco.runTo(120);
  const cl = clusterByOwner(eco.chain);
  const graceCoin = [...eco.chain.coins.values()].find((c) => c.owner === 6);
  assert.ok(graceCoin, "Grace holds no coins by day 120");
  const st = nfStats(cl, eco.chain).get(cl.rep.get(graceCoin.id)!)!;
  const mass = st.hours.reduce((a, b) => a + b, 0);
  assert.ok(mass > 0, "no timed spends on Grace's record");
  // [9, 17) covers 3-hour buckets 3..5 and nothing else
  assert.equal(st.hours[0]! + st.hours[1]! + st.hours[2]! + st.hours[6]! + st.hours[7]!, 0,
    `business-hours till spent off-hours: ${st.hours}`);
});
