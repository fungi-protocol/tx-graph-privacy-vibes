// Chapter 6: coinjoin — strangers share a transaction. No payment needs
// to pass between the parties, so peers can come from anywhere; whether
// anything is hidden comes down to the amounts. Carelessly chosen values
// are fully partitioned by the sub-transaction analysis; values drawn
// from a shared denomination menu leave the mapping underdetermined.
// Honest limits stay in frame: ambiguity is what the sub-transaction
// combinatorics dictate — countable, quantifiable as entropy — and a
// past is blended into many plausible pasts, never severed.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function coinjoinSteps(
  bipBounds: () => Rect,
  naiveFocus: () => Rect,
  denseFocus: () => Rect,
  denseAgent: () => number | undefined,
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
