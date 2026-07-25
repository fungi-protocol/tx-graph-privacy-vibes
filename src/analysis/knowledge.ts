// What one participant actually knows about the graph. Two sources:
//   - their own wallet: every coin they ever owned, with its story;
//   - every payment they took part in: a counterparty can eliminate
//     their own inputs and outputs, so in a two-party transaction
//     everything else is attributable to the other party; in a net
//     settlement the participants coordinate openly, and a three-party
//     insider can in any case solve the edge they are not on. Coinjoins
//     are different: among several strangers, elimination leaves the
//     rest ambiguous — an insider is nearly as blind as an outsider.
//     (A protocol assumption, not a law of nature: sessions here are
//     arranged so nobody learns whose outputs are whose — the strongest
//     honest arrangement; a careless one leaks the mapping to whoever
//     coordinates it.)
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
  coinjoins?: Iterable<TxId>,
): Knowledge {
  const coins = new Map<CoinId, Attribution>();
  const txs = new Set<TxId>();

  // own wallet, past and present
  for (const c of chain.coins.values()) {
    if (c.owner === u) coins.set(c.id, { owner: u, direct: true });
  }

  // payments taken part in: eliminating one's own coins attributes the
  // rest — to the sole counterparty in a two-party form, and in a
  // settlement to whoever contributed it (coordination plus arithmetic
  // leave an insider no mystery about who signed what). A coinjoin is
  // the exception: with several strangers in the room, eliminating
  // one's own coins leaves everything else ambiguous among the rest —
  // an insider only learns where their own payment went.
  for (const ev of events) {
    if (ev.payer !== u && ev.payee !== u) continue;
    const tx = chain.txs.get(ev.tid);
    if (!tx) continue;
    txs.add(ev.tid);
    if (ev.form === "coinjoin") {
      if (ev.payer === u && ev.payee !== null) {
        for (const id of tx.outputs) {
          const c = chain.coins.get(id)!;
          if (c.owner === ev.payee) coins.set(id, { owner: c.owner, direct: true });
        }
      }
      continue;
    }
    for (const id of [...tx.inputs, ...tx.outputs]) {
      const c = chain.coins.get(id)!;
      if (c.owner !== u) coins.set(id, { owner: c.owner, direct: true });
    }
  }

  // coinjoin sessions the agent took part in without a payment of their
  // own: they know the transaction and its story, nothing about whose
  // coins the other inputs were
  for (const tid of coinjoins ?? []) {
    const tx = chain.txs.get(tid);
    if (tx?.inputs.some((id) => chain.coins.get(id)!.owner === u)) txs.add(tid);
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
