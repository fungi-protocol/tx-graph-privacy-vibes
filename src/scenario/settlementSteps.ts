// Chapter 5: net settlement — the most general form of multiparty
// payjoin. Several obligations, one transaction; only the net balances
// touch the chain. Honest limits stay in frame: insiders can solve the
// edge they are not on, and the graph keeps its community structure.
// The chapter DISPLAYS the computed sub-transaction verdict for its
// selected settlement rather than asserting one — the same
// verdict-conditional rule the coinjoin chapter follows.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Chain, type TxId } from "../model/chain";
import { subTransactionMapping, type SubMapping } from "../analysis/subsetsum";
import { type EconomyEvent } from "../engine/economy";

/** the chapter's exhibit: prefer a full cycle (as many obligations as
 *  parties), then any three-party settlement, then whatever exists —
 *  shared between the app and the per-seed guarantee test */
export function selectSettlementExhibit(
  events: EconomyEvent[],
  chain: Chain,
): { tid: TxId; payer: number } | undefined {
  const evs = events.filter((e) => e.form === "settlement");
  const count = (tid: TxId): number => evs.filter((e) => e.tid === tid).length;
  return (
    evs.find((e) => chain.txs.get(e.tid)!.inputs.length >= 3 && count(e.tid) >= 3) ??
    evs.find((e) => chain.txs.get(e.tid)!.inputs.length >= 3) ??
    evs[0]
  );
}

/** the sub-transaction verdict for one settlement, via the shared
 *  analysis entry point */
export function settlementVerdict(chain: Chain, tid: TxId): SubMapping["kind"] {
  const tx = chain.txs.get(tid)!;
  const value = (id: string): number => chain.coins.get(id)!.value;
  return subTransactionMapping(tx.inputs.map(value), tx.outputs.map(value), tx.fee).kind;
}

export function settlementSteps(
  bipBounds: () => Rect,
  settleFocus: () => Rect,
  settleAgent: () => number | undefined,
  exhibitVerdict: () => SubMapping["kind"] | undefined,
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
        payment: each is one participant's net across everything they
        settled, and a net can be far from any amount owed. Nor do the
        amounts readily
        pair an output with the inputs that fed it: where a plain
        payment wears its amount openly, a net is no number the observer
        already knows to look for. And one transaction is cheaper than
        three.</p>`,
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 0,
      scene: 1,
      minDay: 60,
    },
    {
      id: "the-amounts-are-gone",
      title: "The amounts are gone",
      html: () => {
        // display the computed verdict for THIS settlement — assert
        // nothing the analysis didn't return (a per-seed test holds
        // every tutorial seed's exhibit to a non-unique verdict, so
        // the title never overclaims)
        const v = exhibitVerdict();
        const verdictLine =
          v === "atomic"
            ? `Run it on the settlement in front of you and it returns
              <b>nothing to split</b>: value moved between the
              participants, so no group of inputs and outputs balances
              on its own.`
          : v === "ambiguous"
            ? `Run it on the settlement in front of you and it returns
              <b>several balanced readings</b> — the analysis cannot
              single one out.`
          : v === "inconclusive"
            ? `Run it on the settlement in front of you and it gives up
              before finishing — too many combinations to enumerate,
              and an aborted search proves nothing either way.`
            : `Run it on the settlement in front of you and it finds a
              unique split — an unlucky coincidence of amounts; most
              settlements give it nothing.`;
        return `<p>Flip to the observer. CIOH reads this as one entity's
        spend and welds <b>all</b> the participants into a single cluster
        — wronger than ever.</p>
        <p>Worse for the observer: with a cycle inside, a participant's net
        can land anywhere, <b>including near zero</b>. In a payjoin the
        payment amount at least still constrained the guesses; here the
        amounts on chain say almost nothing about who paid whom.</p>
        <p>The sharper test is the <b>sub-transaction analysis</b> — the
        matching game over amounts. ${verdictLine}</p>`;
      },
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 60,
    },
    {
      id: "insiders-do-the-math",
      title: "Insiders can still do the math",
      html: `<p>Hidden from outsiders — but what an <b>insider</b> learns
        depends on the protocol the participants use to construct the
        transaction. This town's settlements are coordinated in the
        open: the room sees every contribution, and each participant
        knows the obligations they are on — in this settlement, two of
        the three. That is enough to <b>solve the edge they are not
        on</b>: two knowns and the nets leave one unknown.</p>
        <p>A protocol can be built to show each participant less — that
        design space is outside this story. The town's open version
        marks its simple end.</p>
        <p>You are looking through one participant's eyes. Same rule as the
        payjoin, more of it: every settlement adds to what its insiders
        hold.</p>`,
      focus: () => pad(settleFocus()),
      view: 1,
      lens: 2,
      agent: settleAgent,
      scene: 1,
      minDay: 60,
    },
    {
      id: "what-still-shows",
      title: "What still shows",
      html: `<p>Netting is not a cloak, and it is not all-or-nothing
        either. What shrinks a participant's net is <b>offsetting</b>:
        anyone who both owes and is owed nets the two against each other.
        In a <b>chain</b> — Alice pays Bob, Bob pays Carol — Bob offsets
        and his net shrinks, but the endpoints have nothing to offset and
        still move roughly their full amounts. In a full <b>cycle</b>
        everyone offsets, and every net can shrink toward zero. Most
        settlements sit between those extremes: whoever mixes incoming
        and outgoing obligations nets down, whoever doesn't, shows.</p>
        <p>That is the truth's side. The observer can't tell which case
        they are looking at: nothing on chain says how many payments one
        settlement compressed, what their magnitudes were, or whether
        any of them offset. For all the observer knows any of these may
        be happening — which removes constraints from the
        sub-transaction analysis, potentially leaving every
        amount-consistent reading plausible. Other indicators — wallet
        fingerprints, the graph around the transaction — can still
        inform it.</p>
        <p>Settlements happen between people who already do business,
        so recurring relationships repeat on chain: over time the
        community structure of the cluster graph becomes apparent in
        the transaction graph.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 60,
    },
  ];
}
