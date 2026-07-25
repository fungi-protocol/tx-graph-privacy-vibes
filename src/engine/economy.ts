// The neighborhood economy, one timestep ("day") at a time, derived
// deterministically from the seed. Internal obligations carry deadlines;
// each day the payer weighs its options — wait, pay unilaterally, or
// (once the neighborhood learns the trick) payjoin with the payee — via
// the simple legible cost terms in agents/decide.ts. External purchases
// are impulse buys, paid unilaterally on the spot.
import { Chain, type CoinId } from "../model/chain";
import { txfee } from "../core/sats";
import { Rng } from "../core/prng";
import { PERSONAS, CARELESS } from "../scenario/cast";
import { chooseWeighted, feeCost, naiveCost, hassleCost, urgencyCost, type CostedPlan } from "../agents/decide";

export type PaymentForm = "unilateral" | "payjoin" | "settlement";

export interface EconomyEvent {
  tid: string;
  day: number;
  payer: number;
  /** participant index, or null for an external merchant */
  payee: number | null;
  memo: string;
  form: PaymentForm;
  /** narrative rationale shown in the inspector */
  why: string;
}

export interface Obligation {
  payer: number;
  payee: number;
  memo: string;
  /** dollars, rounded to $10 like invoices and rent */
  usd: number;
  /** pay by this day */
  due: number;
}

/** the day the neighborhood learns payjoin exists */
export const PAYJOIN_DAY = 30;
/** the day the neighborhood starts settling offsetting obligations together */
export const SETTLE_DAY = 60;

// directed, flavored community edges: who tends to owe whom, and for what
const EDGES: { payer: number; payee: number; memos: [string, number, number][] }[] = [
  // community 0 — Alice (salaried), Bob (handyman), Carol (careless), Dave (web dev)
  { payer: 0, payee: 1, memos: [["door repair", 80, 240], ["shelf install", 60, 180]] },
  { payer: 0, payee: 3, memos: [["portfolio site", 200, 600]] },
  { payer: 2, payee: 1, memos: [["leaky faucet", 60, 150]] },
  { payer: 2, payee: 3, memos: [["blog setup", 150, 400]] },
  { payer: 3, payee: 1, memos: [["office shelving", 100, 300]] },
  { payer: 1, payee: 3, memos: [["booking page", 150, 450]] },
  // community 1 — Erin (freelancer), Frank (photographer), Grace (bike shop)
  { payer: 6, payee: 4, memos: [["freelance invoice", 300, 900]] },
  { payer: 6, payee: 5, memos: [["product photos", 150, 500]] },
  { payer: 5, payee: 6, memos: [["bike parts", 40, 200]] },
  { payer: 4, payee: 6, memos: [["commuter tune-up", 50, 120]] },
  // community 2 — Heidi (potter/landlord), Ivan (carpenter), Judy (designer)
  { payer: 9, payee: 7, memos: [["studio rent", 850, 850]] },
  { payer: 7, payee: 8, memos: [["display shelves", 200, 500]] },
  { payer: 8, payee: 9, memos: [["logo design", 150, 350]] },
  { payer: 9, payee: 8, memos: [["exhibition frames", 100, 250]] },
  { payer: 7, payee: 9, memos: [["shop website", 250, 600]] },
];

const EXTERNAL_MEMOS: [string, number, number][] = [
  ["groceries", 30, 140], ["hardware store", 8, 90], ["dinner out", 25, 85],
  ["online order", 15, 150], ["fuel", 35, 70], ["subscription", 5, 20],
];

function why(payer: number, payee: number | null, form: PaymentForm, day: number): string {
  const p = PERSONAS[payer]!;
  if (form === "payjoin") {
    return `${p.name} and ${PERSONAS[payee!]!.name} sign one transaction ` +
      "together: the payee contributes a coin of their own, so the payment " +
      "hides inside what looks like an ordinary spend.";
  }
  if (payer === CARELESS) {
    return "Carol pays straight from coins that chain back to her " +
      "identified withdrawal — she sees no problem.";
  }
  if (payee === null) {
    return `${p.name} pays a merchant unilaterally; the purchase joins the ` +
      "same history as everything else in the wallet.";
  }
  return day < PAYJOIN_DAY
    ? `${p.name} has no better option yet: the payment and its change both ` +
      "link this obligation to the rest of the wallet's history."
    : `${p.name} pays unilaterally this time — coordinating wasn't worth ` +
      "the bother today, and the link goes on the record.";
}

export interface EconomyParams {
  /** expected obligations per community edge per day */
  oblRate: number;
  /** expected external purchases per person per day */
  extRate: number;
}

export const DEFAULT_PARAMS: EconomyParams = { oblRate: 0.09, extRate: 0.05 };

export class Economy {
  chain = new Chain();
  events: EconomyEvent[] = [];
  day = 0;
  /** public exchange-rate history, USD per BTC, indexed by day */
  prices: number[] = [];
  /** obligations awaiting payment */
  pending: Obligation[] = [];
  private txn = 0;
  private rng: Rng;
  private price: number; // USD per BTC, drifts
  private feebase: number;

  constructor(seed: string, private params: EconomyParams = DEFAULT_PARAMS) {
    this.rng = new Rng(`${seed}/economy`);
    this.price = 103_000 + this.rng.next() * 3_000;
    this.feebase = 1 + this.rng.next() * 2;
    this.prices.push(this.price);
    let rc = 0;
    PERSONAS.forEach((p, u) => {
      for (const v of p.roots) {
        rc += 1;
        // Carol's origin is the one identified root in the story
        this.chain.addRoot(`r${rc}`, v, u, u === CARELESS ? "exchange withdrawal" : "savings");
      }
    });
  }

  private sats(usd: number): number {
    return Math.round((usd * 1e8) / this.price);
  }

  private wallet(u: number): CoinId[] {
    return this.chain.utxos().filter((c) => c.owner === u).map((c) => c.id);
  }

  /** smallest-sufficient single coin, else the two largest; covers target + fee + dust change */
  private select(u: number, target: number, feerate: number, extraIn = 0): CoinId[] | null {
    const coins = this.wallet(u)
      .map((id) => this.chain.coins.get(id)!)
      .sort((a, b) => b.value - a.value);
    const need1 = target + txfee(1 + extraIn, 2, feerate) + 294;
    const single = [...coins].reverse().find((c) => c.value >= need1);
    if (single) return [single.id];
    const need2 = target + txfee(2 + extraIn, 2, feerate) + 294;
    if (coins.length >= 2 && coins[0]!.value + coins[1]!.value >= need2) {
      return [coins[0]!.id, coins[1]!.id];
    }
    return null;
  }

  private unilateral(payer: number, payee: number | null, value: number, memo: string, feerate: number): boolean {
    const inputs = this.select(payer, value, feerate);
    if (!inputs) return false;
    const inValue = inputs.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0);
    const fee = txfee(inputs.length, 2, feerate);
    this.txn += 1;
    const tid = `t${this.txn}`;
    this.chain.addTx(tid, this.day, inputs, [
      { owner: payee, value, label: memo },
      { owner: payer, value: inValue - value - fee, label: "change" },
    ], feerate, `${PERSONAS[payer]!.name} pays ${payee === null ? "a merchant" : PERSONAS[payee]!.name} — ${memo}`);
    this.events.push({ tid, day: this.day, payer, payee, memo, form: "unilateral", why: why(payer, payee, "unilateral", this.day) });
    return true;
  }

  /** the payee contributes a coin of their own; payer funds payment + fee */
  private payjoin(payer: number, payee: number, value: number, memo: string, feerate: number): boolean {
    const contributed = this.wallet(payee)
      .map((id) => this.chain.coins.get(id)!)
      .sort((a, b) => a.value - b.value)[0];
    if (!contributed) return false;
    const inputs = this.select(payer, value, feerate, 1);
    if (!inputs) return false;
    const inValue = inputs.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0);
    const fee = txfee(inputs.length + 1, 2, feerate);
    this.txn += 1;
    const tid = `t${this.txn}`;
    this.chain.addTx(tid, this.day, [...inputs, contributed.id], [
      { owner: payee, value: value + contributed.value, label: `${memo} + own coin` },
      { owner: payer, value: inValue - value - fee, label: "change" },
    ], feerate, `${PERSONAS[payer]!.name} pays ${PERSONAS[payee]!.name} — ${memo} (payjoin)`);
    this.events.push({ tid, day: this.day, payer, payee, memo, form: "payjoin", why: why(payer, payee, "payjoin", this.day) });
    return true;
  }

  /**
   * The oracle: find offsetting pending obligations that three (or two
   * mutually indebted) participants could settle in one transaction.
   * Coalitions simply arrive at a favorable structure — no negotiation
   * is modeled. Prefers a 3-cycle, then a mutual pair, then a chain of
   * two obligations through a middle participant. Anyone who sees no
   * privacy benefit (privacy 0) never bothers coordinating.
   */
  private findSettlements(): Obligation[][] {
    const ok = (o: Obligation): boolean =>
      PERSONAS[o.payer]!.stats.privacy > 0 && PERSONAS[o.payee]!.stats.privacy > 0;
    const os = this.pending.filter(ok);
    const found: Obligation[][] = [];
    // 3-cycles: Alice pays Bob, Bob pays Carol, Carol pays Alice
    for (const a of os) for (const b of os) for (const c of os) {
      if (a.payee !== b.payer || b.payee !== c.payer || c.payee !== a.payer) continue;
      if (new Set([a.payer, b.payer, c.payer]).size !== 3) continue;
      found.push([a, b, c]);
    }
    // mutual pairs: two parties owing each other
    for (const a of os) for (const b of os) {
      if (a === b || a.payer !== b.payee || a.payee !== b.payer) continue;
      if (a.payer < b.payer) found.push([a, b]);
    }
    // chains: two obligations through a middle participant, three parties
    for (const a of os) for (const b of os) {
      if (a.payee !== b.payer || a.payer === b.payee) continue;
      found.push([a, b]);
    }
    return found;
  }

  /**
   * Settle a group of obligations in one transaction. Every participant
   * contributes one coin and takes one output; only the net balances
   * touch the chain. How much that hides depends on the shape: in a
   * cycle no obligation amount appears anywhere, while a chain's
   * endpoints still move roughly their gross amounts.
   */
  private settlement(obls: Obligation[], feerate: number): boolean {
    const parts = [...new Set(obls.flatMap((o) => [o.payer, o.payee]))];
    const net = new Map<number, number>(parts.map((u) => [u, 0]));
    for (const o of obls) {
      const v = this.sats(o.usd);
      net.set(o.payer, net.get(o.payer)! - v);
      net.set(o.payee, net.get(o.payee)! + v);
    }
    const n = parts.length;
    // coins per participant: the smallest single coin that covers their
    // net-out plus fee share, else their two largest together. The fee
    // depends on the input count, so settle it in two passes.
    let coins = new Map<number, CoinId[]>();
    let fee = 0;
    let shareOf: (u: number) => number = () => 0;
    let assumed = n;
    for (let pass = 0; pass < 4; pass++) {
      fee = txfee(assumed, n, feerate);
      const share = Math.floor(fee / n);
      // the biggest net payer covers the rounding remainder
      const biggest = parts.reduce((a, b) => (net.get(a)! <= net.get(b)! ? a : b));
      shareOf = (u: number): number => share + (u === biggest ? fee - share * n : 0);
      coins = new Map<number, CoinId[]>();
      for (const u of parts) {
        const need = -Math.min(0, net.get(u)!) + shareOf(u) + 294;
        const mine = this.wallet(u)
          .map((id) => this.chain.coins.get(id)!)
          .sort((a, b) => b.value - a.value);
        const single = [...mine].reverse().find((c) => c.value >= need);
        if (single) coins.set(u, [single.id]);
        else if (mine.length >= 2 && mine[0]!.value + mine[1]!.value >= need) {
          coins.set(u, [mine[0]!.id, mine[1]!.id]);
        } else return false;
      }
      const actual = [...coins.values()].reduce((s, c) => s + c.length, 0);
      if (actual === assumed) break;
      assumed = actual;
      if (pass === 3) return false; // did not converge; give up cleanly
    }
    this.txn += 1;
    const tid = `t${this.txn}`;
    const names = parts.map((u) => PERSONAS[u]!.name);
    const inValue = (u: number): number =>
      coins.get(u)!.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0);
    this.chain.addTx(tid, this.day,
      parts.flatMap((u) => coins.get(u)!),
      parts.map((u) => ({
        owner: u,
        value: inValue(u) + net.get(u)! - shareOf(u),
        label: "after settling up",
      })),
      feerate, `${names.join(", ")} settle up — ${obls.length} obligations (net settlement)`);
    // honest, shape-aware rationale: a pair hides nothing from its two
    // insiders, a chain's endpoint nets stay close to their gross
    // obligations, and only a cycle makes the amounts truly vanish
    const why =
      n === 2
        ? `${names.join(" and ")} settle their mutual debts in one spend. ` +
          "Outsiders see only the difference of the two obligations; between " +
          "the two of them nothing is hidden — privacy within a transaction " +
          "takes three or more parties."
        : obls.length === n
          ? `${names.join(", ")} settle a full cycle of obligations in a single ` +
            "transaction. Only their net balances touch the chain; none of the " +
            "obligation amounts appear anywhere. Outsiders see one transaction; " +
            "each insider can still work out the edge they are not on."
          : `${names.join(", ")} settle ${obls.length} obligations in a single ` +
            "transaction. Only net balances touch the chain — though the " +
            "endpoints' nets stay close to what they owed — and each insider " +
            "can still work out the edge they are not on.";
    for (const o of obls) {
      this.events.push({ tid, day: this.day, payer: o.payer, payee: o.payee, memo: o.memo, form: "settlement", why });
    }
    return true;
  }

  /** weigh wait / unilateral / payjoin for one pending obligation */
  private settle(obl: Obligation): boolean {
    const p = PERSONAS[obl.payer]!;
    const value = this.sats(obl.usd);
    const feerate = Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2));
    type Act = "wait" | "unilateral" | "payjoin";
    const plans: CostedPlan<Act>[] = [];
    if (obl.due > this.day) {
      const urgency = urgencyCost(obl.due - this.day);
      plans.push({ plan: "wait", cost: urgency, terms: { urgency } });
    }
    {
      const fee = feeCost(p, txfee(1, 2, feerate));
      const naive = naiveCost(p);
      plans.push({ plan: "unilateral", cost: fee + naive, terms: { fee, naive } });
    }
    // someone who sees no privacy benefit never bothers coordinating
    if (this.day >= PAYJOIN_DAY && p.stats.privacy > 0 && this.wallet(obl.payee).length > 0) {
      const fee = feeCost(p, txfee(2, 2, feerate));
      const hassle = hassleCost(p);
      plans.push({ plan: "payjoin", cost: fee + hassle, terms: { fee, hassle } });
    }
    const chosen = chooseWeighted(this.rng, plans);
    if (chosen.plan === "wait") return false;
    if (chosen.plan === "payjoin" && this.payjoin(obl.payer, obl.payee, value, obl.memo, feerate)) return true;
    return this.unilateral(obl.payer, obl.payee, value, obl.memo, feerate);
  }

  /** advance one day; returns the events it produced */
  step(): EconomyEvent[] {
    this.day += 1;
    const before = this.events.length;
    // markets drift
    this.price = Math.min(110_000, Math.max(101_000, this.price * (1 + (this.rng.next() - 0.48) * 0.01)));
    this.feebase = Math.min(8, Math.max(0.8, this.feebase * (1 + (this.rng.next() - 0.5) * 0.2)));
    this.prices[this.day] = this.price;

    // new internal obligations arrive with a few days' notice
    for (const edge of EDGES) {
      const n = this.rng.poisson(this.params.oblRate);
      for (let i = 0; i < n; i++) {
        const memo = this.rng.pick(edge.memos);
        const usd = memo[1] === memo[2]
          ? memo[1]
          : Math.round((memo[1] + this.rng.next() * (memo[2] - memo[1])) / 10) * 10;
        this.pending.push({
          payer: edge.payer, payee: edge.payee, memo: memo[0], usd,
          due: this.day + 2 + this.rng.int(8),
        });
      }
    }
    // rent day at the studio: the one cycle in the community graph
    // (Judy -> Heidi -> Ivan -> Judy) gets its three obligations at once,
    // so the tutorial's full-cycle settlement exists on every seed
    if (this.day === SETTLE_DAY) {
      this.pending.push(
        { payer: 9, payee: 7, memo: "studio rent", usd: 850, due: this.day + 6 },
        { payer: 7, payee: 8, memo: "display shelves", usd: Math.round((200 + this.rng.next() * 300) / 10) * 10, due: this.day + 6 },
        { payer: 8, payee: 9, memo: "logo design", usd: Math.round((150 + this.rng.next() * 200) / 10) * 10, due: this.day + 6 },
      );
    }
    // the oracle looks for offsetting obligations first (at most one
    // settlement a day; word spreads on SETTLE_DAY). Groups that cannot
    // fund their nets are skipped, not retried forever. A full cycle is
    // never passed up — it is unambiguously favorable to everyone.
    if (this.day >= SETTLE_DAY) {
      const gate = this.rng.next() < 0.6;
      const groups = this.findSettlements();
      const feerate = Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2));
      for (const group of groups) {
        if (!gate && group.length < 3) continue;
        if (this.settlement(group, feerate)) {
          this.pending = this.pending.filter((o) => !group.includes(o));
          break;
        }
      }
    }
    // each payer weighs its pending obligations; unpayable ones slip a day
    this.pending = this.pending.filter((obl) => {
      const paid = this.settle(obl);
      if (!paid && obl.due <= this.day) obl.due = this.day + 1;
      return !paid;
    });
    // external purchases: unrounded retail prices, paid on the spot
    for (let u = 0; u < PERSONAS.length; u++) {
      const n = this.rng.poisson(this.params.extRate);
      for (let i = 0; i < n; i++) {
        const memo = this.rng.pick(EXTERNAL_MEMOS);
        const usd = memo[1] + this.rng.next() * (memo[2] - memo[1]);
        // impulse buys sometimes pay up in a fee spike rather than wait
        const impatient = this.rng.next() < 0.15;
        const feerate = Number((this.feebase * (impatient ? 3 + this.rng.next() * 6 : 0.8 + this.rng.next() * 0.6)).toFixed(2));
        this.unilateral(u, null, this.sats(Math.round(usd * 100) / 100), memo[0], feerate);
      }
    }
    return this.events.slice(before);
  }

  /** run until the given day (idempotent fast-forward for fragment restore) */
  runTo(day: number): void {
    while (this.day < day) this.step();
  }
}
