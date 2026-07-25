// The all-seeing paint: the storyteller's own knowledge — true owners,
// their colors, and the narrative labels and memos. This is scenario
// presentation; renderers never import it, the app shell passes it in.
import { type Coin } from "../model/chain";
import { type Paint, commonInputFill } from "../ui/paint";
import { OWNER_TEXT, EXTERNAL_COLOR, CAST } from "./intro";
import { ownerColor } from "./cast";

let castNames: readonly string[] = CAST;
/** captions track the live town: economies with a grown cast register it here */
export function setCastNames(names: readonly string[]): void {
  castNames = names;
}

export function castName(owner: number | null): string {
  return owner === null ? "external" : castNames[owner] ?? `resident #${owner + 1}`;
}

export function coinColor(coin: Coin): string {
  return coin.owner === null ? EXTERNAL_COLOR : ownerColor(coin.owner);
}

export const OMNISCIENT: Paint = {
  coinFill: coinColor,
  coinText: (c) => (c.owner === null ? "#111" : OWNER_TEXT[c.owner] ?? "#111"),
  coinCaption: (c) => `${castName(c.owner)}${c.label ? " · " + c.label : ""}`,
  txMemo: (t) => t.memo ?? null,
  txAttribution: (t, ch) => commonInputFill(ch, t, coinColor),
};
