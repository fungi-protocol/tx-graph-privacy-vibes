// App shell: two scenes — the intro story and the unilateral economy —
// drawn in either the block-explorer or bipartite view, with pan/zoom,
// hover, click-to-trace ancestry, a guided tour, day stepping, a cast
// panel, and the right-click "copy reference" reviewing aid.
import { encodeFragment, decodeFragment, parseRefSel, type FragmentState } from "./ui/fragment";
import { type Camera, worldToScreen, screenToWorld, zoomAt } from "./ui/camera";
import { buildIntroChain } from "./scenario/intro";
import { introSteps } from "./scenario/introSteps";
import { economySteps } from "./scenario/economySteps";
import { PERSONAS, CARELESS, MAX_POP, ownerColor, walletOf, WALLETS, type Persona } from "./scenario/cast";
import { Economy, GAME_DAY, DEFAULT_PARAMS, type EconomyParams, type LiveParams, type ParamPatch, type Intervention, type ManualPlan } from "./engine/economy";
import { ancestry } from "./analysis/ancestry";
import { traceCoins, traceTx, type Trace } from "./analysis/trace";
import { counterfactualOrigins } from "./analysis/paths";
import { clusterObserver, clusterByOwner, clusterByKnowledge, clusterSingletons, gradeLinks, type ChangeRead, type Clustering, type Mistake } from "./analysis/clusters";
import { clusterColor, clusterLabel, CLUSTER_MISC, TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL, OV_CIOH, OV_CHANGE, OV_SUBSUM, OV_REUSE, OV_REMEET, OV_ALL, CIOH_MAX_OFF, CHANGE_EV_MAX } from "./analysis/observer";
import { gradeMap, type MapGrade } from "./analysis/grading";
import { agentKnowledge, type Knowledge, type Attribution } from "./analysis/knowledge";
import { nsSocialRun, nsApply, matchState, clusterAdjacency, nsSimilarity, activePairs, partitionColumns, type NsEvent } from "./analysis/nssocial";
import { nfRun as runNetflix, nfStats, type NfEvent, type NfStats } from "./analysis/nsnetflix";
import { layoutClusterGraph, layoutClusterBand, layoutClusterForceMap, layoutClusterColumns, fitClusterLayout, drawContraction, hitTestClusters, truthSlices, transitionFragments, strandGeometry, type ClusterLayout, type ClusterPaint, type ClusterTransition } from "./ui/clusterview";
import { canonical, contracted, knobs, withView, withLayout, withGrouping, fragmentView, viewFromFragment, viewFromStep, type ViewState } from "./ui/viewstate";
import { observerSteps } from "./scenario/observerSteps";
import { payjoinSteps, selectPayjoinExhibit, payjoinDetection, detectionFires, inputFamilies, type PayjoinDetection } from "./scenario/payjoinSteps";
import { settlementSteps, selectSettlementExhibit, settlementVerdict } from "./scenario/settlementSteps";
import { nsSocialSteps } from "./scenario/nssocialSteps";
import { nsNetflixSteps } from "./scenario/nsnetflixSteps";
import { coinjoinSteps, selectDenseCoinjoin, remeetExhibit, type RemeetExhibit } from "./scenario/coinjoinSteps";
import { intersectionSteps, freshOrigin, type Focused, type AuxGrant } from "./scenario/intersectionSteps";
import { auxInfoDecay, observerGrants, grantAttribution, grantMerges, clusterGrantOwners, type AuxDecay } from "./analysis/auxinfo";
import { observerOpts, type AnalysisKnobs, type AnalysisBundle } from "./analysis/pipeline";
// import type: guaranteed fully erased — the worker module's top-level
// message listener must never execute on the page's side
import type { AnalysisJob, AnalysisReply } from "./worker/analysis-worker";
import { synthesisSteps, claimExhibit, rentForms, counterpartyExhibit, type ClaimExhibit, type SweepView } from "./scenario/synthesisSteps";
import { synthesisSweepExhibit, clusterOwner, outsiderEdges } from "./scenario/synthesisStaging";
import { gameSteps } from "./scenario/gameSteps";
import { setCastNames, OMNISCIENT } from "./scenario/omniscient";
import { layoutChain, type Layout, type Hit, type Rect } from "./ui/blockview";
import { layoutBipartite, type BipLayout } from "./ui/bipartite";
import { layoutForce } from "./ui/force";
import { drawMorph, hitTestMorph, coinRectAt, txRectAt } from "./ui/morph";
import { blendLayout, blendBip } from "./ui/blend";
import { commonInputFill, type Paint } from "./ui/paint";
import { Tutorial, widgetRevealsAt, type TutorialWidget } from "./ui/tutorial";
import { Animator, easeOutQuad } from "./ui/anim";
import { fmtSats } from "./core/sats";
import { type Chain, addrKey, addrText } from "./model/chain";
import { createAnalysisController, memoLRU } from "./ui/analysisController";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

// --- scenes ---
interface SceneData { chain: Chain; layout: Layout; bip: BipLayout }
const introChain = buildIntroChain();
const intro: SceneData = { chain: introChain, layout: layoutChain(introChain), bip: layoutBipartite(introChain) };

// The replay inputs: everything the world is rebuilt from, in one place.
// URL sync reads it, fragment restore and the params panel write it, and
// rebuildEconomy replays from it — no parallel globals to fall out of
// step. The #17 parameter timeline (dated patches) lands as one more
// field here, not as another loose variable.
const session: {
  seed: string;
  params: Partial<EconomyParams>;
  /** dated parameter changes, in effect from their day forward (#17): the
   *  engine reads the params per day, so the past replays untouched */
  timeline: ParamPatch[];
  manual: number | null;
  manualFrom: number;
  interventions: Intervention[];
} = {
  seed: "welcome",
  params: {},
  timeline: [],
  manual: null,
  manualFrom: 0,
  interventions: [],
};
/** graph-view arrangement (#44): false = layered timeline, true = force-directed */
let forceLayout = false;
/** force layout restricted to the hide filter's survivors ("r", #61);
 *  null = the full graph */
let forceShown: Set<string> | null = null;
function bipFor(chain: Chain): BipLayout {
  return forceLayout ? layoutForce(chain, forceShown ?? undefined) : layoutBipartite(chain);
}
let eco: Economy | null = null;
const castList = (): Persona[] => eco ? eco.cast : PERSONAS;
let ecoScene: SceneData | null = null;
let scene: 0 | 1 = 0;

// One revision for everything derived from the world: bumped whenever the
// simulated chain, the active scene, or the observer's heuristics change.
// Derived caches key on this single number — never on scattered
// (order.length, scene, …) tuples, which can miss a rebuild that lands on
// the same day or a heuristic toggle a cache forgot to include.
let simRev = 0;

function economy(): Economy {
  if (!eco) {
    eco = new Economy(session.seed, session.params);
    eco.manual = session.manual;
    eco.manualFrom = session.manualFrom;
    eco.interventions = session.interventions;
    eco.timeline = session.timeline; // shared: dated changes land in both
    simRev += 1;
    setCastNames(eco.cast.map((p) => p.name)); // captions track the live town
    refreshEcoLayouts();
  }
  return eco;
}
/** rebuild the world from scratch and replay it to the given day — the
 *  seed, params, and recorded choices fully determine the result */
function rebuildEconomy(toDay: number): void {
  eco = null; // economy() rebuilds and bumps simRev; caches expire with it
  rideGen += 1;
  viewDay = null; // a fresh world starts at its frontier
  economy().runTo(toDay);
  simRev += 1;
  refreshEcoLayouts();
  renderCast(); // population (and with it the cast panel) may have changed
  recomputeTrace();
  renderDecisions();
  syncTimebar();
  draw();
  void syncFragment();
}
function refreshEcoLayouts(): void {
  ecoScene = { chain: eco!.chain, layout: layoutChain(eco!.chain), bip: bipFor(eco!.chain) };
}
// --- the time cursor (#17): rewinding is a display filter, not a rebuild.
// The layout stays the full history's; transactions after the cursor are
// hidden, and a coin whose spend lies in the future draws as unspent.
// Stepping forward re-reveals recorded days; past the frontier it extends
// the simulation. null = riding the frontier.
let viewDay: number | null = null;
// the freeze-frame cursor: when non-null, only the first that many of the
// cursor day's own transactions are revealed (the tape controller's
// transaction-by-transaction stepping); null = the whole day
let viewTx: number | null = null;
function cursorDay(): number {
  return viewDay ?? eco?.day ?? 0;
}
function rewound(): boolean {
  return scene === 1 && eco !== null &&
    (viewTx !== null || (viewDay !== null && viewDay < eco.day));
}
/** how many transactions the record holds for one day */
function dayTxCount(d: number): number {
  if (!ecoScene) return 0;
  let n = 0;
  for (const tid of ecoScene.chain.order) {
    if (ecoScene.chain.txs.get(tid)!.timestep === d) n++;
  }
  return n;
}
// tutorial time-lapse (#24): rather than teleporting into a precomputed
// record, a chapter jump replays the recorded days through the cursor —
// the reader watches time pass. Bumping the generation cancels a ride.
let rideGen = 0;
function rideDays(from: number, to: number): void {
  const gen = ++rideGen;
  viewDay = from;
  simRev += 1;
  const span = to - from;
  const ms = Math.min(3000, 250 + 150 * span);
  let shown = from;
  const showDay = (d: number): void => {
    shown = d;
    viewDay = eco && d >= eco.day ? null : d;
    viewTx = null;
    simRev += 1;
    recomputeTrace();
    syncTimebar();
  };
  anim.add(ms, (t) => {
    if (gen !== rideGen) return;
    const d = Math.min(to, from + Math.floor(span * t + 1e-9));
    if (d !== shown) showDay(d);
  }, { done: () => {
    if (gen !== rideGen) return;
    if (shown < to) showDay(to);
    void syncFragment();
  } });
  kick();
}
let visCache: { src: SceneData; day: number; tx: number | null; s: SceneData } | null = null;
function active(): SceneData {
  if (scene !== 1 || !ecoScene) return intro;
  if (!rewound()) return ecoScene;
  const day = cursorDay();
  // keyed by the source scene and the cursor, NOT simRev: truncation
  // only depends on those (days recorded later than the cursor never
  // enter it), and a knob toggle must not mint a fresh chain object —
  // the analysis memos key on the visible chain's identity (#85)
  if (!visCache || visCache.src !== ecoScene || visCache.day !== day || visCache.tx !== viewTx) {
    visCache = {
      src: ecoScene,
      day,
      tx: viewTx,
      s: { chain: ecoScene.chain.through(day, viewTx ?? Infinity), layout: ecoScene.layout, bip: ecoScene.bip },
    };
  }
  return visCache.s;
}
/** move the cursor; everything derived from the visible world follows */
function setViewDay(d: number | null, tx: number | null = null): void {
  rideGen += 1; // a hand on the dial cancels any tutorial time-lapse
  viewDay = d !== null && eco && d >= eco.day ? null : d;
  // a freeze-frame at (or past) the day's full count is just the whole day
  viewTx = tx !== null && tx >= dayTxCount(cursorDay()) ? null : tx;
  simRev += 1; // the visible chain changed, even though the record didn't
  recomputeTrace(); // a selection may have slipped beyond the cursor
  reflectGradeStats(); // the map grade follows the visible chain
  renderCast(); // the town roster follows the displayed day
  syncTimebar();
  draw();
  void syncFragment();
}

// --- lenses: 0 = all-seeing, 1 = third-party observer, 2 = one agent's view ---
let lens: 0 | 1 | 2 = 0;
let lensAgent: number | null = null;
// the analysis controller (#122a): the observer-map knobs, the grant,
// both cluster matchers with their replay cursors, the #85 memo layer
// and the #84 worker gateway — all behind this one object. The host
// closure below is the only path from analysis back into the app
// shell, read lazily so the shell's mutable state stays where it is.
const A = createAnalysisController({
  chain: () => active().chain,
  priceAt: () => (scene === 1 && eco ? (d: number): number | undefined => eco!.prices[d] : undefined),
  liveEconomy: () => scene === 1 && !!eco,
  seed: () => session.seed,
  jobSession: () => ({
    seed: session.seed, params: session.params, timeline: session.timeline,
    manual: session.manual, manualFrom: session.manualFrom,
    interventions: session.interventions,
  }),
  day: () => eco!.day,
  cursorDay: () => cursorDay(),
  viewTx: () => viewTx,
  observerLens: () => lens === 1,
  unclustered: () => unclustered,
  bumpSimRev: () => { simRev += 1; },
  busy: document.getElementById("busy") as HTMLElement,
});


// The contracted graph is not one fixed flattening: the partition — and
// with it the layout — follows the active lens. All-seeing contracts to
// the true user graph (every vertex a named wallet); the observer to its
// heuristic pseudonym graph, honoring the toggles (all off = singletons,
// the bare structure); an agent's lens to what that one ledger can
// attribute, suspicions kept apart from facts.
// "unclustered": the bottom of the partition refinement lattice — every
// coin its own vertex, the coin graph laid on the ring by time. A view
// of the raw material every lens's partition is built from.
let unclustered = false;
// whether the contracted map takes the chord ring; false = the same
// scene uncurled — the band (layered) or the free force map, picked by
// the layout flag (#115)
let chordArr = true;
interface CollapseState { cl: Clustering; clay: ClusterLayout; ring: ClusterLayout }
const collapseMemo = memoLRU<CollapseState>(16);
/** the entry the contracted view last computed — what a repartition
 *  tween animates from */
let lastCollapse: CollapseState | null = null;
function collapseState(): CollapseState {
  const agent = lens === 2 ? (lensAgent ?? 0) : -1;
  // the fit rect is part of the key: the same partition re-formed in a
  // different viewport is a different arrangement, and toggling a knob
  // back with the camera unmoved lands on the arrangement already laid
  const fit = clusterFit ? `${clusterFit.x},${clusterFit.y},${clusterFit.w},${clusterFit.h}` : "·";
  const key = `${A.mapSig()}§${A.matchSig()}§${lens}|${agent}|${unclustered ? 1 : 0}|${forceLayout ? 1 : 0}|${chordArr ? 1 : 0}|${fit}`;
  lastCollapse = collapseMemo.get(key, () => {
    const base = unclustered ? clusterSingletons(active().chain)
      : lens === 0 ? clusterByOwner(active().chain)
      : lens === 2 ? clusterByKnowledge(active().chain, knowledge().coins)
      : A.observerBase();
    // the observer's partition is the ONE model the trace also consumes
    // (#124); the other lenses fuse any active matches onto their own
    // base the same way
    const cl = !unclustered && lens === 1 ? A.observerModel() : A.fuseMatches(base);
    // the layout button generalizes to the ring: layered orders it by
    // time, force reorders it to minimize edge crossings. Under the
    // ns-social partition the circle opens into columns — one vertical
    // segment per epoch, matched vertices spanning the lanes they fused
    const mode = forceLayout ? "force" as const : "time" as const;
    // three arrangements of the same contracted scene (#115): the ns
    // columns override everything, the chord bends the timeline around
    // the ring (the layout button picks its ordering), and uncurled the
    // layout button picks the band (layered) or the free force map
    const clay0 = A.nsActive()
      ? layoutClusterColumns(cl, active().chain, A.nsLanes(base, cl), A.nsParts, mode)
      : chordArr ? layoutClusterGraph(cl, active().chain, mode)
      : forceLayout ? layoutClusterForceMap(cl, active().chain)
      : layoutClusterBand(cl, active().chain);
    // the circle forms where the camera was looking when the collapse
    // began — the coins travel, the viewport doesn't
    const clay = clusterFit ? fitClusterLayout(clay0, clusterFit) : clay0;
    // the singleton ring is the collapse morph's waypoint: coins land on
    // it before stacking into discs, and unstack onto it on the way out
    // the waypoint takes the matching family: the singleton ring under
    // the chord, the singleton band when the map is uncurled
    const ring0 = unclustered ? clay
      : chordArr ? layoutClusterGraph(clusterSingletons(active().chain), active().chain, mode)
      : layoutClusterBand(clusterSingletons(active().chain), active().chain);
    const ring = unclustered || !clusterFit ? ring0 : fitClusterLayout(ring0, clusterFit);
    return { cl, clay, ring };
  });
  return lastCollapse;
}
function lensClustering(): Clustering {
  return collapseState().cl;
}
function clusterLayout(): ClusterLayout {
  return collapseState().clay;
}
function singletonRing(): ClusterLayout {
  return collapseState().ring;
}
// In the contracted view the TOPOLOGY carries the lens's information
// (its partition shapes the vertices). Paint follows the lens's own
// bookkeeping — the observer's discs wear the observer's palette and
// grant attributions, exactly like its coin-graph view, because the
// observer cannot see its own mislabelings. Only when the learner asks
// to be shown mistakes does paint switch to the town's ground truth:
// each vertex then wears the true owners of its member coins, and a
// vertex the lens wrongly merged renders as a multi-color disc —
// cluster collapse made visible. That is the grading direction of the
// latent-truth rule (truth judging the partition, drawn for the
// learner), behind the same gate as every other truth-graded display.
// The omniscient and agent lenses keep truth paint always — their
// partitions ARE their knowledge, so nothing is leaked.
function lensClusterPaint(): ClusterPaint {
  const chain = active().chain;
  const cl = lensClustering();
  const truthColor = (id: string): string => {
    const o = chain.coins.get(id)!.owner;
    return o === null ? "#e8e5da" : ownerColor(o);
  };
  // the observer's own reading of a coin, mirroring observerPaint's
  // coinFill: a granted coin is disclosed (or propagated) attribution,
  // anything else wears the observer's cluster palette — gray where its
  // map says nothing
  const attr = lens === 1 && A.grantsOn() ? A.grantState().attr : null;
  const obsColor = (id: string): string => {
    const a = attr?.get(id);
    return a ? (a.owner === null ? "#e8e5da" : ownerColor(a.owner)) : clusterColor(cl, id);
  };
  const paintColor = lens === 1 && !A.showMistakes ? obsColor : truthColor;
  const base = {
    color: paintColor,
    slices: (rep: string) => truthSlices(cl, rep, paintColor),
  };
  if (unclustered) {
    // the lattice bottom carries no partition information to caption:
    // just the coins on the ring, wearing their true colors
    return { ...base, label: () => "", center: () => "" };
  }
  if (lens === 0) {
    const ownerOf = (id: string): number | null => chain.coins.get(id)!.owner;
    return {
      ...base,
      label: (rep) => { const o = ownerOf(rep); return o === null ? "outside town" : castList()[o]!.name; },
      center: (rep) => { const o = ownerOf(rep); return o === null ? "~" : castList()[o]!.name[0]!; },
    };
  }
  if (lens === 2) {
    const k = knowledge();
    const u = lensAgent ?? 0;
    const nameOf = (o: number | null): string => (o === null ? "a merchant" : castList()[o]!.name);
    return {
      ...base,
      label: (rep) => {
        const a = k.coins.get(rep);
        if (!a) return "";
        if (a.owner === u) return "own coins";
        return a.direct ? `${nameOf(a.owner)} · known` : `${nameOf(a.owner)} · likely`;
      },
      center: (rep) => {
        const a = k.coins.get(rep);
        return !a ? "" : a.owner === null ? "~" : castList()[a.owner]!.name[0]!;
      },
    };
  }
  // the observer's contracted map: granted names caption the vertices
  // they attribute. Only unanimous grants name a vertex — a cluster
  // whose grants conflict exposes one of its links as a lie and earns
  // no name, however many of its coins are individually disclosed.
  const gs = A.grantsOn() ? A.grantState() : null;
  return {
    ...base,
    label: (rep) => {
      if (gs?.owners.has(rep)) {
        const o = gs.owners.get(rep)!;
        // "disclosed" only when every member coin was granted outright;
        // any propagation over the map's own links keeps it "likely"
        const all = (cl.members.get(rep) ?? [rep]).every((id) => gs.attr.get(id)?.direct);
        return `${o === null ? "outside town" : castList()[o]!.name} · ${all ? "disclosed" : "likely"}`;
      }
      return clusterLabel(cl, rep);
    },
    center: (rep) => {
      if (gs?.owners.has(rep)) {
        const o = gs.owners.get(rep)!;
        return o === null ? "~" : castList()[o]!.name[0]!;
      }
      return clusterLabel(cl, rep) ? String(cl.rank.get(rep)) : "";
    },
    // grade the apparent cluster against the town's truth: the largest
    // same-owner subset is what the observer got right; everything else
    // in the disc is error, and what that owner holds elsewhere is what
    // the observer is missing. An adversary wants errors low and
    // completeness high. Grading is the storyteller's, not the
    // observer's — it only shows when the learner asked to be shown
    // mistakes, the same gate every other truth-graded display uses.
    score: (rep) => {
      if (!A.showMistakes) return "";
      const members = cl.members.get(rep) ?? [rep];
      if (members.length < 2) return "";
      const byOwner = new Map<number | null, number>();
      for (const id of members) {
        const o = chain.coins.get(id)!.owner;
        byOwner.set(o, (byOwner.get(o) ?? 0) + 1);
      }
      let best: number | null = null;
      let k = 0;
      for (const [o, count] of byOwner) {
        if (count > k) { k = count; best = o; }
      }
      let truth = 0;
      for (const c of chain.coins.values()) if (c.owner === best) truth += 1;
      const err = Math.round(((members.length - k) / members.length) * 100);
      const comp = Math.round((k / truth) * 100);
      return `errors ${err}% · complete ${comp}%`;
    },
  };
}
/** one caption line from the change/payment identification's recorded
 *  reading of a transaction (#92): counts of what step one identified,
 *  the suspected change if step two linked one, and — where nothing was
 *  linked — the reason the analysis itself declined. Null when the
 *  heuristic read nothing at all (so ordinary transactions stay
 *  uncaptioned rather than every square growing a "nothing here" line). */
function changeReadCaption(reads: ChangeRead[] | undefined): string | null {
  if (!reads || reads.length === 0) return null;
  let pay = 0, self = 0, changed = 0, unknowns = 0;
  let abstain: ChangeRead["abstain"];
  for (const r of reads) {
    pay += r.payments.length;
    self += r.selfs.length;
    if (r.change) changed += 1;
    if (r.abstain) {
      unknowns += r.unknowns;
      abstain ??= r.abstain;
    }
  }
  const parts: string[] = [];
  if (pay > 0) parts.push(pay === 1 ? "1 payment identified" : `${pay} payments identified`);
  if (self > 0) parts.push(self === 1 ? "1 denominated self-spend linked" : `${self} denominated self-spends linked`);
  if (changed > 0) parts.push(changed === 1 ? "change suspected, linked" : `${changed} suspected as change, linked`);
  if (abstain) {
    const why: Record<NonNullable<ChangeRead["abstain"]>, string> = {
      inputs: "inputs not one cluster — nothing linked",
      mapping: "sub-transaction mapping open — nothing linked",
      part: "one-owner reading contradicted — nothing linked",
      batch: pay > 0
        ? `${unknowns} unclear, read as a batch — unlinked`
        : "no payment identified — read as a batch, nothing linked",
      bar: pay > 0
        ? "evidence below the bar — not linked"
        : "no payment identified — nothing linked",
      refuted: "contradicted by attributions — not linked",
    };
    parts.push(why[abstain]);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function observerPaint(): Paint {
  const cl = A.observerModel();
  // grant attribution rides on top of the map: a granted coin is
  // disclosed truth, a coin colored through its cluster is the grant
  // compounding over a link — which can be wrong, so it says "likely"
  const attr = A.grantsOn() ? A.grantState().attr : null;
  const nameOf = (o: number | null): string => (o === null ? "outside town" : castList()[o]!.name);
  // one reading of a coin for the whole lens: attribution first, the
  // cluster palette where the grant says nothing — the transaction tint
  // below must agree with the coins it wraps, or a named cluster's
  // spends would wear an anonymous color
  const coinCol = (id: string): string => {
    const a = attr?.get(id);
    return a ? (a.owner === null ? "#e8e5da" : ownerColor(a.owner)) : clusterColor(cl, id);
  };
  return {
    coinFill: (c) => coinCol(c.id),
    coinText: () => "#111",
    coinCaption: (c) => {
      const a = attr?.get(c.id);
      return a ? `${nameOf(a.owner)} · ${a.direct ? "disclosed" : "likely"}` : clusterLabel(cl, c.id);
    },
    // the change/payment identification's own reading of the
    // transaction, where it read anything: payments identified, the
    // suspected change, or why it declined to link (#92). This is the
    // observer's verdict, not the town's memo — the abstentions are as
    // informative as the links, so they get named instead of leaving a
    // silent gap where the all-seeing lens shows a story.
    txMemo: (t) => changeReadCaption(cl.changeReads.get(t.id)),
    txAttribution: (t, ch) => {
      const fill = commonInputFill(ch, t, (c) => coinCol(c.id));
      return fill === CLUSTER_MISC ? null : fill; // unclustered is not attribution
    },
    txFlag: (t) => {
      if (!A.showMistakes) return null;
      const ms = A.mistakes().get(t.id);
      if (!ms) return null;
      return ms.length === 1 ? ms[0]!.note : `${ms[0]!.note} (+${ms.length - 1} more)`;
    },
  };
}

// --- agent lens: one participant's ledger — own coins, counterparty
// fixed points, cluster-seeded guesses, gray where they are as blind as
// any outsider ---
function defaultLensAgent(): number {
  // the payee of the tutorial's focused payjoin, if the economy has one
  const pjs = eco?.events.filter((e) => e.form === "payjoin") ?? [];
  const ev = pjs.find((e) => eco!.chain.txs.get(e.tid)!.inputs.length === 2) ?? pjs[0];
  return ev?.payee ?? 0;
}
let knCache: { rev: number; u: number; k: Knowledge } | null = null;
function knowledge(): Knowledge {
  const s = active();
  const u = lensAgent ?? 0;
  if (!knCache || knCache.rev !== simRev || knCache.u !== u) {
    // under the time cursor, the ledger too only reaches the visible day
    const events = (eco?.events ?? []).filter((e) => s.chain.txs.has(e.tid));
    const cjs = eco ? [...eco.coinjoins.keys()].filter((t) => s.chain.txs.has(t)) : undefined;
    knCache = { rev: simRev, u, k: agentKnowledge(s.chain, events, u, A.clustering(), cjs) };
  }
  return knCache.k;
}
function agentPaint(): Paint {
  const k = knowledge();
  const u = lensAgent ?? 0;
  const name = (o: number | null): string => (o === null ? "a merchant" : castList()[o]!.name);
  return {
    coinFill: (c) => {
      const a = k.coins.get(c.id);
      if (!a) return CLUSTER_MISC;
      const color = a.owner === null ? "#e8e5da" : ownerColor(a.owner);
      return a.direct ? color : color + "88";
    },
    coinText: (c) => (k.coins.has(c.id) ? "#111" : "#e6e8ec"),
    coinCaption: (c) => {
      const a = k.coins.get(c.id);
      if (!a) return "";
      if (a.owner === u) return `own${c.label ? " · " + c.label : ""}`;
      return a.direct ? `${name(a.owner)} · known` : `${name(a.owner)} · likely`;
    },
    txMemo: (t) => (k.txs.has(t.id) ? t.memo ?? null : null),
    txAttribution: (t, ch) => {
      const fill = commonInputFill(ch, t, (c) => {
        const a = k.coins.get(c.id);
        if (!a) return CLUSTER_MISC;
        const color = a.owner === null ? "#e8e5da" : ownerColor(a.owner);
        return a.direct ? color : color + "88";
      });
      return fill === CLUSTER_MISC ? null : fill; // unknown is not attribution
    },
  };
}

let cam: Camera = { x: 0, y: 0, scale: 1 };
let hover: Hit | null = null;
type Selection =
  | { kind: "coins"; ids: string[] }
  | { kind: "tx"; id: string }
  | { kind: "cluster"; id: string };
let selection: Selection | null = null;
let highlight: Trace | null = null;
let hideDim = false;
let ping: { wx: number; wy: number; t: number } | null = null;
let viewT = 0;          // 0 = block explorer, 1 = bipartite
let targetView: 0 | 1 = 0;
// the cluster graph is not a third view but a flattening of the current
// one (a helix collapsing into a circle): toggled orthogonally
let collapsed = false;
let collapseT = 0;
// where the circle forms: the world rect the camera showed when the
// collapse began. The coins glide into a circular arrangement without
// the viewport moving, so the circle must come to the camera rather
// than the camera flying to the circle. Rides the fragment (`cf`) so a
// shared link reproduces the same geometry; null = the layout's own
// origin-centered coordinates (old links, pre-fit behavior).
let clusterFit: Rect | null = null;
// a live repartition tween (heuristic toggle while contracted); null
// when the discs are settled
let clusterTrans: ClusterTransition | null = null;

const anim = new Animator();

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  if (pendingFly && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    const p = pendingFly;
    pendingFly = null;
    flyTo(p.rect, p.ms);
  }
  draw();
}

/** While a trace is live under the observer, list the clusters the
 *  traced paths touch along the bottom center of the view — the
 *  intersection at full strength, the rest of the union dimmed.
 *  Untouched clusters do not appear. Screen space, drawn over the
 *  graph; the contracted view shows the discs themselves instead. */
function drawClusterStrip(w: number, h: number): void {
  const cl = A.observerModel(); // the partition the trace intersected (#124)
  const repsOf = (coins: Set<string>): Set<string> => {
    const out = new Set<string>();
    for (const id of coins) {
      const r = cl.rep.get(id);
      if (r !== undefined) out.add(r);
    }
    return out;
  };
  const inter = repsOf(highlight!.full.coins);
  const union = repsOf(highlight!.partial.coins);
  for (const r of inter) union.add(r); // cluster expansion can reach beyond the cones
  const clusters = [...union]
    .filter((r) => cl.members.get(r)!.length >= 2)
    .sort((a, b) =>
      inter.has(a) === inter.has(b) ? cl.rank.get(a)! - cl.rank.get(b)! : inter.has(a) ? -1 : 1);
  const singles = [...union].filter((r) => cl.members.get(r)!.length < 2);
  const n = clusters.length + (singles.length > 0 ? 1 : 0);
  if (n === 0) return;
  const R = 13;
  const gap = Math.min(48, Math.max(30, (w - 120) / n));
  const y = h - 56;
  let x = w / 2 - ((n - 1) * gap) / 2;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const disc = (fill: string, center: string, caption: string, bright: boolean): void => {
    ctx.globalAlpha = bright ? 1 : 0.3;
    ctx.beginPath();
    ctx.arc(x, y, R, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(center, x, y);
    ctx.fillStyle = "#8b919c";
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillText(caption, x, y + R + 9);
    x += gap;
  };
  for (const rep of clusters) {
    disc(clusterColor(cl, rep), String(cl.rank.get(rep)),
      `${cl.members.get(rep)!.length} coins`, inter.has(rep));
  }
  if (singles.length > 0) {
    disc(CLUSTER_MISC, `+${singles.length}`, "lone coins", singles.some((r) => inter.has(r)));
  }
  ctx.restore();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const s = active();
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);
  if (collapseT > 0) {
    drawContraction(ctx, s.chain, s.layout, s.bip, Math.min(1, Math.max(0, viewT)),
      clusterLayout(), lensClustering(), collapseT, lensClusterPaint(), clusterTrans ?? undefined,
      hover?.kind === "cluster" ? hover.id : undefined, singletonRing());
    // ns-social mapping edges across the columns: the pair under manual
    // examination draws bright (the panel holds the verdict); paused
    // mid-replay, the next match the algorithm would accept draws dim —
    // press play or skip to take it
    const mapEdge = (a: string, b: string, alpha: number, color = "#edc948"): void => {
      const clay = clusterLayout();
      const na = clay.nodes.get(a), nb = clay.nodes.get(b);
      if (!na || !nb) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };
    if (collapseT > 0.9 && A.nsActive() && !A.nsPlaying) {
      const next = A.nsRun()[A.nsCursor];
      if (next && next.kind === "merge") {
        const cl = lensClustering();
        mapEdge(cl.rep.get(next.a) ?? next.a, cl.rep.get(next.b) ?? next.b, 0.35);
      }
    }
    const pair = nsProposalPair();
    if (pair && collapseT > 0.9) mapEdge(pair[0], pair[1], 1);
    // ns-netflix proposed links: matches the run accepted but the
    // replay has not yet applied, drawn teal between the clusters they
    // would fuse — the admissions made visible before they land
    if (collapseT > 0.9 && A.nfActive()) {
      const cl = lensClustering();
      for (const e of A.nfRun().slice(A.nfCursor)) {
        const ra = cl.rep.get(e.a) ?? e.a, rb = cl.rep.get(e.b) ?? e.b;
        if (ra === rb) continue;
        mapEdge(ra, rb, 0.55, "#76b7b2");
      }
    }
    // #104: the synthesis chapter's spotlight — gold rings name the
    // seeded clusters, dashed gold lines are the arrangements the
    // outsider's aux graph knows between the named agents, and once
    // the sweep has run, teal marks what it accepted
    if (collapseT > 0.9 && synthSpot > 0) {
      const board = synthExhibits().sweep?.board;
      if (board) {
        const cl = lensClustering();
        const clay = clusterLayout();
        const live = (rep: string): string => cl.rep.get(rep) ?? rep;
        const shown = new Set(board.seeds.map((s) => live(s.rep)));
        if (synthSpot === 2) for (const a of board.accepted) shown.add(live(a.rep));
        for (const [a, b] of board.auxPairs) {
          const ra = live(a), rb = live(b);
          if (ra !== rb && shown.has(ra) && shown.has(rb)) mapEdge(ra, rb, 0.5);
        }
        const ring = (rep: string, name: string, color: string): void => {
          const n = clay.nodes.get(live(rep));
          if (!n) return;
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 7, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          // the fitted board fills the camera rect edge to edge, so a
          // name above a top-edge disc would leave the frame — drop it
          // under the disc's captions instead
          const above = n.y - n.r - 14;
          ctx.fillText(name, n.x, above < clay.bounds.y + 6 ? n.y + n.r + 48 : above);
          ctx.restore();
        };
        for (const s of board.seeds) ring(s.rep, s.name, "#edc948");
        if (synthSpot === 2) for (const a of board.accepted) ring(a.rep, `${a.name}?`, "#76b7b2");
      }
    }
  } else {
    drawMorph(ctx, s.chain, s.layout, s.bip, viewT, {
      hover, highlight, hideDim,
      selected: selection?.kind === "coins" ? { coins: new Set(selection.ids), txs: new Set() } :
        selection?.kind === "tx" ? { coins: new Set(), txs: new Set([selection.id]) } : null,
      paint: lens === 1 ? observerPaint() : lens === 2 ? agentPaint() : OMNISCIENT,
    });
  }

  if (ping) {
    const r = 8 + ping.t * 46;
    ctx.beginPath();
    ctx.arc(ping.wx, ping.wy, r / Math.sqrt(cam.scale), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(237, 201, 72, ${(1 - ping.t).toFixed(3)})`;
    ctx.lineWidth = 3 / cam.scale;
    ctx.stroke();
  }
  ctx.restore();

  if (lens === 1 && highlight && collapseT === 0) drawClusterStrip(w, h);

  const hud = document.getElementById("hud")!;
  const dayPart = scene === 1
    ? (rewound() ? ` · day ${cursorDay()} (of ${economy().day} recorded)` : ` · day ${economy().day}`)
    : "";
  const playPart = session.manual !== null ? ` · playing ${castList()[session.manual]!.name}` : "";
  hud.textContent = `seed ${session.seed}${dayPart}${playPart} · zoom ${cam.scale.toFixed(2)}× · v: flip view · click coins: trace together (gold ring = what this lens singles out) · h: hide the rest · right-click: copy a reference${originsPart()}`;
}

// counterfactual-path counting for the selected coin (memoized: the flow
// network is rebuilt per chain growth, not per frame)
let originsCache: { id: string; rev: number; text: string } | null = null;
function originsPart(): string {
  // a joint trace under the observer intersects CLUSTERS (#113): count
  // what survived — the same reps the cluster strip draws at full
  // strength — plus every member coin they implicate
  if (lens === 1 && highlight &&
      (selection?.kind === "tx"
        ? (active().chain.txs.get(selection.id)?.inputs.length ?? 0) >= 2
        : selection?.kind === "coins" && selection.ids.length >= 2)) {
    const cl = A.observerModel();
    const reps = new Set<string>();
    for (const c of highlight.full.coins) {
      const r = cl.rep.get(c);
      if (r !== undefined) reps.add(r);
    }
    if (reps.size === 0) return "";
    return ` · intersection: ${reps.size} candidate cluster${reps.size === 1 ? "" : "s"}` +
      ` (${highlight.full.coins.size} coin${highlight.full.coins.size === 1 ? "" : "s"} implicated)`;
  }
  if (selection?.kind !== "coins" || selection.ids.length !== 1) return "";
  const id = selection.ids[0]!;
  const s = active();
  // a rewound cursor (or a mid-ride frame) can show a chain from before
  // the selected coin existed — same guard recomputeTrace applies
  if (!s.chain.coins.has(id)) return "";
  if (!originsCache || originsCache.id !== id || originsCache.rev !== simRev) {
    const o = counterfactualOrigins(s.chain, id);
    originsCache = {
      id,
      rev: simRev,
      text: o.roots.length === 0 ? "" :
        ` · ${id}: ${o.roots.length} candidate origin${o.roots.length === 1 ? "" : "s"}, ${o.robust.size} by two disjoint routes`,
    };
  }
  return originsCache.text;
}

// --- view toggle ---
const viewBtn = document.getElementById("viewtoggle") as HTMLButtonElement;
const VIEW_NAMES = ["view: cards", "view: graph"] as const;
function setView(view: 0 | 1, animate = true): void {
  targetView = view;
  syncKnobButtons();
  if (!animate) {
    viewT = view;
    draw();
    void syncFragment();
    return;
  }
  const from = viewT;
  // the selection is the same entity in both drawings — hold it steady on
  // screen while everything else rearranges around it
  const startRect = view <= 1 && from <= 1 ? selectionRect() : null;
  const hold = startRect
    ? worldToScreen(cam, canvas.clientWidth, canvas.clientHeight,
        startRect.x + startRect.w / 2, startRect.y + startRect.h / 2)
    : null;
  anim.add(500 + 400 * Math.abs(view - from), (t) => {
    viewT = from + (view - from) * t;
    if (hold) {
      const r = selectionRect();
      if (r) {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        cam = {
          ...cam,
          x: r.x + r.w / 2 - (hold[0] - w / 2) / cam.scale,
          y: r.y + r.h / 2 - (hold[1] - h / 2) / cam.scale,
        };
      }
    }
  }, { done: () => void syncFragment() });
  kick();
}
viewBtn.addEventListener("click", () => {
  const cur = currentViewState();
  // leaving the contracted map comes first: one press expands back
  // into the plain coin graph, the next switches the view
  applyViewState(contracted(cur)
    ? withGrouping(withLayout(cur, cur.arrange), "unclustered")
    : withView(cur, cur.view === "graph" ? "cards" : "graph"));
});

// --- cluster collapse: flatten the current view into the user graph ---
const clusterBtn = document.getElementById("clusterbtn") as HTMLButtonElement;
const unclusterBtn = document.getElementById("unclusterbtn") as HTMLButtonElement;
// toggle between the lens's partition and the lattice bottom (every
// coin a singleton), animating the discs splitting apart / gathering
// back — same repartition tween as a heuristic toggle
/** the first half of every contracted-view repartition: capture the
 *  old partition for the tween, and re-aim the fit at the rect the
 *  camera shows RIGHT NOW — a state change re-forms the map in place
 *  (the discs travel, the viewport doesn't, same rule as the collapse
 *  itself). Returns null (and leaves the fit alone) when there is
 *  nothing on screen to animate from. */
function repartitionStart(animate = true): { cl: Clustering; clay: ClusterLayout } | null {
  const before = collapsed && collapseT > 0.9 && lastCollapse && animate
    ? { cl: lastCollapse.cl, clay: lastCollapse.clay } : null;
  if (collapsed && animate && canvas.clientWidth > 0) {
    // the fit rect is part of the collapse memo's key, so re-aiming it
    // invalidates nothing: layouts for the old rect stay cached, and a
    // knob toggled back under an unmoved camera reuses its arrangement
    clusterFit = visibleWorldRect();
  }
  return before;
}
function setUnclustered(on: boolean, animate = true): void {
  if (unclustered === on) return;
  const before = repartitionStart(animate);
  unclustered = on;
  syncKnobButtons();
  if (selection?.kind === "cluster") { selection = null; highlight = null; }
  A.nsSecond = null;
  if (before) {
    const tr: ClusterTransition = {
      t: 0,
      fragments: transitionFragments(before.cl, before.clay, lensClustering()),
      strands: strandGeometry(active().chain, before.cl, before.clay),
    };
    clusterTrans = tr;
    anim.add(900, (t) => { tr.t = t; }, {
      done: () => { if (clusterTrans === tr) clusterTrans = null; },
    });
    kick();
  }
  recomputeTrace();
  draw();
  void syncFragment();
}
unclusterBtn.addEventListener("click", () => {
  const cur = currentViewState();
  applyViewState(withGrouping(cur, cur.grouping === "clustered" ? "unclustered" : "clustered"));
});
/** the world rect the camera currently shows, minus whatever the
 *  tutorial panel covers — where a collapse forms its circle. A camera
 *  fly in flight counts as already arrived: a repartition landing
 *  mid-fly (the analysis worker outlasting a tutorial camera move)
 *  must fit the map to the rect the camera is headed for, not one it
 *  is about to leave (#103's ns-columns race, seen again on the
 *  synthesis map steps) */
function visibleWorldRect(): Rect {
  const c = flyCam ?? cam;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const vp = visibleViewport();
  return {
    x: c.x + (vp.x - w / 2) / c.scale,
    y: c.y + (vp.y - h / 2) / c.scale,
    w: vp.w / c.scale,
    h: vp.h / c.scale,
  };
}
function setCollapsed(on: boolean, animate = true): void {
  collapsed = on;
  syncKnobButtons();
  // the viewport stays put: the coins take the time to travel into the
  // circular arrangement (a timeline wrapping around a circle), formed
  // inside the rect the camera is already showing. A restore (animate
  // = false) keeps whatever fit the fragment carried instead.
  if (on && animate && canvas.clientWidth > 0) {
    clusterFit = visibleWorldRect(); // the fit keys the collapse memo
  }
  if (!animate) {
    collapseT = on ? 1 : 0;
    draw();
    void syncFragment();
    return;
  }
  const from = collapseT;
  const to = on ? 1 : 0;
  // three legs need room: shrink, flatten, stack (#95)
  anim.add(80 + 2100 * Math.abs(to - from), (t) => { collapseT = from + (to - from) * t; },
    { done: () => void syncFragment() });
  kick();
}
// the contracted map is a graph layout (#115): entering it from the
// cards view morphs into the graph as the contraction forms, and
// expanding always lands back in the graph
clusterBtn.addEventListener("click", () => {
  const cur = currentViewState();
  // the chord shortcut: contract into the clustered ring, or expand
  // whatever arrangement of the map is showing back to the coin graph
  applyViewState(contracted(cur)
    ? withGrouping(withLayout(cur, cur.arrange), "unclustered")
    : withGrouping(withLayout(cur, "chord"), "clustered"));
});

// --- graph layout mode (#44): layered timeline vs force-directed. The
// bipartite view can be drawn either way; both scenes swap their bip
// layout and everything on screen glides to its new frame.
const layoutBtn = document.getElementById("layoutbtn") as HTMLButtonElement;
function setForceLayout(on: boolean, animate = true): void {
  if (forceLayout === on) return;
  // contracted, the button reorders the ring (time vs fewest crossings):
  // animate the discs gliding around it, the usual repartition tween
  const beforeRing = repartitionStart(animate);
  forceLayout = on;
  syncKnobButtons();
  if (beforeRing) {
    const tr: ClusterTransition = {
      t: 0,
      fragments: transitionFragments(beforeRing.cl, beforeRing.clay, lensClustering()),
      strands: strandGeometry(active().chain, beforeRing.cl, beforeRing.clay),
    };
    clusterTrans = tr;
    anim.add(900, (t) => { tr.t = t; }, {
      done: () => { if (clusterTrans === tr) clusterTrans = null; },
    });
    kick();
  }
  relayoutGraph(animate);
}
/** recompute both scenes' graph arrangements and glide the nodes over —
 *  shared by the layout button and the shown-only re-layout ("r") */
function relayoutGraph(animate = true): void {
  const prevIntro = intro.bip;
  const prevEco = ecoScene;
  intro.bip = bipFor(intro.chain);
  if (eco) refreshEcoLayouts();
  const targetIntro = intro.bip;
  const targetEco = ecoScene;
  if (!animate) {
    draw();
    void syncFragment();
    return;
  }
  const gen = ++dayGen; // a day stepped mid-glide takes over from here
  anim.add(900, (t) => {
    if (gen !== dayGen) return;
    intro.bip = t >= 1 ? targetIntro : blendBip(prevIntro, targetIntro, t);
    if (prevEco && targetEco) {
      ecoScene = t >= 1 ? targetEco : { ...targetEco, bip: blendBip(prevEco.bip, targetEco.bip, t) };
    }
  }, { done: () => void syncFragment() });
  // the two arrangements live in different coordinate regions: re-frame
  if (targetView === 1 && !collapsed) {
    const b = (scene === 0 ? targetIntro : (targetEco?.bip ?? targetIntro)).bounds;
    flyTo({ x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 });
  }
  kick();
}
layoutBtn.addEventListener("click", () => {
  const cur = currentViewState();
  if (cur.view !== "graph") {
    // over the cards the button only flips the remembered arrangement
    applyViewState({ ...cur, arrange: cur.arrange === "force" ? "ltr" : "force" });
    return;
  }
  // the three-position layout knob (#115): layered -> force -> chord.
  // Grouping is untouched, so cycling from the plain graph curls it
  // into the singleton ring, and from the clustered map the ring of
  // the same partition; chord -> layered uncurls back.
  const k = knobs(cur).layout;
  applyViewState(withLayout(cur, k === "ltr" ? "force" : k === "force" ? "chord" : "ltr"));
});

// --- the three-knob control model (#115): view, layout, grouping ---
// The knobs live in src/ui/viewstate.ts; main.ts stores the render
// substrate (targetView / collapsed / forceLayout / unclustered /
// chordArr and the tween scalars), so a gesture reads the current
// state, rewrites it through the model, and this executor turns the
// difference into the primitive transitions the setters animate.
function currentViewState(): ViewState {
  return canonical({
    view: targetView === 1 ? "graph" : "cards",
    arrange: forceLayout ? "force" : "ltr",
    chord: collapsed && chordArr,
    // outside the contracted map the plain coin graph shows — the
    // unclustered flag only means something while the map is up
    grouping: collapsed && !unclustered ? "clustered" : "unclustered",
  });
}
/** every knob label reads off the one canonical state; the grouping
 *  button covers the whole graph view (any of its four pictures) */
function syncKnobButtons(): void {
  const cur = currentViewState();
  const k = knobs(cur);
  viewBtn.textContent = VIEW_NAMES[cur.view === "graph" ? 1 : 0];
  layoutBtn.textContent =
    k.layout === "chord" ? "layout: chord" :
    k.layout === "force" ? "layout: force" : "layout: layered";
  clusterBtn.textContent = contracted(cur) ? "expand" : "clusters";
  // action-labeled: the button names the grouping a click switches to
  unclusterBtn.textContent = k.grouping === "unclustered" ? "clustered" : "unclustered";
  unclusterBtn.style.display =
    cur.view === "graph" && (allRowsSeen || seenWidgets.has("uncluster"))
      ? "block" : "none";
}
/** the repartition/re-arrangement tween shared by every in-map change:
 *  discs glide from where the old arrangement drew them to the new
 *  one's slots (the same tween whether the partition or only the
 *  arrangement changed) */
function beginClusterTween(before: { cl: Clustering; clay: ClusterLayout } | null): void {
  if (!before) return;
  const tr: ClusterTransition = {
    t: 0,
    fragments: transitionFragments(before.cl, before.clay, lensClustering()),
      strands: strandGeometry(active().chain, before.cl, before.clay),
  };
  clusterTrans = tr;
  anim.add(900, (t) => { tr.t = t; }, {
    done: () => { if (clusterTrans === tr) clusterTrans = null; },
  });
  kick();
}
function applyViewState(nextRaw: ViewState, animate = true): void {
  const next = canonical(nextRaw);
  const cur = currentViewState();
  const wasMap = contracted(cur), willMap = contracted(next);
  // leaving the contracted map runs first: expand from whatever
  // arrangement is showing before anything else moves
  if (wasMap && !willMap) setCollapsed(false, animate);
  if (cur.view !== next.view) setView(next.view === "graph" ? 1 : 0, animate);
  if (willMap && !wasMap) {
    // settle the partition and arrangement while nothing is showing,
    // then contract into the finished map — the collapse flies straight
    // to its final shape instead of repartitioning midway
    chordArr = next.chord;
    if (cur.arrange !== next.arrange) setForceLayout(next.arrange === "force", false);
    if ((next.grouping === "unclustered") !== unclustered) {
      setUnclustered(next.grouping === "unclustered", false);
    }
    setCollapsed(true, animate);
    return;
  }
  if (willMap && wasMap) {
    // changes inside the map: ring <-> band/map re-arrangements and
    // grouping walks are all the one disc-gliding tween
    if (cur.chord !== next.chord) {
      const before = repartitionStart(animate);
      chordArr = next.chord;
      beginClusterTween(before);
    }
    if (cur.arrange !== next.arrange) setForceLayout(next.arrange === "force", animate);
    if (cur.grouping !== next.grouping) {
      setUnclustered(next.grouping === "unclustered", animate);
    }
    syncKnobButtons();
    draw();
    void syncFragment();
    return;
  }
  // both sides uncontracted: the plain graph or the cards view
  chordArr = next.chord;
  if (cur.arrange !== next.arrange) setForceLayout(next.arrange === "force", animate);
  syncKnobButtons();
}

const lensBtn = document.getElementById("lens") as HTMLButtonElement;
function setLens(l: 0 | 1 | 2): void {
  // a lens change while the map is contracted is a walk through the
  // refinement lattice: the old partition's discs merge and split into
  // the new one's, the same repartition tween as a heuristic toggle —
  // not a camera move
  const before = repartitionStart();
  lens = l;
  if (l === 2 && lensAgent === null) lensAgent = defaultLensAgent();
  lensBtn.textContent =
    l === 0 ? "lens: all-seeing" :
    l === 1 ? "lens: observer" :
    `lens: ${castList()[lensAgent ?? 0]!.name}'s`;
  overlaysPanel.style.display = l === 1 ? "block" : "none";
  recomputeTrace(); // the joint-trace intersection is cluster-wise under the observer
  // the contracted graph is a different partition under a different lens:
  // drop a selection that named a vertex of the old one
  if (collapsed) {
    if (selection?.kind === "cluster") { selection = null; highlight = null; }
    A.nsSecond = null;
    if (before) {
      const tr: ClusterTransition = {
        t: 0,
        fragments: transitionFragments(before.cl, before.clay, lensClustering()),
      strands: strandGeometry(active().chain, before.cl, before.clay),
      };
      clusterTrans = tr;
      anim.add(900, (t) => { tr.t = t; }, {
        done: () => { if (clusterTrans === tr) clusterTrans = null; },
      });
      kick();
    }
  }
  draw();
  void syncFragment();
}
lensBtn.addEventListener("click", () => setLens(((lens + 1) % 3) as 0 | 1 | 2));

// --- observer heuristic toggles: which inferences the map is running.
// With all off, only the public structure remains — nothing is linked,
// colored, or captioned beyond what the chain itself says.
const overlaysPanel = document.getElementById("overlays")!;
const OVERLAY_DEFS: { bit: number; label: string; title: string }[] = [
  { bit: OV_REUSE, label: "address reuse", title: "coins paid to the same address — one key controls both, on the face of the record; no inference involved" },
  { bit: OV_CIOH, label: "common-input ownership", title: "inputs spent together — probably one owner" },
  { bit: OV_CHANGE, label: "change/payment identification", title: "two steps: identify the payment outputs first (a round dollar or BTC amount, or a disclosed owner), then read what remains — exactly one unidentified output is suspected change and linked to the spender; several read as a batch payment and the observer abstains; a transaction whose repeated menu denominations mark it as a likely coinjoin between strangers is presumed to move no net value between them, so denominated outputs read as self-spends" },
  { bit: OV_SUBSUM, label: "sub-transaction analysis", title: "a unique balancing partition links each sub-transaction's coins together; even when several partitions balance, an output larger than the rest of the inputs combined is linked to the one input that could fund it" },
  { bit: OV_REMEET, label: "repeated co-membership", title: "inputs of a likely coinjoin that are outputs of one earlier likely coinjoin — peers are drawn from anywhere, so the same owners landing in the same two sessions by chance is the unlikely reading, and one participant bringing their own coins back is the plain one. The linked coins also count as one combined input in the sub-transaction analysis, striking every balanced reading that splits them" },
];
overlaysPanel.innerHTML = `<h3>clustering</h3><h4>heuristics</h4>` + OVERLAY_DEFS.map((d) =>
  `<label title="${d.title}"><input type="checkbox" data-bit="${d.bit}"> ${d.label}</label>` +
  (d.bit === OV_CIOH
    ? `<div class="ovslider" title="CIOH abstains on transactions with more inputs than this — honest wallets rarely co-spend that many coins, collaborative transactions routinely do">
        <span>max inputs</span>
        <input type="range" id="ciohmax" min="2" max="${CIOH_MAX_OFF}" step="1" value="${CIOH_MAX_OFF}">
        <output id="ciohmaxv">off</output>
      </div>`
    : d.bit === OV_CHANGE
    ? `<div id="chtells">
        <label class="ovnest" title="an amount landing on a round multiple of $10 at that day's exchange rate reads as a payment — prices are set in dollars"><input type="checkbox" id="chusd" checked> round dollars</label>
        <label class="ovnest" title="an amount round in BTC terms (0.05, not 0.0473) reads as a payment too"><input type="checkbox" id="chbtc" checked> round bitcoin</label>
        <label class="ovnest" title="an output paying a script type (address type) none of the inputs use reads as a payment — a wallet keeps its change where it keeps its keys. A wallet migration makes this heuristic misfire: the new wallet's change looks foreign next to the old wallet's coins"><input type="checkbox" id="chscript" checked> script type</label>
        <label class="ovnest" title="an output the observer's auxiliary information attributes to a different owner than a granted input is a payment however the amount reads — needs the knowledge grant below to have anything to say"><input type="checkbox" id="chaux" checked> auxiliary attribution</label>
        <div class="ovslider" title="how many of the ENABLED heuristic kinds must fire across the sub-transaction's identified payments before the leftover output is linked. At 1 any single heuristic decides; higher bars demand the kinds corroborate each other, trading coverage for fewer wrong links">
          <span>evidence bar</span>
          <input type="range" id="chev" min="1" max="${CHANGE_EV_MAX}" step="1" value="1">
          <output id="chevv">1 heuristic</output>
        </div>
      </div>`
    : "")).join("") +
  `<label title="Narayanan–Shmatikov social-network analysis: partition the cluster graph — temporally, into contiguous epochs each expected to cluster into much the same shape — and match vertices across the parts by the shape of their neighborhoods; a match is an ownership claim, so accepting it merges the clusters. The side-by-side columns are just the display, one per part"><input type="checkbox" id="nssoc"> social-network analysis</label>
  <div id="nssoccontrols" style="display:none">
    <div class="ovslider" title="similarity a pair must clear to be matched (cosine of the two neighborhoods); the top of the slider is past the ceiling — nothing clears it, so the analysis is in view but admits no matches">
      <span>threshold</span>
      <input type="range" id="nsth" min="0" max="101" step="1" value="50">
      <output id="nsthv">0.50</output>
    </div>
    <div class="ovslider" title="the partitioning strategy: how many contiguous epochs the timeline splits into — each drawn as its own column">
      <span>partitions</span>
      <input type="range" id="nsparts" min="2" max="4" step="1" value="2">
      <output id="nspartsv">2</output>
    </div>
    <div class="ovslider" title="the analysis lands finished; drag back to rewind the algorithm's progress and watch the merges retract, then land again in the order it made them">
      <span>progress</span>
      <input type="range" id="nsprog" min="0" max="0" step="1" value="0">
    </div>
    <div class="nsrow">
      <button id="nsplay" title="animate the propagation match by match from wherever the progress slider points">play</button>
      <span id="nspos"></span>
    </div>
    <div id="nsproposal"></div>
  </div>
  <label title="Narayanan–Shmatikov statistical de-anonymization: fingerprint every cluster by how it behaves — amount distribution, temporal pattern, amounts over time, time-of-day rhythm, feerates absolute and relative to the day's prevailing rate, address script types, and transaction-building habits (nLockTime default, signature grinding) — and match clusters whose fingerprints agree — a pair is accepted only when each cluster is the other's clearest counterpart, ahead of every runner-up; contested candidates stay unmatched. A match is an ownership claim, so accepting it merges the clusters. Within a single transaction the same reading cuts the other way: inputs whose fingerprints diverge (two script types in one spend) mark probable collaboration, so the one-owner heuristics abstain on that transaction"><input type="checkbox" id="nsnf"> statistical fingerprinting</label>
  <div id="nsnfcontrols" style="display:none">
    <div class="ovslider" title="similarity a pair must clear to be matched (mean cosine over the feature blocks); the top of the slider is past the ceiling — nothing clears it, so the analysis is in view but admits no matches">
      <span>threshold</span>
      <input type="range" id="nsnfth" min="0" max="101" step="1" value="65">
      <output id="nsnfthv">0.65</output>
    </div>
    <div class="ovslider" title="the greedy run lands finished; drag back to rewind its progress and watch the matches land again best-first">
      <span>progress</span>
      <input type="range" id="nfprog" min="0" max="0" step="1" value="0">
    </div>
    <div class="nsrow">
      <button id="nsnfplay" title="animate the run's accepted matches from wherever the progress slider points — each was a reciprocal best when admitted, and no vertex is revisited, so this only replays the admission order">play</button>
      <span id="nsnfpos"></span>
    </div>
    <div id="nsnfstats"></div>
    <div class="nshint">each wallet product here keeps one script type, one nLockTime default and one signing habit — the same knobs real wallet software leaves set on the record</div>
  </div>
  <h4>auxiliary information</h4>
  <label title="the exchange's private books: a coin withdrawn by an identified customer, or spent into an identified deposit, carries a true name. Nothing on the graph marks these — this observer simply holds the records, and the named coins become a floor of certain knowledge under whatever the slider leaks"><input type="checkbox" id="kycobs"> exchange records (KYC)</label>
  <div class="ovslider" id="auxleaks" title="a second, separate source IN ADDITION to the exchange's records: suppose some fraction of ALL coins leaked their true owners at random — subpoenas, trackers, counterparties, careless payees. This is not the exchange's records and does not adjust them; the two grants combine, and every named coin from either source seeds the map the same way: clusters holding a named coin take the name, and same-named clusters fuse. The slider's minimum is the plain observer; its maximum is omniscience — the all-seeing lens is just this slider pushed to the top. Each notch adds leaks without retracting any"><span>random leaks</span>
    <input type="range" id="auxfrac" min="0" max="100" step="1" value="0">
    <output id="auxfracv">none</output>
  </div>
  <div class="nshint" id="auxhint">two independent sources that combine: the records name the exchange's own coins; the slider leaks a random sample of everyone's</div>
  <h4>grading</h4>
  <label title="mark transactions where a heuristic's local inference is wrong against the hidden truth — e.g. the change guess picked the payment output. The storyteller's grading: no real observer could draw this."><input type="checkbox" id="mistakes"> point out mistakes</label>
  <div id="gradestats"></div>`;
// the panel grows with the story: a row stays off the panel until the
// walked path (or the free-playing user, or a restored fragment) first
// runs it with the observer panel in view — and once introduced it
// stays, even through the remove-one-clue rerun. A step can also unhide
// a row it only points at (TutorialStep.reveals), and leaving the tour
// — done or skip — or arriving on a tourless link reveals everything.
type PanelRow = "reuse" | "cioh" | "change" | "subsum" | "remeet" | "nssoc" | "nsnf" | "kyc" | "aux" | "grading"
  | "chusd" | "chbtc" | "chscript" | "chaux";
const seenRows = new Set<PanelRow>();
let allRowsSeen = false;
// staged introductions (#116): the top-level controls stay put until
// the chapter that gives them meaning — same monotone walked-path rule
// as the heuristics-panel rows; done/skip/tourless reveal everything
const seenWidgets = new Set<TutorialWidget>();
function reflectStagedWidgets(): void {
  const show = (el: HTMLElement, on: boolean): void => {
    el.style.display = on ? "block" : "none";
  };
  show(viewBtn, allRowsSeen || seenWidgets.has("view"));
  show(layoutBtn, allRowsSeen || seenWidgets.has("layout"));
  show(clusterBtn, allRowsSeen || seenWidgets.has("cluster"));
  show(lensBtn, allRowsSeen || seenWidgets.has("lens"));
  syncKnobButtons(); // the grouping button folds staging into its view rule
}
function rowsOnNow(): Record<PanelRow, boolean> {
  const eo = A.effOverlays();
  return {
    reuse: (eo & OV_REUSE) !== 0,
    cioh: (eo & OV_CIOH) !== 0,
    change: (eo & OV_CHANGE) !== 0,
    subsum: (A.overlays & OV_SUBSUM) !== 0,
    remeet: (A.overlays & OV_REMEET) !== 0,
    nssoc: A.nsSocial,
    nsnf: A.nfOn,
    // the exchange's records and the random leaks are separate rows so
    // the tutorial can introduce them chapters apart; a live slider
    // reveals the section (and its checkbox) even if KYC never ran
    kyc: A.kycObs || A.auxFrac > 0,
    aux: A.auxFrac > 0,
    grading: A.showMistakes,
    // the change heuristic's family members stage one at a time: a
    // member counts as introduced only when it RUNS under a live
    // change row — mirroring the walked-path staging of the rows
    chusd: (eo & OV_CHANGE) !== 0 && (A.changeTells & TELL_USD) !== 0,
    chbtc: (eo & OV_CHANGE) !== 0 && (A.changeTells & TELL_BTC) !== 0,
    chscript: (eo & OV_CHANGE) !== 0 && (A.changeTells & TELL_SCRIPT) !== 0,
    chaux: (eo & OV_CHANGE) !== 0 && (A.changeTells & TELL_AUX) !== 0,
  };
}
// the elements a row owns: its label plus any nested controls, and the
// section headings for the sections that hold a single row
function panelRowEls(k: PanelRow): (Element | null)[] {
  const byBit = (bit: number): Element | null =>
    overlaysPanel.querySelector(`input[data-bit="${bit}"]`)?.closest("label") ?? null;
  const byId = (id: string): Element | null =>
    document.getElementById(id)?.closest("label") ?? null;
  const h4 = overlaysPanel.querySelectorAll("h4");
  switch (k) {
    case "reuse": return [byBit(OV_REUSE)];
    case "cioh": return [byBit(OV_CIOH), document.getElementById("ciohmax")?.closest(".ovslider") ?? null];
    case "change": return [byBit(OV_CHANGE), document.getElementById("chtells")];
    case "subsum": return [byBit(OV_SUBSUM)];
    case "remeet": return [byBit(OV_REMEET)];
    case "nssoc": return [byId("nssoc")];
    case "nsnf": return [byId("nsnf")];
    case "kyc": return [h4[1] ?? null, byId("kycobs")];
    case "chusd": return [byId("chusd")];
    case "chbtc": return [byId("chbtc")];
    case "chscript": return [byId("chscript")];
    case "chaux": return [byId("chaux")];
    case "aux": return [document.getElementById("auxleaks"), document.getElementById("auxhint")];
    case "grading": return [h4[2] ?? null, byId("mistakes"), document.getElementById("gradestats")];
  }
}
function reflectOverlays(): void {
  // no marks are taken here: the live knobs pass through transient
  // mixes while a tutorial step's changes route through the worker as
  // separate commits (the observer lens landing before its overlays
  // would read the cards chapter's defaults and reveal every row at
  // once) — the tutorial's onStepChange marks rows off the walked
  // path's declared values instead
  const rowOn = rowsOnNow();
  const rowKeys = Object.keys(rowOn) as PanelRow[];
  let anyHeuristic = false;
  let anyRow = false;
  for (const k of rowKeys) {
    const show = allRowsSeen || seenRows.has(k) || rowOn[k];
    if (show) anyRow = true;
    if (show && k !== "kyc" && k !== "aux" && k !== "grading") anyHeuristic = true;
    for (const el of panelRowEls(k)) {
      if (el) (el as HTMLElement).style.display = show ? "" : "none";
    }
  }
  // with no rows yet the panel is bare headings — hide those too; the
  // heuristics section header waits for its first row even while the
  // auxiliary section is already up
  (overlaysPanel.querySelector("h3") as HTMLElement).style.display =
    anyRow ? "" : "none";
  (overlaysPanel.querySelector("h4") as HTMLElement).style.display =
    anyHeuristic ? "" : "none";
  overlaysPanel.querySelectorAll("input[data-bit]").forEach((el) => {
    const input = el as HTMLInputElement;
    // the boxes show what RUNS — the forced CIOH reads checked while
    // sub-tx is on, though the user's own setting waits underneath
    input.checked = (A.effOverlays() & Number(input.dataset["bit"])) !== 0;
  });
  // while the sub-transaction analysis runs, CIOH is forced on and
  // greyed out (see effOverlays)
  const ciohBox = overlaysPanel.querySelector(`input[data-bit="${OV_CIOH}"]`) as HTMLInputElement;
  ciohBox.disabled = (A.overlays & OV_SUBSUM) !== 0;
  const slider = document.getElementById("ciohmax") as HTMLInputElement;
  slider.value = String(A.ciohMax);
  slider.disabled = (A.effOverlays() & OV_CIOH) === 0;
  (document.getElementById("ciohmaxv") as HTMLOutputElement).textContent =
    A.ciohMax >= CIOH_MAX_OFF ? "off" : String(A.ciohMax);
  const changeOff = (A.overlays & OV_CHANGE) === 0;
  for (const [id, bit] of [["chusd", TELL_USD], ["chbtc", TELL_BTC], ["chscript", TELL_SCRIPT], ["chaux", TELL_AUX]] as const) {
    const box = document.getElementById(id) as HTMLInputElement;
    box.checked = (A.changeTells & bit) !== 0;
    box.disabled = changeOff;
  }
  // the bar counts kinds, so it can demand at most the enabled kinds —
  // and with none enabled nothing can clear it either way
  const chev = document.getElementById("chev") as HTMLInputElement;
  const enabledKinds = Math.max(1, A.tellCount(A.changeTells));
  chev.max = String(enabledKinds);
  A.changeEvidence = Math.min(A.changeEvidence, enabledKinds);
  chev.value = String(A.changeEvidence);
  chev.disabled = changeOff || A.tellCount(A.changeTells) <= 1;
  (document.getElementById("chevv") as HTMLOutputElement).textContent =
    A.changeEvidence === 1 ? "1 heuristic" : `${A.changeEvidence} heuristics`;
  (document.getElementById("mistakes") as HTMLInputElement).checked = A.showMistakes;
  (document.getElementById("kycobs") as HTMLInputElement).checked = A.kycObs;
  (document.getElementById("auxfrac") as HTMLInputElement).value = String(Math.round(A.auxFrac * 100));
  (document.getElementById("auxfracv") as HTMLOutputElement).textContent =
    A.auxFrac <= 0 ? "none" : A.auxFrac >= 1 ? "omniscient" : `${Math.round(A.auxFrac * 100)}%`;
  (document.getElementById("nssoc") as HTMLInputElement).checked = A.nsSocial;
  (document.getElementById("nssoccontrols") as HTMLElement).style.display = A.nsSocial ? "block" : "none";
  if (A.nsSocial) {
    (document.getElementById("nsth") as HTMLInputElement).value = String(Math.round(A.nsThreshold * 100));
    (document.getElementById("nsthv") as HTMLOutputElement).textContent =
      A.nsThreshold > 1 ? "none" : A.nsThreshold.toFixed(2);
    (document.getElementById("nsparts") as HTMLInputElement).value = String(A.nsParts);
    (document.getElementById("nspartsv") as HTMLOutputElement).textContent = String(A.nsParts);
    (document.getElementById("nsplay") as HTMLButtonElement).textContent = A.nsPlaying ? "pause" : "play";
    const run = A.nsRun();
    const matches = activePairs(A.nsEvents()).length;
    const prog = document.getElementById("nsprog") as HTMLInputElement;
    prog.max = String(run.length);
    prog.value = String(Math.min(A.nsCursor, run.length));
    (document.getElementById("nspos") as HTMLElement).textContent =
      `${Math.min(A.nsCursor, run.length)}/${run.length} · ${matches} match${matches === 1 ? "" : "es"}`;
    reflectNsProposal();
  }
  (document.getElementById("nsnf") as HTMLInputElement).checked = A.nfOn;
  (document.getElementById("nsnfcontrols") as HTMLElement).style.display = A.nfOn ? "block" : "none";
  if (A.nfOn) {
    (document.getElementById("nsnfth") as HTMLInputElement).value = String(Math.round(A.nfThreshold * 100));
    (document.getElementById("nsnfthv") as HTMLOutputElement).textContent =
      A.nfThreshold > 1 ? "none" : A.nfThreshold.toFixed(2);
    (document.getElementById("nsnfplay") as HTMLButtonElement).textContent = A.nfPlaying ? "pause" : "play";
    const run = A.nfRun();
    const applied = Math.min(A.nfCursor, run.length);
    const prog = document.getElementById("nfprog") as HTMLInputElement;
    prog.max = String(run.length);
    prog.value = String(applied);
    (document.getElementById("nsnfpos") as HTMLElement).textContent =
      `${applied}/${run.length} match${run.length === 1 ? "" : "es"}`;
    reflectNfStats();
  }
  reflectGradeStats();
}
// map-wide grading readout (#137): the previous map's numbers stick
// around as "was N" markers whenever a knob changes the clustering, so
// flipping a heuristic reads as a before/after comparison — including
// the small differences that per-stack captions bury
let gradeCur: { sig: string; chain: string; grade: MapGrade } | null = null;
let gradePrev: MapGrade | null = null;
function reflectGradeStats(): void {
  const box = document.getElementById("gradestats") as HTMLElement;
  if (lens !== 1 || !A.showMistakes) {
    box.innerHTML = "";
    return;
  }
  const chain = active().chain;
  const grade = gradeMap(A.observerModel(), (id) => chain.coins.get(id)!.owner);
  if (!grade) {
    box.innerHTML = `<span class="nshint">no clusters to grade yet</span>`;
    return;
  }
  // the comparison point is the previous MAP on the SAME chain: quiet
  // rerenders keep the before/after on screen, a knob toggle advances
  // it, and time passing resets it — a "was" against yesterday's
  // smaller record would compare nothing meaningful
  const sig = `${A.mapSig()}§${A.matchSig()}`;
  const chainNow = A.chainKey();
  if (!gradeCur || chainNow !== gradeCur.chain) {
    gradeCur = { sig, chain: chainNow, grade };
    gradePrev = null;
  } else if (sig !== gradeCur.sig) {
    gradePrev = gradeCur.grade;
    gradeCur = { sig, chain: chainNow, grade };
  }
  const p = gradePrev ?? undefined;
  const was = (now: number, before: number | undefined): string =>
    before !== undefined && before !== now ? ` (was ${before})` : "";
  const pct = (a: number, b: number): string => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
  const g = grade;
  const gatheredWas = p && pct(p.gathered, p.gatherable) !== pct(g.gathered, g.gatherable)
    ? ` (was ${pct(p.gathered, p.gatherable)})` : "";
  box.innerHTML = `
    <div class="nshint" title="every cluster of two or more coins, graded against the hidden truth. misplaced counts the coins sitting in a cluster whose main owner is someone else — the sum of the per-cluster error counts">
      ${g.stacks} cluster${g.stacks === 1 ? "" : "s"} · ${g.stacked} coins clustered ·
      <b>${g.misplaced} misplaced</b>${was(g.misplaced, p?.misplaced)}</div>
    <div class="nshint" title="a few large clusters tend to dominate as the town grows, so the median and the largest are reported separately — one giant wrong merge reads differently from error spread thin">
      sizes: median ${g.median} · largest ${g.largest}${was(g.largest, p?.largest)},
      holding ${g.misplacedInLargest} of the misplaced${was(g.misplacedInLargest, p?.misplacedInLargest)}</div>
    <div class="nshint" title="of the coins whose true owner holds two or more, the share sitting in that owner's own biggest cluster — the map-wide counterpart of a cluster's 'complete' caption">
      gathered: ${g.gathered} of ${g.gatherable} coins (${pct(g.gathered, g.gatherable)})${gatheredWas}</div>`;
}
// relative-rate bucket labels, matching nsnetflix's FEE_REL_EDGES
const NF_REL_LABELS = ["<0.7×", "0.7–0.85×", "0.85–0.95×", "0.95–1.05×", "1.05–1.2×", "1.2–1.45×", "1.45–2×", "≥2×"];
/** the selected vertex's behavioral fingerprint, summarized */
/** the cluster's loudest 3-hour window, when any spend carries a time */
function hourHint(hours: number[]): string {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return "";
  const h = hours.indexOf(Math.max(...hours));
  return ` · most active ${String(h * 3).padStart(2, "0")}:00–${String(h * 3 + 3).padStart(2, "0")}:00`;
}
function reflectNfStats(): void {
  const box = document.getElementById("nsnfstats") as HTMLElement;
  if (!A.nfActive() || !collapsed || selection?.kind !== "cluster") {
    box.innerHTML = A.nfOn && collapsed
      ? `<span class="nshint">select a vertex to read its fingerprint</span>` : "";
    return;
  }
  const cl = lensClustering();
  const rep = cl.members.has(selection.id) ? selection.id : cl.rep.get(selection.id);
  const st = rep !== undefined ? nfStats(cl, active().chain).get(rep) : undefined;
  if (!st) {
    box.innerHTML = "";
    return;
  }
  const relPeak = st.feeRel.indexOf(Math.max(...st.feeRel));
  const tPeak = st.temporal.indexOf(Math.max(...st.temporal));
  box.innerHTML = st.spends === 0
    ? `<span class="nshint">no spends on record — only receipt evidence</span>`
    : `<span class="nshint">${st.spends} spend${st.spends === 1 ? "" : "s"} · bids ${NF_REL_LABELS[relPeak]} the day's rate · busiest in eighth ${tPeak + 1} of the timeline${hourHint(st.hours)}</span>`;
}
/** the paused-mode examination: two selected vertices, their score, and
 *  the decision — accept (it clears the threshold) or force (it does not) */
function reflectNsProposal(): void {
  const box = document.getElementById("nsproposal") as HTMLElement;
  const pair = nsProposalPair();
  if (!pair) {
    box.innerHTML = NS_MANUAL_OVERRIDE && A.nsSocial && collapsed
      ? `<span class="nshint">select two vertices to examine a pair</span>` : "";
    return;
  }
  const [a, b] = pair;
  const cl = A.observerBase();
  const { comp, membersOf } = matchState(cl, A.nsEvents());
  if (comp.get(a) === comp.get(b)) {
    box.innerHTML = `<span class="nshint">already one vertex — undo to part them</span>`;
    return;
  }
  const score = nsSimilarity(clusterAdjacency(cl, active().chain), comp, membersOf,
    comp.get(a)!, comp.get(b)!);
  const clears = score >= A.nsThreshold;
  box.innerHTML =
    `<span class="nshint">score ${score.toFixed(2)} ${clears ? "≥" : "<"} ${A.nsThreshold > 1 ? "ceiling" : A.nsThreshold.toFixed(2)}</span>
     <button id="nsaccept">${clears ? "accept" : "force"}</button>`;
  document.getElementById("nsaccept")!.addEventListener("click", () => {
    nsMerge(comp.get(a)!, comp.get(b)!, score, !clears);
  });
}
reflectOverlays();
/** the repartition tween every routed handler replays on landing —
 *  matched discs glide together, a retracted link pulls back apart */
function startRepartitionTween(before: { cl: Clustering; clay: ClusterLayout } | null): void {
  if (!before) return;
  const tr: ClusterTransition = {
    t: 0,
    fragments: transitionFragments(before.cl, before.clay, lensClustering()),
      strands: strandGeometry(active().chain, before.cl, before.clay),
  };
  clusterTrans = tr;
  anim.add(900, (t) => { tr.t = t; }, {
    done: () => { if (clusterTrans === tr) clusterTrans = null; },
  });
  kick();
}

function setMistakes(on: boolean): void {
  A.commitKnobs(() => { A.showMistakes = on; }, () => {
    reflectOverlays();
    draw();
    void syncFragment();
  });
}
document.getElementById("mistakes")!.addEventListener("change", (e) => {
  setMistakes((e.target as HTMLInputElement).checked);
});
// a heuristic toggle while the map is contracted repartitions the
// vertices: animate the old discs merging into / splitting out of the
// new ones (purely cosmetic — both endpoints are honestly computed
// partitions, and the tween feeds nothing)
function setOverlays(mask: number): void {
  A.commitKnobs(() => { A.overlays = mask & OV_ALL; }, () => {
    const before = repartitionStart();
    reflectOverlays();
    startRepartitionTween(before);
    recomputeTrace();
    draw();
    void syncFragment();
  });
}
/** tutorial-driven staging of the change/payment identification's
 *  heuristics — the same repartition tween as a checkbox toggle */
function setChangeTells(mask: number): void {
  A.commitKnobs(() => { A.changeTells = mask & TELL_ALL; }, () => {
    const before = repartitionStart();
    reflectOverlays();
    startRepartitionTween(before);
    recomputeTrace();
    draw();
    void syncFragment();
  });
}
/** the shared landing for the live per-notch controls (no tween — the
 *  map re-links in place under the pointer) */
function knobFinishLive(): void {
  reflectOverlays();
  recomputeTrace();
  draw();
  syncFragmentSoon();
}
// the cap slider re-runs the observer's map live; "input" fires per
// notch so dragging shows clusters splitting and re-linking as it moves
document.getElementById("ciohmax")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  A.commitKnobs(() => { A.ciohMax = v; }, knobFinishLive);
});
// the evidence bar re-runs the observer's map live per notch: raising
// it shows change links letting go, coverage traded for caution
document.getElementById("chev")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  A.commitKnobs(() => { A.changeEvidence = v; }, knobFinishLive);
});
// the tell checkboxes re-run the map too; the bar clamps to however
// many kinds remain enabled
for (const [id, bit] of [["chusd", TELL_USD], ["chbtc", TELL_BTC], ["chscript", TELL_SCRIPT], ["chaux", TELL_AUX]] as const) {
  document.getElementById(id)!.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    // the mutate runs on top of any in-flight target, so rapid toggles
    // of different tells compose instead of clobbering each other
    A.commitKnobs(() => {
      A.changeTells = on ? A.changeTells | bit : A.changeTells & ~bit;
    }, knobFinishLive);
  });
}
// --- the knowledge-grant controls. The KYC toggle repartitions the
// contracted map with the same tween as a heuristic toggle; the slider
// re-runs live per notch, so dragging shows names landing and clusters
// fusing as the grant grows.
function setGrants(kx: boolean, ax: number): void {
  A.commitKnobs(() => { A.kycObs = kx; A.auxFrac = ax; }, () => {
    const before = repartitionStart();
    reflectOverlays();
    startRepartitionTween(before);
    recomputeTrace();
    draw();
    void syncFragment();
  });
}
document.getElementById("kycobs")!.addEventListener("change", (e) => {
  setGrants((e.target as HTMLInputElement).checked, A.auxFrac);
});
document.getElementById("auxfrac")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value) / 100;
  A.commitKnobs(() => { A.auxFrac = v; }, knobFinishLive);
});

// --- ns-social controls. Every state change while the map is contracted
// rides the same repartition tween as a heuristic toggle: matched discs
// glide together, a retracted match pulls back apart.
function withNsRepartition(mutate: () => void): void {
  const before = repartitionStart();
  mutate();
  // a merge can absorb the vertex a selection named
  if (selection?.kind === "cluster" && !lensClustering().members.has(selection.id)) {
    selection = null;
    highlight = null;
  }
  if (A.nsSecond !== null && !lensClustering().members.has(A.nsSecond)) A.nsSecond = null;
  startRepartitionTween(before);
  recomputeTrace();
  reflectOverlays();
  draw();
  syncFragmentSoon();
}
function setNsSocial(on: boolean): void {
  if (A.nsSocial === on) return;
  // the knob mutates through the gateway; the cursor pin — which reads
  // the (possibly worker-computed) run — waits for the landing
  A.commitKnobs(() => { A.nsSocial = on; }, () => {
    withNsRepartition(() => {
      if (on) A.nsCursor = A.nsRun().length; // enabling shows the finished analysis
      else nsSetPlaying(false);
      A.nsSecond = null;
    });
    // the landing can race a tutorial camera move: the columns were fit
    // to whatever rect the camera showed at that instant, which a flyTo
    // in flight is about to leave — settle the disagreement by framing
    // the fitted layout (a no-op when the camera never moved)
    if (on && collapsed) flyTo(clusterLayout().bounds);
  }, { nsFull: on });
}
function nsSetPlaying(on: boolean): void {
  A.nsPlaying = on;
  if (A.nsPlayTimer !== null) {
    clearTimeout(A.nsPlayTimer);
    A.nsPlayTimer = null;
  }
  if (on) A.nsPlayTimer = window.setTimeout(nsStep, 100);
  reflectOverlays();
}
function nsStep(): void {
  A.nsPlayTimer = null;
  if (!A.nsPlaying) return;
  if (A.nsCursor >= A.nsRun().length) {
    nsSetPlaying(false);
    return;
  }
  withNsRepartition(() => { A.nsCursor += 1; });
  A.nsPlayTimer = window.setTimeout(nsStep, 1100);
}
// #102: the manual examine/merge flow is parked while the playback
// basics settle — no new proposal can be staged from the canvas. The
// machinery below stays: fragments that recorded manual matches still
// replay them, and the flow returns when the flag flips back.
const NS_MANUAL_OVERRIDE: boolean = false;
/** a decision from the paused examination: merge the two components —
 *  `forced` marks a pair the threshold alone would not admit */
function nsMerge(a: string, b: string, score: number, forced: boolean): void {
  withNsRepartition(() => {
    A.nsManual.push({ kind: "merge", a, b, score, ...(forced ? { forced: true } : {}) });
    A.nsSecond = null;
  });
}
/** the pair under manual examination: the selected cluster and the
 *  second-clicked one, or the last two selected coins' vertices */
function nsProposalPair(): [string, string] | null {
  if (!NS_MANUAL_OVERRIDE || !A.nsActive()) return null;
  if (selection?.kind === "cluster" && A.nsSecond !== null && A.nsSecond !== selection.id) {
    return [selection.id, A.nsSecond];
  }
  if (selection?.kind === "coins" && selection.ids.length >= 2) {
    const cl = lensClustering();
    const a = cl.rep.get(selection.ids[selection.ids.length - 2]!);
    const b = cl.rep.get(selection.ids[selection.ids.length - 1]!);
    if (a !== undefined && b !== undefined && a !== b) return [a, b];
  }
  return null;
}
document.getElementById("nssoc")!.addEventListener("change", (e) => {
  setNsSocial((e.target as HTMLInputElement).checked);
});
// dragging the threshold re-runs the propagation live, discs re-linking
// under the pointer; the cursor stays pinned to the end (skip semantics)
document.getElementById("nsth")!.addEventListener("input", (e) => {
  // read before nsSetPlaying: its reflectOverlays writes the old value back
  const v = Number((e.target as HTMLInputElement).value);
  nsSetPlaying(false);
  A.commitKnobs(() => { A.nsThreshold = v / 100; }, () => {
    withNsRepartition(() => { A.nsCursor = A.nsRun().length; });
  }, { nsFull: true });
});
document.getElementById("nsparts")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  nsSetPlaying(false);
  A.commitKnobs(() => { A.nsParts = v; }, () => {
    withNsRepartition(() => { A.nsCursor = A.nsRun().length; });
  }, { nsFull: true });
});
document.getElementById("nsplay")!.addEventListener("click", () => {
  if (!A.nsPlaying && A.nsCursor >= A.nsRun().length) {
    // replay from the top: matches retract, then land one by one
    withNsRepartition(() => { A.nsCursor = 0; });
  }
  nsSetPlaying(!A.nsPlaying);
});
// #102: the analysis lands finished (setNsSocial pins the cursor to the
// end); this slider rewinds it. Dragging back retracts matches with the
// same repartition tween a replay lands them with, dragging forward
// re-applies them in the algorithm's own order.
document.getElementById("nsprog")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  nsSetPlaying(false);
  withNsRepartition(() => { A.nsCursor = v; });
});

// --- ns-netflix controls: the same repartition tween; playback is the
// greedy ranking landing best-first — no undo, matched vertices are
// never revisited, so there is nothing to go back to
function setNf(on: boolean): void {
  if (A.nfOn === on) return;
  A.commitKnobs(() => { A.nfOn = on; }, () => {
    withNsRepartition(() => {
      if (on) A.nfCursor = A.nfRun().length; // enabling shows the finished run
      else nfSetPlaying(false);
    });
  });
}
function nfSetPlaying(on: boolean): void {
  A.nfPlaying = on;
  if (A.nfPlayTimer !== null) {
    clearTimeout(A.nfPlayTimer);
    A.nfPlayTimer = null;
  }
  if (on) A.nfPlayTimer = window.setTimeout(nfStep, 100);
  reflectOverlays();
}
function nfStep(): void {
  A.nfPlayTimer = null;
  if (!A.nfPlaying) return;
  if (A.nfCursor >= A.nfRun().length) {
    nfSetPlaying(false);
    return;
  }
  withNsRepartition(() => { A.nfCursor += 1; });
  A.nfPlayTimer = window.setTimeout(nfStep, 1100);
}
document.getElementById("nsnf")!.addEventListener("change", (e) => {
  setNf((e.target as HTMLInputElement).checked);
});
// dragging the threshold re-runs the greedy matcher live; the cursor
// stays pinned to the end (skip semantics), and the slider's top is
// past cosine's ceiling — view-only, no matches applied
document.getElementById("nsnfth")!.addEventListener("input", (e) => {
  // read before nfSetPlaying: its reflectOverlays writes the old value back
  const v = Number((e.target as HTMLInputElement).value);
  nfSetPlaying(false);
  A.commitKnobs(() => { A.nfThreshold = v / 100; }, () => {
    withNsRepartition(() => { A.nfCursor = A.nfRun().length; });
  });
});
document.getElementById("nsnfplay")!.addEventListener("click", () => {
  if (!A.nfPlaying && A.nfCursor >= A.nfRun().length) {
    // replay from the top: matches retract, then land best-first
    withNsRepartition(() => { A.nfCursor = 0; });
  }
  nfSetPlaying(!A.nfPlaying);
});
// #102: the greedy run's rewind slider, same semantics as ns-social's
document.getElementById("nfprog")!.addEventListener("input", (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  nfSetPlaying(false);
  withNsRepartition(() => { A.nfCursor = v; });
});
overlaysPanel.addEventListener("change", (e) => {
  const id = (e.target as HTMLElement).id;
  // their own handlers
  if (id === "mistakes" || id === "ciohmax" || id.startsWith("ch") || id.startsWith("ns")) return;
  // no row can vanish from under the pointer: anything checked here was
  // visible, so reflectOverlays already marked it seen
  let mask = 0;
  overlaysPanel.querySelectorAll("input[data-bit]:checked").forEach((el) => {
    mask |= Number((el as HTMLInputElement).dataset["bit"]);
  });
  // the CIOH box reads checked while sub-tx forces it — that forced
  // reading must not overwrite the user's own (possibly off) setting
  if ((A.overlays & OV_SUBSUM) !== 0) mask = (mask & ~OV_CIOH) | (A.overlays & OV_CIOH);
  setOverlays(mask);
});

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement) return; // typing in the seed box
  if (e.key === "v") {
    const cur = currentViewState();
    applyViewState(contracted(cur)
      ? withGrouping(withLayout(cur, cur.arrange), "unclustered")
      : withView(cur, cur.view === "graph" ? "cards" : "graph"));
  }
  if (e.key === "c") {
    const cur = currentViewState();
    applyViewState(contracted(cur)
      ? withGrouping(withLayout(cur, cur.arrange), "unclustered")
      : withGrouping(withLayout(cur, "chord"), "clustered"));
  }
  if (e.key === "o") setLens(((lens + 1) % 3) as 0 | 1 | 2);
  if (e.key === "h") { hideDim = !hideDim; draw(); }
  if (e.key === "r" && forceLayout && collapseT === 0) {
    // re-layout with only the shown nodes: what the hide filter left on
    // screen; with nothing hidden, r restores the full arrangement
    forceShown = hideDim && highlight
      ? new Set([
          ...highlight.full.coins, ...highlight.partial.coins,
          ...highlight.full.txs, ...highlight.partial.txs,
        ])
      : null;
    relayoutGraph();
  }
  if (e.key === "?") keysPanel.style.display = "block";
});
window.addEventListener("keyup", (e) => {
  if (e.key === "?" || e.key === "Shift") keysPanel.style.display = "none";
});
const keysPanel = document.getElementById("keys") as HTMLDivElement;

// --- scene switching + day stepping ---
// the tape's readout, not a control: stepping lives on the transport
// buttons (▶| is "next day" — and "end turn", when a fragment restores
// a played agent)
const dayBtn = document.getElementById("daylabel") as HTMLSpanElement;
function dayLabel(): string {
  if (viewTx !== null) {
    return `day ${cursorDay()} · tx ${viewTx}/${dayTxCount(cursorDay())}`;
  }
  if (rewound()) return `day ${cursorDay()} of ${economy().day}`;
  return `day ${economy().day}`;
}
function setScene(s: 0 | 1, minDay = 0, ride = false): void {
  let rideFrom = -1;
  if (s === 1) {
    // the day the reader was looking at before anything moves
    const before = eco ? cursorDay() : 0;
    economy().runTo(minDay);
    refreshEcoLayouts();
    // a tutorial jump forward replays the days rather than teleporting
    // (#24); anything else snaps the cursor to the exhibit's day — the
    // record is never re-rolled either way
    if (ride && minDay > before) rideFrom = before;
    else if (viewDay !== null && viewDay < minDay) viewDay = null;
    simRev += 1;
  }
  if (scene !== s) {
    scene = s;
    simRev += 1;
    clearSelection();
  }
  if (rideFrom >= 0) rideDays(rideFrom, minDay);
  syncTimebar();
  renderDecisions();
  draw();
}
/** The selection's morphing frame in the active scene, if it has one. */
function selectionRect(): Rect | null {
  if (collapseT > 0) return null;
  const s = active();
  const t = Math.min(1, Math.max(0, viewT));
  if (selection?.kind === "tx") return txRectAt(s.layout, s.bip, selection.id, t);
  if (selection?.kind === "coins" && selection.ids.length > 0) {
    return coinRectAt(s.layout, s.bip, selection.ids[selection.ids.length - 1]!, t);
  }
  return null;
}

let dayGen = 0;
function stepDay(): void {
  // behind the frontier the day is already on record: stepping just
  // reveals it — nothing is re-simulated, the layout does not move.
  // From a freeze-frame the skip first completes the interrupted day.
  if (rewound()) {
    if (viewTx !== null) setViewDay(viewDay);
    else setViewDay(cursorDay() + 1);
    return;
  }
  if (session.manual !== null) harvestChoices();
  // a new day re-lays the whole graph: everything already on screen glides
  // to its new frame (new transactions appear in place), and the selection
  // is held steady on screen throughout the glide
  const before = selectionRect();
  const hold = before
    ? worldToScreen(cam, canvas.clientWidth, canvas.clientHeight,
        before.x + before.w / 2, before.y + before.h / 2)
    : null;
  const prev = ecoScene;
  economy().step();
  simRev += 1;
  refreshEcoLayouts();
  recomputeTrace(); // recompute over the grown chain
  reflectGradeStats(); // re-grade against the grown record
  const target = ecoScene!;
  const holdCam = (): void => {
    if (!hold) return;
    const r = selectionRect();
    if (!r) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    cam = {
      ...cam,
      x: r.x + r.w / 2 - (hold[0] - w / 2) / cam.scale,
      y: r.y + r.h / 2 - (hold[1] - h / 2) / cam.scale,
    };
  };
  if (prev) {
    const gen = ++dayGen; // a day stepped mid-glide takes over from here
    anim.add(650, (t) => {
      if (gen !== dayGen) return;
      ecoScene = t >= 1 ? target : {
        chain: target.chain,
        layout: blendLayout(prev.layout, target.layout, t),
        bip: blendBip(prev.bip, target.bip, t),
      };
      holdCam();
    });
    kick();
  } else {
    holdCam();
  }
  syncTimebar();
  renderCast(); // someone may have moved to town today
  renderDecisions();
  draw();
  void syncFragment();
}

// --- the tape controller (#65, reworked per #74): play/pause both
// directions, track-skip = a day, rewind/fast-forward to the ends of the
// record, and a seek slider. Freeze-frame transaction stepping has no
// buttons of its own any more: slow playback reveals the record one
// transaction at a time by itself ---
const timebar = document.getElementById("timebar") as HTMLDivElement;
const playBtn = document.getElementById("playbtn") as HTMLButtonElement;
const revBtn = document.getElementById("revbtn") as HTMLButtonElement;
const speedBtn = document.getElementById("speedbtn") as HTMLButtonElement;
const daySlider = document.getElementById("dayslider") as HTMLInputElement;
// 1× runs at half a day per second — slow enough to watch the graph grow
const SPEEDS = [0.5, 1, 2, 4]; // days per second
const SPEED_LABELS = ["1×", "2×", "4×", "8×"];
let speedIx = 1;
let playDir: 1 | -1 = 1;
let playTimer: ReturnType<typeof setTimeout> | null = null;
/** keep the slider spanning the recorded days with the cursor on it */
function syncTimebar(): void {
  timebar.style.display = scene === 1 && eco ? "flex" : "none";
  if (!eco) return;
  daySlider.max = String(eco.day);
  daySlider.value = String(cursorDay());
  dayBtn.textContent = dayLabel();
}
function pausePlay(): void {
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = null; }
  playBtn.textContent = "▶";
  revBtn.textContent = "◀";
}
/** at the two slow speeds playback is a freeze-frame film — the record
 *  reveals (or hides) one transaction per tick, a day's transactions
 *  sharing the day's screen time; the fast speeds jump whole days */
function slowPlayback(): boolean {
  return SPEEDS[speedIx]! <= 1;
}
function tickDelay(): number {
  const perDay = 1000 / SPEEDS[speedIx]!;
  return slowPlayback() ? perDay / Math.max(1, dayTxCount(cursorDay())) : perDay;
}
function playTick(): void {
  if (scene !== 1) { pausePlay(); return; }
  const before = `${cursorDay()}/${viewTx}`;
  if (playDir === 1) {
    if (slowPlayback()) frameForward();
    else stepDay();
  } else {
    if (slowPlayback()) frameBack();
    else if (cursorDay() > 0) setViewDay(cursorDay() - 1);
  }
  // reverse play stops at the head of the tape (forward always advances:
  // at the frontier it grows the record)
  if (playDir === -1 && `${cursorDay()}/${viewTx}` === before) { pausePlay(); return; }
  playTimer = setTimeout(playTick, tickDelay());
}
function startPlay(dir: 1 | -1): void {
  pausePlay();
  playDir = dir;
  (dir === 1 ? playBtn : revBtn).textContent = "❚❚";
  playTick();
}
playBtn.addEventListener("click", () => {
  if (playTimer !== null && playDir === 1) { pausePlay(); return; }
  startPlay(1);
});
revBtn.addEventListener("click", () => {
  if (playTimer !== null && playDir === -1) { pausePlay(); return; }
  if (cursorDay() <= 0) return;
  startPlay(-1);
});
speedBtn.addEventListener("click", () => {
  speedIx = (speedIx + 1) % SPEEDS.length;
  speedBtn.textContent = SPEED_LABELS[speedIx]!;
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = setTimeout(playTick, tickDelay()); }
});
// freeze-frame: reveal (or hide) the record one transaction at a time;
// crossing a day boundary lands on the neighbor day's nearest frame.
// No buttons of their own — these are slow playback's tick handlers.
function frameForward(): void {
  if (scene !== 1 || !eco) return;
  const d = cursorDay();
  const n = dayTxCount(d);
  const cur = viewTx ?? n;
  if (cur < n) {
    setViewDay(viewDay, cur + 1);
  } else if (rewound()) {
    const next = d + 1;
    setViewDay(next, dayTxCount(next) > 0 ? 1 : null);
  } else {
    // at the frontier: extend the record a day, then freeze at its start
    stepDay();
    setViewDay(null, dayTxCount(cursorDay()) > 0 ? 1 : null);
  }
}
function frameBack(): void {
  if (scene !== 1 || !eco) return;
  const d = cursorDay();
  const cur = viewTx ?? dayTxCount(d);
  if (cur > 0) {
    setViewDay(viewDay, cur - 1);
  } else if (d > 0) {
    const prev = d - 1;
    const m = dayTxCount(prev);
    setViewDay(prev, m > 0 ? m - 1 : null);
  }
}
document.getElementById("nextday")!.addEventListener("click", () => { pausePlay(); stepDay(); });
document.getElementById("prevday")!.addEventListener("click", () => {
  pausePlay();
  if (scene !== 1 || cursorDay() <= 0) return;
  setViewDay(cursorDay() - 1);
});
document.getElementById("rwbtn")!.addEventListener("click", () => {
  pausePlay();
  if (scene !== 1 || !eco) return;
  setViewDay(0);
});
document.getElementById("ffbtn")!.addEventListener("click", () => {
  pausePlay();
  if (scene !== 1 || !eco) return;
  setViewDay(null);
});
daySlider.addEventListener("input", () => {
  pausePlay(); // a hand on the dial takes over
  if (scene !== 1 || !eco) return;
  setViewDay(Number(daySlider.value));
});

// --- manual play: the decision panel and the played agent. No UI offers
// a takeover any more — the machinery stays so fragments recorded with a
// played agent (`m`/`i`) still restore and replay identically. A proper
// play mode (single-agent privacy survival) is planned to replace it. ---
const decisionsPanel = document.getElementById("decisions")!;
function setManual(u: number | null, from?: number): void {
  if (u !== session.manual) {
    session.manual = u;
    // takeover starts tomorrow (or at the tutorial's target day): the past
    // stays the dice's, so restores replay identically
    session.manualFrom = u === null ? 0 : (from ?? economy().day + 1);
    if (eco) {
      eco.manual = session.manual;
      eco.manualFrom = session.manualFrom;
    }
  }
  renderDecisions();
  draw(); // the HUD names the played agent
  void syncFragment();
}
const TERM_NAMES: Record<string, string> = {
  urgency: "patience", fee: "fee", naive: "the link it writes", hassle: "hassle",
};
const PLAN_NAMES: Record<ManualPlan, string> = {
  wait: "wait", unilateral: "pay now", payjoin: "payjoin",
};
function renderDecisions(): void {
  if (session.manual === null || scene !== 1) {
    decisionsPanel.style.display = "none";
    return;
  }
  const e = economy();
  const cands = e.candidates(session.manual);
  const name = castList()[session.manual]!.name;
  const rows = cands.map((c, i) => {
    const overdue = c.obl.due <= e.day + 1;
    const who = c.obl.payee === null ? "a merchant" : castList()[c.obl.payee]!.name;
    // "wait" is the engine's default; an overdue obligation defaults to a
    // forced payment either way, so only departures get recorded
    const dflt = c.plans.some((p) => p.plan === "wait") ? "wait" : "unilateral";
    const plans = c.plans.map((p) => {
      const funded = p.plan === "wait" ||
        e.canFund(session.manual!, c.obl.usd, c.feerate, p.plan === "payjoin" ? 1 : 0);
      const terms = Object.entries(p.terms)
        .map(([k, v]) => `${TERM_NAMES[k] ?? k} ${v.toFixed(1)}`).join(" + ");
      const checked = p.plan === dflt ? " checked" : "";
      return `<label class="dec-plan"><input type="radio" name="dec${i}" value="${p.plan}"${checked}${funded ? "" : " disabled"}>
        ${PLAN_NAMES[p.plan]} <span class="terms">${funded
          ? `(${terms} = ${p.cost.toFixed(1)})` : "(the wallet can't fund it)"}</span></label>`;
    }).join("");
    return `<div class="dec-row" data-i="${i}" data-default="${dflt}">
      <span class="obl">${c.obl.memo} — $${c.obl.usd} to ${who}</span>
      <span class="due${overdue ? " overdue" : ""}">${overdue ? "overdue" : `due day ${c.obl.due}`}</span>
      ${plans}</div>`;
  }).join("");
  const balance = e.chain.utxos().filter((c) => c.owner === session.manual).reduce((s, c) => s + c.value, 0);
  decisionsPanel.innerHTML = `<h3><span class="who">${name}</span>'s decisions —
    end the turn to lock them in</h3>
    <p class="role">wallet: ${fmtSats(balance)} sats</p>${rows ||
    `<p class="role">nothing pending — end the turn and the town moves on</p>`}`;
  decisionsPanel.style.display = "block";
}
/** read the panel's radio choices and record them for the coming day */
function harvestChoices(): void {
  const e = economy();
  const cands = e.candidates(session.manual!);
  decisionsPanel.querySelectorAll(".dec-row").forEach((row) => {
    const i = Number((row as HTMLElement).dataset["i"]);
    const c = cands[i];
    if (!c) return;
    const pick = (row.querySelector("input:checked") as HTMLInputElement | null)?.value as ManualPlan | undefined;
    // only departures from the engine's default behavior are recorded
    if (!pick || pick === (row as HTMLElement).dataset["default"]) return;
    session.interventions.push({ day: e.day + 1, id: c.obl.id, plan: pick });
  });
}

// --- selection: click to trace; clicking more coins traces them together ---
// Joint traces are per-lens (analysis/trace.ts): the union of the traced
// coins' light cones is partly lit, and what the lens's knowledge singles
// out is fully lit — the true flow of funds under the all-seeing lens,
// the cluster-wise Goldfeder intersection under the observer, the
// coin-wise intersection otherwise. The rest is dimmed (or hidden).
function clearSelection(): void {
  selection = null;
  highlight = null;
  A.nsSecond = null;
  if (A.nfOn) reflectOverlays(); // the fingerprint readout empties
}
function recomputeTrace(): void {
  if (!selection) {
    highlight = null;
    return;
  }
  const s = active();
  // the observer's candidate sets read the fused model — the same
  // partition the lens draws, grants and matches compounded (#124)
  const opts = lens === 0 ? { truth: true } : lens === 1 ? { cl: A.observerModel() } : {};
  if (selection.kind === "coins") {
    const live = selection.ids.filter((id) => s.chain.coins.has(id));
    highlight = live.length > 0 ? traceCoins(s.chain, live, opts) : null;
  } else if (selection.kind === "tx") {
    highlight = s.chain.txs.has(selection.id) ? traceTx(s.chain, selection.id, opts) : null;
  } else {
    // cluster: its member coins and the transactions that spend them
    const members = new Set(lensClustering().members.get(selection.id) ?? []);
    const txs = new Set<string>();
    for (const tid of s.chain.order) {
      if (s.chain.txs.get(tid)!.inputs.some((c) => members.has(c))) txs.add(tid);
    }
    highlight = { full: { coins: members, txs }, partial: { coins: members, txs } };
  }
}
function applySelection(hit: Hit): void {
  if (hit.kind === "coin") {
    // plain click toggles the coin in the joint trace
    const ids = selection?.kind === "coins" ? [...selection.ids] : [];
    const at = ids.indexOf(hit.id);
    if (at >= 0) ids.splice(at, 1);
    else ids.push(hit.id);
    selection = ids.length > 0 ? { kind: "coins", ids } : null;
  } else if (hit.kind === "cluster" && NS_MANUAL_OVERRIDE && A.nsActive() && collapsed &&
      selection?.kind === "cluster" && selection.id !== hit.id) {
    // ns-social paused examination: the second vertex completes a
    // proposal (clicking the same second vertex again withdraws it)
    A.nsSecond = A.nsSecond === hit.id ? null : hit.id;
    reflectOverlays();
  } else if (selection?.kind === hit.kind && selection.id === hit.id) {
    selection = null; // clicking the selected tx/cluster again deselects
    A.nsSecond = null;
  } else {
    selection = { kind: hit.kind, id: hit.id };
    A.nsSecond = null;
    if (hit.kind === "cluster" && lens === 0) {
      // under the all-seeing lens a cluster IS a person: open their profile
      const o = active().chain.coins.get(hit.id)?.owner;
      if (o !== null && o !== undefined) openInspector(o);
    }
  }
  recomputeTrace();
  // the fingerprint readout follows the selection
  if (A.nfOn) reflectOverlays();
}

/** hit-test whatever the current view phase shows */
function hitAt(wx: number, wy: number): Hit | null {
  const s = active();
  if (collapseT > 0.5) {
    const rep = hitTestClusters(clusterLayout(), wx, wy);
    return rep ? { kind: "cluster", id: rep } : null;
  }
  if (collapseT > 0) return null; // mid-collapse: nothing stable to hit
  return hitTestMorph(s.chain, s.layout, s.bip, viewT, wx, wy);
}

// --- animation loop ---
let rafLive = false;
function kick(): void {
  if (rafLive) return;
  rafLive = true;
  const frame = (now: number): void => {
    // a throw mid-frame must not leave rafLive latched true with the
    // loop dead — that silently bricks every animation for the rest of
    // the session. Keep driving while tweens remain (a transient draw
    // failure resolves when the state it raced settles) and let the
    // exception surface on the console either way.
    let more = false;
    try {
      more = anim.tick(now);
      draw();
    } catch (e) {
      more = anim.active;
      throw e;
    } finally {
      if (more) requestAnimationFrame(frame);
      else rafLive = false;
    }
  };
  requestAnimationFrame(frame);
}

/** the screen area the tutorial panel leaves unobscured: the largest of
 * the four rectangles left by cutting the panel's box out of the canvas.
 * A focus should center in what remains of the view area, not the view
 * area as a whole — on a phone the panel can cover half the screen, and
 * a focus centered under it is a focus the reader cannot see. */
function visibleViewport(): { x: number; y: number; w: number; h: number } {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const full = { x: 0, y: 0, w, h };
  const panel = document.getElementById("tutorial");
  if (!panel || panel.style.display === "none") return full;
  const cb = canvas.getBoundingClientRect();
  const pb = panel.getBoundingClientRect();
  const left = pb.left - cb.left, top = pb.top - cb.top;
  const right = pb.right - cb.left, bottom = pb.bottom - cb.top;
  const cuts = [
    { x: 0, y: 0, w: Math.min(w, Math.max(0, left)), h },
    { x: 0, y: 0, w, h: Math.min(h, Math.max(0, top)) },
    { x: Math.min(w, Math.max(0, right)), y: 0, w: Math.max(0, w - right), h },
    { x: 0, y: Math.min(h, Math.max(0, bottom)), w, h: Math.max(0, h - bottom) },
  ];
  let best = full, bestA = 0;
  for (const r of cuts) {
    const a = r.w * r.h;
    if (a > bestA) { best = r; bestA = a; }
  }
  // squeezing the world into a sliver is worse than sharing space
  return bestA < w * h * 0.25 ? full : best;
}

/** Animate the camera to frame a world rect with some margin. */
let pendingFly: { rect: Rect; ms: number } | null = null;
/** the destination of a camera fly in flight — visibleWorldRect()
 *  treats it as where the camera already is */
let flyCam: Camera | null = null;
function flyTo(rect: Rect, ms = 700): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w <= 0 || h <= 0) {
    pendingFly = { rect, ms };
    return;
  }
  const vp = visibleViewport();
  const scale = Math.min(80, Math.max(0.05, Math.min(vp.w / rect.w, vp.h / rect.h)));
  const target: Camera = {
    // cam.x/y is the world point at CANVAS center; steer the rect's
    // center to the unobscured region's center instead
    x: rect.x + rect.w / 2 - (vp.x + vp.w / 2 - w / 2) / scale,
    y: rect.y + rect.h / 2 - (vp.y + vp.h / 2 - h / 2) / scale,
    scale,
  };
  const from = { ...cam };
  flyCam = target;
  anim.add(ms, (t) => {
    cam = {
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
      scale: Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * t),
    };
  }, { done: () => {
    if (flyCam === target) flyCam = null;
    void syncFragment();
  } });
  kick();
}

function playPing(wx: number, wy: number, pulses = 3): void {
  ping = { wx, wy, t: 0 };
  anim.add(950, (t) => { if (ping) ping.t = t; }, {
    ease: easeOutQuad,
    done: () => {
      ping = null;
      if (pulses > 1) playPing(wx, wy, pulses - 1);
    },
  });
  kick();
}

// --- tutorial ---
/** the payjoin chapter's exhibit (see selectPayjoinExhibit), computed
 *  against the VISIBLE chain so rewinding stays honest. Sticky: once the
 *  chosen exhibit detects, a later payjoin must not swap the exhibit
 *  under the reader mid-chapter. */
let pjCache: { rev: number; tid: string | undefined } | null = null;
function payjoinExhibit(): string | undefined {
  if (scene !== 1 || !eco) return undefined;
  if (pjCache && pjCache.rev === simRev) return pjCache.tid;
  const s = active();
  const price = (d: number): number | undefined => eco!.prices[d];
  const prev = pjCache?.tid;
  const tid = prev !== undefined && s.chain.txs.has(prev)
      && detectionFires(payjoinDetection(s.chain, price, prev))
    ? prev
    : selectPayjoinExhibit(eco.events, s.chain, price);
  pjCache = { rev: simRev, tid };
  return tid;
}
/** what the rest of the visible record says about the exhibit's inputs */
function payjoinExhibitDetection(): PayjoinDetection | undefined {
  const tid = payjoinExhibit();
  if (tid === undefined || !eco) return undefined;
  return payjoinDetection(active().chain, (d) => eco!.prices[d], tid);
}
const steps = [
  ...introSteps(intro.layout, intro.bip),
  ...economySteps(() => {
    const s = active();
    return targetView === 1 ? s.bip.bounds : { x: s.layout.bounds.x, y: s.layout.bounds.y, w: s.layout.bounds.w, h: s.layout.bounds.h };
  }),
  ...observerSteps(() => active().bip.bounds, () => clusterLayout().bounds),
  ...payjoinSteps(
    () => active().bip.bounds,
    () => {
      // frame the first payjoin transaction (there is one by minDay 35) in
      // whichever view the step just asked for; prefer a 2-input one so
      // the step prose matches on every seed
      const s = active();
      const tid = payjoinExhibit();
      const r = tid ? txRectAt(s.layout, s.bip, tid, targetView) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 }
        : targetView === 1 ? s.bip.bounds : s.layout.bounds;
    },
    payjoinExhibit,
    payjoinExhibitDetection,
    () => {
      const tid = payjoinExhibit();
      return tid ? inputFamilies(active().chain, tid) : [];
    },
  ),
  ...nsNetflixSteps(
    () => clusterLayout().bounds,
    () => ({ matches: A.nfRun().length, threshold: A.nfThreshold }),
  ),
  ...settlementSteps(
    () => active().bip.bounds,
    () => {
      // frame the first settlement (there is one by minDay 60) in
      // whichever view the step asked for; prefer a three-party one so
      // the chapter's arithmetic plays out on screen
      const s = active();
      const ev = firstSettlement();
      const r = ev ? txRectAt(s.layout, s.bip, ev.tid, targetView) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 }
        : targetView === 1 ? s.bip.bounds : s.layout.bounds;
    },
    () => firstSettlement()?.payer,
    () => {
      const ev = firstSettlement();
      return ev ? settlementVerdict(eco!.chain, ev.tid) : undefined;
    },
  ),
  ...nsSocialSteps(
    () => clusterLayout().bounds,
    () => ({ matches: A.nsRun().length, parts: A.nsParts }),
  ),
  ...coinjoinSteps(
    () => active().bip.bounds,
    () => {
      // the careless first attempt (day 90), in the step's chosen view
      const s = active();
      const r = eco?.naiveTid ? txRectAt(s.layout, s.bip, eco.naiveTid, targetView) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 }
        : targetView === 1 ? s.bip.bounds : s.layout.bounds;
    },
    () => {
      // a denominated session, framed in whichever view the step asked for
      const s = active();
      const tid = denseCoinjoin();
      const r = tid ? txRectAt(s.layout, s.bip, tid, targetView) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 }
        : targetView === 1 ? s.bip.bounds : s.layout.bounds;
    },
    () => {
      const tid = denseCoinjoin();
      const first = tid ? eco?.chain.txs.get(tid)?.inputs[0] : undefined;
      const owner = first ? eco?.chain.coins.get(first)?.owner : undefined;
      return owner ?? undefined;
    },
    () => remeetView(),
    () => {
      // both sessions and the re-met coins between them, in one frame
      const x = remeetView();
      return x ? traceBounds(x.coins, [x.tid, x.via]) : active().bip.bounds;
    },
  ),
  ...intersectionSteps(
    () => active().bip.bounds,
    () => freshOriginExhibit()?.coin,      // fresh out of the dense session (#104)
    () => freshOriginExhibit()?.clusters,  // faces on the board, in one frame
    () => m5Moments().coin,   // a coinjoined coin worth tracing
    () => m5Moments().cross,  // a spend linking two sessions' pasts
    () => m5Moments().toxic,  // coinjoin change spent beside a mixed coin
    auxGrantExhibit,          // "suppose one name falls": grant + computed decay
  ),
  ...synthesisSteps(
    () => active().bip.bounds,
    () => clusterLayout().bounds,     // the view-2 beats frame the collapsed map
    () => txRect(eco?.naiveTid),      // the elimination beat's exhibit
    () => synthExhibits().claim,
    () => eco?.naiveTid,
    () => (eco ? rentForms(eco.events) : new Map()),
    () => synthExhibits().sweep,
    () => (eco ? counterpartyExhibit(eco.chain, eco.events, 7, 9) : undefined),
    (i) => castList()[i]?.name ?? "someone",
  ),
  ...gameSteps(
    () => active().bip.bounds,
    () => gameSettlement(),   // the settlement that pays the played rent
  ),
];
function txRect(tid: string | undefined): Rect {
  const s = active();
  const r = tid ? s.bip.txs.get(tid) : undefined;
  return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 } : s.bip.bounds;
}
function denseCoinjoin(): string | undefined {
  return eco ? selectDenseCoinjoin(eco.coinjoins, eco.naiveTid ?? undefined) : undefined;
}
// the repeated-co-membership exhibit (#105): the finder re-runs the
// sub-transaction search per candidate session, so it is cached per
// grown chain like the chapter-7 moments
let remeetCache: { rev: number; ex?: RemeetExhibit } | null = null;
function remeetView(): RemeetExhibit | undefined {
  const chain = eco?.chain;
  if (!chain) return undefined;
  if (remeetCache && remeetCache.rev === simRev) return remeetCache.ex;
  remeetCache = {
    rev: simRev,
    ex: remeetExhibit(chain, (id) => chain.coins.get(id)?.owner ?? null),
  };
  return remeetCache.ex;
}
/** bounding box over a set of coins and txs in the bipartite layout */
function traceBounds(coins: Iterable<string>, txs: Iterable<string>): Rect {
  const s = active();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const eat = (r: Rect | undefined): void => {
    if (!r) return;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  };
  for (const c of coins) eat(s.bip.coins.get(c));
  for (const t of txs) eat(s.bip.txs.get(t));
  if (x0 > x1) return s.bip.bounds;
  return { x: x0 - 120, y: y0 - 120, w: x1 - x0 + 240, h: y1 - y0 + 240 };
}

/** chapter 7's opening exhibit (#104): a denominated output of the dense
 *  session, one step old — its immediate candidates are the session's
 *  own input clusters, countable inside the coinjoin chapter's frame.
 *  Cluster count reads the live observer map (grants compounded), so
 *  the step displays whatever the current map actually says. */
function freshOriginExhibit(): { coin: Focused; clusters: number } | undefined {
  const chain = eco?.chain;
  const tid = denseCoinjoin();
  if (!chain || !tid) return undefined;
  const cl = A.observerBase();
  const hit = freshOrigin(chain, (id) => cl.rep.get(id) ?? id, tid);
  if (!hit) return undefined;
  return { coin: { id: hit.out, rect: txRect(tid) }, clusters: hit.clusters };
}

// --- chapter 7: its three moments. The linking spend is injected on
// INTERSECT_DAY (economy.intersectSpend), so it exists on every seed;
// the toxic-change spend arises naturally by day ~105 (probed across
// seeds). Rects frame the whole traced past, not just the vertex.
let m5Cache: { rev: number; coin?: Focused; cross?: Focused; toxic?: Focused } | null = null;
function m5Moments(): { coin?: Focused; cross?: Focused; toxic?: Focused } {
  const chain = eco?.chain;
  if (!chain) return {};
  if (m5Cache && m5Cache.rev === simRev) return m5Cache;
  const sessions = new Set(eco!.coinjoins.keys());
  const found: typeof m5Cache = { rev: simRev };
  const slip = eco!.events.find((e) => e.memo === "tidying up the wallet");
  if (slip && chain.txs.has(slip.tid)) {
    const t = traceTx(chain, slip.tid);
    found.cross = { id: slip.tid, rect: traceBounds(t.partial.coins, t.partial.txs) };
    const cid = chain.txs.get(slip.tid)!.inputs[0]!;
    const a = ancestry(chain, cid);
    found.coin = { id: cid, rect: traceBounds(a.coins, a.txs) };
  }
  for (const tid of chain.order) {
    if (found.toxic) break;
    const tx = chain.txs.get(tid)!;
    if (tx.inputs.length < 2 || sessions.has(tid)) continue;
    const hasChange = tx.inputs.some((c) => chain.coins.get(c)!.label === "coinjoin change");
    const hasMixed = tx.inputs.some((c) => {
      const coin = chain.coins.get(c)!;
      return coin.label !== "coinjoin change" && coin.producer !== null && sessions.has(coin.producer);
    });
    if (hasChange && hasMixed) {
      const t = traceTx(chain, tid);
      found.toxic = { id: tid, rect: traceBounds(t.partial.coins, t.partial.txs) };
    }
  }
  m5Cache = found;
  return found;
}

// --- chapter 7's aux-info exhibit: "suppose one name falls". Truth is
// used ONLY to construct the grant (which coins are U's — the disclosed
// assumption) and to stage the choice of U (prefer a fracture, skip the
// traced coin's own owner: an "auxiliary" user is by definition not the
// target). auxInfoDecay then runs blind on the public graph.
let auxCache: { rev: number; hit?: AuxGrant } | null = null;
function auxGrantExhibit(): AuxGrant | undefined {
  const chain = eco?.chain;
  const coin = m5Moments().coin;
  if (!chain || !coin) return undefined;
  if (auxCache && auxCache.rev === simRev) return auxCache.hit;
  auxCache = { rev: simRev };
  const target = chain.coins.get(coin.id)!.owner;
  const coinsOf = new Map<number, Set<string>>();
  for (const [id, c] of chain.coins) {
    if (c.owner === null || c.owner === target) continue;
    const s = coinsOf.get(c.owner);
    if (s) s.add(id);
    else coinsOf.set(c.owner, new Set([id]));
  }
  // prefer a fracturing grant (the multiplicative branch lands hardest
  // live); among equals, the one that eliminates the most candidates
  const score = (d: AuxDecay): number => (d.fractured > 0 ? 1000 : 0) + d.fractured + d.granted;
  let best: AuxGrant | undefined;
  for (const [u, granted] of coinsOf) {
    const decay = auxInfoDecay(chain, coin.id, granted);
    if (decay.granted === 0) continue; // a name with no stake teaches nothing
    if (!best || score(decay) > score(best.decay)) best = { name: castList()[u]!.name, decay };
  }
  auxCache.hit = best;
  return best;
}

// --- chapter 8: the settlement that pays the played rent. The GAME_DAY
// cycle (rent, shelves, catalogue) settles by GAME_DAY+3 on every seed
// when Judy waits (probed); the finder frames its whole traced past.
let m6Cache: { rev: number; hit?: Focused } | null = null;
function gameSettlement(): Focused | undefined {
  const chain = eco?.chain;
  if (!chain) return undefined;
  if (m6Cache && m6Cache.rev === simRev) return m6Cache.hit;
  m6Cache = { rev: simRev };
  const ev = eco!.events.find((e) =>
    e.form === "settlement" && e.payer === 9 && e.memo === "studio rent" && e.day >= GAME_DAY);
  if (ev && chain.txs.has(ev.tid)) {
    const t = traceTx(chain, ev.tid);
    m6Cache.hit = { id: ev.tid, rect: traceBounds(t.partial.coins, t.partial.txs) };
  }
  return m6Cache.hit;
}

function firstSettlement(): { tid: string; payer: number } | undefined {
  return eco ? selectSettlementExhibit(eco.events, eco.chain) : undefined;
}

// --- chapter 8: the synthesis exhibits. The claim is two same-owner
// inputs of the careless coinjoin (staged: truth picks the pair, the
// observer's map supplies the support and the elimination test); the
// sweep is the staged N–S propagation run whose one acceptance grades
// false against latent truth (verified across the tutorial seeds).
// Both re-derive per sim revision; the sweep is the pricey one.
let synthCache: { rev: number; claim?: ClaimExhibit; sweep?: SweepView } | null = null;
// #104: the synthesis map steps spotlight the sweep's cast on the
// collapsed board — the full cluster graph alone is too busy to read
// the story off. 1 = seeds and the aux edges between them ("Two maps
// and a few names"), 2 = the sweep's acceptance joins ("One sweep").
let synthSpot: 0 | 1 | 2 = 0;
function synthExhibits(): { claim?: ClaimExhibit; sweep?: SweepView } {
  if (!eco) return {};
  if (synthCache && synthCache.rev === simRev) return synthCache;
  const chain = eco.chain;
  const price = (d: number): number | undefined => eco!.prices[d];
  const cl = clusterObserver(chain, price);
  const found: typeof synthCache = { rev: simRev };
  if (eco.naiveTid) found.claim = claimExhibit(chain, cl, price, eco.naiveTid);
  const ownerOf = (id: string): number | null => chain.coins.get(id)?.owner ?? null;
  const agents = eco.cast.map((_, i) => i);
  const ex = synthesisSweepExhibit(chain, cl, eco.edges, agents, ownerOf);
  if (ex.result.verdicts.length > 0) {
    const count = (r: string): number =>
      ex.result.verdicts.filter((v) => v.outcome.kind === "abstained" && v.outcome.reason === r).length;
    const nameOf = (a: string): string => castList()[Number(a)]?.name ?? `agent ${a}`;
    found.sweep = {
      seedCount: ex.seeds.size,
      examined: ex.result.verdicts.length,
      noSignal: count("no-signal"),
      belowThreshold: count("below-threshold"),
      reverseMismatch: count("reverse-mismatch"),
      acceptedCount: ex.result.accepted.size,
      pseudonyms: [...cl.members.values()].filter((m) => m.length >= 2).length,
      agents: agents.length,
      knownEdges: outsiderEdges(eco.edges, 300).length,
      allEdges: eco.edges.length,
      featured: ex.featured === undefined ? undefined : (() => {
        const owner = clusterOwner(cl, ex.featured!.node, ownerOf);
        return {
          cluster: clusterLabel(cl, ex.featured!.node) || "a cluster",
          agent: nameOf(ex.featured!.agent),
          eccentricity: ex.featured!.eccentricity,
          grade: ex.featured!.grade,
          trueOwner: owner === null ? null : castList()[owner]?.name ?? null,
        };
      })(),
      board: (() => {
        const mapped = new Map<string, string>([...ex.seeds, ...ex.result.accepted]);
        const knows = new Set<string>();
        for (const e of outsiderEdges(eco.edges, 300)) {
          knows.add(`${e.payer}:${e.payee}`);
          knows.add(`${e.payee}:${e.payer}`);
        }
        const reps = [...mapped.keys()];
        const auxPairs: [string, string][] = [];
        for (let i = 0; i < reps.length; i++)
          for (let j = i + 1; j < reps.length; j++)
            if (knows.has(`${mapped.get(reps[i]!)}:${mapped.get(reps[j]!)}`))
              auxPairs.push([reps[i]!, reps[j]!]);
        return {
          seeds: [...ex.seeds].map(([rep, a]) => ({ rep, name: nameOf(a) })),
          accepted: [...ex.result.accepted].map(([rep, a]) => ({ rep, name: nameOf(a) })),
          auxPairs,
        };
      })(),
    };
  }
  synthCache = found;
  return found;
}
// the tour's last step frames the whole graph — far too small to act on.
// When the learner presses "done ✓" the town is theirs, so hand it over
// framed on something readable: the most recent transactions (or the
// cluster graph's bounds when collapsed)
function readableHandoff(): void {
  if (collapseT > 0) {
    flyTo(clusterLayout().bounds);
    return;
  }
  const s = active();
  const recent = s.chain.order.slice(-3);
  let r: Rect | null = null;
  for (const tid of recent) {
    const f = txRectAt(s.layout, s.bip, tid, Math.min(1, Math.max(0, viewT)));
    if (!f) continue;
    if (r === null) {
      r = { ...f };
    } else {
      const x = Math.min(r.x, f.x), y = Math.min(r.y, f.y);
      r = { x, y, w: Math.max(r.x + r.w, f.x + f.w) - x, h: Math.max(r.y + r.h, f.y + f.h) - y };
    }
  }
  const b = r ?? s.layout.bounds;
  flyTo({ x: b.x - 120, y: b.y - 120, w: b.w + 240, h: b.h + 240 });
}

const tutorial = new Tutorial(steps, {
  onFocus: (focus) => flyTo(focus),
  onDone: () => {
    allRowsSeen = true; // the town is theirs — the whole panel with it
    reflectOverlays();
    reflectStagedWidgets();
    readableHandoff();
  },
  // leaving the tour hands over the full toolbox: every heuristic on
  // the panel and running, and the town itself — skipping from the
  // intro must not leave the time controls hidden with the cards scene
  onSkip: () => {
    allRowsSeen = true;
    reflectStagedWidgets();
    synthSpot = 0; // leaving mid-chapter must not strand the spotlight
    setScene(1, eco ? economy().day : 0);
    setOverlays(OV_ALL);
    if (A.changeTells !== TELL_ALL) setChangeTells(TELL_ALL);
    if (A.grantsOn()) setGrants(false, 0); // the dial is the player's to turn
    readableHandoff();
  },
  onStepChange: (index) => {
    // walked-path row marks, computed from the steps themselves: every
    // row a lens-1 step up to here ran (or `reveals`) stays visible
    // from then on. The marks cannot be read off the live knobs — a
    // step's changes route through the analysis worker as separate
    // commits, so mid-flight one commit's value pairs with another's
    // still pending and rows the story has not introduced yet would
    // read as running
    let ov = 3, ct = TELL_ALL, kyc = 0, aux = 0, nf = false, ns = false, mi = false;
    for (let i = 0; i <= index; i++) {
      const s = steps[i];
      if (!s) continue;
      if (s.overlays !== undefined) ov = s.overlays;
      if (s.changeTells !== undefined) ct = s.changeTells;
      if (s.grants !== undefined) [kyc, aux] = s.grants;
      if (s.nf !== undefined) nf = s.nf;
      if (s.ns !== undefined) ns = s.ns;
      if (s.mi !== undefined) mi = s.mi;
      for (const r of s.reveals ?? []) seenRows.add(r as PanelRow);
      if (s.lens !== 1) continue;
      const eo = (ov & OV_SUBSUM) !== 0 ? ov | OV_CIOH : ov;
      if ((eo & OV_REUSE) !== 0) seenRows.add("reuse");
      if ((eo & OV_CIOH) !== 0) seenRows.add("cioh");
      if ((eo & OV_SUBSUM) !== 0) seenRows.add("subsum");
      if ((eo & OV_REMEET) !== 0) seenRows.add("remeet");
      if ((eo & OV_CHANGE) !== 0) {
        seenRows.add("change");
        if ((ct & TELL_USD) !== 0) seenRows.add("chusd");
        if ((ct & TELL_BTC) !== 0) seenRows.add("chbtc");
        if ((ct & TELL_SCRIPT) !== 0) seenRows.add("chscript");
        if ((ct & TELL_AUX) !== 0) seenRows.add("chaux");
      }
      if (kyc !== 0 || aux > 0) seenRows.add("kyc");
      if (aux > 0) seenRows.add("aux");
      if (nf) seenRows.add("nsnf");
      if (ns) seenRows.add("nssoc");
      if (mi) seenRows.add("grading");
    }
    reflectOverlays();
    // staged controls follow the same prefix scan; the set only grows,
    // so walking back never hides a control already introduced
    for (const w of widgetRevealsAt(steps, index)) seenWidgets.add(w);
    reflectStagedWidgets();
    // #104: the synthesis map steps get their spotlight (seeds first,
    // the sweep's acceptances one step later); any other step clears it
    const cur = steps[index];
    synthSpot = cur?.id === "two-maps-and-a-few-names" ? 1
      : cur?.id === "one-sweep" ? 2 : 0;
    // the hide filter ("h") outlives selections; combined with a step
    // that keeps the prior selection it can hide the very transaction
    // the step is framing — a step landing always lifts it
    if (hideDim) hideDim = false;
    void syncFragment();
  },
  onView: (view) => {
    // step "view 2" means the graph flattened into the clustered ring;
    // "view 3" the same ring held at the lattice bottom — the
    // singleton ring, nothing stacked (#95). The executor settles the
    // grouping before a contraction forms (the morph flies straight to
    // its final ring) and runs in-map changes as repartition tweens.
    applyViewState(viewFromStep(view));
  },
  onLens: (l, a) => {
    if (l === 2) lensAgent = a ?? defaultLensAgent(); // step's pick, else the payjoin payee
    if (l !== lens || l === 2) setLens(l);
  },
  onOverlays: (ov) => {
    if (ov !== A.overlays) setOverlays(ov);
  },
  onChangeTells: (ct) => {
    if (ct !== A.changeTells) setChangeTells(ct);
  },
  onGrants: (kyc, aux) => {
    if ((kyc === 1) !== A.kycObs || aux / 100 !== A.auxFrac) setGrants(kyc === 1, aux / 100);
  },
  onNf: (on) => setNf(on),
  onNs: (on) => setNsSocial(on),
  onMi: (on) => { if (A.showMistakes !== on) setMistakes(on); },
  onScene: (s, minDay) => setScene(s, minDay, true),
  onSelect: (sel) => {
    if (sel === null) clearSelection();
    else applySelection(sel);
    draw();
  },
});

// --- cast panel + inspector ---
const castBtn = document.getElementById("castbtn") as HTMLButtonElement;
const castPanel = document.getElementById("cast")!;
function renderCast(): void {
  // the panel is the town as it stands on the displayed day: people who
  // haven't moved in yet aren't listed (they arrive on chain, in view)
  const day = scene === 1 && eco ? cursorDay() : 0;
  castPanel.innerHTML = castList().map((p, u) =>
    (p.arrives ?? 0) > day ? "" :
    `<div class="cast-row" data-u="${u}">
      <span class="swatch" style="background:${ownerColor(u)}"></span>
      <b>${p.name}</b> <span class="role">${p.role}</span>
    </div>`).join("");
}
renderCast();
castBtn.addEventListener("click", () => {
  const open = getComputedStyle(castPanel).display !== "none";
  if (!open) {
    renderCast(); // the town may have grown since page load
    paramsPanel.style.display = "none"; // the two share the left edge
  }
  castPanel.style.display = open ? "none" : "block";
  if (open) inspector.style.display = "none";
});
const inspector = document.getElementById("inspector")!;
/** the cast member the inspector currently profiles (for its buttons) */
let inspectorUser: number | null = null;
function openInspector(u: number): void {
  inspectorUser = u;
  const p = castList()[u]!;
  const chain = active().chain;
  // every coin this person ever held, newest first; the spent stay
  // listed (dimmed) — a wallet's history, not just its present
  const dayOf = (c: { producer: string | null; entered?: number }): number =>
    c.producer ? chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  const coins = [...chain.coins.values()]
    .filter((c) => c.owner === u)
    .sort((a, b) => dayOf(b) - dayOf(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const utxos = coins.filter((c) => c.dest === null);
  const total = utxos.reduce((s, c) => s + c.value, 0);
  inspector.innerHTML = `
    <div class="tut-head"><span class="tut-title">
      <span class="swatch" style="background:${ownerColor(u)}"></span> ${p.name}</span>
      <span class="tut-progress">${p.role}${u === CARELESS ? " ⚠" : ""}</span></div>
    <p>${p.concern}</p>
    <p class="role" title="${walletOf(p).pitch} — fingerprint: ${walletOf(p).tell}">runs
      <b>${walletOf(p).name}</b>${p.walletBefore !== undefined
        ? ` (moved from <b>${WALLETS[p.walletBefore]!.name}</b> — the old savings still sit on its addresses)`
        : ""}${p.walletWhy ? ` — ${p.walletWhy}` : ""}</p>
    <p class="role">wallet: ${utxos.length} coin${utxos.length === 1 ? "" : "s"}, ${fmtSats(total)} sats
      <button id="traceall" class="chip-btn">trace all coins</button></p>
    <div class="coinlist">${coins.map((c) => {
      const d = dayOf(c);
      const when = d < 0 ? "savings" : `day ${d}`;
      // the address each coin is locked to; one appearing twice in this
      // list is reuse, the linkage that needs no inference — flag it
      const shared = c.addr !== undefined &&
        coins.filter((o) => o.addr && addrKey(o.addr) === addrKey(c.addr!)).length > 1;
      const addr = c.addr
        ? ` · <span title="${c.addr.branch === "internal" ? "change branch" : "receive branch"}, index ${c.addr.index}${shared ? " — REUSED: every coin on this address is linked on the face of the record" : ""}">${addrText(c.addr)}${shared ? " ⟲" : ""}</span>`
        : "";
      return `<div class="coinrow${c.dest ? " spentrow" : ""}" data-c="${c.id}">
        <span class="coin-chip" style="background:${ownerColor(u)}">${fmtSats(c.value)}</span>
        <span class="role">${when}${c.label ? ` · ${c.label}` : ""}${addr}${c.dest ? " · spent" : ""}</span>
      </div>`;
    }).join("")}</div>`;
  inspector.style.display = "block";
}
castPanel.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest(".cast-row") as HTMLElement | null;
  if (!row) return;
  const u = Number(row.dataset["u"]);
  if (lens === 2 && lensAgent !== u) {
    lensAgent = u;
    setLens(2); // relabel the button, repaint through the new agent's eyes
  }
  openInspector(u);
});
inspector.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.id === "traceall" && inspectorUser !== null) {
    // trace this person's whole cluster: every coin they ever held
    const u = inspectorUser;
    const ids = [...active().chain.coins.values()].filter((c) => c.owner === u).map((c) => c.id);
    selection = ids.length > 0 ? { kind: "coins", ids } : null;
    recomputeTrace();
    draw();
    return;
  }
  const row = t.closest(".coinrow") as HTMLElement | null;
  if (!row) return;
  const id = row.dataset["c"]!;
  const s = active();
  const r = coinRectAt(s.layout, s.bip, id, viewT);
  if (!r) return;
  if (collapsed) setCollapsed(false); // the coin lives in the graph, not the contraction
  flyTo({ x: r.x - 260, y: r.y - 170, w: r.w + 520, h: r.h + 340 });
  playPing(r.x + r.w / 2, r.y + r.h / 2);
});

// --- params panel: re-roll the world ---
const paramsBtn = document.getElementById("paramsbtn") as HTMLButtonElement;
const paramsPanel = document.getElementById("params")!;
interface Knob { key: keyof EconomyParams; label: string; min: number; max: number; step: number }
const KNOBS: Knob[] = [
  { key: "feeLevel", label: "fee market level", min: 0.5, max: 4, step: 0.1 },
  { key: "feeVol", label: "fee volatility", min: 0, max: 3, step: 0.1 },
  { key: "fx", label: "exchange rate level", min: 0.5, max: 3, step: 0.1 },
  { key: "wealth", label: "starting wealth", min: 0.25, max: 4, step: 0.25 },
  { key: "oblRate", label: "obligations / edge / day", min: 0, max: 0.3, step: 0.01 },
  { key: "extRate", label: "purchases / person / day", min: 0, max: 0.2, step: 0.01 },
  { key: "pop", label: "population", min: 10, max: MAX_POP, step: 1 },
];
const LIVE_KEYS: (keyof LiveParams)[] = ["oblRate", "extRate", "feeLevel", "feeVol", "fx"];
function isLive(key: keyof EconomyParams): key is keyof LiveParams {
  return (LIVE_KEYS as string[]).includes(key);
}
function renderParams(): void {
  // rates and fees show the values in effect tomorrow — the timeline's
  // latest word — while wealth, pop, and the seed show the world's identity
  const eff = scene === 1 && eco ? eco.paramsAt(eco.day + 1) : null;
  paramsPanel.innerHTML = KNOBS.map((k) => {
    const v = eff && isLive(k.key) ? eff[k.key] : session.params[k.key] ?? DEFAULT_PARAMS[k.key];
    return `<label>${k.label} <output>${v}</output>
      <input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}"></label>`;
  }).join("") + `
    <label>seed <input type="text" class="seed" value="${session.seed.replace(/"/g, "&quot;")}"></label>
    <button class="apply">${eff ? "apply" : "re-roll the world"}</button>` + (eff ? `
    <p class="hint">rates and fees change from tomorrow — the days already
    lived stand. a new seed, wealth, or population re-rolls the world.</p>` : "");
  paramsPanel.querySelectorAll("input[type=range]").forEach((el) => {
    el.addEventListener("input", () => {
      (el.parentElement!.querySelector("output"))!.textContent = (el as HTMLInputElement).value;
    });
  });
  paramsPanel.querySelector(".apply")!.addEventListener("click", applyParams);
}
function applyParams(): void {
  const read: Partial<EconomyParams> = {};
  paramsPanel.querySelectorAll("input[type=range]").forEach((el) => {
    const input = el as HTMLInputElement;
    read[input.dataset["key"] as keyof EconomyParams] = Number(input.value);
  });
  const newSeed = (paramsPanel.querySelector(".seed") as HTMLInputElement).value.trim() || "welcome";
  // seed, wealth, and population are the world's identity — changing them
  // re-rolls. Rates and fees while the world runs are dated changes: they
  // steer the days ahead and leave the days already lived untouched.
  const identity = newSeed !== session.seed ||
    read.wealth !== (session.params.wealth ?? DEFAULT_PARAMS.wealth) ||
    read.pop !== (session.params.pop ?? DEFAULT_PARAMS.pop);
  if (scene === 1 && eco && !identity) {
    const current = eco.paramsAt(eco.day + 1);
    const patch: Partial<LiveParams> = {};
    for (const key of LIVE_KEYS) {
      if (read[key] !== undefined && read[key] !== current[key]) patch[key] = read[key];
    }
    if (Object.keys(patch).length === 0) return;
    session.timeline.push({ day: eco.day + 1, patch }); // eco shares the array
    toast(`the change takes effect on day ${eco.day + 1} — the past stands`);
    void syncFragment();
    return;
  }
  const next: Partial<EconomyParams> = {};
  for (const [key, v] of Object.entries(read) as [keyof EconomyParams, number][]) {
    if (v !== DEFAULT_PARAMS[key]) next[key] = v;
  }
  if (newSeed !== session.seed) {
    // a different world: recorded choices and dated changes belong to the old one
    session.interventions = [];
    session.timeline = [];
    session.manual = null;
    session.manualFrom = 0;
  }
  session.seed = newSeed;
  session.params = next;
  // a shrunken town: choices recorded for agents who no longer exist go
  const popNow = Math.max(10, Math.min(MAX_POP, session.params.pop ?? 10));
  if (session.manual !== null && session.manual >= popNow) { session.manual = null; session.manualFrom = 0; }
  // choices anchor to stable schedule IDs: one that names an edge the
  // smaller town lacks simply never matches, so no filtering is needed
  const day = scene === 1 ? economy().day : 0;
  rebuildEconomy(day);
  setManual(session.manual); // refresh the day button and decisions panel
  toast("the world re-rolled — same story, different dice");
}
paramsBtn.addEventListener("click", () => {
  const open = getComputedStyle(paramsPanel).display !== "none";
  if (!open) {
    renderParams();
    castPanel.style.display = "none"; // the two share the left edge
    inspector.style.display = "none";
  }
  paramsPanel.style.display = open ? "none" : "block";
});

// --- fragment sync ---
let syncTimer: number | undefined;
async function syncFragment(ref?: FragmentState["ref"]): Promise<string> {
  const state: FragmentState = {
    seed: session.seed,
    cam: [Math.round(cam.x), Math.round(cam.y), Number(cam.scale.toFixed(3))],
  };
  const t = tutorial.currentIndex;
  if (t >= 0) state.ts = steps[t]!.id;
  // a dismissed tour stays dismissed: without the sentinel, reloading a
  // skipped session would restart the story at step 0 (#116)
  else state.t = -1;
  // v/fd/uc through the model (#115); v = 2 keeps the old third-view
  // reading for old links, v = 3 is the clustered map uncurled
  const vf = fragmentView(currentViewState());
  if (vf.v !== 0) state.v = vf.v;
  if (vf.uc === 1) state.uc = 1;
  // the circle's world placement, so a shared link reproduces the same
  // geometry the sharer saw (absent = the layout's own origin coords)
  if (collapsed && clusterFit) {
    state.cf = [Math.round(clusterFit.x), Math.round(clusterFit.y),
      Math.round(clusterFit.w), Math.round(clusterFit.h)];
  }
  if (lens !== 0) state.l = lens;
  if (lens === 2 && lensAgent !== null) state.a = lensAgent;
  if (lens === 1 && A.overlays !== OV_ALL) state.ov = A.overlays;
  if (lens === 1 && A.ciohMax < CIOH_MAX_OFF) state.cm = A.ciohMax;
  if (lens === 1 && A.changeEvidence !== 1) state.ce = A.changeEvidence;
  if (lens === 1 && A.changeTells !== TELL_ALL) state.ct = A.changeTells;
  if (lens === 1 && A.grantsOn()) state.ai = [A.kycObs ? 1 : 0, Math.round(A.auxFrac * 100)];
  if (lens === 1 && A.showMistakes) state.mi = 1;
  if (lens === 1 && A.nsSocial) {
    state.ns = [1, Math.round(A.nsThreshold * 100), A.nsParts, Math.min(A.nsCursor, A.nsRun().length)];
    if (A.nsManual.length > 0) {
      state.nm = A.nsManual.map((e) =>
        [e.a, e.b, Math.round(e.score * 1000), e.forced ? 1 : 0]);
    }
  }
  if (lens === 1 && A.nfOn) {
    state.nf = [1, Math.round(A.nfThreshold * 100), Math.min(A.nfCursor, A.nfRun().length)];
  }
  if (forceLayout) state.fd = 1;
  if (scene === 1) {
    state.sc = 1;
    // the displayed day: a rewound reference restores to what you see,
    // and determinism replays the hidden future identically on demand
    state.n = cursorDay();
    if (viewTx !== null) state.nt = viewTx; // mid-day freeze-frame
  }
  const P: [keyof EconomyParams, keyof NonNullable<FragmentState["p"]>][] = [
    ["oblRate", "o"], ["extRate", "e"], ["feeLevel", "f"], ["feeVol", "fv"], ["fx", "x"], ["wealth", "w"], ["pop", "pp"],
  ];
  const p: NonNullable<FragmentState["p"]> = {};
  for (const [key, short] of P) {
    if (session.params[key] !== undefined && session.params[key] !== DEFAULT_PARAMS[key]) p[short] = session.params[key];
  }
  if (Object.keys(p).length > 0) state.p = p;
  if (session.timeline.length > 0) {
    const SHORT: [keyof LiveParams, "o" | "e" | "f" | "fv" | "x"][] = [
      ["oblRate", "o"], ["extRate", "e"], ["feeLevel", "f"], ["feeVol", "fv"], ["fx", "x"],
    ];
    state.pt = session.timeline.map((t) => {
      const patch: NonNullable<FragmentState["pt"]>[number][1] = {};
      for (const [key, short] of SHORT) {
        if (t.patch[key] !== undefined) patch[short] = t.patch[key];
      }
      return [t.day, patch];
    });
  }
  if (session.manual !== null) state.m = [session.manual, session.manualFrom];
  if (session.interventions.length > 0) {
    state.i = session.interventions.map((iv) => [iv.day, iv.id, iv.plan]);
  }
  if (ref) state.ref = ref;
  const frag = await encodeFragment(state);
  history.replaceState(null, "", `#${frag}`);
  return `${location.origin}${location.pathname}#${frag}`;
}
function syncFragmentSoon(): void {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncFragment(), 400);
}

// --- input ---
let dragging = false, lastX = 0, lastY = 0, moved = false;
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (dragging) {
    cam = { ...cam, x: cam.x - (e.clientX - lastX) / cam.scale, y: cam.y - (e.clientY - lastY) / cam.scale };
    if (Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY) > 2) moved = true;
    lastX = e.clientX; lastY = e.clientY;
    draw();
    return;
  }
  const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
  const hit = hitAt(wx, wy);
  if (hit?.kind !== hover?.kind || hit?.id !== hover?.id) {
    hover = hit;
    canvas.style.cursor = hit ? "pointer" : "grab";
    draw();
  }
});
canvas.addEventListener("pointerup", (e) => {
  if (dragging && moved) {
    syncFragmentSoon();
  } else if (dragging) {
    // a click: toggle the hit in the trace, or clear on empty space
    const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
    const hit = hitAt(wx, wy);
    if (hit) applySelection(hit);
    else clearSelection();
    draw();
  }
  dragging = false;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam = zoomAt(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
  draw();
  syncFragmentSoon();
}, { passive: false });

// --- reviewing aid: right-click → copy a reference ---
function toast(text: string): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("gone"), 1800);
  setTimeout(() => el.remove(), 2400);
}

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
  const hit = hitAt(wx, wy);
  const ref: FragmentState["ref"] = {
    wx: Math.round(wx),
    wy: Math.round(wy),
    ...(hit ? { sel: `${hit.kind}:${hit.id}` } : {}),
  };
  void syncFragment(ref).then((url) => {
    void navigator.clipboard.writeText(url).then(
      () => toast(hit ? `reference copied (${hit.kind} ${hit.id})` : "reference copied"),
      () => toast("copy failed — the URL bar holds the reference"),
    );
  });
});

// --- boot ---
async function init(): Promise<void> {
  resize();
  const state = await decodeFragment(location.hash).catch(() => null);
  if (state?.seed) session.seed = state.seed;
  if (state?.p) {
    if (state.p.o !== undefined) session.params.oblRate = state.p.o;
    if (state.p.e !== undefined) session.params.extRate = state.p.e;
    if (state.p.f !== undefined) session.params.feeLevel = state.p.f;
    if (state.p.fv !== undefined) session.params.feeVol = state.p.fv;
    if (state.p.x !== undefined) session.params.fx = state.p.x;
    if (state.p.w !== undefined) session.params.wealth = state.p.w;
    if (state.p.pp !== undefined) session.params.pop = state.p.pp;
  }
  if (state?.pt) {
    session.timeline = state.pt.map(([day, p]) => {
      const patch: Partial<LiveParams> = {};
      if (p.o !== undefined) patch.oblRate = p.o;
      if (p.e !== undefined) patch.extRate = p.e;
      if (p.f !== undefined) patch.feeLevel = p.f;
      if (p.fv !== undefined) patch.feeVol = p.fv;
      if (p.x !== undefined) patch.fx = p.x;
      return { day, patch };
    });
  }
  if (state?.m && state.m[0] < (state.p?.pp ?? PERSONAS.length)) {
    session.manual = state.m[0];
    session.manualFrom = state.m[1];
  }
  if (state?.i) {
    session.interventions = state.i.map(([day, id, plan]) => ({ day, id, plan: plan as ManualPlan }));
  }
  // the circle's placement precedes the collapse so the rebuilt layout
  // fits the same rect the sharer's did
  if (state?.cf) {
    clusterFit = { x: state.cf[0], y: state.cf[1], w: state.cf[2], h: state.cf[3] };
  }
  // the view/layout/grouping knobs restore through the model (#115);
  // the arrangement (fd) applies further down, once the scenes exist
  applyViewState(viewFromFragment(state?.v, 0, state?.uc), false);
  if (state?.sc === 1) {
    setScene(1, state.n ?? 0);
    // a freeze-frame reference lands mid-day, exactly as recorded
    if (state.nt !== undefined) setViewDay(null, state.nt);
  }
  if (session.manual !== null) setManual(session.manual); // light the decisions panel
  if (state?.ov !== undefined) {
    A.overlays = state.ov & OV_ALL; // sub-tx forcing is effOverlays' business
    simRev += 1;
    reflectOverlays();
  }
  if (state?.cm !== undefined) {
    A.ciohMax = Math.min(state.cm, CIOH_MAX_OFF);
    simRev += 1;
    reflectOverlays();
  }
  if (state?.ce !== undefined) {
    A.changeEvidence = Math.min(state.ce, CHANGE_EV_MAX);
    simRev += 1;
    reflectOverlays();
  }
  if (state?.ct !== undefined) {
    A.changeTells = state.ct & TELL_ALL;
    simRev += 1;
    reflectOverlays();
  }
  if (state?.mi === 1) {
    A.showMistakes = true;
    reflectOverlays();
  }
  if (state?.ai !== undefined) {
    A.kycObs = state.ai[0] === 1;
    A.auxFrac = state.ai[1] / 100;
    reflectOverlays();
  }
  if (state?.ns !== undefined && state.ns[0] === 1) {
    A.nsSocial = true;
    A.nsThreshold = state.ns[1] / 100;
    A.nsParts = state.ns[2];
    // the manual entries restore before the cursor clamps against the run
    if (state.nm !== undefined) {
      A.nsManual = state.nm.map(([a, b, s, f]) => ({
        kind: "merge" as const, a, b, score: s / 1000, ...(f === 1 ? { forced: true } : {}),
      }));
    }
    A.nsCursor = state.ns[3];
    A.nsRun(); // clamps the cursor against the actual run length
    reflectOverlays();
  }
  if (state?.nf !== undefined && state.nf[0] === 1) {
    A.nfOn = true;
    A.nfThreshold = state.nf[1] / 100;
    A.nfCursor = state.nf[2];
    A.nfRun(); // clamps the cursor against the actual run length
    reflectOverlays();
  }
  if (state?.fd === 1) setForceLayout(true, false);
  // lens after scene: the agent lens defaults to a payee the economy knows
  if (state?.l === 1 || state?.l === 2) {
    if (state.l === 2 && typeof state.a === "number" && state.a < MAX_POP) lensAgent = state.a;
    setLens(state.l);
  }

  if (state?.cam) {
    cam = { x: state.cam[0], y: state.cam[1], scale: state.cam[2] };
  } else {
    const b = active().layout.bounds;
    flyTo({ x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 }, 1);
  }

  // the tour position travels by stable step id (legacy indexes were
  // already resolved to ids by the codec's v4 migration)
  const wantStep = state?.ts !== undefined ? steps.findIndex((s) => s.id === state.ts) : -1;
  if (wantStep >= 0) tutorial.go(wantStep, !state?.cam);
  else if (state?.ts === undefined && state?.t === undefined && !state?.ref) tutorial.go(0, !state?.cam);
  else {
    // an id this tour no longer knows, the explicit hidden sentinel, or a
    // bare reference link: no tour — and with no story to unfold, the
    // whole heuristics panel and every staged control are available at once
    allRowsSeen = true;
    reflectOverlays();
    reflectStagedWidgets();
    tutorial.hide();
  }

  if (state?.ref) {
    const { wx, wy, sel } = state.ref;
    // the recorded element selector re-applies as a selection (#121): the
    // id names what sat under the sharer's cursor, so the reference stays
    // meaningful even where a rebuilt layout moved it away from (wx, wy).
    // Same validity guards the live click path enforces: the entity must
    // exist, and a cluster only names anything on a collapsed map.
    const hit = sel !== undefined ? parseRefSel(sel) : null;
    if (hit) {
      const chain = active().chain;
      const ok = hit.kind === "coin" ? chain.coins.has(hit.id)
        : hit.kind === "tx" ? chain.txs.has(hit.id)
        : collapsed && lensClustering().members.has(hit.id);
      if (ok) applySelection(hit);
    }
    if (!state.cam) flyTo({ x: wx - 300, y: wy - 200, w: 600, h: 400 });
    setTimeout(() => playPing(wx, wy), state.cam ? 300 : 800);
  }

  draw();
  void syncFragment();
}

window.addEventListener("resize", resize);
// the pane may size the canvas after load without a window resize event
new ResizeObserver(() => resize()).observe(canvas);
void init();
