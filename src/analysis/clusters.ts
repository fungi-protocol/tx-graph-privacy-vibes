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
//     that day's rate or in BTC ($40, 0.05 BTC; not $37.63) — or a
//     script type none of the inputs use (wallets pay change back
//     to their own kind, so a foreign kind reads as the payee's
//     address; a wallet migration makes this tell misfire, the new
//     wallet's change looking foreign next to the old wallet's
//     inputs) — or an output reliably attributed to a different owner
//     than a granted input by auxiliary information. Step two
//     is generic linkage over what remains: payment outputs are
//     assumed NOT to be linked to the inputs; if exactly ONE
//     non-payment output remains it is suspected as change and linked,
//     provided the payment identifications clear the configured
//     evidentiary bar; if several remain, some payments may have been
//     missed, so the null hypothesis is a batch payment and the
//     observer abstains. One further real-world identifier is named
//     but not modeled here: for an output that has itself been spent,
//     cluster feature vectors (nLockTime conventions, signature
//     grinding, temporal habits) differing from the input cluster's —
//     the town records those traits, and its statistical
//     fingerprinting heuristic reads them, but the change heuristic
//     does not.
//     One inversion: where the outputs show a radix
//     coinjoin structure — menu denominations with repeated values —
//     a repeated denomination's null hypothesis flips to SELF-SPEND
//     (that is the point of taking one's balance back in standard
//     denominations), so it is treated like change and linked to the
//     input cluster unless there is evidence it is a payment.
//   - sub-transaction analysis (the sub-transaction model, Maurer et
//     al.): a transaction
//     with several outputs is checked for partitions into balancing
//     sub-transactions. A unique partition links each part — inputs AND
//     outputs — together (stronger than CIOH); several valid partitions
//     mean the mapping is underdetermined, and a careful observer
//     declines to link anything at all.
//   - repeated co-membership (#105): inputs of a coinjoin-shaped
//     transaction that were issued by ONE earlier coinjoin-shaped
//     transaction. Peers are drawn from anywhere, so two users landing
//     in the same two sessions by chance is the unlikely reading; the
//     plain one is a single participant bringing their own coins back,
//     and the group is linked. The group also counts as one combined
//     input in the sub-transaction search, striking every balanced
//     reading that splits it — which is why re-consolidating coins
//     from one session inside another buys several inputs' block
//     space and one combined coin's ambiguity.
// Heuristics, not proofs: the change guess can be wrong, and when it is
// wrong it links a stranger's coin into the cluster. That failure mode is
// left in on purpose.
import { Chain, type CoinId, type TxId, type Owner } from "../model/chain";
import { type Sats } from "../core/sats";
import { isDenomination } from "../denom/denominations";
import { subTransactionMapping, forcedLinks } from "./subsetsum";
import { Partition } from "./partition";
import { type Clustering, type ChangeRead, type Heuristics, type Link,
  type ObserverRecord, publicRecord,
  TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL } from "./observer";
import { sessionShape, mergeInputs, amountKinds } from "./tells";

// the split (#122b): this module keeps the pipeline entry (clusterObserver);
// the vocabulary, tells, grading, and the non-observer constructors live in
// their own modules, re-exported here so existing importers keep working
export { type Link, type Clustering, type ChangeRead, type Heuristics,
  TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL,
  CLUSTER_COLORS, CLUSTER_MISC, clusterColor, clusterLabel } from "./observer";
export { sessionShape, mergeInputs, plausiblePayment } from "./tells";
export { gradeLinks, type Mistake } from "./grading";
export { clusterSingletons, clusterByOwner, clusterByKnowledge } from "./lenses";

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
  chain: Chain | ObserverRecord,
  usdPrice?: (day: number) => number | undefined,
  heuristics: Heuristics = {},
): Clustering {
  // the truth boundary (#122d): everything below reads the PUBLIC record
  // only — a Chain handed in at the boundary is projected down, so the
  // truth fields (owner, funders, kyc, label, Addr.who) are not merely
  // unread but absent from the type the heuristics see
  const rec = chain instanceof Chain ? publicRecord(chain) : chain;
  const { reuse = true, cioh = true, change = true, subsum = true, remeet = true } = heuristics;
  const bar = heuristics.changeEvidence ?? 1;
  const tellsOn = heuristics.changeTells ?? TELL_ALL;
  // the grant is read as a payment identifier only through the aux tell
  const grants = (tellsOn & TELL_AUX) !== 0 ? heuristics.grants : undefined;
  // ... but the link veto reads the grant ungated: knowing two coins'
  // owners differ refutes any observation claiming them for one owner,
  // whether or not the change heuristic's aux tell is switched on
  const auxAll = heuristics.grants;
  const refuted = (coins: readonly CoinId[]): boolean => {
    if (!auxAll) return false;
    let seen: Owner | undefined;
    let any = false;
    for (const c of coins) {
      const g = auxAll.get(c);
      if (g === undefined) continue;
      if (!any) { seen = g; any = true; }
      else if (g !== seen) return true;
    }
    return false;
  };
  // the fingerprint reading (Heuristics.fingerprints): inputs sitting on
  // two script types read as two wallets' coins in one transaction,
  // so every one-owner reading of it is suspect and the links abstain
  const fp = heuristics.fingerprints ?? false;
  const mixedWallets = (ins: readonly CoinId[]): boolean => {
    if (!fp) return false;
    let seen: string | undefined;
    let any = false;
    for (const c of ins) {
      const s = rec.coins.get(c)!.script;
      if (s === undefined) continue;
      if (!any) { seen = s; any = true; }
      else if (s !== seen) return true;
    }
    return false;
  };
  // the union-find substrate (#125): coins indexed in chain order, so a
  // class's canonical representative is its FIRST coin however the
  // heuristics' merges arrive — the observer's map is a point of the
  // partition refinement lattice, not a byproduct of merge order
  const ids = [...rec.coins.keys()];
  const idx = new Map<CoinId, number>();
  ids.forEach((id, i) => idx.set(id, i));
  const p = new Partition(ids.length);
  const find = (x: CoinId): CoinId => ids[p.find(idx.get(x)!)]!;
  const union = (a: CoinId, b: CoinId): void => {
    p.union(idx.get(a)!, idx.get(b)!);
  };

  const changeGuess = new Map<TxId, CoinId[]>();
  const payGuess = new Map<TxId, CoinId[]>();
  const changeReads = new Map<TxId, ChangeRead[]>();
  const links: Link[] = [];
  // the repeated-co-membership read asks the same shape question of a
  // coin's producer over and over — memoized once per transaction
  const shapeMemo = new Map<TxId, boolean>();
  const isSession = (tid: TxId): boolean => {
    let s = shapeMemo.get(tid);
    if (s === undefined) {
      s = sessionShape(rec, tid);
      shapeMemo.set(tid, s);
    }
    return s;
  };
  // address reuse first: the observer's address index is complete before a
  // single transaction is read. Coins paid to the same address are
  // controlled by the same key, so linking them is reading the record, not
  // inferring from it — the link carries no assumption that could be
  // wrong. Addresses are compared as opaque identifiers; nothing here
  // reads whose they are.
  if (reuse) {
    const byAddr = new Map<string, CoinId[]>();
    for (const coin of rec.coins.values()) {
      if (coin.addrKey === undefined) continue;
      const k = coin.addrKey;
      const l = byAddr.get(k);
      if (l) l.push(coin.id);
      else byAddr.set(k, [coin.id]);
    }
    for (const coins of byAddr.values()) {
      if (coins.length < 2) continue;
      for (let i = 1; i < coins.length; i++) union(coins[i]!, coins[0]!);
      links.push({
        method: "reuse",
        addr: rec.coins.get(coins[0]!)!.addrText!,
        coins: [...coins],
      });
    }
  }
  for (const tid of rec.order) {
    if (heuristics.except?.has(tid)) continue;
    const tx = rec.txs.get(tid)!;
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
        const v = rec.coins.get(o)!.value;
        if (isDenomination(v)) denomCount.set(v, (denomCount.get(v) ?? 0) + 1);
      }
    }
    // the two-step change identification, shared between the plain
    // transaction and each sub-transaction of a unique partition.
    // Step one classifies every output of the sub-transaction:
    // payments (a plausible payment amount, or an auxiliary
    // attribution naming a different owner than a granted input),
    // self-spends resolved by an attribution matching a granted
    // input's owner (settled by the grant layer, no link here), and
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
    // links are contingent on it, step one's identifications are not.
    const radixStructure = [...denomCount.values()].some((n) => n >= 2);
    // `whyUnlinked` names the caller's reason when `linked` is false, so
    // the recorded reading can say why step two had no cluster to link to
    const identifyAndLink = (outs: readonly CoinId[], ins: readonly CoinId[], anchor: CoinId, linked: boolean,
      whyUnlinked: "inputs" | "mapping" | "part" = "inputs"): void => {
      const inOwners = new Set<Owner>();
      for (const i of ins) {
        const g = grants?.get(i);
        if (g !== undefined) inOwners.add(g);
      }
      // the script-type tell reads the sub-transaction's input families
      // off the record: an output paying a family none of the inputs use
      // is not where this wallet keeps its change
      const inScripts = new Set<string>();
      if ((tellsOn & TELL_SCRIPT) !== 0) {
        for (const i of ins) {
          const s = rec.coins.get(i)!.script;
          if (s !== undefined) inScripts.add(s);
        }
      }
      const payments: CoinId[] = [];
      let kinds = 0; // TELL_* bits that fired across the identified payments
      const selfs: CoinId[] = [];
      const unknowns: CoinId[] = [];
      for (const o of outs) {
        const v = rec.coins.get(o)!.value;
        const g = grants?.get(o);
        // inside a radix structure a menu denomination is what a
        // self-spend looks like, so its amount says nothing
        const amount = radixStructure && isDenomination(v) ? 0 : amountKinds(v, price, tellsOn);
        const oScript = rec.coins.get(o)!.script;
        const script = inScripts.size > 0 && oScript !== undefined && !inScripts.has(oScript)
          ? TELL_SCRIPT : 0;
        const marks = amount | script;
        if (g !== undefined && inOwners.size > 0) {
          // an auxiliary attribution outranks the other tells in both
          // directions: a different owner is a payment however the
          // amount or script reads; the same owner is a self-spend
          // already settled by the grant layer, so no change link is
          // needed
          if (!inOwners.has(g)) {
            payments.push(o);
            kinds |= TELL_AUX | marks;
          }
        } else if (marks !== 0) {
          payments.push(o);
          kinds |= marks;
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
      // the recorded reading: what this pass identified and what became
      // of the rest — filled in below and pushed once at every exit
      const read: ChangeRead = { payments: [...payments], selfs: [], unknowns: unknowns.length };
      const record = (): void => {
        const r = changeReads.get(tid);
        if (r) r.push(read);
        else changeReads.set(tid, [read]);
      };
      if (!linked) {
        // no single "whoever paid" to hand anything to
        if (unknowns.length > 0 || selfs.length > 0) read.abstain = whyUnlinked;
        record();
        return;
      }
      // the radix null hypothesis links self-spends like change — but
      // they are default readings, not change guesses, so they join
      // the link ledger without entering changeGuess; and a link is
      // recorded only where it links something new (inside a unique
      // part the part link already claims these coins)
      for (const s of selfs) {
        if (!refuted([s, ...ins])) {
          read.selfs.push(s);
          if (find(s) !== find(anchor)) {
            union(s, anchor);
            links.push({ method: "change", tx: tid, coins: [s, anchor], basis: "radix" });
          }
        }
      }
      // the bar counts distinct tell KINDS that fired — corroboration
      // between kinds, not repetition within one
      const evidence = ((kinds & TELL_USD) !== 0 ? 1 : 0) +
        ((kinds & TELL_BTC) !== 0 ? 1 : 0) + ((kinds & TELL_AUX) !== 0 ? 1 : 0) +
        ((kinds & TELL_SCRIPT) !== 0 ? 1 : 0);
      if (unknowns.length === 1) {
        if (evidence < bar) read.abstain = "bar";
        else if (refuted([unknowns[0]!, ...ins])) read.abstain = "refuted";
        else {
          const guess = unknowns[0]!;
          read.change = guess;
          const g = changeGuess.get(tid);
          if (g) g.push(guess);
          else changeGuess.set(tid, [guess]);
          union(guess, anchor);
          links.push({ method: "change", tx: tid, coins: [guess, anchor], basis: "residue" });
        }
      } else if (unknowns.length > 1) {
        read.abstain = "batch";
      }
      record();
    };
    // repeated co-membership (#105): inputs of this coinjoin-shaped
    // transaction that were all issued by ONE earlier coinjoin-shaped
    // transaction. Peers are drawn from anywhere, so distinct users
    // landing in the same two sessions by chance is the unlikely
    // reading; the plain one is a single participant bringing their own
    // coins back — the group is linked, and counts as one combined
    // input in the sub-transaction search below, striking every
    // balanced reading that splits it
    const regroups: number[][] = [];
    if (remeet && isSession(tid)) {
      const byProducer = new Map<TxId, number[]>();
      tx.inputs.forEach((c, i) => {
        const p = rec.coins.get(c)!.producer;
        if (p === null || !isSession(p)) return;
        const l = byProducer.get(p);
        if (l) l.push(i);
        else byProducer.set(p, [i]);
      });
      for (const [via, g] of byProducer) {
        if (g.length < 2) continue;
        const coins = g.map((i) => tx.inputs[i]!);
        // the same vetoes as every other one-owner reading: known
        // divergent owners refute it, divergent wallet fingerprints
        // mark probable collaboration inside the group
        if (refuted(coins) || mixedWallets(coins)) continue;
        regroups.push(g);
        for (let i = 1; i < coins.length; i++) union(coins[i]!, coins[0]!);
        links.push({ method: "remeet", tx: tid, via, coins });
      }
    }
    // multi-output spends get the sub-transaction treatment first: a unique
    // sub-transaction partition beats CIOH (and identifies outputs too);
    // an underdetermined one suspends it — outputs link to inputs only
    // if the mapping is determined. The >=3-output gate keeps payjoins
    // and settlements on their own heuristics; a 2-output multiparty
    // join (the doc's 4-in/2-out bad coinjoin) would slip past it into
    // CIOH, but no form here produces that shape
    if (subsum && tx.inputs.length >= 2 && tx.outputs.length >= 3) {
      const value = (id: CoinId): number => rec.coins.get(id)!.value;
      // re-met groups enter the search as one combined input each; a
      // partition of the merged values expands back onto the inputs
      const { vals: ivs, expand } = mergeInputs(tx.inputs.map(value), regroups);
      const ovs = tx.outputs.map(value);
      const map = subTransactionMapping(ivs, ovs, tx.fee);
      if (map.kind === "unique") {
        for (const part of map.parts) {
          const partIns = part.ins.flatMap((i) => expand[i]!);
          const anchor = tx.inputs[partIns[0]!]!;
          const coins = [
            ...partIns.map((i) => tx.inputs[i]!),
            ...part.outs.map((o) => tx.outputs[o]!),
          ];
          // attributions naming two owners inside the part refute the
          // one-owner-per-part assumption for that part (the flow
          // verdict stands; the ownership link does not) — and so do
          // divergent wallet fingerprints across the part's inputs
          if (refuted(coins) || mixedWallets(partIns.map((i) => tx.inputs[i]!))) {
            if (change) {
              identifyAndLink(part.outs.map((o) => tx.outputs[o]!),
                partIns.map((i) => tx.inputs[i]!), anchor, false, "part");
            }
            continue;
          }
          for (const c of coins) union(c, anchor);
          // the unique partition proves the FLOW; linking the part into
          // one owner adds the assumption that each sub-transaction is a
          // self-contained single-owner action. Right for this town's
          // coinjoins (each part is one participant's balance moving),
          // fallible in general — and named on the link so the ledger
          // never attributes the ownership conclusion to the model itself
          links.push({ method: "subtx", tx: tid, coins, assumption: "one-owner-per-part" });
          // change identification applies to each sub-transaction
          // separately, with the same two steps as the plain payment:
          // the part already reads as one spender (the link above), so
          // its payment outputs are identified and the sole remaining
          // unknown, if any, is suspected as its change
          if (change) {
            identifyAndLink(part.outs.map((o) => tx.outputs[o]!),
              partIns.map((i) => tx.inputs[i]!), anchor, true);
          }
        }
        continue;
      }
      // proven ambiguous or merely inconclusive: either way the observer
      // has no partition to justify a link, so it abstains from linking
      // anything — with one exception: a pairing FORCED by the sums
      // holds in every balanced reading (an output larger than the rest
      // of the inputs combined can only have been funded by the one
      // input big enough), so those pairs link even while the mapping
      // stays open. Step one's payment identifications are per coin
      // and presume nothing about the split, so they are still recorded
      // (an auxiliary attribution can name a payment inside a session
      // whose mapping the amounts leave open)
      if (map.kind === "ambiguous" || map.kind === "inconclusive") {
        for (const f of forcedLinks(ivs, ovs, tx.fee)) {
          const ins = expand[f.in]!.map((i) => tx.inputs[i]!);
          const b = tx.outputs[f.out]!;
          if (refuted([...ins, b])) continue; // forced flow, refuted ownership
          union(b, ins[0]!);
          links.push({ method: "subtx", tx: tid, coins: [...ins, b], assumption: "one-owner-per-part", basis: "bound" });
        }
        if (change) identifyAndLink(tx.outputs, tx.inputs, tx.inputs[0]!, false, "mapping");
        continue;
      }
      // atomic: no way to split it — fall through to plain CIOH
    }
    // CIOH: all inputs of one transaction, one owner — unless the input
    // count exceeds the observer's cap, where the heuristic abstains,
    // or the inputs' wallet fingerprints diverge, which reads as
    // probable collaboration and vetoes the one-owner reading
    if (cioh && tx.inputs.length >= 2 &&
        tx.inputs.length <= (heuristics.ciohMaxInputs ?? Infinity) &&
        !refuted(tx.inputs) && !mixedWallets(tx.inputs)) {
      for (let i = 1; i < tx.inputs.length; i++) union(tx.inputs[i]!, tx.inputs[0]!);
      links.push({ method: "cioh", tx: tid, coins: [...tx.inputs] });
    }
    // change identification over the whole transaction (the trivial
    // sub-transaction). Step two's links are only meaningful on a
    // transaction that already reads unilateral: linking an output to
    // "whoever paid" presumes one spender, so unless every input sits
    // in the same apparent cluster by this point in the scan, the link
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
  for (const id of ids) {
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
  return { rep, members, rank, changeGuess, payGuess, changeReads, links };
}
