// The generalized curve coordinate (#141 slice 2): the ring and the
// band are one curve worn two ways. Every vertex owns a slot on an
// arc-length axis — accumulated slot widths, a seam gap straddling six
// o'clock — and a SHAPE maps that coordinate into the plane: the line
// lays it out straight, the ellipse bends it around the circle. CURL
// tweens the shape while every vertex keeps its s, which is what makes
// the transition a bending motion instead of a point-to-point glide.
//
// The constants here are today's ring/band rules, preserved and
// documented as contracts: slot width 2r + (90 if size >= 2 else 12),
// seam gap max(80, 4% of total), ring radius max(320, T/2pi), the
// 1.35 horizontal stretch that makes the ring an ellipse.

/** a slot holder: a partition vertex with its intrinsic disc radius */
export interface SlotItem {
  id: string;
  r: number;
  size: number;
}

/** arc room by kind: a cluster's slot is its diameter plus a wide gap
 *  so clusters read apart; a singleton's just its own footprint plus a
 *  sliver, so the dust packs tight (PROMPTS ~L934) */
export function slotWidth(size: number, r: number): number {
  return 2 * r + (size >= 2 ? 90 : 12);
}

export interface CurveAxis {
  /** slot-center coordinate per vertex, in input order */
  s: Map<string, number>;
  /** sum of slot widths (without the seam) */
  total: number;
  /** the seam gap at six o'clock */
  gap: number;
  /** full circumference: total + gap */
  T: number;
  /** ring radius under the minimum-radius clamp */
  R: number;
}

/** accumulate the shared axis: each vertex's s is the center of its
 *  slot, in the order given (the caller has already seriated) */
export function curveAxis(items: SlotItem[]): CurveAxis {
  const s = new Map<string, number>();
  let cum = 0;
  for (const it of items) {
    const w = slotWidth(it.size, it.r);
    s.set(it.id, cum + w / 2);
    cum += w;
  }
  const total = Math.max(1, cum);
  const gap = Math.max(80, total * 0.04);
  const T = total + gap;
  const R = Math.max(320, T / (2 * Math.PI));
  return { s, total, gap, T, R };
}

/** the ellipse's horizontal stretch */
export const RING_ASPECT = 1.35;

/** a point of the curl family: t = 0 is the straight line (the ring
 *  cut at the seam and unrolled about its top point, time running left
 *  to right), t = 1 is today's ellipse exactly. In between the curve
 *  is a circular arc of radius R/t anchored at the twelve-o'clock
 *  point, so the timeline visibly bends shut around the seam. The
 *  vertex keeps its s throughout — only the shape moves it. */
export function curlPoint(axis: CurveAxis, s: number, t: number): { x: number; y: number } {
  const { T, R } = axis;
  // angle offset from the seam start; gamma measures from the top
  const beta = ((axis.gap / 2 + s) / T) * 2 * Math.PI;
  const gamma = beta - Math.PI;
  const stretch = 1 + (RING_ASPECT - 1) * t;
  if (t <= 0) {
    // the unrolled ring: arc length from the top, laid along y = -R
    return { x: gamma * R, y: -R };
  }
  const rho = R / t;
  // center below the anchored top point (screen y grows downward)
  const cy = -R + rho;
  const a = 1.5 * Math.PI + gamma * t;
  return { x: stretch * rho * Math.cos(a), y: cy + rho * Math.sin(a) };
}

/** the fully-curled position — today's ring formula, closed form
 *  (equal to curlPoint(axis, s, 1); kept explicit so the layout can
 *  call the contract by name) */
export function ringPoint(axis: CurveAxis, s: number): { x: number; y: number } {
  const a = Math.PI / 2 + ((axis.gap / 2 + s) / axis.T) * 2 * Math.PI;
  return { x: Math.cos(a) * axis.R * RING_ASPECT, y: Math.sin(a) * axis.R };
}

/** the fully-flat position — the band lays the same axis along a
 *  horizontal row at y = 0, starting at x = 0 (its own frame; a
 *  transition composes the similarity that carries one frame onto the
 *  other, the s values agree by construction) */
export function bandPoint(s: number): { x: number; y: number } {
  return { x: s, y: 0 };
}
