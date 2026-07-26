// Backwards tracing, in two senses. The APPARENT cone (`ancestry`) is the
// full public history a coin descends from: every input of every producing
// transaction, because to an outside observer a multi-party transaction
// implicates all of its inputs equally. The TRUE flow (`trueFlow`) is the
// ground-truth causal history — from an output, step only to the producing
// transaction's inputs owned by whoever actually funded that output. The
// truth is always one path structure within the apparent cloud.
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

/**
 * Ground-truth flow of funds into `start`, inclusive: follow each output
 * back only to the producing transaction's inputs owned by one of the
 * output's funders. All inputs a funder owns share equal linkage with
 * every output that funder funded, so this can still branch — a payment
 * funded from two coins has two true parents — but it excludes the other
 * participants' funds that merely share the transaction.
 */
export function trueFlow(chain: Chain, start: CoinId): Ancestry {
  const coins = new Set<CoinId>();
  const txs = new Set<TxId>();
  const frontier: CoinId[] = [start];
  while (frontier.length > 0) {
    const cid = frontier.pop()!;
    if (coins.has(cid)) continue;
    coins.add(cid);
    const coin = chain.coins.get(cid);
    if (!coin?.producer) continue;
    txs.add(coin.producer);
    const funders = new Set(coin.funders);
    for (const input of chain.txs.get(coin.producer)!.inputs) {
      if (funders.has(chain.coins.get(input)!.owner)) frontier.push(input);
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
