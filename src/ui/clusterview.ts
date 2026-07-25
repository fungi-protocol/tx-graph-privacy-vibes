// The contracted graph (doc: "by edge contraction ... all of the coins of a
// particular cluster are fused into just one vertex representing the cluster
// itself. The residual edges of this now multigraph correspond to transfers
// of Bitcoin."). With incomplete clustering this is a pseudonym graph, not
// yet a user network.
import { type Chain, type CoinId } from "../model/chain";
import { fmtSats } from "../core/sats";
import { type Clustering, clusterColor } from "../analysis/clusters";
import { type Rect } from "./blockview";
import { type BipLayout } from "./bipartite";

export interface ClusterNode {
  rep: CoinId;
  x: number;
  y: number;
  r: number;
  size: number;
}

export interface ClusterLayout {
  nodes: Map<CoinId, ClusterNode>;
  bounds: Rect;
}

/** Ring layout: clusters around an ellipse, largest first, sized by members. */
export function layoutClusterGraph(cl: Clustering): ClusterLayout {
  const reps = [...cl.members.keys()].sort((a, b) => cl.rank.get(a)! - cl.rank.get(b)!);
  const n = reps.length;
  const R = Math.max(320, (n * 96) / (2 * Math.PI));
  const nodes = new Map<CoinId, ClusterNode>();
  reps.forEach((rep, i) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const size = cl.members.get(rep)!.length;
    nodes.set(rep, {
      rep,
      x: Math.cos(a) * R * 1.35,
      y: Math.sin(a) * R,
      r: 12 + 7 * Math.sqrt(size),
      size,
    });
  });
  return {
    nodes,
    bounds: { x: -R * 1.35 - 80, y: -R - 80, w: 2 * R * 1.35 + 160, h: 2 * R + 160 },
  };
}

function bezier(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  // bow transfer edges toward the ring's center so parallel edges read
  const mx = (x0 + x1) / 2 / 2, my = (y0 + y1) / 2 / 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
}

/**
 * Draw the contraction morph: t = 0 is the bipartite drawing, t = 1 the
 * contracted cluster graph. Coin vertices glide into their cluster's disc
 * and fade; transfer edges fade in.
 */
export function drawContraction(
  ctx: CanvasRenderingContext2D,
  chain: Chain,
  bip: BipLayout,
  clay: ClusterLayout,
  cl: Clustering,
  t: number,
): void {
  const nodeOf = (id: CoinId): ClusterNode => clay.nodes.get(cl.rep.get(id)!)!;

  // residual transfer edges (one per tx output whose source differs)
  ctx.save();
  ctx.globalAlpha = Math.max(0, t * 0.75);
  for (const tid of chain.order) {
    const tx = chain.txs.get(tid)!;
    const from = nodeOf(tx.inputs[0]!);
    for (const out of tx.outputs) {
      const to = nodeOf(out);
      if (to === from) continue; // self-transfer (same inferred cluster) contracts away
      bezier(ctx, from.x, from.y, to.x, to.y);
      ctx.strokeStyle = clusterColor(cl, tx.inputs[0]!) + "70";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  ctx.restore();

  // coins gliding into their cluster's disc
  if (t < 0.98) {
    ctx.save();
    ctx.globalAlpha = 1 - t;
    for (const coin of chain.coins.values()) {
      const from = bip.coins.get(coin.id)!;
      const node = nodeOf(coin.id);
      const x = from.x + (node.x - (from.x + from.w / 2)) * t;
      const y = from.y + (node.y - (from.y + from.h / 2)) * t;
      const w = from.w * (1 - 0.8 * t), h = from.h * (1 - 0.8 * t);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fillStyle = clusterColor(cl, coin.id);
      ctx.fill();
    }
    // tx squares fade toward the midpoint of their transfer
    for (const tid of chain.order) {
      const tx = chain.txs.get(tid)!;
      const from = bip.txs.get(tid)!;
      const a = nodeOf(tx.inputs[0]!), b = nodeOf(tx.outputs[0]!);
      const tx2 = (a.x + b.x) / 2, ty2 = (a.y + b.y) / 2;
      const x = from.x + (tx2 - (from.x + from.w / 2)) * t;
      const y = from.y + (ty2 - (from.y + from.h / 2)) * t;
      ctx.beginPath();
      ctx.roundRect(x, y, from.w * (1 - 0.8 * t), from.h * (1 - 0.8 * t), 8);
      ctx.fillStyle = "#26292f";
      ctx.fill();
      ctx.strokeStyle = "#4a4e57";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // cluster discs
  for (const node of clay.nodes.values()) {
    ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * t);
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r * (0.4 + 0.6 * t), 0, 2 * Math.PI);
    ctx.fillStyle = clusterColor(cl, node.rep);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (t > 0.6 && node.size >= 2) {
      ctx.globalAlpha = (t - 0.6) / 0.4;
      const total = cl.members.get(node.rep)!
        .map((id) => chain.coins.get(id)!)
        .filter((c) => c.dest === null)
        .reduce((s, c) => s + c.value, 0);
      ctx.fillStyle = "#111";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${cl.rank.get(node.rep)}`, node.x, node.y);
      ctx.fillStyle = "#8b919c";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`cluster ${cl.rank.get(node.rep)} · ${node.size} coins`, node.x, node.y + node.r + 12);
      ctx.fillText(`holds ${fmtSats(total)} sats`, node.x, node.y + node.r + 24);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    }
  }
  ctx.globalAlpha = 1;
}

export function hitTestClusters(clay: ClusterLayout, wx: number, wy: number): CoinId | null {
  for (const node of clay.nodes.values()) {
    const dx = wx - node.x, dy = wy - node.y;
    if (dx * dx + dy * dy <= node.r * node.r) return node.rep;
  }
  return null;
}
