// App shell: the block-explorer view of the intro story, with pan/zoom,
// hover, a skippable guided tour, and the right-click "copy reference"
// reviewing aid. Everything else grows into this.
import { encodeFragment, decodeFragment, type FragmentState } from "./ui/fragment";
import { type Camera, worldToScreen, screenToWorld, zoomAt } from "./ui/camera";
import { buildIntroChain } from "./scenario/intro";
import { introSteps } from "./scenario/introSteps";
import { layoutChain, type Hit, type Rect } from "./ui/blockview";
import { layoutBipartite } from "./ui/bipartite";
import { drawMorph, hitTestMorph } from "./ui/morph";
import { Tutorial } from "./ui/tutorial";
import { Animator, easeOutQuad } from "./ui/anim";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const chain = buildIntroChain();
const layout = layoutChain(chain);
const bip = layoutBipartite(chain);

let cam: Camera = { x: 0, y: 0, scale: 1 };
let seed = "welcome";
let hover: Hit | null = null;
let ping: { wx: number; wy: number; t: number } | null = null; // t in [0,1]
let viewT = 0;          // 0 = block explorer, 1 = bipartite (animates between)
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

  // world-space pass: centre-anchored camera
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);
  drawMorph(ctx, chain, layout, bip, viewT, { hover });

  // ephemeral position ping (copy-reference landing marker)
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
  hud.textContent = `seed ${seed} · zoom ${cam.scale.toFixed(2)}× · v: flip view · right-click: copy a reference to what you see`;
}

// --- view toggle (block explorer <-> bipartite) ---
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

// --- animation loop: runs only while tweens are live ---
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
    // the canvas hasn't been laid out yet — replay once it has a size
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
      // interpolate log-scale so zooming feels uniform
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
const tutorial = new Tutorial(introSteps(layout, bip), {
  onFocus: (focus) => flyTo(focus),
  onStepChange: () => void syncFragment(),
  onView: (view) => { if (view !== targetView) setView(view); },
});

// --- fragment sync (shareable URL) ---
let syncTimer: number | undefined;
async function syncFragment(ref?: FragmentState["ref"]): Promise<string> {
  const state: FragmentState = {
    seed,
    cam: [Math.round(cam.x), Math.round(cam.y), Number(cam.scale.toFixed(3))],
  };
  const t = tutorial.currentIndex;
  if (t >= 0) state.t = t;
  if (targetView !== 0) state.v = targetView;
  if (ref) state.ref = ref;
  const frag = await encodeFragment(state);
  history.replaceState(null, "", `#${frag}`);
  return `${location.origin}${location.pathname}#${frag}`;
}
function syncFragmentSoon(): void {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => void syncFragment(), 400);
}

// --- input: drag to pan, wheel to zoom, hover to inspect ---
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
  const hit = hitTestMorph(chain, layout, bip, viewT, wx, wy);
  if (hit?.kind !== hover?.kind || hit?.id !== hover?.id) {
    hover = hit;
    canvas.style.cursor = hit ? "pointer" : "grab";
    draw();
  }
});
canvas.addEventListener("pointerup", () => {
  if (dragging && moved) syncFragmentSoon();
  dragging = false;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam = zoomAt(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
  draw();
  syncFragmentSoon();
}, { passive: false });

// --- reviewing aid: right-click → copy a reference to this exact view ---
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
  const hit = hitTestMorph(chain, layout, bip, viewT, wx, wy);
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

// --- boot: restore shared state from the fragment ---
async function init(): Promise<void> {
  resize();
  const state = await decodeFragment(location.hash).catch(() => null);
  if (state?.seed) seed = state.seed;
  setView(state?.v === 1 ? 1 : 0, false);

  if (state?.cam) {
    cam = { x: state.cam[0], y: state.cam[1], scale: state.cam[2] };
  } else {
    // frame the whole story with a little margin
    const b = layout.bounds;
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
