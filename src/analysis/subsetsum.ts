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

/** every subset sum including the empty set's 0, sorted ascending */
function sumsWithEmpty(vals: Sats[]): number[] {
  let sums = new Set<number>([0]);
  for (const v of vals) {
    const next = new Set(sums);
    for (const s of sums) next.add(s + v);
    sums = next;
  }
  return [...sums].sort((a, b) => a - b);
}

/**
 * Fraction of input-subset sums matched within `tol` sats by some
 * output-subset sum. High density means the amounts place few
 * constraints on how the transaction could be partitioned. The output
 * side is searched meet-in-the-middle — whole-balance denominated
 * sessions run to dozens of outputs, and materializing every
 * output-subset sum at that size is the analyst's own wall.
 */
export function ambiguity(ivs: Sats[], ovs: Sats[], tol = 500): number {
  const isums = subsetSums(ivs);
  if (isums.length === 0 || ovs.length === 0) return 0;
  const half = ovs.length >> 1;
  const a = sumsWithEmpty(ovs.slice(0, half));
  const b = sumsWithEmpty(ovs.slice(half));
  let good = 0;
  for (const s of isums) {
    // some x ∈ a, y ∈ b with |x + y − s| ≤ tol? (the empty halves are
    // present, so single-half subsets count; s itself is far above tol,
    // so the doubly-empty 0 never matches)
    let hit = false;
    for (const x of a) {
      if (x > s + tol) break;
      const want = s - x;
      let lo = 0, hi = b.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (b[mid]! < want) lo = mid + 1;
        else hi = mid;
      }
      const near = Math.min(
        lo < b.length ? Math.abs(b[lo]! - want) : Infinity,
        lo > 0 ? Math.abs(b[lo - 1]! - want) : Infinity,
      );
      if (near <= tol) {
        hit = true;
        break;
      }
    }
    if (hit) good += 1;
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
 * complete partition. Past 12 outputs the index-level enumeration gives
 * way to the multiset quotient below, which is what lets realistic
 * denominated sessions be searched at all. Transactions too large even
 * for that come back "inconclusive", NOT "ambiguous": ambiguity is a
 * proof (two balanced readings exhibited), while inconclusive only says
 * the search gave up. With denominated outputs the mapping is
 * overwhelmingly likely to be underdetermined anyway, but the verdicts
 * must not be conflated — claims of ambiguity are never allowed to
 * outrun the analysis.
 */
export function subTransactionMapping(
  ivs: Sats[],
  ovs: Sats[],
  fee: Sats,
  tol = 500,
): SubMapping {
  const n = ivs.length, m = ovs.length;
  if (n < 2 || m < 2) return { kind: "atomic" };
  if (n > 10) return { kind: "inconclusive" };
  if (m > 12) return multisetMapping(ivs, ovs, fee, tol);
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

/**
 * The same partition search for transactions with too many outputs to
 * enumerate index-by-index, exploiting the symmetry denominated outputs
 * create: outputs of identical value are interchangeable, so partitions
 * are counted over value MULTISETS — the correct quotient, not an
 * approximation. Two extra rules keep the verdicts honest under the
 * quotient: (1) two distinct multiset-level partitions prove ambiguity
 * exactly as before; (2) a single partition that splits some value
 * across two parts also proves ambiguity, because swapping two
 * equal-valued outputs between parts exhibits a second reading — the
 * analyst cannot say WHICH of the identical outputs went to which
 * party. "Unique" therefore requires one partition in which every
 * value's copies travel together, and index assignment is determined
 * up to relabeling within a part (which changes nothing).
 */
function multisetMapping(ivs: Sats[], ovs: Sats[], fee: Sats, tol: number): SubMapping {
  const n = ivs.length;
  // collapse outputs into (value, count), descending by value
  const vals: number[] = [];
  const total: number[] = [];
  for (const v of [...ovs].sort((a, b) => b - a)) {
    if (vals.length > 0 && vals[vals.length - 1] === v) total[total.length - 1]! += 1;
    else { vals.push(v); total.push(1); }
  }
  const d = vals.length;
  const iSum = new Float64Array(1 << n);
  for (let mask = 1; mask < 1 << n; mask++) {
    const low = mask & -mask;
    iSum[mask] = iSum[mask ^ low]! + ivs[Math.log2(low)]!;
  }

  let budget = 300_000;
  let found = 0;
  let splitProven = false;
  const cnt = Uint8Array.from(total); // outputs still unassigned
  const parts: { in: number; take: Uint8Array }[] = [];
  let unique: { in: number; take: Uint8Array }[] = [];

  // enumerate sub-multisets of the remaining outputs with sum inside
  // [lo, hi]; cb returns true to abort the whole search
  const eachTake = (lo: number, hi: number, cb: (take: Uint8Array) => boolean): boolean => {
    const take = new Uint8Array(d);
    const rec2 = (i: number, sum: number, remMax: number): boolean => {
      budget -= 1;
      if (budget <= 0) return true;
      if (sum > hi) return false;
      if (sum + remMax < lo) return false;
      if (i === d) return sum >= lo && sum > 0 ? cb(take) : false;
      const rm = remMax - vals[i]! * cnt[i]!;
      for (let c = cnt[i]!; c >= 0; c--) {
        take[i] = c;
        if (rec2(i + 1, sum + c * vals[i]!, rm)) { take[i] = 0; return true; }
      }
      take[i] = 0;
      return false;
    };
    let remMax = 0;
    for (let i = 0; i < d; i++) remMax += vals[i]! * cnt[i]!;
    return rec2(0, 0, remMax);
  };

  // a part is minimal when no proper nonempty sub-pair of it balances
  const minimal = (pi: number, take: Uint8Array): boolean => {
    const saved = cnt.slice();
    cnt.set(take); // sub-multisets are drawn from the part itself
    let splittable = false;
    for (let si = (pi - 1) & pi; si > 0 && !splittable; si = (si - 1) & pi) {
      const t = iSum[si]!;
      eachTake(t - fee - tol, t + tol, (sub) => {
        let proper = false;
        for (let i = 0; i < d; i++) if (sub[i]! < take[i]!) { proper = true; break; }
        if (proper) splittable = true;
        return splittable || budget <= 0;
      });
      if (budget <= 0) break;
    }
    cnt.set(saved);
    return !splittable;
  };

  const rec = (inMask: number): boolean => {
    if (found >= 2 || splitProven || budget <= 0) return true;
    if (inMask === 0) {
      for (let i = 0; i < d; i++) if (cnt[i]! !== 0) return false;
      if (parts.length < 2) return false;
      found += 1;
      if (found === 1) {
        unique = parts.map((p) => ({ in: p.in, take: p.take.slice() }));
        // a value split across parts ⇒ swapping equal outputs exhibits
        // a second reading
        for (let i = 0; i < d && !splitProven; i++) {
          let touched = 0;
          for (const p of parts) if (p.take[i]! > 0) touched += 1;
          if (touched >= 2) splitProven = true;
        }
      }
      return found >= 2 || splitProven;
    }
    const pivot = inMask & -inMask;
    const rest = inMask & ~pivot;
    let s = rest;
    for (;;) {
      const partIn = pivot | s;
      const target = iSum[partIn]!;
      const abort = eachTake(target - fee - tol, target + tol, (take) => {
        if (!minimal(partIn, take)) return budget <= 0;
        const taken = take.slice();
        for (let i = 0; i < d; i++) cnt[i]! -= taken[i]!;
        parts.push({ in: partIn, take: taken });
        const stop = rec(inMask & ~partIn);
        parts.pop();
        for (let i = 0; i < d; i++) cnt[i]! += taken[i]!;
        return stop;
      });
      if (abort) return true;
      if (s === 0) break;
      s = (s - 1) & rest;
    }
    return false;
  };
  rec((1 << n) - 1);

  if (found >= 2 || splitProven) return { kind: "ambiguous" };
  if (budget <= 0) return { kind: "inconclusive" };
  if (found === 0) return { kind: "atomic" };
  // one partition, every value's copies together: assign indices by
  // doling each value's output positions out per part (any order — the
  // outputs are identical)
  const positions = new Map<number, number[]>();
  ovs.forEach((v, i) => {
    const l = positions.get(v);
    if (l) l.push(i); else positions.set(v, [i]);
  });
  const bits = (mask: number): number[] => {
    const out: number[] = [];
    for (let i = 0; mask >> i; i++) if ((mask >> i) & 1) out.push(i);
    return out;
  };
  return {
    kind: "unique",
    parts: unique.map((p) => {
      const outs: number[] = [];
      for (let i = 0; i < d; i++) {
        const pool = positions.get(vals[i]!)!;
        for (let c = 0; c < p.take[i]!; c++) outs.push(pool.shift()!);
      }
      return { ins: bits(p.in), outs: outs.sort((a, b) => a - b) };
    }),
  };
}
