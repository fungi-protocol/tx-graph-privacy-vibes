// The pinned denomination set: hamming-weight-1 values in three bases —
// {1}·2^i, {1,2}·3^i, {1,2,5}·10^i — between the dust threshold and 1 BTC.
// A logarithmic number of preferred values from geometric progressions,
// shared by everyone, so that outputs drawn from the menu say nothing
// about who they belong to. 56 values; the smallest is 512 (the first
// power of two above dust), the largest 100,000,000.
import { type Sats } from "../core/sats";

/** dust threshold: a 98-vbyte spend at 3 sat/vb */
export const DUST = 294;
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
 * Ways to split one participant's coinjoin contribution into a single
 * denomination plus a change output that identifies nobody: the change
 * must not sit within amount-matching distance of any input. Options are
 * ranked by how much of the target the denomination captures; an empty
 * option (plain change) is always available as a fallback.
 */
export function decomps(target: Sats, inputValues: Sats[], limit = 6): Sats[][] {
  const changeOk = (c: Sats): boolean =>
    c >= 60_000 && inputValues.every((iv) => Math.abs(c - iv) >= 3_000);
  const opts: Sats[][] = [];
  for (const d of DENOMS) {
    if (d < 100_000 || d > target - 60_000) continue;
    if (changeOk(target - d)) opts.push([d]);
  }
  opts.sort((a, b) => b[0]! - a[0]!);
  const top = opts.slice(0, limit);
  top.push([]); // plain change: always an acceptable choice
  return top;
}
