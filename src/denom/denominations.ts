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

/**
 * Decompose a value from below into at most `k` denominations (greedy,
 * largest first). The residual — always smaller than the smallest
 * denomination for values this economy moves — stays with whoever is
 * paying, below the dust threshold's order of magnitude.
 */
export function radixBelow(value: Sats, k = 6): { parts: Sats[]; residual: Sats } {
  const parts: Sats[] = [];
  let r = value;
  while (parts.length < k) {
    let pick = 0;
    for (const d of DENOMS) {
      if (d > r) break;
      pick = d;
    }
    if (pick === 0) break;
    parts.push(pick);
    r -= pick;
  }
  return { parts, residual: r };
}

/**
 * Ways to decompose a coinjoin participant's whole contribution into at
 * most `k` denominations plus a residual — the residual, not any real
 * amount, is what remains as change, so it identifies nobody by value.
 * Variants differ in their opening pick (the chooser randomizes among
 * acceptable options; always-best would fingerprint the chooser), each
 * completed greedily from below. Only decompositions whose residual
 * lands in [DUST, smallest denomination + DUST) qualify: big residuals
 * are just change under another name.
 */
export function radixDecomps(target: Sats, k = 6, limit = 6): Sats[][] {
  const starts = DENOMS.filter((d) => d <= target - DUST).slice(-limit).reverse();
  const out: Sats[][] = [];
  const seen = new Set<string>();
  for (const first of starts) {
    const parts = [first];
    let r = target - first;
    while (parts.length < k) {
      let pick = 0;
      for (const d of DENOMS) {
        if (d > r - DUST) break; // an output must survive as the residual
        pick = d;
      }
      if (pick === 0) break;
      parts.push(pick);
      r -= pick;
    }
    if (r < DUST || r >= DENOMS[0]! + DUST) continue;
    const key = parts.join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(parts);
    }
  }
  return out;
}
