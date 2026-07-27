// The observer's vocabulary (#122c): the types the clustering pipeline
// speaks — links, clusterings, change readings, the heuristics switchboard,
// the tell bits — and the display vocabulary (cluster palette and labels)
// that renders them. One neutral module, so the pipeline (clusters.ts),
// the UI, tutorial defaults, and the fragment codec all derive from the
// same definitions instead of each holding a copy.
import { Chain, type CoinId, type TxId, type Owner, addrKey, addrText } from "../model/chain";

/** one observation the observer's map rests on: a method applied to a
 *  transaction linked these coins together.
 *
 *  Every link is an OWNERSHIP claim, and none of the methods proves
 *  ownership outright. CIOH and the change guess are ownership
 *  inferences from the start. The sub-transaction verdict is subtler:
 *  what a unique partition PROVES is value flow — which inputs funded
 *  which outputs — and reading each part as one owner is an assumption
 *  the observer layers on top (a part can still be a payment with
 *  change inside it). The `assumption` field names that extra step, so
 *  anything teaching from this ledger can state separately what the
 *  verdict establishes and what the observer assumes. This is also why
 *  `Clustering.links` is a ledger of ownership claims, not a complete
 *  general evidence ledger — the underlying flow verdicts live in the
 *  sub-transaction analysis itself. */
export interface Link {
  method: "reuse" | "cioh" | "change" | "subtx" | "remeet";
  /** the base observation: the transaction the method looked at. Absent
   *  on reuse links, whose observation is an address, not a transaction. */
  tx?: TxId;
  /** on a remeet link, the earlier session the linked coins were all
   *  issued by — the observation spans two transactions */
  via?: TxId;
  /** the reused address a reuse link rests on (its base observation) */
  addr?: string;
  /** the coins this single observation links into one owner */
  coins: CoinId[];
  /** the assumption the link adds beyond what the method's verdict
   *  establishes; present on subtx links, whose verdict alone proves
   *  flow, not ownership */
  assumption?: "one-owner-per-part";
  /** what a change link rests on: "residue" = the sole non-payment
   *  output left after payment identification; "radix" = a repeated
   *  denomination whose null hypothesis is a self-spend. On a subtx
   *  link, "bound" marks a forced pairing extracted from a mapping
   *  the analysis otherwise abstains on: an output larger than the
   *  rest of the inputs combined (or an input larger than the rest of
   *  the outputs) pairs the same way in every balanced reading */
  basis?: "residue" | "radix" | "bound";
}

export interface Clustering {
  /** coin -> its cluster's representative coin */
  rep: Map<CoinId, CoinId>;
  /** representative -> member coins, insertion order */
  members: Map<CoinId, CoinId[]>;
  /** representative -> 1-based rank by cluster size (1 = largest) */
  rank: Map<CoinId, number>;
  /** tx -> the outputs the observer guessed to be change; a plain
   *  2-output payment yields at most one, but a uniquely partitioned
   *  transaction gets the same rule per sub-transaction, so one tx can
   *  carry several guesses */
  changeGuess: Map<TxId, CoinId[]>;
  /** tx -> the outputs step one read as PAYMENTS (plausible amount, or
   *  an auxiliary attribution naming a different owner than a granted
   *  input). Recorded whether or not step two got to link anything —
   *  identification is per coin and does not presume clustered inputs. */
  payGuess: Map<TxId, CoinId[]>;
  /** tx -> the change/payment identification's full reading, one entry
   *  per sub-transaction analyzed (the whole transaction when no
   *  partition applies). This is the observer's own verdict — what it
   *  identified and, where it linked nothing, why it declined — kept so
   *  the display can caption each transaction with the reading instead
   *  of leaving the abstention silent. Empty when the change heuristic
   *  is off. */
  changeReads: Map<TxId, ChangeRead[]>;
  /** the ownership-link ledger — deliberately narrow, NOT a general
   *  evidence ledger (it cannot hold rejected candidates, seeds,
   *  relationship features, or propagation decisions; those get their
   *  own typed records): every link, in the order it was made. Links
   *  citing the same tx are correlated by construction — one
   *  observation, however many features it feeds — so disabling a
   *  method (or distrusting an observation) drops them together. */
  links: Link[];
}

/** One (sub-)transaction's change/payment identification verdict: what
 *  step one identified and what step two did about it. Everything here
 *  is the observer's own reading — no hidden truth leaks through. */
export interface ChangeRead {
  /** outputs step one read as payments */
  payments: CoinId[];
  /** radix self-spend defaults actually linked to the inputs */
  selfs: CoinId[];
  /** the sole remaining output linked as suspected change, if any */
  change?: CoinId;
  /** outputs step one left unidentified (step two's raw material) */
  unknowns: number;
  /** why step two linked nothing, when unidentified outputs remained:
   *  "inputs" — the inputs do not read as one cluster, so there is no
   *  single spender to hand change to; "mapping" — the sub-transaction
   *  mapping stayed underdetermined; "part" — a unique part's one-owner
   *  reading was refuted, so the part has no owner to link to; "batch"
   *  — several outputs remained, so the null reading is a batch payment;
   *  "bar" — a sole output remained but the payment evidence fell below
   *  the configured bar; "refuted" — the link was contradicted by held
   *  attributions. Absent when a link was made or nothing remained. */
  abstain?: "inputs" | "mapping" | "part" | "batch" | "bar" | "refuted";
}

/** Which heuristics the observer is running; all on by default. */
export interface Heuristics {
  /** link coins paid to the same address (inference-free: same address,
   *  same key). A toggle so the tutorial can stage it, not because a
   *  real observer would ever leave it off. */
  reuse?: boolean;
  cioh?: boolean;
  change?: boolean;
  subsum?: boolean;
  /** link inputs of a coinjoin-shaped transaction that were issued by
   *  one earlier coinjoin-shaped transaction (repeated co-membership):
   *  distinct users landing in the same two sessions by chance is the
   *  unlikely reading, one participant bringing their own coins back
   *  the plain one. The linked group also counts as one combined input
   *  in the sub-transaction analysis. A heuristic, not a proof: in a
   *  town this small the same users genuinely do re-meet by chance. */
  remeet?: boolean;
  /** which of the change heuristic's payment-identification tells run
   *  (a bitmask of the TELL_* bits); all of them by default. Each is
   *  one member of the real-world family — switching one off shows the
   *  others still voting. */
  changeTells?: number;
  /** the evidentiary bar for linking the sole non-payment output as
   *  change: how many DISTINCT enabled tell kinds (round dollars,
   *  round bitcoin, auxiliary attributions) must have fired across the
   *  sub-transaction's identified payment outputs before the link is
   *  made. 1 (the default) lets a single tell decide; higher bars
   *  demand corroboration between kinds, trading coverage for fewer
   *  wrong links. The radix self-spend link is a null hypothesis, not
   *  an inference from payment tells, so the bar does not gate it. */
  changeEvidence?: number;
  /** auxiliary attributions the observer holds (the #67 grant): coin →
   *  true owner. Read here two ways. As a payment identifier (through
   *  the aux tell): an output attributed to a different owner than a
   *  granted input is a payment (and never linked); one attributed to
   *  the same owner is a resolved self-spend, settled by the grant
   *  layer rather than a change link. And as a VETO on every heuristic
   *  link, regardless of which tells run: a link whose coins carry
   *  attributions naming two different owners is a known lie, and the
   *  observer discards the observation rather than act on it. The veto
   *  is what makes the aux slider's maximum coincide with omniscience —
   *  with every coin attributed, every wrong link is visibly wrong, and
   *  the grant layer's fusions finish the by-owner partition. */
  grants?: ReadonlyMap<CoinId, Owner>;
  /** CIOH abstains on transactions with more inputs than this: a cheap
   *  guard against the heuristic's worst failure mode, since honest
   *  wallets rarely co-spend that many coins while collaborative
   *  transactions routinely do. Undefined = no cap. */
  ciohMaxInputs?: number;
  /** read wallet fingerprints (the statistical-fingerprinting knob):
   *  a wallet keeps its addresses in one script type, so a spend
   *  whose INPUTS sit on two families reads as two wallets' coins in
   *  one transaction — probable collaboration (Sabouri 2026: fingerprints
   *  that partition the inputs restore what the payjoin broke; Ghesmati
   *  et al. 2022 for the detection framing). Every one-owner reading of
   *  such a transaction is suspect, so CIOH and the sub-transaction
   *  analysis's one-owner-per-part links abstain on it. A heuristic,
   *  not a proof: a wallet migration puts one user's own coins on two
   *  families, and co-spending them misfires this check — the observer
   *  then MISSES a true link (an abstention, so the mistakes grading,
   *  which judges only links made, never flags it). */
  fingerprints?: boolean;
  /** transactions whose evidence is set aside entirely — the map "the
   *  rest of the record" builds without them. Used to ask whether one
   *  transaction's CIOH reading contradicts everything else the
   *  observer holds (payjoin detection). */
  except?: Set<TxId>;
}

/** The change heuristic's payment-identification tells, individually
 *  switchable (Heuristics.changeTells): round dollars, round bitcoin,
 *  auxiliary attribution, and the script-type tell — an output paying
 *  a script type none of the inputs use reads as the payment. */
export const TELL_USD = 1, TELL_BTC = 2, TELL_AUX = 4, TELL_SCRIPT = 8, TELL_ALL = 15;

// which heuristics the observer lens runs, as a bitmask:
// 1 = CIOH, 2 = change identification, 4 = sub-transaction analysis,
// 8 = address reuse;
// default all of them.
// With all off the union-find never fires, every coin is a singleton, and
// the observer's map degrades honestly into the bare public structure.
export const OV_CIOH = 1, OV_CHANGE = 2, OV_SUBSUM = 4, OV_REUSE = 8, OV_REMEET = 16, OV_ALL = 31;
// CIOH's max-inputs cap: transactions with more inputs than this are
// not linked by CIOH. The slider's top position means "no cap".
export const CIOH_MAX_OFF = 10;
// the change link's evidentiary bar (#66): how many payment tells the
// sub-transaction's identified payments must total before the sole
// remaining unknown output is linked as change. 1 = a single round
// amount decides; higher bars trade coverage for fewer wrong links.
export const CHANGE_EV_MAX = 4;

// a palette deliberately different from the owner colors: the observer's
// map is not the truth, and should not look like it
export const CLUSTER_COLORS = ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
  "#ffd92f", "#e5c494", "#80b1d3", "#fb8072", "#b3de69", "#bc80bd", "#ccebc5"];
/** fill for singleton / low-rank clusters the observer has nothing on */
export const CLUSTER_MISC = "#565b64";

export function clusterColor(cl: Clustering, id: CoinId): string {
  const r = cl.rep.get(id);
  if (r === undefined) return CLUSTER_MISC;
  if (cl.members.get(r)!.length < 2) return CLUSTER_MISC;
  const rk = cl.rank.get(r)!;
  return CLUSTER_COLORS[(rk - 1) % CLUSTER_COLORS.length]!;
}

export function clusterLabel(cl: Clustering, id: CoinId): string {
  const r = cl.rep.get(id);
  if (r === undefined || cl.members.get(r)!.length < 2) return "";
  return `cluster ${cl.rank.get(r)}`;
}

/**
 * The record as an outsider reads it (#122d): value, structure, and the
 * public face of the address — an opaque equality key and the published
 * text, plus the script type that face shows. The truth fields a Coin
 * carries for the storyteller (owner, funders, kyc, label, Addr.who) do
 * not exist on this shape, so a heuristic typed against it cannot read
 * them even by accident — the latent-truth rule enforced at compile time.
 */
export interface PublicCoin {
  readonly id: CoinId;
  readonly value: number;
  readonly producer: TxId | null;
  readonly dest: TxId | null;
  /** the day a root entered from outside; undefined = pre-story savings */
  readonly entered?: number;
  /** canonical equality key for the address (opaque: compare, never parse) */
  readonly addrKey?: string;
  /** the address as the chain publishes it */
  readonly addrText?: string;
  /** the script type, public on the face of the address */
  readonly script?: string;
}

/** a transaction minus its narrative memo — every field the record shows */
export interface PublicTx {
  readonly id: TxId;
  readonly timestep: number;
  readonly inputs: readonly CoinId[];
  readonly outputs: readonly CoinId[];
  readonly feerate: number;
  readonly fee: number;
  readonly locktime?: "tip" | "zero";
  readonly sigLowR?: readonly boolean[];
  readonly minute?: number;
}

/** the whole public record, in confirmation order — what an outsider
 *  heuristic is handed instead of the truth-bearing Chain */
export interface ObserverRecord {
  readonly coins: ReadonlyMap<CoinId, PublicCoin>;
  readonly txs: ReadonlyMap<TxId, PublicTx>;
  readonly order: readonly TxId[];
}

/**
 * Project a Chain down to its public record: one pass, new PublicCoin
 * views with the address reduced to its opaque key, published text, and
 * script type. The heuristics that must stay truth-blind take this (or
 * build it themselves from a Chain handed in at the boundary).
 */
export function publicRecord(chain: Chain): ObserverRecord {
  const coins = new Map<CoinId, PublicCoin>();
  for (const c of chain.coins.values()) {
    coins.set(c.id, {
      id: c.id, value: c.value, producer: c.producer, dest: c.dest,
      entered: c.entered,
      addrKey: c.addr ? addrKey(c.addr) : undefined,
      addrText: c.addr ? addrText(c.addr) : undefined,
      script: c.addr?.script,
    });
  }
  return { coins, txs: chain.txs, order: chain.order };
}
