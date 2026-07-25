// Chapter 2: the unilateral economy — ten people, three communities,
// everyday obligations, and every payment made the naive way. The chapter
// ends where the observer's story (clustering) begins.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function economySteps(bounds: () => Rect): TutorialStep[] {
  const focus = (): Rect => {
    const b = bounds();
    return { x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 };
  };
  return [
    {
      id: "neighborhood",
      title: "The neighborhood",
      html: `<p>Meet the rest of the cast: <b>ten people, three
        communities</b>. Grace runs a bike shop, Heidi owns a studio and
        rents to Judy, Bob fixes things, Dave builds websites. Each color
        is one person's coins; white coins left the neighborhood.</p>
        <p>The colors and labels are your storyteller's-eye view — none of
        it is written on the chain.</p>
        <p>Everyone starts with savings — the coins on the left edge.</p>
        <p class="tut-aside">Open the <b>cast</b> panel (bottom left) to
        read anyone's character sheet.</p>`,
      focus,
      view: 1,
      scene: 1,
    },
    {
      id: "days-pass",
      title: "Days pass",
      html: `<p>Time moves in days. Each day brings a few ordinary
        obligations — rent, invoices, repairs, bike parts — and everyone
        pays the only way this world knows yet: a plain transaction,
        <b>payment out, change back</b>.</p>
        <p>Press <b>next day</b> (bottom right) to move time yourself and
        watch the graph grow.</p>`,
      focus,
      view: 1,
      scene: 1,
      minDay: 21,
    },
    {
      id: "follow-the-money",
      title: "Follow the money",
      html: `<p><b>Click any coin</b> — everything in its history lights
        up: every transaction and coin it descends from, all the way back
        to someone's savings. Click a transaction to trace all of its
        inputs at once. Click empty space to clear.</p>
        <p>In this world the trace is a <i>certainty</i>: each coin has
        exactly one history, it is public, and every hop along it tells a
        single owner's story.</p>`,
      focus,
      view: 1,
      scene: 1,
      minDay: 21,
    },
    {
      id: "what-leaks",
      title: "What leaks, and to whom",
      html: `<p>Carol thinks she has nothing to hide — every spend chains
        back to her identified exchange withdrawal, and she is fine with
        it. The others are not: Judy pays her landlord from the same
        wallet her clients pay into; Bob's clients can compare his rates;
        Grace's suppliers can size her revenue.</p>
        <p>Nobody here is doing anything wrong. They just have ordinary
        counterparties with ordinary curiosity — and, so far, no better
        way to pay.</p>`,
      focus,
      view: 1,
      scene: 1,
      minDay: 21,
    },
    {
      id: "someone-watching",
      title: "Someone watching",
      html: `<p>So far you've been all-seeing: every coin wears its
        owner's color and a label saying what it was for. A real observer
        gets neither — only the transactions themselves.</p>
        <p>How much of the color can an observer <i>reconstruct</i> from
        the shapes alone? That's the next chapter.</p>`,
      focus,
      view: 1,
      scene: 1,
      minDay: 21,
    },
  ];
}
