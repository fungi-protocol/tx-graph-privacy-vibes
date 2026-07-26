// Chapter 8: synthesis — reading all the clues together. The spine is
// what the learner already watched: every map so far came from the
// public record alone, and combining those observations (Judy's rent,
// under form after form) is already powerful. The frontier beat then
// runs one Narayanan–Shmatikov-style propagation sweep against the
// town and lets it fail honestly: the town's splintered pseudonyms
// violate the method's one-node-per-person premise, and the sweep's
// one confident acceptance grades FALSE against latent truth. A
// hand-built miniature — labeled as built for the page, never found
// in the town — shows the same sweep succeeding when the premise
// holds, and consolidation (the change-welding the learner watched)
// is named as what closes the gap. Numbers are scores and
// eccentricities, shown as what they are, never probabilities.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Clustering, type Weld } from "../analysis/clusters";
import { support, removeOneMethod, type Method } from "../analysis/provenance";
import { propagationStep, type DGraph } from "../analysis/propagation";
import { type Grade } from "./synthesisStaging";
import { type EconomyEvent } from "../engine/economy";
import { agentKnowledge } from "../analysis/knowledge";
import { type TutorialStep, type Rect } from "../ui/tutorial";

/** the elimination beat's claim: two inputs of the careless coinjoin
 *  that really do share an owner (latent truth picks the PAIR — that
 *  is staging, so the narration "these are one person's coins" is
 *  true — but the support chain and the remove-one-method comparison
 *  are the observer's own, computed from the public record) */
export interface ClaimExhibit {
  a: CoinId;
  b: CoinId;
  /** the true owner of both coins (cast index) */
  owner: number;
  /** the observer's chain of inference for the claim */
  support: Weld[];
  /** method -> does the claim survive that method's removal? */
  rom: Map<Method, boolean>;
}

export function claimExhibit(
  chain: Chain,
  cl: Clustering,
  usdPrice: (day: number) => number | undefined,
  tid: TxId,
): ClaimExhibit | undefined {
  const tx = chain.txs.get(tid);
  if (!tx) return undefined;
  const byOwner = new Map<number, CoinId[]>();
  for (const c of tx.inputs) {
    const o = chain.coins.get(c)!.owner;
    if (o === null) continue;
    const l = byOwner.get(o);
    if (l) l.push(c); else byOwner.set(o, [c]);
  }
  for (const [owner, ids] of byOwner) {
    if (ids.length < 2) continue;
    const sup = support(cl, ids[0]!, ids[1]!);
    if (sup === null) continue;
    return { a: ids[0]!, b: ids[1]!, owner, support: sup, rom: removeOneMethod(chain, usdPrice, ids[0]!, ids[1]!) };
  }
  return undefined;
}

/** Judy's rent tally: form -> count, for the spine beat */
export function rentForms(events: EconomyEvent[]): Map<string, number> {
  const forms = new Map<string, number>();
  for (const e of events) {
    if (e.payer !== 9 || e.memo !== "studio rent") continue;
    forms.set(e.form, (forms.get(e.form) ?? 0) + 1);
  }
  return forms;
}

/** the counterparty tier card's live numbers: what the watcher can
 *  attribute DIRECTLY (payments they took part in; own coins excluded)
 *  and, of the target's coins, how many they hold in the map — the
 *  writeup's "map of their remaining coins": direct attributions of the
 *  target's still-unspent coins. Fixed points that compound and never
 *  decay. */
export function counterpartyExhibit(
  chain: Chain,
  events: EconomyEvent[],
  watcher: number,
  target: number,
): { directOthers: number; ofTarget: number; targetRemaining: number } {
  const k = agentKnowledge(chain, events, watcher);
  let directOthers = 0, ofTarget = 0, targetRemaining = 0;
  for (const [id, a] of k.coins) {
    if (!a.direct || a.owner === watcher) continue;
    directOthers++;
    if (a.owner !== target) continue;
    ofTarget++;
    if (chain.coins.get(id)!.dest === null) targetRemaining++;
  }
  return { directOthers, ofTarget, targetRemaining };
}

/** the hand-built miniature for the premise beat: two seeded
 *  pseudonyms both pay a third, and in the outside graph both their
 *  images pay x — one node per participant, exactly the paper's 1-1
 *  premise. Built for the page; nothing like it was FOUND in the
 *  town. The same propagationStep the town sweep uses accepts cX -> x
 *  correctly here. */
export function premiseDemo(): {
  accepted: Map<string, string>;
  eccentricity: number;
  score: number;
} {
  const g = (edges: [string, string][], extra: string[] = []): DGraph => {
    const d: DGraph = { nodes: [], out: new Map(), in: new Map() };
    const ensure = (n: string): void => {
      if (!d.out.has(n)) { d.out.set(n, new Set()); d.in.set(n, new Set()); d.nodes.push(n); }
    };
    for (const [a, b] of edges) { ensure(a); ensure(b); d.out.get(a)!.add(b); d.in.get(b)!.add(a); }
    for (const n of extra) ensure(n);
    return d;
  };
  const target = g([["cA", "cX"], ["cB", "cX"]], ["cW"]);
  const aux = g([["a", "x"], ["b", "x"], ["a", "y"]]);
  const res = propagationStep(target, aux, new Map([["cA", "a"], ["cB", "b"]]));
  const v = res.verdicts.find((x) => x.node === "cX");
  return {
    accepted: res.accepted,
    eccentricity: v?.eccentricity ?? NaN,
    score: v?.ranked[0]?.score ?? NaN,
  };
}

/** the narrated sweep, with display names resolved by the caller */
export interface SweepView {
  seedCount: number;
  examined: number;
  noSignal: number;
  belowThreshold: number;
  reverseMismatch: number;
  acceptedCount: number;
  /** pseudonym count on the board, and the aux graph's agent count */
  pseudonyms: number;
  agents: number;
  /** aux edges the outsider knows / the town's full edge count */
  knownEdges: number;
  allEdges: number;
  featured?: {
    /** learner-facing cluster label, e.g. "cluster 5" */
    cluster: string;
    /** the agent the sweep accepted */
    agent: string;
    eccentricity: number;
    grade: Grade;
    /** the cluster's true owner's name, when the cluster is pure */
    trueOwner: string | null;
  };
}

export function synthesisSteps(
  bipBounds: () => Rect,
  clusterBounds: () => Rect,
  naiveRect: () => Rect,
  claim: () => ClaimExhibit | undefined,
  naiveTid: () => string | undefined,
  rents: () => Map<string, number>,
  sweep: () => SweepView | undefined,
  counterparty: () => { directOthers: number; ofTarget: number; targetRemaining: number } | undefined,
  names: (i: number) => string,
): TutorialStep[] {
  const pad = (b: Rect): Rect => ({ x: b.x - 80, y: b.y - 80, w: b.w + 160, h: b.h + 160 });
  const selNaive = (): { kind: "tx"; id: string } | null => {
    const tid = naiveTid();
    return tid ? { kind: "tx", id: tid } : null;
  };
  const FORM_LEAK: Record<string, string> = {
    unilateral: "a plain payment showed payer, payee and amount to everyone",
    payjoin: "a payjoin falsified common-input-ownership — though Heidi, on the inside, always knew",
    settlement: "a settlement folded the amount in with others, leaving outsiders no single figure to read",
    coinjoin: "a coinjoin gave the coins ambiguous pasts",
  };
  return [
    {
      id: "no-names-were-needed",
      title: "No names were needed",
      html: `<p>Step back and take stock. Every map in this story — the
        clusters, the welds, the shrinking candidate sets — was computed
        from the <b>public record alone</b>. No accounts, no subpoenas,
        no names: this is the <b>weakest access tier</b>, and it got this
        far. And the record is permanent — anything the observer missed
        today, it can re-read tomorrow with better ideas.</p>
        <p>This chapter puts the pieces together: first what combining
        the clues already bought, then one method from the research
        literature for pushing further — shown honestly, where it works
        and where it fails.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "judys-rent-many-ways",
      title: "Judy's rent, many ways",
      html: () => {
        const forms = rents();
        const total = [...forms.values()].reduce((a, b) => a + b, 0);
        const tally = [...forms.entries()]
          .map(([f, n]) => `${n} ${f === "unilateral" ? "plain payment" : f}${n === 1 ? "" : "s"}`)
          .join(", ");
        const leaks = [...forms.keys()]
          .map((f) => FORM_LEAK[f])
          .filter((s): s is string => s !== undefined)
          .map((s) => `<li>${s}.</li>`)
          .join("");
        return `<p>Take one obligation and read its whole trail. Judy pays
        Heidi <b>$850 studio rent</b>, month after month — ${total} times
        so far this run: ${tally}.</p>
        <ul>${leaks}</ul>
        <p>Each form leaks less than the last, yet the <b>pattern</b> is
        a clue of its own: the same two parties, the same cadence, an
        amount that survives in some months and vanishes in others.
        Reading the observations <i>together</i> — that is synthesis, and
        it is already powerful before any new machinery arrives.</p>`;
      },
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "what-a-claim-rests-on",
      title: "What a claim rests on",
      html: () => {
        const c = claim();
        const line = c
          ? `<p>Take one claim off the observer's map: two of
        <b>${names(c.owner)}</b>'s inputs to the careless coinjoin sit in
        one cluster. What does that rest on? ${c.support.length === 1
          ? "One recorded observation"
          : `A chain of ${c.support.length} recorded observations`}: the
        <b>sub-transaction analysis</b> found a unique balancing
        partition of this transaction, and welded each part
        together.</p>`
          : `<p>Every cluster on the observer's map is a <b>claim</b> —
        "these coins share an owner" — and every claim rests on recorded
        observations: a method, applied to a transaction.</p>`;
        return `${line}
        <p>Two things must be kept apart. What that verdict
        <b>proves</b> is value flow — which inputs funded which outputs.
        Reading each part as <b>one owner</b> is an assumption the
        observer adds on top, and the map records it as an assumption on
        the weld instead of laundering it into fact. A claim you can
        take apart this way can also be tested — next.</p>`;
      },
      focus: naiveRect,
      select: selNaive,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "take-this-clue-away",
      title: "Take this clue away",
      html: () => {
        const c = claim();
        const survives = c?.rom.get("subtx");
        const line = survives === undefined
          ? `<p>The observer can test any claim by <b>taking a clue
        away</b>: rerun the whole analysis with one method disabled and
        ask whether the coins still share a cluster.</p>`
          : survives
            ? `<p>Now test it: rerun the whole analysis with the
        sub-transaction analysis <b>switched off</b> — the view here
        shows that rerun. The claim <b>survives</b>: with the matching
        game gone, plain common-input-ownership reads the very same
        transaction and welds the same coins.</p>`
            : `<p>Now test it: rerun the whole analysis with the
        sub-transaction analysis <b>switched off</b> — the view here
        shows that rerun. This time the claim <b>dies</b>: no other
        method reads this transaction, so the weld rested on that one
        clue.</p>`;
        return `${line}
        <p>Read a survival precisely: it means blocking that method
        <b>wouldn't have helped</b> — one observation, read two ways. It
        does <i>not</i> mean a second, independent observation
        corroborates the claim. This process of elimination — remove a
        clue, see what stands — is how the observer tells load-bearing
        evidence from a redundant reading of the same fact.</p>`;
      },
      focus: naiveRect,
      select: selNaive,
      view: 1,
      lens: 1,
      overlays: 11, // the rerun keeps every other linkage, reuse included
      scene: 1,
      minDay: 115,
    },
    {
      id: "two-maps-and-a-few-names",
      title: "Two maps and a few names",
      html: () => {
        const s = sweep();
        const counts = s
          ? `${s.pseudonyms} pseudonyms this run` : "dozens of pseudonyms";
        const aux = s
          ? `${s.knownEdges} of the town's ${s.allEdges} arrangements`
          : "the big arrangements";
        const seeds = s ? `${s.seedCount} seeds` : "a few seeds";
        return `<p>To push further, the literature offers a construction
        (Narayanan&nbsp;&amp;&nbsp;Shmatikov, 2009): treat
        re-identification as <b>matching two graphs</b>. On one side, the
        observer's map compressed — every cluster a pseudonym, an edge
        wherever a payment ran between two of them: ${counts}. On the
        other, what an outsider hears about the town: who rents from
        whom, who invoices whom. Big arrangements travel by word of
        mouth, small favors don't — the outsider knows ${aux}. The method
        is built to tolerate that mismatch: the paper's two graphs came
        from different networks entirely.</p>
        <p>Add a few identities learned out of band — ${seeds}, pinned to
        pseudonyms — and ask: can the seeds <b>propagate</b>?</p>`;
      },
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      overlays: 7, // the remove-one-clue rerun is over; full analysis resumes
      scene: 1,
      minDay: 115,
    },
    {
      id: "one-sweep",
      title: "One sweep",
      html: () => {
        const s = sweep();
        if (!s) {
          return `<p>One sweep examines <b>every unmapped pseudonym</b>
        against the whole board: candidates are scored by their mapped
        neighbors, and a mapping is accepted only when the best
        candidate stands out sharply <i>and</i> the reverse match
        agrees. Abstention is a first-class outcome.</p>`;
        }
        const f = s.featured;
        const featured = !f
          ? `<p>This sweep accepted nothing — a stall is a real outcome,
        and at this scale the honest one.</p>`
          : f.grade === "false"
            ? `<p>Look hard at that acceptance: <b>${f.cluster} →
        ${f.agent}</b>, eccentricity ${f.eccentricity.toFixed(2)}. It
        cleared every gate — best score, sharp standout, reverse match
        agreed. It is <b>wrong</b>. ${f.cluster}'s coins all belong to
        <b>${f.trueOwner ?? "someone else"}</b>, not ${f.agent}.</p>`
            : f.grade === "undefined"
              ? `<p>Look hard at that acceptance: <b>${f.cluster} →
        ${f.agent}</b>, eccentricity ${f.eccentricity.toFixed(2)}. It
        cleared every gate — and it answered a question with no right
        answer: ${f.cluster} mixes several people's coins, so no single
        name could be correct.</p>`
              : `<p>One acceptance: <b>${f.cluster} → ${f.agent}</b>,
        eccentricity ${f.eccentricity.toFixed(2)} — and this one happens
        to be right.</p>`;
        return `<p>One sweep examines <b>every unmapped pseudonym</b>
        against the whole board: candidates scored by mapped neighbors,
        accepted only when the best one stands out (eccentricity ≥ 1.5 —
        our threshold; the paper explores several) <i>and</i> the
        reverse match agrees. This run: ${s.examined} pseudonyms
        examined, ${s.noSignal} with no signal, ${s.belowThreshold}
        below threshold, ${s.reverseMismatch} vetoed by the reverse
        match, <b>${s.acceptedCount} accepted</b>.</p>
        ${featured}
        <p>The numbers are scores, not probabilities — a standout can
        stand out and still be false. And the failure is structural:
        the method's premise is <b>one node per person</b> on each side,
        while this town's map splinters each person into several
        pseudonyms, so a seed's neighbors vouch for wrong candidates as
        readily as right ones.</p>`;
      },
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "when-the-premise-holds",
      title: "When the premise holds",
      html: () => {
        const d = premiseDemo();
        const hit = [...d.accepted].map(([n, a]) => `${n} → ${a}`).join(", ") || "nothing";
        return `<p>Is the method broken, then? No — it was starved of its
        premise. Here is a <b>hand-built miniature</b>, built for this
        page and found nowhere in the town: two seeded pseudonyms both
        pay a third; in the outside graph, both their images pay
        <b>x</b>. One node per participant — exactly the paper's
        setting. The same sweep, run on it, accepts <b>${hit}</b>
        (eccentricity ${d.eccentricity.toFixed(2)}) — and this time it
        is correct: corroborating neighbors point one way.</p>
        <p>What closes the gap between the town and the miniature is
        <b>consolidation</b>. Every time a wallet spends coins together,
        every time a change guess lands, pseudonyms fuse — the
        change-welding you watched earlier is exactly this fusing — and
        over months of ordinary housekeeping the splinters drift toward
        one pseudonym per person. The town's privacy tools <b>slow that
        drift</b>; they don't reverse it. So the failed sweep you just
        saw is a <b>floor, not a ceiling</b> — it holds even against
        defenders actively slowing consolidation — and the premise
        creeps closer to true.</p>`;
      },
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "feed-it-names",
      title: "Feed it names",
      html: `<p>The sweep you watched was seeded with a few identities.
        The <b>auxiliary information</b> dial on the heuristics panel
        lets you deal the observer a bigger hand and rerun the whole
        machine yourself: every revealed coin names its cluster, clusters
        named alike fuse into one vertex — the map you see now carries a
        modest grant — and the propagation heuristics run <b>on the fused
        map</b>, so every name is a seed.</p>
        <p>Try it: check <i>social-network analysis</i>, then drag
        <i>revealed</i> and watch the match counter. Narayanan and
        Shmatikov observed a <b>phase transition</b> in exactly this
        machine: below a critical seed density the propagation stalls —
        matches trickle and die out — while past it each match creates
        the neighbors that justify the next, and the sweep <b>cascades</b>
        across the board. The frightening property is on the steep side
        of that boundary: there, a marginal name is worth far more than
        one name's information, because the graph pays the rest.</p>`,
      focus: () => pad(clusterBounds()),
      select: () => null,
      view: 2,
      lens: 1,
      grants: [0, 12],
      reveals: ["nssoc"], // "Try it: check social-network analysis"
      scene: 1,
      minDay: 115,
    },
    {
      id: "the-public-analyst",
      title: "Card one: the public analyst",
      grants: [0, 0], // the cards argue from capability, not a dealt hand
      html: `<p>Now name who actually holds each level of power — three
        cards, weakest first. The first is the observer you have watched
        all along: the <b>full chain</b>, commodity computation, every
        modeled on-chain feature, and a <b>memory that never forgets</b>.
        Anyone can hold this card — it takes a laptop and patience, no
        account and no permission.</p>
        <p>Everything this chapter computed so far was this card's work.
        The next two cards don't replace it; they <b>start from it</b>
        and add what their position hands them.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "the-counterparty",
      title: "Card two: the counterparty",
      html: () => {
        const c = counterparty();
        const numbers = c
          ? `${names(7)} can attribute <b>${c.directOthers} coins</b> of
        other people's directly this run — ${c.ofTarget} of them
        ${names(9)}'s, of which <b>${c.targetRemaining} are still sitting
        unspent</b> in ${names(9)}'s wallet right now.`
          : `every payment adds to the map.`;
        return `<p>The second card is the view here: <b>${names(7)}</b>,
        ${names(9)}'s landlord. A counterparty starts with everything the
        public analyst has and adds what the relationship hands over. In
        every payment the payee learns the payer's <b>inputs</b> and the
        <b>change</b> they took back — a map of the payer's remaining
        coins — and the map <b>compounds</b>: these are fixed points that
        never decay. ${numbers} A counterparty also knows a name, a face,
        a business — which makes tier two a <b>seed factory</b> for the
        card after this one.</p>
        <p>Inside multiparty transactions, what an insider sees depends on
        the <b>protocol used to construct the transaction</b>. This
        town's settlements and coinjoins are both arranged blind —
        anonymous broadcast, each input and each output submitted
        independently, a disclosed protocol choice — so elimination
        leaves the rest ambiguous and an insider is nearly as blind as
        an outsider.</p>`;
      },
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 2,
      agent: () => 7,
      scene: 1,
      minDay: 115,
    },
    {
      id: "the-aggregator",
      title: "Card three: the aggregator",
      html: `<p>The third card has no new lens to show, and that is the
        point. An <b>institutional aggregator</b> is the public analyst
        plus what flows in: <b>many identified seeds</b> and the records
        of the services that share with it — subscribers, partners,
        acquisitions, breaches. No aggregator holds everything, and who
        shares with whom is unobservable from here: <b>you cannot audit
        the adversary's feeds</b>, which is itself a lesson. Some feeds
        cost nothing to build — a lightweight wallet that asks a server
        about its addresses hands the operator its own cluster,
        ready-made, collection without analysis — and web trackers on
        checkout pages have been shown to link payments to identities
        (Goldfeder&nbsp;et&nbsp;al.).</p>
        <p>What sets this card apart is not a new technique — it is the
        <b>seed count</b>. The sweep you watched ran on a handful of
        seeds and stalled; the propagation paper's own experiments make
        the number of seeds the variable that separates stalling from
        cascading. Tier three holds exactly that variable — the
        <b>auxiliary information</b> dial you just turned is this card
        in miniature: the KYC box is one exchange's feed, the slider is
        the sum of all of them.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
    {
      id: "a-lower-bound",
      title: "A lower bound",
      html: `<p>Every analysis this chapter ran used the public record
        plus rumor-grade knowledge of the town's arrangements — the
        weakest of the three cards, and no names needed up front. Real
        analysts hold more: this town's wallet <b>fingerprints</b> stop at
        a few products' worth of tells, and network metadata, timing
        correlation and purchased records it does not model at all. Read
        every result here as a <b>lower bound</b> on exposure.</p>
        <p>And the propagation you watched is <b>one</b> inspectable,
        source-grounded method for the sparse regime — not the ceiling
        of what a capable adversary can synthesize. The town is yours
        next: one more chapter, and you play it.</p>`,
      focus: () => pad(bipBounds()),
      select: () => null,
      view: 1,
      lens: 1,
      scene: 1,
      minDay: 115,
    },
  ];
}
