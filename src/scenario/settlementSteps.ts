// Chapter 5: net settlement — the most general form of multiparty
// payjoin. Several obligations, one transaction; only the net balances
// touch the chain. Honest limits stay in frame: what participants
// learn depends on the protocol used to construct the transaction
// (not modeled here), and the graph keeps its community structure.
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
      view: 0,
      lens: 0,
      nf: false, // plain CIOH first: the check re-enters the prose at "What still shows"
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
        return `<p>Flip to the observer — with the fingerprint check set
        aside for a moment, to see what the plain heuristics make of
        this shape. CIOH reads it as one entity's spend and merges
        <b>all</b> the participants into a single cluster — wronger than
        ever.</p>
        <p>Worse for the observer: with a cycle inside, a participant's net
        can land anywhere, <b>including near zero</b>. In a payjoin the
        payment amount at least still constrained the guesses; here the
        amounts on chain say almost nothing about who paid whom.</p>
        <p>The sharper test is the <b>sub-transaction analysis</b> — the
        matching game over amounts: which groups of inputs and outputs
        balance on their own? It just joined the heuristics panel on the
        left — the first two heuristics carried the story this far, and
        this is the transaction shape that finally calls for it.
        ${verdictLine}</p>`;
      },
      focus: () => pad(settleFocus()),
      view: 0,
      lens: 1,
      overlays: 15,
      scene: 1,
      minDay: 60,
    },
    {
      id: "insiders-and-the-protocol",
      title: "What an insider learns",
      html: `<p>Hidden from outsiders — but what about the people
        <i>inside</i> the transaction? Each participant knows the
        obligations they are on, and, when only two people settle,
        arithmetic alone hands each the rest — a pair hides nothing
        from its two insiders. Beyond that, <b>what participants learn
        depends on the protocol used to construct the transaction;
        this simulation does not model that information
        exchange</b>. This town's settlements are built by
        <b>anonymous broadcast</b> in the semi-honest setting — each
        input and each output submitted independently — so an insider
        is blinded by construction, a disclosed protocol choice.</p>
        <p>You are looking through one participant's eyes: their own
        coins, the payments they were a party to — and gray where the
        record alone, plus what this story models, says nothing.</p>`,
      focus: () => pad(settleFocus()),
      view: 0,
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
        amount-consistent reading plausible. Other indicators can still
        inform it: when the participants' wallets differ, the
        fingerprint check from the last chapter flags the settlement as
        collaborative and spares the observer the everyone-in-one-cluster
        merge — but where detecting the payjoin collapsed it back to one
        reading, detecting a settlement <b>decomposes nothing</b>: the
        amounts still refuse to pair inputs with outputs. And the graph
        around the transaction says more than the transaction does.</p>
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
