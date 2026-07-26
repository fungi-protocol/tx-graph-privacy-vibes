// Layout interpolation for day transitions: when the chain grows and the
// whole graph re-lays, entities present in both layouts glide from their
// old frame to the new one, so a day passing is a movement the eye can
// follow instead of a cut. Entities new to the target layout appear at
// their final frame (there is no old position to come from).
import { type Layout, type Rect } from "./blockview";
import { type BipLayout } from "./bipartite";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

function blendRects<K>(a: Map<K, Rect>, b: Map<K, Rect>, t: number): Map<K, Rect> {
  const out = new Map<K, Rect>();
  for (const [k, rb] of b) {
    const ra = a.get(k);
    out.set(k, ra ? lerpRect(ra, rb, t) : rb);
  }
  return out;
}

/** waypoints lerp pointwise when both versions route the same way;
 *  a re-routed edge just takes its new path */
function blendRoutes(
  a: Map<string, { x: number; y: number }[]>,
  b: Map<string, { x: number; y: number }[]>,
  t: number,
): Map<string, { x: number; y: number }[]> {
  const out = new Map<string, { x: number; y: number }[]>();
  for (const [k, wb] of b) {
    const wa = a.get(k);
    out.set(k, wa && wa.length === wb.length
      ? wb.map((p, i) => ({ x: lerp(wa[i]!.x, p.x, t), y: lerp(wa[i]!.y, p.y, t) }))
      : wb);
  }
  return out;
}

export function blendLayout(a: Layout, b: Layout, t: number): Layout {
  // coin boxes are keyed by (coin, role) — a coin is spent by exactly one
  // tx, so the pair is unique; edges must reference the blended rects so
  // they track the boxes they connect
  const boxAt = new Map<string, Rect>();
  for (const cb of a.coinBoxes) boxAt.set(`${cb.role}:${cb.coin}`, cb.rect);
  const coinBoxes = b.coinBoxes.map((cb) => {
    const ra = boxAt.get(`${cb.role}:${cb.coin}`) ??
      (cb.role !== "in" ? boxAt.get(`root:${cb.coin}`) ?? boxAt.get(`out:${cb.coin}`) : undefined);
    return { ...cb, rect: ra ? lerpRect(ra, cb.rect, t) : cb.rect };
  });
  const blended = new Map<string, Rect>();
  for (const cb of coinBoxes) blended.set(`${cb.role}:${cb.coin}`, cb.rect);
  const producing = (coin: string): Rect | undefined =>
    blended.get(`root:${coin}`) ?? blended.get(`out:${coin}`);
  const edges = b.edges.map((e) => ({
    coin: e.coin,
    from: producing(e.coin) ?? e.from,
    to: blended.get(`in:${e.coin}`) ?? e.to,
  }));
  const txs = blendRects(a.txs, b.txs, t);
  const roots = blendRects(a.roots, b.roots, t);
  return {
    txs, roots, coinBoxes, edges,
    routes: blendRoutes(a.routes, b.routes, t),
    bounds: lerpRect(a.bounds, b.bounds, t),
  };
}

export function blendBip(a: BipLayout, b: BipLayout, t: number): BipLayout {
  return {
    coins: blendRects(a.coins, b.coins, t),
    txs: blendRects(a.txs, b.txs, t),
    routes: blendRoutes(a.routes, b.routes, t),
    // the radial edge reading follows the destination layout: a glide
    // toward the force drawing draws its edges the force way throughout
    ...(b.radial ? { radial: true } : {}),
    bounds: lerpRect(a.bounds, b.bounds, t),
  };
}
