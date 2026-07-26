// Auxiliary information as a KNOWLEDGE GRANT: "suppose the adversary has
// deanonymized user U" — a KYC record, a web tracker, a counterparty's
// books. The assumption is stated as an assumption; what follows from it
// is COMPUTED. Two very different outcomes on the same public graph
// (the writeup's additive/multiplicative dichotomy):
//   - additive: U's own coins drop out of a traced coin's candidate
//     origins — the set shrinks by what was granted, no more.
//   - multiplicative: the granted coins sat on every route to OTHER
//     origins, so removing them severs those origins too — the ancestry
//     fractures into regions, and candidates fall that the grant never
//     named. When cuts keep paying beyond their own size, the adversary's
//     progress compounds.
// Latent-truth rule (grant, then run blind): the granted set is the ONLY
// truth that enters — everything after is reachability on the public
// graph. Nothing here reads coin ownership.
import { type Chain, type CoinId, type Owner } from "../model/chain";
import { Rng } from "../core/prng";
import { ancestry } from "./ancestry";
import { type Clustering } from "./clusters";
import { type Attribution } from "./knowledge";
import { type NsEvent } from "./nssocial";

/**
 * The exchange's contribution to an observer's grant: every coin the
 * exchange's private books tie to an identified customer — a KYC-ed
 * withdrawal, or the inputs spent into a KYC-ed deposit — labeled with
 * its true owner. This is the ONE place the `kyc` flag (and, for these
 * coins, ownership) is read: truth consulted only to construct the
 * grant, exactly as a subpoenaed exchange would hand over its records.
 * Everything downstream runs blind on the public graph.
 */
export function kycGrants(chain: Chain): Map<CoinId, Owner> {
  const grants = new Map<CoinId, Owner>();
  for (const c of chain.coins.values()) {
    if (c.kyc) grants.set(c.id, c.owner);
  }
  return grants;
}

/**
 * The auxiliary-information slider: a `fraction` of all coins, drawn by
 * a stable per-coin hash, revealed with their true owners. Monotone in
 * the slider — each coin has a fixed draw, so the set at a lower
 * setting is a subset of the set at any higher one. fraction 0 is the
 * plain observer (no truth at all); fraction 1 is omniscience (every
 * label granted). Truth is read only to label the granted coins.
 */
export function auxGrants(chain: Chain, seed: string, fraction: number): Map<CoinId, Owner> {
  const grants = new Map<CoinId, Owner>();
  if (fraction <= 0) return grants;
  for (const c of chain.coins.values()) {
    if (fraction >= 1 || new Rng(`${seed}/aux/${c.id}`).next() < fraction) {
      grants.set(c.id, c.owner);
    }
  }
  return grants;
}

/**
 * The observer's full grant: the random auxiliary reveals, with the
 * KYC records (when the observer holds them) clamping a floor of
 * specific coins underneath. A union — the same coin granted twice
 * carries the same true label either way.
 */
export function observerGrants(
  chain: Chain,
  seed: string,
  fraction: number,
  kyc: boolean,
): Map<CoinId, Owner> {
  const grants = auxGrants(chain, seed, fraction);
  if (kyc) {
    for (const [id, owner] of kycGrants(chain)) grants.set(id, owner);
  }
  return grants;
}

/**
 * Granted labels compounding through the observer's own clustering,
 * the same way a participant's fixed points do (knowledge.ts): a
 * cluster containing a granted coin is attributed to that owner
 * wholesale — unless the cluster holds grants naming two different
 * owners, in which case the observer knows one of its links is a lie
 * and the cluster earns no propagated guess at all (the granted coins
 * themselves keep their labels). Runs on the grant and the public
 * clustering only; no coin's ownership is read here.
 */
export function grantAttribution(
  grants: Map<CoinId, Owner>,
  cl: Clustering,
): Map<CoinId, Attribution> {
  const coins = new Map<CoinId, Attribution>();
  for (const [id, owner] of grants) coins.set(id, { owner, direct: true });
  for (const [rep, owner] of clusterGrantOwners(grants, cl)) {
    for (const id of cl.members.get(rep)!) {
      if (!coins.has(id)) coins.set(id, { owner, direct: false });
    }
  }
  return coins;
}

/** which clusters the grant attributes, and to whom: representative →
 *  the single owner the cluster's granted coins name (clusters whose
 *  grants conflict are left out — see grantAttribution) */
export function clusterGrantOwners(
  grants: Map<CoinId, Owner>,
  cl: Clustering,
): Map<CoinId, Owner> {
  const out = new Map<CoinId, Owner>();
  for (const [rep, members] of cl.members) {
    const owners = new Set<Owner>();
    for (const id of members) {
      if (grants.has(id)) owners.add(grants.get(id)!);
    }
    if (owners.size === 1) out.set(rep, [...owners][0]!);
  }
  return out;
}

/**
 * The grant compounding SIDEWAYS: two clusters attributed to the same
 * owner are, to the observer, one pseudonym unmasked twice — fuse them.
 * Emitted as the same merge events the propagation matchers use, so
 * grants stack under ns-social exactly like accepted matches; a sweep
 * run on the fused map is a sweep seeded by the grant. All external
 * coins fuse into one "outside town" vertex, matching the omniscient
 * partition at the slider's maximum.
 */
export function grantMerges(
  grants: Map<CoinId, Owner>,
  cl: Clustering,
): NsEvent[] {
  const byOwner = new Map<string, CoinId[]>();
  for (const [rep, owner] of clusterGrantOwners(grants, cl)) {
    const key = owner === null ? "x" : String(owner);
    const g = byOwner.get(key);
    if (g) g.push(rep); else byOwner.set(key, [rep]);
  }
  const events: NsEvent[] = [];
  for (const reps of byOwner.values()) {
    for (let i = 1; i < reps.length; i++) {
      events.push({ kind: "merge", a: reps[i]!, b: reps[0]!, score: 1 });
    }
  }
  return events;
}

export interface AuxDecay {
  /** candidate origins before the grant */
  before: number;
  /** roots eliminated because they are in the granted set (additive) */
  granted: number;
  /** roots NOT in the granted set that fall anyway — every route from
   *  the coin back to them passes through a granted coin (the fracture
   *  dividend; > 0 means the multiplicative regime is live) */
  fractured: number;
  /** candidate origins that survive the cut */
  after: number;
}

/**
 * What one knowledge grant does to one coin's candidate origins.
 * `granted` is the disclosed set (U's coins); the traced coin's own
 * ancestry is walked twice — once freely, once refusing to step onto a
 * granted coin — and the difference is the computed consequence.
 */
export function auxInfoDecay(chain: Chain, coin: CoinId, granted: Set<CoinId>): AuxDecay {
  const a = ancestry(chain, coin);
  const roots = [...a.coins].filter((c) => chain.coins.get(c)!.producer === null);
  // reachability backwards from the coin, never stepping onto a granted
  // coin: the surviving part of the ancestry
  const reach = new Set<CoinId>();
  const frontier: CoinId[] = granted.has(coin) ? [] : [coin];
  while (frontier.length > 0) {
    const cid = frontier.pop()!;
    if (reach.has(cid)) continue;
    reach.add(cid);
    const producer = chain.coins.get(cid)?.producer;
    if (producer) {
      for (const input of chain.txs.get(producer)!.inputs) {
        if (!granted.has(input)) frontier.push(input);
      }
    }
  }
  const grantedRoots = roots.filter((r) => granted.has(r));
  const survivors = roots.filter((r) => reach.has(r));
  return {
    before: roots.length,
    granted: grantedRoots.length,
    fractured: roots.length - grantedRoots.length - survivors.length,
    after: survivors.length,
  };
}
