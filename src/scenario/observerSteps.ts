// Chapter 3: the third-party observer — CIOH, change identification,
// cluster contraction, and the pseudonym graph. The Scroll #2/#3 arc:
// familiar heuristics first, then the honest caveat that attacks always
// get better, then the observer's real product — a social graph.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function observerSteps(bipBounds: () => Rect, clusterBounds: () => Rect): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "observers-map",
      title: "The observer's map",
      html: `<p>This is the same graph through the <b>observer lens</b>: no
        names, no colors, no stories — only amounts, fees, and structure.</p>
        <p>Yet the observer is not blind. A transaction that spends
        <b>several coins at once</b> is evidence that one entity owns them
        all — the <b>common-input-ownership heuristic</b> (CIOH). Co-spent
        coins merge into <b>clusters</b>: the colored groups. Gray coins are
        ones the observer has nothing on yet.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
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
        after day, that is most of the map you see.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
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
        not careful: it takes every bet. And real observers keep improving,
        reading wallet fingerprints, timing habits, and amount patterns
        this lens doesn't model.</p>
        <p class="tut-aside">The rule of thumb from cryptography applies:
        attacks always get better; they never get worse.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
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
        ever did comes with it. The map is patient: it never forgets, and
        it can be joined with data from outside the chain.</p>
        <p>Everything so far assumed each transaction has <b>one
        author</b>. The rest of this story is about what happens when the
        neighborhood breaks that assumption.</p>`,
      focus: () => pad(clusterBounds()),
      view: 2,
      lens: 1,
      scene: 1,
      minDay: 21,
    },
  ];
}
