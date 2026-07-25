// App shell: two scenes — the intro story and the unilateral economy —
// drawn in either the block-explorer or bipartite view, with pan/zoom,
// hover, click-to-trace ancestry, a guided tour, day stepping, a cast
// panel, and the right-click "copy reference" reviewing aid.
import { encodeFragment, decodeFragment, type FragmentState } from "./ui/fragment";
import { type Camera, worldToScreen, screenToWorld, zoomAt } from "./ui/camera";
import { buildIntroChain } from "./scenario/intro";
import { introSteps } from "./scenario/introSteps";
import { economySteps } from "./scenario/economySteps";
import { PERSONAS, OWNER_COLORS, CARELESS } from "./scenario/cast";
import { Economy } from "./engine/economy";
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
import { layoutChain, type Layout, type Hit, type Rect } from "./ui/blockview";
import { layoutBipartite, type BipLayout } from "./ui/bipartite";
import { drawMorph, hitTestMorph, type Paint } from "./ui/morph";
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
let eco: Economy | null = null;
let ecoScene: SceneData | null = null;
let scene: 0 | 1 = 0;

function economy(): Economy {
  if (!eco) {
    eco = new Economy(seed);
    refreshEcoLayouts();
  }
  return eco;
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
  const name = (o: number | null): string => (o === null ? "a merchant" : PERSONAS[o]!.name);
  return {
    coinFill: (c) => {
      const a = k.coins.get(c.id);
      if (!a) return CLUSTER_MISC;
      const color = a.owner === null ? "#e8e5da" : OWNER_COLORS[a.owner]!;
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
let viewT = 0;          // 0 = block explorer, 1 = bipartite, 2 = clusters
let targetView: 0 | 1 | 2 = 0;

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
  if (viewT <= 1) {
    drawMorph(ctx, s.chain, s.layout, s.bip, viewT, {
      hover, highlight, hideDim,
      ...(lens === 1 ? { paint: observerPaint() } : lens === 2 ? { paint: agentPaint() } : {}),
    });
  } else {
    drawContraction(ctx, s.chain, s.bip, clusterLayout(), clustering(), viewT - 1);
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
  hud.textContent = `seed ${seed}${dayPart} · zoom ${cam.scale.toFixed(2)}× · v: flip view · click: trace · shift-click: trace together · h: hide the rest · right-click: copy a reference${originsPart()}`;
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
const VIEW_NAMES = ["view: blocks", "view: graph", "view: clusters"] as const;
function setView(view: 0 | 1 | 2, animate = true): void {
  targetView = view;
  viewBtn.textContent = VIEW_NAMES[view];
  if (!animate) {
    viewT = view;
    draw();
    void syncFragment();
    return;
  }
  const from = viewT;
  anim.add(500 + 400 * Math.abs(view - from), (t) => { viewT = from + (view - from) * t; }, { done: () => void syncFragment() });
  kick();
}
viewBtn.addEventListener("click", () => setView(((targetView + 1) % 3) as 0 | 1 | 2));

const lensBtn = document.getElementById("lens") as HTMLButtonElement;
function setLens(l: 0 | 1 | 2): void {
  lens = l;
  if (l === 2 && lensAgent === null) lensAgent = defaultLensAgent();
  lensBtn.textContent =
    l === 0 ? "lens: all-seeing" :
    l === 1 ? "lens: observer" :
    `lens: ${PERSONAS[lensAgent ?? 0]!.name}'s`;
  recomputeTrace(); // the joint-trace intersection is cluster-wise under the observer
  draw();
  void syncFragment();
}
lensBtn.addEventListener("click", () => setLens(((lens + 1) % 3) as 0 | 1 | 2));

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "v") setView(((targetView + 1) % 3) as 0 | 1 | 2);
  if (e.key === "o") setLens(((lens + 1) % 3) as 0 | 1 | 2);
  if (e.key === "h") { hideDim = !hideDim; draw(); }
});

// --- scene switching + day stepping ---
const dayBtn = document.getElementById("stepday") as HTMLButtonElement;
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
  if (s === 1) dayBtn.textContent = `day ${economy().day} · next day →`;
  draw();
}
function stepDay(): void {
  economy().step();
  refreshEcoLayouts();
  recomputeTrace(); // recompute over the grown chain
  dayBtn.textContent = `day ${economy().day} · next day →`;
  draw();
  void syncFragment();
}
dayBtn.addEventListener("click", stepDay);

// --- selection: click to trace; shift-click to trace coins together ---
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
function applySelection(hit: Hit, shift = false): void {
  if (shift && hit.kind === "coin" && selection?.kind === "coins") {
    // toggle the coin in the joint trace
    const ids = selection.ids.includes(hit.id)
      ? selection.ids.filter((id) => id !== hit.id)
      : [...selection.ids, hit.id];
    selection = ids.length > 0 ? { kind: "coins", ids } : null;
  } else if (hit.kind === "coin") {
    selection = { kind: "coins", ids: [hit.id] };
  } else {
    selection = { kind: hit.kind, id: hit.id };
  }
  recomputeTrace();
}

/** hit-test whatever the current view phase shows */
function hitAt(wx: number, wy: number): Hit | null {
  const s = active();
  if (viewT > 1.5) {
    const rep = hitTestClusters(clusterLayout(), wx, wy);
    return rep ? { kind: "cluster", id: rep } : null;
  }
  if (viewT > 1) return null; // mid-contraction: nothing stable to hit
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
];
function txRect(tid: string | undefined): Rect {
  const s = active();
  const r = tid ? s.bip.txs.get(tid) : undefined;
  return r ? { x: r.x - 260, y: r.y - 160, w: r.w + 520, h: r.h + 320 } : s.bip.bounds;
}
function denseCoinjoin(): string | undefined {
  // the first denominated session whose mapping stayed underdetermined;
  // the careless one (and any unlucky session) doesn't count
  let best: string | undefined;
  for (const [tid, cj] of eco?.coinjoins ?? []) {
    if (tid === eco?.naiveTid) continue;
    if (best === undefined) best = tid;
    if (!cj.determined && cj.density >= 0.5) return tid;
  }
  return best;
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
const tutorial = new Tutorial(steps, {
  onFocus: (focus) => flyTo(focus),
  onStepChange: () => void syncFragment(),
  onView: (view) => { if (view !== targetView) setView(view); },
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
});

// --- cast panel + inspector ---
const castBtn = document.getElementById("castbtn") as HTMLButtonElement;
const castPanel = document.getElementById("cast")!;
castPanel.innerHTML = PERSONAS.map((p, u) =>
  `<div class="cast-row" data-u="${u}">
    <span class="swatch" style="background:${OWNER_COLORS[u]}"></span>
    <b>${p.name}</b> <span class="role">${p.role}</span>
  </div>`).join("");
castBtn.addEventListener("click", () => {
  const open = getComputedStyle(castPanel).display !== "none";
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
  const p = PERSONAS[u]!;
  const chain = active().chain;
  const utxos = chain.utxos().filter((c) => c.owner === u);
  const total = utxos.reduce((s, c) => s + c.value, 0);
  inspector.innerHTML = `
    <div class="tut-head"><span class="tut-title">
      <span class="swatch" style="background:${OWNER_COLORS[u]}"></span> ${p.name}</span>
      <span class="tut-progress">${p.role}${u === CARELESS ? " ⚠" : ""}</span></div>
    <p>${p.concern}</p>
    <p class="role">wallet: ${utxos.length} coin${utxos.length === 1 ? "" : "s"}, ${fmtSats(total)} sats</p>
    <div class="coins">${utxos.slice(0, 12).map((c) =>
      `<span class="coin-chip" style="background:${OWNER_COLORS[u]}">${fmtSats(c.value)}</span>`).join(" ")}${utxos.length > 12 ? " …" : ""}</div>`;
  inspector.style.display = "block";
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
  if (targetView !== 0) state.v = targetView;
  if (lens !== 0) state.l = lens;
  if (lens === 2 && lensAgent !== null) state.a = lensAgent;
  if (scene === 1) {
    state.sc = 1;
    state.n = economy().day;
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
    // a click: select and trace (shift-click builds a joint trace), or clear
    const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
    const hit = hitAt(wx, wy);
    if (hit) applySelection(hit, e.shiftKey);
    else if (!e.shiftKey) clearSelection();
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
  setView(state?.v === 1 || state?.v === 2 ? state.v : 0, false);
  if (state?.sc === 1) setScene(1, state.n ?? 0);
  // lens after scene: the agent lens defaults to a payee the economy knows
  if (state?.l === 1 || state?.l === 2) {
    if (state.l === 2 && typeof state.a === "number" && PERSONAS[state.a]) lensAgent = state.a;
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
  else if (state?.t === undefined) tutorial.hide();

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
