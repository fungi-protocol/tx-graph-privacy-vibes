// Auxiliary information as a KNOWLEDGE GRANT: "suppose the adversary has
// deanonymized user U" — a KYC record, a web tracker, a counterparty's
// books. The assumption is stated as an assumption; what follows from it
// is COMPUTED. Two very different outcomes on the same public graph
// (the writeup's additive/multiplicative dichotomy):
//   - additive: U's own coins drop out of a traced coin's candidate
//     origins — the set shrinks by what was granted, no more.
//   - multiplicative: the granted coins sat on every route to OTHER
//     origins, so removing them severs those origins too — the ancestry
//     fractures into regions, and candidates fall that the grant never
//     named. When cuts keep paying beyond their own size, the adversary's
//     progress compounds.
// Latent-truth rule (grant, then run blind): the granted set is the ONLY
// truth that enters — everything after is reachability on the public
// graph. Nothing here reads coin ownership.
import { type Chain, type CoinId } from "../model/chain";
import { ancestry } from "./ancestry";

export interface AuxDecay {
  /** candidate origins before the grant */
  before: number;
  /** roots eliminated because they are in the granted set (additive) */
  granted: number;
  /** roots NOT in the granted set that fall anyway — every route from
   *  the coin back to them passes through a granted coin (the fracture
   *  dividend; > 0 means the multiplicative regime is live) */
  fractured: number;
  /** candidate origins that survive the cut */
  after: number;
}

/**
 * What one knowledge grant does to one coin's candidate origins.
 * `granted` is the disclosed set (U's coins); the traced coin's own
 * ancestry is walked twice — once freely, once refusing to step onto a
 * granted coin — and the difference is the computed consequence.
 */
export function auxInfoDecay(chain: Chain, coin: CoinId, granted: Set<CoinId>): AuxDecay {
  const a = ancestry(chain, coin);
  const roots = [...a.coins].filter((c) => chain.coins.get(c)!.producer === null);
  // reachability backwards from the coin, never stepping onto a granted
  // coin: the surviving part of the ancestry
  const reach = new Set<CoinId>();
  const frontier: CoinId[] = granted.has(coin) ? [] : [coin];
  while (frontier.length > 0) {
    const cid = frontier.pop()!;
    if (reach.has(cid)) continue;
    reach.add(cid);
    const producer = chain.coins.get(cid)?.producer;
    if (producer) {
      for (const input of chain.txs.get(producer)!.inputs) {
        if (!granted.has(input)) frontier.push(input);
      }
    }
  }
  const grantedRoots = roots.filter((r) => granted.has(r));
  const survivors = roots.filter((r) => reach.has(r));
  return {
    before: roots.length,
    granted: grantedRoots.length,
    fractured: roots.length - grantedRoots.length - survivors.length,
    after: survivors.length,
  };
}
