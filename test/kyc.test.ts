// #67: exchange use and the KYC observer. Exchange routing is
// retroactive and pure (per-id seeded streams over the record), so the
// recorded economies replay bit-identically; the kyc flag is the
// exchange's private books, and the ONLY reader is the grant
// constructor. The auxiliary-information slider generalizes the lens
// spectrum: fraction 0 is the plain observer, fraction 1 is
// omniscience, the KYC records clamp a floor of specific coins, and
// grants compound over the observer's own clustering — attribution
// wholesale for unanimous clusters, nothing for conflicted ones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Economy } from "../src/engine/economy";
import { CARELESS } from "../src/scenario/cast";
import {
  kycGrants, auxGrants, observerGrants, grantAttribution, grantMerges,
  clusterGrantOwners,
} from "../src/analysis/auxinfo";
import { clusterObserver, clusterByOwner, type Clustering } from "../src/analysis/clusters";
import { nsApply, nsSocialRun, activePairs } from "../src/analysis/nssocial";
import { type CoinId, type Owner } from "../src/model/chain";

function economy(days = 40): Economy {
  const eco = new Economy("golden");
  eco.runTo(days);
  return eco;
}

test("exchange routing: withdrawals are always on the books, and the flag is stable as the story grows", () => {
  const eco = economy(60);
  let withdrawals = 0;
  for (const c of eco.chain.coins.values()) {
    if (c.producer !== null) continue;
    assert.notEqual(c.kyc, undefined, `root ${c.id} left unrouted`);
    if (c.label?.startsWith("exchange withdrawal")) {
      assert.equal(c.kyc, true, `withdrawal ${c.id} missing from the books`);
      withdrawals += 1;
    }
  }
  assert.ok(withdrawals > 0, "Carol's withdrawals exist");
  // the books only grow: a coin on them at day 30 is on them at day 60
  // (the reverse is allowed — a later spend into a KYC-ed deposit adds
  // the coin when the deposit happens, not before)
  const early = economy(30);
  for (const c of early.chain.coins.values()) {
    if (c.kyc === true) {
      assert.equal(eco.chain.coins.get(c.id)!.kyc, true, `${c.id} fell off the books between day 30 and 60`);
    }
  }
});

test("kycGrants: exactly the books' coins, labeled with their true owners", () => {
  const eco = economy();
  const g = kycGrants(eco.chain);
  assert.ok(g.size > 0);
  for (const [id, owner] of g) {
    const c = eco.chain.coins.get(id)!;
    assert.equal(c.kyc, true);
    assert.equal(owner, c.owner);
  }
  for (const c of eco.chain.coins.values()) {
    if (c.kyc) assert.ok(g.has(c.id), `${c.id} on the books but not granted`);
  }
  // Carol's withdrawals put her in the grant on every run
  assert.ok([...g.values()].includes(CARELESS));
});

test("auxGrants: monotone in the slider, empty at the bottom, omniscient at the top", () => {
  const eco = economy();
  const all = eco.chain.coins.size;
  assert.equal(auxGrants(eco.chain, "golden", 0).size, 0);
  assert.equal(auxGrants(eco.chain, "golden", 1).size, all);
  let prev = new Map<CoinId, Owner>();
  for (const f of [0.1, 0.25, 0.5, 0.75]) {
    const g = auxGrants(eco.chain, "golden", f);
    for (const [id, owner] of prev) {
      assert.ok(g.has(id), `raising the slider retracted ${id}`);
      assert.equal(g.get(id), owner);
    }
    for (const [id, owner] of g) assert.equal(owner, eco.chain.coins.get(id)!.owner);
    assert.ok(g.size >= prev.size);
    prev = g;
  }
  // roughly the asked-for fraction, not all or nothing
  const half = auxGrants(eco.chain, "golden", 0.5).size / all;
  assert.ok(half > 0.3 && half < 0.7, `fraction 0.5 granted ${half}`);
});

test("observerGrants: the union — KYC clamps a floor under whatever the slider grants", () => {
  const eco = economy();
  const floor = kycGrants(eco.chain);
  const none = observerGrants(eco.chain, "golden", 0, true);
  assert.deepEqual([...none.entries()].sort(), [...floor.entries()].sort());
  const both = observerGrants(eco.chain, "golden", 0.2, true);
  for (const id of floor.keys()) assert.ok(both.has(id));
  for (const id of auxGrants(eco.chain, "golden", 0.2).keys()) assert.ok(both.has(id));
  assert.equal(observerGrants(eco.chain, "golden", 0, false).size, 0);
});

test("grantAttribution: unanimous clusters attributed wholesale, conflicted clusters keep only the disclosed coins", () => {
  const cl: Clustering = {
    rep: new Map([["a1", "a1"], ["a2", "a1"], ["b1", "b1"], ["b2", "b1"], ["c1", "c1"]]),
    members: new Map([["a1", ["a1", "a2"]], ["b1", ["b1", "b2"]], ["c1", ["c1"]]]),
    rank: new Map([["a1", 1], ["b1", 2], ["c1", 3]]),
    changeGuess: new Map(),
    payGuess: new Map(),
    changeReads: new Map(),
    links: [],
  };
  // cluster a: one grant -> both coins attributed; cluster b: grants
  // naming two owners -> the link is exposed as a lie, no propagation
  const grants = new Map<CoinId, Owner>([["a1", 3], ["b1", 4], ["b2", 5]]);
  const attr = grantAttribution(grants, cl);
  assert.deepEqual(attr.get("a1"), { owner: 3, direct: true });
  assert.deepEqual(attr.get("a2"), { owner: 3, direct: false });
  assert.deepEqual(attr.get("b1"), { owner: 4, direct: true });
  assert.deepEqual(attr.get("b2"), { owner: 5, direct: true });
  assert.equal(attr.get("c1"), undefined);
  const owners = clusterGrantOwners(grants, cl);
  assert.equal(owners.get("a1"), 3);
  assert.ok(!owners.has("b1"), "conflicted cluster earned a name");
  assert.ok(!owners.has("c1"), "grantless cluster earned a name");
});

test("grantMerges: same-named clusters fuse, and at the slider's top the map collapses toward the true partition", () => {
  const eco = economy();
  const base = clusterObserver(eco.chain);
  // low grant: the map barely moves; full grant: every unanimous
  // cluster takes a name and same-named clusters fuse — the vertex
  // count falls monotonically as the grant grows
  let prevSize = Infinity;
  for (const f of [0.05, 0.25, 1]) {
    const g = auxGrants(eco.chain, "golden", f);
    const fused = nsApply(base, grantMerges(g, base));
    assert.ok(fused.members.size <= prevSize, `grant ${f} split the map`);
    prevSize = fused.members.size;
  }
  // at fraction 1 every coin is disclosed: any fused vertex built from
  // unanimous clusters holds one true owner's coins only
  const g1 = auxGrants(eco.chain, "golden", 1);
  const fused = nsApply(base, grantMerges(g1, base));
  const named = clusterGrantOwners(g1, base);
  const ownersSeen = new Set<Owner>();
  for (const [rep, members] of fused.members) {
    if (!named.has(rep)) continue;
    const owners = new Set(members.map((id) => eco.chain.coins.get(id)!.owner));
    assert.equal(owners.size, 1, `fused vertex ${rep} mixes owners`);
    ownersSeen.add([...owners][0]!);
  }
  assert.ok(fused.members.size < base.members.size, "full grant fused nothing");
  assert.ok(ownersSeen.size > 1, "full grant named only one owner");
});

test("full disclosure IS omniscience: at fraction 1 the observer's fused map equals the by-owner partition", () => {
  // the aux slider's stated maximum (#67, #100): every heuristic is
  // overridden by the auxiliary data. Along the pipeline's own path —
  // grants handed to clusterObserver (where they veto links the
  // attributions refute) and then fused by grantMerges — the result
  // must match clusterByOwner exactly, coinjoins and forced sub-tx
  // pairings included.
  const partition = (cl: Clustering): string =>
    [...cl.members.values()].map((m) => [...m].sort().join(",")).sort().join(";");
  for (const seed of ["golden", "welcome", "silver"]) {
    const eco = new Economy(seed);
    eco.runTo(115);
    const g = auxGrants(eco.chain, seed, 1);
    const base = clusterObserver(eco.chain, undefined, { grants: g });
    const fused = nsApply(base, grantMerges(g, base));
    assert.equal(partition(fused), partition(clusterByOwner(eco.chain)),
      `seed ${seed}: full grant differs from the all-seeing partition`);
  }
});

test("the sweep seeded by the grant: more names, more matches, and the map collapses monotonically (S&N phase behavior, pinned on the tutorial seed)", () => {
  const eco = economy(120);
  const base = clusterObserver(eco.chain);
  const run = (f: number): { matches: number; finalV: number } => {
    const g = auxGrants(eco.chain, "golden", f);
    const fused = nsApply(base, grantMerges(g, base));
    const evs = nsSocialRun(fused, eco.chain, 0.5, 2);
    return { matches: activePairs(evs).length, finalV: nsApply(fused, evs).members.size };
  };
  // the total collapse (grant fusion + the sweep it seeds) only deepens
  // as the grant grows
  let prev = Infinity;
  const at: Record<number, { matches: number; finalV: number }> = {};
  for (const f of [0, 0.1, 0.3, 0.5, 1]) {
    at[f] = run(f);
    assert.ok(at[f]!.finalV < prev, `grant ${f} left more vertices than a smaller grant`);
    prev = at[f]!.finalV;
  }
  // the seeded sweep pays beyond the grant's own size: at a mid-size
  // grant the matcher accepts more than it does unseeded — each fused
  // vertex creates the neighborhoods that justify the next match (day
  // 120, seed "golden": 35 unseeded vs 49 at 30%. The exact counts are
  // tie-break-sensitive: the greedy matcher consults cluster ranks and
  // representative order, so re-anchoring representatives on the #125
  // substrate — same classes, first coin in chain order as canonical
  // rep — moved the unseeded count from 20 to 35)
  assert.ok(at[0.3]!.matches > at[0]!.matches * 1.3,
    `seeding stalled: ${at[0]!.matches} unseeded vs ${at[0.3]!.matches} at 30%`);
});

test("grant-then-run-blind: attribution never reads ownership beyond the granted set", () => {
  // a grant with WRONG labels must propagate the wrong labels — proof
  // that the pipeline reads only the grant, never the chain's truth
  const eco = economy();
  const base = clusterObserver(eco.chain);
  const g = auxGrants(eco.chain, "golden", 0.3);
  const lied = new Map<CoinId, Owner>([...g].map(([id]) => [id, 7]));
  const attr = grantAttribution(lied, base);
  for (const a of attr.values()) assert.equal(a.owner, 7);
});
