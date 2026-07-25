// M1a: Alice's first payments — a hand-built miniature story that carries
// the skippable intro tutorial: what a transaction is, what a UTXO is, how
// a payment makes change, and where the fee goes.
import { Chain } from "../model/chain";
import { txfee } from "../core/sats";

export { CAST, OWNER_COLORS, OWNER_TEXT, EXTERNAL_COLOR } from "./cast";
export const ALICE = 0;
export const BOB = 1;

export function buildIntroChain(): Chain {
  const chain = new Chain();

  // Alice's coin arrives from a KYC exchange — one whole coin, not a balance
  chain.addRoot("r1", 1_000_000, ALICE, "exchange withdrawal");

  // t1: Alice pays Bob 250,000 for a used bike. Her 1M coin is consumed
  // whole; the transaction splits it: payment out, change back, fee gone.
  const fr1 = 2.0;
  chain.addTx("t1", 1, ["r1"], [
    { owner: BOB, value: 250_000, label: "used bike" },
    { owner: ALICE, value: 1_000_000 - 250_000 - txfee(1, 2, fr1), label: "change" },
  ], fr1, "Alice buys Bob's used bike");

  // t2: Alice pays a café from her change — the chain of custody continues
  const fr2 = 1.5;
  chain.addTx("t2", 2, ["t1o2"], [
    { owner: null, value: 12_400, label: "coffee & cake" },
    { owner: ALICE, value: (1_000_000 - 250_000 - txfee(1, 2, fr1)) - 12_400 - txfee(1, 2, fr2), label: "change" },
  ], fr2, "Alice buys coffee at a café");

  // t3: Bob spends the bike money onward (a repair shop, external)
  const fr3 = 3.0;
  chain.addTx("t3", 3, ["t1o1"], [
    { owner: null, value: 180_000, label: "wheel truing stand" },
    { owner: BOB, value: 250_000 - 180_000 - txfee(1, 2, fr3), label: "change" },
  ], fr3, "Bob buys a tool with the bike money");

  return chain;
}
