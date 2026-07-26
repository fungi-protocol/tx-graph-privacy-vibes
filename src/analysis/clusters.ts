// Third-party observer clustering: what someone with no names and no colors
// can infer from the public graph alone. Address reuse first — the one
// linkage that is not a heuristic at all: two coins paid to the same
// address are controlled by the same key, on the face of the record
// (the whitepaper's §10 urges a new key pair per transaction for exactly
// this reason, and reading reused addresses was the first clustering
// lever anyone pulled). Then three heuristics from the
// literature, deliberately simple:
//   - CIOH (common-input-ownership): a transaction spending several inputs
//     is evidence one entity owns all of them. The whitepaper's own §10
//     caveat ("multi-input transactions... necessarily reveal that their
//     inputs were owned by the same owner"); Meiklejohn et al. named it
//     Heuristic 1 and ran it at chain scale.
//   - change identification (the wiki's "round numbers" fingerprint;
//     change heuristics generally: Androulaki et al., Meiklejohn et
//     al.), specified in two steps. Step one identifies PAYMENT
//     outputs, per coin, within a sub-transaction (the whole
//     transaction when no partition applies): an amount that is
//     plausibly a payment — low decimal hamming weight in dollars at
//     that day's rate or in BTC ($40, 0.05 BTC; not $37.63) — or an
//     output reliably attributed to a different owner than a granted
//     input by auxiliary information. (A third real-world tell, a
//     script type differing from the inputs', has no purchase here:
//     this town's script types are uniform by construction.) Step two
//     is generic linkage over what remains: payment outputs are
//     assumed NOT to be linked to the inputs; if exactly ONE
//     non-payment output remains it is suspected as change and linked,
//     provided the payment identifications clear the configured
//     evidentiary bar; if several remain, some payments may have been
//     missed, so the null hypothesis is a batch payment and the
//     observer abstains. Two further real-world identifiers are named
//     but not modeled: a script type differing from the input
//     cluster's (contingent on the inputs having been clustered), and
//     — for an output that has itself been spent — cluster feature
//     vectors (nLockTime conventions, signature grinding, temporal
//     habits) differing from the input cluster's.
//     One inversion: where the outputs show a radix
//     coinjoin structure — menu denominations with repeated values —
//     a repeated denomination's null hypothesis flips to SELF-SPEND
//     (that is the point of taking one's balance back in standard
//     denominations), so it is treated like change and linked to the
//     input cluster unless there is evidence it is a payment.
//   - sub-transaction analysis (the sub-transaction model, Maurer et
//     al.): a transaction
//     with several outputs is checked for partitions into balancing
//     sub-transactions. A unique partition welds each part — inputs AND
//     outputs — together (stronger than CIOH); several valid partitions
//     mean the mapping is underdetermined, and a careful observer
//     declines to weld anything at all.
// Heuristics, not proofs: the change guess can be wrong, and when it is
// wrong it welds a stranger's coin into the cluster. That failure mode is
// left in on purpose.
import { type Chain, type CoinId, type TxId, type Owner, addrKey, addrText } from "../model/chain";
import { type Sats } from "../core/sats";
import { isDenomination } from "../denom/denominations";
import { subTransactionMapping } from "./subsetsum";

/** one observation the observer's map rests on: a method applied to a
 *  transaction welded these coins together.
 *
 *  Every weld is an OWNERSHIP claim, and none of the methods proves
 *  ownership outright. CIOH and the change guess are ownership
 *  inferences from the start. The sub-transaction verdict is subtler:
 *  what a unique partition PROVES is value flow — which inputs funded
 *  which outputs — and reading each part as one owner is an assumption
 *  the observer layers on top (a part can still be a payment with
 *  change inside it). The `assumption` field names that extra step, so
 *  anything teaching from this ledger can state separately what the
 *  verdict establishes and what the observer assumes. This is also why
 *  `Clustering.welds` is a ledger of ownership claims, not a complete
 *  general evidence ledger — the underlying flow verdicts live in the
 *  sub-transaction analysis itself. */
export interface Weld {
  method: "reuse" | "cioh" | "change" | "subtx";
  /** the base observation: the transaction the method looked at. Absent
   *  on reuse welds, whose observation is an address, not a transaction. */
  tx?: TxId;
  /** the reused address a reuse weld rests on (its base observation) */
  addr?: string;
  /** the coins this single observation welds into one owner */
  coins: CoinId[];
  /** the assumption the weld adds beyond what the method's verdict
   *  establishes; present on subtx welds, whose verdict alone proves
   *  flow, not ownership */
  assumption?: "one-owner-per-part";
  /** what a change weld rests on: "residue" = the sole non-payment
   *  output left after payment identification; "radix" = a repeated
   *  denomination whose null hypothesis is a self-spend */
  basis?: "residue" | "radix";
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
  /** the ownership-weld ledger — deliberately narrow, NOT a general
   *  evidence ledger (it cannot hold rejected candidates, seeds,
   *  relationship features, or propagation decisions; those get their
   *  own typed records): every weld, in the order it was made. Welds
   *  citing the same tx are correlated by construction — one
   *  observation, however many features it feeds — so disabling a
   *  method (or distrusting an observation) drops them together. */
  welds: Weld[];
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
  /** which of the change heuristic's payment-identification tells run
   *  (a bitmask of the TELL_* bits); all of them by default. Each is
   *  one member of the real-world family — switching one off shows the
   *  others still voting. */
  changeTells?: number;
  /** the evidentiary bar for linking the sole non-payment output as
   *  change: how many DISTINCT enabled tell kinds (round dollars,
   *  round bitcoin, auxiliary attributions) must have fired across the
   *  sub-transaction's identified payment outputs before the weld is
   *  made. 1 (the default) lets a single tell decide; higher bars
   *  demand corroboration between kinds, trading coverage for fewer
   *  wrong welds. The radix self-spend link is a null hypothesis, not
   *  an inference from payment tells, so the bar does not gate it. */
  changeEvidence?: number;
  /** auxiliary attributions the observer holds (the #67 grant): coin →
   *  true owner. Read here ONLY as a payment identifier — an output
   *  attributed to a different owner than a granted input is a payment
   *  (and never linked); one attributed to the same owner is a
   *  resolved self-spend, settled by the grant layer rather than a
   *  change weld. */
  grants?: ReadonlyMap<CoinId, Owner>;
  /** CIOH abstains on transactions with more inputs than this: a cheap
   *  guard against the heuristic's worst failure mode, since honest
   *  wallets rarely co-spend that many coins while collaborative
   *  transactions routinely do. Undefined = no cap. */
  ciohMaxInputs?: number;
  /** transactions whose evidence is set aside entirely — the map "the
   *  rest of the record" builds without them. Used to ask whether one
   *  transaction's CIOH reading contradicts everything else the
   *  observer holds (payjoin detection). */
  except?: Set<TxId>;
}

/** The change heuristic's payment-identification tells, individually
 *  switchable (Heuristics.changeTells). The script-type tell is real
 *  but has nothing to bite here — this town's script types are uniform
 *  by construction — so it is named in prose, not modeled as a bit. */
export const TELL_USD = 1, TELL_BTC = 2, TELL_AUX = 4, TELL_ALL = 7;

/** decimal hamming weight: how many nonzero digits the integer has */
function decHW(n: number): number {
  let w = 0;
  for (let x = Math.round(n); x > 0; x = Math.floor(x / 10)) {
    if (x % 10 !== 0) w += 1;
  }
  return w;
}

/**
 * The plausible-payment-amount tell, applied per coin: prices are set
 * by people, so a value that lands on a round multiple of $10 at that
 * day's rate reads as a payment ($40, not $37.63) — and so does a
 * value round in BTC terms (decimal hamming weight 1: 0.05 BTC, not
 * 0.0473). Real analysts extend the family to related figures like
 * $19.99 plus sales tax; this town's prices are round enough not to
 * need them. A guess about the AMOUNT only — what it means for the
 * coin depends on context (the same round BTC figure that reads as a
 * payment alone reads as a self-spend among repeated denominations).
 */
export function plausiblePayment(value: Sats, price?: number, tells = TELL_ALL): boolean {
  if ((tells & TELL_BTC) !== 0 && decHW(value) <= 1) return true;
  if ((tells & TELL_USD) === 0 || price === undefined) return false;
  const usd = (value * price) / 1e8;
  return Math.abs(usd - Math.round(usd / 10) * 10) < 0.05;
}

/** which amount-tell kinds fire on this value — the bar counts kinds */
function amountKinds(value: Sats, price: number | undefined, tells: number): number {
  let k = 0;
  if ((tells & TELL_BTC) !== 0 && decHW(value) <= 1) k |= TELL_BTC;
  if ((tells & TELL_USD) !== 0 && price !== undefined) {
    const usd = (value * price) / 1e8;
    if (Math.abs(usd - Math.round(usd / 10) * 10) < 0.05) k |= TELL_USD;
  }
  return k;
}

/**
 * Cluster the chain as a third-party observer would.
 * `usdPrice(day)` is the public exchange rate; omit it (or return
 * undefined) to withhold the change heuristic's round-USD amount tell
 * (its other tells — round-BTC amounts, auxiliary attributions, the
 * radix structure — do not need a rate).
 * `heuristics` switches individual heuristics off — with all of them off
 * every coin stays a singleton and only the public structure remains.
 */
export function clusterObserver(
  chain: Chain,
  usdPrice?: (day: number) => number | undefined,
  heuristics: Heuristics = {},
): Clustering {
  const { reuse = true, cioh = true, change = true, subsum = true } = heuristics;
  const bar = heuristics.changeEvidence ?? 1;
  const tellsOn = heuristics.changeTells ?? TELL_ALL;
  // the grant is read as a payment identifier only through the aux tell
  const grants = (tellsOn & TELL_AUX) !== 0 ? heuristics.grants : undefined;
  const parent = new Map<CoinId, CoinId>();
  for (const id of chain.coins.keys()) parent.set(id, id);
  const find = (x: CoinId): CoinId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (a: CoinId, b: CoinId): void => {
    parent.set(find(a), find(b));
  };

  const changeGuess = new Map<TxId, CoinId[]>();
  const payGuess = new Map<TxId, CoinId[]>();
  const welds: Weld[] = [];
  // address reuse first: the observer's address index is complete before a
  // single transaction is read. Coins paid to the same address are
  // controlled by the same key, so linking them is reading the record, not
  // inferring from it — the weld carries no assumption that could be
  // wrong. Addresses are compared as opaque identifiers; nothing here
  // reads whose they are.
  if (reuse) {
    const byAddr = new Map<string, CoinId[]>();
    for (const coin of chain.coins.values()) {
      if (!coin.addr) continue;
      const k = addrKey(coin.addr);
      const l = byAddr.get(k);
      if (l) l.push(coin.id);
      else byAddr.set(k, [coin.id]);
    }
    for (const coins of byAddr.values()) {
      if (coins.length < 2) continue;
      for (let i = 1; i < coins.length; i++) union(coins[i]!, coins[0]!);
      welds.push({
        method: "reuse",
        addr: addrText(chain.coins.get(coins[0]!)!.addr!),
        coins: [...coins],
      });
    }
  }
  for (const tid of chain.order) {
    if (heuristics.except?.has(tid)) continue;
    const tx = chain.txs.get(tid)!;
    const price = change ? usdPrice?.(tx.timestep) : undefined;
    // the radix structure is read off the WHOLE transaction's outputs:
    // menu denominations appearing more than once. Within such a
    // structure a repeated denomination's null hypothesis is a
    // self-spend — someone taking their balance back in standard
    // values — so the amount tell that would otherwise read it as a
    // payment is inverted.
    const denomCount = new Map<Sats, number>();
    if (change) {
      for (const o of tx.outputs) {
        const v = chain.coins.get(o)!.value;
        if (isDenomination(v)) denomCount.set(v, (denomCount.get(v) ?? 0) + 1);
      }
    }
    // the two-step change identification, shared between the plain
    // transaction and each sub-transaction of a unique partition.
    // Step one classifies every output of the sub-transaction:
    // payments (a plausible payment amount, or an auxiliary
    // attribution naming a different owner than a granted input),
    // self-spends resolved by an attribution matching a granted
    // input's owner (settled by the grant layer, no weld here), and
    // unknowns. Step two links: payments are assumed NOT to belong
    // with the inputs; a sole unknown is suspected change and links if
    // the payment tells clear the evidentiary bar; several unknowns
    // read as a batch payment — some payments may have been missed —
    // and the observer abstains. Where the transaction's outputs show
    // a RADIX COINJOIN STRUCTURE (repeated menu denominations) the
    // null hypothesis inverts: a menu value's amount tell is void —
    // taking one's balance back in standard denominations is exactly
    // what produces those values — and every output without payment
    // evidence defaults to self-spend, treated like change and linked
    // to the input cluster. `linked` says whether the inputs already
    // read as one cluster (`anchor` stands in for them): step two's
    // welds are contingent on it, step one's identifications are not.
    const radixStructure = [...denomCount.values()].some((n) => n >= 2);
    const identifyAndLink = (outs: CoinId[], ins: CoinId[], anchor: CoinId, linked: boolean): void => {
      const inOwners = new Set<Owner>();
      for (const i of ins) {
        const g = grants?.get(i);
        if (g !== undefined) inOwners.add(g);
      }
      const payments: CoinId[] = [];
      let kinds = 0; // TELL_* bits that fired across the identified payments
      const selfs: CoinId[] = [];
      const unknowns: CoinId[] = [];
      for (const o of outs) {
        const v = chain.coins.get(o)!.value;
        const g = grants?.get(o);
        // inside a radix structure a menu denomination is what a
        // self-spend looks like, so its amount says nothing
        const amount = radixStructure && isDenomination(v) ? 0 : amountKinds(v, price, tellsOn);
        if (g !== undefined && inOwners.size > 0) {
          // an auxiliary attribution outranks the amount guess in both
          // directions: a different owner is a payment however the
          // amount reads; the same owner is a self-spend already
          // settled by the grant layer, so no change weld is needed
          if (!inOwners.has(g)) {
            payments.push(o);
            kinds |= TELL_AUX | amount;
          }
        } else if (amount !== 0) {
          payments.push(o);
          kinds |= amount;
        } else if (radixStructure) {
          selfs.push(o); // the inverted null hypothesis: self-spend
        } else {
          unknowns.push(o);
        }
      }
      if (payments.length > 0) {
        const p = payGuess.get(tid);
        if (p) p.push(...payments);
        else payGuess.set(tid, [...payments]);
      }
      if (!linked) return; // no single "whoever paid" to hand anything to
      // the radix null hypothesis links self-spends like change — but
      // they are default readings, not change guesses, so they join
      // the weld ledger without entering changeGuess; and a weld is
      // recorded only where it links something new (inside a unique
      // part the part weld already claims these coins)
      for (const s of selfs) {
        if (find(s) !== find(anchor)) {
          union(s, anchor);
          welds.push({ method: "change", tx: tid, coins: [s, anchor], basis: "radix" });
        }
      }
      // the bar counts distinct tell KINDS that fired — corroboration
      // between kinds, not repetition within one
      const evidence = ((kinds & TELL_USD) !== 0 ? 1 : 0) +
        ((kinds & TELL_BTC) !== 0 ? 1 : 0) + ((kinds & TELL_AUX) !== 0 ? 1 : 0);
      if (unknowns.length === 1 && evidence >= bar) {
        const guess = unknowns[0]!;
        const g = changeGuess.get(tid);
        if (g) g.push(guess);
        else changeGuess.set(tid, [guess]);
        union(guess, anchor);
        welds.push({ method: "change", tx: tid, coins: [guess, anchor], basis: "residue" });
      }
    };
    // multi-output spends get the sub-transaction treatment first: a unique
    // sub-transaction partition beats CIOH (and identifies outputs too);
    // an underdetermined one suspends it — outputs link to inputs only
    // if the mapping is determined. The >=3-output gate keeps payjoins
    // and settlements on their own heuristics; a 2-output multiparty
    // join (the doc's 4-in/2-out bad coinjoin) would slip past it into
    // CIOH, but no form here produces that shape
    if (subsum && tx.inputs.length >= 2 && tx.outputs.length >= 3) {
      const value = (id: CoinId): number => chain.coins.get(id)!.value;
      const map = subTransactionMapping(tx.inputs.map(value), tx.outputs.map(value), tx.fee);
      if (map.kind === "unique") {
        for (const part of map.parts) {
          const anchor = tx.inputs[part.ins[0]!]!;
          const coins = [
            ...part.ins.map((i) => tx.inputs[i]!),
            ...part.outs.map((o) => tx.outputs[o]!),
          ];
          for (const c of coins) union(c, anchor);
          // the unique partition proves the FLOW; welding the part into
          // one owner adds the assumption that each sub-transaction is a
          // self-contained single-owner action. Right for this town's
          // coinjoins (each part is one participant's balance moving),
          // fallible in general — and named on the weld so the ledger
          // never attributes the ownership conclusion to the model itself
          welds.push({ method: "subtx", tx: tid, coins, assumption: "one-owner-per-part" });
          // change identification applies to each sub-transaction
          // separately, with the same two steps as the plain payment:
          // the part already reads as one spender (the weld above), so
          // its payment outputs are identified and the sole remaining
          // unknown, if any, is suspected as its change
          if (change) {
            identifyAndLink(part.outs.map((o) => tx.outputs[o]!),
              part.ins.map((i) => tx.inputs[i]!), anchor, true);
          }
        }
        continue;
      }
      // proven ambiguous or merely inconclusive: either way the observer
      // has no partition to justify a link, so it abstains from welding
      // anything — but step one's payment identifications are per coin
      // and presume nothing about the split, so they are still recorded
      // (an auxiliary attribution can name a payment inside a session
      // whose mapping the amounts leave open)
      if (map.kind === "ambiguous" || map.kind === "inconclusive") {
        if (change) identifyAndLink(tx.outputs, tx.inputs, tx.inputs[0]!, false);
        continue;
      }
      // atomic: no way to split it — fall through to plain CIOH
    }
    // CIOH: all inputs of one transaction, one owner — unless the input
    // count exceeds the observer's cap, where the heuristic abstains
    if (cioh && tx.inputs.length >= 2 &&
        tx.inputs.length <= (heuristics.ciohMaxInputs ?? Infinity)) {
      for (let i = 1; i < tx.inputs.length; i++) union(tx.inputs[i]!, tx.inputs[0]!);
      welds.push({ method: "cioh", tx: tid, coins: [...tx.inputs] });
    }
    // change identification over the whole transaction (the trivial
    // sub-transaction). Step two's welds are only meaningful on a
    // transaction that already reads unilateral: linking an output to
    // "whoever paid" presumes one spender, so unless every input sits
    // in the same apparent cluster by this point in the scan, the weld
    // would arbitrarily pick one input among several candidate owners,
    // and the observer abstains (step one's payment identifications
    // are per coin and recorded regardless).
    if (change) {
      const oneSpender = tx.inputs.every((i) => find(i) === find(tx.inputs[0]!));
      identifyAndLink(tx.outputs, tx.inputs, tx.inputs[0]!, oneSpender);
    }
  }

  const rep = new Map<CoinId, CoinId>();
  const members = new Map<CoinId, CoinId[]>();
  for (const id of chain.coins.keys()) {
    const r = find(id);
    rep.set(id, r);
    const m = members.get(r);
    if (m) m.push(id);
    else members.set(r, [id]);
  }
  // rank clusters by size (largest first), ties broken by representative id
  const ranked = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<CoinId, number>();
  ranked.forEach(([r], i) => rank.set(r, i + 1));
  return { rep, members, rank, changeGuess, payGuess, welds };
}

/** one graded error in the observer's map: a weld whose coins do NOT in
 *  truth share an owner — an incorrect local inference, named by the
 *  heuristic that made it */
export interface Mistake {
  tx: TxId;
  method: Weld["method"];
  /** short display line for the learner */
  note: string;
}

/**
 * GRADING, not analysis: judge every weld in the observer's ledger
 * against the town's hidden truth. A weld is a mistake when the coins
 * it claims share an owner actually belong to different users — the
 * change guess picked the payment output and welded the payee's coin
 * into the payer's cluster, CIOH read a multi-party spend as one
 * owner, or a balanced sub-transaction part mixed two users' coins.
 * Truth flows only toward the learner's display (the latent-truth
 * rule): no heuristic reads this, and the observer could never draw
 * this list themselves.
 */
export function gradeWelds(chain: Chain, welds: Weld[]): Map<TxId, Mistake[]> {
  const out = new Map<TxId, Mistake[]>();
  for (const w of welds) {
    // reuse welds read the record rather than betting on it — same
    // address, same key, same owner — so there is nothing to grade
    if (w.tx === undefined) continue;
    const owners = new Set(w.coins.map((c) => chain.coins.get(c)!.owner));
    if (owners.size < 2) continue;
    const note =
      w.method === "change"
        ? (w.basis === "radix"
          ? "a repeated denomination read as a self-spend was another user's coin"
          : "the change guess picked another user's payment")
        : w.method === "cioh"
          ? `CIOH read ${owners.size} users' inputs as one owner`
          : "a balanced part combines different users' coins";
    const l = out.get(w.tx);
    if (l) l.push({ tx: w.tx, method: w.method, note });
    else out.set(w.tx, [{ tx: w.tx, method: w.method, note }]);
  }
  return out;
}

/** assemble a Clustering from a coin -> group assignment; coins keyed
 *  null stay singletons. Rank is by size, as in the observer's map. */
function partitionBy(chain: Chain, keyOf: (id: CoinId) => string | null): Clustering {
  const groups = new Map<string, CoinId[]>();
  const rep = new Map<CoinId, CoinId>();
  const members = new Map<CoinId, CoinId[]>();
  for (const id of chain.coins.keys()) {
    const key = keyOf(id);
    if (key === null) {
      rep.set(id, id);
      members.set(id, [id]);
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(id);
    else groups.set(key, [id]);
  }
  for (const g of groups.values()) {
    const r = g[0]!;
    members.set(r, g);
    for (const id of g) rep.set(id, r);
  }
  const ranked = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<CoinId, number>();
  ranked.forEach(([r], i) => rank.set(r, i + 1));
  return { rep, members, rank, changeGuess: new Map(), payGuess: new Map(), welds: [] };
}

/**
 * The bottom of the partition refinement lattice: every coin its own
 * vertex, nothing welded — the coin graph itself, dressed as a cluster
 * graph. Every lens's partition refines down to this, so it is the
 * natural waypoint for animating between the transaction graph and any
 * clustered view.
 */
export function clusterSingletons(chain: Chain): Clustering {
  return partitionBy(chain, () => null);
}

/**
 * The true wallet partition — what the all-seeing lens contracts to: one
 * vertex per person (the doc's user graph, reached by edge contraction),
 * every one of them labeled, plus a single vertex for the outside world's
 * merchants. No heuristics, no gray unknowns: this is the ground truth
 * the observer's pseudonym graph is trying to approximate.
 */
export function clusterByOwner(chain: Chain): Clustering {
  return partitionBy(chain, (id) => {
    const o = chain.coins.get(id)!.owner;
    return o === null ? "x" : `u${o}`;
  });
}

/**
 * One participant's contraction of the graph: coins they can attribute
 * fuse per believed owner — direct evidence (fixed points) and
 * cluster-propagated guesses kept apart, a suspicion is not a fact —
 * and everything else stays an anonymous singleton, exactly as blind as
 * the bare structure.
 */
export function clusterByKnowledge(
  chain: Chain,
  attributions: Map<CoinId, { owner: number | null; direct: boolean }>,
): Clustering {
  return partitionBy(chain, (id) => {
    const a = attributions.get(id);
    return a ? `${a.owner === null ? "x" : a.owner}/${a.direct ? "k" : "g"}` : null;
  });
}

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
