// Chapter 7: intersection attacks — deanonymization as a guessing game.
// A coinjoined coin's candidate origins are clusters, an anonymity set
// (the candidate-set entropy formalized by Kelen & Seres); every
// observation is an answered yes-or-no question. Linking two
// post-coinjoin coins intersects their candidate sets, and intersections
// cut by factors, not by items — the adversary plays twenty questions,
// not process-of-elimination. The corrected highlight semantics carry the
// chapter: intersection fully lit, union partly, the rest dimmed.
//
// The aux-info step follows Yuval's conditional-modeling steer (via
// accuracy/036): state a knowledge assumption AS an assumption ("suppose
// the observer learns one user's coins"), COMPUTE what follows — both
// decay branches of the writeup: additive (the granted coins drop out of
// the candidate set) and multiplicative (the granted coins sat on every
// route to other origins, severing them too — the fracture dividend) —
// then reason separately about when such grants happen (KYC vendors,
// web trackers: Goldfeder et al., cited ONLY on the off-chain linking
// leg, never as a CIOH source — accuracy/035's trap note). What stays
// unmodelable is WHICH assumption is true of a given adversary, not
// what follows from it.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type AuxDecay } from "../analysis/auxinfo";

export interface Focused {
  id: string;
  rect: Rect;
}

/** the aux-info exhibit: whose deanonymization the step supposes, and
 *  the computed consequence for the traced coin's candidate origins */
export interface AuxGrant {
  name: string;
  decay: AuxDecay;
}

export function intersectionSteps(
  bipBounds: () => Rect,
  tracedCoin: () => Focused | undefined,
  crossTx: () => Focused | undefined,
  toxicTx: () => Focused | undefined,
  auxGrant: () => AuxGrant | undefined,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  const at = (f: () => Focused | undefined): (() => Rect) => () => {
    const g = f();
    return g ? g.rect : bipBounds();
  };
  const sel = (kind: "coin" | "tx", f: () => Focused | undefined): (() => { kind: "coin" | "tx"; id: string } | null) =>
    () => {
      const g = f();
      return g ? { kind, id: g.id } : null;
    };
  return [
    {
      id: "the-candidate-origins",
      title: "The candidate origins",
      html: `<p>Think of the observer as playing <b>Guess&nbsp;Who?</b> — it
        holds a coin and tries to guess, among all the clusters on its
        board, whose money this was. This coin came through a coinjoin, so
        its trace runs back to <b>several</b> clusters, all lit up: its
        <b>candidate origins</b>, an anonymity set. (Researchers measure
        exactly this — the entropy of a coin's candidate set, read off
        the graph structure: Kelen &amp; Seres. It grows by coinjoining,
        especially with widely chosen peers — and it can decay much
        faster than it grew.)</p>
        <p>Every observation is an answered yes-or-no question, and enough
        answers always win the game. The question is not whether the
        observer makes progress, but <b>how fast</b>.</p>`,
      focus: at(tracedCoin),
      select: sel("coin", tracedCoin),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "many-routes-back",
      title: "Many routes back",
      html: `<p>Look at <i>how</i> the trace reaches each origin. A candidate
        connected by a <b>single route</b> hangs by a thread: deanonymize
        anyone along it and that origin is cut off — and where such cuts
        sever the graph into regions, progress compounds. A candidate connected
        by <b>two or more separate routes</b> survives any single cut.</p>
        <p>The status line counts them: how many origins stay connected by
        two disjoint routes. That robustness is what keeps the observer in
        the slow, question-by-question game.</p>`,
      focus: at(tracedCoin),
      select: sel("coin", tracedCoin),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "suppose-one-name",
      title: "Suppose one name falls",
      html: () => {
        const g = auxGrant();
        const setup = `<p>Now make an <b>assumption</b> and compute what
          follows. The record itself never hands over a name — but names
          arrive from outside it: a KYC record, a counterparty's books, a
          subpoena. So <i>suppose</i> the observer learns one auxiliary
          user's coins${g ? ` — say, <b>${g.name}'s</b>` : ""}. That
          supposition is the input; everything after is arithmetic on the
          public graph.</p>`;
        if (!g) {
          return `${setup}
            <p>Two things can happen. The named user's coins simply drop
            out of this coin's candidate origins — the set shrinks by
            what was learned, no more. That is <b>additive</b> decay. Or
            the named coins sat on every route back to <i>other</i>
            origins, and those origins fall too — candidates the name
            never touched. That is the <b>multiplicative</b> regime: cuts
            that pay beyond their own size.</p>`;
        }
        const d = g.decay;
        const fractured = d.fractured > 0;
        const consequence = fractured
          ? `<p>Run it on this coin: of its <b>${d.before}</b> candidate
            origins, <b>${d.granted}</b> are ${g.name}'s and drop out —
            that much was paid for. But ${g.name}'s coins also sat on
            every route back to <b>${d.fractured}</b> more origin${d.fractured === 1 ? "" : "s"},
            and ${d.fractured === 1 ? "it falls" : "they fall"} too,
            for free: <b>${d.after}</b> candidates remain. The eliminated
            coins were a <b>boundary</b> — removing them fractured the
            coin's past into regions, and whole regions went dark at
            once. One name, and the observer's progress stopped being
            one-candidate-at-a-time: that is <b>multiplicative</b> decay,
            and an adversary holding many such names makes progress at
            an exponential rate.</p>`
          : `<p>Run it on this coin: of its <b>${d.before}</b> candidate
            origins, <b>${d.granted}</b> ${d.granted === 1 ? "is" : "are"}
            ${g.name}'s and drop${d.granted === 1 ? "s" : ""} out —
            and nothing else follows: <b>${d.after}</b> candidates
            remain, every one still reachable around the named coins.
            That is <b>additive</b> decay, the slow regime — and it is
            the previous step's robustness doing the work. The same
            assumption against a brittler past would have severed whole
            regions: candidates the name never touched, falling for
            free. That <b>multiplicative</b> regime is where an
            adversary holding many names makes progress at an
            exponential rate.</p>`;
        return `${setup}${consequence}
          <p>What no one can compute is <b>which names an adversary
          holds</b>. The honest statement of the limit is exactly that
          size: we can't know the adversary's hand — we can show what
          any given hand wins. A chain-analysis vendor holding granular
          KYC data may be playing the multiplicative game on a graph
          that looks, from outside, comfortably ambiguous.</p>`;
      },
      focus: at(tracedCoin),
      select: sel("coin", tracedCoin),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "two-coins-meet",
      title: "Two coins meet",
      html: `<p>Then somebody spends two coinjoined coins <b>in one
        transaction</b> — coins whose pasts run through different
        sessions. The observer traces both together: the union of the two
        pasts is partly lit, and their <b>intersection</b> — the clusters
        that appear in <i>both</i> — burns at full strength. Everything
        irrelevant fades (press <b>h</b> to hide it outright).</p>
        <p>The spend is only one way to hand over the link. Any evidence
        that two coins share an owner — <b>on chain or off</b> — opens the
        same attack: researchers showed web trackers on merchant checkout
        pages leak enough to link coins across coinjoins from the
        adversary's armchair (Goldfeder et al., "When the Cookie Meets
        the Blockchain").</p>
        <p>Click any transaction to trace all of its inputs together this
        way; clicking coins adds them to the trace one by one (a gold
        ring marks the shared origins).</p>`,
      focus: at(crossTx),
      select: sel("tx", crossTx),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "the-sets-shrink-fast",
      title: "The sets shrink fast",
      html: `<p>Whoever owns those two coins sits in <b>both</b> candidate
        sets — so only the intersection remains, and it is usually far
        smaller than either set. One linkage can cut the candidates by a
        factor, not by one: the observer is playing twenty questions, not
        crossing names off a list. When the two pasts are mostly different,
        that is progress <b>exponential</b> in the number of
        observations.</p>
        <p>Consolidation compounds it: every <i>additional</i> coin in
        the spend is another candidate set for the same owner to sit in —
        each one intersected against the rest. Three coins spent together
        can do to the observer's shortlist what three separate
        observations would.</p>
        <p>And a hit ripples outward by elimination: identify one
        participant and every session they touched loses a candidate —
        everyone else's set shrinks too. Careless spending <i>after</i> a
        coinjoin undermines the coinjoin itself, retroactively — and, as
        the Scroll series on intersection attacks puts it, much more
        rapidly than seems intuitive.</p>`,
      focus: at(crossTx),
      select: sel("tx", crossTx),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "toxic-change",
      title: "Toxic change",
      html: `<p>The classic way to hand over such a linkage is <b>change</b>.
        A coinjoin's change output matches nothing on the menu — an amount
        analyst can pick it out at a glance and hand it straight back to
        its owner's pre-coinjoin cluster. The cautious observer shown here
        declines to weld it, but the amounts already answered the question.
        Spend it beside a coinjoined coin, as happened here, and the two
        pasts are joined: the session's ambiguity is spent along with
        it.</p>
        <p>The denominated outputs hide among identical ones — they have
        an anonymity set. The change never did: its amount is unique to
        its owner, so spending it beside a coinjoined coin hands the
        observer the link for free.</p>`,
      focus: at(toxicTx),
      select: sel("tx", toxicTx),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "twenty-questions-in-coins",
      title: "Twenty questions, in coins",
      html: `<p>This is the arithmetic behind "bounded ambiguity". A coinjoin
        among a handful of strangers adds a few candidates — a couple of
        answered questions' worth. An observer who can link spends,
        intersect candidate sets, and bring in what it already knows
        spends those answers quickly. Ambiguity is a budget, and every
        linkage draws it down.</p>
        <p>The defenses cut the other way: pick peers widely, keep routes
        back to origins plentiful, and treat change with suspicion. The
        game continues — from here, try tracing coins yourself.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
  ];
}
