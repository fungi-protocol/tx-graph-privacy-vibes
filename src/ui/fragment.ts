// URL-fragment codec: the entire shareable state travels as
// #s=<base64url(deflate-raw(JSON))>. Everything needed to reproduce what
// the user is looking at: the seed, parameter overrides, the played agent
// and every recorded manual choice, the camera, the tutorial position, and
// (for the right-click "copy reference" reviewing aid) a click position
// plus the element under the cursor.

/**
 * Fragment schema version, stamped on the wire (`sv`) by encodeFragment and
 * consumed — never emitted — by sanitize. Bump it whenever a field's shape
 * or meaning changes, and add an explicit migration in sanitize keyed on
 * the declared version; never re-interpret an old field's bytes in place.
 * History: v1 = pre-M10 interventions as 5-tuples matched by (memo, due) —
 * structurally distinguishable, dropped; v2 = interventions as
 * [day, schedule id, plan]; v3 = `ct` gains the script-type tell (bit 8),
 * so a v2 all-tells mask (7) migrates to the new all-tells mask (15);
 * v4 = `ov` gains repeated co-membership (bit 16), so an earlier
 * all-heuristics mask (15) migrates to the new all-heuristics mask (31);
 * v5 = the tutorial position travels as a stable step id (`ts`) instead of
 * a bare index (`t`), so reordering the tour no longer re-targets shared
 * links — old indexes resolve through the order frozen at v4
 * (LEGACY_STEP_ORDER_V4), keeping an old link on the same content.
 * Fragments without `sv` are v2 (the last pre-versioning schema);
 * fragments claiming a future version are parsed best-effort — unknown
 * fields are ignored anyway.
 */
export const SCHEMA_VERSION = 5;

export interface FragmentState {
  seed: string;
  /** economy parameter overrides, non-default values only: o = oblRate,
   *  e = extRate, f = feeLevel, fv = feeVol, x = fx, w = wealth, pp = pop */
  p?: { o?: number; e?: number; f?: number; fv?: number; x?: number; w?: number; pp?: number };
  /** dated parameter changes: [day, patch] applied from that day forward;
   *  only the live knobs (o, e, f, fv, x) — wealth, pop, and the seed are
   *  world identity and never change mid-run */
  pt?: [number, { o?: number; e?: number; f?: number; fv?: number; x?: number }][];
  /** manual play: [played agent, day the player took over] */
  m?: [number, number];
  /** recorded manual choices, packed [day, obligation id, plan] — the id is
   *  the stable schedule ID (engine/schedule.ts); pre-M10 5-tuple entries
   *  are dropped on decode (they matched obligations by memo and due date,
   *  which the re-derived schedule no longer reproduces) */
  i?: [number, string, string][];
  /** legacy (≤v4) tutorial step index. sanitize migrates 0-based indexes
   *  to `ts` via LEGACY_STEP_ORDER_V4; only the explicit "tour hidden"
   *  sentinel (-1) survives into the decoded state. Never emitted. */
  t?: number;
  /** tutorial position as the step's stable id. An id the current tour
   *  does not know degrades to a hidden tour; absent together with `t`
   *  means the link never positioned the tour (fresh visitors start it) */
  ts?: string;
  /** camera [x, y, scale] */
  cam?: [number, number, number];
  /** view: 0 = block explorer (default), 1 = bipartite */
  v?: number;
  /** cluster view only: 1 = the lattice bottom (every coin a singleton) */
  uc?: number;
  /** cluster view only: the world rect [x, y, w, h] the contraction's
   *  circle was fit into — the rect the camera showed when the collapse
   *  began, so shared links reproduce the same geometry. Absent = the
   *  layout's own origin-centered coordinates. */
  cf?: [number, number, number, number];
  /** scene: 0 = intro story (default), 1 = the economy */
  sc?: number;
  /** lens: 0 = all-seeing (default), 1 = third-party observer, 2 = one agent's view */
  l?: number;
  /** lens 2 only: which agent's view (participant index) */
  a?: number;
  /** lens 1 only: observer heuristics bitmask (1 CIOH, 2 change,
   *  4 subset-sum, 8 address reuse) */
  ov?: number;
  /** lens 1 only: CIOH max-inputs cap (absent = no cap) */
  cm?: number;
  /** lens 1 only: the change link's evidentiary bar — total payment
   *  tells required before the sole unidentified output links (absent
   *  = 1, a single tell decides) */
  ce?: number;
  /** lens 1 only: which change-identification tells run — a bitmask of
   *  round-USD (1), round-BTC (2), auxiliary attribution (4), script
   *  type (8); absent = all of them */
  ct?: number;
  /** lens 1 only: the observer's knowledge grant [1 = holds the
   *  exchange's KYC records, auxiliary-information reveals as a % of
   *  all coins (0 = the plain observer, 100 = omniscience)] */
  ai?: [number, number];
  /** lens 1 only: 1 = grade the observer's links, flagging wrong inferences */
  mi?: number;
  /** graph-view layout: 0 = layered left-to-right (default), 1 = force-directed */
  fd?: number;
  /** lens 1 only: ns-social propagation [1 = on, threshold×100, columns,
   *  replay cursor (algorithmic events applied)] */
  ns?: [number, number, number, number];
  /** ns-social manual matches, applied after the replay prefix:
   *  [repA, repB, score×1000, 1 = forced below the threshold] */
  nm?: [string, string, number, number][];
  /** lens 1 only: ns-netflix statistical fingerprinting [1 = on,
   *  threshold×100, replay cursor (greedy matches applied)] */
  nf?: [number, number, number];
  /** economy day (scene 1 only) */
  n?: number;
  /** freeze-frame: transactions of day `n` revealed (tape controller) */
  nt?: number;
  /** copy-reference: world position clicked + element selector under cursor */
  ref?: { wx: number; wy: number; sel?: string };
}

/**
 * The tour order as it stood when schema v4 was current, frozen so that a
 * pre-v5 link's bare step index keeps resolving to the step CONTENT its
 * author was looking at, even after the tour is reordered. Append-only
 * history: never edit or reorder this list; it deliberately drifts from
 * the live scenario files.
 */
export const LEGACY_STEP_ORDER_V4: readonly string[] = [
  // intro
  "meet-alice", "whole-coins", "change", "ordered-on-chain", "fees",
  "utxos", "chain-remembers", "addresses", "two-drawings", "toggle-freely",
  // economy
  "neighborhood", "days-pass", "follow-the-money", "what-leaks",
  "someone-watching",
  // observer
  "observers-map", "address-reuse", "names-from-outside",
  "coins-spent-together", "guessing-the-change", "a-family-of-tells",
  "heuristics-not-proofs", "a-timeline-on-a-circle", "shrinking-the-map",
  "names-meet-the-links",
  // payjoin
  "neighborhood-learns-a-trick", "the-heuristic-lies",
  "no-privacy-from-the-counterparty", "how-big-is-the-doubt",
  "the-map-fights-back", "wallets-sign-their-work", "the-fingerprint-check",
  "many-senders",
  // settlement
  "settling-up", "the-amounts-are-gone", "insiders-and-the-protocol",
  "what-still-shows",
  // ns-social
  "the-shape-remains", "matching-the-epochs", "what-structure-gives-away",
  // coinjoin
  "strangers-share-a-transaction", "the-amounts-undo-it",
  "chosen-to-be-underdetermined", "many-plausible-pasts",
  "the-null-hypothesis-flips", "even-insiders-are-blinded",
  "the-same-stranger-twice", "no-panacea",
  // intersection
  "the-candidate-origins", "a-longer-past", "many-routes-back",
  "suppose-one-name", "the-adversarys-hand", "two-coins-meet",
  "the-sets-shrink-fast", "toxic-change", "twenty-questions-in-coins",
  // synthesis
  "no-names-were-needed", "judys-rent-many-ways", "what-a-claim-rests-on",
  "take-this-clue-away", "two-maps-and-a-few-names", "one-sweep",
  "when-the-premise-holds", "feed-it-names", "the-public-analyst",
  "the-counterparty", "the-aggregator", "a-lower-bound",
  // game
  "rent-day", "through-the-landlords-eyes", "patience-pays", "the-sandbox",
];

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!, b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!;
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!;
    if (b2 !== undefined) out += B64[b2 & 63]!;
  }
  return out;
}

function b64urlToBytes(text: string): Uint8Array {
  const idx = new Map([...B64].map((c, i) => [c, i]));
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of text) {
    const v = idx.get(ch);
    if (v === undefined) throw new Error(`bad base64url char ${ch}`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

export async function encodeFragment(state: FragmentState): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ ...state, sv: SCHEMA_VERSION }));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return `s=${bytesToB64url(packed)}`;
}

export async function decodeFragment(fragment: string): Promise<FragmentState | null> {
  const m = /(?:^|[#&])s=([A-Za-z0-9_-]+)/.exec(fragment);
  if (!m) return null;
  if (m[1]!.length > 65536) return null; // decompression-bomb guard
  const packed = b64urlToBytes(m[1]!);
  const json = await pipe(packed, new DecompressionStream("deflate-raw"));
  if (json.length > 1 << 20) return null;
  return sanitize(JSON.parse(new TextDecoder().decode(json)));
}

// Share links are an input boundary: anyone can craft one, so every field
// is re-validated and clamped here — a hostile fragment may degrade into a
// default view, never into a crash, a runaway simulation, or absurd state.
const MAX_DAY = 3650;
const MAX_AGENT = 64; // above any cast size; the app re-checks against MAX_POP

function num(v: unknown, lo: number, hi: number, round = false): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const c = Math.min(hi, Math.max(lo, v));
  return round ? Math.round(c) : c;
}

function str(v: unknown, maxLen: number): string | undefined {
  return typeof v === "string" && v.length <= maxLen ? v : undefined;
}

export function sanitize(raw: unknown): FragmentState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = { ...(raw as Record<string, unknown>) };
  // migrations, keyed on the declared schema version (see SCHEMA_VERSION)
  const sv = num(r.sv, 1, 1e6, true) ?? SCHEMA_VERSION;
  if (sv < 2) delete r.i; // v1 interventions matched by (memo, due): unreplayable
  // v2's all-tells mask was 7; the intent "every tell on" now spells 15
  if (sv < 3 && r.ct === 7) r.ct = 15;
  // v3's all-heuristics mask was 15; the intent "everything on" now
  // spells 31 (repeated co-membership joined the panel)
  if (sv < 4 && r.ov === 15) r.ov = 31;
  // pre-v5 links (versioned or from before versioning — note the missing-sv
  // default above is the CURRENT version) positioned the tour by bare index;
  // resolve it through the order frozen at v4 so the link stays on the
  // content its author shared. A v5+ fragment never writes `t`.
  if ((r.sv === undefined || sv < 5) && r.ts === undefined && typeof r.t === "number") {
    const t = num(r.t, -1, 500, true);
    if (t !== undefined && t >= 0) r.ts = LEGACY_STEP_ORDER_V4[t]; // out of range: undefined = hidden
  }
  const seed = str(r.seed, 64);
  if (seed === undefined || seed.length === 0) return null;
  const out: FragmentState = { seed };

  if (typeof r.p === "object" && r.p !== null) {
    const p = r.p as Record<string, unknown>;
    const clamped = {
      o: num(p.o, 0, 0.3), e: num(p.e, 0, 0.2), f: num(p.f, 0.5, 4),
      fv: num(p.fv, 0, 3), x: num(p.x, 0.5, 3), w: num(p.w, 0.25, 4),
      pp: num(p.pp, 10, MAX_AGENT, true),
    };
    const entries = Object.entries(clamped).filter(([, v]) => v !== undefined);
    if (entries.length) out.p = Object.fromEntries(entries);
  }
  if (Array.isArray(r.pt)) {
    const pt: NonNullable<FragmentState["pt"]> = [];
    for (const it of (r.pt as unknown[]).slice(0, 200)) {
      if (!Array.isArray(it) || typeof it[1] !== "object" || it[1] === null) continue;
      const day = num(it[0], 1, MAX_DAY, true);
      if (day === undefined) continue;
      const p = it[1] as Record<string, unknown>;
      const clamped = {
        o: num(p.o, 0, 0.3), e: num(p.e, 0, 0.2), f: num(p.f, 0.5, 4),
        fv: num(p.fv, 0, 3), x: num(p.x, 0.5, 3),
      };
      const entries = Object.entries(clamped).filter(([, v]) => v !== undefined);
      if (entries.length) pt.push([day, Object.fromEntries(entries)]);
    }
    if (pt.length) out.pt = pt;
  }
  if (Array.isArray(r.m)) {
    const u = num(r.m[0], 0, MAX_AGENT, true), day = num(r.m[1], 0, MAX_DAY, true);
    if (u !== undefined && day !== undefined) out.m = [u, day];
  }
  if (Array.isArray(r.i)) {
    const iv: [number, string, string][] = [];
    for (const it of (r.i as unknown[]).slice(0, 1000)) {
      if (!Array.isArray(it)) continue;
      const day = num(it[0], 0, MAX_DAY, true);
      const id = str(it[1], 24), plan = str(it[2], 20);
      if (day !== undefined && id !== undefined && /^\d+\.[esx]\d+(\.\d+)?$/.test(id) &&
        plan !== undefined) iv.push([day, id, plan]);
    }
    if (iv.length) out.i = iv;
  }
  const ts = str(r.ts, 64);
  if (ts !== undefined && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ts)) out.ts = ts;
  // the explicit "tour hidden" sentinel is the one index that survives
  if (out.ts === undefined && r.t === -1) out.t = -1;
  if (Array.isArray(r.cam)) {
    const x = num(r.cam[0], -1e7, 1e7), y = num(r.cam[1], -1e7, 1e7);
    const scale = num(r.cam[2], 0.01, 100);
    if (x !== undefined && y !== undefined && scale !== undefined) out.cam = [x, y, scale];
  }
  const v = num(r.v, 0, 2, true);
  if (v !== undefined) out.v = v;
  const uc = num(r.uc, 0, 1, true);
  if (uc !== undefined) out.uc = uc;
  if (Array.isArray(r.cf)) {
    const cx = num(r.cf[0], -1e7, 1e7), cy = num(r.cf[1], -1e7, 1e7);
    const cw = num(r.cf[2], 1, 1e7), ch = num(r.cf[3], 1, 1e7);
    if (cx !== undefined && cy !== undefined && cw !== undefined && ch !== undefined) {
      out.cf = [cx, cy, cw, ch];
    }
  }
  const sc = num(r.sc, 0, 1, true);
  if (sc !== undefined) out.sc = sc;
  const l = num(r.l, 0, 2, true);
  if (l !== undefined) out.l = l;
  const a = num(r.a, 0, MAX_AGENT, true);
  if (a !== undefined) out.a = a;
  const ov = num(r.ov, 0, 31, true);
  if (ov !== undefined) out.ov = ov;
  const cm = num(r.cm, 2, 64, true);
  if (cm !== undefined) out.cm = cm;
  const ce = num(r.ce, 1, 8, true);
  if (ce !== undefined) out.ce = ce;
  const ct = num(r.ct, 0, 15, true);
  if (ct !== undefined) out.ct = ct;
  if (Array.isArray(r.ai)) {
    const kx = num(r.ai[0], 0, 1, true), ax = num(r.ai[1], 0, 100, true);
    if (kx !== undefined && ax !== undefined) out.ai = [kx, ax];
  }
  const mi = num(r.mi, 0, 1, true);
  if (mi !== undefined) out.mi = mi;
  const fd = num(r.fd, 0, 1, true);
  if (fd !== undefined) out.fd = fd;
  if (Array.isArray(r.ns)) {
    const on = num(r.ns[0], 0, 1, true), th = num(r.ns[1], 0, 101, true);
    const parts = num(r.ns[2], 2, 4, true), cur = num(r.ns[3], 0, 10000, true);
    if (on !== undefined && th !== undefined && parts !== undefined && cur !== undefined) {
      out.ns = [on, th, parts, cur];
    }
  }
  if (Array.isArray(r.nm)) {
    const nm: [string, string, number, number][] = [];
    for (const it of (r.nm as unknown[]).slice(0, 200)) {
      if (!Array.isArray(it)) continue;
      const a = str(it[0], 24), b = str(it[1], 24);
      const s = num(it[2], 0, 1000, true), f = num(it[3], 0, 1, true);
      if (a !== undefined && b !== undefined && s !== undefined && f !== undefined) {
        nm.push([a, b, s, f]);
      }
    }
    if (nm.length) out.nm = nm;
  }
  if (Array.isArray(r.nf)) {
    const on = num(r.nf[0], 0, 1, true), th = num(r.nf[1], 0, 101, true);
    const cur = num(r.nf[2], 0, 10000, true);
    if (on !== undefined && th !== undefined && cur !== undefined) {
      out.nf = [on, th, cur];
    }
  }
  const n = num(r.n, 0, MAX_DAY, true);
  if (n !== undefined) out.n = n;
  const nt = num(r.nt, 0, 10000, true);
  if (nt !== undefined && n !== undefined) out.nt = nt;
  if (typeof r.ref === "object" && r.ref !== null) {
    const ref = r.ref as Record<string, unknown>;
    const wx = num(ref.wx, -1e7, 1e7), wy = num(ref.wy, -1e7, 1e7);
    const sel = str(ref.sel, 120);
    if (wx !== undefined && wy !== undefined) out.ref = sel !== undefined ? { wx, wy, sel } : { wx, wy };
  }
  return out;
}
