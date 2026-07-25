// The pinned denomination set: hamming-weight-1 values in three bases —
// {1}·2^i, {1,2}·3^i, {1,2,5}·10^i — between the dust threshold and 1 BTC.
// A logarithmic number of preferred values from geometric progressions,
// shared by everyone, so that outputs drawn from the menu say nothing
// about who they belong to. 56 values; the smallest is 512 (the first
// power of two above dust), the largest 100,000,000.
import { type Sats } from "../core/sats";

/** dust threshold: Bitcoin Core's figure for P2TR outputs — everything
 *  here is taproot, so the P2WPKH 294 would be the wrong constant */
export const DUST = 330;
const MAX_DENOM = 100_000_000;

function series(base: number, coeffs: number[]): number[] {
  const out: number[] = [];
  let v = 1;
  while (v < DUST) v *= base; // coefficients scale powers already above dust
  for (; v <= MAX_DENOM; v *= base) {
    for (const c of coeffs) {
      if (c * v <= MAX_DENOM) out.push(c * v);
    }
  }
  return out;
}

export const DENOMS: readonly Sats[] = [...new Set([
  ...series(2, [1]),
  ...series(3, [1, 2]),
  ...series(10, [1, 2, 5]),
])].sort((a, b) => a - b);

const DENOM_SET = new Set(DENOMS);
export function isDenomination(v: Sats): boolean {
  return DENOM_SET.has(v);
}

export interface Decomp {
  /** denominations, descending */
  parts: Sats[];
  /** target minus the parts' sum — what a change output would carry */
  residual: Sats;
}

/**
 * Candidate decompositions of a value into at most `k` denominations,
 * found by brute-force search rather than greedy radix expansion: the
 * greedy method runs the arity up to 5 or 6 and tops the sum off with
 * near-dust parts, where a searched combination of 3 or 4 denominations
 * usually approximates the same value at least as well. The search
 * walks the menu largest-first, branching over the few largest
 * denominations that still fit (with room for a change output above
 * dust), allowing repeats, and records EVERY prefix as a candidate — so
 * short decompositions compete with long ones instead of being greedily
 * extended. Candidates are ranked: those whose residual clears a
 * closeness bar (within 0.5% of the target, floored at dust) first,
 * then fewer parts, then smaller residual. The caller treats the
 * residual as an ordinary change output, not as a throwaway.
 */
export function bruteDecomps(target: Sats, k = 6, limit = 16): Decomp[] {
  const usable = DENOMS.filter((d) => d <= target - DUST);
  const found = new Map<string, Decomp>();
  const parts: Sats[] = [];
  const rec = (maxIdx: number, r: Sats): void => {
    if (parts.length > 0) {
      const key = parts.join(",");
      if (!found.has(key)) found.set(key, { parts: [...parts], residual: r });
    }
    if (parts.length >= k) return;
    // branch over the few largest fits only: smaller openers are
    // dominated — whatever they leave, a larger fit leaves less
    let branches = 0;
    for (let i = maxIdx; i >= 0 && branches < 4; i--) {
      const d = usable[i]!;
      if (d > r - DUST) continue; // a change output must survive above dust
      branches += 1;
      parts.push(d);
      rec(i, r - d);
      parts.pop();
    }
  };
  rec(usable.length - 1, target);
  const bar = Math.max(DUST, Math.floor(target / 200));
  return [...found.values()]
    .sort((a, b) =>
      (a.residual <= bar ? 0 : 1) - (b.residual <= bar ? 0 : 1) ||
      a.parts.length - b.parts.length ||
      a.residual - b.residual)
    .slice(0, limit);
}
