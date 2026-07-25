// Chapter 4: payjoin — the first collaborative form. The one-author
// assumption breaks, CIOH is falsified by construction, and the honest
// limits appear: the record cannot settle an outsider's suspicion; the
// counterparty simply knows. Then the honest SIZE of the win (the
// writeup's entropy footnote: a couple of readings, ~1.58 bits at best
// for the 2-in-2-out shape, in isolation), and the way context spends
// it: when the rest of the record already attributes the two inputs to
// two different clusters, CIOH's one-owner reading CONTRADICTS the
// map, and a careful observer reads the contradiction as detection —
// two clusters cooperating — which almost certainly breaks the payjoin
// retroactively (Yuval's steer superseding the old "doubt spreads"
// step, whose claim ran the wrong way). The chapter closes with the
// generalization ladder the town skips (NS1R, NSNR — writeup's
// many-senders sections) on the way to the general form.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Chain, type TxId } from "../model/chain";
import { clusterObserver } from "../analysis/clusters";
import { type EconomyEvent } from "../engine/economy";

/** What the rest of the record says about one payjoin's inputs: set the
 *  transaction's own evidence aside (`except`) and ask where every
 *  other observation puts them. `distinct` means no two inputs share a
 *  prior cluster; `sizes` are the prior clusters' member counts, in
 *  input order (a size-1 prior is no attribution at all, so the
 *  contradiction only fires when distinct clusters have size >= 2).
 *  Observer-computable throughout: public chain, public heuristics,
 *  no latent truth. */
export interface PayjoinDetection {
  distinct: boolean;
  sizes: number[];
}

export function payjoinDetection(
  chain: Chain,
  usdPrice: ((day: number) => number | undefined) | undefined,
  tid: TxId,
): PayjoinDetection | undefined {
  const tx = chain.txs.get(tid);
  if (!tx || tx.inputs.length < 2) return undefined;
  const cl = clusterObserver(chain, usdPrice, { except: new Set([tid]) });
  const reps = tx.inputs.map((i) => cl.rep.get(i)!);
  return {
    distinct: new Set(reps).size === reps.length,
    sizes: reps.map((r) => cl.members.get(r)!.length),
  };
}

/** whether a detection is the strong case the narration can lean on:
 *  every input already attributed (size >= 2) and to different clusters */
export function detectionFires(d: PayjoinDetection | undefined): boolean {
  return !!d && d.distinct && d.sizes.every((s) => s >= 2);
}

/** the chapter's exhibit: prefer a 2-input payjoin the rest of the
 *  record DETECTS (the contradiction beat lands hardest on a live
 *  positive), then any 2-input payjoin, then whatever exists. Selection
 *  reads only observer-computable evidence. */
export function selectPayjoinExhibit(
  events: EconomyEvent[],
  chain: Chain,
  usdPrice?: (day: number) => number | undefined,
): TxId | undefined {
  const pjs = events.filter((e) => e.form === "payjoin" && chain.txs.has(e.tid));
  const two = pjs.filter((e) => chain.txs.get(e.tid)!.inputs.length === 2);
  return (
    two.find((e) => detectionFires(payjoinDetection(chain, usdPrice, e.tid))) ??
    two[0] ??
    pjs[0]
  )?.tid;
}

export function payjoinSteps(
  bipBounds: () => Rect,
  payjoinFocus: () => Rect,
  payjoinTx: () => string | undefined,
  detection: () => PayjoinDetection | undefined,
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
        payment needed. But the record cannot settle it: every feature
        this observer reads — amounts, inputs, outputs, structure — is
        consistent with both readings, so suspicion stays suspicion.
        (Real wallets also leave <b>fingerprints</b> the town's do not —
        quirks of how a wallet builds its transactions — and those can
        tilt the guess further without settling it.)</p>
        <p>The payee is not fooled at all: they contributed their coin, so
        they know <b>exactly</b> which inputs were the payer's. What a
        counterparty learns is a fixed point, and each payment adds
        another.</p>
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
      id: "how-big-is-the-doubt",
      title: "How big is the doubt?",
      html: `<p>Be honest about the size of the win. Take this transaction
        in isolation: two inputs, two outputs. Counting its plausible
        readings — one payer, or a payjoin; this output the payment, or
        that one — gives only a <b>handful of interpretations</b>. In
        information terms that is under two bits of uncertainty in the
        best case, and the two-input, two-output shape is close to the
        best a payjoin gets: piling on more inputs doesn't grow the
        ambiguity the way the combinatorics might suggest, because
        consolidated inputs read as one thing.</p>
        <p>A couple of readings is real doubt — the change guess went
        quiet, the cluster weld might be wrong — but it is <b>small</b>
        doubt. And it was counted <i>ignoring the transaction's
        context</i>. The next step puts the context back.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 45,
      select: selectIt,
    },
    {
      id: "the-map-fights-back",
      title: "The map fights back",
      html: () => {
        const d = detection();
        const fires = detectionFires(d);
        const setup = `<p>The observer holds more than this one
          transaction: the <b>whole record</b>, clustered. So run the
          check a careful observer runs — set this transaction's own
          evidence aside and ask where everything <i>else</i> puts its two
          inputs.</p>`;
        if (fires) {
          const [a, b] = d!.sizes;
          return `${setup}
            <p>Here the rest of the record answers loudly: the two inputs
            already sit in <b>two different clusters</b> (${a} and ${b}
            coins of prior evidence). CIOH's one-owner reading
            <b>contradicts the observer's own map</b> — and with solid
            clustering on both sides, the natural resolution is not "my
            clusters are wrong" but "<b>this is two people's coins in one
            transaction</b>." The payjoin is detected, retroactively: the
            handful of readings collapses back to one, the weld is
            unwound, and the observer walks away with something new — an
            <b>edge between two clusters</b>, a record that these two
            pseudonyms transact. Strong evidence, not proof — the prior
            map is itself built from heuristics — but it is the observer's
            best explanation, and it usually holds.</p>
            <p>The lesson cuts against the last step's comfort: a
            payjoin's few bits of cover are spent easily by <b>good prior
            clustering</b> — and in this town, with no address reuse and
            simple wallets, the prior clustering is <i>worse</i> than a
            real observer's.</p>`;
        }
        return `${setup}
          <p>In this run the record happens to answer quietly: the rest of
          the map doesn't attribute both inputs to established, distinct
          clusters, so CIOH's one-owner reading stands
          <b>uncontradicted</b> and the doubt survives. Don't read that as
          the defense working — it is the prior clustering being
          <b>thin</b>, luck rather than protection. On a busier chain,
          with address reuse and years of history, the two payers' coins
          usually carry enough prior evidence that the one-owner reading
          collides with the map — and a careful observer resolves the
          collision as <b>detection</b>: two clusters cooperating, the
          payjoin broken retroactively, and a new edge between the two
          pseudonyms as the prize.</p>`;
      },
      focus: () => pad(payjoinFocus()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 45,
      select: selectIt,
    },
    {
      id: "many-senders",
      title: "More senders, same limits",
      html: `<p>The payjoin generalizes, and each rung inherits the same
        limits. <b>Many senders, one receiver</b>: several payers and the
        payee build one transaction that looks like an ordinary batched
        payout — an exchange paying withdrawals, an employer paying
        salaries. The senders gain cover from the crowd, but the
        <b>receiver</b> is a counterparty to all of them: it learns which
        inputs were each sender's — spent now, but everything they cluster
        with — and each sender's <b>change</b>, a live coin in that
        sender's wallet, so what remains of each wallet is partly mapped
        too. A sender who consolidates many coins into the join hands over
        that much more. <b>Many senders, many receivers</b>:
        payments to different receivers share one transaction, and each
        hidden sub-transaction still relates one payment to one amount —
        so the amounts themselves keep discriminating between readings,
        the same arithmetic the observer's sub-transaction analysis
        runs.</p>
        <p>The town doesn't run these forms — batched payouts need a
        batcher, and this neighborhood has none — but they mark the path.
        And they show what the defense would need to work at scale: the
        collaborative shape has to be the <b>norm, not the exception</b>,
        or each instance stands out as a fingerprint of its own.</p>
        <p>The next chapter takes a different rung: what if the
        neighborhood nets out several obligations in <i>one</i>
        transaction — and some legs never touch the chain at all?</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 45,
      select: () => null, // the chapter widens back out: exhibit released
    },
  ];
}
