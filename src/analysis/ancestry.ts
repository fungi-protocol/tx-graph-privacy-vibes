// Backwards tracing: the full public history a coin descends from. The
// trace itself is always a certainty — collaborative transactions never
// sever it. What later milestones add is ambiguity of interpretation:
// many plausible ownership attributions over the same public history.
import { type Chain, type CoinId, type TxId } from "../model/chain";

export interface Ancestry {
  coins: Set<CoinId>;
  txs: Set<TxId>;
}

/** All ancestor coins and transactions of `start`, inclusive of `start`. */
export function ancestry(chain: Chain, start: CoinId): Ancestry {
  const coins = new Set<CoinId>();
  const txs = new Set<TxId>();
  const frontier: CoinId[] = [start];
  while (frontier.length > 0) {
    const cid = frontier.pop()!;
    if (coins.has(cid)) continue;
    coins.add(cid);
    const producer = chain.coins.get(cid)?.producer;
    if (producer && !txs.has(producer)) {
      txs.add(producer);
      for (const input of chain.txs.get(producer)!.inputs) frontier.push(input);
    }
  }
  return { coins, txs };
}

/** Union of ancestries of all of a transaction's inputs (plus the tx). */
export function txAncestry(chain: Chain, tid: TxId): Ancestry {
  const coins = new Set<CoinId>();
  const txs = new Set<TxId>([tid]);
  for (const input of chain.txs.get(tid)?.inputs ?? []) {
    const a = ancestry(chain, input);
    for (const c of a.coins) coins.add(c);
    for (const t of a.txs) txs.add(t);
  }
  return { coins, txs };
}
