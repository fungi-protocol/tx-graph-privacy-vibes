// Chapter 3: the third-party observer — the bare public record first,
// then each linkage switched on in turn: address reuse (the most basic
// clustering, inference-free, live in this town because Carol reuses;
// everyone else's fresh addresses keep the floor framing honest), CIOH,
// two-step change identification (identify the payment outputs first,
// then suspect the sole remainder; several remainders read as a batch
// payment and the observer abstains) with its real-world family of
// tells and the configurable evidence bar, cluster contraction, and
// the pseudonym graph. The Scroll #2/#3 arc: familiar heuristics
// first, then the honest caveat that attacks always get better, then
// the observer's real product — a social graph.
//
// The change-tell family step follows accuracy/030's constraints: the
// ordering tell is position-leaks-when-ordering-is-deterministic (with
// sorted/shuffled outputs as the defense), not a payment-first law;
// the address-type tell is named as real-world only (this town is
// type-uniform by construction); and the family is framed so blocking
// one member visibly does not blind the others. Citations: round
// numbers = the wiki's folklore tell (what this lens runs);
// fresh/"shadow" address = Androulaki et al. 2012; never-seen-again
// address = Meiklejohn et al. 2013; fingerprint classifiers = Möser &
// Narayanan 2022, Kappos et al. 2022. CIOH itself is the whitepaper's own
// caveat (§10 Privacy — multi-input spends "necessarily reveal that their
// inputs were owned by the same owner"); Meiklejohn et al. named it
// Heuristic 1 and applied it at chain scale, but the origin is Satoshi.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function observerSteps(bipBounds: () => Rect, clusterBounds: () => Rect): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "observers-map",
      title: "The observer's map",
      html: `<p>This is the same graph through the <b>observer lens</b>,
        with every inference switched off: no names, no colors, no
        stories — only what the chain itself records. Amounts, fees, and
        which output feeds which input.</p>
        <p>This bare structure is the observer's raw material — public,
        permanent, and downloadable by anyone. Everything the observer
        will ever claim about it is an <b>inference</b> laid on top. The
        next steps switch those inferences on, one at a time — each lands
        on a <b>heuristics</b> panel on the left as it arrives, yours to
        flip from then on.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 0,
      scene: 1,
      minDay: 21,
    },
    {
      id: "address-reuse",
      title: "The oldest linkage",
      html: `<p>The most basic clustering needs no inference at all. Every
        coin is locked to an <b>address</b>, and paying the same address
        twice links the coins on the face of the record — one key plainly
        controls both. Bitcoin's own whitepaper warned that "a new key pair
        should be used for each transaction"; early wallets reused
        addresses anyway, and reading reused addresses was the first
        clustering lever anyone pulled.</p>
        <p>Nearly every wallet in this town draws a <b>fresh address for
        every output</b>, as well-made wallets do today. The exception is
        Carol: she hands out one address to everyone who pays her, and her
        change goes back to it too. That first colored cluster is every
        coin she has ever touched — assembled by <i>reading</i> the record,
        not betting on it. Open her character sheet and the same address
        repeats down her whole coin list, marked ⟲.</p>
        <p>On the real chain, reuse is still everywhere — donation pages,
        exchange deposit addresses, lazy software — so a real observer
        starts with far more of this free linkage than one careless
        neighbor's. Everything the observer achieves in this story is a
        <b>floor</b>.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 8,
      scene: 1,
      minDay: 21,
    },
    {
      id: "coins-spent-together",
      title: "Coins spent together",
      html: `<p>The first inference: a transaction that spends
        <b>several coins at once</b> is evidence that one entity owns them
        all — whoever signed it could spend each of them. This is the
        <b>common-input-ownership heuristic</b> (CIOH), and it is as old
        as Bitcoin: the same whitepaper paragraph that urged a fresh key
        per transaction admits that multi-input spends "necessarily reveal
        that their inputs were owned by the same owner." Later work
        (Meiklejohn et al.) made it Heuristic 1 and ran it across the
        whole chain. Co-spent coins merge into <b>clusters</b>: the
        colored groups that just appeared. Gray coins are ones the
        observer has nothing on yet.</p>
        <p>The colors are the observer's bookkeeping, not the truth —
        that's why this palette looks nothing like the all-seeing
        lens.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 9,
      scene: 1,
      minDay: 21,
    },
    {
      id: "guessing-the-change",
      title: "Guessing the change",
      html: `<p>Every payment here has two outputs — the payment and the
        change — and no label says which is which. The observer works in
        <b>two steps</b>. First it tries to identify the <b>payment</b>,
        output by output: prices in this neighborhood are set in dollars,
        so an amount that lands on a <b>round dollar figure</b> at that
        day's exchange rate reads as a payment ($40, not $37.63) — and a
        round BTC figure reads the same way. Then it looks at <b>what
        remains</b>: if exactly <b>one</b> output was not identified as a
        payment, that one is suspected to be the change — and change
        belongs to whoever paid.</p>
        <p>The linking step presumes <b>one</b> spender: when a
        transaction's inputs sit in different clusters on the observer's
        map, there is no single "whoever paid" to hand the change to, and
        the careful analyst abstains. Each correct guess extends a
        cluster by one hop; chained day after day, that is most of the
        map you now see. The round-amount read is the one payment tell
        this lens runs so far — but it is one member of a
        <b>family</b>.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 11,
      scene: 1,
      minDay: 21,
    },
    {
      id: "a-family-of-tells",
      title: "A family of tells",
      html: `<p>You met two siblings in the first chapter. The ordering
        tell, stated precisely: any wallet that orders its outputs by a
        fixed rule leaks the change's <b>position</b> once its software is
        identified — which is why some wallets sort outputs by a neutral
        convention (BIP 69) or shuffle them, to destroy that signal. And
        the address-type tell: change usually matches the inputs' address
        type while the payment is whatever the payee asked for. That one
        has no purchase here — this town's wallets all use one address
        type — but real chains mix types, and every mixed-type payment
        leaks what a uniform one doesn't.</p>
        <p>Researchers added more. The freshly generated address next to
        one seen before is probably the change (Androulaki et al. call it
        the <i>shadow address</i>); an address that never appears again is
        probably change too (Meiklejohn et al.) — both tells feed on the
        address reuse this town, Carol aside, gave up. And above the hand-written tells
        sits a heavier tier: wallet software leaves <b>fingerprints</b> —
        fee choices, script versions, ordering and locktime conventions —
        and classifiers trained on them (Möser &amp; Narayanan; Kappos et
        al.) have proven extremely powerful in practice.</p>
        <p>The lesson is the family, not any one member: take one tell
        away and the others still vote.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 11,
      scene: 1,
      minDay: 21,
    },
    {
      id: "heuristics-not-proofs",
      title: "Heuristics, not proofs",
      html: `<p>Guesses can be wrong. The real change can land on a round
        amount while an odd grocery total doesn't — and the stranger's
        coin, the actual payment, gets welded into the payer's cluster.
        Careful observers accept some misses to avoid <b>cluster
        collapse</b> — merging different people into one blob — and this
        observer already abstains in one such case: when <b>several</b>
        outputs stay unidentified, a payment may simply have been missed,
        so the null hypothesis is a batch of payments, not one payment
        plus change, and nothing is linked.</p>
        <p>The rest of its caution is yours to set. Each payment tell
        this lens runs is its own checkbox under the change heuristic —
        round dollars, round bitcoin, and (further on) auxiliary
        attributions — so you can take one away and watch the others
        still vote. The <b>evidence bar</b> below them is how many
        <i>kinds</i> of tell the weld demands: at one, any single tell
        decides — every bet taken; raise it and only payments that two
        different tells agree on still anchor a weld, coverage traded
        for caution. And the family keeps growing — real observers add
        tells this lens doesn't model.</p>
        <p class="tut-aside">The rule of thumb from cryptography applies:
        attacks always get better; they never get worse.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 11,
      scene: 1,
      minDay: 21,
    },
    {
      id: "shrinking-the-map",
      title: "Shrinking the map",
      html: `<p>Now <b>contract</b> the graph: fuse each cluster's coins
        into a single vertex. What remains is a map of <b>transfers between
        pseudonyms</b> — who pays whom, and how often.</p>
        <p>This is the observer's real product. Not a pile of coins: a
        <b>social graph</b>. With complete clustering it would be the user
        network itself; incomplete, it is a <b>pseudonym graph</b> — several
        vertices may still be one person.</p>
        <p>One honest trick in this drawing: the vertices' <b>shape</b> is
        the observer's partition, but the <b>paint</b> is the town's truth
        — each vertex wears its coins' true owners, which the observer
        cannot see. A one-color vertex holds one person's coins; a vertex
        wearing several colors welded different people together — a
        <b>cluster collapse</b> you can spot at a glance. Flip the
        heuristics on the left and watch the vertices merge and split.</p>`,
      focus: () => pad(clusterBounds()),
      view: 2,
      lens: 1,
      overlays: 11,
      scene: 1,
      minDay: 21,
    },
    {
      id: "pseudonyms-not-names",
      title: "Pseudonyms, not names — yet",
      html: `<p>What separates this map from a directory of the
        neighborhood is only the names. One identified point — Carol's
        exchange withdrawal, an invoice with a name on it, a delivery
        address — ties a pseudonym to a person, and everything its cluster
        ever did comes with it. The map is patient — a name learned today
        applies to everything already on it, and it can be joined with
        data from outside the chain. The stakes are ordinary ones: rates,
        salaries, balances, habits, and who deals with whom — read by
        whoever holds the map.</p>
        <p>Everything so far assumed each transaction has <b>one
        author</b>. The rest of this story is about what happens when the
        neighborhood breaks that assumption.</p>`,
      focus: () => pad(clusterBounds()),
      view: 2,
      lens: 1,
      overlays: 11,
      scene: 1,
      minDay: 21,
    },
  ];
}
