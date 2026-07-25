// Chapter 8: the game. The player takes Judy's controls just before the
// studio rent falls due again, weighs the same costed plans the dice see,
// and learns what patience buys: the offsetting cycle settles the rent
// with amounts hidden from outsiders — while Heidi, an insider, still
// solves everything she is part of. The win is real and bounded, like
// every other privacy win in this town.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Focused } from "./intersectionSteps";
import { GAME_DAY } from "../engine/economy";

const JUDY = 9;
const HEIDI = 7;

export function gameSteps(
  bipBounds: () => Rect,
  gameSettlement: () => Focused | undefined,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "take-the-controls",
      title: "Take the controls",
      html: `<p>So far the town has run itself. Now <b>play</b>: you are
        Judy, the designer renting Heidi's studio. Your pending payments
        appear in the panel by the day button, each with the same
        menu of plans the dice weigh for everyone else — with the cost
        of each spelled out.</p>
        <p>Nothing happens until you press <b>end turn</b>: your choices
        are locked in, and everyone else rolls their own dice for the day.
        (The cast panel has a <i>play</i> button next to every name.)</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      play: JUDY,
      view: 1,
      lens: 0,
      scene: 1,
      minDay: GAME_DAY - 2,
    },
    {
      id: "rent-day",
      title: "Rent day",
      html: `<p>The studio rent has landed: <b>$850 to Heidi</b>, due in a
        week. Open your decisions and read the menu. <b>Waiting</b> costs a
        little urgency, growing as the deadline nears. <b>Paying now</b>
        costs the fee plus the link it writes into the record. A
        <b>payjoin</b> trades that link for some coordination hassle —
        though Heidi, as the counterparty, learns which coins were yours
        either way.</p>
        <p class="tut-aside">Leave it on <i>wait</i> for now and end the
        turn a couple of times — the next pages show what patience buys.
        You can always come back and try the other paths.</p>`,
      focus: () => pad(bipBounds()),
      play: JUDY,
      view: 1,
      lens: 0,
      scene: 1,
      minDay: GAME_DAY,
    },
    {
      id: "through-the-landlords-eyes",
      title: "Through the landlord's eyes",
      html: `<p>Before you choose, look through <b>Heidi's</b> eyes.
        Everything she has ever been paid with is a fixed point, and fixed
        points compound — they never decay. Pay the rent naively, month
        after month, and each payment hands her another anchor: your coins,
        your change, the shape of your wallet slowly filling in.</p>
        <p>That is the map you are trying not to draw for her. She is not
        an adversary — she is just a landlord with a ledger and a memory,
        which is all it takes.</p>`,
      focus: () => pad(bipBounds()),
      play: JUDY,
      view: 1,
      lens: 2,
      agent: () => HEIDI,
      scene: 1,
      minDay: GAME_DAY,
    },
    {
      id: "patience-pays",
      title: "Patience pays",
      html: `<p>You waited — and the studio's debts came around: Heidi owed
        Ivan for shelves, Ivan owed you for the exhibition catalogue. The
        oracle nets the three obligations into <b>one settlement</b>. Your rent is paid in
        full, yet no transaction anywhere says "$850, Judy to Heidi" — the
        amounts are hidden from every outsider.</p>
        <p>The win has a boundary, and it is worth knowing exactly where:
        Heidi is an <b>insider</b>, so she still learns the coins you
        contributed, and can solve the one edge she is not on. What
        vanishes is the <b>public</b> trail — no monthly wallet-to-wallet
        payment, no change output welding next month's rent to this one,
        and only a net, smaller than the gross, on chain. Outsiders lose
        the thread; Heidi merely has to do the math.</p>`,
      focus: () => {
        const g = gameSettlement();
        return g ? g.rect : pad(bipBounds());
      },
      select: () => {
        const g = gameSettlement();
        return g ? { kind: "tx", id: g.id } : undefined;
      },
      play: JUDY,
      view: 1,
      lens: 0,
      scene: 1,
      minDay: GAME_DAY + 3,
    },
    {
      id: "the-sandbox",
      title: "The sandbox",
      html: `<p>The town is yours now. The <b>params</b> panel re-rolls the
        world: fee market level and volatility, how much everyone starts
        with, how often obligations and purchases arrive — and the seed
        itself. Play any agent, step the days, trace what the observer
        would see.</p>
        <p>Everything rides in the URL: the seed, your parameter changes,
        the agent you play and every choice you made. Copy a reference
        (right-click) and someone else opens the exact same town at the
        exact same moment — your run is an argument they can check.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 0,
      scene: 1,
      minDay: GAME_DAY + 3,
    },
  ];
}
