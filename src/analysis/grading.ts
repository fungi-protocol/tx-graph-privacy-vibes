// Grading the observer's map against the town's hidden truth (#122b).
// Truth flows only toward the learner's display (the latent-truth rule):
// no heuristic reads this module, and the observer could never draw
// these lists themselves.
import { type Chain, type TxId, type CoinId } from "../model/chain";
import { type Clustering, type Link } from "./observer";

/** one graded error in the observer's map: a link whose coins do NOT in
 *  truth share an owner — an incorrect local inference, named by the
 *  heuristic that made it */
export interface Mistake {
  tx: TxId;
  method: Link["method"];
  /** short display line for the learner */
  note: string;
}

/**
 * GRADING, not analysis: judge every link in the observer's ledger
 * against the town's hidden truth. A link is a mistake when the coins
 * it claims share an owner actually belong to different users — the
 * change guess picked the payment output and linked the payee's coin
 * into the payer's cluster, CIOH read a multi-party spend as one
 * owner, or a balanced sub-transaction part mixed two users' coins.
 */
export function gradeLinks(chain: Chain, links: Link[]): Map<TxId, Mistake[]> {
  const out = new Map<TxId, Mistake[]>();
  for (const w of links) {
    // reuse links read the record rather than betting on it — same
    // address, same key, same owner — so there is nothing to grade
    if (w.tx === undefined) continue;
    const owners = new Set(w.coins.map((c) => chain.coins.get(c)!.owner));
    if (owners.size < 2) continue;
    const note =
      w.method === "change"
        ? (w.basis === "radix"
          ? "a repeated denomination read as a self-spend was another user's coin"
          : "the change guess picked another user's payment")
        : w.method === "cioh"
          ? `CIOH read ${owners.size} users' inputs as one owner`
          : w.method === "remeet"
            ? `${owners.size} users really did land in the same two sessions — the co-membership reading took their coins for one participant's`
            : w.basis === "bound"
              ? "an output only one input could fund was that input's owner paying someone else"
              : "a balanced part combines different users' coins";
    const l = out.get(w.tx);
    if (l) l.push({ tx: w.tx, method: w.method, note });
    else out.set(w.tx, [{ tx: w.tx, method: w.method, note }]);
  }
  return out;
}

// Map-wide grading (#137): the aggregate counterpart of the per-stack
// "errors % · complete %" caption. Cluster sizes drift toward
// heavy-tailed distributions as the graph grows realistic (the social
// structure underneath is itself heavy-tailed), so the summary avoids
// means, which one giant stack would dominate silently: counts, the
// median, and the largest stack's explicit shares carry the shape —
// the reader sees the totals AND how much of the error sits in the
// single biggest stack.

export interface MapGrade {
  /** stacks holding at least two coins (a singleton claims nothing) */
  stacks: number;
  /** coins sitting in those stacks */
  stacked: number;
  /** stacked coins whose stack's main owner is someone else — the sum
   *  of every stack's per-caption error count */
  misplaced: number;
  /** the largest stack's size, and how many of the misplaced coins sit
   *  in it — the fat tail called out, so a map whose error is one
   *  giant wrong merge reads differently from one whose error is
   *  spread thin */
  largest: number;
  misplacedInLargest: number;
  /** median size among the counted stacks */
  median: number;
  /** of the coins whose true owner holds at least two, how many sit in
   *  that owner's own biggest stack — the aggregate counterpart of the
   *  per-stack "complete" number. Both are counts. */
  gathered: number;
  gatherable: number;
}

/** Grade the whole map against the true owners. Null when no stack
 *  holds two coins — there is no map to grade yet. */
export function gradeMap(
  cl: Clustering,
  ownerOf: (id: CoinId) => number | null,
): MapGrade | null {
  const totals = new Map<number | null, number>(); // per true owner: coins
  const best = new Map<number | null, number>(); // per true owner: best single-stack count
  const sizes: number[] = [];
  let stacked = 0;
  let misplaced = 0;
  let largest = 0;
  let misplacedInLargest = 0;
  for (const members of cl.members.values()) {
    const byOwner = new Map<number | null, number>();
    for (const id of members) {
      const o = ownerOf(id);
      byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
      totals.set(o, (totals.get(o) ?? 0) + 1);
    }
    for (const [o, n] of byOwner) {
      if (n > (best.get(o) ?? 0)) best.set(o, n);
    }
    if (members.length < 2) continue;
    sizes.push(members.length);
    stacked += members.length;
    const errs = members.length - Math.max(...byOwner.values());
    misplaced += errs;
    if (members.length > largest) {
      largest = members.length;
      misplacedInLargest = errs;
    }
  }
  if (sizes.length === 0) return null;
  sizes.sort((a, b) => a - b);
  const mid = sizes.length >> 1;
  const median = sizes.length % 2 === 1 ? sizes[mid]! : (sizes[mid - 1]! + sizes[mid]!) / 2;
  let gathered = 0;
  let gatherable = 0;
  for (const [o, total] of totals) {
    if (total < 2) continue;
    gathered += best.get(o) ?? 0;
    gatherable += total;
  }
  return {
    stacks: sizes.length, stacked, misplaced, largest, misplacedInLargest,
    median, gathered, gatherable,
  };
}
