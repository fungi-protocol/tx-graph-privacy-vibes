// Provenance over the observer's map. A cluster is a CLAIM ("these
// coins share an owner"), and every claim rests on links — recorded
// observations, each one a method applied to a transaction (see
// Clustering.links). Two questions keep the claims honest:
//
//   - support(): exhibit one chain of inference — a sequence of links
//     connecting two coins back to base observations. What the claim
//     rests on, stated, not implied.
//   - withoutMethod(): the remove-one-method comparison — re-run the
//     whole analysis with one method disabled and ask whether the two
//     coins still share a cluster. When they do, the exposure survives
//     via an independent evidence route: blocking one heuristic does
//     not restore privacy. The re-run is deterministic and cheap at
//     this scale; there is no incremental belief machinery to get
//     subtly wrong.
//
// Correlated evidence needs no extra bookkeeping here: links citing
// the same transaction are correlated by construction (one observation,
// however many features it feeds), and a re-run with a method disabled
// drops every link that method produced — the double-counting guard
// lives in input construction, not in a fusion layer.
//
// Two boundaries to keep straight when teaching from this ledger:
//   - Links are OWNERSHIP claims, and a link can add an assumption on
//     top of its method's verdict (a subtx link's verdict proves value
//     flow; `assumption: "one-owner-per-part"` is the observer's added
//     reading — see the Link doc comment). support() exhibits the
//     links, assumptions included; it does not launder them into facts.
//   - withoutMethod() measures METHOD-LEVEL survival: does some other
//     TECHNIQUE still link the coins? That is not independent
//     observation-level support — disabling subtx can expose CIOH on
//     the very same transaction, one observation read two ways. A
//     surviving claim means blocking that method wouldn't have helped,
//     not that a second independent observation corroborates it.
import { type Chain, type CoinId } from "../model/chain";
import { clusterObserver, type Clustering, type Heuristics, type Link } from "./clusters";

/**
 * One chain of inference for the claim that `a` and `b` share an owner:
 * a shortest sequence of links in which consecutive links share a coin,
 * the first contains `a` and the last contains `b`. Null when the map
 * never links them (or when either coin is unknown to it). Shortest by
 * link count — there may be other routes; withoutMethod() is the way to
 * ask whether any survive a method's removal.
 */
export function support(cl: Clustering, a: CoinId, b: CoinId): Link[] | null {
  if (a === b) return [];
  const ra = cl.rep.get(a), rb = cl.rep.get(b);
  if (ra === undefined || ra !== rb) return null;
  // BFS over coins, stepping through links (hyperedges)
  const byCoin = new Map<CoinId, Link[]>();
  for (const w of cl.links) {
    for (const c of w.coins) {
      const l = byCoin.get(c);
      if (l) l.push(w); else byCoin.set(c, [w]);
    }
  }
  const via = new Map<CoinId, Link>(); // coin -> link that reached it
  const enteredVia = new Map<Link, CoinId>(); // link -> coin BFS entered through
  let frontier: CoinId[] = [a];
  const seen = new Set<CoinId>([a]);
  while (frontier.length > 0) {
    const next: CoinId[] = [];
    for (const c of frontier) {
      for (const w of byCoin.get(c) ?? []) {
        if (enteredVia.has(w)) continue;
        enteredVia.set(w, c);
        for (const d of w.coins) {
          if (seen.has(d)) continue;
          seen.add(d);
          via.set(d, w);
          if (d === b) {
            const path: Link[] = [];
            let cur: CoinId = b;
            while (cur !== a) {
              const step = via.get(cur)!;
              path.push(step);
              cur = enteredVia.get(step)!;
            }
            return path.reverse();
          }
          next.push(d);
        }
      }
    }
    frontier = next;
  }
  return null; // unreachable if rep matched, kept for safety
}

export type Method = Link["method"];
export const METHODS: Method[] = ["reuse", "cioh", "change", "subtx", "remeet"];

/** Does the claim that `a` and `b` share an owner survive re-analysis
 *  with `method` disabled? A deterministic full re-run, not a DAG
 *  reachability check: removing a method can change what the other
 *  methods see (a sub-transaction verdict suppresses CIOH on that tx,
 *  for example), and only the re-run gets those interactions right.
 *  Survival means another TECHNIQUE still links the coins — possibly
 *  reading the same transaction — not that an independent observation
 *  supports the claim. */
export function withoutMethod(
  chain: Chain,
  usdPrice: ((day: number) => number | undefined) | undefined,
  method: Method,
  a: CoinId,
  b: CoinId,
): boolean {
  const h: Heuristics = { reuse: true, cioh: true, change: true, subsum: true, remeet: true };
  if (method === "reuse") h.reuse = false;
  if (method === "cioh") h.cioh = false;
  if (method === "change") h.change = false;
  if (method === "subtx") h.subsum = false;
  if (method === "remeet") h.remeet = false;
  const cl = clusterObserver(chain, usdPrice, h);
  const ra = cl.rep.get(a);
  return ra !== undefined && ra === cl.rep.get(b);
}

/** The full remove-one-method comparison for a claim: for each method,
 *  whether the claim survives that method's removal. */
export function removeOneMethod(
  chain: Chain,
  usdPrice: ((day: number) => number | undefined) | undefined,
  a: CoinId,
  b: CoinId,
): Map<Method, boolean> {
  const out = new Map<Method, boolean>();
  for (const m of METHODS) out.set(m, withoutMethod(chain, usdPrice, m, a, b));
  return out;
}
