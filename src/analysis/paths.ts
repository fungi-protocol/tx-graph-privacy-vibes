// Counterfactual paths: how robustly is a coin connected to its candidate
// origins? Every coin's trace runs back to a definite set of root coins;
// what varies is how many of those roots stay plausible under pressure. A
// root connected by a single route hangs by a thread — deanonymize anyone
// along it and the candidate is cut off; where such cuts sever the graph
// into regions, elimination compounds. A root connected by two or more vertex-disjoint
// routes survives any single such cut: no one compromised waypoint can
// separate the coin from that origin.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { ancestry } from "./ancestry";

/**
 * Count vertex-disjoint paths between two transactions, up to `capHint`.
 * Standard node-splitting max-flow: each transaction becomes an in/out
 * pair with internal capacity 1 (uncapped at the endpoints), each coin an
 * edge from its producing transaction to its consuming one.
 */
export function maxflow2(chain: Chain, src: TxId, snk: TxId, capHint = 2): number {
  if (src === snk) return capHint;
  const cap = new Map<string, number>();
  const nbr = new Map<string, Set<string>>();
  const add = (a: string, b: string, c: number): void => {
    cap.set(`${a}>${b}`, (cap.get(`${a}>${b}`) ?? 0) + c);
    if (!cap.has(`${b}>${a}`)) cap.set(`${b}>${a}`, 0);
    if (!nbr.has(a)) nbr.set(a, new Set());
    if (!nbr.has(b)) nbr.set(b, new Set());
    nbr.get(a)!.add(b);
    nbr.get(b)!.add(a);
  };
  for (const tid of chain.order) {
    add(`${tid}#i`, `${tid}#o`, tid === src || tid === snk ? capHint : 1);
  }
  for (const coin of chain.coins.values()) {
    if (coin.producer !== null && coin.dest !== null) {
      add(`${coin.producer}#o`, `${coin.dest}#i`, 1);
    }
  }
  const S = `${src}#i`, T = `${snk}#o`;
  let flow = 0;
  while (flow < capHint) {
    // BFS for an augmenting path
    const prev = new Map<string, string | null>([[S, null]]);
    const q = [S];
    while (q.length > 0) {
      const x = q.shift()!;
      if (x === T) break;
      for (const y of nbr.get(x) ?? []) {
        if (!prev.has(y) && (cap.get(`${x}>${y}`) ?? 0) > 0) {
          prev.set(y, x);
          q.push(y);
        }
      }
    }
    if (!prev.has(T)) break;
    let v = T;
    while (prev.get(v) !== null) {
      const x = prev.get(v)!;
      cap.set(`${x}>${v}`, cap.get(`${x}>${v}`)! - 1);
      cap.set(`${v}>${x}`, cap.get(`${v}>${x}`)! + 1);
      v = x;
    }
    flow += 1;
  }
  return flow;
}

export interface Origins {
  /** every root coin the trace reaches — the candidate origins */
  roots: CoinId[];
  /** the roots still connected by >= 2 vertex-disjoint paths */
  robust: Set<CoinId>;
}

/**
 * A coin's candidate origins and how many survive a single cut. A root
 * enters the graph at the transaction that first spends it; the coin
 * hangs off the transaction that produced it. Roots whose entry IS the
 * producing transaction count as robust — nothing sits between them.
 */
export function counterfactualOrigins(chain: Chain, coin: CoinId): Origins {
  const a = ancestry(chain, coin);
  const roots = [...a.coins].filter((c) => chain.coins.get(c)!.producer === null);
  const producer = chain.coins.get(coin)!.producer;
  const robust = new Set<CoinId>();
  if (producer === null) return { roots, robust }; // a root has no past to trace
  for (const r of roots) {
    const entry = chain.coins.get(r)!.dest;
    if (entry !== null && maxflow2(chain, entry, producer) >= 2) robust.add(r);
  }
  return { roots, robust };
}
