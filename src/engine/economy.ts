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

export type PaymentForm = "unilateral" | "payjoin";

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
