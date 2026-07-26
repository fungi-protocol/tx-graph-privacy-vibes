// What one participant actually knows about the graph. Two sources:
//   - their own wallet: every coin they ever owned, with its story;
//   - every payment they took part in: in a TWO-PARTY transaction a
//     counterparty can eliminate their own inputs and outputs, and
//     everything else is attributable to the other party — no protocol
//     can prevent that. Multiparty forms are different: what a
//     participant learns about the others depends on the protocol used
//     to construct the transaction. This town's settlements and
//     coinjoins are both built by anonymous broadcast in the
//     semi-honest setting — each input and each output submitted
//     independently, a protocol choice, not a law of nature — so
//     settlement participation records the transaction and the
//     participant's own coins only, and a coinjoin insider only learns
//     where their own payment went.
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

  // payments taken part in: in a two-party form (unilateral payment,
  // payjoin) eliminating one's own coins attributes the rest to the
  // sole counterparty — protocol-independent. In the multiparty forms
  // what a participant learns about the others depends on the protocol
  // that constructed the transaction, and this simulation does not
  // model that information exchange: a settlement records only the
  // transaction itself (the participant knows the obligations they are
  // on), and a coinjoin insider only learns where their own payment
  // went (sessions are arranged so nobody learns whose outputs are
  // whose).
  for (const ev of events) {
    if (ev.payer !== u && ev.payee !== u) continue;
    const tx = chain.txs.get(ev.tid);
    if (!tx) continue;
    txs.add(ev.tid);
    if (ev.form === "settlement") {
      // a settlement between exactly two people leaves nothing to a
      // protocol: each side eliminates their own coins and the rest is
      // the other's — the payjoin's arithmetic. With three or more,
      // what an insider learns about the others depends on the
      // protocol that constructed the transaction — here, anonymous
      // broadcast, which blinds insiders by construction — so only the
      // transaction itself is recorded. Knowing WHO you owe does not
      // tell you WHICH coins are theirs.
      const parts = new Set<number>();
      for (const e of events) {
        if (e.tid !== ev.tid || e.form !== "settlement") continue;
        parts.add(e.payer);
        if (e.payee !== null) parts.add(e.payee);
      }
      if (parts.size === 2) {
        for (const id of [...tx.inputs, ...tx.outputs]) {
          const c = chain.coins.get(id)!;
          if (c.owner !== u && parts.has(c.owner as number)) {
            coins.set(id, { owner: c.owner, direct: true });
          }
        }
      }
      continue;
    }
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
