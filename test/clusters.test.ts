import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { clusterObserver, clusterByOwner, clusterByKnowledge, gradeLinks, mergeInputs, TELL_USD, TELL_BTC, TELL_AUX } from "../src/analysis/clusters";
import { subTransactionMapping } from "../src/analysis/subsetsum";
import { Economy } from "../src/engine/economy";

const PRICE = 100_000; // $100k/BTC: 1000 sats = $1
const at = (): number => PRICE;

test("CIOH unions the inputs of a multi-input transaction", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 0);
  c.addRoot("z", 500_000, 1);
  const fee = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 350_000 },
    { owner: 0, value: 150_000 - fee },
  ], 2);
  const cl = clusterObserver(c);
  assert.equal(cl.rep.get("a"), cl.rep.get("b"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("z"));
});

test("round-USD output marks the other output as change", () => {
  const c = new Chain();
  c.addRoot("a", 1_000_000, 0);
  const fee = txfee(1, 2, 2);
  // payment $100 = 100,000 sats (round); change is whatever is left (not round)
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  const cl = clusterObserver(c, at);
  const guess = cl.changeGuess.get("t1");
  assert.deepEqual(guess, ["t1o2"]);
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o1"));
});

test("two round outputs yield no change guess", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  // both outputs round in USD: $100 and $200
  c.addRoot("a", 100_000 + 200_000 + fee, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 200_000 },
  ], 2);
  const cl = clusterObserver(c, at);
  assert.equal(cl.changeGuess.get("t1"), undefined);
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o1"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("t1o2"));
});

test("no price series withholds the round-USD tell; round-BTC amounts still read", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  // $150 = 150,000 sats: round in dollars, NOT round in BTC (0.0015)
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 0, value: 850_000 - fee },
  ], 2);
  // without a rate the dollar tell has nothing to read
  assert.equal(clusterObserver(c).changeGuess.size, 0);
  assert.deepEqual(clusterObserver(c, at).changeGuess.get("t1"), ["t1o2"]);
  // a round-BTC amount (0.001, decimal hamming weight 1) needs no rate
  const b = new Chain();
  b.addRoot("a", 1_000_000, 0);
  b.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  assert.deepEqual(clusterObserver(b).changeGuess.get("t1"), ["t1o2"]);
  assert.deepEqual(clusterObserver(b).payGuess.get("t1"), ["t1o1"]);
});

test("clusters are ranked by size, largest first", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 0);
  c.addRoot("d", 400_000, 0);
  c.addRoot("z", 500_000, 1);
  const fee = txfee(3, 2, 2);
  // neither output is round in BTC or (rateless) dollars: two unknowns,
  // the batch-payment null hypothesis, no change link to muddy the count
  c.addTx("t1", 1, ["a", "b", "d"], [
    { owner: 1, value: 550_000 },
    { owner: 0, value: 350_000 - fee },
  ], 2);
  const cl = clusterObserver(c);
  const big = cl.rep.get("a")!;
  assert.equal(cl.rank.get(big), 1);
  assert.equal(cl.members.get(big)!.length, 3);
});

test("on the economy, change guesses are mostly right but not gospel", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  let right = 0, wrong = 0;
  for (const [, guesses] of cl.changeGuess) {
    for (const guess of guesses) {
      if (eco.chain.coins.get(guess)!.label === "change") right += 1;
      else wrong += 1;
    }
  }
  assert.ok(right + wrong >= 10, `only ${right + wrong} change guesses in 60 days`);
  assert.ok(right / (right + wrong) >= 0.8,
    `change heuristic accuracy ${right}/${right + wrong} below 80%`);
});

test("cluster graph layout covers every cluster and stays in bounds", async () => {
  const { layoutClusterGraph } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const clay = layoutClusterGraph(cl);
  assert.equal(clay.nodes.size, cl.members.size);
  for (const node of clay.nodes.values()) {
    assert.ok(node.x - node.r >= clay.bounds.x && node.x + node.r <= clay.bounds.x + clay.bounds.w);
    assert.ok(node.y - node.r >= clay.bounds.y && node.y + node.r <= clay.bounds.y + clay.bounds.h);
    assert.ok(node.size >= 1);
  }
});

test("observer clustering is deterministic", () => {
  const a = new Economy("golden");
  a.runTo(30);
  const b = new Economy("golden");
  b.runTo(30);
  const ca = clusterObserver(a.chain, (d) => a.prices[d]);
  const cb = clusterObserver(b.chain, (d) => b.prices[d]);
  assert.deepEqual([...ca.rep.entries()], [...cb.rep.entries()]);
  assert.deepEqual([...ca.changeGuess.entries()], [...cb.changeGuess.entries()]);
});

test("heuristic toggles gate their unions independently", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 900_000, 0);
  const fee2 = txfee(2, 2, 2);
  // co-spend (CIOH) whose round-USD output also invites a change guess
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 1_000_000 - fee2 },
  ], 2);
  // CIOH off: the co-spent inputs stay apart — and with the inputs in
  // different apparent clusters there is no one spender to predict
  // change for, so the guess abstains rather than pick an input at random
  const noCioh = clusterObserver(c, at, { cioh: false });
  assert.notEqual(noCioh.rep.get("a"), noCioh.rep.get("b"));
  assert.equal(noCioh.changeGuess.get("t1"), undefined);
  // both on: CIOH links the inputs first, the tx reads unilateral, and
  // only then does the change guess fire
  const both = clusterObserver(c, at);
  assert.deepEqual(both.changeGuess.get("t1"), ["t1o2"]);
  // change off: the co-spend still links, no output joins the inputs
  const noChange = clusterObserver(c, at, { change: false });
  assert.equal(noChange.rep.get("a"), noChange.rep.get("b"));
  assert.equal(noChange.changeGuess.size, 0);
  assert.notEqual(noChange.rep.get("t1o2"), noChange.rep.get("a"));
});

test("subset-sum toggle off falls back to CIOH on ambiguous spends", () => {
  const c = new Chain();
  // three equal outputs make the split proven-ambiguous: {a}<->{any one
  // of them} balances, so the analysis abstains — until it is switched
  // off, when plain CIOH links the co-spent inputs unconditionally
  const fee = txfee(2, 3, 2);
  c.addRoot("a", 100_000, 0);
  c.addRoot("b", 200_000 + fee, 1);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 2, value: 100_000 },
    { owner: 3, value: 100_000 },
    { owner: 4, value: 100_000 },
  ], 2);
  const withSub = clusterObserver(c);
  const without = clusterObserver(c, undefined, { subsum: false });
  assert.notEqual(withSub.rep.get("a"), withSub.rep.get("b"));
  assert.equal(without.rep.get("a"), without.rep.get("b"));
});

test("all heuristics off leaves every coin a singleton", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 900_000, 0);
  const fee2 = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 1_000_000 - fee2 },
  ], 2);
  const cl = clusterObserver(c, at, { cioh: false, change: false, subsum: false });
  for (const [, members] of cl.members) assert.equal(members.length, 1);
});

test("the true wallet partition: one labeled vertex per owner, one for outside", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 900_000, 0);
  c.addRoot("m", 50_000, 1);
  const fee2 = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: null, value: 100_000 }, // an external merchant
    { owner: 0, value: 1_000_000 - fee2 },
  ], 2);
  const cl = clusterByOwner(c);
  // owner 0's coins fuse regardless of any heuristic evidence
  assert.equal(cl.rep.get("a"), cl.rep.get("b"));
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("m"));
  // no vertex is anonymous: every coin belongs to a wallet or the outside
  assert.equal([...cl.members.keys()].length, 3); // owner 0, owner 1, outside
});

test("a participant's partition: facts and suspicions fuse apart, the rest stay singletons", () => {
  const c = new Chain();
  c.addRoot("a", 100_000, 0);
  c.addRoot("b", 200_000, 1);
  c.addRoot("d", 300_000, 2);
  const att = new Map([
    ["a", { owner: 0, direct: true }],
    ["b", { owner: 0, direct: false }], // guessed, not known
  ] as [string, { owner: number | null; direct: boolean }][]);
  const cl = clusterByKnowledge(c, att);
  // a known coin and a guessed coin of the same owner stay two vertices
  assert.notEqual(cl.rep.get("a"), cl.rep.get("b"));
  // the unattributed coin is an anonymous singleton
  assert.equal(cl.members.get(cl.rep.get("d")!)!.length, 1);
});

test("CIOH abstains above the max-inputs cap", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 0);
  c.addRoot("d", 400_000, 0);
  const fee = txfee(3, 2, 2);
  c.addTx("t1", 1, ["a", "b", "d"], [
    { owner: 1, value: 500_000 },
    { owner: 0, value: 400_000 - fee },
  ], 2);
  const capped = clusterObserver(c, undefined, { ciohMaxInputs: 2 });
  assert.notEqual(capped.rep.get("a"), capped.rep.get("b"));
  assert.notEqual(capped.rep.get("b"), capped.rep.get("d"));
  assert.equal(capped.links.filter((w) => w.method === "cioh").length, 0);
  const roomy = clusterObserver(c, undefined, { ciohMaxInputs: 3 });
  assert.equal(roomy.rep.get("a"), roomy.rep.get("b"));
  assert.equal(roomy.rep.get("b"), roomy.rep.get("d"));
});

test("change identification applies per sub-transaction of a unique partition", () => {
  const c = new Chain();
  const fee = txfee(2, 3, 2);
  // part A: a -> $100 payment (round) + $130.50 change; part B: b -> $777,
  // paying the fee. The only balancing partition, so the mapping is unique
  c.addRoot("a", 230_500, 0);
  c.addRoot("b", 777_000 + fee, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 130_500 },
    { owner: 2, value: 777_000 },
  ], 2);
  const cl = clusterObserver(c, at);
  // the sub-transaction analysis links each part...
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o1"));
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  assert.equal(cl.rep.get("b"), cl.rep.get("t1o3"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("b"));
  // ...and the round-USD rule runs inside part A: $100 reads as the
  // payment, so the other output is guessed to be its change
  assert.deepEqual(cl.changeGuess.get("t1"), ["t1o2"]);
  const changeLinks = cl.links.filter((w) => w.method === "change" && w.tx === "t1");
  assert.equal(changeLinks.length, 1);
  assert.ok(changeLinks[0]!.coins.includes("t1o2"));
  // with the change toggle off, the part links stay but no guess is made
  const noChange = clusterObserver(c, at, { change: false });
  assert.equal(noChange.changeGuess.size, 0);
});

test("several unidentified outputs read as a batch payment: the observer abstains", () => {
  const c = new Chain();
  const fee = txfee(1, 3, 2);
  c.addRoot("a", 1_000_000 + fee, 0);
  // one round payment ($100), two odd outputs: a payment may have been
  // missed, so neither odd output is linked as change
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 2, value: 371_300 },
    { owner: 0, value: 478_700 },
  ], 2);
  const cl = clusterObserver(c, at);
  assert.deepEqual(cl.payGuess.get("t1"), ["t1o1"]);
  assert.equal(cl.changeGuess.get("t1"), undefined);
  assert.equal(cl.links.filter((w) => w.method === "change").length, 0);
  // identify the second payment too (both round) and the sole remaining
  // unknown becomes the suspected change
  const d = new Chain();
  d.addRoot("a", 1_001_337 + fee, 0);
  d.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 2, value: 370_000 },
    { owner: 0, value: 481_337 }, // odd: $481.34
  ], 2);
  const dl = clusterObserver(d, at);
  assert.deepEqual(dl.payGuess.get("t1"), ["t1o1", "t1o2"]);
  assert.deepEqual(dl.changeGuess.get("t1"), ["t1o3"]);
  assert.equal(dl.rep.get("a"), dl.rep.get("t1o3"));
});

test("the evidentiary bar gates the change link, not the identifications", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 0, value: 850_000 - fee },
  ], 2);
  // a single round amount is one tell: enough at bar 1, not at bar 2
  const lenient = clusterObserver(c, at, { changeEvidence: 1 });
  assert.deepEqual(lenient.changeGuess.get("t1"), ["t1o2"]);
  const strict = clusterObserver(c, at, { changeEvidence: 2 });
  assert.equal(strict.changeGuess.get("t1"), undefined);
  assert.deepEqual(strict.payGuess.get("t1"), ["t1o1"]); // still identified
  assert.notEqual(strict.rep.get("a"), strict.rep.get("t1o2"));
  // an auxiliary attribution corroborates the amount: two tells clear bar 2
  const grants = new Map([["a", 0], ["t1o1", 1]] as [string, number][]);
  const aux = clusterObserver(c, at, { changeEvidence: 2, grants });
  assert.deepEqual(aux.changeGuess.get("t1"), ["t1o2"]);
  assert.equal(aux.rep.get("a"), aux.rep.get("t1o2"));
});

test("tell toggles: each kind can be switched off, and the bar counts kinds", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  // $150 = 150,000 sats: round in dollars only
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 0, value: 850_000 - fee },
  ], 2);
  // with the round-dollar tell off, nothing identifies the payment
  const noUsd = clusterObserver(c, at, { changeTells: TELL_BTC | TELL_AUX });
  assert.equal(noUsd.payGuess.get("t1"), undefined);
  assert.equal(noUsd.changeGuess.get("t1"), undefined);
  // a round-BTC value with the BTC tell off likewise
  const b = new Chain();
  b.addRoot("a", 1_000_000, 0);
  b.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  assert.equal(clusterObserver(b, undefined, { changeTells: TELL_USD | TELL_AUX })
    .changeGuess.get("t1"), undefined);
  // the aux tell off means the grant identifies nothing (the grant
  // layer's own fusion is separate machinery, not under test here)
  const grants = new Map([["a", 0], ["t1o1", 1]] as [string, number][]);
  const d = new Chain();
  d.addRoot("a", 1_000_000, 0);
  d.addTx("t1", 1, ["a"], [
    { owner: 1, value: 371_300 },
    { owner: 0, value: 628_700 - fee },
  ], 2);
  assert.equal(clusterObserver(d, at, { grants, changeTells: TELL_USD | TELL_BTC })
    .payGuess.get("t1"), undefined);
  // the bar counts KINDS: $100 at $100k/BTC is 100,000 sats — round in
  // dollars AND in BTC, two kinds firing on one output clear bar 2
  const e = new Chain();
  e.addRoot("a", 1_000_000, 0);
  e.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 },
    { owner: 0, value: 900_000 - fee },
  ], 2);
  assert.deepEqual(clusterObserver(e, at, { changeEvidence: 2 }).changeGuess.get("t1"), ["t1o2"]);
  // ...but two round-DOLLAR payments are still one kind: bar 2 holds
  const f = new Chain();
  const fee13 = txfee(1, 3, 2);
  f.addRoot("a", 150_000 + 250_000 + 371_337 + fee13, 0);
  f.addTx("t1", 1, ["a"], [
    { owner: 1, value: 150_000 },
    { owner: 2, value: 250_000 },
    { owner: 0, value: 371_337 },
  ], 2);
  const g = clusterObserver(f, at, { changeEvidence: 2 });
  assert.deepEqual(g.payGuess.get("t1"), ["t1o1", "t1o2"]);
  assert.equal(g.changeGuess.get("t1"), undefined);
});

test("auxiliary attribution identifies a payment no amount tell would", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  c.addRoot("a", 1_000_000, 0);
  // both outputs odd: without a grant, two unknowns, no link
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 371_300 },
    { owner: 0, value: 628_700 - fee },
  ], 2);
  assert.equal(clusterObserver(c, at).changeGuess.get("t1"), undefined);
  // the observer holds attributions: the input is owner 0's, the first
  // output someone else's — a payment, so the sole unknown is change
  const grants = new Map([["a", 0], ["t1o1", 1]] as [string, number][]);
  const cl = clusterObserver(c, at, { grants });
  assert.deepEqual(cl.payGuess.get("t1"), ["t1o1"]);
  assert.deepEqual(cl.changeGuess.get("t1"), ["t1o2"]);
  // an attribution matching the inputs' owner is a resolved self-spend,
  // not a payment — and not a change link either (the grant layer owns it)
  const selfg = new Map([["a", 0], ["t1o1", 0]] as [string, number][]);
  const sl = clusterObserver(c, at, { grants: selfg });
  assert.equal(sl.payGuess.get("t1"), undefined);
  assert.equal(sl.changeGuess.get("t1"), undefined);
});

test("an underdetermined partition still gets step one: payments identified, nothing linked", () => {
  const c = new Chain();
  // three equal NON-menu outputs ($150 each) make the split proven
  // ambiguous; the observer links nothing, but the round amounts are
  // per-coin reads and land in payGuess anyway
  const fee = txfee(2, 3, 2);
  c.addRoot("a", 150_000, 0);
  c.addRoot("b", 300_000 + fee, 1);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 2, value: 150_000 },
    { owner: 3, value: 150_000 },
    { owner: 4, value: 150_000 },
  ], 2);
  const cl = clusterObserver(c, at);
  assert.notEqual(cl.rep.get("a"), cl.rep.get("b"));
  assert.equal(cl.links.length, 0);
  assert.deepEqual(cl.payGuess.get("t1"), ["t1o1", "t1o2", "t1o3"]);
  assert.equal(cl.changeGuess.get("t1"), undefined);
});

test("radix structure inverts the null hypothesis: repeated denominations and the residue read as self-spends", () => {
  const c = new Chain();
  const fee = txfee(1, 3, 2);
  // a self-decomposition: 2 × 2,000,000 (a menu denomination, repeated)
  // plus an odd residue — no payment evidence anywhere
  c.addRoot("a", 4_371_337 + fee, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 0, value: 2_000_000 },
    { owner: 0, value: 2_000_000 },
    { owner: 0, value: 371_337 },
  ], 2);
  const cl = clusterObserver(c, at);
  // every output links to the input cluster — the denominations by the
  // radix null hypothesis, linked but not guessed as change
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o1"));
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o2"));
  assert.equal(cl.rep.get("a"), cl.rep.get("t1o3"));
  assert.equal(cl.changeGuess.get("t1"), undefined);
  const radixLinks = cl.links.filter((w) => w.method === "change" && w.basis === "radix");
  assert.equal(radixLinks.length, 3);
  // amount evidence still identifies a payment inside the structure: a
  // round-dollar output that is NOT a menu value keeps its tell
  const d = new Chain();
  d.addRoot("a", 4_150_000 + fee, 0);
  d.addTx("t1", 1, ["a"], [
    { owner: 0, value: 2_000_000 },
    { owner: 0, value: 2_000_000 },
    { owner: 1, value: 150_000 }, // $150: round USD, not a denomination
  ], 2);
  const dl = clusterObserver(d, at);
  assert.deepEqual(dl.payGuess.get("t1"), ["t1o3"]);
  assert.notEqual(dl.rep.get("a"), dl.rep.get("t1o3"));
});

test("the lattice bottom: every coin its own vertex", async () => {
  const { clusterSingletons } = await import("../src/analysis/clusters");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterSingletons(eco.chain);
  assert.equal(cl.members.size, eco.chain.coins.size);
  for (const [rep, members] of cl.members) {
    assert.deepEqual(members, [rep]);
  }
});

test("the ring is the timeline bent around a circle, gap at six o'clock", async () => {
  const { layoutClusterGraph } = await import("../src/ui/clusterview");
  const { clusterSingletons } = await import("../src/analysis/clusters");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterSingletons(eco.chain);
  const clay = layoutClusterGraph(cl, eco.chain);
  assert.equal(clay.nodes.size, eco.chain.coins.size);
  const day = (id: string): number => {
    const c = eco.chain.coins.get(id)!;
    return c.producer ? eco.chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const byTime = [...clay.nodes.keys()].sort((a, b) => day(a) - day(b) || (a < b ? -1 : 1));
  const first = clay.nodes.get(byTime[0]!)!;
  const last = clay.nodes.get(byTime[byTime.length - 1]!)!;
  // six o'clock is straight down: the earliest vertex lands just left
  // of it (x < 0, y > 0), the latest just right (x > 0, y > 0)
  assert.ok(first.x < 0 && first.y > 0, `first at (${first.x}, ${first.y})`);
  assert.ok(last.x > 0 && last.y > 0, `last at (${last.x}, ${last.y})`);
  // and the walk between them is monotone in angle from six o'clock
  const angleFromSix = (n: { x: number; y: number }): number => {
    const a = Math.atan2(n.y, n.x / 1.35); // undo the ellipse stretch
    return (a - Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
  };
  let prev = -1;
  for (const id of byTime) {
    const a = angleFromSix(clay.nodes.get(id)!);
    assert.ok(a >= prev - 1e-9, `angle regressed at ${id}`);
    prev = a;
  }
});

test("a partial clustering orders its ring by each vertex's earliest coin", async () => {
  const { layoutClusterGraph } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const clay = layoutClusterGraph(cl, eco.chain);
  const day = (id: string): number => {
    const c = eco.chain.coins.get(id)!;
    return c.producer ? eco.chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const earliest = (rep: string): number =>
    Math.min(...cl.members.get(rep)!.map(day));
  const angleFromSix = (n: { x: number; y: number }): number => {
    const a = Math.atan2(n.y, n.x / 1.35);
    return (a - Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
  };
  const byAngle = [...clay.nodes.values()].sort((a, b) => angleFromSix(a) - angleFromSix(b));
  let prev = -Infinity;
  for (const n of byAngle) {
    const e = earliest(n.rep);
    assert.ok(e >= prev, `ring order not by earliest coin at ${n.rep}`);
    prev = e;
  }
});

test("the force ring order pulls transfer neighbors together", async () => {
  const { layoutClusterGraph } = await import("../src/ui/clusterview");
  const eco = new Economy("golden");
  eco.runTo(30);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const time = layoutClusterGraph(cl, eco.chain, "time");
  const force = layoutClusterGraph(cl, eco.chain, "force");
  assert.deepEqual([...force.nodes.keys()].sort(), [...time.nodes.keys()].sort());
  // deterministic: same input, same drawing
  const again = layoutClusterGraph(cl, eco.chain, "force");
  assert.deepEqual(
    [...force.nodes.values()].map((n) => [n.rep, n.x, n.y]),
    [...again.nodes.values()].map((n) => [n.rep, n.x, n.y]),
  );
  // the point of the mode: total transfer-edge length shrinks
  const cost = (lay: { nodes: Map<string, { x: number; y: number }> }): number => {
    let s = 0;
    for (const tid of eco.chain.order) {
      const tx = eco.chain.txs.get(tid)!;
      const from = lay.nodes.get(cl.rep.get(tx.inputs[0]!)!)!;
      for (const out of tx.outputs) {
        const to = lay.nodes.get(cl.rep.get(out)!)!;
        if (to === from) continue;
        s += Math.hypot(to.x - from.x, to.y - from.y);
      }
    }
    return s;
  };
  assert.ok(cost(force) < cost(time),
    `force ${Math.round(cost(force))} should beat time ${Math.round(cost(time))}`);
});

// --- repeated co-membership (#105): inputs of a coinjoin-shaped
// transaction issued by one earlier coinjoin-shaped transaction read as
// one participant's coins coming back, and count as one combined input
// in the sub-transaction search.

// two sessions: s1 issues two 100k menu outputs (owners per `owners`),
// both of which come back together in s2 beside a stranger's coin.
// Both transactions carry the session shape (a repeated denomination).
function remeetChain(owners: [number, number]): Chain {
  const c = new Chain();
  const f1 = txfee(2, 2, 2);
  c.addRoot("a", 100_000 + f1, 0);
  c.addRoot("b", 100_000, 1);
  c.addTx("s1", 1, ["a", "b"], [
    { owner: owners[0], value: 100_000 },
    { owner: owners[1], value: 100_000 },
  ], 2);
  const f2 = txfee(3, 3, 2);
  c.addRoot("d", 200_000 + f2, 2);
  c.addTx("s2", 2, ["s1o1", "s1o2", "d"], [
    { owner: owners[0], value: 100_000 },
    { owner: owners[0], value: 100_000 },
    { owner: 2, value: 200_000 },
  ], 2);
  return c;
}
// every other heuristic off, so the links under test stand alone
const ONLY_REMEET = { reuse: false, cioh: false, change: false, subsum: false, remeet: true };

test("repeated co-membership links a session's returning coins; off, they stay apart (#105)", () => {
  const c = remeetChain([0, 0]);
  const on = clusterObserver(c, undefined, ONLY_REMEET);
  assert.equal(on.rep.get("s1o1"), on.rep.get("s1o2"));
  const w = on.links.find((x) => x.method === "remeet");
  assert.ok(w, "no remeet link recorded");
  assert.equal(w!.tx, "s2");
  assert.equal(w!.via, "s1");
  assert.deepEqual([...w!.coins].sort(), ["s1o1", "s1o2"]);
  const off = clusterObserver(c, undefined, { ...ONLY_REMEET, remeet: false });
  assert.notEqual(off.rep.get("s1o1"), off.rep.get("s1o2"));
  assert.equal(off.links.length, 0);
});

test("repeated co-membership needs the session shape on both transactions (#105)", () => {
  // s1's outputs are distinct non-menu values: no repeated
  // denomination, so nothing marks it as a session and the coins'
  // return is an ordinary consolidation, not a re-meeting
  const c = new Chain();
  const f1 = txfee(2, 2, 2);
  c.addRoot("a", 99_800 + f1, 0);
  c.addRoot("b", 110_200, 0);
  c.addTx("s1", 1, ["a", "b"], [
    { owner: 0, value: 99_800 },
    { owner: 0, value: 110_200 },
  ], 2);
  const f2 = txfee(3, 3, 2);
  c.addRoot("d", 190_000 + f2, 2);
  c.addTx("s2", 2, ["s1o1", "s1o2", "d"], [
    { owner: 0, value: 100_000 },
    { owner: 0, value: 100_000 },
    { owner: 2, value: 200_000 },
  ], 2);
  const cl = clusterObserver(c, undefined, ONLY_REMEET);
  assert.ok(cl.links.every((w) => w.method !== "remeet"));
});

test("a re-meeting that really was two users grades as a mistake, one user's does not (#105)", () => {
  const wrong = clusterObserver(remeetChain([0, 1]), undefined, ONLY_REMEET);
  const flagged = gradeLinks(remeetChain([0, 1]), wrong.links);
  const notes = flagged.get("s2") ?? [];
  assert.ok(notes.some((m) => m.method === "remeet"),
    "the two-user re-meeting should grade as a mistake");
  const right = clusterObserver(remeetChain([0, 0]), undefined, ONLY_REMEET);
  const clean = gradeLinks(remeetChain([0, 0]), right.links);
  assert.equal(clean.size, 0);
});

test("a re-met group counts as one combined input and can collapse the mapping to unique (#105)", () => {
  // alone, two readings balance: {1,2 | 3},{3,4 | 7} and {3 | 3},{1,2,4 | 7};
  // with 2 and 4 combined into 6, only {3 | 3},{1,6 | 7} survives
  const ivs = [100_000, 200_000, 300_000, 400_000];
  const ovs = [300_000, 700_000];
  assert.equal(subTransactionMapping(ivs, ovs, 0).kind, "ambiguous");
  const { vals, expand } = mergeInputs(ivs, [[1, 3]]);
  assert.deepEqual(vals, [100_000, 600_000, 300_000]);
  assert.deepEqual(expand, [[0], [1, 3], [2]]);
  const m = subTransactionMapping(vals, ovs, 0);
  assert.equal(m.kind, "unique");
  // the merged part expands back onto the real inputs: {0,1,3} fund the 700k
  const part = m.kind === "unique" ? m.parts.find((p) => p.outs.includes(1))! : undefined!;
  assert.deepEqual(part.ins.flatMap((i) => expand[i]!).sort(), [0, 1, 3]);
});

test("changeReads records the verdict: payment + linked change on a plain spend (#92)", () => {
  const c = new Chain();
  c.addRoot("a", 1_000_000, 0);
  const fee = txfee(1, 2, 2);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 100_000 }, // $100: reads as the payment
    { owner: 0, value: 900_000 - fee },
  ], 2);
  const reads = clusterObserver(c, at).changeReads.get("t1")!;
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.payments, ["t1o1"]);
  assert.equal(reads[0]!.change, "t1o2");
  assert.equal(reads[0]!.abstain, undefined);
});

test("changeReads names the batch abstention when no output reads as a payment (#92)", () => {
  const c = new Chain();
  const fee = txfee(1, 2, 2);
  // neither output round in BTC or dollars: two unknowns, batch rule
  c.addRoot("a", 550_000 + 373_211 + fee, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 1, value: 550_000 - 89 },
    { owner: 0, value: 373_300 },
  ], 2);
  const reads = clusterObserver(c, at).changeReads.get("t1")!;
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.payments, []);
  assert.equal(reads[0]!.change, undefined);
  assert.equal(reads[0]!.unknowns, 2);
  assert.equal(reads[0]!.abstain, "batch");
});

test("changeReads: unclustered inputs abstain with reason 'inputs' (#92)", () => {
  const c = new Chain();
  c.addRoot("a", 200_000, 0);
  c.addRoot("b", 300_000, 1);
  const fee = txfee(2, 2, 2);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 1, value: 100_000 }, // $100: a payment read
    { owner: 0, value: 400_000 - fee },
  ], 2);
  // CIOH off: the inputs never merge, so step two has no one spender
  const cl = clusterObserver(c, at, { reuse: true, cioh: false, change: true, subsum: false });
  const reads = cl.changeReads.get("t1")!;
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.payments, ["t1o1"]);
  assert.equal(reads[0]!.abstain, "inputs");
  assert.equal(cl.changeGuess.get("t1"), undefined);
});

test("changeReads: an underdetermined mapping abstains with reason 'mapping' (#92)", () => {
  const c = new Chain();
  const fee = txfee(2, 3, 2);
  c.addRoot("a", 150_000, 0);
  c.addRoot("b", 300_000 + fee, 1);
  c.addTx("t1", 1, ["a", "b"], [
    { owner: 2, value: 150_000 },
    { owner: 3, value: 150_000 },
    { owner: 4, value: 150_000 },
  ], 2);
  // no price series: $150 reads as nothing, so all three outputs stay
  // unidentified and the open mapping is what blocks any link
  const reads = clusterObserver(c).changeReads.get("t1")!;
  assert.equal(reads.length, 1);
  assert.equal(reads[0]!.abstain, "mapping");
  assert.equal(reads[0]!.unknowns, 3);
  assert.deepEqual(reads[0]!.payments, []);
  // with the rate the same outputs all read as payments: nothing left
  // to link, so the read carries no abstention at all
  const priced = clusterObserver(c, at).changeReads.get("t1")!;
  assert.deepEqual(priced[0]!.payments, ["t1o1", "t1o2", "t1o3"]);
  assert.equal(priced[0]!.abstain, undefined);
});

test("changeReads: radix self-spends recorded as such, change heuristic off records nothing (#92)", () => {
  const c = new Chain();
  const fee = txfee(1, 3, 2);
  c.addRoot("a", 4_371_337 + fee, 0);
  c.addTx("t1", 1, ["a"], [
    { owner: 0, value: 2_000_000 },
    { owner: 0, value: 2_000_000 },
    { owner: 0, value: 371_337 },
  ], 2);
  const reads = clusterObserver(c, at).changeReads.get("t1")!;
  assert.equal(reads.length, 1);
  assert.deepEqual(reads[0]!.selfs.sort(), ["t1o1", "t1o2", "t1o3"]);
  assert.equal(reads[0]!.abstain, undefined);
  const off = clusterObserver(c, at, { reuse: true, cioh: true, change: false, subsum: true });
  assert.equal(off.changeReads.size, 0);
});

// #125: the observer's map lives on the union-find substrate, so a
// cluster's canonical representative is its FIRST coin in chain order —
// deterministic under any merge order, never an artifact of which
// heuristic happened to union last. Members list in chain order too,
// so members[0] IS the representative.
test("observer representatives are each cluster's first coin in chain order (#125)", () => {
  const eco = new Economy("golden");
  eco.runTo(80);
  const pos = new Map<string, number>();
  let i = 0;
  for (const id of eco.chain.coins.keys()) pos.set(id, i++);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  for (const [rep, members] of cl.members) {
    assert.equal(members[0], rep, `cluster ${rep} does not lead its own member list`);
    for (let j = 1; j < members.length; j++) {
      assert.ok(pos.get(members[j - 1]!)! < pos.get(members[j]!)!,
        `cluster ${rep} members out of chain order`);
    }
  }
});
