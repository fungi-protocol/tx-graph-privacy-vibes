// Subset-sum analysis of a transaction's amounts, after Maurer et al's
// sub-transaction model: partition the inputs and outputs into groups
// that balance (up to fees), each group presumed to be one party's
// payment. If exactly one such partition exists, the amounts alone
// fully partition the transaction; if several exist, the mapping is
// underdetermined and linking inputs to outputs becomes guesswork.
// The density measure below is the same one diagram E used: the
// fraction of input-subset sums matched by some output-subset sum.
import { type Sats } from "../core/sats";

/** every nonempty-subset sum, sorted ascending (duplicates removed) */
export function subsetSums(vals: Sats[]): Sats[] {
  let sums = new Set<number>([0]);
  for (const v of vals) {
    const next = new Set(sums);
    for (const s of sums) next.add(s + v);
    sums = next;
  }
  sums.delete(0);
  return [...sums].sort((a, b) => a - b);
}

/**
 * Fraction of input-subset sums matched within `tol` sats by some
 * output-subset sum. High density means the amounts place few
 * constraints on how the transaction could be partitioned.
 */
export function ambiguity(ivs: Sats[], ovs: Sats[], tol = 500): number {
  const isums = subsetSums(ivs);
  const osums = subsetSums(ovs);
  if (isums.length === 0 || osums.length === 0) return 0;
  let good = 0;
  for (const s of isums) {
    // binary search for the closest output-subset sum
    let lo = 0, hi = osums.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (osums[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    const near = Math.min(
      lo < osums.length ? Math.abs(osums[lo]! - s) : Infinity,
      lo > 0 ? Math.abs(osums[lo - 1]! - s) : Infinity,
    );
    if (near <= tol) good += 1;
  }
  return good / isums.length;
}

export interface SubPart {
  /** indices into the transaction's input list */
  ins: number[];
  /** indices into the transaction's output list */
  outs: number[];
}

export type SubMapping =
  | { kind: "atomic" }              // no way to split: reads as one party
  | { kind: "unique"; parts: SubPart[] } // exactly one split: fully partitioned
  | { kind: "ambiguous" }           // several splits found: proven underdetermined
  | { kind: "inconclusive" };       // too large to enumerate: nothing proven either way

/**
 * Enumerate partitions of a transaction into balanced sub-transactions:
 * each part takes a nonempty set of inputs and of outputs, with the
 * part's deficit (inputs − outputs) inside [−tol, fee + tol] — every
 * part pays a non-negative share of the fee, give or take rounding.
 * Only finest partitions count: each part must be minimal, i.e. not
 * itself splittable into balancing sub-parts, since an analyst always
 * prefers the finer reading (coarsenings of a valid partition trivially
 * balance and carry no extra information). Enumeration is canonical
 * (each unordered partition visited once) and stops at the second
 * complete partition. Transactions too large to enumerate come back
 * "inconclusive", NOT "ambiguous": ambiguity is a proof (two balanced
 * readings exhibited), while inconclusive only says the search gave up.
 * With denominated outputs the mapping is overwhelmingly likely to be
 * underdetermined anyway, but the verdicts must not be conflated —
 * claims of ambiguity are never allowed to outrun the analysis.
 */
export function subTransactionMapping(
  ivs: Sats[],
  ovs: Sats[],
  fee: Sats,
  tol = 500,
): SubMapping {
  const n = ivs.length, m = ovs.length;
  if (n < 2 || m < 2) return { kind: "atomic" };
  if (n > 10 || m > 12) return { kind: "inconclusive" };
  const iSum = new Float64Array(1 << n);
  for (let mask = 1; mask < 1 << n; mask++) {
    const low = mask & -mask;
    iSum[mask] = iSum[mask ^ low]! + ivs[Math.log2(low)]!;
  }
  const oSum = new Float64Array(1 << m);
  for (let mask = 1; mask < 1 << m; mask++) {
    const low = mask & -mask;
    oSum[mask] = oSum[mask ^ low]! + ovs[Math.log2(low)]!;
  }

  let budget = 300_000;
  let found = 0;
  let unique: { in: number; out: number }[] = [];
  const cur: { in: number; out: number }[] = [];

  // a part is minimal when no proper nonempty sub-pair of it balances
  const minimal = (pi: number, po: number): boolean => {
    for (let si = (pi - 1) & pi; si > 0; si = (si - 1) & pi) {
      for (let so = (po - 1) & po; so > 0; so = (so - 1) & po) {
        budget -= 1;
        if (budget <= 0) return true; // out of budget: the caller bails
        const d = iSum[si]! - oSum[so]!;
        if (d >= -tol && d <= fee + tol) return false;
      }
    }
    return true;
  };

  const rec = (inMask: number, outMask: number): void => {
    if (found >= 2 || budget <= 0) return;
    if (inMask === 0) {
      if (outMask === 0 && cur.length >= 2) {
        found += 1;
        if (found === 1) unique = [...cur];
      }
      return;
    }
    // the lowest remaining input anchors the next part, so each
    // unordered partition is generated exactly once
    const pivot = inMask & -inMask;
    const rest = inMask & ~pivot;
    let s = rest;
    for (;;) {
      const partIn = pivot | s;
      const target = iSum[partIn]!;
      for (let o = outMask; o > 0; o = (o - 1) & outMask) {
        budget -= 1;
        if (budget <= 0 || found >= 2) return;
        const d = target - oSum[o]!;
        if (d >= -tol && d <= fee + tol && minimal(partIn, o)) {
          cur.push({ in: partIn, out: o });
          rec(inMask & ~partIn, outMask & ~o);
          cur.pop();
        }
      }
      if (s === 0) break;
      s = (s - 1) & rest;
    }
  };
  rec((1 << n) - 1, (1 << m) - 1);

  if (budget <= 0) return { kind: "inconclusive" };
  if (found === 0) return { kind: "atomic" };
  if (found >= 2) return { kind: "ambiguous" };
  const bits = (mask: number): number[] => {
    const out: number[] = [];
    for (let i = 0; mask >> i; i++) if ((mask >> i) & 1) out.push(i);
    return out;
  };
  return { kind: "unique", parts: unique.map((p) => ({ ins: bits(p.in), outs: bits(p.out) })) };
}
