// App shell: a full-window canvas with pan/zoom over an (as yet mostly
// empty) world, seeded from the URL fragment. The transaction graph, the
// tutorial and everything else grow into this.
import { Rng } from "./core/prng";
import { encodeFragment, decodeFragment } from "./ui/fragment";
import { type Camera, worldToScreen, zoomAt } from "./ui/camera";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let cam: Camera = { x: 0, y: 0, scale: 1 };
let seed = "welcome";

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  draw();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // subtle world grid so pan/zoom is perceptible before there is content
  const step = 100;
  ctx.strokeStyle = "#2a2d33";
  ctx.lineWidth = 1;
  const [left, top] = [cam.x - w / 2 / cam.scale, cam.y - h / 2 / cam.scale];
  const [right, bottom] = [cam.x + w / 2 / cam.scale, cam.y + h / 2 / cam.scale];
  for (let gx = Math.floor(left / step) * step; gx <= right; gx += step) {
    const [sx] = worldToScreen(cam, w, h, gx, 0);
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
  }
  for (let gy = Math.floor(top / step) * step; gy <= bottom; gy += step) {
    const [, sy] = worldToScreen(cam, w, h, 0, gy);
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
  }

  // placeholder content: a deterministic constellation from the seed, a
  // stand-in for the transaction graph (proves seed → identical picture)
  const rng = new Rng(seed);
  for (let i = 0; i < 60; i++) {
    const wx = (rng.next() - 0.5) * 1600;
    const wy = (rng.next() - 0.5) * 1000;
    const r = 2 + rng.next() * 4;
    const [sx, sy] = worldToScreen(cam, w, h, wx, wy);
    ctx.beginPath();
    ctx.arc(sx, sy, r * Math.sqrt(cam.scale), 0, Math.PI * 2);
    ctx.fillStyle = "#6d9fd0";
    ctx.fill();
  }

  const hud = document.getElementById("hud")!;
  hud.textContent = `seed ${seed} · zoom ${cam.scale.toFixed(2)}×`;
}

// --- input: drag to pan, wheel to zoom about the cursor ---
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  cam = { ...cam, x: cam.x - (e.clientX - lastX) / cam.scale, y: cam.y - (e.clientY - lastY) / cam.scale };
  lastX = e.clientX; lastY = e.clientY;
  draw();
});
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam = zoomAt(cam, canvas.clientWidth, canvas.clientHeight, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
  draw();
}, { passive: false });

// --- fragment: restore seed on load, keep the URL sharable ---
async function init(): Promise<void> {
  const state = await decodeFragment(location.hash).catch(() => null);
  if (state?.seed) seed = state.seed;
  location.hash = await encodeFragment({ seed });
  resize();
}

window.addEventListener("resize", resize);
void init();
