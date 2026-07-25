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
import { ancestry, txAncestry, type Ancestry } from "./analysis/ancestry";
import { layoutChain, type Layout, type Hit, type Rect } from "./ui/blockview";
import { layoutBipartite, type BipLayout } from "./ui/bipartite";
import { drawMorph, hitTestMorph } from "./ui/morph";
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

let cam: Camera = { x: 0, y: 0, scale: 1 };
let hover: Hit | null = null;
let selected: Hit | null = null;
let highlight: Ancestry | null = null;
let ping: { wx: number; wy: number; t: number } | null = null;
let viewT = 0;          // 0 = block explorer, 1 = bipartite
let targetView: 0 | 1 = 0;

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
  drawMorph(ctx, s.chain, s.layout, s.bip, viewT, { hover, highlight });

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
  hud.textContent = `seed ${seed}${dayPart} · zoom ${cam.scale.toFixed(2)}× · v: flip view · click: trace · right-click: copy a reference`;
}

// --- view toggle ---
const viewBtn = document.getElementById("viewtoggle") as HTMLButtonElement;
function setView(view: 0 | 1, animate = true): void {
  targetView = view;
  viewBtn.textContent = view === 0 ? "view: blocks" : "view: graph";
  if (!animate) {
    viewT = view;
    draw();
    void syncFragment();
    return;
  }
  const from = viewT;
  anim.add(800, (t) => { viewT = from + (view - from) * t; }, { done: () => void syncFragment() });
  kick();
}
viewBtn.addEventListener("click", () => setView(targetView === 0 ? 1 : 0));
window.addEventListener("keydown", (e) => {
  if (e.key === "v" && !e.metaKey && !e.ctrlKey && !e.altKey) setView(targetView === 0 ? 1 : 0);
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
  if (highlight && selected) applySelection(selected); // recompute over grown chain
  dayBtn.textContent = `day ${economy().day} · next day →`;
  draw();
  void syncFragment();
}
dayBtn.addEventListener("click", stepDay);

// --- selection: click to trace ancestry ---
function clearSelection(): void {
  selected = null;
  highlight = null;
}
function applySelection(hit: Hit): void {
  const s = active();
  selected = hit;
  highlight = hit.kind === "coin" ? ancestry(s.chain, hit.id) : txAncestry(s.chain, hit.id);
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
];
const tutorial = new Tutorial(steps, {
  onFocus: (focus) => flyTo(focus),
  onStepChange: () => void syncFragment(),
  onView: (view) => { if (view !== targetView) setView(view); },
  onScene: (s, minDay) => setScene(s, minDay),
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
  const s = active();
  const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
  const hit = hitTestMorph(s.chain, s.layout, s.bip, viewT, wx, wy);
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
    // a click: select and trace, or clear
    const s = active();
    const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
    const hit = hitTestMorph(s.chain, s.layout, s.bip, viewT, wx, wy);
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
  const s = active();
  const [wx, wy] = screenToWorld(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY);
  const hit = hitTestMorph(s.chain, s.layout, s.bip, viewT, wx, wy);
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
  setView(state?.v === 1 ? 1 : 0, false);
  if (state?.sc === 1) setScene(1, state.n ?? 0);

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
