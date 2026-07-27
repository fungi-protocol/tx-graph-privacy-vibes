import { test } from "node:test";
import assert from "node:assert/strict";
import { Partition, join, meet, samePartition, fromGroups } from "../src/analysis/partition";
import { Rng } from "../src/core/prng";

/** a random partition of {0..n-1}: k seeded classes, coins assigned by draw */
function randomPartition(n: number, rng: Rng): Partition {
  const p = new Partition(n);
  const k = 1 + rng.int(Math.max(1, n >> 1));
  const anchors = Array.from({ length: k }, () => rng.int(n));
  for (let i = 0; i < n; i++) {
    if (rng.next() < 0.7) p.union(anchors[rng.int(k)]!, i);
  }
  return p;
}

test("partition: singletons initially; union merges; first coin is the representative", () => {
  const p = new Partition(8);
  for (let i = 0; i < 8; i++) {
    assert.equal(p.find(i), i);
    assert.deepEqual(p.members(i), [i]);
  }
  p.union(5, 2);
  assert.equal(p.find(5), 2); // the smaller first coin roots the class
  assert.equal(p.find(2), 2);
  p.union(7, 5);
  assert.equal(p.find(7), 2);
  // merge order never changes the canonical representative
  const q = new Partition(8);
  q.union(7, 5);
  q.union(2, 7);
  assert.equal(q.find(5), 2);
  assert.ok(samePartition(p, q));
});

test("partition: the enumeration ring holds exactly the class, from any member", () => {
  const p = fromGroups(10, [[1, 4, 7], [2, 9]]);
  for (const at of [1, 4, 7]) {
    assert.deepEqual(p.members(at).sort((a, b) => a - b), [1, 4, 7]);
  }
  assert.deepEqual(p.members(9).sort((a, b) => a - b), [2, 9]);
  assert.deepEqual(p.members(0), [0]);
  const cls = p.classes();
  assert.deepEqual(cls.get(1), [1, 4, 7]);
  assert.deepEqual(cls.get(2), [2, 9]);
  assert.equal(cls.size, 10 - 3 + 1 - 2 + 1); // 7 classes
});

test("partition: classes partition the universe under seeded random merges", () => {
  const rng = new Rng("partition-rings");
  for (let round = 0; round < 20; round++) {
    const n = 2 + rng.int(60);
    const p = randomPartition(n, rng);
    const seen = new Set<number>();
    for (const [rep, ids] of p.classes()) {
      assert.equal(ids[0], rep, "representative is the class's first coin");
      // the ring agrees with the find-grouping, whichever member starts it
      const viaRing = p.members(ids[rng.int(ids.length)]!).sort((a, b) => a - b);
      assert.deepEqual(viaRing, ids);
      for (const id of ids) {
        assert.ok(!seen.has(id), "classes are disjoint");
        seen.add(id);
      }
    }
    assert.equal(seen.size, n, "classes cover the universe");
  }
});

test("lattice: join coarsens, meet refines, and both bound their arguments", () => {
  const rng = new Rng("partition-lattice");
  for (let round = 0; round < 20; round++) {
    const n = 2 + rng.int(40);
    const a = randomPartition(n, rng);
    const b = randomPartition(n, rng);
    const j = join(a, b);
    const m = meet(a, b);
    // order: meet ≤ a,b ≤ join
    assert.ok(m.refines(a) && m.refines(b), "meet refines both");
    assert.ok(a.refines(j) && b.refines(j), "both refine the join");
    assert.ok(m.refines(j));
    // commutativity (structural, representatives included)
    assert.ok(samePartition(j, join(b, a)));
    assert.ok(samePartition(m, meet(b, a)));
    // idempotence and absorption
    assert.ok(samePartition(join(a, a), a));
    assert.ok(samePartition(meet(a, a), a));
    assert.ok(samePartition(join(a, meet(a, b)), a));
    assert.ok(samePartition(meet(a, join(a, b)), a));
  }
});

test("lattice: meet splits a too-coarse claim exactly where the finer analysis disagrees", () => {
  // CIOH-style collapse claims {0,1,2,3} are one owner; a sub-transaction
  // reading keeps {0,1} and {2,3} apart. The meet keeps only what both
  // agree on — the collapse is split back up, the agreed pairs survive.
  const coarse = fromGroups(6, [[0, 1, 2, 3]]);
  const fine = fromGroups(6, [[0, 1], [2, 3], [4, 5]]);
  const m = meet(coarse, fine);
  assert.deepEqual(m.classes().get(0), [0, 1]);
  assert.deepEqual(m.classes().get(2), [2, 3]);
  assert.deepEqual(m.classes().get(4), [4]); // coarse never joined 4,5
  assert.equal(m.find(5), 5);
});

test("lattice: join is what checkbox stacking means — claims union transitively", () => {
  const cioh = fromGroups(6, [[0, 1], [2, 3]]);
  const change = fromGroups(6, [[1, 2]]);
  const j = join(cioh, change);
  // neither heuristic alone claims 0 and 3 together; the JOIN's
  // transitive closure over both claims does
  assert.deepEqual(j.classes().get(0), [0, 1, 2, 3]);
  assert.equal(j.find(3), 0);
  assert.equal(j.find(4), 4);
});
