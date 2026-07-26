// The ns-netflix rendition: Narayanan–Shmatikov's statistical
// de-anonymization (the Netflix-prize paper) retold on the cluster graph.
// Where ns-social matches vertices by who they transact with, this
// heuristic matches them by how they behave: each cluster's public record
// yields a feature vector — amount distribution, temporal pattern, amounts
// over time, feerates absolute and relative to the day's prevailing rate —
// and clusters whose vectors agree closely are proposed as one user.
// The relative-feerate block is where wallet software sings: every product
// in scenario/cast.ts bids by policy, and the policy survives clustering.
//
// Unlike the propagation algorithm, the iterative form buys no intuition
// here: playback is greedy — best score first, each vertex matched at most
// once, no revisiting — so playing is only a way to animate the ranking.
import type { Chain, TxId, CoinId } from "../model/chain";
import type { Clustering } from "./clusters";

export interface NfEvent {
  /** cluster representatives (in the clustering the run was computed on) */
  a: string;
  b: string;
  score: number;
}

/** feature blocks per cluster; kept separately so the UI can show them */
export interface NfStats {
  /** log2-bucketed values of the cluster's coins and outgoing payments */
  amounts: number[];
  /** activity count per timeline eighth */
  temporal: number[];
  /** mean log2 payment size per timeline eighth (0 where silent) */
  drift: number[];
  /** log2-bucketed absolute feerates of the cluster's spends */
  feeAbs: number[];
  /** feerate relative to the day median, fixed buckets */
  feeRel: number[];
  /** how many spends the vector rests on (thin evidence reads noisy) */
  spends: number;
}

const AMT_BUCKETS = 24;
const TIME_BUCKETS = 8;
const FEE_ABS_BUCKETS = 12;
// relative-rate bucket edges: under the market, at it, premium tiers
const FEE_REL_EDGES = [0.7, 0.85, 0.95, 1.05, 1.2, 1.45, 2];

function amtBucket(v: number): number {
  return Math.max(0, Math.min(AMT_BUCKETS - 1, Math.floor(Math.log2(Math.max(1, v))) - 8));
}

function feeAbsBucket(fr: number): number {
  return Math.max(0, Math.min(FEE_ABS_BUCKETS - 1, Math.floor(Math.log2(Math.max(0.25, fr)) * 2) + 2));
}

function feeRelBucket(rel: number): number {
  let b = 0;
  while (b < FEE_REL_EDGES.length && rel >= FEE_REL_EDGES[b]!) b++;
  return b;
}

/** the observer's prevailing-rate estimate: median feerate per day */
export function dayMedians(chain: Chain): Map<number, number> {
  const byDay = new Map<number, number[]>();
  for (const tx of chain.txs.values()) {
    const g = byDay.get(tx.timestep) ?? [];
    g.push(tx.feerate);
    byDay.set(tx.timestep, g);
  }
  const med = new Map<number, number>();
  for (const [day, rates] of byDay) {
    const s = rates.sort((a, b) => a - b);
    med.set(day, s[Math.floor(s.length / 2)]!);
  }
  return med;
}

/** every cluster's behavioral fingerprint, from the public record alone */
export function nfStats(cl: Clustering, chain: Chain): Map<string, NfStats> {
  const med = dayMedians(chain);
  let maxDay = 1;
  for (const tx of chain.txs.values()) maxDay = Math.max(maxDay, tx.timestep);
  for (const c of chain.coins.values()) maxDay = Math.max(maxDay, c.entered ?? 0);
  const timeBin = (d: number) =>
    Math.max(0, Math.min(TIME_BUCKETS - 1, Math.floor((d * TIME_BUCKETS) / (maxDay + 1))));

  const out = new Map<string, NfStats>();
  const blank = (): NfStats => ({
    amounts: new Array(AMT_BUCKETS).fill(0),
    temporal: new Array(TIME_BUCKETS).fill(0),
    drift: new Array(TIME_BUCKETS).fill(0),
    feeAbs: new Array(FEE_ABS_BUCKETS).fill(0),
    feeRel: new Array(FEE_REL_EDGES.length + 1).fill(0),
    spends: 0,
  });
  const driftSums = new Map<string, { s: number[]; n: number[] }>();
  const get = (rep: string): NfStats => {
    let s = out.get(rep);
    if (!s) {
      s = blank();
      out.set(rep, s);
      driftSums.set(rep, { s: new Array(TIME_BUCKETS).fill(0), n: new Array(TIME_BUCKETS).fill(0) });
    }
    return s;
  };
  for (const rep of cl.members.keys()) get(rep);

  // receipts: every coin's value and arrival day count toward its cluster
  for (const c of chain.coins.values()) {
    const rep = cl.rep.get(c.id);
    if (rep === undefined) continue;
    const st = get(rep);
    st.amounts[amtBucket(c.value)]!++;
    const day = c.producer !== null
      ? chain.txs.get(c.producer)?.timestep ?? c.entered ?? 0
      : c.entered ?? 0;
    st.temporal[timeBin(day)]!++;
  }
  // spends: a transaction charges the cluster(s) funding it — feerates,
  // and its payment outputs (those leaving the cluster) as amounts
  for (const tx of chain.txs.values()) {
    const funders = new Set<string>();
    for (const cid of tx.inputs) {
      const rep = cl.rep.get(cid as CoinId);
      if (rep !== undefined) funders.add(rep);
    }
    const m = med.get(tx.timestep) ?? 0;
    for (const rep of funders) {
      const st = get(rep);
      st.spends++;
      st.temporal[timeBin(tx.timestep)]!++;
      st.feeAbs[feeAbsBucket(tx.feerate)]!++;
      if (m > 0) st.feeRel[feeRelBucket(tx.feerate / m)]!++;
      const ds = driftSums.get(rep)!;
      for (const cid of tx.outputs) {
        const oRep = cl.rep.get(cid as CoinId);
        if (oRep === rep) continue; // change back to self is not a payment
        const v = chain.coins.get(cid as CoinId)?.value ?? 0;
        if (v <= 0) continue;
        st.amounts[amtBucket(v)]!++;
        const bin = timeBin(tx.timestep);
        ds.s[bin]! += Math.log2(v);
        ds.n[bin]!++;
      }
    }
  }
  for (const [rep, st] of out) {
    const ds = driftSums.get(rep)!;
    for (let i = 0; i < TIME_BUCKETS; i++) {
      st.drift[i] = ds.n[i]! > 0 ? ds.s[i]! / ds.n[i]! / 24 : 0;
    }
  }
  return out;
}

function cosine(a: number[], b: number[]): number | null {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

/** behavioral similarity: mean cosine over the feature blocks both sides
 *  have evidence for; 0 when the records are too thin to compare */
export function nfSimilarity(a: NfStats, b: NfStats): number {
  const blocks: [number[], number[]][] = [
    [a.amounts, b.amounts], [a.temporal, b.temporal], [a.drift, b.drift],
    [a.feeAbs, b.feeAbs], [a.feeRel, b.feeRel],
  ];
  let sum = 0, n = 0;
  for (const [x, y] of blocks) {
    const c = cosine(x, y);
    if (c === null) continue;
    sum += c;
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * The greedy run: score every unordered pair, rank best-first, and unify
 * down the ranking — each vertex matched at most once, never revisited.
 * A threshold above cosine's ceiling admits nothing (view-only mode).
 */
export function nfRun(cl: Clustering, chain: Chain, threshold: number): NfEvent[] {
  const stats = nfStats(cl, chain);
  const reps = [...cl.members.keys()].sort();
  const scored: NfEvent[] = [];
  for (let i = 0; i < reps.length - 1; i++) {
    for (let j = i + 1; j < reps.length; j++) {
      const s = nfSimilarity(stats.get(reps[i]!)!, stats.get(reps[j]!)!);
      if (s >= threshold) scored.push({ a: reps[i]!, b: reps[j]!, score: s });
    }
  }
  scored.sort((p, q) => q.score - p.score || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0)
    || (p.b < q.b ? -1 : 1));
  const used = new Set<string>();
  const events: NfEvent[] = [];
  for (const e of scored) {
    if (used.has(e.a) || used.has(e.b)) continue;
    used.add(e.a);
    used.add(e.b);
    events.push(e);
  }
  return events;
}
