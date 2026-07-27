// Grading the observer's map against the town's hidden truth (#122b).
// Truth flows only toward the learner's display (the latent-truth rule):
// no heuristic reads this module, and the observer could never draw
// these lists themselves.
import { type Chain, type TxId } from "../model/chain";
import { type Link } from "./observer";

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
