// The neighborhood economy, one timestep ("day") at a time, derived
// deterministically from the seed. Internal obligations carry deadlines;
// each day the payer weighs its options — wait, pay unilaterally, or
// (once the neighborhood learns the trick) payjoin with the payee — via
// the simple legible cost terms in agents/decide.ts. External purchases
// are impulse buys, paid unilaterally on the spot. From SETTLE_DAY an
// oracle nets offsetting obligations into settlements; from COINJOIN_DAY
// strangers spanning communities coinjoin with denominated outputs.
import { Chain, type CoinId, type TxId } from "../model/chain";
import { txfee } from "../core/sats";
import { Rng } from "../core/prng";
import { PERSONAS, CARELESS, BASE_POP, MAX_POP, buildCast, type Persona, type Edge } from "../scenario/cast";
import { chooseWeighted, feeCost, naiveCost, hassleCost, urgencyCost, type CostedPlan } from "../agents/decide";
import { decomps, radixBelow } from "../denom/denominations";
import { subsetSums, ambiguity, subTransactionMapping } from "../analysis/subsetsum";
import { ancestry } from "../analysis/ancestry";

export type PaymentForm = "unilateral" | "payjoin" | "settlement" | "coinjoin";

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
/** the day word crosses community lines: strangers can share a transaction */
export const COINJOIN_DAY = 90;
/** the day somebody consolidates coins from two different sessions */
export const INTERSECT_DAY = 112;
/** the day the studio's rent falls due again — the playable moment */
export const GAME_DAY = 118;

const EXTERNAL_MEMOS: [string, number, number][] = [
  ["groceries", 30, 140], ["hardware store", 8, 90], ["dinner out", 25, 85],
  ["online order", 15, 150], ["fuel", 35, 70], ["subscription", 5, 20],
];

function why(cast: Persona[], payer: number, payee: number | null, form: PaymentForm, day: number): string {
  const p = cast[payer]!;
  if (form === "payjoin") {
    return `${p.name} and ${cast[payee!]!.name} sign one transaction ` +
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
  /** fee-market level: multiplies the drifting base feerate */
  feeLevel: number;
  /** fee-market volatility: scales the daily feerate drift */
  feeVol: number;
  /** initial wealth: multiplies everyone's starting coins */
  wealth: number;
  /** town population: 10 is the fixed cast; 11–14 add the archetypes,
   *  beyond that seeded townsfolk (clamped to MAX_POP) */
  pop: number;
}

export const DEFAULT_PARAMS: EconomyParams = {
  oblRate: 0.09, extRate: 0.05, feeLevel: 1, feeVol: 1, wealth: 1, pop: BASE_POP,
};

/** which manual plans the played agent can pick from */
export type ManualPlan = "wait" | "unilateral" | "payjoin";

/** one recorded manual choice, replayed verbatim on fragment restore */
export interface Intervention {
  day: number;
  payer: number;
  memo: string;
  due: number;
  plan: ManualPlan;
}

export class Economy {
  chain = new Chain();
  events: EconomyEvent[] = [];
  day = 0;
  /** public exchange-rate history, USD per BTC, indexed by day */
  prices: number[] = [];
  /** obligations awaiting payment */
  pending: Obligation[] = [];
  /** coinjoin transactions, in order: subset-sum match rate, and whether
   *  the amounts pin down a unique sub-transaction mapping */
  coinjoins = new Map<TxId, { density: number; determined: boolean }>();
  /** the first, carelessly valued coinjoin (injected on COINJOIN_DAY) */
  naiveTid: TxId | undefined;
  /** the played agent, if any: their obligations follow recorded choices, not the dice */
  manual: number | null = null;
  /** the day the player took over — earlier days replay under the dice, so
   *  a restored fragment reproduces the run no matter when play began */
  manualFrom = 0;
  /** the played agent's choices, replayed verbatim for deterministic restore */
  interventions: Intervention[] = [];
  readonly params: EconomyParams;
  /** the town: the fixed ten, plus archetypes/townsfolk when pop > 10 */
  readonly cast: Persona[];
  private edges: Edge[];
  private consumed = new Set<Intervention>();
  private txn = 0;
  private rng: Rng;
  private price: number; // USD per BTC, drifts
  private feebase: number;

  constructor(seed: string, params: Partial<EconomyParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    const town = buildCast(seed, this.params.pop);
    this.cast = town.personas;
    this.edges = town.edges;
    this.rng = new Rng(`${seed}/economy`);
    this.price = 103_000 + this.rng.next() * 3_000;
    this.feebase = (1 + this.rng.next() * 2) * this.params.feeLevel;
    this.prices.push(this.price);
    let rc = 0;
    this.cast.forEach((p, u) => {
      for (const v of p.roots) {
        rc += 1;
        // Carol's origin is the one identified root in the story
        this.chain.addRoot(`r${rc}`, Math.round(v * this.params.wealth), u,
          p.rootLabel ?? (u === CARELESS ? "exchange withdrawal" : "savings"));
      }
    });
  }

  private sats(usd: number): number {
    return Math.round((usd * 1e8) / this.price);
  }

  private wallet(u: number): CoinId[] {
    return this.chain.utxos().filter((c) => c.owner === u).map((c) => c.id);
  }

  /** smallest-sufficient single coin, else the largest coins together (a
   *  consolidation — the ⚠ kind), up to six; covers target + fee + dust change */
  private select(u: number, target: number, feerate: number, extraIn = 0, outs = 2): CoinId[] | null {
    const coins = this.wallet(u)
      .map((id) => this.chain.coins.get(id)!)
      .sort((a, b) => b.value - a.value);
    const need1 = target + txfee(1 + extraIn, outs, feerate) + 294;
    const single = [...coins].reverse().find((c) => c.value >= need1);
    if (single) return [single.id];
    const picked: CoinId[] = [];
    let sum = 0;
    for (const c of coins.slice(0, 6)) {
      picked.push(c.id);
      sum += c.value;
      if (picked.length >= 2 &&
          sum >= target + txfee(picked.length + extraIn, outs, feerate) + 294) return picked;
    }
    return null;
  }

  /**
   * A batching desk pays several obligations in one transaction: one
   * output per payee plus change. Cheap — and one record publishes the
   * whole payout list: amounts side by side from the desk's coins, and
   * each recipient can look up everyone else the desk paid that day.
   */
  private batchPay(payer: number, obls: Obligation[], feerate: number): boolean {
    const values = obls.map((o) => this.sats(o.usd));
    const total = values.reduce((a, b) => a + b, 0);
    const inputs = this.select(payer, total, feerate, 0, obls.length + 1);
    if (!inputs) return false;
    const inValue = inputs.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0);
    const fee = txfee(inputs.length, obls.length + 1, feerate);
    this.txn += 1;
    const tid = `t${this.txn}`;
    const name = this.cast[payer]!.name;
    // the desk is the likeliest consolidator in town: same ⚠ as unilateral()
    const consolidates = new Set(inputs.map((id) => this.chain.coins.get(id)!.producer)).size > 1;
    this.chain.addTx(tid, this.day, inputs, [
      ...obls.map((o, i) => ({ owner: o.payee, value: values[i]!, label: o.memo })),
      { owner: payer, value: inValue - total - fee, label: "change" },
    ], feerate, `${name} batches ${obls.length} payouts in one transaction${consolidates ? " ⚠" : ""}`);
    this.events.push({
      tid, day: this.day, payer, payee: null,
      memo: `batch payout ×${obls.length}`, form: "unilateral",
      why: `${name} pays ${obls.length} people in a single transaction to ` +
        "save fees. One record publishes the whole payout list: every " +
        "observer sees the payout amounts side by side, all paid from the " +
        "desk's coins — and each recipient can look up the record and see " +
        "everyone else the desk paid that day." + (consolidates
          ? " ⚠ The batch also consolidates coins with separate pasts — " +
            "evidence for every observer to weld them into one."
          : ""),
    });
    return true;
  }

  private unilateral(payer: number, payee: number | null, value: number, memo: string, feerate: number): boolean {
    const inputs = this.select(payer, value, feerate);
    if (!inputs) return false;
    const inValue = inputs.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0);
    const fee = txfee(inputs.length, 2, feerate);
    this.txn += 1;
    const tid = `t${this.txn}`;
    // the Python narratives' consolidation flag carries over: spending
    // coins with separate pasts hands every observer evidence to weld them
    const consolidates = new Set(inputs.map((id) => this.chain.coins.get(id)!.producer)).size > 1;
    this.chain.addTx(tid, this.day, inputs, [
      { owner: payee, value, label: memo },
      { owner: payer, value: inValue - value - fee, label: "change" },
    ], feerate, `${this.cast[payer]!.name} pays ${payee === null ? "a merchant" : this.cast[payee]!.name} — ${memo}${consolidates ? " ⚠" : ""}`);
    this.events.push({
      tid, day: this.day, payer, payee, memo, form: "unilateral",
      why: why(this.cast, payer, payee, "unilateral", this.day) + (consolidates
        ? " ⚠ The spend consolidates coins with separate pasts — evidence for every observer to weld them into one, and proof for any counterparty who already knew either past."
        : ""),
    });
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
    ], feerate, `${this.cast[payer]!.name} pays ${this.cast[payee]!.name} — ${memo} (payjoin)`);
    this.events.push({ tid, day: this.day, payer, payee, memo, form: "payjoin", why: why(this.cast, payer, payee, "payjoin", this.day) });
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
      this.cast[o.payer]!.stats.privacy > 0 && this.cast[o.payee]!.stats.privacy > 0;
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
    const names = parts.map((u) => this.cast[u]!.name);
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

  /**
   * Day INTERSECT_DAY: the linking mistake chapter 7 narrates. A session
   * regular tidies their wallet, spending two coins whose pasts run
   * through different sessions in one transaction — the classic slip
   * wallet coin-selection makes all the time. Deliberately rng-free
   * (deterministic pick, base feerate) so the injection leaves the
   * seeded stream untouched.
   */
  private intersectSpend(): void {
    for (let u = 0; u < this.cast.length; u++) {
      // largest spendable output per session; the naive join doesn't count
      const bySession = new Map<TxId, CoinId>();
      for (const c of this.chain.utxos()) {
        if (c.owner !== u || c.producer === null || c.producer === this.naiveTid) continue;
        if (!this.coinjoins.has(c.producer)) continue;
        const prev = bySession.get(c.producer);
        if (!prev || this.chain.coins.get(prev)!.value < c.value) bySession.set(c.producer, c.id);
      }
      if (bySession.size < 2) continue;
      // pick the (largest-first) pair whose traced pasts each run through
      // a session the other never touches — the property the chapter's
      // intersection needs; consolidated wallets can share most history
      const ranked = [...bySession.values()]
        .sort((a, b) => this.chain.coins.get(b)!.value - this.chain.coins.get(a)!.value);
      const sessionsOf = (id: CoinId): Set<TxId> => {
        const a = ancestry(this.chain, id);
        return new Set([...a.txs].filter((t) => this.coinjoins.has(t)));
      };
      const past = new Map(ranked.map((id) => [id, sessionsOf(id)]));
      let picks: CoinId[] | null = null;
      outer: for (let i = 0; i < ranked.length - 1; i++) {
        for (let j = i + 1; j < ranked.length; j++) {
          const [pa, pb] = [past.get(ranked[i]!)!, past.get(ranked[j]!)!];
          if ([...pa].some((s) => !pb.has(s)) && [...pb].some((s) => !pa.has(s))) {
            picks = [ranked[i]!, ranked[j]!];
            break outer;
          }
        }
      }
      if (!picks) continue;
      const feerate = Number(this.feebase.toFixed(2));
      const fee = txfee(2, 1, feerate);
      const total = picks.reduce((s, id) => s + this.chain.coins.get(id)!.value, 0) - fee;
      if (total < 294) continue;
      this.txn += 1;
      const tid = `t${this.txn}`;
      const name = this.cast[u]!.name;
      this.chain.addTx(tid, this.day, picks, [
        { owner: u, value: total, label: "tidied-up savings" },
      ], feerate, `${name} tidies up the wallet — two coinjoined coins in one spend ⚠`);
      this.events.push({
        tid, day: this.day, payer: u, payee: null,
        memo: "tidying up the wallet", form: "unilateral",
        why: `${name} merges two coins to keep the wallet simple — but their ` +
          "pasts run through different coinjoin sessions. Anyone can now " +
          "intersect the two candidate-origin sets: the owner must sit in " +
          "both, so the candidates collapse to the overlap — usually far " +
          "smaller than either set — and each session's other participants " +
          "are thinned out by elimination.",
      });
      return;
    }
  }

  /**
   * The first coinjoin: two strangers from different communities spend
   * their coins in one transaction, no payment between them — but each
   * takes back amounts chosen carelessly (a round figure plus the rest),
   * so the only sub-transaction mapping consistent with the values is
   * the true one, and subset sums fully partition the transaction.
   */
  private naiveCoinjoin(feerate: number): void {
    const parts = [5, 8]; // Frank and Ivan: strangers, communities 1 and 2
    const coins = parts.map((u) =>
      this.wallet(u).map((id) => this.chain.coins.get(id)!).sort((a, b) => b.value - a.value).slice(0, 2));
    if (coins.some((cs) => cs.length < 2)) return;
    const gross = coins.map((cs) => cs[0]!.value + cs[1]!.value);
    const fee = txfee(4, 4, feerate);
    const share = [fee - Math.floor(fee / 2), Math.floor(fee / 2)];
    const outs: { owner: number; value: number; label: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const usd = (gross[i]! * this.price) / 1e8;
      const round = this.sats(Math.max(10, Math.floor((usd * 0.45) / 10) * 10));
      const change = gross[i]! - round - share[i]!;
      if (round < 294 || change < 294) return;
      outs.push(
        { owner: parts[i]!, value: round, label: "own funds, a round figure" },
        { owner: parts[i]!, value: change, label: "own funds, the rest" },
      );
    }
    this.txn += 1;
    const tid = `t${this.txn}`;
    const ivs = coins.flat().map((c) => c.value);
    // tolerance widened by one fee share: each party's outputs sit that
    // much below their inputs, and the analyst knows to allow for it
    const ovs = outs.map((o) => o.value);
    const density = ambiguity(ivs, ovs, 500 + Math.ceil(fee / 2));
    this.chain.addTx(tid, this.day, coins.flat().map((c) => c.id), outs, feerate,
      `Frank and Ivan coinjoin — amounts chosen carelessly; ` +
      `${Math.round(density * 100)}% of input-subset sums matched`);
    this.naiveTid = tid;
    this.coinjoins.set(tid, {
      density,
      determined: subTransactionMapping(ivs, ovs, fee).kind === "unique",
    });
    this.events.push({
      tid, day: this.day, payer: 5, payee: null, memo: "a first coinjoin", form: "coinjoin",
      why: "Frank and Ivan, strangers from different corners of town, spend " +
        "their coins in one transaction with no payment between them. But " +
        "each takes back amounts chosen carelessly, so the only " +
        "sub-transaction mapping consistent with the values is the true " +
        "one — a subset-sum analysis fully partitions the transaction.",
    });
  }

  /**
   * An oracle-formed coinjoin session: three or four strangers spanning
   * at least two communities each contribute one coin and take back
   * denominated outputs from the shared menu — one denomination plus
   * guarded change, chosen uniformly at random among the acceptable
   * splits (randomness among acceptable choices beats always-best, which
   * would let the choice itself fingerprint the chooser). A participant
   * with a pending obligation to someone outside the session can pay it
   * inline: as a single arbitrary-amount output if the amount happens to
   * be matched by other participants' coins, otherwise decomposed into
   * the same standard denominations as everyone else's outputs.
   */
  private coinjoin(parts: number[], feerate: number): boolean {
    const coin = new Map<number, { id: CoinId; value: number }>();
    for (const u of parts) {
      const best = this.wallet(u)
        .map((id) => this.chain.coins.get(id)!)
        .sort((a, b) => b.value - a.value)[0];
      if (!best || best.value < 250_000) return false;
      coin.set(u, best);
    }
    const n = parts.length;
    const ivs = parts.map((u) => coin.get(u)!.value);

    // inline payment: the first pending obligation a participant can
    // afford to settle through the session
    let pay: { obl: Obligation; outs: { owner: number; value: number; label: string }[]; paid: number } | null = null;
    for (const obl of this.pending) {
      if (!parts.includes(obl.payer) || parts.includes(obl.payee)) continue;
      const v = this.sats(obl.usd);
      if (coin.get(obl.payer)!.value < v + 170_000) continue;
      // plausibly attributable to other users' inputs? then the odd
      // amount hides as-is; otherwise fall back to radix decomposition
      const others = parts.filter((u) => u !== obl.payer).map((u) => coin.get(u)!.value);
      const near = subsetSums(others).filter((s) => Math.abs(s - v) <= 500).length;
      if (near >= 2) {
        pay = { obl, outs: [{ owner: obl.payee, value: v, label: obl.memo }], paid: v };
      } else {
        const { parts: ds } = radixBelow(v);
        if (ds.length === 0 || ds.length > 6) continue;
        pay = {
          obl,
          outs: ds.map((d) => ({ owner: obl.payee, value: d, label: `${obl.memo} (denominated)` })),
          paid: ds.reduce((s, d) => s + d, 0),
        };
      }
      break;
    }

    // each participant takes one denomination plus change (or plain
    // change), picked uniformly among the acceptable splits; the fee is
    // settled once the output count is known, with change absorbing the
    // final shares
    const payOuts = pay ? pay.outs.length : 0;
    const fee1 = txfee(n, n * 2 + payOuts, feerate);
    const target = (u: number, share: number): number =>
      coin.get(u)!.value - share - (pay && u === pay.obl.payer ? pay.paid : 0);
    const opts = new Map<number, number[][]>();
    for (const u of parts) {
      const t = target(u, Math.ceil(fee1 / n));
      if (t < 294) return false;
      opts.set(u, decomps(t, ivs));
    }
    // the oracle samples a few acceptable joint assignments and keeps the
    // best: an underdetermined mapping beats a determined one (repeating a
    // denomination another party took makes outputs swappable between
    // readings), denser subset sums break ties. Sampling rather than
    // exhaustive argmax keeps the selection itself from fingerprinting
    // anyone (always-best is a bias of its own) — and still comes out
    // unlucky now and then.
    let ds = new Map<number, number[]>();
    let bestScore = -1;
    for (let trial = 0; trial < 8; trial++) {
      const cand = new Map(parts.map((u) => [u, this.rng.pick(opts.get(u)!)]));
      const ovs = parts.flatMap((u) => {
        const d = cand.get(u)!;
        return [...d, target(u, Math.ceil(fee1 / n)) - d.reduce((s, x) => s + x, 0)];
      });
      if (pay) ovs.push(...pay.outs.map((o) => o.value));
      const underdetermined = subTransactionMapping(ivs, ovs, fee1).kind === "ambiguous";
      const score = (underdetermined ? 1 : 0) + ambiguity(ivs, ovs, 500 + Math.ceil(fee1 / n));
      if (score > bestScore) {
        bestScore = score;
        ds = cand;
      }
    }
    const nOut = parts.reduce((s, u) => s + ds.get(u)!.length + 1, 0) + payOuts;
    const fee = txfee(n, nOut, feerate);
    const share = Math.floor(fee / n);
    const biggest = parts.reduce((a, b) => (coin.get(a)!.value >= coin.get(b)!.value ? a : b));
    const shareOf = (u: number): number => share + (u === biggest ? fee - share * n : 0);
    const outs: { owner: number; value: number; label: string }[] = [];
    for (const u of parts) {
      const denoms = ds.get(u)!;
      const change = target(u, shareOf(u)) - denoms.reduce((s, d) => s + d, 0);
      if (change < 294) return false;
      for (const d of denoms) outs.push({ owner: u, value: d, label: "denominated" });
      outs.push({ owner: u, value: change, label: "coinjoin change" });
    }
    if (pay) outs.push(...pay.outs);

    this.txn += 1;
    const tid = `t${this.txn}`;
    const ovs = outs.map((o) => o.value);
    // tolerance widened by one fee share: each party's outputs sit that
    // much below their inputs, and the analyst knows to allow for it
    const density = ambiguity(ivs, ovs, 500 + Math.ceil(fee / n));
    const determined = subTransactionMapping(ivs, ovs, fee).kind === "unique";
    this.chain.addTx(tid, this.day, parts.map((u) => coin.get(u)!.id), outs, feerate,
      `coinjoin, ${n} parties — denominated outputs; ` +
      `${Math.round(density * 100)}% of input-subset sums matched` +
      (determined ? "; still, one reading balances" : "; several readings balance"));
    this.coinjoins.set(tid, { density, determined });
    // the randomness among acceptable splits sometimes comes out unlucky:
    // a session whose amounts still admit a single balanced reading bought
    // its parties little, and the narrative says so
    const unlucky = " This session came out unlucky, though: a single " +
      "reading of the amounts balances, and the cover is thin.";
    if (pay) {
      this.pending = this.pending.filter((o) => o !== pay.obl);
      const single = pay.outs.length === 1;
      this.events.push({
        tid, day: this.day, payer: pay.obl.payer, payee: pay.obl.payee,
        memo: pay.obl.memo, form: "coinjoin",
        why: `${this.cast[pay.obl.payer]!.name} pays ${this.cast[pay.obl.payee]!.name} ` +
          "inside a coinjoin among strangers. " + (determined
            ? "The denominations were meant to hide it, but the session " +
              "came out unlucky: a single reading of the amounts balances, " +
              "tying the payment back to the payer's coins."
            : single
              ? "The odd amount happens to be matched by other participants' " +
                "coins, so even as a single output it does not pin down whose " +
                "payment it was."
              : "The amount is decomposed into standard denominations, " +
                "indistinguishable from everyone else's outputs; outsiders " +
                "see only denominations that could belong to anyone.") +
          ` ${this.cast[pay.obl.payee]!.name} still knows who paid.`,
      });
    } else {
      this.events.push({
        tid, day: this.day, payer: parts[0]!, payee: null, memo: "coinjoin session", form: "coinjoin",
        why: `${parts.map((u) => this.cast[u]!.name).join(", ")} — strangers ` +
          "spanning communities — spend coins in one transaction with no " +
          "payment between them, taking back denominated outputs from a " +
          "shared menu." + (determined
            ? unlucky
            : " The coinjoin does not sever any coin's past; it makes " +
              "that past one of many plausible pasts."),
      });
    }
    return true;
  }

  /** pick 3–4 strangers spanning at least two communities, all of whom
   *  see a privacy benefit and hold a coin worth joining with */
  private pickStrangers(): number[] | null {
    const cands = this.cast
      .map((p, u) => u)
      .filter((u) => this.cast[u]!.stats.privacy > 0)
      .filter((u) => this.wallet(u).some((id) => this.chain.coins.get(id)!.value >= 250_000));
    const n = 3 + (this.rng.next() < 0.35 ? 1 : 0);
    if (cands.length < n) return null;
    const parts: number[] = [];
    while (parts.length < n) {
      const pick = cands[this.rng.int(cands.length)]!;
      if (!parts.includes(pick)) parts.push(pick);
    }
    const communities = new Set(parts.map((u) => this.cast[u]!.community));
    return communities.size >= 2 ? parts : null;
  }

  /** weigh wait / unilateral / payjoin for one pending obligation */
  /** the costed plans an obligation's payer weighs — rng-free, so the UI
   *  can preview exactly what the dice (or the player) will see */
  plansFor(obl: Obligation, feerate: number, asOf = this.day): CostedPlan<ManualPlan>[] {
    const p = this.cast[obl.payer]!;
    const plans: CostedPlan<ManualPlan>[] = [];
    if (obl.due > asOf) {
      const urgency = urgencyCost(obl.due - asOf);
      plans.push({ plan: "wait", cost: urgency, terms: { urgency } });
    }
    {
      const fee = feeCost(p, txfee(1, 2, feerate));
      const naive = naiveCost(p);
      plans.push({ plan: "unilateral", cost: fee + naive, terms: { fee, naive } });
    }
    // someone who sees no privacy benefit never bothers coordinating
    if (asOf >= PAYJOIN_DAY && p.stats.privacy > 0 && this.wallet(obl.payee).length > 0) {
      const fee = feeCost(p, txfee(2, 2, feerate));
      const hassle = hassleCost(p);
      plans.push({ plan: "payjoin", cost: fee + hassle, terms: { fee, hassle } });
    }
    return plans;
  }

  /** the played agent's pending decisions for the coming day, with the
   *  same costed plans the dice would see — rng-free (previewed at the
   *  current base feerate), so peeking never perturbs the run */
  candidates(u: number): { obl: Obligation; feerate: number; plans: CostedPlan<ManualPlan>[] }[] {
    const feerate = Number(this.feebase.toFixed(2));
    return this.pending
      .filter((o) => o.payer === u)
      .map((obl) => ({ obl, feerate, plans: this.plansFor(obl, feerate, this.day + 1) }));
  }

  /** can the wallet fund this obligation right now? (rng-free, no side effects) */
  canFund(u: number, usd: number, feerate: number, extraIn = 0): boolean {
    return this.select(u, this.sats(usd), feerate, extraIn) !== null;
  }

  /** the played agent's recorded choice for this obligation today, if any */
  private chosenFor(obl: Obligation): ManualPlan {
    const iv = this.interventions.find((i) =>
      !this.consumed.has(i) && i.day === this.day && i.payer === obl.payer &&
      i.memo === obl.memo && i.due === obl.due);
    if (iv) {
      this.consumed.add(iv);
      return iv.plan;
    }
    return "wait";
  }

  private settle(obl: Obligation): boolean {
    const value = this.sats(obl.usd);
    const feerate = Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2));
    if (obl.payer === this.manual && this.day >= this.manualFrom) {
      // the played agent rolls no dice: wait unless the player chose
      // otherwise, and pay up when the deadline arrives
      const plan = this.chosenFor(obl);
      if (plan === "payjoin" && this.day >= PAYJOIN_DAY &&
          this.payjoin(obl.payer, obl.payee, value, obl.memo, feerate)) return true;
      if (plan === "wait" && obl.due > this.day) return false;
      return this.unilateral(obl.payer, obl.payee, value, obl.memo, feerate);
    }
    // a batching desk holds every bill to its deadline, hoping to combine
    // it with others (the batch pass above runs first); a lone leftover
    // due bill is paid the ordinary way
    if (this.cast[obl.payer]!.batches) {
      if (obl.due > this.day) return false;
      return this.unilateral(obl.payer, obl.payee, value, obl.memo, feerate);
    }
    const chosen = chooseWeighted(this.rng, this.plansFor(obl, feerate));
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
    const fl = this.params.feeLevel;
    this.feebase = Math.min(8 * fl, Math.max(0.8 * fl,
      this.feebase * (1 + (this.rng.next() - 0.5) * 0.2 * this.params.feeVol)));
    this.prices[this.day] = this.price;

    // new internal obligations arrive with a few days' notice
    for (const edge of this.edges) {
      const n = this.rng.poisson(this.params.oblRate * (edge.rate ?? 1));
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
    // rent recurs: the studio cycle reassembles for the game chapter — the
    // rent first, its offsetting legs two days later, so a player has real
    // turns to weigh before the oracle can net them (rng-free amounts; the
    // catalogue commission nearly offsets the rent, so a waiting Judy can
    // fund her small net even on seeds where she is running dry)
    if (this.day === GAME_DAY) {
      // the landlord re-invoices: rent still owed rolls into the new bill,
      // so the player faces exactly one rent — the one the chapter narrates
      this.pending = this.pending.filter((o) => !(o.payer === 9 && o.memo === "studio rent"));
      this.pending.push({ payer: 9, payee: 7, memo: "studio rent", usd: 850, due: this.day + 8 });
    }
    if (this.day === GAME_DAY + 2) {
      this.pending.push(
        { payer: 7, payee: 8, memo: "display shelves", usd: 480, due: this.day + 6 },
        { payer: 8, payee: 9, memo: "exhibition catalogue", usd: 780, due: this.day + 6 },
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
    // strangers coinjoin: a first careless attempt on COINJOIN_DAY, then
    // oracle-formed sessions among cross-community strangers, at most one
    // a day — no negotiation is modeled, sessions simply arrive
    if (this.day === COINJOIN_DAY) {
      this.naiveCoinjoin(Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2)));
    } else if (this.day > COINJOIN_DAY && this.rng.next() < 0.45) {
      const parts = this.pickStrangers();
      if (parts) this.coinjoin(parts, Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2)));
    }
    // the consolidation slip that makes intersection attacks concrete;
    // rng-free so the seeded stream is unchanged by its presence
    if (this.day === INTERSECT_DAY) this.intersectSpend();
    // batching desks queue their dues and pay them all in one transaction
    for (let u = 0; u < this.cast.length; u++) {
      if (!this.cast[u]!.batches || u === this.manual) continue;
      const due = this.pending.filter((o) => o.payer === u && o.due <= this.day);
      if (due.length < 2) continue; // a lone due bill goes through the ordinary menu
      const feerate = Number((this.feebase * (0.8 + this.rng.next() * 0.6)).toFixed(2));
      if (this.batchPay(u, due, feerate)) {
        this.pending = this.pending.filter((o) => !due.includes(o));
      }
    }
    // each payer weighs its pending obligations; unpayable ones slip a day
    this.pending = this.pending.filter((obl) => {
      const paid = this.settle(obl);
      if (!paid && obl.due <= this.day) obl.due = this.day + 1;
      return !paid;
    });
    // external purchases: unrounded retail prices, paid on the spot
    for (let u = 0; u < this.cast.length; u++) {
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
