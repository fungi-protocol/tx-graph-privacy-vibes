// The semantic scene of the contracted graph — the first seam of the
// clusterview split (#115): what EXISTS under a (chain, clustering)
// pair, before any arrangement. Each transaction pinches to a
// junction; each strand between a cluster vertex and a junction is an
// incidence with a stable identity. Layouts compute geometry only, and
// transitions animate incidence ids instead of re-deriving topology
// from geometry — so nothing appears or disappears merely because the
// arrangement changed (clustered vs unclustered, ring vs columns);
// only a change in the underlying partition can create or remove a
// strand.
import { type Chain, type CoinId, type TxId } from "../model/chain";
import { type Clustering } from "../analysis/clusters";

/** one transaction's edges in the contracted graph: the tx vertex
 *  pinches to a junction point, every distinct input cluster feeds it,
 *  and it fans out to every output cluster the inputs don't already
 *  own. No input is orphaned (the old rendering hung all outputs off
 *  inputs[0] and drew nothing for co-funders), and a coin keeps ONE
 *  outgoing strand per spend — the fan-out belongs to the junction,
 *  not to the coin. A tx whose outputs all land back in input clusters
 *  contracts away entirely. */
export interface ContractedEdge { tid: TxId; from: CoinId[]; to: CoinId[] }

/** stable identity of one incidence — a strand between a cluster
 *  vertex and a transaction's junction: transaction + cluster rep +
 *  direction. The SAME id names the same strand in every layout mode
 *  and at every phase of a morph (#115 contract). */
export function incidenceId(tid: TxId, rep: CoinId, dir: "in" | "out"): string {
  return dir === "in" ? `${rep}>${tid}` : `${tid}>${rep}`;
}

/** the contracted scene, derived once per (chain, clustering) pair:
 *  the draw path asks for it every frame and the layouts ask again per
 *  arrangement, so the derivation caches on the partition object (a
 *  Clustering is immutable once computed) and re-derives when the
 *  chain is a different object OR the same object grew in place */
const sceneCache = new WeakMap<Clustering, { chain: Chain; txs: number; edges: ContractedEdge[] }>();
export function contractedScene(chain: Chain, cl: Clustering): ContractedEdge[] {
  const hit = sceneCache.get(cl);
  if (hit && hit.chain === chain && hit.txs === chain.order.length) return hit.edges;
  const edges = contractedEdges(chain, cl);
  sceneCache.set(cl, { chain, txs: chain.order.length, edges });
  return edges;
}

export function contractedEdges(chain: Chain, cl: Clustering): ContractedEdge[] {
  const out: ContractedEdge[] = [];
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const from = [...new Set(tx.inputs.map((i) => cl.rep.get(i)!))];
    const fromSet = new Set(from);
    const to = [...new Set(tx.outputs.map((o) => cl.rep.get(o)!))].filter((r) => !fromSet.has(r));
    if (to.length === 0) continue;
    out.push({ tid, from, to });
  }
  return out;
}
