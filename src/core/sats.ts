// Value arithmetic. Sats fit comfortably in doubles (2.1e15 < 2^53).
export type Sats = number;

export function fmtSats(v: Sats): string {
  return v.toLocaleString("en-US");
}

/**
 * Taproot keyspend vsize: 10.5 vb overhead, 57.5/input, 43/output.
 * Input: 41 non-witness vb + 66 wu witness (stack count + len + 64-byte
 * Schnorr signature) = 230 wu = 57.5 vb.
 */
export function vsize(nIn: number, nOut: number): number {
  return 10.5 + 57.5 * nIn + 43 * nOut;
}

/** Every transaction pays exactly ceil(vsize × feerate). */
export function txfee(nIn: number, nOut: number, feerate: number): Sats {
  return Math.ceil(vsize(nIn, nOut) * feerate);
}
