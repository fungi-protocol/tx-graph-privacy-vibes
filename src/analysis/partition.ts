// The partition-refinement lattice, made explicit (#125).
//
// Every clustering heuristic is, underneath, a partition of the same
// universe of coins, and composing heuristics is lattice arithmetic:
// the JOIN coarsens (union the claims — what the checkboxes do: more
// evidence, more collapsing), the MEET refines (keep only what both
// partitions agree on — how a finer analysis splits a too-coarse one
// back up, the sub-transaction-replaces-CIOH pattern). Synthesis of
// heuristics is a probabilistic choice AMONG discrete partitions and
// these operations on them — never a fuzzy clustering.
//
// The substrate is a union-find with an enumeration ring:
//   parent — forest pointers; the root of a class is its FIRST coin in
//            universe order, which makes the canonical representative
//            deterministic and stable under any merge order.
//   next   — a circular linked list threading each class, so members
//            enumerate in O(size) and two classes merge by splicing the
//            rings in O(1).
// Both arrays start as the identity (every coin a singleton: its own
// parent, its own ring). They are stored as DELTAS from the identity —
// a[i] holds value−i — so a zero-filled Int32Array is the initial
// state for free, and no init loop scales with the universe.
// No union-by-rank/Ackermann machinery: find compresses paths straight
// to the root, and the first-coin rule decides who roots whom.

/** A partition of the universe {0..n-1} into disjoint classes. */
export class Partition {
  /** parent[i] − i (identity ⇒ 0) */
  private p: Int32Array;
  /** next[i] − i, the class's circular enumeration ring (identity ⇒ 0) */
  private nx: Int32Array;
  readonly size: number;

  constructor(n: number) {
    this.size = n;
    this.p = new Int32Array(n);
    this.nx = new Int32Array(n);
  }

  /** the class's canonical representative: its first coin */
  find(i: number): number {
    let r = i;
    while (this.p[r]! !== 0) r += this.p[r]!;
    // path compression: point the walked chain at the root
    while (this.p[i]! !== 0) {
      const up = i + this.p[i]!;
      this.p[i] = r - i;
      i = up;
    }
    return r;
  }

  /** merge the classes of a and b; the smaller first coin stays the
   *  representative. Returns it. O(1) past the two finds. */
  union(a: number, b: number): number {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return ra;
    const lo = ra < rb ? ra : rb, hi = ra < rb ? rb : ra;
    this.p[hi] = lo - hi;
    // splice the rings: swap the successors of the two roots
    const t = this.nx[lo]!;
    this.nx[lo] = this.nx[hi]! + hi - lo;
    this.nx[hi] = t + lo - hi;
    return lo;
  }

  /** true when a and b sit in one class */
  same(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }

  /** the members of i's class, in ring order starting at i */
  members(i: number): number[] {
    const out = [i];
    for (let j = i + this.nx[i]!; j !== i; j += this.nx[j]!) out.push(j);
    return out;
  }

  /** every class, keyed by representative, members sorted ascending */
  classes(): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (let i = 0; i < this.size; i++) {
      const r = this.find(i);
      const g = out.get(r);
      if (g) g.push(i);
      else out.set(r, [i]);
    }
    return out;
  }

  clone(): Partition {
    const c = new Partition(this.size);
    c.p = this.p.slice();
    c.nx = this.nx.slice();
    return c;
  }

  /** does every class of this partition sit inside one class of the
   *  coarser one? (the lattice's order relation: this ≤ coarser) */
  refines(coarser: Partition): boolean {
    if (coarser.size !== this.size) throw new Error("refines: universe mismatch");
    for (let i = 0; i < this.size; i++) {
      if (coarser.find(i) !== coarser.find(this.find(i))) return false;
    }
    return true;
  }
}

/** JOIN: the finest partition both arguments refine — union the merge
 *  claims of both. This is what stacking heuristic checkboxes means. */
export function join(a: Partition, b: Partition): Partition {
  if (a.size !== b.size) throw new Error("join: universe mismatch");
  const out = a.clone();
  for (const [r, ids] of b.classes()) {
    for (const id of ids) out.union(r, id);
  }
  return out;
}

/** MEET: the coarsest common refinement — coins stay together only
 *  where BOTH partitions keep them together. This is how a finer
 *  analysis splits a too-coarse claim back up. */
export function meet(a: Partition, b: Partition): Partition {
  if (a.size !== b.size) throw new Error("meet: universe mismatch");
  const out = new Partition(a.size);
  // group by the pair of class keys; union consecutive members so the
  // first coin of each intersection stays the representative
  const seen = new Map<string, number>();
  for (let i = 0; i < a.size; i++) {
    const key = `${a.find(i)}|${b.find(i)}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else out.union(first, i);
  }
  return out;
}

/** structural equality: same classes, same representatives */
export function samePartition(a: Partition, b: Partition): boolean {
  if (a.size !== b.size) return false;
  for (let i = 0; i < a.size; i++) {
    if (a.find(i) !== b.find(i)) return false;
  }
  return true;
}

/** build a partition from explicit groups over {0..n-1}; ids absent
 *  from every group stay singletons */
export function fromGroups(n: number, groups: number[][]): Partition {
  const out = new Partition(n);
  for (const g of groups) {
    for (let i = 1; i < g.length; i++) out.union(g[0]!, g[i]!);
  }
  return out;
}
