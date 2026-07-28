// Slice 2 geometry contracts (#141): the shared curve axis and curl
// family (line and ellipse as two shapes of one generalized curve),
// the intrinsic-scale rules (disc radius plateau, slot widths, seam
// gap), seriation by earliest coin, and the layout registry mapping
// graph cells onto geometry computed from the full record.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slotWidth, curveAxis, curlPoint, ringPoint, bandPoint, RING_ASPECT,
  type SlotItem,
} from "../src/engine/curve";
import { layoutFor, type LayoutContext } from "../src/engine/registry";
import { graphCell, PLANE, LINE, CIRCLE, segments, BRIDGE } from "../src/engine/state";
import {
  layoutClusterGraph, layoutClusterBand, layoutClusterForceMap,
  layoutClusterColumns, discRadius,
} from "../src/ui/clusterlayout";
import { type Clustering, clusterObserver, clusterSingletons } from "../src/analysis/clusters";
import { Economy } from "../src/engine/economy";

function partition(groups: string[][]): Clustering {
  const rep = new Map<string, string>();
  const members = new Map<string, string[]>();
  const rank = new Map<string, number>();
  [...groups]
    .sort((a, b) => b.length - a.length)
    .forEach((g, i) => {
      members.set(g[0]!, g);
      rank.set(g[0]!, i + 1);
      for (const id of g) rep.set(id, g[0]!);
    });
  return { rep, members, rank, changeGuess: new Map(), links: [] } as unknown as Clustering;
}

test("slot widths: clusters claim wide arcs, singletons pack tight (#25)", () => {
  assert.equal(slotWidth(1, 5), 2 * 5 + 12);
  assert.equal(slotWidth(2, discRadius(2)), 2 * discRadius(2) + 90);
  assert.equal(slotWidth(40, discRadius(40)), 2 * discRadius(40) + 90);
  // the axis accumulates them, seam gap = max(80, 4% of total)
  const items: SlotItem[] = [
    { id: "a", r: discRadius(3), size: 3 },
    { id: "b", r: 5, size: 1 },
    { id: "c", r: discRadius(2), size: 2 },
  ];
  const axis = curveAxis(items);
  const wa = slotWidth(3, discRadius(3)), wb = slotWidth(1, 5);
  assert.equal(axis.s.get("a"), wa / 2);
  assert.equal(axis.s.get("b"), wa + wb / 2);
  assert.equal(axis.total, wa + wb + slotWidth(2, discRadius(2)));
  assert.equal(axis.gap, Math.max(80, axis.total * 0.04));
  assert.equal(axis.T, axis.total + axis.gap);
  assert.equal(axis.R, Math.max(320, axis.T / (2 * Math.PI)));
});

test("disc radius: the plateau formula, bounded growth (#6)", () => {
  assert.equal(discRadius(1), 5);
  assert.equal(discRadius(2), 12 + 9 * Math.pow(2, 0.25));
  // plateau: quadrupling the membership only doubles the added radius' growth rate
  for (const n of [2, 8, 32, 128]) {
    const step = discRadius(n * 4) - discRadius(n);
    assert.ok(step > 0, "still grows");
    assert.ok(step < discRadius(n) - 5, `plateaus at ${n}`);
  }
});

test("curl family: t=1 IS today's ring, t=0 is the unrolled timeline, s never moves (#141)", () => {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const ring = layoutClusterGraph(cl, eco.chain, "time");
  const band = layoutClusterBand(cl, eco.chain, "time");
  // recover the shared seriation from the band (x ascending) and build
  // the axis over it — the same slot accumulation both layouts ran
  const order = [...band.nodes.values()].sort((a, b) => a.x - b.x);
  const axis = curveAxis(order.map((n) => ({ id: n.rep, r: n.r, size: n.size })));
  for (const n of order) {
    const s = axis.s.get(n.rep)!;
    // the band IS the axis laid straight
    assert.ok(Math.abs(bandPoint(s).x - band.nodes.get(n.rep)!.x) < 1e-9);
    // full curl reproduces layoutClusterGraph exactly
    const r1 = curlPoint(axis, s, 1);
    const rp = ringPoint(axis, s);
    const rn = ring.nodes.get(n.rep)!;
    for (const [got, want] of [[r1.x, rn.x], [r1.y, rn.y], [rp.x, rn.x], [rp.y, rn.y]] as const) {
      assert.ok(Math.abs(got - want) < 1e-6, `${n.rep}: ${got} vs ${want}`);
    }
  }
  // t=0: collinear, time running left to right, spacing preserved
  const flat = order.map((n) => curlPoint(axis, axis.s.get(n.rep)!, 0));
  for (const p of flat) assert.equal(p.y, -axis.R);
  for (let i = 1; i < flat.length; i++) {
    assert.ok(flat[i]!.x > flat[i - 1]!.x, "order preserved on the line");
    const ds = axis.s.get(order[i]!.rep)! - axis.s.get(order[i - 1]!.rep)!;
    // the unrolled ring scales the axis by 2piR/T (the radius clamp)
    const want = ds * (2 * Math.PI * axis.R) / axis.T;
    assert.ok(Math.abs((flat[i]!.x - flat[i - 1]!.x) - want) < 1e-6);
  }
  // continuity in t: no jumps anywhere along the family
  for (const n of [order[0]!, order[Math.floor(order.length / 2)]!, order[order.length - 1]!]) {
    const s = axis.s.get(n.rep)!;
    let prev = curlPoint(axis, s, 0);
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const p = curlPoint(axis, s, Math.min(1, t));
      assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y) < axis.R * 0.55,
        `continuous at t=${t}`);
      prev = p;
    }
  }
  // the ellipse stretch arrives with the curl: a quarter turn past the
  // seam sits at the ring's widest point, RING_ASPECT times the radius
  const quarter = curlPoint(axis, axis.T / 4 - axis.gap / 2, 1);
  assert.ok(Math.abs(quarter.x + axis.R * RING_ASPECT) < 1e-6);
  assert.ok(Math.abs(quarter.y) < 1e-6);
});

test("intrinsic scale: disc radii are a pure function of the partition, identical in every arrangement (#6, #10)", () => {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const lanes = new Map<string, number[]>();
  let i = 0;
  for (const rep of cl.members.keys()) lanes.set(rep, [i++ % 3]);
  const arrangements = [
    layoutClusterBand(cl, eco.chain),
    layoutClusterGraph(cl, eco.chain, "time"),
    layoutClusterGraph(cl, eco.chain, "force"),
    layoutClusterForceMap(cl, eco.chain),
    layoutClusterColumns(cl, eco.chain, lanes, 3),
  ];
  for (const [rep, members] of cl.members) {
    const want = discRadius(members.length);
    for (const lay of arrangements) {
      assert.equal(lay.nodes.get(rep)!.r, want, `${rep}`);
      assert.equal(lay.nodes.get(rep)!.size, members.length);
    }
  }
});

test("seriation: the ring and the band order clusters by earliest coin (#29)", () => {
  const eco = new Economy("welcome");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const day = (id: string): number => {
    const c = eco.chain.coins.get(id)!;
    return c.producer ? eco.chain.txs.get(c.producer)!.timestep : (c.entered ?? -1);
  };
  const earliest = new Map<string, number>();
  for (const [rep, members] of cl.members) {
    earliest.set(rep, Math.min(...members.map(day)));
  }
  const band = layoutClusterBand(cl, eco.chain);
  const order = [...band.nodes.values()].sort((a, b) => a.x - b.x).map((n) => n.rep);
  for (let i = 1; i < order.length; i++) {
    assert.ok(earliest.get(order[i]!)! >= earliest.get(order[i - 1]!)!,
      `${order[i - 1]} (day ${earliest.get(order[i - 1]!)}) before ${order[i]} (day ${earliest.get(order[i]!)})`);
  }
});

test("registry: every graph cell resolves to its geometry, computed from the full record", () => {
  const eco = new Economy("welcome");
  eco.runTo(40);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]);
  const ctx: LayoutContext = { chain: eco.chain, clustering: cl };
  // the bipartite plane keeps its vocabulary
  const bridge = layoutFor(BRIDGE, ctx);
  assert.equal(bridge.kind, "bipartite");
  const forceU = layoutFor(graphCell(PLANE, "force", "ungrouped"), ctx);
  assert.equal(forceU.kind, "bipartite");
  // everything else is a contracted map
  const band = layoutFor(graphCell(PLANE, "sequenced", "clustered"), ctx);
  const ring = layoutFor(graphCell(CIRCLE, "sequenced", "clustered"), ctx);
  const lineU = layoutFor(graphCell(LINE, "sequenced", "ungrouped"), ctx);
  const chordU = layoutFor(graphCell(CIRCLE, "sequenced", "ungrouped"), ctx);
  for (const lay of [band, ring, lineU, chordU]) assert.equal(lay.kind, "map");
  // clustered cells draw the lens partition, ungrouped curves the
  // singleton bottom of the lattice
  if (ring.kind !== "map" || chordU.kind !== "map") return;
  assert.equal(ring.map.nodes.size, cl.members.size);
  assert.equal(chordU.map.nodes.size, clusterSingletons(eco.chain).members.size);
  // ring geometry matches the direct call — the registry adds nothing
  const direct = layoutClusterGraph(cl, eco.chain, "time");
  for (const [rep, n] of direct.nodes) {
    const got = ring.map.nodes.get(rep)!;
    assert.equal(got.x, n.x);
    assert.equal(got.y, n.y);
  }
  // the columns cell consumes the lane assignment
  const lanes = new Map<string, number[]>();
  let i = 0;
  for (const rep of cl.members.keys()) lanes.set(rep, [i++ % 4]);
  const cols = layoutFor(graphCell(segments(4), "sequenced", "clustered"), { ...ctx, nsLanes: lanes });
  assert.equal(cols.kind, "map");
  if (cols.kind === "map") {
    const xs = new Set([...cols.map.nodes.values()].map((n) => Math.round(n.x)));
    assert.ok(xs.size >= 4, "vertices spread across the four lanes");
  }
  // deterministic: the same inputs give the same geometry (prefix
  // stability follows — the cursor is not an input at the type level)
  const again = layoutFor(graphCell(CIRCLE, "sequenced", "clustered"), ctx);
  if (again.kind === "map") {
    for (const [rep, n] of again.map.nodes) {
      const first = ring.map.nodes.get(rep)!;
      assert.equal(n.x, first.x);
      assert.equal(n.y, first.y);
    }
  }
});
