// Chapter 8: the finale, watched rather than played. Judy's studio rent
// falls due again; the chapter follows her options, looks through the
// landlord's eyes, and shows what her patience buys: the offsetting
// cycle settles the rent with amounts hidden from outsiders — while
// Heidi, an insider, still solves everything she is part of. The win is
// real and bounded, like every other privacy win in this town.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Focused } from "./intersectionSteps";
import { GAME_DAY } from "../engine/economy";

const HEIDI = 7;

export function gameSteps(
  bipBounds: () => Rect,
  gameSettlement: () => Focused | undefined,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  return [
    {
      id: "rent-day",
      title: "Rent day",
      html: `<p>The studio rent has landed on Judy, the designer renting
        Heidi's studio: <b>$850 to Heidi</b>, due in a week. Her wallet
        weighs the same menu everyone here weighs. <b>Waiting</b> costs a
        little urgency, growing as the deadline nears. <b>Paying now</b>
        costs the fee plus the link it writes into the record. A
        <b>payjoin</b> trades that link for some coordination hassle —
        though Heidi, as the counterparty, learns which coins were Judy's
        either way.</p>
        <p class="tut-aside">Judy is patient, and the deadline is a week
        out — she waits. The next pages show what that buys.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 0,
      scene: 1,
      minDay: GAME_DAY,
    },
    {
      id: "through-the-landlords-eyes",
      title: "Through the landlord's eyes",
      html: `<p>Before she chooses, look through <b>Heidi's</b> eyes.
        Everything she has ever been paid with is a fixed point. Pay the
        rent naively, month after month, and each payment hands her another
        anchor: Judy's coins, her change, the shape of her wallet slowly
        filling in.</p>
        <p>That is the map Judy is trying not to draw for her. Heidi
        doesn't need to be hostile to be the adversary in this
        arrangement — a counterparty with a ledger and a memory is
        one.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 2,
      agent: () => HEIDI,
      scene: 1,
      minDay: GAME_DAY,
    },
    {
      id: "patience-pays",
      title: "Patience pays",
      html: `<p>Judy waited — and the studio's debts came around: Heidi owed
        Ivan for shelves, Ivan owed Judy for the exhibition catalogue. The
        three net their obligations by building <b>one settlement</b>
        together. The rent is paid in
        full, yet no transaction anywhere says "$850, Judy to Heidi" — the
        amounts are hidden from every outsider.</p>
        <p>The win has a boundary, and it is worth knowing exactly where:
        Heidi is an <b>insider</b>, so she still learns the coins Judy
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
        itself. Step the days, flip the lenses and their heuristics, trace
        what the observer would see.</p>
        <p>Everything rides in the URL: the seed, your parameter changes,
        the lens and the day you are looking at. Copy a reference
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
