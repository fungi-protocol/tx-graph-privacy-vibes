// What one participant actually knows about the graph. Two sources:
//   - their own wallet: every coin they ever owned, with its story;
//   - every payment they took part in: a counterparty can eliminate
//     their own inputs and outputs, so everything else in that
//     transaction is attributable to the other party.
// These are fixed points — they compound with every payment and never
// decay. And they seed the same public heuristics an outsider runs: a
// cluster that contains a coin the agent can attribute is attributed
// wholesale (unless the cluster mixes evidence about two different
// owners — a participant knows exactly when the weld is a lie, so a
// conflicted cluster earns no guess at all).
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type EconomyEvent } from "../engine/economy";
import { type Clustering } from "./clusters";

export interface Attribution {
  /** who the agent believes owns the coin (null = an external merchant) */
  owner: number | null;
  /** true = direct evidence (own coin, or a payment they took part in);
   *  false = propagated through public clustering */
  direct: boolean;
}

export interface Knowledge {
  coins: Map<CoinId, Attribution>;
  /** transactions the agent took part in: memo and roles known */
  txs: Set<TxId>;
}

export function agentKnowledge(
  chain: Chain,
  events: EconomyEvent[],
  u: number,
  cl?: Clustering,
): Knowledge {
  const coins = new Map<CoinId, Attribution>();
  const txs = new Set<TxId>();

  // own wallet, past and present
  for (const c of chain.coins.values()) {
    if (c.owner === u) coins.set(c.id, { owner: u, direct: true });
  }

  // payments taken part in: everything not one's own is the counterparty's
  for (const ev of events) {
    if (ev.payer !== u && ev.payee !== u) continue;
    const tx = chain.txs.get(ev.tid);
    if (!tx) continue;
    txs.add(ev.tid);
    const other = ev.payer === u ? ev.payee : ev.payer;
    for (const id of [...tx.inputs, ...tx.outputs]) {
      if (chain.coins.get(id)!.owner !== u) coins.set(id, { owner: other, direct: true });
    }
  }

  // compounding: fixed points seed the public clustering
  if (cl) {
    for (const members of cl.members.values()) {
      const owners = new Set<number | null>();
      for (const id of members) {
        const a = coins.get(id);
        if (a?.direct) owners.add(a.owner);
      }
      if (owners.size !== 1) continue; // no evidence, or a weld the agent knows is a lie
      const owner = [...owners][0]!;
      for (const id of members) {
        if (!coins.has(id)) coins.set(id, { owner, direct: false });
      }
    }
  }

  return { coins, txs };
}
