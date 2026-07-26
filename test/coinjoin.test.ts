import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { Economy, COINJOIN_DAY, type EconomyEvent } from "../src/engine/economy";
import { PERSONAS } from "../src/scenario/cast";
import { clusterObserver, sessionShape } from "../src/analysis/clusters";
import { agentKnowledge } from "../src/analysis/knowledge";
import { isDenomination } from "../src/denom/denominations";
import { remeetExhibit } from "../src/scenario/coinjoinSteps";

let cached: Economy | null = null;
function eco115(): Economy {
  if (!cached) {
    cached = new Economy("golden");
    cached.runTo(115);
  }
  return cached;
}

test("no coinjoins before the idea crosses community lines", () => {
  const eco = new Economy("golden");
  eco.runTo(COINJOIN_DAY - 1);
  assert.equal(eco.coinjoins.size, 0);
  assert.ok(eco.events.every((e) => e.form !== "coinjoin"));
});

test("careless values map uniquely on every tutorial seed", () => {
  // the narration branches on the verdict, but the story expects the
  // careless coinjoin to be fully partitioned — hold every seed the
  // tutorial and tests reach to it, so prose and world never diverge
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(COINJOIN_DAY);
    assert.ok(eco.naiveTid, `${seed}: no naive coinjoin on COINJOIN_DAY`);
    assert.ok(eco.coinjoins.get(eco.naiveTid!)!.determined,
      `${seed}: careless values must map uniquely`);
  }
});

test("the careless first coinjoin is fully partitioned by the observer", () => {
  const eco = eco115();
  assert.ok(eco.naiveTid, "no naive coinjoin on COINJOIN_DAY");
  const tx = eco.chain.txs.get(eco.naiveTid!)!;
  assert.equal(tx.timestep, COINJOIN_DAY);
  assert.ok(eco.coinjoins.get(eco.naiveTid!)!.determined, "careless values must map uniquely");
  const owner = (c: string): number | null => eco.chain.coins.get(c)!.owner;
  const frankIns = tx.inputs.filter((c) => owner(c) === 5);
  const ivanIns = tx.inputs.filter((c) => owner(c) === 8);
  assert.equal(frankIns.length, 2);
  assert.equal(ivanIns.length, 2);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  // each side linked — inputs and outputs — but never across
  assert.equal(cl.rep.get(frankIns[0]!), cl.rep.get(frankIns[1]!));
  assert.notEqual(cl.rep.get(frankIns[0]!), cl.rep.get(ivanIns[0]!));
  for (const o of tx.outputs) {
    const side = owner(o) === 5 ? frankIns[0]! : ivanIns[0]!;
    assert.equal(cl.rep.get(o), cl.rep.get(side), `${o} not linked to its side`);
  }
});

test("sessions form among 3+ strangers spanning communities, several coins each", () => {
  const eco = eco115();
  const sessions = [...eco.coinjoins.keys()].filter((tid) => tid !== eco.naiveTid);
  assert.ok(sessions.length >= 3, `only ${sessions.length} sessions by day 115`);
  let multi = 0;
  for (const tid of sessions) {
    const tx = eco.chain.txs.get(tid)!;
    const owners = tx.inputs.map((c) => eco.chain.coins.get(c)!.owner as number);
    const users = new Set(owners);
    assert.ok(users.size >= 3, `${tid}: fewer than three parties`);
    for (const u of users) {
      const mine = owners.filter((w) => w === u).length;
      assert.ok(mine >= 1 && mine <= 3, `${tid}: participant ${u} spends ${mine} coins`);
      if (mine >= 2) multi += 1;
    }
    assert.ok(new Set([...users].map((u) => PERSONAS[u]!.community)).size >= 2, `${tid}: not cross-community`);
    for (const u of users) assert.ok(PERSONAS[u]!.stats.privacy > 0, `${tid}: careless participant`);
  }
  // the point of joining with several coins: fragments consolidate inside
  // the session, where the grouping is hidden, instead of in a naked
  // sweep later — single-input-per-user sessions would force exactly the
  // consolidations the intersection chapter warns about
  assert.ok(multi >= 1, "no participant ever defragments inside a session");
});

test("session outputs: denominations from the menu plus one change each", () => {
  const eco = eco115();
  for (const tid of eco.coinjoins.keys()) {
    if (tid === eco.naiveTid) continue;
    const tx = eco.chain.txs.get(tid)!;
    const parts = new Set(tx.inputs.map((c) => eco.chain.coins.get(c)!.owner as number));
    const changes = new Map<number, number>();
    for (const id of tx.outputs) {
      const c = eco.chain.coins.get(id)!;
      if (c.label === "denominated" || c.label?.endsWith("(denominated)")) {
        assert.ok(isDenomination(c.value), `${id}: ${c.value} not on the menu`);
      }
      if (c.label === "coinjoin change") {
        changes.set(c.owner as number, (changes.get(c.owner as number) ?? 0) + 1);
      }
    }
    for (const u of parts) assert.equal(changes.get(u), 1, `${tid}: participant ${u} takes one change`);
  }
});

test("most sessions are PROVEN ambiguous; the density is recorded", () => {
  // before the multiset-quotient enumerator, realistic sessions came
  // back inconclusive (honest abstention); now the readings are
  // exhibited, and the tutorial's claim of several balanced readings
  // rests on a proof, not a presumption
  const eco = eco115();
  const sessions = [...eco.coinjoins.entries()].filter(([tid]) => tid !== eco.naiveTid);
  const proven = sessions.filter(([, cj]) => cj.verdict === "ambiguous");
  assert.ok(proven.length >= sessions.length / 2, `only ${proven.length}/${sessions.length} proven ambiguous`);
  assert.ok(proven.some(([, cj]) => cj.density >= 0.5), "no dense session for the tutorial to frame");
  const naive = eco.coinjoins.get(eco.naiveTid!)!;
  for (const [, cj] of proven) assert.ok(cj.density > naive.density, "sessions must out-dense the careless join");
});

test("a proven-ambiguous session exists by the chapter's day on every tutorial seed", () => {
  // sibling of the careless-values guarantee above: the
  // "many plausible pasts" step (minDay 100) narrates several balanced
  // readings, so a session carrying that verdict must exist by then on
  // every seed the tutorial and tests reach — prose and world must not
  // diverge
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(100);
    const proven = [...eco.coinjoins.entries()]
      .filter(([tid, cj]) => tid !== eco.naiveTid && cj.verdict === "ambiguous");
    assert.ok(proven.length >= 1, `${seed}: no proven-ambiguous session by day 100`);
  }
});

test("an underdetermined coinjoin earns no links from the observer", () => {
  // hand-built: three strangers, everyone takes the same denomination
  const c = new Chain();
  c.addRoot("a", 800_000, 0);
  c.addRoot("b", 900_000, 1);
  c.addRoot("d", 1_000_000, 2);
  const fee = txfee(3, 6, 1);
  const share = Math.floor(fee / 3);
  const rem = fee - share * 3;
  c.addTx("cj", 1, ["a", "b", "d"], [
    { owner: 0, value: 500_000 }, { owner: 0, value: 300_000 - share },
    { owner: 1, value: 500_000 }, { owner: 1, value: 400_000 - share },
    { owner: 2, value: 500_000 }, { owner: 2, value: 500_000 - share - rem },
  ], 1);
  const cl = clusterObserver(c);
  assert.notEqual(cl.rep.get("a"), cl.rep.get("b"));
  assert.notEqual(cl.rep.get("b"), cl.rep.get("d"));
  assert.notEqual(cl.rep.get("a"), cl.rep.get("d"));
  for (const o of c.txs.get("cj")!.outputs) {
    assert.equal(cl.members.get(cl.rep.get(o)!)!.length, 1, `${o} linked to something`);
  }
});

test("payments ride along: denominated, to a payee outside the session", () => {
  const eco = eco115();
  const pays = eco.events.filter((e) => e.form === "coinjoin" && e.payee !== null);
  assert.ok(pays.length >= 1, "no inline payment by day 115");
  for (const ev of pays) {
    const tx = eco.chain.txs.get(ev.tid)!;
    const inOwners = new Set(tx.inputs.map((c) => eco.chain.coins.get(c)!.owner));
    assert.ok(inOwners.has(ev.payer), `${ev.tid}: payer not a participant`);
    assert.ok(!inOwners.has(ev.payee), `${ev.tid}: payee must be outside the session`);
    const received = tx.outputs.filter((c) => eco.chain.coins.get(c)!.owner === ev.payee);
    assert.ok(received.length >= 1 && received.length <= 6, `${ev.tid}: ${received.length} payment outputs`);
    if (received.length > 1) {
      for (const id of received) {
        assert.ok(isDenomination(eco.chain.coins.get(id)!.value), `${id}: payment part off the menu`);
      }
    }
  }
});

test("a coinjoin insider is nearly as blind as an outsider", () => {
  const c = new Chain();
  c.addRoot("a", 800_000, 0);
  c.addRoot("b", 900_000, 1);
  c.addRoot("d", 1_000_000, 2);
  const fee = txfee(3, 6, 1);
  const share = Math.floor(fee / 3);
  const rem = fee - share * 3;
  // participant 0 pays owner 3 (outside the session) 200_000 inline
  c.addTx("cj", 1, ["a", "b", "d"], [
    { owner: 3, value: 200_000, label: "an invoice (denominated)" },
    { owner: 0, value: 600_000 - share },
    { owner: 1, value: 500_000 }, { owner: 1, value: 400_000 - share },
    { owner: 2, value: 500_000 }, { owner: 2, value: 500_000 - share - rem },
  ], 1);
  const events: EconomyEvent[] = [
    { tid: "cj", day: 1, payer: 0, payee: 3, memo: "an invoice", form: "coinjoin", why: "" },
  ];
  // the payer knows the session and where their payment went — nothing else
  const k0 = agentKnowledge(c, events, 0, undefined, ["cj"]);
  assert.ok(k0.txs.has("cj"));
  assert.deepEqual(k0.coins.get("cjo1"), { owner: 3, direct: true });
  assert.equal(k0.coins.get("b"), undefined, "co-participant's input attributed");
  assert.equal(k0.coins.get("cjo3"), undefined, "co-participant's output attributed");
  // a participant not on the payment knows the session, and nothing more
  const k1 = agentKnowledge(c, events, 1, undefined, ["cj"]);
  assert.ok(k1.txs.has("cj"));
  assert.equal(k1.coins.get("a"), undefined);
  assert.equal(k1.coins.get("d"), undefined);
  assert.equal(k1.coins.get("cjo1"), undefined, "the payment is not theirs to attribute");
});

test("wealth is conserved through the coinjoin era, less fees", () => {
  const eco = eco115();
  const fees = [...eco.chain.txs.values()].reduce((s, t) => s + t.fee, 0);
  const total = eco.chain.utxos().reduce((s, c) => s + c.value, 0);
  const roots = [...eco.chain.coins.values()].filter((c) => c.producer === null)
    .reduce((s, c) => s + c.value, 0);
  assert.equal(total + fees, roots);
});

test("the re-meeting exhibit is stageable on every tutorial seed at the step's day (#105)", () => {
  // "The same stranger twice" opens on a session several of whose
  // inputs came from one earlier session. The step lands at minDay 105
  // and the chapter runs on past 115 — at both days every seed must
  // offer a group that really is one participant's (the step must not
  // open on a coincidence) with a conclusive regrouped verdict
  for (const seed of ["welcome", "golden", "gamma", "alpha", "silver"]) {
    for (const day of [105, 115]) {
      const eco = new Economy(seed);
      eco.runTo(day);
      const chain = eco.chain;
      const ex = remeetExhibit(chain, (id) => chain.coins.get(id)?.owner ?? null);
      assert.ok(ex, `${seed}@${day}: no re-meeting exhibit`);
      assert.ok(ex!.coins.length >= 2, `${seed}@${day}: group of ${ex!.coins.length}`);
      const owners = new Set(ex!.coins.map((c) => chain.coins.get(c)!.owner));
      assert.equal(owners.size, 1, `${seed}@${day}: featured group mixes owners`);
      assert.notEqual(ex!.grouped, "inconclusive",
        `${seed}@${day}: regrouped verdict should be conclusive`);
      // the displayed facts are the observer's own: the coins really
      // are inputs of tid issued by via, and both carry session shape
      const tx = chain.txs.get(ex!.tid)!;
      for (const c of ex!.coins) {
        assert.ok(tx.inputs.includes(c), `${seed}@${day}: ${c} not an input of ${ex!.tid}`);
        assert.equal(chain.coins.get(c)!.producer, ex!.via);
      }
      assert.ok(sessionShape(chain, ex!.tid) && sessionShape(chain, ex!.via));
    }
  }
});
