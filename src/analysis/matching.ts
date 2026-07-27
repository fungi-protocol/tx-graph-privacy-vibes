// Match acceptance shared by the two Narayanan–Shmatikov-style
// analyses (ns-social's propagation, ns-netflix's behavioral matching).
// The #112 acceptance gate, registered with the reviewers: under (a)
// random representative relabeling and (b) shuffled merge/evaluation
// order, the accepted match SET must be identical; label/order-
// sensitive candidates must abstain. The mechanism is the source
// paper's own: a candidate pair is accepted only when each side is the
// other's UNIQUE best partner (reciprocal best), and each side's best
// score stands clear of its runner-up by at least `ecc` standard
// deviations of that side's candidate-score set (the eccentricity
// criterion). An exact tie has no unique best; a flat score set has no
// spread to stand clear of; both abstain. Acceptance is a pure
// function of the score multiset — vertex labels and input order never
// enter it.
export interface ScoredPair {
  a: string;
  b: string;
  score: number;
}

/** the default eccentricity bar: the best partner must beat the
 *  runner-up by at least this many standard deviations of the vertex's
 *  candidate scores. A modeling choice (the paper tunes it per
 *  dataset); the invariance properties hold for any value. */
export const ECC_MIN = 0.5;

interface Side {
  /** all candidate scores this vertex saw, for the spread */
  scores: number[];
  /** current best partner; null after a tie for best is detected */
  best: string | null;
  bestScore: number;
  runnerUp: number;
}

/**
 * Accept the reciprocal-best pairs of one round. `pairs` is the scored
 * candidate list (undirected; at most one entry per unordered pair);
 * a pair is accepted iff both endpoints find each other their unique
 * best, the shared score clears `threshold`, and both endpoints pass
 * the eccentricity bar. Returns the accepted pairs sorted canonically
 * (smaller endpoint first, then lexicographic) so the output is
 * identical for any input ordering.
 */
export function acceptReciprocal(
  pairs: ScoredPair[],
  threshold: number,
  ecc = ECC_MIN,
): ScoredPair[] {
  const sides = new Map<string, Side>();
  const see = (v: string, partner: string, score: number): void => {
    let s = sides.get(v);
    if (!s) sides.set(v, (s = { scores: [], best: null, bestScore: -Infinity, runnerUp: -Infinity }));
    s.scores.push(score);
    if (score > s.bestScore) {
      s.runnerUp = s.bestScore;
      s.bestScore = score;
      s.best = partner;
    } else if (score === s.bestScore) {
      s.best = null; // an exact tie for best: no unique partner, abstain
      s.runnerUp = score;
    } else if (score > s.runnerUp) {
      s.runnerUp = score;
    }
  };
  for (const p of pairs) {
    see(p.a, p.b, p.score);
    see(p.b, p.a, p.score);
  }
  const passes = (v: string): boolean => {
    const s = sides.get(v)!;
    if (s.best === null || s.bestScore < threshold) return false;
    // a sole candidate ABSTAINS (accuracy/048): eccentricity measures how
    // far the best stands out from ALTERNATIVES, so with none the
    // criterion is undefined, not vacuously satisfied — one candidate is
    // a fact about how few components remain, not evidence the pair is
    // the same person. Same family as the exact-tie and flat-spread
    // abstentions below.
    if (s.scores.length === 1) return false;
    let mean = 0;
    for (const x of s.scores) mean += x;
    mean /= s.scores.length;
    let varSum = 0;
    for (const x of s.scores) varSum += (x - mean) * (x - mean);
    const sd = Math.sqrt(varSum / s.scores.length);
    if (sd === 0) return false; // flat score set: nothing stands out
    return (s.bestScore - s.runnerUp) / sd >= ecc;
  };
  const out: ScoredPair[] = [];
  for (const p of pairs) {
    const [lo, hi] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    if (sides.get(lo)!.best === hi && sides.get(hi)!.best === lo && passes(lo) && passes(hi)) {
      out.push({ a: lo, b: hi, score: p.score });
    }
  }
  out.sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : 1));
  return out;
}
