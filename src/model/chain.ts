// The transaction graph: coins (transaction outputs) and the transactions
// that produce and consume them. Owners are participant indices; null owner
// marks an external party outside the simulated population.
import { type Sats, txfee } from "../core/sats";

export type CoinId = string;
export type TxId = string;
export type Owner = number | null;

export interface Coin {
  id: CoinId;
  value: Sats;
  owner: Owner;
  producer: TxId | null;   // null = root (entered the slice from outside)
  dest: TxId | null;       // null = unspent
  label?: string;          // narrative tag, e.g. "exchange withdrawal"
  /** the day a root entered from outside; undefined = pre-story savings */
  entered?: number;
  /**
   * Ground truth: whose funds this output carries — the entities whose
   * inputs paid for it. Usually a single entity; a payjoin's payment
   * output has two (payer and payee both contributed). All inputs owned
   * by a funder share equal linkage with every output that funder funded,
   * so the true flow of funds steps from an output to the producing
   * transaction's inputs owned by any of its funders. Roots have no
   * producer and hence no funders (empty).
   */
  funders: Owner[];
}

export interface Tx {
  id: TxId;
  timestep: number;
  inputs: CoinId[];
  outputs: CoinId[];
  feerate: number;
  fee: Sats;
  memo?: string;           // narrative: what this transaction was for
}

export class Chain {
  coins = new Map<CoinId, Coin>();
  txs = new Map<TxId, Tx>();
  order: TxId[] = [];      // insertion order = confirmation order

  addRoot(id: CoinId, value: Sats, owner: Owner, label?: string, entered?: number): Coin {
    if (this.coins.has(id)) throw new Error(`duplicate coin ${id}`);
    if (value <= 0) throw new Error(`coin ${id} value ${value}`);
    const coin: Coin = { id, value, owner, producer: null, dest: null, label, entered, funders: [] };
    this.coins.set(id, coin);
    return coin;
  }

  /**
   * Append a transaction. Outputs are (owner, value) pairs; fee must be
   * exactly inputs − outputs and match ceil(vsize × feerate).
   *
   * `funders` on an output records the ground truth of whose funds it
   * carries (see Coin.funders); when omitted it defaults to the distinct
   * owners of the inputs — correct for every single-entity transaction.
   * Forms where outputs are funded by a strict subset of the input owners
   * (coinjoins, settlements, payjoins) must say so explicitly.
   */
  addTx(
    id: TxId,
    timestep: number,
    inputIds: CoinId[],
    outputs: { owner: Owner; value: Sats; label?: string; funders?: Owner[] }[],
    feerate: number,
    memo?: string,
  ): Tx {
    // validate everything before mutating anything: a rejected transaction
    // must leave the chain exactly as it found it
    if (this.txs.has(id)) throw new Error(`duplicate tx ${id}`);
    if (inputIds.length === 0) throw new Error(`${id}: no inputs`);
    const seen = new Set<CoinId>();
    let inValue = 0;
    for (const cid of inputIds) {
      if (seen.has(cid)) throw new Error(`${id}: input ${cid} listed twice`);
      seen.add(cid);
      const coin = this.coins.get(cid);
      if (!coin) throw new Error(`${id}: unknown input ${cid}`);
      if (coin.dest !== null) throw new Error(`${id}: double-spend of ${cid}`);
      inValue += coin.value;
    }
    const outValue = outputs.reduce((sum, o) => sum + o.value, 0);
    const fee = inValue - outValue;
    const want = txfee(inputIds.length, outputs.length, feerate);
    if (fee !== want) {
      throw new Error(`${id}: fee ${fee} != ${want} (${inputIds.length}-in/${outputs.length}-out @ ${feerate})`);
    }
    const inputOwners = new Set(inputIds.map((cid) => this.coins.get(cid)!.owner));
    for (const o of outputs) {
      if (o.value <= 0) throw new Error(`${id}: output value ${o.value}`);
      if (o.funders) {
        if (o.funders.length === 0) throw new Error(`${id}: output with empty funders`);
        if (new Set(o.funders).size !== o.funders.length) throw new Error(`${id}: duplicate funder`);
        for (const f of o.funders) {
          if (!inputOwners.has(f)) throw new Error(`${id}: funder ${f ?? "x"} owns no input`);
        }
      }
    }
    const outIds: CoinId[] = outputs.map((_, i) => `${id}o${i + 1}`);
    for (const cid of outIds) {
      if (this.coins.has(cid)) throw new Error(`duplicate coin ${cid}`);
    }

    // commit
    for (const cid of inputIds) this.coins.get(cid)!.dest = id;
    outputs.forEach((o, i) => {
      this.coins.set(outIds[i]!, {
        id: outIds[i]!, value: o.value, owner: o.owner, producer: id, dest: null,
        label: o.label, funders: o.funders ?? [...inputOwners],
      });
    });
    const tx: Tx = { id, timestep, inputs: [...inputIds], outputs: outIds, feerate, fee, memo };
    this.txs.set(id, tx);
    this.order.push(id);
    return tx;
  }

  utxos(): Coin[] {
    return [...this.coins.values()].filter((c) => c.dest === null);
  }

  /**
   * The chain as it stood at the end of `day` — the time cursor's view.
   * Transactions after the cursor vanish; a coin whose spend lies in the
   * future reads as unspent again. Coins and txs at or before the cursor
   * are shared (not copied), so positions looked up by id in a
   * full-history layout still resolve: rewinding hides later data
   * without moving anything that stays visible.
   */
  through(day: number): Chain {
    const c = new Chain();
    for (const tid of this.order) {
      const tx = this.txs.get(tid)!;
      if (tx.timestep > day) continue;
      c.txs.set(tid, tx);
      c.order.push(tid);
    }
    for (const coin of this.coins.values()) {
      if (coin.producer !== null ? !c.txs.has(coin.producer) : (coin.entered ?? 0) > day) continue;
      const spentLater = coin.dest !== null && !c.txs.has(coin.dest);
      c.coins.set(coin.id, spentLater ? { ...coin, dest: null } : coin);
    }
    return c;
  }

  /** Stable content digest input for determinism checks. */
  describe(): string {
    const parts: string[] = [];
    for (const tid of this.order) {
      const tx = this.txs.get(tid)!;
      parts.push(`${tid}@${tx.timestep}[${tx.inputs.join("+")}=>${tx.outputs
        .map((o) => `${o}:${this.coins.get(o)!.value}:${this.coins.get(o)!.owner ?? "x"}`)
        .join(",")}]fee${tx.fee}`);
    }
    return parts.join(";");
  }
}
