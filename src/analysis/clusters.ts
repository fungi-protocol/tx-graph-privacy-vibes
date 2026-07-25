// Third-party observer clustering: what someone with no names and no colors
// can infer from the public graph alone. Three heuristics from the
// literature, deliberately simple:
//   - CIOH (common-input-ownership): a transaction spending several inputs
//     is evidence one entity owns all of them.
//   - round-USD change identification (Androulaki et al.): if exactly one
//     output of a 2-output payment lands on a round $10 amount at that
//     day's exchange rate, it is probably the payment — so the other
//     output is probably the change, and belongs with the inputs.
//   - subset-sum sub-transaction analysis (Maurer et al.): a transaction
//     with several outputs is checked for partitions into balancing
//     sub-transactions. A unique partition welds each part — inputs AND
//     outputs — together (stronger than CIOH); several valid partitions
//     mean the mapping is underdetermined, and a careful observer
//     declines to weld anything at all.
// Heuristics, not proofs: the change guess can be wrong, and when it is
// wrong it welds a stranger's coin into the cluster. That failure mode is
// left in on purpose.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { subTransactionMapping } from "./subsetsum";

export interface Clustering {
  /** coin -> its cluster's representative coin */
  rep: Map<CoinId, CoinId>;
  /** representative -> member coins, insertion order */
  members: Map<CoinId, CoinId[]>;
  /** representative -> 1-based rank by cluster size (1 = largest) */
  rank: Map<CoinId, number>;
  /** tx -> the output the observer guessed to be change */
  changeGuess: Map<TxId, CoinId>;
}

/**
 * Cluster the chain as a third-party observer would.
 * `usdPrice(day)` is the public exchange rate; omit it (or return
 * undefined) to disable the round-USD change heuristic.
 */
export function clusterObserver(
  chain: Chain,
  usdPrice?: (day: number) => number | undefined,
): Clustering {
  const parent = new Map<CoinId, CoinId>();
  for (const id of chain.coins.keys()) parent.set(id, id);
  const find = (x: CoinId): CoinId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  const union = (a: CoinId, b: CoinId): void => {
    parent.set(find(a), find(b));
  };

  const changeGuess = new Map<TxId, CoinId>();
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    // multi-output spends get the subset-sum treatment first: a unique
    // sub-transaction partition beats CIOH (and identifies outputs too);
    // an underdetermined one suspends it — outputs link to inputs only
    // if the mapping is determined. The >=3-output gate keeps payjoins
    // and settlements on their own heuristics; a 2-output multiparty
    // join (the doc's 4-in/2-out bad coinjoin) would slip past it into
    // CIOH, but no form here produces that shape
    if (tx.inputs.length >= 2 && tx.outputs.length >= 3) {
      const value = (id: CoinId): number => chain.coins.get(id)!.value;
      const map = subTransactionMapping(tx.inputs.map(value), tx.outputs.map(value), tx.fee);
      if (map.kind === "unique") {
        for (const part of map.parts) {
          const anchor = tx.inputs[part.ins[0]!]!;
          for (const i of part.ins) union(tx.inputs[i]!, anchor);
          for (const o of part.outs) union(tx.outputs[o]!, anchor);
        }
        continue;
      }
      // proven ambiguous or merely inconclusive: either way the observer
      // has no partition to justify a link, so it abstains
      if (map.kind === "ambiguous" || map.kind === "inconclusive") continue;
      // atomic: no way to split it — fall through to plain CIOH
    }
    // CIOH: all inputs of one transaction, one owner
    for (let i = 1; i < tx.inputs.length; i++) union(tx.inputs[i]!, tx.inputs[0]!);
    // round-USD change identification
    const price = usdPrice?.(tx.timestep);
    if (price !== undefined && tx.outputs.length === 2) {
      const looksRound = tx.outputs.map((o) => {
        const usd = (chain.coins.get(o)!.value * price) / 1e8;
        return Math.abs(usd - Math.round(usd / 10) * 10) < 0.05;
      });
      const change = looksRound[0] && !looksRound[1] ? tx.outputs[1]!
        : looksRound[1] && !looksRound[0] ? tx.outputs[0]!
        : null;
      if (change) {
        changeGuess.set(tid, change);
        union(change, tx.inputs[0]!);
      }
    }
  }

  const rep = new Map<CoinId, CoinId>();
  const members = new Map<CoinId, CoinId[]>();
  for (const id of chain.coins.keys()) {
    const r = find(id);
    rep.set(id, r);
    const m = members.get(r);
    if (m) m.push(id);
    else members.set(r, [id]);
  }
  // rank clusters by size (largest first), ties broken by representative id
  const ranked = [...members.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const rank = new Map<CoinId, number>();
  ranked.forEach(([r], i) => rank.set(r, i + 1));
  return { rep, members, rank, changeGuess };
}

// a palette deliberately different from the owner colors: the observer's
// map is not the truth, and should not look like it
export const CLUSTER_COLORS = ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
  "#ffd92f", "#e5c494", "#80b1d3", "#fb8072", "#b3de69", "#bc80bd", "#ccebc5"];
/** fill for singleton / low-rank clusters the observer has nothing on */
export const CLUSTER_MISC = "#565b64";

export function clusterColor(cl: Clustering, id: CoinId): string {
  const r = cl.rep.get(id);
  if (r === undefined) return CLUSTER_MISC;
  if (cl.members.get(r)!.length < 2) return CLUSTER_MISC;
  const rk = cl.rank.get(r)!;
  return CLUSTER_COLORS[(rk - 1) % CLUSTER_COLORS.length]!;
}

export function clusterLabel(cl: Clustering, id: CoinId): string {
  const r = cl.rep.get(id);
  if (r === undefined || cl.members.get(r)!.length < 2) return "";
  return `cluster ${cl.rank.get(r)}`;
}
