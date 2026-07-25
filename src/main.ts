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
import { Economy, GAME_DAY, DEFAULT_PARAMS, type EconomyParams, type Intervention, type ManualPlan } from "./engine/economy";
import { ancestry } from "./analysis/ancestry";
import { traceCoins, traceTx, type Trace } from "./analysis/trace";
import { counterfactualOrigins } from "./analysis/paths";
import { clusterObserver, clusterColor, clusterLabel, CLUSTER_MISC, type Clustering } from "./analysis/clusters";
import { agentKnowledge, type Knowledge } from "./analysis/knowledge";
import { layoutClusterGraph, drawContraction, hitTestClusters, type ClusterLayout } from "./ui/clusterview";
import { observerSteps } from "./scenario/observerSteps";
import { payjoinSteps } from "./scenario/payjoinSteps";
import { settlementSteps } from "./scenario/settlementSteps";
import { coinjoinSteps } from "./scenario/coinjoinSteps";
import { intersectionSteps, type Focused } from "./scenario/intersectionSteps";
import { gameSteps } from "./scenario/gameSteps";
import { layoutChain, type Layout, type Hit, type Rect, setCastNames } from "./ui/blockview";
import { layoutBipartite, type BipLayout } from "./ui/bipartite";
import { drawMorph, hitTestMorph, coinRectAt, txRectAt, commonInputFill, type Paint } from "./ui/morph";
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

let seed = "welcome";
let params: Partial<EconomyParams> = {};
let manual: number | null = null;
let manualFrom = 0;
let interventions: Intervention[] = [];
let eco: Economy | null = null;
const castList = (): Persona[] => eco ? eco.cast : PERSONAS;
let ecoScene: SceneData | null = null;
let scene: 0 | 1 = 0;

function economy(): Economy {
  if (!eco) {
    eco = new Economy(seed, params);
    eco.manual = manual;
    eco.manualFrom = manualFrom;
    eco.interventions = interventions;
    setCastNames(eco.cast.map((p) => p.name)); // captions track the live town
    refreshEcoLayouts();
  }
  return eco;
}
/** rebuild the world from scratch and replay it to the given day — the
 *  seed, params, and recorded choices fully determine the result */
function rebuildEconomy(toDay: number): void {
  eco = null;
  clCache = null;
  knCache = null;
  m5Cache = null;
  m6Cache = null;
  originsCache = null;
  economy().runTo(toDay);
  refreshEcoLayouts();
  renderCast(); // population (and with it the cast panel) may have changed
  recomputeTrace();
  renderDecisions();
  if (scene === 1) dayBtn.textContent = dayLabel();
  draw();
  void syncFragment();
}
function refreshEcoLayouts(): void {
  ecoScene = { chain: eco!.chain, layout: layoutChain(eco!.chain), bip: layoutBipartite(eco!.chain) };
}
function active(): SceneData {
  return scene === 1 && ecoScene ? ecoScene : intro;
}

// --- lenses: 0 = all-seeing, 1 = third-party observer, 2 = one agent's view ---
let lens: 0 | 1 | 2 = 0;
let lensAgent: number | null = null;
let clCache: { n: number; sc: number; cl: Clustering; clay: ClusterLayout } | null = null;
function clustering(): Clustering {
  const s = active();
  if (!clCache || clCache.n !== s.chain.order.length || clCache.sc !== scene) {
    const priceAt = scene === 1 && eco ? (d: number): number | undefined => eco!.prices[d] : undefined;
    const cl = clusterObserver(s.chain, priceAt);
    clCache = { n: s.chain.order.length, sc: scene, cl, clay: layoutClusterGraph(cl) };
  }
  return clCache.cl;
}
function clusterLayout(): ClusterLayout {
  clustering();
  return clCache!.clay;
}
function observerPaint(): Paint {
  const cl = clustering();
  return {
    coinFill: (c) => clusterColor(cl, c.id),
    coinText: () => "#111",
    coinCaption: (c) => clusterLabel(cl, c.id),
    txMemo: () => null,
    txAttribution: (t, ch) => commonInputFill(ch, t, (c) => clusterColor(cl, c.id)),
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
let knCache: { n: number; sc: number; u: number; k: Knowledge } | null = null;
function knowledge(): Knowledge {
  const s = active();
  const u = lensAgent ?? 0;
  if (!knCache || knCache.n !== s.chain.order.length || knCache.sc !== scene || knCache.u !== u) {
    knCache = { n: s.chain.order.length, sc: scene, u, k: agentKnowledge(s.chain, eco?.events ?? [], u, clustering(), eco?.coinjoins.keys()) };
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
      clusterLayout(), clustering(), collapseT);
  } else {
    drawMorph(ctx, s.chain, s.layout, s.bip, viewT, {
      hover, highlight, hideDim,
      selected: selection?.kind === "coins" ? { coins: new Set(selection.ids), txs: new Set() } :
        selection?.kind === "tx" ? { coins: new Set(), txs: new Set([selection.id]) } : null,
      ...(lens === 1 ? { paint: observerPaint() } : lens === 2 ? { paint: agentPaint() } : {}),
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
  const dayPart = scene === 1 ? ` · day ${economy().day}` : "";
  const playPart = manual !== null ? ` · playing ${castList()[manual]!.name}` : "";
  hud.textContent = `seed ${seed}${dayPart}${playPart} · zoom ${cam.scale.toFixed(2)}× · v: flip view · click coins: trace together (gold ring = shared origins) · h: hide the rest · right-click: copy a reference${originsPart()}`;
}

// counterfactual-path counting for the selected coin (memoized: the flow
// network is rebuilt per chain growth, not per frame)
let originsCache: { id: string; n: number; text: string } | null = null;
function originsPart(): string {
  if (selection?.kind !== "coins" || selection.ids.length !== 1) return "";
  const id = selection.ids[0]!;
  const s = active();
  if (!originsCache || originsCache.id !== id || originsCache.n !== s.chain.order.length) {
    const o = counterfactualOrigins(s.chain, id);
    originsCache = {
      id,
      n: s.chain.order.length,
      text: o.roots.length === 0 ? "" :
        ` · ${id}: ${o.roots.length} candidate origin${o.roots.length === 1 ? "" : "s"}, ${o.robust.size} by two disjoint routes`,
    };
  }
  return originsCache.text;
}

// --- view toggle ---
const viewBtn = document.getElementById("viewtoggle") as HTMLButtonElement;
const VIEW_NAMES = ["view: blocks", "view: graph"] as const;
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
  anim.add(80 + 620 * Math.abs(to - from), (t) => { collapseT = from + (to - from) * t; },
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
  recomputeTrace(); // the joint-trace intersection is cluster-wise under the observer
  draw();
  void syncFragment();
}
lensBtn.addEventListener("click", () => setLens(((lens + 1) % 3) as 0 | 1 | 2));

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
function dayLabel(): string {
  return manual !== null
    ? `day ${economy().day} · end turn →`
    : `day ${economy().day} · next day →`;
}
function setScene(s: 0 | 1, minDay = 0): void {
  if (s === 1) {
    economy().runTo(minDay);
    refreshEcoLayouts();
  }
  if (scene !== s) {
    scene = s;
    clearSelection();
  }
  dayBtn.style.display = s === 1 ? "block" : "none";
  if (s === 1) dayBtn.textContent = dayLabel();
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

function stepDay(): void {
  if (manual !== null) harvestChoices();
  // a new day re-lays the whole graph: hold the selection steady on screen
  const before = selectionRect();
  const hold = before
    ? worldToScreen(cam, canvas.clientWidth, canvas.clientHeight,
        before.x + before.w / 2, before.y + before.h / 2)
    : null;
  economy().step();
  refreshEcoLayouts();
  recomputeTrace(); // recompute over the grown chain
  const after = hold ? selectionRect() : null;
  if (after && hold) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    cam = {
      ...cam,
      x: after.x + after.w / 2 - (hold[0] - w / 2) / cam.scale,
      y: after.y + after.h / 2 - (hold[1] - h / 2) / cam.scale,
    };
  }
  dayBtn.textContent = dayLabel();
  renderDecisions();
  draw();
  void syncFragment();
}
dayBtn.addEventListener("click", stepDay);

// --- manual play: the decision panel and the played agent ---
const decisionsPanel = document.getElementById("decisions")!;
function setManual(u: number | null, from?: number): void {
  if (u !== manual) {
    manual = u;
    // takeover starts tomorrow (or at the tutorial's target day): the past
    // stays the dice's, so restores replay identically
    manualFrom = u === null ? 0 : (from ?? economy().day + 1);
    if (eco) {
      eco.manual = manual;
      eco.manualFrom = manualFrom;
    }
  }
  castPanel.querySelectorAll(".play-btn").forEach((b) => {
    const el = b as HTMLButtonElement;
    const mine = Number(el.dataset["play"]) === u;
    el.classList.toggle("on", mine);
    el.textContent = mine ? "playing" : "play";
  });
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
  if (manual === null || scene !== 1) {
    decisionsPanel.style.display = "none";
    return;
  }
  const e = economy();
  const cands = e.candidates(manual);
  const name = castList()[manual]!.name;
  const rows = cands.map((c, i) => {
    const overdue = c.obl.due <= e.day + 1;
    const who = c.obl.payee === null ? "a merchant" : castList()[c.obl.payee]!.name;
    // "wait" is the engine's default; an overdue obligation defaults to a
    // forced payment either way, so only departures get recorded
    const dflt = c.plans.some((p) => p.plan === "wait") ? "wait" : "unilateral";
    const plans = c.plans.map((p) => {
      const funded = p.plan === "wait" ||
        e.canFund(manual!, c.obl.usd, c.feerate, p.plan === "payjoin" ? 1 : 0);
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
  const balance = e.chain.utxos().filter((c) => c.owner === manual).reduce((s, c) => s + c.value, 0);
  decisionsPanel.innerHTML = `<h3><span class="who">${name}</span>'s decisions —
    end the turn to lock them in</h3>
    <p class="role">wallet: ${fmtSats(balance)} sats</p>${rows ||
    `<p class="role">nothing pending — end the turn and the town moves on</p>`}`;
  decisionsPanel.style.display = "block";
}
/** read the panel's radio choices and record them for the coming day */
function harvestChoices(): void {
  const e = economy();
  const cands = e.candidates(manual!);
  decisionsPanel.querySelectorAll(".dec-row").forEach((row) => {
    const i = Number((row as HTMLElement).dataset["i"]);
    const c = cands[i];
    if (!c) return;
    const pick = (row.querySelector("input:checked") as HTMLInputElement | null)?.value as ManualPlan | undefined;
    // only departures from the engine's default behavior are recorded
    if (!pick || pick === (row as HTMLElement).dataset["default"]) return;
    interventions.push({ day: e.day + 1, payer: c.obl.payer, memo: c.obl.memo, due: c.obl.due, plan: pick });
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
    const members = new Set(clustering().members.get(selection.id) ?? []);
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
      // frame the first payjoin transaction (there is one by minDay 45);
      // prefer a 2-input one so the step prose matches on every seed
      const s = active();
      const pjs = eco?.events.filter((e) => e.form === "payjoin") ?? [];
      const ev = pjs.find((e) => eco!.chain.txs.get(e.tid)!.inputs.length === 2) ?? pjs[0];
      const r = ev ? s.bip.txs.get(ev.tid) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 } : s.bip.bounds;
    },
  ),
  ...settlementSteps(
    () => active().bip.bounds,
    () => {
      // frame the first settlement (there is one by minDay 75); prefer a
      // three-party one so the chapter's arithmetic plays out on screen
      const s = active();
      const ev = firstSettlement();
      const r = ev ? s.bip.txs.get(ev.tid) : undefined;
      return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 } : s.bip.bounds;
    },
    () => firstSettlement()?.payer,
  ),
  ...coinjoinSteps(
    () => active().bip.bounds,
    () => txRect(eco?.naiveTid),      // the careless first attempt (day 90)
    () => txRect(denseCoinjoin()),    // a denominated session
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
let m5Cache: { n: number; coin?: Focused; cross?: Focused; toxic?: Focused } | null = null;
function m5Moments(): { coin?: Focused; cross?: Focused; toxic?: Focused } {
  const chain = eco?.chain;
  if (!chain) return {};
  if (m5Cache && m5Cache.n === chain.order.length) return m5Cache;
  const sessions = new Set(eco!.coinjoins.keys());
  const found: typeof m5Cache = { n: chain.order.length };
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

// --- chapter 8: the settlement that pays the played rent. The GAME_DAY
// cycle (rent, shelves, catalogue) settles by GAME_DAY+3 on every seed
// when Judy waits (probed); the finder frames its whole traced past.
let m6Cache: { n: number; hit?: Focused } | null = null;
function gameSettlement(): Focused | undefined {
  const chain = eco?.chain;
  if (!chain) return undefined;
  if (m6Cache && m6Cache.n === chain.order.length) return m6Cache.hit;
  m6Cache = { n: chain.order.length };
  const ev = eco!.events.find((e) =>
    e.form === "settlement" && e.payer === 9 && e.memo === "studio rent" && e.day >= GAME_DAY);
  if (ev && chain.txs.has(ev.tid)) {
    const t = traceTx(chain, ev.tid);
    m6Cache.hit = { id: ev.tid, rect: traceBounds(t.partial.coins, t.partial.txs) };
  }
  return m6Cache.hit;
}

function firstSettlement(): { tid: string; payer: number } | undefined {
  // prefer a full cycle (as many obligations as parties), then any
  // three-party settlement, then whatever exists
  const evs = eco?.events.filter((e) => e.form === "settlement") ?? [];
  const count = (tid: string): number => evs.filter((e) => e.tid === tid).length;
  return (
    evs.find((e) => eco!.chain.txs.get(e.tid)!.inputs.length >= 3 && count(e.tid) >= 3) ??
    evs.find((e) => eco!.chain.txs.get(e.tid)!.inputs.length >= 3) ??
    evs[0]
  );
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
  onScene: (s, minDay) => setScene(s, minDay),
  onSelect: (sel) => {
    if (sel === null) clearSelection();
    else applySelection(sel);
    draw();
  },
  onPlay: (u, minDay) => {
    setManual(u, u === null ? undefined : Math.max(economy().day + 1, minDay));
  },
});

// --- cast panel + inspector ---
const castBtn = document.getElementById("castbtn") as HTMLButtonElement;
const castPanel = document.getElementById("cast")!;
function renderCast(): void {
  castPanel.innerHTML = castList().map((p, u) =>
    `<div class="cast-row" data-u="${u}">
      <span class="swatch" style="background:${ownerColor(u)}"></span>
      <b>${p.name}</b> <span class="role">${p.role}</span>
      <button class="play-btn${manual === u ? " on" : ""}" data-play="${u}" title="take ${p.name}'s decisions yourself">play</button>
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
  const playBtn = (e.target as HTMLElement).closest(".play-btn") as HTMLElement | null;
  if (playBtn) {
    const u = Number(playBtn.dataset["play"]);
    setScene(1, economy().day); // playing only means anything in the economy
    setManual(manual === u ? null : u);
    return;
  }
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
  { key: "wealth", label: "starting wealth", min: 0.25, max: 4, step: 0.25 },
  { key: "oblRate", label: "obligations / edge / day", min: 0, max: 0.3, step: 0.01 },
  { key: "extRate", label: "purchases / person / day", min: 0, max: 0.2, step: 0.01 },
  { key: "pop", label: "population", min: 10, max: MAX_POP, step: 1 },
];
function renderParams(): void {
  paramsPanel.innerHTML = KNOBS.map((k) => {
    const v = params[k.key] ?? DEFAULT_PARAMS[k.key];
    return `<label>${k.label} <output>${v}</output>
      <input type="range" data-key="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" value="${v}"></label>`;
  }).join("") + `
    <label>seed <input type="text" class="seed" value="${seed.replace(/"/g, "&quot;")}"></label>
    <button class="apply">re-roll the world</button>`;
  paramsPanel.querySelectorAll("input[type=range]").forEach((el) => {
    el.addEventListener("input", () => {
      (el.parentElement!.querySelector("output"))!.textContent = (el as HTMLInputElement).value;
    });
  });
  paramsPanel.querySelector(".apply")!.addEventListener("click", applyParams);
}
function applyParams(): void {
  const next: Partial<EconomyParams> = {};
  paramsPanel.querySelectorAll("input[type=range]").forEach((el) => {
    const input = el as HTMLInputElement;
    const key = input.dataset["key"] as keyof EconomyParams;
    const v = Number(input.value);
    if (v !== DEFAULT_PARAMS[key]) next[key] = v;
  });
  const newSeed = (paramsPanel.querySelector(".seed") as HTMLInputElement).value.trim() || "welcome";
  if (newSeed !== seed) {
    // a different world: recorded choices belong to the old one
    interventions = [];
    manual = null;
    manualFrom = 0;
  }
  seed = newSeed;
  params = next;
  // a shrunken town: choices recorded for agents who no longer exist go
  const popNow = Math.max(10, Math.min(MAX_POP, params.pop ?? 10));
  if (manual !== null && manual >= popNow) { manual = null; manualFrom = 0; }
  interventions = interventions.filter((iv) => iv.payer < popNow);
  const day = scene === 1 ? economy().day : 0;
  rebuildEconomy(day);
  setManual(manual); // refresh the cast panel's play buttons
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
    seed,
    cam: [Math.round(cam.x), Math.round(cam.y), Number(cam.scale.toFixed(3))],
  };
  const t = tutorial.currentIndex;
  if (t >= 0) state.t = t;
  if (collapsed) state.v = 2; // encoded like the old third view, for old links
  else if (targetView !== 0) state.v = targetView;
  if (lens !== 0) state.l = lens;
  if (lens === 2 && lensAgent !== null) state.a = lensAgent;
  if (scene === 1) {
    state.sc = 1;
    state.n = economy().day;
  }
  const P: [keyof EconomyParams, keyof NonNullable<FragmentState["p"]>][] = [
    ["oblRate", "o"], ["extRate", "e"], ["feeLevel", "f"], ["feeVol", "fv"], ["wealth", "w"], ["pop", "pp"],
  ];
  const p: NonNullable<FragmentState["p"]> = {};
  for (const [key, short] of P) {
    if (params[key] !== undefined && params[key] !== DEFAULT_PARAMS[key]) p[short] = params[key];
  }
  if (Object.keys(p).length > 0) state.p = p;
  if (manual !== null) state.m = [manual, manualFrom];
  if (interventions.length > 0) {
    state.i = interventions.map((iv) => [iv.day, iv.payer, iv.memo, iv.due, iv.plan]);
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
  if (state?.seed) seed = state.seed;
  if (state?.p) {
    if (state.p.o !== undefined) params.oblRate = state.p.o;
    if (state.p.e !== undefined) params.extRate = state.p.e;
    if (state.p.f !== undefined) params.feeLevel = state.p.f;
    if (state.p.fv !== undefined) params.feeVol = state.p.fv;
    if (state.p.w !== undefined) params.wealth = state.p.w;
    if (state.p.pp !== undefined) params.pop = state.p.pp;
  }
  if (state?.m && state.m[0] < (state.p?.pp ?? PERSONAS.length)) {
    manual = state.m[0];
    manualFrom = state.m[1];
  }
  if (state?.i) {
    interventions = state.i.map(([day, payer, memo, due, plan]) =>
      ({ day, payer, memo, due, plan: plan as ManualPlan }));
  }
  setView(state?.v === 1 || state?.v === 2 ? 1 : 0, false);
  if (state?.v === 2) setCollapsed(true, false);
  if (state?.sc === 1) setScene(1, state.n ?? 0);
  if (manual !== null) setManual(manual); // light the cast panel + decisions
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
