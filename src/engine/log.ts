// The simulation's primary state: one append-only event log (#126),
// kappa-style — much like the blockchain itself, the log records what
// happened and nothing else. Every chain mutation enters through it;
// the Chain the rest of the code reads is a DERIVED index, updated
// incrementally as events append (Chain.addRoot/addTx are the appliers).
// Rewinding time is a prefix of the log: replaying the first n events
// into a fresh chain reproduces the world as it stood, and the time
// cursor's shared-object view (Chain.through) is an efficient equivalent
// over the same index — log.test.ts holds the two to each other.
// Retroactive decorations (addresses, wallet traits, minutes, exchange
// routing) stay derived too: pure functions of seed + record, applied by
// Economy.decorate to the live index and to replayed prefixes alike.
import { Chain, type Coin, type CoinId, type Tx, type TxId, type Owner } from "../model/chain";
import { type Sats } from "../core/sats";

export type PaymentForm = "unilateral" | "payjoin" | "settlement" | "coinjoin";

/** narrative annotation riding the log alongside the record: who paid
 *  whom, in what form, and why — the town's truth, not the chain's */
export interface EconomyEvent {
  tid: string;
  day: number;
  payer: number;
  /** participant index, or null for an external merchant */
  payee: number | null;
  memo: string;
  form: PaymentForm;
  /** narrative rationale shown in the inspector */
  why: string;
  /** stable schedule IDs of the obligations this event settles, if any */
  oblIds?: string[];
}

/** one output as the log records it — what addTx is told, verbatim */
export interface OutputSpec {
  owner: Owner;
  value: Sats;
  label?: string;
  funders?: Owner[];
}

/** what happened, in order. "root" and "tx" build the chain; "note"
 *  carries the narrative annotations. Days never decrease along the log. */
export type SimEvent =
  | { k: "root"; id: CoinId; value: Sats; owner: Owner; label?: string; entered?: number }
  | { k: "tx"; id: TxId; day: number; inputs: CoinId[]; outputs: OutputSpec[];
      feerate: number; memo?: string }
  | { k: "note"; note: EconomyEvent };

/** the day an event lies on, for prefix slicing; construction-time roots
 *  (no entry day) read as day 0 */
export function eventDay(e: SimEvent): number {
  return e.k === "root" ? (e.entered ?? 0) : e.k === "tx" ? e.day : e.note.day;
}

export class EventLog {
  /** the primary state — append only, day-monotonic */
  readonly events: SimEvent[] = [];
  /** derived: the chain index, updated per append */
  readonly chain = new Chain();
  /** derived: the narrative annotations, in log order */
  readonly notes: EconomyEvent[] = [];

  /** append a root-entered event; the index applies it (and rejects it
   *  whole if invalid — nothing invalid is ever recorded) */
  root(id: CoinId, value: Sats, owner: Owner, label?: string, entered?: number): Coin {
    const coin = this.chain.addRoot(id, value, owner, label, entered);
    this.events.push({ k: "root", id, value, owner, label, entered });
    return coin;
  }

  /** append a transaction event; same apply-then-record discipline */
  tx(id: TxId, day: number, inputs: CoinId[], outputs: OutputSpec[],
     feerate: number, memo?: string): Tx {
    const tx = this.chain.addTx(id, day, inputs, outputs, feerate, memo);
    this.events.push({ k: "tx", id, day, inputs: [...inputs], outputs: outputs.map((o) => ({ ...o })), feerate, memo });
    return tx;
  }

  /** append a narrative annotation */
  note(note: EconomyEvent): void {
    this.events.push({ k: "note", note });
    this.notes.push(note);
  }

  /** the prefix length covering everything through the end of `day` —
   *  the rewind rule: a slice of the log IS the log of the earlier world */
  prefixThrough(day: number): number {
    let n = 0;
    while (n < this.events.length && eventDay(this.events[n]!) <= day) n += 1;
    return n;
  }

  /** replay the first n events into a fresh, undecorated chain — the
   *  derived index rebuilt from scratch. replay(events.length) must equal
   *  the live index; replay(prefixThrough(d)) is the world at day d. */
  replay(n = this.events.length): Chain {
    const c = new Chain();
    for (const e of this.events.slice(0, n)) {
      if (e.k === "root") c.addRoot(e.id, e.value, e.owner, e.label, e.entered);
      else if (e.k === "tx") c.addTx(e.id, e.day, e.inputs, e.outputs, e.feerate, e.memo);
    }
    return c;
  }
}
