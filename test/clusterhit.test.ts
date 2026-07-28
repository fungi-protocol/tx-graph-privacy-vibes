// Coin-in-disc hit-testing (#141 slice 3d-iii): inside a pile the
// pointer picks out one member dot; between dots the disc answers as
// the cluster; singletons stay cluster hits. coinDotAt is the shared
// geometry — hit answers and the fly-to target land on the same slot.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hitTestClusters, coinDotAt,
  pileOffset, pileScale, discRadius,
  type ClusterLayout,
} from "../src/ui/clusterview";

function world(): {
  clay: ClusterLayout;
  cl: { rep: Map<string, string>; members: Map<string, string[]> };
} {
  const members = new Map<string, string[]>([
    ["a0", ["a0", "a1", "a2", "a3", "a4"]],
    ["s0", ["s0"]],
  ]);
  const rep = new Map<string, string>();
  for (const [r, ms] of members) for (const m of ms) rep.set(m, r);
  const nodes = new Map();
  nodes.set("a0", { rep: "a0", x: 100, y: 100, r: discRadius(5), size: 5 });
  nodes.set("s0", { rep: "s0", x: 300, y: 100, r: discRadius(1), size: 1 });
  const clay: ClusterLayout = { nodes, bounds: { x: 0, y: 0, w: 400, h: 200 } };
  return { clay, cl: { rep, members } };
}

test("a pile dot answers as its coin, exactly where the draw pass puts it", () => {
  const { clay, cl } = world();
  const node = clay.nodes.get("a0")!;
  const pk = pileScale(node.size, node.r);
  for (const id of ["a0", "a2", "a4"]) {
    const p = coinDotAt(clay, cl, id)!;
    const i = cl.members.get("a0")!.indexOf(id);
    const o = pileOffset(i);
    assert.equal(p.x, node.x + o.dx * pk);
    assert.equal(p.y, node.y + o.dy * pk);
    const hit = hitTestClusters(clay, cl, p.x, p.y);
    assert.deepEqual(hit, { kind: "coin", id }, `dot ${id}`);
  }
});

test("between dots (and on the rim) the disc answers as the cluster", () => {
  const { clay, cl } = world();
  const node = clay.nodes.get("a0")!;
  // walk the disc's interior; every answer is either a coin dot within
  // its pick radius or the cluster — and the cluster stays reachable
  const pk = pileScale(node.size, node.r);
  const pick = Math.max(1.8, 5 * pk, 3);
  const dots = cl.members.get("a0")!.map((id, i) => {
    const o = pileOffset(i);
    return { x: node.x + o.dx * pk, y: node.y + o.dy * pk };
  });
  let sawCluster = 0;
  for (let gx = -1; gx <= 1; gx += 0.25) {
    for (let gy = -1; gy <= 1; gy += 0.25) {
      const wx = node.x + gx * node.r, wy = node.y + gy * node.r;
      if ((wx - node.x) ** 2 + (wy - node.y) ** 2 > node.r * node.r) continue;
      const hit = hitTestClusters(clay, cl, wx, wy)!;
      const nearDot = dots.some((d) => (wx - d.x) ** 2 + (wy - d.y) ** 2 <= pick * pick);
      if (hit.kind === "coin") assert.ok(nearDot, `coin answer away from any dot at ${wx},${wy}`);
      else {
        assert.equal(hit.id, "a0");
        sawCluster++;
      }
    }
  }
  assert.ok(sawCluster > 0, "cluster-level clicks stay reachable inside the disc");
});

test("a singleton disc answers as the cluster, dead center included", () => {
  const { clay, cl } = world();
  const node = clay.nodes.get("s0")!;
  assert.deepEqual(hitTestClusters(clay, cl, node.x, node.y), { kind: "cluster", id: "s0" });
  // and its grace radius still applies (tiny discs are hard targets)
  assert.deepEqual(hitTestClusters(clay, cl, node.x + 8, node.y), { kind: "cluster", id: "s0" });
});

test("empty space answers null; coinDotAt of an unknown coin is null", () => {
  const { clay, cl } = world();
  assert.equal(hitTestClusters(clay, cl, 200, 190), null);
  assert.equal(coinDotAt(clay, cl, "nope"), null);
});
