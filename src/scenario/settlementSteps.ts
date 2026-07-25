// Chapter 5: net settlement — the most general form of multiparty
// payjoin. Several obligations, one transaction; only the net balances
// touch the chain. Honest limits stay in frame: insiders can solve the
// edge they are not on, and the graph keeps its community structure.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function settlementSteps(
  bipBounds: () => Rect,
  settleFocus: () => Rect,
  settleAgent: () => number | undefined,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "settling-up",
      title: "Settling up",
      html: `<p>Around day 60 the neighborhood tries the next trick. When
        obligations offset — say Judy owes Heidi rent, Heidi owes Ivan for
        shelves, and Ivan owes Judy for a logo — they can settle them all in
        <b>one transaction</b>: everyone contributes coins of their own,
        everyone takes one output.</p>
        <p>Only the <b>net balances</b> touch the chain. No output is a
        payment: what shows is each person's net — and because these
        debts <b>loop</b>, the nets can be far from any amount owed. Not
        the rent, not the shelves, not the logo. And one transaction is
        cheaper than three.</p>`,
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 0,
      scene: 1,
      minDay: 75,
    },
    {
      id: "the-amounts-are-gone",
      title: "The amounts are gone",
      html: `<p>Flip to the observer. CIOH reads this as one entity's spend
        and welds <b>all</b> the participants into a single cluster —
        wronger than ever.</p>
        <p>Worse for the observer: with a cycle inside, a participant's net
        can land anywhere, <b>including near zero</b>. In a payjoin the
        payment amount at least still constrained the guesses; here the
        amounts on chain say almost nothing about who owed whom what.
        (Only the full loop earns this — most days the neighborhood only
        finds pairs and chains to net, and those still whisper.)</p>`,
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 75,
    },
    {
      id: "insiders-do-the-math",
      title: "Insiders can still do the math",
      html: `<p>Hidden from outsiders — not from the room. Each participant
        knows the obligations they are on — in this loop, two of the three
        — and everyone's nets are visible to the room. That is enough to
        <b>solve the edge they are not on</b>: two knowns and the nets
        leave one unknown.</p>
        <p>You are looking through one participant's eyes. Same rule as the
        payjoin, more of it: every settlement adds to what its insiders
        hold.</p>`,
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 2,
      agent: settleAgent,
      scene: 1,
      minDay: 75,
    },
    {
      id: "what-still-shows",
      title: "What still shows",
      html: `<p>Netting is not a cloak. In a <b>chain</b> — Alice pays Bob,
        Bob pays Carol — only the middle party's amounts offset at all; the
        endpoints still move roughly their full amounts. Only a <b>cycle</b>
        lets everyone's net shrink toward zero.</p>
        <p>And the graph keeps its shape: settlements happen between people
        who already do business, so recurring relationships — the community
        structure — show through over time. Show an observer who your
        friends are… The next chapter asks: what if <i>strangers</i>
        shared a transaction too?</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 75,
    },
  ];
}
