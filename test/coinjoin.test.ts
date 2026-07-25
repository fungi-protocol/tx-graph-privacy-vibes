import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { Economy, COINJOIN_DAY, type EconomyEvent } from "../src/engine/economy";
import { PERSONAS } from "../src/scenario/cast";
import { clusterObserver } from "../src/analysis/clusters";
import { agentKnowledge } from "../src/analysis/knowledge";
import { isDenomination } from "../src/denom/denominations";

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
  // each side welded — inputs and outputs — but never across
  assert.equal(cl.rep.get(frankIns[0]!), cl.rep.get(frankIns[1]!));
  assert.notEqual(cl.rep.get(frankIns[0]!), cl.rep.get(ivanIns[0]!));
  for (const o of tx.outputs) {
    const side = owner(o) === 5 ? frankIns[0]! : ivanIns[0]!;
    assert.equal(cl.rep.get(o), cl.rep.get(side), `${o} not welded to its side`);
  }
});

test("sessions form among 3+ strangers spanning communities, one coin each", () => {
  const eco = eco115();
  const sessions = [...eco.coinjoins.keys()].filter((tid) => tid !== eco.naiveTid);
  assert.ok(sessions.length >= 3, `only ${sessions.length} sessions by day 115`);
  for (const tid of sessions) {
    const tx = eco.chain.txs.get(tid)!;
    const owners = tx.inputs.map((c) => eco.chain.coins.get(c)!.owner as number);
    assert.ok(owners.length >= 3, `${tid}: fewer than three parties`);
    assert.equal(new Set(owners).size, owners.length, `${tid}: one coin per participant`);
    assert.ok(new Set(owners.map((u) => PERSONAS[u]!.community)).size >= 2, `${tid}: not cross-community`);
    for (const u of owners) assert.ok(PERSONAS[u]!.stats.privacy > 0, `${tid}: careless participant`);
  }
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

test("most sessions come out underdetermined; the density is recorded", () => {
  const eco = eco115();
  const sessions = [...eco.coinjoins.entries()].filter(([tid]) => tid !== eco.naiveTid);
  const under = sessions.filter(([, cj]) => !cj.determined);
  assert.ok(under.length >= sessions.length / 2, `only ${under.length}/${sessions.length} underdetermined`);
  assert.ok(under.some(([, cj]) => cj.density >= 0.5), "no dense session for the tutorial to frame");
  const naive = eco.coinjoins.get(eco.naiveTid!)!;
  for (const [, cj] of under) assert.ok(cj.density > naive.density, "sessions must out-dense the careless join");
});

test("an underdetermined coinjoin earns no welds from the observer", () => {
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
    assert.equal(cl.members.get(cl.rep.get(o)!)!.length, 1, `${o} welded to something`);
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
