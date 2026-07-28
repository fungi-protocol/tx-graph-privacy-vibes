// Semantic scene contracts (#141 slice 1): what selection, focus,
// tutorial references, and fragments address — always stable semantic
// IDs, never render objects. Grouping bunches vertices without
// changing their identity or count; only the tx axis changes the
// render object set (vertex ↔ edge set), and the correspondence here
// keeps a selected transaction selected across that change.

/** the scene, per day and per lens: coins, transactions as directed
 *  hyper-edges, and the partition membership. Renderers project this
 *  into whatever the ViewState says; nothing here knows about pixels. */
export interface SemanticScene {
  coins: string[];
  txs: SemanticTx[];
  /** cluster assignment per coin id (the lens's partition); absent
   *  coins are singletons */
  cluster: Map<string, string>;
}

export interface SemanticTx {
  id: string;
  inputs: string[];
  outputs: string[];
  /** sub-transaction components when the analysis determines a single
   *  most-likely mapping: each component is its own edge set. With the
   *  analysis disabled there is exactly one component — the
   *  transaction itself. When several mappings survive, components stay
   *  undetermined and `possible` marks the union of still-possible
   *  edges (rendered fainter — the opacity ruling). */
  components?: { inputs: string[]; outputs: string[] }[];
  /** edges excluded by every surviving mapping, as [input, output]
   *  pairs — omitted from the drawn product */
  excluded?: [string, string][];
}

/** one strand of a dissolved transaction: an (input, output) pair of
 *  the cartesian product. A strand is never separately attributable —
 *  it addresses its whole transaction. */
export interface Strand {
  tx: string;
  input: string;
  output: string;
  /** false = merely-possible linkage (draws at the possible-edge
   *  opacity factor); true = established by the determined mapping or
   *  by there being only one component */
  certain: boolean;
}

/** the vertex↔edge-set correspondence: the full strand set of a
 *  transaction under its current sub-transaction knowledge. The
 *  product is honest because it is complete — a proper subset of the
 *  in×out product is never drawn as if it were the transaction; what
 *  the analysis EXCLUDES is omitted, what several mappings leave open
 *  draws as possible. */
export function strandsOf(tx: SemanticTx): Strand[] {
  const excluded = new Set((tx.excluded ?? []).map(([i, o]) => `${i}→${o}`));
  const out: Strand[] = [];
  if (tx.components && tx.components.length > 0) {
    for (const c of tx.components) {
      for (const i of c.inputs) {
        for (const o of c.outputs) {
          if (!excluded.has(`${i}→${o}`)) {
            out.push({ tx: tx.id, input: i, output: o, certain: true });
          }
        }
      }
    }
    return out;
  }
  for (const i of tx.inputs) {
    for (const o of tx.outputs) {
      if (excluded.has(`${i}→${o}`)) continue;
      // a lone in/out pair is the whole hyperedge: certain by identity
      const certain = tx.inputs.length === 1 && tx.outputs.length === 1;
      out.push({ tx: tx.id, input: i, output: o, certain });
    }
  }
  return out;
}

/** hit/selection contract shared by both renderings: any strand
 *  addresses its whole transaction */
export function strandTarget(s: Strand): { kind: "tx"; id: string } {
  return { kind: "tx", id: s.tx };
}

/** the edge-set LOD rule: a transaction's bundle stays pinched above
 *  this in×out product size, degrading to the junction rendering */
export const EDGESET_LOD_MAX = 150;
export function dissolves(tx: SemanticTx): boolean {
  return tx.inputs.length * tx.outputs.length <= EDGESET_LOD_MAX;
}

/** display alpha factors: highlight tiers (intersection · union ·
 *  complement) and the certain-vs-possible multiplier (the owner's
 *  opacity ruling). A possible edge in the half-dimmed union layer
 *  draws at 0.5 × 0.45. */
export const HIGHLIGHT_ALPHA = { intersection: 1.0, union: 0.5, complement: 0.15 };
export const POSSIBLE_EDGE_ALPHA = 0.45;
export function strandAlpha(tier: keyof typeof HIGHLIGHT_ALPHA, certain: boolean): number {
  return HIGHLIGHT_ALPHA[tier] * (certain ? 1 : POSSIBLE_EDGE_ALPHA);
}
