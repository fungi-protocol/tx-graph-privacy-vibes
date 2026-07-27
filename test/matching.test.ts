// The #112 acceptance gate, registered with the reviewers: under
// (a) random representative relabeling and (b) shuffled merge/
// evaluation order, the accepted match SET must be identical, and
// label/order-sensitive candidates must abstain. The mechanism is the
// Narayanan–Shmatikov papers' own: reciprocal unique best partner +
// the eccentricity criterion (margin over the runner-up in units of
// the candidate-score spread). These tests pin the gate itself on
// hand-built score sets, then the end-to-end invariance of both NS
// matchers on a real run: relabeling every cluster representative
// must leave the accepted match partition (as coin sets) unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptReciprocal, type ScoredPair } from "../src/analysis/matching";
import { Economy } from "../src/engine/economy";
import { clusterObserver, type Clustering } from "../src/analysis/clusters";
import { nsSocialRun, nsApply } from "../src/analysis/nssocial";
import { nfRun } from "../src/analysis/nsnetflix";
import { Rng } from "../src/core/prng";
import { type CoinId } from "../src/model/chain";

test("acceptReciprocal: reciprocal unique bests are accepted, one-sided bests are not", () => {
  // a's best is b and b's best is a; c's best is a (taken), so c gets nothing
  const pairs: ScoredPair[] = [
    { a: "a", b: "b", score: 0.9 },
    { a: "a", b: "c", score: 0.3 },
    { a: "b", b: "c", score: 0.2 },
  ];
  assert.deepEqual(acceptReciprocal(pairs, 0.1), [{ a: "a", b: "b", score: 0.9 }]);
});

test("acceptReciprocal: an exact tie for best abstains — no unique partner to accept", () => {
  const pairs: ScoredPair[] = [
    { a: "a", b: "b", score: 0.9 },
    { a: "a", b: "c", score: 0.9 },
  ];
  assert.deepEqual(acceptReciprocal(pairs, 0.1), []);
});

test("acceptReciprocal: a best that does not stand clear of the runner-up abstains (eccentricity)", () => {
  // a's candidates: 0.9, 0.88, 0.1 — the margin over the runner-up is
  // tiny against the spread, so a abstains even though b reciprocates
  const pairs: ScoredPair[] = [
    { a: "a", b: "b", score: 0.9 },
    { a: "a", b: "c", score: 0.88 },
    { a: "a", b: "d", score: 0.1 },
  ];
  assert.deepEqual(acceptReciprocal(pairs, 0.1), []);
  // remove the near-tie (both sides keep an alternative to stand clear
  // of) and the same pair is admitted
  const clear: ScoredPair[] = [
    { a: "a", b: "b", score: 0.9 },
    { a: "a", b: "d", score: 0.1 },
    { a: "b", b: "d", score: 0.1 },
  ];
  assert.deepEqual(acceptReciprocal(clear, 0.1), [{ a: "a", b: "b", score: 0.9 }]);
});

test("acceptReciprocal: a sole candidate abstains — eccentricity is undefined with no alternatives (accuracy/048)", () => {
  // one candidate pair is a fact about how few components remain, not
  // evidence the two are the same person — same family as the tie and
  // flat-spread abstentions
  assert.deepEqual(acceptReciprocal([{ a: "a", b: "b", score: 0.9 }], 0.1), []);
});

test("acceptReciprocal: the threshold gates the shared score", () => {
  const pairs: ScoredPair[] = [
    { a: "a", b: "b", score: 0.4 },
    { a: "a", b: "c", score: 0.1 },
    { a: "b", b: "c", score: 0.1 },
  ];
  assert.equal(acceptReciprocal(pairs, 0.5).length, 0);
  assert.equal(acceptReciprocal(pairs, 0.4).length, 1);
});

test("acceptReciprocal: the accepted set is identical under any input order (seeded shuffles)", () => {
  const rng = new Rng("shuffle-gate");
  const pairs: ScoredPair[] = [];
  const verts = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for (let i = 0; i < verts.length - 1; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      // quantized scores so exact ties actually occur
      pairs.push({ a: verts[i]!, b: verts[j]!, score: Math.round(rng.next() * 8) / 8 });
    }
  }
  const base = acceptReciprocal(pairs, 0.25);
  for (let round = 0; round < 10; round++) {
    const shuffled = [...pairs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    assert.deepEqual(acceptReciprocal(shuffled, 0.25), base, `shuffle ${round} changed the accepted set`);
  }
});

/** the same partition with every cluster re-anchored on its LAST member
 *  (labels change, classes do not) */
function relabel(cl: Clustering): Clustering {
  const members = new Map<CoinId, CoinId[]>();
  const rep = new Map<CoinId, CoinId>();
  const rank = new Map<CoinId, number>();
  for (const [oldRep, ids] of cl.members) {
    const anchor = ids.reduce((m, x) => (x > m ? x : m), ids[0]!);
    members.set(anchor, ids);
    for (const id of ids) rep.set(id, anchor);
    rank.set(anchor, cl.rank.get(oldRep)!);
  }
  return { rep, members, rank, changeGuess: cl.changeGuess, payGuess: cl.payGuess, changeReads: cl.changeReads, links: cl.links };
}

/** label-free digest of a clustering: sorted member lists */
function partitionDigest(cl: Clustering): string {
  return [...cl.members.values()]
    .map((m) => [...m].sort().join(","))
    .sort()
    .join(";");
}

test("ns-social: the accepted match partition is invariant under representative relabeling", () => {
  const eco = new Economy("golden");
  eco.runTo(60);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
  const cl2 = relabel(cl);
  assert.notEqual(
    [...cl.members.keys()].sort().join(","),
    [...cl2.members.keys()].sort().join(","),
    "the relabeling must actually change representatives",
  );
  const runA = nsApply(cl, nsSocialRun(cl, eco.chain, 0.5, 2));
  const runB = nsApply(cl2, nsSocialRun(cl2, eco.chain, 0.5, 2));
  assert.equal(partitionDigest(runA), partitionDigest(runB));
});

test("ns-netflix: the accepted match partition is invariant under representative relabeling", () => {
  const eco = new Economy("golden");
  eco.runTo(80);
  const cl = clusterObserver(eco.chain, (d) => eco.prices[d]!);
  const cl2 = relabel(cl);
  const evA = nfRun(cl, eco.chain, 0.75).map((e) => ({ kind: "merge" as const, ...e }));
  const evB = nfRun(cl2, eco.chain, 0.75).map((e) => ({ kind: "merge" as const, ...e }));
  assert.equal(partitionDigest(nsApply(cl, evA)), partitionDigest(nsApply(cl2, evB)));
});
