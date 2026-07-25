import { test } from "node:test";
import assert from "node:assert/strict";
import { Chain } from "../src/model/chain";
import { txfee } from "../src/core/sats";
import { layoutChain } from "../src/ui/blockview";
import { layoutBipartite } from "../src/ui/bipartite";
import { blendLayout, blendBip } from "../src/ui/blend";

function grownPair(): { small: Chain; big: Chain } {
  const mk = (extra: boolean): Chain => {
    const c = new Chain();
    c.addRoot("a", 1_000_000, 0);
    c.addRoot("b", 800_000, 1);
    const fee = txfee(1, 2, 2);
    c.addTx("t1", 1, ["a"], [
      { owner: 1, value: 400_000 },
      { owner: 0, value: 600_000 - fee },
    ], 2);
    if (extra) {
      c.addTx("t2", 2, ["b", "t1o1"], [
        { owner: 2, value: 1_000_000 },
        { owner: 1, value: 200_000 - txfee(2, 2, 2) },
      ], 2);
    }
    return c;
  };
  return { small: mk(false), big: mk(true) };
}

test("day-blend endpoints reproduce the source and target layouts", () => {
  const { small, big } = grownPair();
  const a = layoutChain(small), b = layoutChain(big);
  const at0 = blendLayout(a, b, 0), at1 = blendLayout(a, b, 1);
  // shared entities start at their old frame and end at their new one
  assert.deepEqual(at0.txs.get("t1"), a.txs.get("t1"));
  assert.deepEqual(at1.txs.get("t1"), b.txs.get("t1"));
  assert.deepEqual(at0.roots.get("a"), a.roots.get("a"));
  assert.deepEqual(at1.roots.get("a"), b.roots.get("a"));
  // an entity new to the target sits at its final frame throughout
  assert.deepEqual(at0.txs.get("t2"), b.txs.get("t2"));
  // the blend covers everything the target draws
  assert.equal(at0.coinBoxes.length, b.coinBoxes.length);
  assert.equal(at0.edges.length, b.edges.length);
});

test("day-blend midpoint interpolates and edges track blended boxes", () => {
  const { small, big } = grownPair();
  const a = layoutChain(small), b = layoutChain(big);
  const mid = blendLayout(a, b, 0.5);
  const ra = a.txs.get("t1")!, rb = b.txs.get("t1")!, rm = mid.txs.get("t1")!;
  assert.equal(rm.y, (ra.y + rb.y) / 2);
  // the edge into t1 references the same rect object as coin a's blended box
  const e = mid.edges.find((x) => x.coin === "a")!;
  const box = mid.coinBoxes.find((cb) => cb.coin === "a" && cb.role === "root")!;
  assert.deepEqual(e.from, box.rect);
});

test("bipartite day-blend behaves the same way", () => {
  const { small, big } = grownPair();
  const a = layoutBipartite(small), b = layoutBipartite(big);
  const at0 = blendBip(a, b, 0), at1 = blendBip(a, b, 1);
  assert.deepEqual(at0.coins.get("t1o1"), a.coins.get("t1o1"));
  assert.deepEqual(at1.coins.get("t1o1"), b.coins.get("t1o1"));
  assert.deepEqual(at0.txs.get("t2"), b.txs.get("t2"));
  assert.deepEqual(at1.bounds, b.bounds);
});
