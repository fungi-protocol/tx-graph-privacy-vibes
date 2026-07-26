// Chapter 2: the unilateral economy — a small neighborhood to start (the
// town grows as the story needs it, #15), everyday obligations, and every
// payment made the naive way. The chapter ends where the observer's story
// (clustering) begins.
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
      html: `<p>Meet Alice's neighborhood: <b>four people</b>, for now.
        Bob fixes things, Carol pays the obvious way, Dave builds
        websites. Each color is one person's coins; white coins left the
        neighborhood. The town will grow as the story does — the studio
        across town, the bike shop crowd, others — and you will see each
        arrival land on the chain.</p>
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
        <p>Press <b>next day</b> (top right) to move time yourself and
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
        <p>So far there is nothing to puzzle over in what lights up:
        every transaction here has a single author, so each hop is just
        one person paying another — the trace reads as a chain of
        hand-offs. Keep that in mind for later: the history itself will
        always be this public and this permanent; what the later chapters
        change is only how much a hop <i>tells</i>.</p>`,
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
        it. The others are not: Bob's clients can compare his rates and
        size his savings; Dave's client X can learn that client Y exists,
        and his subcontractors can read his margin.</p>
        <p>Nobody here is doing anything wrong. They have ordinary
        counterparties with ordinary curiosity — and, so far, no better
        way to pay. The stakes are not abstract, either: a public record
        of who holds what has repeatedly marked real people for robbery
        and extortion, and the record compounds — data gathered for one
        purpose (an exchange's records, a tax file) has leaked to people
        who use it for another.</p>`,
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
        the shapes alone?</p>`,
      focus,
      view: 1,
      scene: 1,
      minDay: 21,
    },
  ];
}
