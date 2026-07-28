// Leg interpolators (#141 slice 3b): where every partition vertex is
// DRAWN at progress p through a leg, as pure geometry. The renderer
// asks one function per frame; edges are redrawn from these positions
// by the standing edge contract, so per-leg edge behavior stays
// derived, never separately choreographed.
//
// Vertex identity is the partition rep throughout — a leg never
// creates or destroys vertices (only REPARTITION changes the id set,
// and that leg's fragments carry the correspondence).
import { type ClusterLayout } from "../ui/clusterlayout";
import { type CurveAxis, curveAxis, curlPoint, type SlotItem } from "./curve";

export interface VertexFrame {
  x: number;
  y: number;
  r: number;
}

export type FrameMap = Map<string, VertexFrame>;

/** smoothstep — the standing easing of the positional glides */
export function ease(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return t * t * (3 - 2 * t);
}

/** positional lerp between two layouts of the SAME vertex set:
 *  REARRANGE (band <-> force map, ring reorderings), OPEN/CLOSE
 *  (circle <-> columns), UNFLATTEN's re-separation. A vertex missing
 *  from one side holds the side it has (tolerant, as the pinned-exit
 *  rule requires). */
export function lerpFrames(from: ClusterLayout, to: ClusterLayout, p: number): FrameMap {
  const t = ease(p);
  const out: FrameMap = new Map();
  const reps = new Set([...from.nodes.keys(), ...to.nodes.keys()]);
  for (const rep of reps) {
    const a = from.nodes.get(rep), b = to.nodes.get(rep);
    if (!a && !b) continue;
    if (!a || !b) {
      const n = (a ?? b)!;
      out.set(rep, { x: n.x, y: n.y, r: n.r });
      continue;
    }
    // exact at both ends: the resting frame IS the layout, bit for bit
    if (t <= 0) out.set(rep, { x: a.x, y: a.y, r: a.r });
    else if (t >= 1) out.set(rep, { x: b.x, y: b.y, r: b.r });
    else out.set(rep, {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      r: a.r + (b.r - a.r) * t,
    });
  }
  return out;
}

/** the curl frame: the line bending into the ring (CURL: p = 0 the
 *  line, p = 1 the ring; UNCURL runs the same family with p
 *  reversed). `line` is the flat layout the curl leaves from (the
 *  band's own frame — the alias demands the resting clustered line BE
 *  the band picture), and the family aligns to it exactly at t = 0:
 *
 *    P(s, t) = Pc(s, t) + (1 - t) * (Pline(s) - Pc(s, 0))
 *
 *  Pc is the constant-arc-spacing bending arc (curve.ts); the radius
 *  clamp makes its t = 0 spacing differ from the band's, so the
 *  correction term carries each vertex smoothly from its band slot
 *  onto the arc as the bend takes hold. Order-preserving; both
 *  endpoints exact. Vertices keep their s throughout — the shape is
 *  the only thing that moves them. */
export function curlFrames(line: ClusterLayout, p: number): { frames: FrameMap; axis: CurveAxis } {
  const order = [...line.nodes.values()].sort((a, b) => a.x - b.x || (a.rep < b.rep ? -1 : 1));
  const items: SlotItem[] = order.map((n) => ({ id: n.rep, r: n.r, size: n.size }));
  const axis = curveAxis(items);
  const t = ease(p);
  const frames: FrameMap = new Map();
  for (const n of order) {
    const s = axis.s.get(n.rep)!;
    const pc = curlPoint(axis, s, t);
    const p0 = curlPoint(axis, s, 0);
    frames.set(n.rep, {
      x: pc.x + (1 - t) * (n.x - p0.x),
      y: pc.y + (1 - t) * (n.y - p0.y),
      r: n.r,
    });
  }
  return { frames, axis };
}

/** FLATTEN: every vertex drops from its plane position onto its line
 *  slot (UNFLATTEN reverses). The line IS the target layout; the
 *  plane side is whatever arrangement is showing. Positionally this
 *  is lerpFrames — named separately because the legs differ in what
 *  the renderer does around them (edges bend into the below-row arcs
 *  as the row forms). */
export function flattenFrames(plane: ClusterLayout, line: ClusterLayout, p: number): FrameMap {
  return lerpFrames(plane, line, p);
}

/** REPARTITION (and the glide half of STACK/UNSTACK): each new vertex
 *  starts at the r²-weighted centroid of the old discs its members
 *  came from and glides to its slot — the same rule drawContraction's
 *  posOf applies today, factored pure. `fragments` is
 *  transitionFragments(oldCl, oldClay, newCl). */
export function repartitionFrames(
  to: ClusterLayout,
  fragments: Map<string, { x: number; y: number; r: number }[]>,
  p: number,
): FrameMap {
  const t = ease(p);
  const out: FrameMap = new Map();
  for (const [rep, n] of to.nodes) {
    const frags = fragments.get(rep);
    if (!frags || frags.length === 0 || t >= 1) {
      out.set(rep, { x: n.x, y: n.y, r: n.r });
      continue;
    }
    let sx = 0, sy = 0, w = 0;
    for (const f of frags) {
      const ww = f.r * f.r;
      sx += f.x * ww; sy += f.y * ww; w += ww;
    }
    out.set(rep, {
      x: sx / w + (n.x - sx / w) * t,
      y: sy / w + (n.y - sy / w) * t,
      r: n.r,
    });
  }
  return out;
}
