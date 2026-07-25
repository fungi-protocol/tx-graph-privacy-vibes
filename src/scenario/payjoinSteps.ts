// Chapter 4: payjoin — the first collaborative form. The one-author
// assumption breaks, CIOH is falsified by construction, and the honest
// limits appear: outsiders can suspect but not cheaply prove; the
// counterparty simply knows.
import { type TutorialStep, type Rect } from "../ui/tutorial";

export function payjoinSteps(
  bipBounds: () => Rect,
  payjoinFocus: () => Rect,
  payjoinTx: () => string | undefined,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  // the chapter's exhibit is one concrete transaction: keep it selected
  // (traced) while the steps walk around it, so the eye never loses it
  const selectIt = (): { kind: "tx"; id: string } | null => {
    const id = payjoinTx();
    return id ? { kind: "tx", id } : null;
  };
  return [
    {
      id: "neighborhood-learns-a-trick",
      title: "The neighborhood learns a trick",
      html: `<p>Around day 30, word gets around: a payee can <b>contribute a
        coin of their own</b> to the transaction that pays them. Their
        output is then the payment <i>plus</i> their own coin coming back —
        a <b>payjoin</b>.</p>
        <p>Look at this one: two inputs, two outputs, payment out, change
        back. At a glance, nothing marks it as different. That is the
        point.</p>
        <p>Coordinating takes effort, so not everyone bothers every time —
        each payer weighs fees, hassle, and how much the naked link
        bothers them.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 0,
      scene: 1,
      minDay: 45,
      select: selectIt,
    },
    {
      id: "the-heuristic-lies",
      title: "The heuristic lies",
      html: `<p>Flip to the observer. CIOH reads this transaction's inputs
        as one owner — but they were <b>two people's coins</b>. A
        transaction that spends inputs owned by more than one user
        <b>falsifies CIOH by construction</b>.</p>
        <p>The observer's cluster now welds payer and payee together, and
        the change guess goes quiet too: the payment output isn't a round
        amount any more — the payee's own coin is stirred in — so the
        observer has nothing to grab.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 45,
      select: selectIt,
    },
    {
      id: "no-privacy-from-the-counterparty",
      title: "No privacy from the counterparty",
      html: `<p>Be precise about who is fooled. An outsider <i>can
        suspect</i> this is a payjoin — any two-input spend could be one,
        and sometimes an input looks unnecessary, more coin than the
        payment needed — but cannot cheaply prove it, and suspicion alone
        doesn't say which input was whose.</p>
        <p>The payee is not fooled at all: they contributed their coin, so
        they know <b>exactly</b> which inputs were the payer's. What a
        counterparty learns is a fixed point — it compounds with every
        payment, and it never decays.</p>
        <p>You are looking through the payee's eyes now: their own coins,
        everything their payments taught them — <b>known</b> for direct
        evidence, <b>likely</b> where it seeds the public heuristics — and
        gray where they are as blind as any outsider.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 1,
      lens: 2,
      scene: 1,
      minDay: 45,
      select: selectIt,
    },
    {
      id: "doubt-spreads",
      title: "Doubt spreads",
      html: `<p>Here is the quiet consequence: once payjoins are common,
        <b>every</b> multi-input transaction carries a little doubt — even
        the honest single-owner ones. An observer who keeps applying CIOH
        blindly starts welding strangers together until the clusters
        collapse into nonsense; a careful one must hedge every merge.</p>
        <p>One payment, two people. The next chapter asks: what if the
        neighborhood settles several obligations in <i>one</i>
        transaction?</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 45,
      select: () => null, // the chapter widens back out: exhibit released
    },
  ];
}
