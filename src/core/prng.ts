// Deterministic seeded randomness. Everything in the simulation that is
// "random" draws from an Rng created from the seed string, so a seed fully
// determines a run (the fragment codec ships seeds around).

/** Hash a string into four 32-bit words (fmix-style avalanche per word). */
export function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 0x9e3779b9 | 0, h2 = 0x243f6a88 | 0, h3 = 0xb7e15162 | 0, h4 = 0xdeadbeef | 0;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2869860233);
    h4 = Math.imul(h4 ^ c, 951274213);
  }
  const mix = (h: number): number => {
    h ^= h >>> 16;
    h = Math.imul(h, 2246822507);
    h ^= h >>> 13;
    h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  return [mix(h1 ^ h2), mix(h2 ^ h3), mix(h3 ^ h4), mix(h4 ^ h1)];
}

/** sfc32: small fast counter PRNG, 128-bit state, uniform in [0, 1). */
export class Rng {
  private a: number; private b: number; private c: number; private d: number;

  constructor(seed: string | [number, number, number, number]) {
    const [a, b, c, d] = typeof seed === "string" ? hashSeed(seed) : seed;
    this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0;
    for (let i = 0; i < 12; i++) this.u32(); // scramble past low-entropy seeds
  }

  u32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty array");
    return xs[this.int(xs.length)]!;
  }

  /** Weighted index choice; weights need not be normalized. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = xs[i]!; xs[i] = xs[j]!; xs[j] = t;
    }
    return xs;
  }

  /** Poisson-distributed count (Knuth; fine for the small rates we use). */
  poisson(lambda: number): number {
    const l = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > l);
    return k - 1;
  }

  /** Derive an independent child stream (e.g. one per agent, per subsystem). */
  fork(label: string): Rng {
    const [a, b, c, d] = hashSeed(label);
    return new Rng([this.u32() ^ a, this.u32() ^ b, this.u32() ^ c, this.u32() ^ d]);
  }
}
