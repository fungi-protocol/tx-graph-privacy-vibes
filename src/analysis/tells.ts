// The change/payment identification's tells and shape reads (#122b):
// per-coin amount plausibility, the coinjoin session shape, and the
// re-met-input merge the sub-transaction search consumes. Pure helpers —
// the pipeline (clusters.ts) decides what the readings mean.
import { type CoinId, type TxId } from "../model/chain";
import { type Sats } from "../core/sats";
import { isDenomination } from "../denom/denominations";
import { TELL_USD, TELL_BTC, TELL_ALL } from "./observer";

/** the least record sessionShape needs — values and structure only.
 *  Both Chain and ObserverRecord satisfy it structurally, so the read
 *  stays truth-blind whichever side hands it in. */
export interface ValueRecord {
  coins: ReadonlyMap<CoinId, { readonly value: Sats }>;
  txs: ReadonlyMap<TxId, {
    readonly inputs: readonly CoinId[];
    readonly outputs: readonly CoinId[];
  }>;
}

/** the shape the observer reads as a likely coinjoin between
 *  strangers: several inputs, and some menu denomination repeated
 *  among the outputs — the same whole-transaction radix read the
 *  change heuristic's self-spend inversion rests on */
export function sessionShape(chain: ValueRecord, tid: TxId): boolean {
  const tx = chain.txs.get(tid);
  if (!tx || tx.inputs.length < 2) return false;
  const seen = new Set<Sats>();
  for (const o of tx.outputs) {
    const v = chain.coins.get(o)!.value;
    if (!isDenomination(v)) continue;
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
}

/** merge the grouped positions of `ivs` into one combined value per
 *  group (kept at the group's first position); `expand` maps each
 *  merged index back to the original input indices, so a partition of
 *  the merged values can be read back onto the real inputs */
export function mergeInputs(
  ivs: Sats[],
  groups: number[][],
): { vals: Sats[]; expand: number[][] } {
  if (groups.length === 0) return { vals: [...ivs], expand: ivs.map((_, i) => [i]) };
  const headOf = new Map<number, number[]>();
  const rest = new Set<number>();
  for (const g of groups) {
    const s = [...g].sort((a, b) => a - b);
    headOf.set(s[0]!, s);
    for (const i of s.slice(1)) rest.add(i);
  }
  const vals: Sats[] = [];
  const expand: number[][] = [];
  ivs.forEach((v, i) => {
    if (rest.has(i)) return;
    const g = headOf.get(i);
    vals.push(g ? g.reduce((a, j) => a + ivs[j]!, 0) : v);
    expand.push(g ?? [i]);
  });
  return { vals, expand };
}

/** decimal hamming weight: how many nonzero digits the integer has */
function decHW(n: number): number {
  let w = 0;
  for (let x = Math.round(n); x > 0; x = Math.floor(x / 10)) {
    if (x % 10 !== 0) w += 1;
  }
  return w;
}

/**
 * The plausible-payment-amount tell, applied per coin: prices are set
 * by people, so a value that lands on a round multiple of $10 at that
 * day's rate reads as a payment ($40, not $37.63) — and so does a
 * value round in BTC terms (decimal hamming weight 1: 0.05 BTC, not
 * 0.0473). Real analysts extend the family to related figures like
 * $19.99 plus sales tax; this town's prices are round enough not to
 * need them. A guess about the AMOUNT only — what it means for the
 * coin depends on context (the same round BTC figure that reads as a
 * payment alone reads as a self-spend among repeated denominations).
 */
export function plausiblePayment(value: Sats, price?: number, tells = TELL_ALL): boolean {
  if ((tells & TELL_BTC) !== 0 && decHW(value) <= 1) return true;
  if ((tells & TELL_USD) === 0 || price === undefined) return false;
  const usd = (value * price) / 1e8;
  return Math.abs(usd - Math.round(usd / 10) * 10) < 0.05;
}

/** which amount-tell kinds fire on this value — the bar counts kinds */
export function amountKinds(value: Sats, price: number | undefined, tells: number): number {
  let k = 0;
  if ((tells & TELL_BTC) !== 0 && decHW(value) <= 1) k |= TELL_BTC;
  if ((tells & TELL_USD) !== 0 && price !== undefined) {
    const usd = (value * price) / 1e8;
    if (Math.abs(usd - Math.round(usd / 10) * 10) < 0.05) k |= TELL_USD;
  }
  return k;
}
