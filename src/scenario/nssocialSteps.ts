// Chapter 5½ (#103): social-network analysis, right after net
// settlement — because settlement is what it can break. Netting folded
// the amounts away and starved the sub-transaction analysis; what no
// form so far hides is THAT a payment ran between two clusters, and
// business recurs, so the cluster graph inherits the town's community
// structure. The Narayanan–Shmatikov move (2009, retold on this graph):
// cut the record into temporal partitions, each expected to grow into
// much the same shape, and match vertices across the parts by the shape
// of their neighborhoods — structure alone, no amounts consulted. A
// match is an ownership claim, so accepting it merges the clusters.
// The chapter displays the live run's own match count rather than
// asserting one, states the honest limits — matches are claims scored
// by similarity, not probabilities, and a wrong one links strangers
// just as CIOH did — and closes on what the two matchers share
// (#113): sparsity makes a modest number of independent dimensions
// enough to single almost anyone out, so matching is not confined to
// nearby candidates — it can search the whole record. Uniqueness is
// still not attribution; a name needs an outside anchor.
import { type TutorialStep, type Rect } from "../ui/tutorial";

/** what the live run did, resolved by the caller: how many matches the
 *  analysis accepted, over how many temporal partitions */
export interface NsRunView {
  matches: number;
  parts: number;
}

export function nsSocialSteps(
  clusterBounds: () => Rect,
  run: () => NsRunView,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "the-shape-remains",
      title: "The shape remains",
      html: `<p>Stay with what the settlement bought, and ask what it
        did <i>not</i> buy. The amounts are folded away — but the
        transaction still happened, in public, between clusters the
        observer already tracks. Collapse the map and that is all you
        see: every cluster a vertex, an edge wherever a payment ran
        between two of them.</p>
        <p>Now recall who settles: people who <b>already do business</b>.
        Rent recurs, invoices recur, favors recur — so the same pairs of
        vertices keep acquiring edges, month after month, whatever form
        each payment took. The town's web of relationships is sitting in
        this picture, and no arithmetic over amounts was needed to draw
        it.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      nf: false,
      scene: 1,
      minDay: 60,
    },
    {
      id: "matching-the-epochs",
      title: "Matching the epochs",
      html: () => {
        const r = run();
        const count = r.matches === 0
          ? `accepted <b>nothing</b> this run — a stall is a real outcome`
          : `accepted <b>${r.matches} matches</b> this run`;
        return `<p>Here is what that shape is worth to an observer
        (Narayanan&nbsp;&amp;&nbsp;Shmatikov, 2009, retold on this
        graph). Cut the record into ${r.parts} <b>epochs</b>, one per
        stretch of the town's history. People keep paying the same
        people, so each epoch's graph grows into much the same shape as
        the last.</p>
        <p><i>Social-network analysis</i> just joined the panel,
        switched on: it matches vertices <b>across</b> the epochs by the
        shape of their neighborhoods — whom they touch, and whom those
        touch — consulting no amounts at all. A match is an ownership
        claim, "these two pseudonyms are one user's", and accepting it
        merges the clusters. The matcher ${count}. The next page opens
        the map into one column per epoch and plays the run match by
        match.</p>`;
      },
      // no focus: the map re-partitions in place when the ns knob lands
      // (a repartition carries zero camera delta, #13), and the epoch
      // columns exist only inside the replay modal the play button
      // opens — which frames itself
      select: () => null,
      view: 2,
      lens: 1,
      ns: true,
      reveals: ["nssoc"],
      scene: 1,
      minDay: 60,
    },
    {
      id: "watch-the-run",
      title: "Watch the run",
      html: () => {
        const r = run();
        const what = r.matches === 0
          ? `This run accepted no matches, so there is nothing to
            land — the columns open and close again unchanged.`
          : `Each accepted match draws its claim between the columns
            and <b>merges</b> the two clusters it names; when the run
            finishes, the columns fold back into the map with every
            merge applied.`;
        return `<p>The record is open as <b>one column per epoch</b>,
        oldest on the left — the same clusters as before, cut by
        stretch of history. The matcher is walking its accepted claims
        in its own order. ${what}</p>
        <p>The panel's <i>progress</i> slider holds the same run:
        dragging back retracts matches, dragging forward re-applies
        them, and <i>play</i> runs the rest from wherever the slider
        points.</p>`;
      },
      // no focus: the epoch columns frame themselves (the modal's
      // OPEN leg carries the one camera fit)
      select: () => null,
      view: 2,
      lens: 1,
      ns: true,
      replay: "ns",
      scene: 1,
      minDay: 60,
    },
    {
      id: "what-structure-gives-away",
      title: "What structure gives away",
      html: `<p>Read that against the settlement chapter's result. The
        transaction's values are still public — netting hid the
        <b>bills</b>: the record shows net residues that match no single
        obligation, so the sub-transaction analysis had nothing to grab —
        an honest win. The matching you just watched
        <b>never asked about amounts</b>. Two clusters that settle with
        the same partners, at the same cadence, wear the same
        neighborhood — and the neighborhood was enough to claim them as
        one user. What settlement cannot fold away is the
        <b>relationship itself</b>: the recurring counterparties leak on
        top of whatever the values still say.</p>
        <p>And the same honesty as every heuristic before it: a match is
        a <b>claim</b>, scored by similarity — the score is not a
        probability — and a wrong match links two strangers' histories
        together exactly as a wrong change guess did. The method earns
        its keep where relationships really do recur; where they don't,
        it invents them.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      scene: 1,
      minDay: 60,
    },
    {
      id: "sparsity-and-the-global-map",
      title: "Sparsity, and the global map",
      html: `<p>Step back and the last two chapters are <b>one method</b>.
        The behavioral matcher compared clusters by their habits — sizes,
        hours, cadence; this one compared them by their neighborhoods.
        Both reduce a cluster to a list of measurements along many
        <b>dimensions</b>, then look for the profile that lines up. The
        engine is comparison; only the dimensions differ.</p>
        <p>Why does that work at all? Because records like this one are
        <b>sparse</b>. Along any one dimension a cluster is ordinary —
        plenty of others pay at that hour, or touch that counterparty.
        But each further independent dimension splits the crowd again,
        and a modest number of splits is enough to leave almost everyone
        standing alone. That is what frees the observer from
        <b>locality</b>: the epoch matcher compared neighboring columns,
        but nothing in the method requires neighbors. With enough
        dimensions, a profile can be searched for <b>globally</b> —
        across the whole record, against other records entirely, years
        apart.</p>
        <p>The honest limit is the one this story keeps returning to:
        being unique is not being <b>named</b>. A profile that singles
        you out still says "one user did all this", not who — until some
        outside fact anchors it: a record held by an exchange, a single
        payment whose recipient talked. The coming chapters are about
        exactly those anchors, and about what happens when an observer
        holds more than one of them.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      scene: 1,
      minDay: 60,
    },
  ];
}
