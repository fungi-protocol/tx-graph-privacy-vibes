// Chapter 6: coinjoin — strangers share a transaction. No payment needs
// to pass between the parties, so peers can come from anywhere; whether
// anything is hidden comes down to the amounts. Carelessly chosen values
// are fully partitioned by the sub-transaction analysis; values drawn
// from a shared denomination menu leave the mapping underdetermined.
// Honest limits stay in frame: ambiguity is what the sub-transaction
// combinatorics dictate — countable, quantifiable as entropy — and a
// past is blended into many plausible pasts, never severed.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { subTransactionMapping, type SubMapping } from "../analysis/subsetsum";
import { sessionShape, mergeInputs } from "../analysis/clusters";

/** the chapter's denominated exhibit: prefer a session whose mapping is
 *  PROVEN underdetermined (two balanced readings exhibited); fall back
 *  to an unresolved dense one, and only then to anything at all. The
 *  careless (and any unlucky) session doesn't count. Shared between the
 *  app and the per-seed guarantee tests. */
export function selectDenseCoinjoin(
  coinjoins: Map<TxId, { density: number; determined: boolean; verdict: SubMapping["kind"] }>,
  naiveTid: TxId | undefined,
): TxId | undefined {
  let unresolved: TxId | undefined;
  let any: TxId | undefined;
  for (const [tid, cj] of coinjoins) {
    if (tid === naiveTid) continue;
    if (any === undefined) any = tid;
    if (cj.verdict === "ambiguous" && cj.density >= 0.5) return tid;
    if (unresolved === undefined && !cj.determined && cj.density >= 0.5) unresolved = tid;
  }
  return unresolved ?? any;
}

/** the repeated-co-membership exhibit (#105): a coinjoin-shaped
 *  transaction several of whose inputs were issued by one earlier
 *  coinjoin-shaped transaction, plus the sub-transaction verdicts with
 *  and without the group counted as one combined input. */
export interface RemeetExhibit {
  /** the later session, where the coins meet again */
  tid: TxId;
  /** the earlier session that issued them */
  via: TxId;
  /** the featured re-met inputs */
  coins: CoinId[];
  /** how many inputs the later session has in all */
  inputs: number;
  /** the sub-transaction verdict on the session's inputs as they are */
  alone: SubMapping["kind"];
  /** the verdict with every re-met group counted as one combined input */
  grouped: SubMapping["kind"];
}

/** Find the chapter's re-meeting exhibit. Staging reads the hidden
 *  truth ONLY to prefer a group that really is one participant's (the
 *  step must not open on a coincidence) and to prefer a session whose
 *  regrouped verdict is conclusive; the exhibit's displayed facts are
 *  all the observer's own. Earliest qualifying session wins, so the
 *  pick is stable as the town grows. */
export function remeetExhibit(
  chain: Chain,
  ownerOf: (id: CoinId) => number | null,
): RemeetExhibit | undefined {
  let best: RemeetExhibit | undefined;
  let bestTier = -1;
  for (const tid of chain.order) {
    if (!sessionShape(chain, tid)) continue;
    const tx = chain.txs.get(tid)!;
    const byProducer = new Map<TxId, number[]>();
    tx.inputs.forEach((c, i) => {
      const p = chain.coins.get(c)!.producer;
      if (p === null || !sessionShape(chain, p)) return;
      const l = byProducer.get(p);
      if (l) l.push(i);
      else byProducer.set(p, [i]);
    });
    const groups = [...byProducer.entries()].filter(([, g]) => g.length >= 2);
    if (groups.length === 0) continue;
    // feature the largest single-owner group; fall back to the largest
    const owned = groups.filter(([, g]) =>
      new Set(g.map((i) => ownerOf(tx.inputs[i]!))).size === 1);
    const pool = owned.length > 0 ? owned : groups;
    const [via, g] = pool.reduce((a, b) => (b[1].length > a[1].length ? b : a));
    const value = (id: CoinId): number => chain.coins.get(id)!.value;
    const ovs = tx.outputs.map(value);
    const alone = subTransactionMapping(tx.inputs.map(value), ovs, tx.fee).kind;
    const merged = mergeInputs(tx.inputs.map(value), groups.map(([, gr]) => gr));
    const grouped = subTransactionMapping(merged.vals, ovs, tx.fee).kind;
    const tier = (owned.length > 0 ? 2 : 0) + (grouped !== "inconclusive" ? 1 : 0);
    if (tier > bestTier) {
      bestTier = tier;
      best = { tid, via, coins: g.map((i) => tx.inputs[i]!), inputs: tx.inputs.length, alone, grouped };
      if (tier === 3) break; // earliest fully-qualifying session wins
    }
  }
  return best;
}

export function coinjoinSteps(
  bipBounds: () => Rect,
  naiveFocus: () => Rect,
  denseFocus: () => Rect,
  denseAgent: () => number | undefined,
  remeet: () => RemeetExhibit | undefined,
  remeetFocus: () => Rect,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "strangers-share-a-transaction",
      title: "Strangers share a transaction",
      html: `<p>Around day 90 the idea crosses community lines. Every form so
        far settled an obligation — which meant transacting with the people you
        already know. But nothing forces that: people with <b>no business
        between them</b> can spend their coins in one transaction and each
        take their own money back. A <b>coinjoin</b>.</p>
        <p>Because no payment passes between them, peers can be picked from
        anywhere — no economic relationship shows up to explain the
        grouping. The join itself, though, is easy to spot: what it can
        hide is which stranger is which — that strangers joined is public.
        Frank and Ivan, from different corners of town, try it first. Each
        puts in two coins and takes back what he put in, split into a
        round figure and the rest.</p>`,
      focus: () => pad(naiveFocus()),
      view: 0,
      lens: 0,
      ns: false, // the epoch columns fold back before this chapter's exhibits
      scene: 1,
      minDay: 90,
    },
    {
      id: "the-amounts-undo-it",
      title: "The amounts undo it",
      html: `<p>Flip to the observer, who runs the matching game it
        learned on the settlements: which groups of inputs and outputs
        <b>balance</b>? Think of a join where inputs of 0.1, 0.3, 2 and 5
        meet outputs of 0.4 and 7 —
        the only reading is 0.1&#8202;+&#8202;0.3&#8202;=&#8202;0.4 and
        2&#8202;+&#8202;5&#8202;=&#8202;7. One consistent mapping, so the
        amounts <b>fully partition</b> the transaction. Analysts call the
        balanced groups <i>sub-transactions</i>, and the matching game the
        <b>sub-transaction model</b> (Maurer et al.).</p>
        <p>Frank and Ivan's values are just as careless. The
        sub-transaction model <b>generalizes</b> CIOH and change
        identification: a transaction it cannot split reads as one
        user's spend, and each part it can split off reads the same way
        — inputs grouped, outputs assigned. Carelessly chosen values are
        no better than a naive batch.</p>`,
      focus: () => pad(naiveFocus()),
      view: 0,
      lens: 1,
      scene: 1,
      minDay: 90,
    },
    {
      id: "chosen-to-be-underdetermined",
      title: "Chosen to be underdetermined",
      html: `<p>The fix is to choose the values <b>on purpose</b>. Everyone
        takes their balance back in <b>standard denominations</b> from a
        shared menu — powers of 2, 1–2 times powers of 3, 1–2–5 times
        powers of 10 — three or four of them approximating the balance,
        plus an ordinary change output for the rest. And each participant
        brings <b>several coins</b>, not one: small fragments consolidate
        here, among strangers' inputs, instead of in a naked sweep later.</p>
        <p>The values are picked against the session itself: a
        decomposition scores well when combinations of the <b>other
        participants' inputs</b> could explain its output combinations
        — those are the readings an observer cannot pin on the chooser.
        The memo's <b>match rate</b> reports the result: how many input
        combinations land within a whisker of some output combination.
        And a payment can ride along: an obligation to someone outside
        the session, cut into the same denominations as everything
        else.</p>`,
      focus: () => pad(denseFocus()),
      view: 0,
      lens: 0,
      scene: 1,
      minDay: 100,
    },
    {
      id: "many-plausible-pasts",
      title: "Many plausible pasts",
      html: `<p>The observer's matching game now comes back with <b>several
        balanced readings</b> and no way to pick one. The menu itself is
        what makes that provable even on a big session: outputs of the same
        value are interchangeable, so the readings can be counted over the
        values — and there is always more than one. (A session too tangled
        even for that earns only an abstention, and abstention alone proves
        nothing.) Either way a careful analyst <b>declines to link
        anything the readings disagree on</b> — a pairing every reading
        shares is still taken (an output larger than the rest of the
        inputs combined can only have come from the one input big
        enough to fund it), but where the earlier forms fed CIOH lies,
        this one starves it. Starves it <i>inside the join</i>, that is: the clusters
        on either side remain, still matched to the town's relationships.</p>
        <p>Be precise about what happened. No history was erased: every
        coin's trace still runs back through the join to real origins. What
        changed is what an observer can justify: <b>several readings balance,
        and the analysis cannot single one out</b> — the coin's past sits
        among the plausible alternatives, and the more strangers' pasts flow
        through, the more company it keeps.</p>`,
      focus: () => pad(denseFocus()),
      // stays in card view: this step zooms in on the same transaction
      // the previous step framed, and a view morph in between reads as
      // leaving the card even though the camera never meant to
      view: 0,
      lens: 1,
      scene: 1,
      minDay: 100,
    },
    {
      id: "the-null-hypothesis-flips",
      title: "A presumption of strangers",
      html: `<p>An observer who recognizes this shape — many inputs,
        outputs in repeated menu values — can simply presume what the
        shape suggests: a <b>coinjoin between strangers</b>, which is
        more or less to presume that <b>no net value moves between the
        users</b>. Under that presumption the outputs are balances
        coming back, so a denominated output reads as a
        <b>self-spend</b> by default — grouped with whichever inputs
        funded it — and the payment reads go quiet. They were weak to
        begin with: in an ordinary spend a round-ish dollar figure leans
        toward "payment", but only leans, and a round BTC value can as
        easily be cold storage being parceled out.</p>
        <p>The presumption costs the observer something and costs the
        participants something. It gives up the settlement chapter's
        shelter in reverse: there, the visible nets proved nothing,
        because obligations can offset to make them arbitrary — presume
        no net transfers and the amounts are taken at face value, as
        balances. And the participants must reckon with the presumption
        being <b>available, and possibly right</b>: they cannot hide
        behind amounts that might-have-been offsets, so ambiguity has to
        be <b>forced</b> — values chosen so the sub-transaction instance
        is overtly underdetermined, which is exactly what the menu
        arranged. (Linking a self-spend to "its" inputs also needs those
        inputs to read as one cluster first; in an underdetermined
        session they never merge, so the presumption stands ready with
        nothing to link.)</p>`,
      focus: () => pad(denseFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 100,
    },
    {
      id: "even-insiders-are-blinded",
      title: "Even insiders are blinded",
      html: `<p>You are looking through a participant's eyes: their own
        coins, the session they took part in — and gray where even an
        insider has nothing. This town makes one standing assumption
        about every collaborative form, settlements and coinjoins alike:
        the transaction is <b>constructed so a participant learns no
        more than the transaction itself tells the world</b>. How peers
        find each other, and what keeps a dishonest one from cheating,
        are protocol questions outside this simulation — and none of
        them shows up in the on-chain structure.</p>
        <p>Under that assumption, what an insider holds over the outside
        observer is the power to <b>eliminate their own coins</b>, and
        nothing else. With two parties that is everything: a payjoin
        payee strikes out their own coins and exactly the payer's
        remain — no protocol can help that. Among many strangers it is
        almost nothing: strike your own from an underdetermined session
        and several readings still balance. At this level a coinjoin and
        a net settlement differ only in <b>what the participants chose
        to do with the same instrument</b> — offset real obligations, or
        take their own balances back. Only a payment made through the
        session is known to its two ends, as any payment is.</p>`,
      focus: () => pad(denseFocus()),
      view: 1,
      lens: 2,
      agent: denseAgent,
      scene: 1,
      minDay: 100,
    },
    {
      id: "the-same-stranger-twice",
      title: "The same stranger twice",
      html: () => {
        const x = remeet();
        if (!x) {
          return `<p>One more reading before leaving the sessions — this
        one about the graph, not any single transaction. When several
        inputs of one session are outputs of one <b>earlier</b> session,
        the coins' owners would have had to land in the same session
        twice by chance. The plainer reading is a single participant
        bringing coins back from the last session, so the observer links
        such inputs — the <b>repeated co-membership</b> box on the
        panel. No session on this run's record shows the pattern yet;
        it appears as the sessions keep drawing from the same town.</p>`;
        }
        const k = x.coins.length;
        const verdictLine =
          x.grouped === "unique"
            ? `On ${x.tid} that is decisive: with the group combined,
        exactly <b>one</b> reading balances and the session is fully
        partitioned.`
            : x.grouped === "ambiguous" && x.alone === "inconclusive"
              ? `${x.tid} was too wide even to search before; combining
        the group shrinks it enough to settle — several readings still
        balance, but every one that split the group is gone.`
              : x.grouped === "ambiguous"
                ? `On ${x.tid} several readings still balance with the
        group combined — the ambiguity got thinner, not gone.`
                : `${x.tid} stays too wide for the full search either
        way, but the struck readings are struck regardless: whatever
        balances must keep the group together.`;
        return `<p>One more reading before leaving the sessions — this
        one about the graph, not any single transaction. <b>${k} of
        ${x.tid}'s ${x.inputs} inputs are outputs of one earlier
        session, ${x.via}</b>. Peers are drawn from anywhere, so for
        those coins to belong to different users, their owners would
        have had to land in the same session twice by chance. The
        plainer reading is a single participant, bringing coins back
        from the last session — so the observer links the ${k} coins
        and everything already clustered with them: the <b>repeated
        co-membership</b> box, new on the panel. A heuristic like the
        others, not a proof — in a town this small the same users do
        sometimes re-meet by chance, and the mistakes grading judges
        every link this reading makes.</p>
        <p>The link reaches into the session's arithmetic too: coins
        read as one owner count as <b>one combined input</b> in the
        sub-transaction analysis, and every balanced reading that split
        them is struck. ${verdictLine} Note what the participant paid:
        block space for ${k} inputs, buying the ambiguity of a single
        combined coin — a lose-lose. Consolidating fragments among
        strangers was the whole point of bringing several coins; coins
        that <b>share a session past</b> are the ones that undo it when
        they travel together.</p>`;
      },
      focus: () => remeetFocus(),
      view: 1,
      lens: 1,
      overlays: 31, // the repeated co-membership reading joins the panel
      scene: 1,
      minDay: 105,
    },
    {
      id: "no-panacea",
      title: "No panacea",
      html: `<p>What did the session actually buy? Exactly the ambiguity
        the <b>sub-transaction model's combinatorics dictate</b>: the
        balanced readings can be counted — even totted up as entropy,
        which is what the Boltzmann analysis does — and no more. Two
        separate roads lead beyond that. First, even a transaction read
        <b>in isolation</b> is not read from its amounts alone: scripts,
        timing, and whatever the observer already knows about particular
        coins feed the same per-transaction verdict, and can strike
        readings the amounts left open. Second — a different matter —
        the transaction sits in a <b>graph</b>: paying the same people
        session after session traces the same relationships, and a
        counterparty who handed you coins in the first place recognizes
        their descendants when they come back, across any number of
        joins.</p>
        <p>And ambiguity decays: every later spend says a little more, and
        whenever two post-coinjoin coins are linked, their candidate
        origins can be <b>intersected</b> — the sets shrink fast.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 100,
    },
  ];
}
