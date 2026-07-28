// The layout registry (#141 slice 2): one lookup from a graph cell to
// the geometry that renders it. Every function here computes against
// the FULL scenario record — the rewind cursor is deliberately not an
// input (prefix stability: scrubbing the tape hides coins, it never
// relayouts them), and the results carry the map's intrinsic scale
// (disc radii and slot widths are pure functions of the partition,
// never of the previous zoom).
import { type Chain } from "../model/chain";
import { type Clustering } from "../analysis/clusters";
import { clusterSingletons } from "../analysis/clusters";
import {
  layoutClusterGraph, layoutClusterBand, layoutClusterForceMap,
  layoutClusterColumns, type ClusterLayout,
} from "../ui/clusterlayout";
import { layoutBipartite, type BipLayout } from "../ui/bipartite";
import { layoutForce } from "../ui/force";
import { type GraphCell } from "./state";

/** everything a layout may consume — the full record and the lens's
 *  partition; the ns-social lane assignment only when the segments
 *  (columns) geometry is the target */
export interface LayoutContext {
  /** the FULL scenario chain, never a rewound slice */
  chain: Chain;
  /** the lens's partition (matches fused); ungrouped cells ignore it */
  clustering: Clustering;
  /** ns-social column assignment (segments cells only) */
  nsLanes?: Map<string, number[]>;
}

/** the two geometry vocabularies the app draws: the bipartite plane
 *  (coins as pills, transactions as boxes) and the contracted map
 *  (partition vertices as discs, transactions as strand junctions) */
export type CellLayout =
  | { kind: "bipartite"; bip: BipLayout }
  | { kind: "map"; map: ClusterLayout };

/** the registry: geometry for every defined graph cell. The plane's
 *  ungrouped cells keep the bipartite vocabulary; everything else —
 *  clustered anywhere, and every curve cell — is a contracted map
 *  (ungrouped curve cells contract over the singleton partition: the
 *  bottom of the refinement lattice, literally the coin graph's
 *  vertices on the timeline). */
export function layoutFor(cell: GraphCell, ctx: LayoutContext): CellLayout {
  const mode = cell.arrange === "force" ? "force" as const : "time" as const;
  const cl = cell.grouping === "clustered" ? ctx.clustering : clusterSingletons(ctx.chain);
  if (cell.layout.plane) {
    if (cell.grouping === "ungrouped") {
      return {
        kind: "bipartite",
        bip: cell.arrange === "force" ? layoutForce(ctx.chain) : layoutBipartite(ctx.chain),
      };
    }
    return {
      kind: "map",
      map: cell.arrange === "force"
        ? layoutClusterForceMap(cl, ctx.chain)
        : layoutClusterBand(cl, ctx.chain),
    };
  }
  switch (cell.layout.shape.curve) {
    case "line":
      return { kind: "map", map: layoutClusterBand(cl, ctx.chain, mode) };
    case "circle":
      return { kind: "map", map: layoutClusterGraph(cl, ctx.chain, mode) };
    case "segments": {
      const k = cell.layout.shape.k;
      const lanes = ctx.nsLanes ?? new Map<string, number[]>();
      return { kind: "map", map: layoutClusterColumns(cl, ctx.chain, lanes, k, mode) };
    }
  }
}
