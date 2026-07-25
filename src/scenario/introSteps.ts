// Chapter 1 (skippable): what a transaction is, what a UTXO is, how a
// payment makes change, where the fee goes — told over Alice's first coins.
import { type TutorialStep } from "../ui/tutorial";
import { type Layout, coinAnchor, type Rect } from "../ui/blockview";
import { type BipLayout } from "../ui/bipartite";

function pad(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

function union(...rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w));
  const y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function introSteps(layout: Layout, bip: BipLayout): TutorialStep[] {
  const r1 = coinAnchor(layout, "r1")!;
  const t1 = layout.txs.get("t1")!;
  const t2 = layout.txs.get("t2")!;
  const t1o2 = coinAnchor(layout, "t1o2")!;
  const all = layout.bounds;

  return [
    {
      id: "meet-alice",
      title: "Meet Alice",
      html: `<p>Alice bought some bitcoin at an exchange and withdrew it:
        <b>one coin of 1,000,000 sats</b> (sats — satoshis — are bitcoin's
        smallest unit; 100 million make one bitcoin).</p>
        <p>A bitcoin wallet doesn't hold a balance the way a bank account
        does — it holds <b>coins</b>, each one a distinct object whose
        value was chosen when it was made.</p>
        <p class="tut-aside">(You can drag and zoom the view at any time —
        this tour will wait.)</p>`,
      focus: pad(r1, 120),
      view: 0,
      scene: 0,
    },
    {
      id: "whole-coins",
      title: "A transaction spends whole coins",
      html: `<p>Alice pays Bob <b>250,000 sats</b> for his used bike.</p>
        <p>She can't tear a piece off her coin — a transaction consumes its
        input coins <b>whole</b> (left side) and mints brand-new coins as
        outputs (right side). Think of every sat as a grain of gold: a
        transaction melts the coins fed into it and casts the metal into
        new coins of arbitrary weights.</p>
        <p>The line into the card is Alice's coin being spent; the boxes on
        the right are the coins that now exist instead of it.</p>`,
      focus: pad(t1, 90),
      view: 0,
      scene: 0,
    },
    {
      id: "change",
      title: "Change",
      html: `<p>250,000 sats go to Bob. The rest returns to Alice as a new
        coin: her <b>change</b>.</p>
        <p>On the chain, no label says "change" — the new coin that returns
        to Alice is minted just like the one that goes to Bob. An observer
        can only <i>guess</i> which output was the payment and which stayed
        with the sender. But the guesses can be shrewd. Careless wallet
        software always lists the payment first and the change after it.
        Address types talk too: when every input a wallet spends is one
        type and exactly one output matches it — while the other output is
        a different type — the matching output is probably the change
        going back home. Remember this game; it matters soon.</p>`,
      focus: pad(union(t1o2, t1), 70),
      view: 0,
      scene: 0,
    },
    {
      id: "fees",
      title: "Fees",
      html: `<p>Add up the outputs and they come to slightly less than the
        input. The difference — here <b>308 sats</b> — is the
        <b>fee</b>.</p>
        <p>Fees pay for the block space a transaction occupies: its size
        (in virtual bytes) times the going feerate. When blocks are busy,
        the rate climbs; patient spenders wait for quiet moments.</p>`,
      focus: pad(t1, 90),
      view: 0,
      scene: 0,
    },
    {
      id: "utxos",
      title: "UTXOs — the coins that exist right now",
      html: `<p>Coins that haven't been spent yet are drawn with <b>bold
        borders</b>: the <b>unspent transaction outputs</b>, or UTXOs.
        They're what wallets actually hold.</p>
        <p>Spending a coin doesn't erase it. The record of where it came
        from and where it went stays public, forever, for everyone.</p>`,
      focus: pad(all, 60),
      view: 0,
      scene: 0,
    },
    {
      id: "chain-remembers",
      title: "The chain remembers",
      html: `<p>Follow Alice's coffee payment backwards: it came from her
        change, which came from the bike purchase, which came from her
        <b>exchange withdrawal</b> — where her name is on file.</p>
        <p>Anyone can do this walk. The café can. The exchange can. Bob
        can. Only the exchange knows the name behind the withdrawal — but
        the trail to its door is public.</p>
        <p>What that means for Alice — and what a whole neighborhood of
        people can do about it — is the rest of this story.</p>`,
      focus: pad(union(coinAnchor(layout, "r1")!, t2), 60),
      view: 0,
      scene: 0,
    },
    {
      id: "two-drawings",
      title: "Two drawings, one graph",
      html: `<p>Here is the same history drawn differently: coins and
        transactions are both nodes now — a <b>bipartite graph</b>, two
        kinds of node, edges only between kinds.</p>
        <p>Nothing changed but the picture. Every spent coin still sits
        between the transaction that minted it and the one that spent it;
        unspent coins dangle at the right, and coins that entered from
        outside — like Alice's withdrawal — start at the left. Money still
        flows left to right through time.</p>`,
      focus: pad(bip.bounds, 80),
      view: 1,
      scene: 0,
    },
    {
      id: "toggle-freely",
      title: "Toggle freely",
      html: `<p>From here on both drawings are yours: press <b>v</b> or use
        the button in the corner to flip between the card view and
        the graph view whenever you like.</p>
        <p>That's the toolbox. Next: more people, more payments — and
        someone watching.</p>`,
      focus: pad(bip.bounds, 80),
      view: 1,
      scene: 0,
    },
  ];
}
