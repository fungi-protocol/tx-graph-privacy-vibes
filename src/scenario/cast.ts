// The default cast: ten people in three communities, carried over from the
// diagram-E population model. Roles and root holdings match gen_sim.py; the
// concern texts describe what each person needs kept private — needs the
// unilateral-only economy of this milestone cannot yet meet.
// Beyond the ten, buildCast() grows the town: four fixed archetypes first
// (miner, market stall, privacy maximalist, batching exchange desk), then
// seeded townsfolk from role templates.
import { Rng } from "../core/prng";
import type { ScriptKind, WalletTraits } from "../model/chain";

export interface Persona {
  name: string;
  role: string;
  /** what this person needs kept private, and what leaks meanwhile */
  concern: string;
  /** wallet product key (WALLETS); absent = "hearth", the town default */
  wallet?: string;
  /** the wallet run BEFORE the story: pre-story savings still sit on its
   *  addresses, so a migration is two script types in one true wallet —
   *  and the old coins' change tells misfire (the new wallet's change
   *  looks foreign next to the old wallet's inputs) */
  walletBefore?: string;
  /** why this person picked that wallet — shown on the character sheet */
  walletWhy?: string;
  /** root coin values: savings acquired before the story begins */
  roots: number[];
  community: number;
  /** how the pre-story savings read on chain (default "savings") */
  rootLabel?: string;
  /** how income from outside town reads on chain (default "outside income") */
  income?: string;
  /** pays all obligations due on a day in one multi-output transaction */
  batches?: boolean;
  /** hands out one address for everything — receives and change alike —
   *  instead of drawing a fresh one per output. The oldest wallet hygiene
   *  failure, and the one clustering lever that needs no inference. */
  reuses?: boolean;
  /** the day this person moves to town (savings, income, and obligations
   *  all start then); 0/undefined = here from the start. The town grows
   *  as the story needs it: one community first, the studio trio before
   *  rent day, the bike-shop crowd before word crosses community lines. */
  arrives?: number;
  /** waking-hours habit [start, end) in hours of the day, end < start
   *  wrapping midnight: the window this person tends to transact in.
   *  A habit of the PERSON, not the wallet — a shopkeeper spends during
   *  business hours, a night owl after dark — and every transaction's
   *  minute of day is public record, so the habit survives clustering
   *  and feeds statistical fingerprinting (#94). Absent = the town
   *  default (8–22, anyone's waking day). */
  hours?: [number, number];
  /** character-sheet stats, 0–5, feeding the (deliberately simple) cost terms */
  stats: {
    /** how much a naive, history-linking spend bothers them */
    privacy: number;
    /** how much fees bother them */
    thrift: number;
    /** how much coordinating with someone else bothers them */
    hassle: number;
  };
}

/** a directed, flavored community edge: who tends to owe whom, and for what */
export interface Edge {
  payer: number;
  payee: number;
  memos: [string, number, number][];
  /** obligation-frequency multiplier on the economy's oblRate (default 1) */
  rate?: number;
}

/**
 * The town's wallet software — invented products, not real ones. Each
 * ships a bundle of defaults, and every default is a fingerprint the
 * chain records: the FEE POLICY (every transaction publishes its
 * feerate, so a wallet that always bids the same way signs its user's
 * cluster), the SCRIPT TYPE its addresses pay to (public on the face
 * of every output), the NLOCKTIME default (anti-fee-sniping wallets
 * lock each draft to a tip-like recent height — real ones back the
 * value off a little, so near the tip, not always exactly at it (#119);
 * the rest leave zero), and the
 * SIGNATURE GRINDING habit (some grind every signature low-R, so their
 * signatures are uniformly small; the rest leave sizes mixed). Script,
 * locktime, and grinding are assigned retroactively — a pure walk of
 * the record, so the seeded streams that shape the town never move —
 * and the fee model keeps one fixed vsize regardless of script type: the
 * kinds differ on the record, not in what they cost here.
 *
 * The fee policy maps the day's prevailing rate and one behavior draw
 * in [0,1) to a bid, so swapping policies never changes how many dice
 * a day rolls.
 */
export interface WalletProduct {
  /** product name, as its marketing would have it */
  name: string;
  /** the sales pitch — why its users chose it */
  pitch: string;
  /** how the full fingerprint reads to an observer */
  tell: string;
  fee: (base: number, draw: number) => number;
  /** script type its addresses pay to */
  script: ScriptKind;
  /** transaction-building habits, recorded on the txs it drafts */
  traits: WalletTraits;
}

export const WALLETS: Record<string, WalletProduct> = {
  hearth: {
    name: "Hearth",
    pitch: "the wallet everyone's cousin recommends — sensible defaults, no questions asked",
    tell: "bids near the market rate with a modest scatter; pays to bc1q addresses and locks every draft near the fresh tip",
    fee: (base, draw) => Number((base * (0.8 + draw * 0.6)).toFixed(2)),
    script: "segwit",
    traits: { locktime: "tip", lowR: false },
  },
  pelican: {
    name: "Pelican",
    pitch: "“why pay the mempool's asking price?” — for people who count fees",
    tell: "always under the market, always a whole sat per vbyte (never below one, the relay floor); bc1q addresses, and every signature ground low-R — a byte saved on each",
    fee: (base, draw) => Math.max(1, Math.floor(base * (0.72 + draw * 0.12))),
    script: "segwit",
    traits: { locktime: "zero", lowR: true },
  },
  ledgerline: {
    name: "Ledgerline",
    pitch: "till and desk software — payouts confirm on schedule, the register does the rest",
    tell: "a steady 1.3× premium to one decimal, day in, day out — and still pays to 3… compatibility addresses, years behind the curve",
    fee: (base) => Number((base * 1.3).toFixed(1)),
    script: "compat",
    traits: { locktime: "zero", lowR: false },
  },
  foxglove: {
    name: "Foxglove",
    pitch: "privacy-branded: randomizes its fee bids so the wallet itself keeps no rhythm",
    tell: "a fee scatter twice as wide as anyone's — the width is its own signature; bc1p addresses (it moved to the newest script type first), tip-locked drafts, ground signatures — every knob at the careful setting, and the bundle is itself conspicuous",
    fee: (base, draw) => Number((base * (0.6 + draw * 1.1)).toFixed(2)),
    script: "taproot",
    traits: { locktime: "tip", lowR: true },
  },
  brightpay: {
    name: "Brightpay",
    pitch: "one big friendly button marked “instant”",
    tell: "well over the market and rounded to a whole sat — convenience, paid for; bc1q addresses, zero locktime, factory defaults untouched",
    fee: (base, draw) => Math.max(1, Math.round(base * (1.45 + draw * 0.25))),
    script: "segwit",
    traits: { locktime: "zero", lowR: false },
  },
};

/** the persona's wallet product (default: Hearth, the town standard) */
export function walletOf(p: Persona): WalletProduct {
  return WALLETS[p.wallet ?? "hearth"] ?? WALLETS["hearth"]!;
}

/** feerate this persona's wallet bids, given the day's rate and one draw */
export function walletFee(p: Persona, base: number, draw: number): number {
  return walletOf(p).fee(base, draw);
}

/** the script type this persona's coins land on: savings brought from
 *  before the story sit on the FORMER wallet's kind where one is named —
 *  the chain shows the migration — everything else on the current one */
export function walletScript(p: Persona, preStory: boolean): ScriptKind {
  const key = preStory ? (p.walletBefore ?? p.wallet) : p.wallet;
  return (WALLETS[key ?? "hearth"] ?? WALLETS["hearth"]!).script;
}

/** the persona's transaction-building habits — always the CURRENT
 *  wallet's: migrating imports the old keys into the new software, so
 *  old coins keep their script type but spend with new-wallet habits */
export function walletTraits(p: Persona): WalletTraits {
  return walletOf(p).traits;
}

// tableau10, as in the diagram-E visual language
export const OWNER_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b4", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];
export const OWNER_TEXT = ["#fff", "#111", "#fff", "#111", "#fff",
  "#111", "#fff", "#111", "#fff", "#111"];
export const EXTERNAL_COLOR = "#fafafa";

export const COMMUNITIES: number[][] = [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9]];

export const PERSONAS: Persona[] = [
  {
    name: "Alice", role: "salaried", community: 0, income: "salary",
    hours: [18, 23], // salaried: pays her bills after work
    concern: "Everyone she pays — the handyman, the web designer, the " +
      "merchants — can walk her coins backwards and size up her savings. " +
      "Paying unilaterally, each purchase hands its recipient a thread " +
      "into the rest of her wallet.",
    roots: [1_500_000, 800_000, 500_000, 250_000],
    wallet: "hearth",
    walletWhy: "came with her first coins, and it has never given her a reason to switch",
    stats: { privacy: 3, thrift: 2, hassle: 2 },
  },
  {
    name: "Bob", role: "handyman", community: 0, income: "out-of-town job",
    hours: [7, 17], // on the job early, settles up on site
    concern: "Clients pay him for jobs. He does not want one client " +
      "comparing his rates with another's, or tracing how much he has " +
      "saved. Every unilateral receipt is a thread anyone he ever worked " +
      "for can pull.",
    roots: [1_000_000, 700_000, 450_000],
    wallet: "pelican",
    walletWhy: "a fee is an hour's work somewhere; Pelican never bids over the market",
    stats: { privacy: 3, thrift: 3, hassle: 2 },
  },
  {
    name: "Carol", role: "pays the obvious way", community: 0, income: "salary",
    concern: "Believes she has nothing to hide: withdrew from a KYC " +
      "exchange, pays everyone unilaterally, and hands out the same " +
      "address every time — her change goes back to it too. Every coin " +
      "she ever touches is linked on the face of the record, no guessing " +
      "required, and every spend chains back to her identified " +
      "withdrawal. She is the baseline the others are measured against.",
    roots: [1_400_000, 380_000],
    reuses: true,
    wallet: "brightpay",
    walletWhy: "the button says instant and the payment is instant; what else is there",
    stats: { privacy: 0, thrift: 2, hassle: 4 },
  },
  {
    name: "Dave", role: "freelance web developer", community: 0, income: "overseas client",
    hours: [21, 3], // night owl on the overseas client's clock — wraps midnight
    concern: "Clients pay him, and he pays subcontractors. He does not " +
      "want client X learning that client Y exists, or a subcontractor " +
      "reading his margin. Unilaterally, money received from Y touches Z " +
      "with the link in plain sight.",
    roots: [1_200_000, 900_000, 350_000, 250_000, 150_000],
    wallet: "foxglove",
    walletBefore: "hearth",
    walletWhy: "read the fingerprinting papers and switched from Hearth; his old savings still sit on Hearth's addresses, and the chain shows the seam",
    stats: { privacy: 4, thrift: 2, hassle: 2 },
  },
  {
    name: "Erin", role: "freelancer for the bike shop", community: 1, income: "remote gig", arrives: 76,
    concern: "Her main client is the bike shop. She does not want the shop " +
      "seeing whom she hires or how she spends her pay — but her receipts " +
      "from the shop and her spending share one wallet, and the chain " +
      "shows the join.",
    roots: [1_250_000, 650_000, 420_000, 300_000],
    wallet: "hearth",
    walletWhy: "asked around; everyone said Hearth, so Hearth it is",
    stats: { privacy: 3, thrift: 2, hassle: 3 },
  },
  {
    name: "Frank", role: "photographer", community: 1, income: "photo licensing", arrives: 76,
    concern: "Irregular gig income. Some months are thin, and he would " +
      "rather his counterparties not know which. A wallet that pays " +
      "unilaterally publishes his cash flow to anyone who transacts " +
      "with him twice.",
    roots: [1_100_000, 750_000, 300_000],
    wallet: "pelican",
    walletBefore: "brightpay",
    walletWhy: "thin months taught him to shave every cost that shaves; the Brightpay coins from fatter days are still on its addresses",
    stats: { privacy: 2, thrift: 4, hassle: 3 },
  },
  {
    name: "Grace", role: "bike shop", community: 1, income: "till revenue", arrives: 76,
    hours: [9, 17], // the shop transacts when the shop is open
    concern: "A business wallet is a magnet: revenue volume, payroll and " +
      "supplier margins all live in one cluster. Customers see her " +
      "supplier payments; suppliers can size her revenue. One identified " +
      "sale exposes the run of the till.",
    roots: [1_600_000],
    wallet: "ledgerline",
    walletWhy: "the register, the inventory and the payouts in one product; the shop runs on it",
    stats: { privacy: 3, thrift: 3, hassle: 1 },
  },
  {
    name: "Heidi", role: "potter, owns the studio", community: 2, income: "gallery sales", arrives: 36,
    hours: [10, 18], // studio hours
    concern: "Her tenant pays her rent into the same wallet she pays the " +
      "carpenter and the designer from. She does not want Judy gauging " +
      "her finances, nor the people she hires seeing her rental income. " +
      "One wallet, one history, both audiences.",
    roots: [1_300_000, 550_000, 480_000, 200_000],
    wallet: "hearth",
    walletWhy: "the studio's accountant set it up years ago and it just works",
    stats: { privacy: 3, thrift: 2, hassle: 2 },
  },
  {
    name: "Ivan", role: "carpenter", community: 2, income: "out-of-town job", arrives: 36,
    hours: [6, 15], // job sites start at dawn
    concern: "Rate privacy between clients, and materials purchases that " +
      "do not let a client estimate his markup. The lumber yard receipt " +
      "sits one hop from the invoice it was bought for.",
    roots: [950_000, 700_000, 400_000, 275_000],
    wallet: "pelican",
    walletWhy: "prices his jobs to the board-foot; a wallet that overbids fees would gall him",
    stats: { privacy: 2, thrift: 3, hassle: 3 },
  },
  {
    name: "Judy", role: "designer, rents from Heidi", community: 2, income: "client retainer", arrives: 36,
    concern: "The sharpest case: her landlord must not assess her income, " +
      "and her clients must not learn her rent. But she pays Heidi every " +
      "month from the same wallet her clients pay into, and the chain " +
      "keeps the receipts.",
    // the steepest recurring burn in the cast (rent, ~850$ a pop), so
    // her savings run deeper — insolvent tenants can't join settlements
    roots: [2_600_000, 1_400_000, 600_000, 330_000, 210_000],
    wallet: "foxglove",
    walletBefore: "hearth",
    walletWhy: "if the landlord reads chains, the wallet had better not initial its work — she left Hearth the month she signed the lease, savings still on the old addresses",
    stats: { privacy: 5, thrift: 2, hassle: 2 },
  },
];

export const CAST: string[] = PERSONAS.map((p) => p.name);
export const CARELESS = 2;

// the base community edges, carried over from the diagram-E model
export const BASE_EDGES: Edge[] = [
  // community 0 — Alice (salaried), Bob (handyman), Carol (careless), Dave (web dev)
  { payer: 0, payee: 1, memos: [["door repair", 80, 240], ["shelf install", 60, 180]] },
  { payer: 0, payee: 3, memos: [["portfolio site", 200, 600]] },
  { payer: 2, payee: 1, memos: [["leaky faucet", 60, 150]] },
  { payer: 2, payee: 3, memos: [["blog setup", 150, 400]] },
  { payer: 3, payee: 1, memos: [["office shelving", 100, 300]] },
  { payer: 1, payee: 3, memos: [["booking page", 150, 450]] },
  // community 1 — Erin (freelancer), Frank (photographer), Grace (bike shop)
  { payer: 6, payee: 4, memos: [["freelance invoice", 300, 900]] },
  { payer: 6, payee: 5, memos: [["product photos", 150, 500]] },
  { payer: 5, payee: 6, memos: [["bike parts", 40, 200]] },
  { payer: 4, payee: 6, memos: [["commuter tune-up", 50, 120]] },
  // community 2 — Heidi (potter/landlord), Ivan (carpenter), Judy (designer)
  { payer: 9, payee: 7, memos: [["studio rent", 850, 850]] },
  { payer: 7, payee: 8, memos: [["display shelves", 200, 500]] },
  { payer: 8, payee: 9, memos: [["logo design", 150, 350]] },
  { payer: 9, payee: 8, memos: [["exhibition frames", 100, 250]] },
  { payer: 7, payee: 9, memos: [["shop website", 250, 600]] },
];

// the four archetypes M7 adds, in order, at indices 10–13. Each brings its
// own edges (as functions of its index) so its habits are visible on chain.
interface Archetype {
  persona: Omit<Persona, "community">;
  community: number;
  edges: (u: number) => Edge[];
}

const ARCHETYPES: Archetype[] = [
  {
    persona: {
      name: "Kai", role: "miner, mostly holds", income: "coinbase reward", arrives: 102,
      concern: "Block rewards, held for years. Coinbase outputs have no " +
        "past at all — the block that made them is public, so every " +
        "thread he starts from them begins at his coinbase reward. He " +
        "prefers not to start many.",
      roots: [6_250_000, 6_250_000, 3_125_000],
      rootLabel: "coinbase reward",
      wallet: "pelican",
      walletWhy: "mines the blocks himself; paying the mempool's asking price feels like tipping his own till",
      stats: { privacy: 2, thrift: 5, hassle: 4 },
    },
    community: 0,
    edges: (u) => [
      { payer: u, payee: 1, memos: [["rig repair", 120, 400]], rate: 0.3 },
      { payer: u, payee: 3, memos: [["pool dashboard", 150, 350]], rate: 0.2 },
    ],
  },
  {
    persona: {
      name: "Lena", role: "market stall, high volume", income: "till revenue", arrives: 104,
      hours: [8, 16], // the stall trades while the market runs
      concern: "A steady run of small sales, all into one till. Any single " +
        "customer who identifies one sale can read the whole till — volume, " +
        "regulars, the supplier she underpays.",
      roots: [850_000, 450_000, 300_000, 180_000],
      wallet: "ledgerline",
      walletWhy: "the stall needed a till, and the till came with a wallet",
      stats: { privacy: 2, thrift: 4, hassle: 1 },
    },
    community: 1,
    edges: (u) => [
      { payer: 4, payee: u, memos: [["market goods", 15, 80]], rate: 2.2 },
      { payer: 5, payee: u, memos: [["market goods", 15, 80]], rate: 1.8 },
      { payer: u, payee: 6, memos: [["wholesale stock", 120, 320]], rate: 0.8 },
    ],
  },
  {
    persona: {
      name: "Max", role: "privacy maximalist", income: "consulting retainer", arrives: 106,
      hours: [0, 24], // schedules broadcasts around the clock on purpose — a habit withheld is a feature erased
      concern: "Treats every link as a leak: coordinates whenever the menu " +
        "offers it, never declines a session, never consolidates. The town's " +
        "counterexample — and a reminder that discipline buys ambiguity you " +
        "can count, and every later linkage spends it.",
      roots: [1_700_000, 900_000, 420_000],
      wallet: "foxglove",
      walletWhy: "of course; he filed three of the fingerprinting issues on its tracker",
      stats: { privacy: 5, thrift: 1, hassle: 0 },
    },
    community: 2,
    edges: (u) => [
      { payer: u, payee: 8, memos: [["workbench build", 150, 400]] },
      { payer: 7, payee: u, memos: [["opsec consult", 200, 550]], rate: 0.7 },
    ],
  },
  {
    persona: {
      name: "Nadia", role: "exchange desk, batches payouts", income: "desk float top-up", arrives: 108,
      hours: [9, 17], // the desk keeps office hours
      concern: "A desk that owes many people at once and pays them all in " +
        "one transaction to save fees. Cheap — and it publishes her whole " +
        "payout list as a single record every time.",
      roots: [9_000_000, 4_500_000],
      batches: true,
      wallet: "ledgerline",
      walletWhy: "a desk pays on schedule or it stops being a desk; Ledgerline never misses",
      stats: { privacy: 1, thrift: 5, hassle: 2 },
    },
    community: 0,
    edges: (u) => [
      { payer: u, payee: 0, memos: [["desk payout", 120, 480]], rate: 0.8 },
      { payer: u, payee: 4, memos: [["desk payout", 120, 480]], rate: 0.8 },
      { payer: u, payee: 9, memos: [["desk payout", 120, 480]], rate: 0.8 },
      { payer: 3, payee: u, memos: [["otc buy-in", 200, 700]], rate: 0.5 },
    ],
  },
];

// seeded townsfolk fill the town beyond the archetypes
const TOWN_NAMES = ["Olive", "Piotr", "Quinn", "Rosa", "Sami", "Tessa",
  "Umar", "Vera", "Wren", "Ximena", "Yusuf", "Zoe"];
const TOWN_ROLES: [string, string, number, number][] = [
  // role, service memo, usd range
  ["barista", "catering gig", 40, 160], ["tutor", "lessons", 60, 220],
  ["gardener", "yard work", 50, 200], ["courier", "deliveries", 20, 90],
  ["baker", "wedding cake", 80, 300], ["mechanic", "brake job", 90, 350],
  ["illustrator", "poster art", 100, 400], ["plumber", "pipe fitting", 80, 320],
  ["dj", "party set", 120, 450], ["florist", "arrangements", 30, 140],
  ["seamstress", "alterations", 25, 120], ["bookbinder", "restoration", 70, 260],
];

export const BASE_POP = PERSONAS.length;
export const MAX_POP = BASE_POP + ARCHETYPES.length + TOWN_NAMES.length;

/**
 * The town at a given population. pop = 10 is exactly the fixed cast and
 * edges (bit-identical default runs); 11–14 add the archetypes in order;
 * beyond that, townsfolk are rolled from role templates on a dedicated
 * seeded stream, so the economy's own dice are untouched by cast size.
 */
export function buildCast(seed: string, pop: number): { personas: Persona[]; edges: Edge[] } {
  const n = Math.max(BASE_POP, Math.min(MAX_POP, Math.round(pop)));
  const personas = [...PERSONAS];
  const edges = [...BASE_EDGES];
  for (const a of ARCHETYPES.slice(0, Math.max(0, n - BASE_POP))) {
    const u = personas.length;
    personas.push({ ...a.persona, community: a.community });
    edges.push(...a.edges(u));
  }
  const rng = new Rng(`${seed}/cast`);
  for (let i = 0; personas.length < n; i++) {
    const u = personas.length;
    const community = u % 3;
    const [role, memo, lo, hi] = TOWN_ROLES[i % TOWN_ROLES.length]!;
    const name = TOWN_NAMES[i % TOWN_NAMES.length]!;
    const roots = Array.from({ length: 2 + rng.int(3) },
      () => 200_000 + rng.int(1_200_000));
    // draw order matches the pre-wallet literal (arrives, then stats): the
    // seeded streams that shape the town predate wallets and must not shift
    const arrives = rng.int(90);
    const stats = { privacy: 1 + rng.int(4), thrift: 1 + rng.int(4), hassle: 1 + rng.int(4) };
    // wallet follows temperament, no extra dice
    const wallet = stats.privacy >= 4 ? "foxglove"
      : stats.thrift >= 4 ? "pelican"
      : stats.hassle >= 4 ? "brightpay" : "hearth";
    personas.push({
      name, role, community,
      concern: `Pays and gets paid around town like everyone else. Every ` +
        `unilateral spend threads the ${role}'s wallet into the record, ` +
        "and every counterparty keeps what it learns.",
      roots,
      wallet,
      walletWhy: `runs ${WALLETS[wallet]!.name} — ` +
        (wallet === "foxglove" ? "read one thread about wallet fingerprints and switched the same night"
          : wallet === "pelican" ? "shopped the fee policies the way they shop everything"
          : wallet === "brightpay" ? "wanted the one with the fewest screens"
          : "took the default and never looked back"),
      // townsfolk trickle in across the story rather than all at once
      arrives,
      stats,
    });
    // one or two edges into the local community, either direction
    const locals = personas
      .map((p, v) => v)
      .filter((v) => v !== u && personas[v]!.community === community);
    const m = 1 + rng.int(2);
    for (let k = 0; k < m && locals.length > 0; k++) {
      const other = rng.pick(locals);
      if (rng.next() < 0.6) {
        edges.push({ payer: other, payee: u, memos: [[memo, lo, hi]] });
      } else {
        edges.push({ payer: u, payee: other, memos: [["supplies", 20, 120]] });
      }
    }
  }
  return { personas, edges };
}

/** owner colors beyond tableau10: golden-angle hues, stable per index */
export function ownerColor(u: number): string {
  return OWNER_COLORS[u] ?? `hsl(${Math.round((u * 137.508) % 360)} 55% 58%)`;
}

export function ownerText(u: number): string {
  return OWNER_TEXT[u] ?? "#111";
}
