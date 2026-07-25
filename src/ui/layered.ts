// Dot-style layered layout (Sugiyama): nodes come pre-ranked (rank =
// topological depth, drawn as columns left to right); this module decides
// the vertical arrangement. Edges that skip ranks get virtual waypoints so
// they can be routed through the gaps between nodes instead of straight
// across whatever happens to sit in between. Everything is deterministic —
// stable sorts, no randomness — so seeded replays lay out identically.
//
// The three classic phases:
//   1. virtual nodes for rank-skipping edges
//   2. crossing reduction: barycenter sweeps + adjacent-swap transpose
//   3. coordinate assignment: priority method (nodes pull toward the
//      median of their neighbors; straight chains straighten out)

export interface LayeredNode {
  id: string;
  rank: number;
  /** vertical extent, including any caption space below the node */
  h: number;
}

export interface LayeredEdge {
  from: string;
  to: string;
  /** identifies the edge in the routes result */
  key: string;
}

export interface LayeredResult {
  /** top y of each node (x comes from the rank, which the caller owns) */
  y: Map<string, number>;
  /**
   * per edge key: y-centers of the virtual waypoints at each intermediate
   * rank (from.rank+1 .. to.rank-1), empty/absent for adjacent-rank edges
   */
  routes: Map<string, number[]>;
}

interface Slot {
  id: string;
  h: number;
  virtual: boolean;
}

const SWEEPS = 4;
const COORD_PASSES = 10;
const VIRTUAL_H = 6;

export function layered(nodes: LayeredNode[], edges: LayeredEdge[], gap: number): LayeredResult {
  const rankOf = new Map<string, number>();
  const maxRank = nodes.reduce((m, n) => Math.max(m, n.rank), 0);
  for (const n of nodes) rankOf.set(n.id, n.rank);

  // --- phase 1: build per-rank slot lists, inserting virtual nodes ---
  const slots = new Map<string, Slot>();
  const ranks: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  const place = (id: string, rank: number, h: number, virtual: boolean): Slot => {
    const s: Slot = { id, h, virtual };
    slots.set(id, s);
    ranks[rank]!.push(id);
    return s;
  };
  for (const n of nodes) place(n.id, n.rank, n.h, false);

  // adjacency by id (resolved to positions during sweeps)
  const upOf = new Map<string, string[]>();
  const downOf = new Map<string, string[]>();
  const adj = (a: string, b: string): void => {
    (downOf.get(a) ?? downOf.set(a, []).get(a)!).push(b);
    (upOf.get(b) ?? upOf.set(b, []).get(b)!).push(a);
  };

  const routeVias = new Map<string, string[]>();
  for (const e of edges) {
    const r0 = rankOf.get(e.from), r1 = rankOf.get(e.to);
    if (r0 === undefined || r1 === undefined) continue;
    if (r1 - r0 <= 1) {
      adj(e.from, e.to);
      continue;
    }
    let prev = e.from;
    const vias: string[] = [];
    for (let r = r0 + 1; r < r1; r++) {
      const vid = `~${e.key}@${r}`;
      place(vid, r, VIRTUAL_H, true);
      vias.push(vid);
      adj(prev, vid);
      prev = vid;
    }
    adj(prev, e.to);
    routeVias.set(e.key, vias);
  }

  // --- phase 2: crossing reduction ---
  const pos = new Map<string, number>();
  const reindex = (r: number): void => ranks[r]!.forEach((id, i) => pos.set(id, i));
  for (let r = 0; r <= maxRank; r++) reindex(r);

  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  const orderRank = (r: number, neighbors: Map<string, string[]>): void => {
    const keys = ranks[r]!.map((id, i) => {
      const ns = neighbors.get(id);
      return { id, key: ns && ns.length ? median(ns.map((n) => pos.get(n)!)) : i };
    });
    keys.sort((a, b) => a.key - b.key || pos.get(a.id)! - pos.get(b.id)!);
    ranks[r] = keys.map((k) => k.id);
    reindex(r);
  };

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let r = 1; r <= maxRank; r++) orderRank(r, upOf);
    for (let r = maxRank - 1; r >= 0; r--) orderRank(r, downOf);
  }

  // transpose: swap adjacent pairs while it lowers local crossings
  const crossingsIf = (r: number, a: string, b: string): number => {
    // crossings among edges of a and b to both adjacent ranks, with a above b
    let n = 0;
    for (const [na, nb] of [[upOf, upOf], [downOf, downOf]] as const) {
      const ea = na.get(a) ?? [], eb = nb.get(b) ?? [];
      for (const x of ea) for (const y of eb) if (pos.get(x)! > pos.get(y)!) n++;
    }
    return n;
  };
  for (let round = 0; round < 4; round++) {
    let improved = false;
    for (let r = 0; r <= maxRank; r++) {
      const row = ranks[r]!;
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i]!, b = row[i + 1]!;
        if (crossingsIf(r, b, a) < crossingsIf(r, a, b)) {
          row[i] = b; row[i + 1] = a;
          pos.set(b, i); pos.set(a, i + 1);
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // --- phase 3: coordinates (priority method) ---
  const y = new Map<string, number>();
  for (let r = 0; r <= maxRank; r++) {
    const row = ranks[r]!;
    const total = row.reduce((s, id) => s + slots.get(id)!.h + gap, -gap);
    let cur = -total / 2;
    for (const id of row) {
      y.set(id, cur);
      cur += slots.get(id)!.h + gap;
    }
  }
  const center = (id: string): number => y.get(id)! + slots.get(id)!.h / 2;
  const priority = (id: string): number => {
    const s = slots.get(id)!;
    if (s.virtual) return 1e9;
    return (upOf.get(id)?.length ?? 0) + (downOf.get(id)?.length ?? 0);
  };

  const relax = (r: number, neighbors: Map<string, string[]>): void => {
    const row = ranks[r]!;
    const order = row
      .map((id, i) => ({ id, i, p: priority(id) }))
      .sort((a, b) => b.p - a.p || a.i - b.i);
    for (const { id, i, p } of order) {
      const ns = neighbors.get(id);
      if (!ns || !ns.length) continue;
      const want = median(ns.map(center)) - slots.get(id)!.h / 2;
      let delta = want - y.get(id)!;
      if (Math.abs(delta) < 0.5) continue;
      if (delta > 0) {
        // moving down may push lower-priority nodes along, but must stop
        // at the first node of equal-or-higher priority: the pushed block
        // packed at minimum gaps has to fit above it
        let room = Infinity;
        let need = y.get(id)! + slots.get(id)!.h;
        for (let j = i + 1; j < row.length; j++) {
          const nid = row[j]!;
          if (priority(nid) >= p) { room = y.get(nid)! - gap - need; break; }
          need += gap + slots.get(nid)!.h;
        }
        delta = Math.min(delta, Math.max(0, room));
        if (delta <= 0) continue;
        y.set(id, y.get(id)! + delta);
        let floor = y.get(id)! + slots.get(id)!.h + gap;
        for (let j = i + 1; j < row.length; j++) {
          const nid = row[j]!;
          if (y.get(nid)! >= floor) break;
          y.set(nid, floor);
          floor = y.get(nid)! + slots.get(nid)!.h + gap;
        }
      } else {
        let room = Infinity;
        let need = y.get(id)!;
        for (let j = i - 1; j >= 0; j--) {
          const nid = row[j]!;
          if (priority(nid) >= p) { room = need - (y.get(nid)! + slots.get(nid)!.h + gap); break; }
          need -= gap + slots.get(nid)!.h;
        }
        delta = Math.max(delta, -Math.max(0, room));
        if (delta >= 0) continue;
        y.set(id, y.get(id)! + delta);
        let ceil = y.get(id)! - gap;
        for (let j = i - 1; j >= 0; j--) {
          const nid = row[j]!;
          if (y.get(nid)! + slots.get(nid)!.h <= ceil) break;
          y.set(nid, ceil - slots.get(nid)!.h);
          ceil = y.get(nid)! - gap;
        }
      }
    }
  };

  for (let pass = 0; pass < COORD_PASSES; pass++) {
    if (pass % 2 === 0) for (let r = 1; r <= maxRank; r++) relax(r, upOf);
    else for (let r = maxRank - 1; r >= 0; r--) relax(r, downOf);
  }

  const result: LayeredResult = { y: new Map(), routes: new Map() };
  for (const n of nodes) result.y.set(n.id, y.get(n.id)!);
  for (const [key, vias] of routeVias) {
    result.routes.set(key, vias.map((v) => y.get(v)! + VIRTUAL_H / 2));
  }
  return result;
}
