// The contracted graph (doc: "by edge contraction ... all of the coins of a
// particular cluster are fused into just one vertex representing the cluster
// itself. The residual edges of this now multigraph correspond to transfers
// of Bitcoin."). With incomplete clustering this is a pseudonym graph, not
// yet a user network.
import { type Chain, type CoinId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { type Clustering } from "../analysis/clusters";
import { type Layout } from "./blockview";
import { type BipLayout } from "./bipartite";
import { coinRectAt, txRectAt } from "./morph";

// the semantic scene, arrangements, and repartition tween live in
// their own modules (scene.ts / clusterlayout.ts / clustertransition.ts,
// the #115 seam split); re-exported here so existing consumers keep one
// import path while this file shrinks to the renderer + hit-testing
export { type ContractedEdge, incidenceId, contractedScene, contractedEdges } from "./scene";
export {
  type ClusterNode, type ClusterLayout, fitClusterLayout,
  anchorClusterLayout, translateClusterLayout,
  pileOffset, discRadius, pileScale,
  layoutClusterGraph, layoutClusterBand, layoutClusterForceMap, layoutClusterColumns,
  type Strand, type StrandQuad, strandGeometry, splitQuad, lerpQuad, bowControl,
} from "./clusterlayout";
export { type ClusterPaint, type ClusterTransition, truthSlices, transitionFragments } from "./clustertransition";
import { contractedScene } from "./scene";
import { type ClusterNode, type ClusterLayout, pileOffset, pileScale, strandGeometry, lerpQuad } from "./clusterlayout";
import { type ClusterPaint, type ClusterTransition } from "./clustertransition";
import { type MapPose } from "../engine/pose";
import { ease, curlFrames, type FrameMap } from "../engine/legrender";

function bezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): { tx: number; ty: number } {
  // bow transfer edges gently toward the ring's center so parallel edges
  // read — gently, so short rim-neighbor edges (the common case once the
  // ring is seriated by edge weight) hug the rim instead of all diving
  // through the middle. The center is the LAYOUT's center: the ring is
  // laid out around the origin but then fit to wherever the camera was
  // looking, and a bow toward the world origin would drag every edge
  // sideways out of the circle. The bow's depth follows the edge's own
  // length — a fixed fraction of the radius scallops rim-neighbor edges
  // deep into the middle once the ring is large — capped at the center
  // so a long chord never overshoots to the far side.
  const mx0 = (x0 + x1) / 2, my0 = (y0 + y1) / 2;
  const dx = cx - mx0, dy = cy - my0;
  const dc = Math.hypot(dx, dy) || 1;
  const depth = Math.min(0.3 * Math.hypot(x1 - x0, y1 - y0), dc);
  const mx = mx0 + (dx / dc) * depth, my = my0 + (dy / dc) * depth;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  // end tangent (from the control point), for the flow-of-funds arrow
  return { tx: x1 - mx, ty: y1 - my };
}

/** the column layout's two edge shapes: an edge INSIDE one epoch's lane
 *  threads beside the column like an arc diagram (bowed right, deeper
 *  the farther apart its ends), an edge BETWEEN lanes runs straight —
 *  the bipartite reading of the matched columns */
function columnEdge(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  sameLane: boolean,
  bowSign: number,
): { tx: number; ty: number } {
  if (!sameLane) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    return { tx: x1 - x0, ty: y1 - y0 };
  }
  // thread on the column's OUTER side, keeping the gap between lanes
  // clear for the straight cross-lane edges
  const bow = bowSign * Math.min(240, 28 + Math.abs(y1 - y0) * 0.3);
  const mx = (x0 + x1) / 2 + bow, my = (y0 + y1) / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  return { tx: x1 - mx, ty: y1 - my };
}

// the legacy contraction phases: one scalar t, cut into three legs
const DOT_PHASE = 0.16;
const RING_PHASE = 0.6;

/** the legacy-scalar shim (#141 slice 3d): callers that still drive
 *  the morph off one collapseT get the same three-phase schedule they
 *  had, expressed as the pose the renderer now reads. curlT is pinned
 *  at 1 because the legacy flight went STRAIGHT to the ring slots —
 *  without a `line` layout there is no bend to ride. */
export function poseFromScalar(t: number, staged: boolean): MapPose {
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  if (!staged) return { dotT: c(t), pinchT: c(t), flightT: c(t), curlT: 1, stackT: c(t) };
  return {
    dotT: c(t / DOT_PHASE),
    pinchT: c(t),
    flightT: c((t - DOT_PHASE) / (RING_PHASE - DOT_PHASE)),
    curlT: 1,
    stackT: c((t - RING_PHASE) / (1 - RING_PHASE)),
  };
}

/** a small arrowhead at (x1, y1) along the (tx, ty) direction */
function arrowAt(ctx: CanvasRenderingContext2D, x1: number, y1: number, tx: number, ty: number, size = 7): void {
  const d = Math.hypot(tx, ty) || 1;
  const ux = tx / d, uy = ty / d;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * size - uy * size * 0.55, y1 - uy * size + ux * size * 0.55);
  ctx.lineTo(x1 - ux * size + uy * size * 0.55, y1 - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw the contraction morph: t = 0 is the current graph drawing (whatever
 * mix of block and bipartite the morph phase shows), t = 1 the contracted
 * cluster graph — one dimension flattened, the helix seen end-on. With a
 * `ring` (the singleton layout) the morph passes THROUGH the bottom of the
 * refinement lattice, in three legs (#95): the coin pills first shrink in
 * place to bare dots, the dots then flatten into the timeline wrapped
 * around the circle — the same graph in a different layout, its transfer
 * edges riding the moving dots — and only once every coin is in position
 * does the stacking run, each dot sliding along the perimeter into its
 * cluster's stack, eased out so the ending lands gently. Nothing fades: a
 * cluster vertex IS a stack of its member coins (a sunflower pile inside
 * the rim), so the coins that flew are the coins that stack. Expanding
 * unstacks first. `hover` names a vertex under the pointer: its edges and
 * neighbors hold full strength while the rest of the drawing recedes.
 */
export function drawContraction(
  ctx: CanvasRenderingContext2D,
  chain: Chain,
  block: Layout,
  bip: BipLayout,
  morphT: number,
  clay: ClusterLayout,
  cl: Clustering,
  t: number,
  paint: ClusterPaint,
  trans?: ClusterTransition,
  hover?: CoinId,
  ring?: ClusterLayout,
  pose?: MapPose,
  line?: ClusterLayout,
): void {
  const transT = trans ? trans.t : 1;
  // the pose (#141 slice 3d): five sub-scalars, one per motion — the
  // engine's legs drive them; a legacy caller's single t cuts into the
  // same schedule through the shim. The stacking still eases out — the
  // movement used to end too fast (#95).
  const P: MapPose = pose ?? poseFromScalar(t, !!ring);
  const discT = 1 - Math.pow(1 - Math.min(1, P.stackT), 3);
  // tolerant: during an animated exit the collapse state is frozen
  // (main.ts exitFreeze) while the visible chain can keep growing under
  // it, so a coin minted after the pin has no rep and no disc — the
  // drawing passes fall back to the coin's own morph frame instead of
  // reading a slot that does not exist
  const nodeOf = (id: CoinId): ClusterNode | undefined =>
    clay.nodes.get(cl.rep.get(id) ?? id);
  // each coin's slot inside its cluster's stack
  const pileIdx = new Map<CoinId, number>();
  for (const members of cl.members.values()) members.forEach((id, i) => pileIdx.set(id, i));
  const hov = hover !== undefined && clay.nodes.has(hover) ? hover : undefined;
  const neighbors = new Set<CoinId>();
  const touchedTids = new Set<string>();
  if (hov !== undefined) {
    for (const e of contractedScene(chain, cl)) {
      const touches = e.from.includes(hov) || e.to.includes(hov);
      if (!touches) continue;
      touchedTids.add(e.tid);
      for (const r of e.from) if (r !== hov) neighbors.add(r);
      for (const r of e.to) if (r !== hov) neighbors.add(r);
    }
  }

  // where a vertex's disc is DRAWN right now: settled at its layout
  // slot, or mid-flight between its old discs' centroid and the slot
  // while a repartition tween runs — edges follow the gliding discs
  // instead of snapping to the finished layout (#101)
  const posOf = (node: ClusterNode): { x: number; y: number } => {
    if (transT >= 1 || !trans) return node;
    const frags = trans.fragments.get(node.rep);
    if (!frags || frags.length === 0) return node;
    let sx = 0, sy = 0, w = 0;
    for (const f of frags) {
      const ww = f.r * f.r;
      sx += f.x * ww; sy += f.y * ww; w += ww;
    }
    return {
      x: sx / w + (node.x - sx / w) * transT,
      y: sy / w + (node.y - sy / w) * transT,
    };
  };
  // the column layout marks its vertices with lanes; their presence
  // switches the edge shapes from the ring's center-bow to the columns'
  // straight-between / arc-threaded-within pair
  const columns = clay.nodes.size > 0 &&
    clay.nodes.values().next().value!.lanes !== undefined;
  let maxLane = 0;
  if (columns) {
    for (const n of clay.nodes.values()) {
      for (const l of n.lanes ?? []) maxLane = Math.max(maxLane, l);
    }
  }

  // the stacking leg slides each dot along the circle's perimeter into
  // its stack, not straight across the middle: interpolate around the
  // ring's center in polar coordinates
  const pb = (ring ?? clay).bounds;
  const pcx = pb.x + pb.w / 2, pcy = pb.y + pb.h / 2;
  const arcLerp = (x0: number, y0: number, x1: number, y1: number, s: number): { x: number; y: number } => {
    const a0 = Math.atan2(y0 - pcy, x0 - pcx), r0 = Math.hypot(x0 - pcx, y0 - pcy);
    const a1 = Math.atan2(y1 - pcy, x1 - pcx), r1 = Math.hypot(x1 - pcx, y1 - pcy);
    let da = a1 - a0;
    if (da > Math.PI) da -= 2 * Math.PI;
    else if (da < -Math.PI) da += 2 * Math.PI;
    const a = a0 + da * s, rr = r0 + (r1 - r0) * s;
    return { x: pcx + Math.cos(a) * rr, y: pcy + Math.sin(a) * rr };
  };
  // where a coin's curve slot is right now: at the resting layout slot
  // once the curl is done, or riding the line as it bends (#141 slice
  // 3d) — curlFrames gives the bend's shape, and a correction term
  // eased in by the same clock carries each slot onto the RESTING ring
  // exactly (the ring can be anchored elsewhere or force-reordered, so
  // the bend's own endpoint is not it). Frames are memoized per call:
  // every pass this frame must agree.
  let curlMemo: { at: FrameMap; end: FrameMap } | null = null;
  const slotAt = (id: CoinId): { x: number; y: number } | undefined => {
    const rest = ring?.nodes.get(id);
    if (!rest || !line || P.curlT >= 1) return rest;
    if (P.curlT <= 0) {
      const l = line.nodes.get(id);
      return l ? { x: l.x, y: l.y } : rest;
    }
    curlMemo ??= { at: curlFrames(line, P.curlT).frames, end: curlFrames(line, 1).frames };
    const f = curlMemo.at.get(id), f1 = curlMemo.end.get(id);
    if (!f || !f1) return rest;
    const w = ease(P.curlT);
    return { x: f.x + (rest.x - f1.x) * w, y: f.y + (rest.y - f1.y) * w };
  };
  // where a coin is DRAWN right now, through the pose's motions; the
  // edge pass and the dot pass must agree, so it is memoized per frame
  const DOT = 10;
  const posMemo = new Map<CoinId, { x: number; y: number; w: number; h: number }>();
  const coinPos = (id: CoinId): { x: number; y: number; w: number; h: number } => {
    const memo = posMemo.get(id);
    if (memo) return memo;
    const node = nodeOf(id);
    const from = coinRectAt(block, bip, id, morphT) ??
      (node ? { x: node.x, y: node.y, w: DOT, h: DOT } : { x: 0, y: 0, w: 0, h: 0 });
    const cx0 = from.x + from.w / 2, cy0 = from.y + from.h / 2;
    if (!node) {
      // no disc to fly to: shrink in place (see nodeOf)
      const out = {
        x: cx0, y: cy0,
        w: from.w + (DOT - from.w) * t, h: from.h + (DOT - from.h) * t,
      };
      posMemo.set(id, out);
      return out;
    }
    const off = pileOffset(pileIdx.get(id) ?? 0);
    const pk = pileScale(node.size, node.r);
    const px = node.x + off.dx * pk, py = node.y + off.dy * pk;
    const slot = slotAt(id);
    let out: { x: number; y: number; w: number; h: number };
    if (slot) {
      // the pose's motions compose: the pill shrinks in place (dotT),
      // flies to its curve slot (flightT, smoothstepped), which itself
      // may still be bending (curlT), while the stacking glide (stackT)
      // moves the destination on toward the pile — when legs run one at
      // a time this is exactly the old three-phase schedule; when one
      // leg carries several scalars (bridge -> band: STACK flies coins
      // straight into the timeline discs) the composition IS the motion
      const wd = from.w + (DOT - from.w) * P.dotT;
      const hd = from.h + (DOT - from.h) * P.dotT;
      const sF = ease(P.flightT);
      const target = discT <= 0 ? slot
        : columns
          ? { x: slot.x + (px - slot.x) * discT, y: slot.y + (py - slot.y) * discT }
          : arcLerp(slot.x, slot.y, px, py, discT);
      out = sF >= 1
        ? { x: target.x, y: target.y, w: wd, h: hd }
        : { x: cx0 + (target.x - cx0) * sF, y: cy0 + (target.y - cy0) * sF, w: wd, h: hd };
    } else {
      out = {
        x: cx0 + (px - cx0) * t, y: cy0 + (py - cy0) * t,
        w: from.w + (DOT - from.w) * t, h: from.h + (DOT - from.h) * t,
      };
    }
    posMemo.set(id, out);
    return out;
  };

  // the graph's own transfer edges ride the flying coins (#95): from the
  // first frame of the morph each transaction draws as direct coin-to-
  // coin edges between wherever its coins are right now — the layout
  // changes, the graph doesn't. They hand over to the contracted edges
  // as the stacking runs.
  if (ring && P.stackT < 0.98) {
    // on from (nearly) the first frame of any motion — these strands
    // REPLACE the graph view's own edges the moment contraction starts
    const onset = Math.max(P.dotT, P.pinchT, P.flightT, P.stackT);
    const coinEdgeA = 0.55 * Math.min(1, onset * 8) * (1 - discT);
    if (coinEdgeA > 0.01) {
      ctx.save();
      ctx.globalAlpha = coinEdgeA;
      ctx.lineWidth = 1.2;
      // each tx pinches to a junction between its flying coins: every
      // input feeds one strand in, every output takes one strand out —
      // a coin never grows edges its spends don't justify, and no
      // co-funding input is left dangling
      for (const tid of chain.order) {
        const tx = chain.txs.get(tid)!;
        let jx = 0, jy = 0;
        const ends = [...tx.inputs, ...tx.outputs];
        for (const id of ends) {
          const p = coinPos(id);
          jx += p.x; jy += p.y;
        }
        jx /= ends.length; jy /= ends.length;
        ctx.strokeStyle = paint.color(tx.inputs[0]!);
        for (const id of ends) {
          const p = coinPos(id);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(jx, jy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // residual transfer edges. While a transition carries the old
  // arrangement's strand shapes (#129), every incidence id present at
  // both endpoints MORPHS from its old shape to its new one — the same
  // strand, bending from where it was to where it is going — and only
  // ids the partition change itself created or removed fade in or out,
  // exactly the #115 contract. Without strand shapes (or once settled)
  // the edges draw straight from the scene as before.
  if (trans && trans.strands && transT < 1) {
    const oldGeo = trans.strands;
    const newGeo = strandGeometry(chain, cl, clay);
    ctx.save();
    const baseA = Math.max(0.2, discT * 0.75);
    ctx.lineWidth = 1.6;
    // junction squares reform where the lerped legs now meet
    const junctions = new Map<string, { x: number; y: number }>();
    const ids = new Set([...oldGeo.keys(), ...newGeo.keys()]);
    for (const id of ids) {
      const o = oldGeo.get(id), n = newGeo.get(id);
      const s = (n ?? o)!;
      const q = o && n ? lerpQuad(o.quad, n.quad, transT) : (n ?? o)!.quad;
      const fade = o && n ? 1 : o ? 1 - transT : transT;
      if (fade <= 0.02) continue;
      const tx = chain.txs.get(s.tid);
      if (!tx) continue;
      const touched = hov !== undefined && touchedTids.has(s.tid);
      const color = paint.color(tx.inputs[0]!) + (touched ? "e8" : hov !== undefined ? "16" : "70");
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.globalAlpha = baseA * fade;
      ctx.beginPath();
      ctx.moveTo(q.x0, q.y0);
      ctx.quadraticCurveTo(q.cx, q.cy, q.x1, q.y1);
      ctx.stroke();
      if (s.dir === "out") {
        const tanx = q.x1 - q.cx, tany = q.y1 - q.cy;
        const d = Math.hypot(tanx, tany) || 1;
        const back = (clay.nodes.get(s.rep)?.r ?? 6) + 3;
        arrowAt(ctx, q.x1 - (tanx / d) * back, q.y1 - (tany / d) * back, tanx, tany);
      }
      if (s.junction) {
        junctions.set(s.tid, s.dir === "in" ? { x: q.x1, y: q.y1 } : { x: q.x0, y: q.y0 });
      }
    }
    ctx.globalAlpha = baseA;
    for (const j of junctions.values()) {
      const js = 4;
      ctx.beginPath();
      ctx.roundRect(j.x - js, j.y - js, 2 * js, 2 * js, 2);
      ctx.fillStyle = "#26292f";
      ctx.fill();
      ctx.strokeStyle = "#4a4e57";
      ctx.stroke();
    }
    ctx.restore();
  } else {
  // each tx contracts to a junction — every distinct input cluster
  // feeds it, it fans out to every output cluster the inputs don't own
  // (contractedEdges). During a repartition tween without strand
  // shapes they ride the discs, dimming only a little while everything
  // is in flight
  ctx.save();
  ctx.globalAlpha = Math.max(0, discT * 0.75) * (0.5 + 0.5 * transT);
  const ccx = clay.bounds.x + clay.bounds.w / 2, ccy = clay.bounds.y + clay.bounds.h / 2;
  for (const e of contractedScene(chain, cl)) {
    const tx = chain.txs.get(e.tid)!;
    const touched = hov !== undefined && (e.from.includes(hov) || e.to.includes(hov));
    const color = paint.color(tx.inputs[0]!) + (touched ? "e8" : hov !== undefined ? "16" : "70");
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = touched ? 2.6 : 1.6;
    const fromN0 = e.from.map((r) => clay.nodes.get(r));
    const toN0 = e.to.map((r) => clay.nodes.get(r));
    // a pinned collapse state can lag the growing chain (see nodeOf):
    // an edge touching a cluster the layout has never met has nowhere
    // to land this frame — skip it rather than dereference the gap
    if (fromN0.some((n) => !n) || toN0.some((n) => !n)) continue;
    const fromN = fromN0 as ClusterNode[];
    const toN = toN0 as ClusterNode[];
    if (columns) {
      // the column layout keeps its lane-aware pair shapes, one edge
      // per (input cluster, output cluster) pair
      for (const fn of fromN) {
        const p0 = posOf(fn);
        for (const tn of toN) {
          const p1 = posOf(tn);
          const sameLane = fn.lanes !== undefined && tn.lanes !== undefined &&
            fn.lanes.length === 1 && tn.lanes.length === 1 && fn.lanes[0] === tn.lanes[0];
          const bowSign = sameLane && fn.lanes![0]! < (maxLane + 1) / 2 ? -1 : 1;
          const tan = columnEdge(ctx, p0.x, p0.y, p1.x, p1.y, sameLane, bowSign);
          ctx.stroke();
          const d = Math.hypot(tan.tx, tan.ty) || 1;
          arrowAt(ctx,
            p1.x - (tan.tx / d) * (tn.r + 3), p1.y - (tan.ty / d) * (tn.r + 3),
            tan.tx, tan.ty);
        }
      }
      continue;
    }
    if (fromN.length === 1 && toN.length === 1) {
      // the dominant shape — one cluster paying another — stays a
      // single unbroken curve
      const p0 = posOf(fromN[0]!), p1 = posOf(toN[0]!);
      const tan = bezier(ctx, p0.x, p0.y, p1.x, p1.y, ccx, ccy);
      ctx.stroke();
      const d = Math.hypot(tan.tx, tan.ty) || 1;
      arrowAt(ctx,
        p1.x - (tan.tx / d) * (toN[0]!.r + 3), p1.y - (tan.ty / d) * (toN[0]!.r + 3),
        tan.tx, tan.ty);
      continue;
    }
    // several parties in, several out: legs meet at the junction where
    // the tx vertex pinched shut — drawn as a small square so the
    // meeting point reads as the transaction it is, not as edges
    // kinking around an invisible vertex
    let jx = 0, jy = 0;
    for (const n of [...fromN, ...toN]) { const p = posOf(n); jx += p.x; jy += p.y; }
    jx /= fromN.length + toN.length; jy /= fromN.length + toN.length;
    for (const fn of fromN) {
      const p0 = posOf(fn);
      bezier(ctx, p0.x, p0.y, jx, jy, ccx, ccy);
      ctx.stroke();
    }
    for (const tn of toN) {
      const p1 = posOf(tn);
      const tan = bezier(ctx, jx, jy, p1.x, p1.y, ccx, ccy);
      ctx.stroke();
      const d = Math.hypot(tan.tx, tan.ty) || 1;
      arrowAt(ctx,
        p1.x - (tan.tx / d) * (tn.r + 3), p1.y - (tan.ty / d) * (tn.r + 3),
        tan.tx, tan.ty);
    }
    const js = 4;
    ctx.beginPath();
    ctx.roundRect(jx - js, jy - js, 2 * js, 2 * js, 2);
    ctx.fillStyle = "#26292f";
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  }

  // the coins themselves, through every motion — never fading (#95):
  // the pills that shrink are the dots that fly are the stacks that
  // settle. The node pass takes over drawing them at the very end.
  if (P.stackT < 0.98) {
    ctx.save();
    ctx.globalAlpha = 1;
    for (const coin of chain.coins.values()) {
      const p = coinPos(coin.id);
      ctx.beginPath();
      ctx.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, Math.min(12, Math.min(p.w, p.h) / 2));
      ctx.fillStyle = paint.color(coin.id);
      ctx.fill();
    }
    ctx.restore();
  }
  // tx squares fade toward the junction of their (moving) endpoints —
  // the same centroid the edge strands meet at — a transaction is not
  // a coin, so it alone pinches away (its own scalar: the squares hold
  // while the pills shrink, dissolve on the PINCH leg)
  if (P.pinchT < 0.98) {
    ctx.save();
    ctx.globalAlpha = 1 - P.pinchT;
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const from = txRectAt(block, bip, tid, morphT)!;
      let tx2 = 0, ty2 = 0;
      const ends = [...tx.inputs, ...tx.outputs];
      for (const id of ends) {
        const p = coinPos(id);
        tx2 += p.x; ty2 += p.y;
      }
      tx2 /= ends.length; ty2 /= ends.length;
      const x = from.x + (tx2 - (from.x + from.w / 2)) * P.pinchT;
      const y = from.y + (ty2 - (from.y + from.h / 2)) * P.pinchT;
      ctx.beginPath();
      ctx.roundRect(x, y, from.w * (1 - 0.8 * P.pinchT), from.h * (1 - 0.8 * P.pinchT), 8);
      ctx.fillStyle = "#26292f";
      ctx.fill();
      ctx.strokeStyle = "#4a4e57";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // cluster vertices: each one a STACK of its member coins — dots in a
  // sunflower pile inside a rim that marks the partition (#95). Paint is
  // the ground truth per coin, so a wrongly-merged cluster shows mixed
  // colors dot by dot.
  const dot = (x: number, y: number, color: string, r = 5): void => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };
  for (const node of clay.nodes.values()) {
    const focus =
      hov === undefined || node.rep === hov || neighbors.has(node.rep) ? 1 : 0.3;
    const nodeA = (ring ? discT : Math.min(1, 0.25 + 0.75 * t)) * focus;
    if (nodeA <= 0) continue;
    const members = cl.members.get(node.rep) ?? [node.rep];
    const frags = transT < 1 ? trans!.fragments.get(node.rep) : undefined;
    // the stack itself: drawn here once the flight pass hands over, or
    // through a repartition tween — each old piece's coins glide from
    // their old pile slots to their new ones, stacks in motion, nothing
    // fading in or out of existence
    if (P.stackT >= 0.98) {
      ctx.globalAlpha = focus;
      // the pile (and its dots) shrink with the plateauing disc so a
      // large stack still fits inside its rim
      const pk = pileScale(node.size, node.r);
      const dotR = Math.max(1.8, 5 * pk);
      if (frags && frags.length > 0) {
        for (const f of frags) {
          const pk0 = pileScale(f.coins.length, f.r);
          f.coins.forEach((id, i) => {
            const o0 = pileOffset(i);
            const o1 = pileOffset(pileIdx.get(id) ?? 0);
            const x0 = f.x + o0.dx * pk0, y0 = f.y + o0.dy * pk0;
            const x1 = node.x + o1.dx * pk, y1 = node.y + o1.dy * pk;
            const p = columns ? { x: x0 + (x1 - x0) * transT, y: y0 + (y1 - y0) * transT }
              : arcLerp(x0, y0, x1, y1, transT);
            dot(p.x, p.y, paint.color(id), dotR);
          });
        }
      } else {
        for (const id of members) {
          const o = pileOffset(pileIdx.get(id) ?? 0);
          dot(node.x + o.dx * pk, node.y + o.dy * pk, paint.color(id), dotR);
        }
      }
    }
    // the rim marks the partition around the stack
    ctx.globalAlpha = nodeA * transT;
    const r = node.r * (0.4 + 0.6 * discT);
    if (node.size >= 2) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = "#565b64";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const label = paint.label(node.rep);
    if (discT > 0.6 && transT > 0.6 && label) {
      ctx.globalAlpha = ((discT - 0.6) / 0.4) * ((transT - 0.6) / 0.4) * focus;
      // tolerant lookup: the clustering can be computed over the full
      // record while the visible chain is a rewound slice (the worker
      // lands mid-ride), so a member may not be on screen yet
      const total = cl.members.get(node.rep)!
        .map((id) => chain.coins.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c && c.dest === null)
        .reduce((s, c) => s + c.value, 0);
      // a small dark plate keeps the initial legible over the stack's
      // speckle of coin dots
      const center = paint.center(node.rep);
      if (center) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#1b1d22e0";
        ctx.fill();
      }
      ctx.fillStyle = "#d8dade";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(center, node.x, node.y);
      ctx.fillStyle = "#8b919c";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`${label} · ${node.size} coin${node.size === 1 ? "" : "s"}`, node.x, node.y + node.r + 12);
      // a cluster of only-spent coins holds nothing — say so by silence
      // rather than captioning most of the drawing "holds 0 sats"
      if (total > 0) ctx.fillText(`holds ${fmtSats(total)} sats`, node.x, node.y + node.r + 24);
      const score = paint.score?.(node.rep);
      if (score) ctx.fillText(score, node.x, node.y + node.r + (total > 0 ? 36 : 24));
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;
}

/** where a coin's pile dot sits in the contracted map — the same
 *  sunflower slot the draw pass uses */
export function coinDotAt(clay: ClusterLayout, cl: Pick<Clustering, "rep" | "members">, id: CoinId): { x: number; y: number } | null {
  const rep = cl.rep.get(id) ?? id;
  const node = clay.nodes.get(rep);
  if (!node) return null;
  const members = cl.members.get(rep) ?? [rep];
  const pk = pileScale(node.size, node.r);
  const o = pileOffset(Math.max(0, members.indexOf(id)));
  return { x: node.x + o.dx * pk, y: node.y + o.dy * pk };
}

export function hitTestClusters(
  clay: ClusterLayout,
  cl: Pick<Clustering, "rep" | "members">,
  wx: number,
  wy: number,
): { kind: "coin" | "cluster"; id: CoinId } | null {
  for (const node of clay.nodes.values()) {
    const dx = wx - node.x, dy = wy - node.y;
    // singleton discs are tiny; give the pointer a little grace
    const r = Math.max(node.r, 10);
    if (dx * dx + dy * dy > r * r) continue;
    // inside a pile the pointer can pick out one member dot; between
    // dots the disc answers as the cluster, so cluster-level clicks
    // (select, open the person) stay reachable. Singletons stay
    // cluster hits — the disc IS the coin, and the cluster already
    // carries its meaning.
    if (node.size >= 2) {
      const members = cl.members.get(node.rep) ?? [node.rep];
      const pk = pileScale(node.size, node.r);
      const pick = Math.max(1.8, 5 * pk, 3);
      let best: CoinId | null = null;
      let bestD = pick * pick;
      members.forEach((id, i) => {
        const o = pileOffset(i);
        const ddx = wx - (node.x + o.dx * pk), ddy = wy - (node.y + o.dy * pk);
        const d = ddx * ddx + ddy * ddy;
        if (d <= bestD) { bestD = d; best = id; }
      });
      if (best !== null) return { kind: "coin", id: best };
    }
    return { kind: "cluster", id: node.rep };
  }
  return null;
}
