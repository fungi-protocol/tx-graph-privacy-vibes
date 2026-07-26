// The presentation model's knowledge boundary. A Paint says what a lens
// is entitled to draw about each entity: fills, captions, memos, and
// transaction attribution. Renderers consume a Paint and know nothing
// about owners, casts, clusters, or stories — the composition of
// knowledge into a Paint happens in the app shell, never down here.
import { type Chain, type Coin, type Tx } from "../model/chain";

export interface Paint {
  coinFill(coin: Coin): string;
  coinText(coin: Coin): string;
  coinCaption(coin: Coin): string;
  txMemo(tx: Tx): string | null;
  /** when every input belongs to one cluster/owner under this lens, the
   *  transaction itself is attributable — tint it that color */
  txAttribution?(tx: Tx, chain: Chain): string | null;
  /** storyteller's grading of this lens's own inferences: a short line
   *  marking a transaction where a local inference is wrong against the
   *  hidden truth (e.g. the change guess picked the payment output).
   *  Rendered as a warning on the transaction; null = no mistake */
  txFlag?(tx: Tx): string | null;
}

/**
 * The base of every lens: public chain data only. Amounts, fees, and
 * structure are drawn; nothing is colored, captioned, or narrated,
 * because the chain itself says nothing more. Every other paint is this
 * plus some claimed knowledge.
 */
export const STRUCTURE: Paint = {
  coinFill: () => "#565b64",
  coinText: () => "#e6e8ec",
  coinCaption: () => "",
  txMemo: () => null,
};

/** Attribution helper: the common fill of all input coins, or null. */
export function commonInputFill(chain: Chain, tx: Tx, fill: (c: Coin) => string): string | null {
  let color: string | null = null;
  for (const cid of tx.inputs) {
    const f = fill(chain.coins.get(cid)!);
    if (color === null) color = f;
    else if (color !== f) return null;
  }
  return color;
}
