// Chapter 4: payjoin — the first collaborative form. The chapter's
// idea (#114b): heuristics are sometimes wrong, and a transaction can
// be built deliberately to invalidate them — this is where the
// observer's map and the ground truth stop being refinements of each
// other and can disagree outright. The one-author assumption breaks,
// CIOH is falsified by construction; the observer-side beats run
// first (the honest size of the win, the rest of the graph's answer,
// fingerprints), and only then the counterparty's view: the record
// cannot settle an outsider's suspicion, but the payee simply knows.
// Within the observer beats: the honest SIZE of the win (#110: the
// 2-in-2-out shape admits exactly THREE readings — one payer, or a
// payjoin paired either way — at most log2(3) ≈ 1.6 bits, not
// necessarily equiprobable), and the way context spends it: the
// neighboring transactions, above all the ones spending this
// transaction's outputs, are clustered by CIOH + change identification
// with this transaction's own merge set aside; when the two inputs
// land in distinct clusters with evidence of their own, the one-owner
// reading loses to detection — two clusters cooperating — which breaks
// the payjoin retroactively (Yuval's steer superseding the old "doubt
// spreads" step, whose claim ran the wrong way). Then the second detection
// channel (#103, per Sabouri 2026): wallet fingerprints — the observer
// switches statistical fingerprinting on, and inputs sitting on two
// script types read as two wallets' coins in one transaction, so
// CIOH abstains instead of linking the lie. #111 frames that channel
// as the generalization it is: coin features (not just amounts) as
// evidence splitting a transaction between owners — the change
// identification's feature-reading widened — with a coin's vicinity
// including the transaction that spends it (adjacent on the graph,
// however distant in time); #112's cluster-feature chapter builds on
// exactly this rung. The chapter closes with the
// generalization ladder the town skips (NS1R, NSNR — writeup's
// many-senders sections) on the way to the general form.
import { type TutorialStep, type Rect } from "../ui/tutorial";
import { type Chain, type TxId, type ScriptKind, scriptTitle } from "../model/chain";
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

/** the script types the exhibit's inputs sit on, in input order —
 *  the intra-transaction fingerprint signal (Sabouri 2026): a wallet
 *  keeps its addresses on one script type, so two types among one
 *  transaction's inputs read as two wallets' coins in one spend.
 *  Observer-computable: script types are public on the face of
 *  every output. */
export function inputFamilies(chain: Chain, tid: TxId): ScriptKind[] {
  const tx = chain.txs.get(tid);
  if (!tx) return [];
  const out: ScriptKind[] = [];
  for (const i of tx.inputs) {
    const s = chain.coins.get(i)!.addr?.script;
    if (s !== undefined) out.push(s);
  }
  return out;
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
  families: () => ScriptKind[],
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
      title: "A transaction built by two people",
      html: `<p>Every heuristic in the last chapter is a guess about how
        transactions are <i>usually</i> built — and a guess can be wrong.
        It can also be <b>made</b> wrong: nothing stops two people from
        building one transaction together, shaped deliberately so the
        observer's rules misread it.</p>
        <p>Around day 30, word gets around: a payee can <b>contribute a
        coin of their own</b> to the transaction that pays them. Their
        output is then the payment <i>plus</i> their own coin coming back —
        a <b>payjoin</b>. Look at this one: two inputs, two outputs,
        payment out, change back. At a glance, nothing marks it as
        different. That is the point.</p>
        <p>Coordinating takes effort, so not everyone bothers every
        time.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 0,
      grants: [0, 0], // the observer chapter held the books throughout; this one starts without them
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "the-heuristic-lies",
      title: "The heuristic lies",
      html: `<p>Flip to the observer. CIOH reads this transaction's inputs
        as one owner — but they were <b>two people's coins</b>. A
        transaction that spends inputs owned by more than one user
        <b>falsifies CIOH by construction</b>.</p>
        <p>The observer's cluster now merges payer and payee together.
        The change guess fails with it: the payment output is no longer
        a round amount — the payee's own coin is stirred into it — so no
        output reads as a payment, and with nothing identified, nothing
        is linked.</p>
        <p>Note what changed in kind. A wrong change guess could already
        mislabel a coin here and there, but while every transaction had
        one author, CIOH's merges were all true — the observer's map
        could only be an <i>incomplete</i> version of the truth, each
        cluster a fragment of one real wallet. This transaction put a
        cluster on the map that is <b>no one</b>: payer and payee fused.
        From here the map and the truth can disagree outright.</p>
        <p>Because they can, this story adds a control no observer has:
        <b>point out mistakes</b>, now in the panel and switched on. It
        grades the map against the hidden truth — marking each
        transaction where a heuristic's local call went wrong, like the
        false merge in front of you. The storyteller's ruler, not an
        observer capability: a real analyst never sees their own error
        rate. Keep it in the corner of your eye from here on.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 1,
      mi: true,
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "how-big-is-the-doubt",
      title: "How much doubt?",
      html: `<p>Be honest about the size of the win. Two inputs, two
        outputs: the record admits exactly <b>three readings</b>. One
        payer — both inputs one wallet's, one output the payment, the
        other its change. Or a payjoin, paired one way — the first
        input's owner takes the first output, the second the second. Or
        a payjoin paired the other way. Three maps of who-owns-what,
        each consistent with everything on the transaction's face —
        though nothing says they are equally likely.</p>
        <p>Three readings is at most log<sub>2</sub>3 ≈ 1.6 bits of
        uncertainty. It is real doubt: in two of the three readings the
        inputs belong to different people, so the one-owner merge is
        wrong — and once the inputs are not one wallet's, the change
        linkage has no single payer to hand the remainder to; it could
        belong to either input's owner. But it is a <b>bounded</b>
        doubt, counted on this transaction alone.</p>
        <p>And piling on more inputs raises the count of readings
        without buying cover to match: attacks later in this story —
        the candidate origins, the intersections — feed on exactly
        those extra inputs.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 1,
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "the-map-fights-back",
      title: "Evidence from neighboring transactions",
      html: () => {
        const d = detection();
        const fires = detectionFires(d);
        const setup = `<p>The observer holds more than this one
          transaction: the whole <b>transaction graph</b>, already
          clustered by the heuristics you have. The transactions around
          this one — above all the ones that <b>spend its outputs</b>,
          its neighbors on the graph even when they are far apart in
          time — carry evidence about which of the three readings is
          right. So ask: setting this transaction's own CIOH merge
          aside, where do CIOH and the change identification, run over
          every <i>other</i> transaction, put its two inputs?</p>`;
        if (fires) {
          const [a, b] = d!.sizes;
          return `${setup}
            <p>Here they land in <b>two different clusters</b>, with ${a}
            and ${b} coins of evidence behind them. The one-owner reading
            now asks the observer to believe those two clusters were one
            wallet all along; the payjoin readings ask nothing. With
            independent evidence on both sides, the observer resolves it
            as a <b>detection</b>: two people's coins in one transaction.
            The false merge is unwound retroactively — and the observer
            walks away with something new, an <b>edge between the two
            clusters</b>, a record that these two pseudonyms transact.
            Strong evidence, not proof — the prior clusters are
            themselves built from heuristics — but it is the reading the
            evidence favors.</p>
            <p>The lesson cuts against the last step's comfort: a
            payjoin's ~1.6 bits are spent by <b>good prior clustering</b>
            — and this town's, with scant address reuse and simple
            wallets, is thinner than a real observer's.</p>`;
        }
        return `${setup}
          <p>In this run the neighbors don't decide it: clustering every
          other transaction does not put both inputs into distinct
          clusters carrying evidence of their own, so the one-owner
          reading stands and the three readings survive. Don't read that
          as the defense working — the prior clustering in this small
          town is <b>thin</b>, luck rather than protection. On a chain
          with address reuse and years of history, the two payers' coins
          usually arrive already clustered, and the same check resolves
          the readings into a detection: two clusters cooperating, the
          payjoin broken retroactively, a new edge between the two
          pseudonyms as the prize.</p>
          <p>And prior clustering is not the only channel: the next two
          steps read evidence that needs no history at all — the
          wallets' own fingerprints.</p>`;
      },
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 1,
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "wallets-sign-their-work",
      title: "Wallets sign their work",
      html: () => {
        const f = families();
        const kinds = [...new Set(f)].map(scriptTitle);
        const reading = kinds.length >= 2
          ? `they sit on <b>two script types</b> — ${kinds.join(" and ")}.
          A wallet keeps its addresses on one type, so two types among
          one transaction's inputs read like <b>two wallets' coins in one
          spend</b>.`
          : kinds.length === 1
            ? `both sit on <b>${kinds[0]}</b> — one script type, so on
          this axis the record is mute about how many wallets built the
          transaction.`
            : `the intro scene's coins carry no named wallet, so the
          record is mute here.`;
        return `<p>The record holds one more layer this story has so far
        only mentioned in passing. Every wallet product ships a bundle
        of defaults, and each one is written into the transactions it
        builds: the <b>script type</b> its addresses pay to (public on
        the face of every output), the <b>nLockTime</b> its drafts
        carry, the <b>size of its signatures</b> — some wallets grind
        every signature a byte smaller, the rest leave sizes mixed. None
        of this is secret. It is formatting, and formatting is a
        <b>fingerprint</b>.</p>
        <p>Read this transaction's inputs that way: ${reading}</p>
        <p>And a coin's fingerprint reaches past its own face: the
        transaction that eventually <b>spends</b> it was built by the
        wallet that held it, so that transaction's habits count as the
        coin's too. On the graph the spend sits one edge away from the
        coin, however many months later it happens — vicinity here is
        topology, not time.</p>`;
      },
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 1,
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "the-fingerprint-check",
      title: "Acting on the fingerprints",
      html: () => {
        const f = families();
        const divergent = new Set(f).size >= 2;
        const setup = `<p><i>Statistical fingerprinting</i> just joined
        the panel on the left, switched on. With it, the observer acts
        on what the last step read: a transaction whose inputs sit on
        different script types is taken as <b>probable
        collaboration</b> — two wallets, two people — and CIOH
        <b>abstains</b> rather than record the one-owner reading it
        knows is suspect.</p>`;
        const verdict = divergent
          ? `<p>On this transaction the check <b>fires</b>: the false
        merge this chapter opened with never forms, and the payer's and
        payee's coins sit apart on the observer's map with no
        contradiction to notice retroactively.</p>`
          : `<p>On this transaction the check finds <b>nothing</b>: the
        inputs share one script type, nothing marks the spend as two wallets'
        work, and the merge stands. That is the defense's actual shape —
        a payjoin's cover extends exactly as far as the participants'
        fingerprints agree, and these two happen to match.</p>`;
        return `${setup}${verdict}
        <p>This reading generalizes. The change identification already
        used one coin feature — change usually sits on the same script
        type as the inputs — to tell payment from change. Here the same
        kind of evidence splits a transaction between <b>owners</b>:
        amounts alone admitted three readings, and the coins' features
        vote between them. The coming chapters push the idea further —
        reading a whole cluster's feature profile instead of a single
        coin's, and splitting a transaction into the several payments
        hiding inside it.</p>
        <p>The check is a heuristic like the others, and its failure
        mode is the mirror image of CIOH's: a user who migrated wallets
        spends their own coins from two script types in one transaction, and
        the check misreads that housekeeping as collaboration — the
        observer then <i>misses</i> a true link. One buys the mistake of
        linking strangers, the other of losing a user's own thread; the
        observer picks which error to spend.</p>`;
      },
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 1,
      nf: true,
      reveals: ["nsnf"],
      scene: 1,
      minDay: 35,
      select: selectIt,
    },
    {
      id: "no-privacy-from-the-counterparty",
      title: "No privacy from the counterparty",
      html: `<p>One party was never fooled for a moment. The payee
        contributed their coin, so they know <b>exactly</b> which inputs
        were the payer's — no heuristic needed, no doubt to spend. What a
        counterparty learns is a fixed point, and each payment adds
        another.</p>
        <p>Set that against everything the last steps made the outsider
        work for. An outsider <i>can suspect</i> a payjoin — any
        two-input spend could be one, and sometimes an input looks
        unnecessary, more coin than the payment needed (the literature's
        <i>unnecessary input heuristic</i>); the rest of the graph and
        the fingerprints can tilt the reading further. But where nothing
        tips it, every feature the record shows — amounts, inputs,
        outputs, structure — is consistent with both readings, and
        suspicion stays suspicion. The counterparty skips all of it:
        what the outsider must infer, they were handed at the
        table.</p>
        <p>You are looking through the payee's eyes now: their own coins,
        everything their payments taught them — <b>known</b> for direct
        evidence, <b>likely</b> where it seeds the public heuristics — and
        gray where they are as blind as any outsider.</p>`,
      focus: () => pad(payjoinFocus()),
      view: 0,
      lens: 2,
      scene: 1,
      minDay: 35,
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
        hidden payment still relates one payer to one amount — so the
        amounts themselves keep discriminating between readings. (The
        settlement chapter names the analysis that runs exactly that
        arithmetic.)</p>
        <p>The town doesn't run these forms — batched payouts need a
        batcher, and this neighborhood has none — but they mark the path.
        And they show what the defense would need to work at scale: the
        collaborative shape has to be the <b>norm, not the exception</b>,
        or each instance stands out as a fingerprint of its own.</p>`,
      focus: () => pad(bipBounds()),
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 35,
      select: () => null, // the chapter widens back out: exhibit released
    },
  ];
}
