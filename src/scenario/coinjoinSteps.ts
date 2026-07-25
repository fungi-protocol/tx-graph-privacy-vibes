// Chapter 6: coinjoin — strangers share a transaction. No payment needs
// to pass between the parties, so peers can come from anywhere; whether
// anything is hidden comes down to the amounts. Carelessly chosen values
// are fully partitioned by subset sums; values drawn from a shared
// denomination menu leave the mapping underdetermined. Honest limits
// stay in frame: bounded ambiguity, and a past that is blended into
// many plausible pasts — never severed.
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
        far settled a debt — which meant transacting with the people you
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
      view: 1,
      lens: 0,
      scene: 1,
      minDay: 90,
    },
    {
      id: "subset-sums-undo-it",
      title: "Subset sums undo it",
      html: `<p>Flip to the observer, who now plays a matching game with the
        amounts: which groups of inputs and outputs <b>balance</b>? Think of
        a join where inputs of 0.1, 0.3, 2 and 5 meet outputs of 0.4 and 7 —
        the only reading is 0.1&#8202;+&#8202;0.3&#8202;=&#8202;0.4 and
        2&#8202;+&#8202;5&#8202;=&#8202;7. One consistent mapping, so the
        amounts <b>fully partition</b> the transaction.</p>
        <p>Frank and Ivan's values are just as careless, and the analysis is
        stronger than CIOH ever was: it doesn't just group the inputs — it
        hands each output back to its side too. Carelessly chosen values are
        no better than a naive batch.</p>`,
      focus: () => pad(naiveFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 90,
    },
    {
      id: "chosen-to-be-underdetermined",
      title: "Chosen to be underdetermined",
      html: `<p>The fix is to choose the values <b>on purpose</b>. Everyone
        takes their whole balance back in <b>standard denominations</b> from
        a shared menu — powers of 2, 1–2 times powers of 3, 1–2–5 times
        powers of 10 — plus a residual too small to say anything.</p>
        <p>Now the memo's <b>match rate</b> tells the story: how many input
        combinations land within a whisker of some output combination. And a payment can ride along:
        an obligation to someone outside the session, cut into the same
        denominations as everything else.</p>`,
      focus: () => pad(denseFocus()),
      view: 1,
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
        nothing.) Either way a careful analyst <b>declines to weld
        anything</b> — where the earlier forms fed CIOH lies, this one
        starves it. Starves it <i>inside the join</i>, that is: the clusters
        on either side remain, still matched to the town's relationships.</p>
        <p>Be precise about what happened. No history was erased: every
        coin's trace still runs back through the join to real origins. What
        changed is what an observer can justify: <b>several readings balance,
        and the analysis cannot single one out</b> — the coin's past sits
        among the plausible alternatives, and the more strangers' pasts flow
        through, the more company it keeps.</p>`,
      focus: () => pad(denseFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 100,
    },
    {
      id: "even-insiders-shrug",
      title: "Even insiders shrug",
      html: `<p>Here is what the earlier forms could not offer. A payjoin
        counterparty knew exactly whose coins were whose; a settlement
        insider could solve the edge they were not on. A coinjoin
        participant eliminates their own coins and faces the same puzzle as
        everyone else: <b>several strangers, and no reading they can
        single out</b>. That takes arranging — these sessions are set up so
        nobody learns whose outputs are whose, the strongest honest
        version of the idea.</p>
        <p>You are looking through a participant's eyes: their own coins,
        the session they took part in — and gray where even an insider has
        nothing. Only a payment made through the session is known to its
        two ends, as any payment is.</p>`,
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
      html: `<p>One coinjoin buys <b>bounded ambiguity</b>, not a clean
        slate. The amounts are only part of the picture: an observer can
        bring in the surrounding graph, timing, and whatever they already
        know; paying the same people through session after session still
        traces the same relationships. And a counterparty who handed you
        the coins in the first place recognizes their descendants when
        they come back to it — across any number of joins.</p>
        <p>And ambiguity decays: every later spend says a little more, and
        whenever two post-coinjoin coins are linked, their candidate
        origins can be <b>intersected</b> — the sets shrink fast. That
        attack is the next chapter.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 100,
    },
  ];
}
