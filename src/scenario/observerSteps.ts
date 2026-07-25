// Chapter 3: the third-party observer — the bare public record first,
// then each heuristic switched on in turn: address reuse (the linkage
// this town gave up, named so the floor framing is honest), CIOH,
// change identification and its real-world family of tells, cluster
// contraction, and the pseudonym graph. The Scroll #2/#3 arc: familiar
// heuristics first, then the honest caveat that attacks always get
// better, then the observer's real product — a social graph.
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
// Narayanan 2022, Kappos et al. 2022.
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
        next steps switch those inferences on, one at a time; the
        <b>heuristics</b> panel on the left lets you flip them yourself.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 0,
      scene: 1,
      minDay: 21,
    },
    {
      id: "no-reused-addresses",
      title: "The mistake this town doesn't make",
      html: `<p>The oldest linkage needs no inference at all. Every coin
        is locked to an <b>address</b>, and paying the same address twice
        links the two coins on the face of the record — one key controls
        both. Bitcoin's own whitepaper warned that "a new key pair should
        be used for each transaction"; early wallets reused addresses
        anyway, and it was the first clustering lever anyone pulled.</p>
        <p>Every wallet in this town draws a <b>fresh address for every
        output</b> — as well-made wallets do today. So that lever is absent
        here, and it's worth saying out loud: on the real chain, reuse is
        still everywhere, so a real observer starts with linkage this
        chapter never even needs. Everything the observer achieves in this
        story is a <b>floor</b>.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 0,
      scene: 1,
      minDay: 21,
    },
    {
      id: "coins-spent-together",
      title: "Coins spent together",
      html: `<p>The first inference: a transaction that spends
        <b>several coins at once</b> is evidence that one entity owns them
        all — whoever signed it could spend each of them. This is the
        <b>common-input-ownership heuristic</b> (CIOH). Co-spent coins
        merge into <b>clusters</b>: the colored groups that just
        appeared. Gray coins are ones the observer has nothing on yet.</p>
        <p>The colors are the observer's bookkeeping, not the truth —
        that's why this palette looks nothing like the all-seeing
        lens.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 1,
      scene: 1,
      minDay: 21,
    },
    {
      id: "guessing-the-change",
      title: "Guessing the change",
      html: `<p>Every payment here has two outputs — the payment and the
        change — and no label says which is which. But the observer can
        <i>guess</i>: prices in this neighborhood are set in dollars, so an
        output that lands on a <b>round dollar amount</b> at that day's
        exchange rate is probably the payment ($40, not $37.63). The other
        output is probably the change — and change belongs to whoever
        paid.</p>
        <p>Each correct guess extends a cluster by one hop. Chained day
        after day, that is most of the map you now see. The round-dollar
        bet is the one tell this lens actually runs — but it is one member
        of a <b>family</b>, and the family is the next step's subject.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 3,
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
        address reuse this town gave up. And above the hand-written tells
        sits a heavier tier: wallet software leaves <b>fingerprints</b> —
        fee choices, script versions, ordering and locktime conventions —
        and classifiers trained on them (Möser &amp; Narayanan; Kappos et
        al.) have proven extremely powerful in practice.</p>
        <p>The lesson is the family, not any one member: take one tell
        away and the others still vote.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 3,
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
        collapse</b> — merging different people into one blob. This lens is
        not careful: it takes every bet. And the family you just met keeps
        growing — real observers add tells this lens doesn't model.</p>
        <p class="tut-aside">The rule of thumb from cryptography applies:
        attacks always get better; they never get worse.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      overlays: 7,
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
        vertices may still be one person.</p>`,
      focus: () => pad(clusterBounds()),
      view: 2,
      lens: 1,
      overlays: 7,
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
      overlays: 7,
      scene: 1,
      minDay: 21,
    },
  ];
}
