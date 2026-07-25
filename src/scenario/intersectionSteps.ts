// Chapter 7: intersection attacks — deanonymization as a guessing game.
// A coinjoined coin's candidate origins are clusters, an anonymity set;
// every observation is an answered yes-or-no question. Linking two
// post-coinjoin coins intersects their candidate sets, and intersections
// cut by factors, not by items — the adversary plays twenty questions,
// not process-of-elimination. The corrected highlight semantics carry the
// chapter: intersection fully lit, union partly, the rest dimmed.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export interface Focused {
  id: string;
  rect: Rect;
}

export function intersectionSteps(
  bipBounds: () => Rect,
  tracedCoin: () => Focused | undefined,
  crossTx: () => Focused | undefined,
  toxicTx: () => Focused | undefined,
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
        <b>candidate origins</b>, an anonymity set.</p>
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
      id: "two-coins-meet",
      title: "Two coins meet",
      html: `<p>Then somebody spends two coinjoined coins <b>in one
        transaction</b> — coins whose pasts run through different
        sessions. The observer traces both together: the union of the two
        pasts is partly lit, and their <b>intersection</b> — the clusters
        that appear in <i>both</i> — burns at full strength. Everything
        irrelevant fades (press <b>h</b> to hide it outright).</p>
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
        <p>And a hit ripples outward by elimination: identify one
        participant and every session they touched loses a candidate —
        everyone else's set shrinks too.</p>`,
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
