// App shell: two scenes — the intro story and the unilateral economy —
// drawn in either the block-explorer or bipartite view, with pan/zoom,
// hover, click-to-trace ancestry, a guided tour, day stepping, a cast
// panel, and the right-click "copy reference" reviewing aid.
import { encodeFragment, decodeFragment, type FragmentState } from "./ui/fragment";
import { type Camera, worldToScreen, screenToWorld, zoomAt } from "./ui/camera";
import { buildIntroChain } from "./scenario/intro";
import { introSteps } from "./scenario/introSteps";
import { economySteps } from "./scenario/economySteps";
import { PERSONAS, CARELESS, MAX_POP, ownerColor, type Persona } from "./scenario/cast";
import { Economy, GAME_DAY, DEFAULT_PARAMS, type EconomyParams, type LiveParams, type ParamPatch, type Intervention, type ManualPlan } from "./engine/economy";
import { ancestry } from "./analysis/ancestry";
import { traceCoins, traceTx, type Trace } from "./analysis/trace";
import { counterfactualOrigins } from "./analysis/paths";
import { clusterObserver, clusterByOwner, clusterByKnowledge, clusterColor, clusterLabel, CLUSTER_MISC, type Clustering } from "./analysis/clusters";
import { agentKnowledge, type Knowledge } from "./analysis/knowledge";
import { layoutClusterGraph, drawContraction, hitTestClusters, truthSlices, transitionFragments, type ClusterLayout, type ClusterPaint, type ClusterTransition } from "./ui/clusterview";
import { observerSteps } from "./scenario/observerSteps";
import { payjoinSteps, selectPayjoinExhibit, payjoinDetection, detectionFires, type PayjoinDetection } from "./scenario/payjoinSteps";
import { settlementSteps, selectSettlementExhibit, settlementVerdict } from "./scenario/settlementSteps";
import { coinjoinSteps } from "./scenario/coinjoinSteps";
import { intersectionSteps, type Focused, type AuxGrant } from "./scenario/intersectionSteps";
import { auxInfoDecay, type AuxDecay } from "./analysis/auxinfo";
import { synthesisSteps, claimExhibit, rentForms, counterpartyExhibit, type ClaimExhibit, type SweepView } from "./scenario/synthesisSteps";
import { synthesisSweepExhibit, clusterOwner, outsiderEdges } from "./scenario/synthesisStaging";
import { gameSteps } from "./scenario/gameSteps";
import { setCastNames, OMNISCIENT } from "./scenario/omniscient";
import { layoutChain, type Layout, type Hit, type Rect } from "./ui/blockview";
import { layoutBipartite, type BipLayout } from "./ui/bipartite";
import { drawMorph, hitTestMorph, coinRectAt, txRectAt } from "./ui/morph";
import { blendLayout, blendBip } from "./ui/blend";
import { commonInputFill, type Paint } from "./ui/paint";
import { Tutorial } from "./ui/tutorial";
import { Animator, easeOutQuad } from "./ui/anim";
import { fmtSats } from "./core/sats";
import { type Chain } from "./model/chain";

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
  if (scene === 1) dayBtn.textContent = dayLabel();
  syncTimebar();
  draw();
  void syncFragment();
}
function refreshEcoLayouts(): void {
  ecoScene = { chain: eco!.chain, layout: layoutChain(eco!.chain), bip: layoutBipartite(eco!.chain) };
}
// --- the time cursor (#17): rewinding is a display filter, not a rebuild.
// The layout stays the full history's; transactions after the cursor are
// hidden, and a coin whose spend lies in the future draws as unspent.
// Stepping forward re-reveals recorded days; past the frontier it extends
// the simulation. null = riding the frontier.
let viewDay: number | null = null;
function cursorDay(): number {
  return viewDay ?? eco?.day ?? 0;
}
function rewound(): boolean {
  return scene === 1 && eco !== null && viewDay !== null && viewDay < eco.day;
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
    simRev += 1;
    recomputeTrace();
    dayBtn.textContent = dayLabel();
    syncTimebar();
  };
  anim.add(ms, (t) => {
    if (gen !== rideGen) return;
    const d = Math.min(to, from + Math.floor(span * t + 1e-9));
    if (d !== shown) showDay(d);
  }, { done: () => {
    if (gen !== rideGen) return;
    if (shown < to) showDay(to);
    backBtn.style.display = scene === 1 && cursorDay() > 0 ? "block" : "none";
    void syncFragment();
  } });
  kick();
}
let visCache: { rev: number; day: number; s: SceneData } | null = null;
function active(): SceneData {
  if (scene !== 1 || !ecoScene) return intro;
  if (!rewound()) return ecoScene;
  const day = cursorDay();
  if (!visCache || visCache.rev !== simRev || visCache.day !== day) {
    visCache = {
      rev: simRev,
      day,
      s: { chain: ecoScene.chain.through(day), layout: ecoScene.layout, bip: ecoScene.bip },
    };
  }
  return visCache.s;
}
/** move the cursor; everything derived from the visible world follows */
function setViewDay(d: number | null): void {
  rideGen += 1; // a hand on the dial cancels any tutorial time-lapse
  viewDay = d !== null && eco && d >= eco.day ? null : d;
  simRev += 1; // the visible chain changed, even though the record didn't
  recomputeTrace(); // a selection may have slipped beyond the cursor
  renderCast(); // the town roster follows the displayed day
  dayBtn.textContent = dayLabel();
  backBtn.style.display = scene === 1 && cursorDay() > 0 ? "block" : "none";
  syncTimebar();
  draw();
  void syncFragment();
}

// --- lenses: 0 = all-seeing, 1 = third-party observer, 2 = one agent's view ---
let lens: 0 | 1 | 2 = 0;
let lensAgent: number | null = null;
// which heuristics the observer lens runs, as a bitmask:
// 1 = CIOH, 2 = round-USD change, 4 = subset-sum; default all of them.
// With all off the union-find never fires, every coin is a singleton, and
// the observer's map degrades honestly into the bare public structure.
const OV_CIOH = 1, OV_CHANGE = 2, OV_SUBSUM = 4, OV_ALL = 7;
let overlays = OV_ALL;
let clCache: { rev: number; cl: Clustering } | null = null;
function clustering(): Clustering {
  const s = active();
  if (!clCache || clCache.rev !== simRev) {
    const priceAt = scene === 1 && eco ? (d: number): number | undefined => eco!.prices[d] : undefined;
    const cl = clusterObserver(s.chain, priceAt, {
      cioh: (overlays & OV_CIOH) !== 0,
      change: (overlays & OV_CHANGE) !== 0,
      subsum: (overlays & OV_SUBSUM) !== 0,
    });
    clCache = { rev: simRev, cl };
  }
  return clCache.cl;
}

// The contracted graph is not one fixed flattening: the partition — and
// with it the layout — follows the active lens. All-seeing contracts to
// the true user graph (every vertex a named wallet); the observer to its
// heuristic pseudonym graph, honoring the toggles (all off = singletons,
// the bare structure); an agent's lens to what that one ledger can
// attribute, suspicions kept apart from facts.
let collapseCache: { rev: number; lens: number; agent: number; cl: Clustering; clay: ClusterLayout } | null = null;
function lensClustering(): Clustering {
  const agent = lens === 2 ? (lensAgent ?? 0) : -1;
  if (!collapseCache || collapseCache.rev !== simRev || collapseCache.lens !== lens || collapseCache.agent !== agent) {
    const cl = lens === 0 ? clusterByOwner(active().chain)
      : lens === 2 ? clusterByKnowledge(active().chain, knowledge().coins)
      : clustering();
    collapseCache = { rev: simRev, lens, agent, cl, clay: layoutClusterGraph(cl, active().chain) };
  }
  return collapseCache.cl;
}
function clusterLayout(): ClusterLayout {
  lensClustering();
  return collapseCache!.clay;
}
// In the contracted view the TOPOLOGY carries the lens's information
// (its partition shapes the vertices), so paint is freed to be the
// town's ground truth on every lens: each vertex wears the true owners
// of its member coins, and a vertex the lens wrongly merged renders as
// a multi-color disc — cluster collapse made visible. This is the
// grading direction of the latent-truth rule (truth judging the
// partition, drawn for the learner); no analysis reads it, and the
// coin-graph views keep each lens's own bookkeeping palette.
function lensClusterPaint(): ClusterPaint {
  const chain = active().chain;
  const cl = lensClustering();
  const truthColor = (id: string): string => {
    const o = chain.coins.get(id)!.owner;
    return o === null ? "#e8e5da" : ownerColor(o);
  };
  const base = {
    color: truthColor,
    slices: (rep: string) => truthSlices(cl, rep, truthColor),
  };
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
  return {
    ...base,
    label: (rep) => clusterLabel(cl, rep),
    center: (rep) => (clusterLabel(cl, rep) ? String(cl.rank.get(rep)) : ""),
  };
}
function observerPaint(): Paint {
  const cl = clustering();
  return {
    coinFill: (c) => clusterColor(cl, c.id),
    coinText: () => "#111",
    coinCaption: (c) => clusterLabel(cl, c.id),
    txMemo: () => null,
    txAttribution: (t, ch) => {
      const fill = commonInputFill(ch, t, (c) => clusterColor(cl, c.id));
      return fill === CLUSTER_MISC ? null : fill; // unclustered is not attribution
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
    knCache = { rev: simRev, u, k: agentKnowledge(s.chain, events, u, clustering(), cjs) };
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
      clusterLayout(), lensClustering(), collapseT, lensClusterPaint(), clusterTrans ?? undefined);
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

  const hud = document.getElementById("hud")!;
  const dayPart = scene === 1
    ? (rewound() ? ` · day ${cursorDay()} (of ${economy().day} recorded)` : ` · day ${economy().day}`)
    : "";
  const playPart = session.manual !== null ? ` · playing ${castList()[session.manual]!.name}` : "";
  hud.textContent = `seed ${session.seed}${dayPart}${playPart} · zoom ${cam.scale.toFixed(2)}× · v: flip view · click coins: trace together (gold ring = shared origins) · h: hide the rest · right-click: copy a reference${originsPart()}`;
}

// counterfactual-path counting for the selected coin (memoized: the flow
// network is rebuilt per chain growth, not per frame)
let originsCache: { id: string; rev: number; text: string } | null = null;
function originsPart(): string {
  if (selection?.kind !== "coins" || selection.ids.length !== 1) return "";
  const id = selection.ids[0]!;
  const s = active();
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
  viewBtn.textContent = VIEW_NAMES[view];
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
  if (collapsed) setCollapsed(false); // expand back into the graph first
  else setView((1 - targetView) as 0 | 1);
});

// --- cluster collapse: flatten the current view into the user graph ---
const clusterBtn = document.getElementById("clusterbtn") as HTMLButtonElement;
let preCollapseCam: Camera | null = null;
function setCollapsed(on: boolean, animate = true): void {
  collapsed = on;
  clusterBtn.textContent = on ? "expand" : "clusters";
  if (!animate) {
    collapseT = on ? 1 : 0;
    draw();
    void syncFragment();
    return;
  }
  const from = collapseT;
  const to = on ? 1 : 0;
  anim.add(80 + 1050 * Math.abs(to - from), (t) => { collapseT = from + (to - from) * t; },
    { done: () => void syncFragment() });
  // frame the flattened graph going in; come back out to where you were
  if (on) {
    preCollapseCam = { ...cam };
    flyTo(clusterLayout().bounds);
  } else if (preCollapseCam) {
    const back = preCollapseCam;
    preCollapseCam = null;
    const fromCam = { ...cam };
    anim.add(700, (t) => {
      cam = {
        x: fromCam.x + (back.x - fromCam.x) * t,
        y: fromCam.y + (back.y - fromCam.y) * t,
        scale: Math.exp(Math.log(fromCam.scale) + (Math.log(back.scale) - Math.log(fromCam.scale)) * t),
      };
    });
  }
  kick();
}
clusterBtn.addEventListener("click", () => setCollapsed(!collapsed));

const lensBtn = document.getElementById("lens") as HTMLButtonElement;
function setLens(l: 0 | 1 | 2): void {
  lens = l;
  if (l === 2 && lensAgent === null) lensAgent = defaultLensAgent();
  lensBtn.textContent =
    l === 0 ? "lens: all-seeing" :
    l === 1 ? "lens: observer" :
    `lens: ${castList()[lensAgent ?? 0]!.name}'s`;
  overlaysPanel.style.display = l === 1 ? "block" : "none";
  recomputeTrace(); // the joint-trace intersection is cluster-wise under the observer
  // the contracted graph is a different partition under a different lens:
  // re-frame it, and drop a selection that named a vertex of the old one
  if (collapsed) {
    if (selection?.kind === "cluster") { selection = null; highlight = null; }
    flyTo(clusterLayout().bounds);
  }
  draw();
  void syncFragment();
}
lensBtn.addEventListener("click", () => setLens(((lens + 1) % 3) as 0 | 1 | 2));

// --- observer heuristic toggles: which inferences the map is running.
// With all off, only the public structure remains — nothing is welded,
// colored, or captioned beyond what the chain itself says.
const overlaysPanel = document.getElementById("overlays")!;
const OVERLAY_DEFS: { bit: number; label: string; title: string }[] = [
  { bit: OV_CIOH, label: "common-input ownership", title: "inputs spent together — probably one owner" },
  { bit: OV_CHANGE, label: "round-USD change", title: "the round-dollar output is probably the payment; the other is change" },
  { bit: OV_SUBSUM, label: "sub-transaction analysis", title: "a unique balancing partition welds its sub-transactions together" },
];
overlaysPanel.innerHTML = `<h3>heuristics</h3>` + OVERLAY_DEFS.map((d) =>
  `<label title="${d.title}"><input type="checkbox" data-bit="${d.bit}"> ${d.label}</label>`).join("");
function reflectOverlays(): void {
  overlaysPanel.querySelectorAll("input[type=checkbox]").forEach((el) => {
    const input = el as HTMLInputElement;
    input.checked = (overlays & Number(input.dataset["bit"])) !== 0;
  });
}
reflectOverlays();
// a heuristic toggle while the map is contracted repartitions the
// vertices: animate the old discs merging into / splitting out of the
// new ones (purely cosmetic — both endpoints are honestly computed
// partitions, and the tween feeds nothing)
function setOverlays(mask: number): void {
  const before = collapsed && collapseT > 0.9 && collapseCache
    ? { cl: collapseCache.cl, clay: collapseCache.clay } : null;
  overlays = mask & OV_ALL;
  simRev += 1; // the observer's map — and every lens seeded from it — changes
  reflectOverlays();
  if (before) {
    const tr: ClusterTransition = {
      t: 0,
      fragments: transitionFragments(before.cl, before.clay, lensClustering()),
    };
    clusterTrans = tr;
    anim.add(900, (t) => { tr.t = t; }, {
      done: () => { if (clusterTrans === tr) clusterTrans = null; },
    });
    flyTo(clusterLayout().bounds);
    kick();
  }
  recomputeTrace();
  draw();
  void syncFragment();
}
overlaysPanel.addEventListener("change", () => {
  let mask = 0;
  overlaysPanel.querySelectorAll("input:checked").forEach((el) => {
    mask |= Number((el as HTMLInputElement).dataset["bit"]);
  });
  setOverlays(mask);
});

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "v") {
    if (collapsed) setCollapsed(false);
    else setView((1 - targetView) as 0 | 1);
  }
  if (e.key === "c") setCollapsed(!collapsed);
  if (e.key === "o") setLens(((lens + 1) % 3) as 0 | 1 | 2);
  if (e.key === "h") { hideDim = !hideDim; draw(); }
});

// --- scene switching + day stepping ---
const dayBtn = document.getElementById("stepday") as HTMLButtonElement;
const backBtn = document.getElementById("backday") as HTMLButtonElement;
function dayLabel(): string {
  if (rewound()) return `day ${cursorDay()} of ${economy().day} · replay →`;
  return session.manual !== null
    ? `day ${economy().day} · end turn →`
    : `day ${economy().day} · next day →`;
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
  dayBtn.style.display = s === 1 ? "block" : "none";
  backBtn.style.display = s === 1 && cursorDay() > 0 ? "block" : "none";
  if (s === 1) dayBtn.textContent = dayLabel();
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
  // reveals it — nothing is re-simulated, the layout does not move
  if (rewound()) {
    setViewDay(cursorDay() + 1);
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
  dayBtn.textContent = dayLabel();
  backBtn.style.display = cursorDay() > 0 ? "block" : "none";
  syncTimebar();
  renderCast(); // someone may have moved to town today
  renderDecisions();
  draw();
  void syncFragment();
}
dayBtn.addEventListener("click", () => { pausePlay(); stepDay(); });
backBtn.addEventListener("click", () => {
  if (scene !== 1 || cursorDay() <= 0) return;
  pausePlay();
  setViewDay(cursorDay() - 1);
});

// --- the time bar: a slider to skip along the recorded days, and
// auto-play that lets days pass on their own at a chosen speed (#41) ---
const timebar = document.getElementById("timebar") as HTMLDivElement;
const playBtn = document.getElementById("playbtn") as HTMLButtonElement;
const speedBtn = document.getElementById("speedbtn") as HTMLButtonElement;
const daySlider = document.getElementById("dayslider") as HTMLInputElement;
const SPEEDS = [1, 2, 4, 8]; // days per second
let speedIx = 1;
let playTimer: ReturnType<typeof setTimeout> | null = null;
/** keep the slider spanning the recorded days with the cursor on it */
function syncTimebar(): void {
  timebar.style.display = scene === 1 && eco ? "flex" : "none";
  if (!eco) return;
  daySlider.max = String(eco.day);
  daySlider.value = String(cursorDay());
}
function pausePlay(): void {
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = null; }
  playBtn.textContent = "▶";
}
function playTick(): void {
  if (scene !== 1) { pausePlay(); return; }
  stepDay();
  playTimer = setTimeout(playTick, 1000 / SPEEDS[speedIx]!);
}
playBtn.addEventListener("click", () => {
  if (playTimer !== null) { pausePlay(); return; }
  playBtn.textContent = "❚❚";
  playTick();
});
speedBtn.addEventListener("click", () => {
  speedIx = (speedIx + 1) % SPEEDS.length;
  speedBtn.textContent = `${SPEEDS[speedIx]}×`;
  if (playTimer !== null) { clearTimeout(playTimer); playTimer = setTimeout(playTick, 1000 / SPEEDS[speedIx]!); }
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
  if (scene === 1) dayBtn.textContent = dayLabel();
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
// Joint traces follow the corrected semantics: the intersection of the
// ancestries fully lit, their union partly lit, the rest dimmed (or
// hidden). Under the observer lens the intersection is cluster-wise —
// candidate origins are clusters, not coins.
function clearSelection(): void {
  selection = null;
  highlight = null;
}
function recomputeTrace(): void {
  if (!selection) {
    highlight = null;
    return;
  }
  const s = active();
  const cl = lens === 1 ? clustering() : undefined;
  if (selection.kind === "coins") {
    const live = selection.ids.filter((id) => s.chain.coins.has(id));
    highlight = live.length > 0 ? traceCoins(s.chain, live, cl) : null;
  } else if (selection.kind === "tx") {
    highlight = s.chain.txs.has(selection.id) ? traceTx(s.chain, selection.id, cl) : null;
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
  } else if (selection?.kind === hit.kind && selection.id === hit.id) {
    selection = null; // clicking the selected tx/cluster again deselects
  } else {
    selection = { kind: hit.kind, id: hit.id };
  }
  recomputeTrace();
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
    const more = anim.tick(now);
    draw();
    if (more) requestAnimationFrame(frame);
    else rafLive = false;
  };
  requestAnimationFrame(frame);
}

/** Animate the camera to frame a world rect with some margin. */
let pendingFly: { rect: Rect; ms: number } | null = null;
function flyTo(rect: Rect, ms = 700): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w <= 0 || h <= 0) {
    pendingFly = { rect, ms };
    return;
  }
  const target: Camera = {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    scale: Math.min(80, Math.max(0.05, Math.min(w / rect.w, h / rect.h))),
  };
  const from = { ...cam };
  anim.add(ms, (t) => {
    cam = {
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
      scale: Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * t),
    };
  }, { done: () => void syncFragment() });
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
  ),
  ...intersectionSteps(
    () => active().bip.bounds,
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
  // prefer a session whose mapping is PROVEN underdetermined (two balanced
  // readings exhibited); fall back to an unresolved dense one, and only
  // then to anything at all. The careless (and any unlucky) session
  // doesn't count
  let unresolved: string | undefined;
  let any: string | undefined;
  for (const [tid, cj] of eco?.coinjoins ?? []) {
    if (tid === eco?.naiveTid) continue;
    if (any === undefined) any = tid;
    if (cj.verdict === "ambiguous" && cj.density >= 0.5) return tid;
    if (unresolved === undefined && !cj.determined && cj.density >= 0.5) unresolved = tid;
  }
  return unresolved ?? any;
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
  onDone: () => readableHandoff(),
  onStepChange: () => void syncFragment(),
  onView: (view) => {
    // step "view 2" means: the graph flattened into clusters
    const flat = view === 2;
    const base = (flat ? 1 : view) as 0 | 1;
    if (base !== targetView) setView(base);
    if (flat !== collapsed) setCollapsed(flat);
  },
  onLens: (l, a) => {
    if (l === 2) lensAgent = a ?? defaultLensAgent(); // step's pick, else the payjoin payee
    if (l !== lens || l === 2) setLens(l);
  },
  onOverlays: (ov) => {
    if (ov !== overlays) setOverlays(ov);
  },
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
castPanel.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest(".cast-row") as HTMLElement | null;
  if (!row) return;
  const u = Number(row.dataset["u"]);
  if (lens === 2 && lensAgent !== u) {
    lensAgent = u;
    setLens(2); // relabel the button, repaint through the new agent's eyes
  }
  const p = castList()[u]!;
  const chain = active().chain;
  const utxos = chain.utxos().filter((c) => c.owner === u);
  const total = utxos.reduce((s, c) => s + c.value, 0);
  inspector.innerHTML = `
    <div class="tut-head"><span class="tut-title">
      <span class="swatch" style="background:${ownerColor(u)}"></span> ${p.name}</span>
      <span class="tut-progress">${p.role}${u === CARELESS ? " ⚠" : ""}</span></div>
    <p>${p.concern}</p>
    <p class="role">wallet: ${utxos.length} coin${utxos.length === 1 ? "" : "s"}, ${fmtSats(total)} sats</p>
    <div class="coins">${utxos.slice(0, 12).map((c) =>
      `<span class="coin-chip" style="background:${ownerColor(u)}">${fmtSats(c.value)}</span>`).join(" ")}${utxos.length > 12 ? " …" : ""}</div>`;
  inspector.style.display = "block";
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
  if (t >= 0) state.t = t;
  if (collapsed) state.v = 2; // encoded like the old third view, for old links
  else if (targetView !== 0) state.v = targetView;
  if (lens !== 0) state.l = lens;
  if (lens === 2 && lensAgent !== null) state.a = lensAgent;
  if (lens === 1 && overlays !== OV_ALL) state.ov = overlays;
  if (scene === 1) {
    state.sc = 1;
    // the displayed day: a rewound reference restores to what you see,
    // and determinism replays the hidden future identically on demand
    state.n = cursorDay();
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
  setView(state?.v === 1 || state?.v === 2 ? 1 : 0, false);
  if (state?.v === 2) setCollapsed(true, false);
  if (state?.sc === 1) setScene(1, state.n ?? 0);
  if (session.manual !== null) setManual(session.manual); // light the decisions panel
  if (state?.ov !== undefined) {
    overlays = state.ov & OV_ALL;
    simRev += 1;
    reflectOverlays();
  }
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

  if (state?.t !== undefined && state.t >= 0) tutorial.go(state.t, !state.cam);
  else if (state?.t === undefined && !state?.ref) tutorial.go(0, !state?.cam);
  else tutorial.hide(); // explicit t < 0, or a bare reference link: no tour

  if (state?.ref) {
    const { wx, wy } = state.ref;
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
