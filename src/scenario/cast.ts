// The default cast: ten people in three communities, carried over from the
// diagram-E population model. Roles and root holdings match gen_sim.py; the
// concern texts describe what each person needs kept private — needs the
// unilateral-only economy of this milestone cannot yet meet.
export interface Persona {
  name: string;
  role: string;
  /** what this person needs kept private, and what leaks meanwhile */
  concern: string;
  /** root coin values: savings acquired before the story begins */
  roots: number[];
  community: number;
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

// tableau10, as in the diagram-E visual language
export const OWNER_COLORS = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b4", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac"];
export const OWNER_TEXT = ["#fff", "#111", "#fff", "#111", "#fff",
  "#111", "#fff", "#111", "#fff", "#111"];
export const EXTERNAL_COLOR = "#fafafa";

export const COMMUNITIES: number[][] = [[0, 1, 2, 3], [4, 5, 6], [7, 8, 9]];

export const PERSONAS: Persona[] = [
  {
    name: "Alice", role: "salaried", community: 0,
    concern: "Everyone she pays — the handyman, the web designer, the " +
      "merchants — can walk her coins backwards and size up her savings. " +
      "Paying unilaterally, each purchase hands its recipient a thread " +
      "into the rest of her wallet.",
    roots: [1_500_000, 800_000, 500_000, 250_000],
    stats: { privacy: 3, thrift: 2, hassle: 2 },
  },
  {
    name: "Bob", role: "handyman", community: 0,
    concern: "Clients pay him for jobs. He does not want one client " +
      "comparing his rates with another's, or tracing how much he has " +
      "saved. Every unilateral receipt is a thread anyone he ever worked " +
      "for can pull.",
    roots: [1_000_000, 700_000, 450_000],
    stats: { privacy: 3, thrift: 3, hassle: 2 },
  },
  {
    name: "Carol", role: "pays the obvious way", community: 0,
    concern: "Believes she has nothing to hide: withdrew from a KYC " +
      "exchange and pays everyone unilaterally. Every spend links straight " +
      "back to her identified withdrawal — she is the baseline the others " +
      "are measured against.",
    roots: [1_400_000, 380_000],
    stats: { privacy: 0, thrift: 2, hassle: 4 },
  },
  {
    name: "Dave", role: "freelance web developer", community: 0,
    concern: "Clients pay him, and he pays subcontractors. He does not " +
      "want client X learning that client Y exists, or a subcontractor " +
      "reading his margin. Unilaterally, money received from Y touches Z " +
      "with the link in plain sight.",
    roots: [1_200_000, 900_000, 350_000, 250_000, 150_000],
    stats: { privacy: 4, thrift: 2, hassle: 2 },
  },
  {
    name: "Erin", role: "freelancer for the bike shop", community: 1,
    concern: "Her main client is the bike shop. She does not want the shop " +
      "seeing whom she hires or how she spends her pay — but her receipts " +
      "from the shop and her spending share one wallet, and the chain " +
      "shows the join.",
    roots: [1_250_000, 650_000, 420_000, 300_000],
    stats: { privacy: 3, thrift: 2, hassle: 3 },
  },
  {
    name: "Frank", role: "photographer", community: 1,
    concern: "Irregular gig income. Some months are thin, and he would " +
      "rather his counterparties not know which. A wallet that pays " +
      "unilaterally publishes his cash flow to anyone who transacts " +
      "with him twice.",
    roots: [1_100_000, 750_000, 300_000],
    stats: { privacy: 2, thrift: 4, hassle: 3 },
  },
  {
    name: "Grace", role: "bike shop", community: 1,
    concern: "A business wallet is a magnet: revenue volume, payroll and " +
      "supplier margins all live in one cluster. Customers see her " +
      "supplier payments; suppliers can size her revenue. One identified " +
      "sale exposes the run of the till.",
    roots: [1_600_000],
    stats: { privacy: 3, thrift: 3, hassle: 1 },
  },
  {
    name: "Heidi", role: "potter, owns the studio", community: 2,
    concern: "Her tenant pays her rent into the same wallet she pays the " +
      "carpenter and the designer from. She does not want Judy gauging " +
      "her finances, nor the people she hires seeing her rental income. " +
      "One wallet, one history, both audiences.",
    roots: [1_300_000, 550_000, 480_000, 200_000],
    stats: { privacy: 3, thrift: 2, hassle: 2 },
  },
  {
    name: "Ivan", role: "carpenter", community: 2,
    concern: "Rate privacy between clients, and materials purchases that " +
      "do not let a client estimate his markup. The lumber yard receipt " +
      "sits one hop from the invoice it was bought for.",
    roots: [950_000, 700_000, 400_000, 275_000],
    stats: { privacy: 2, thrift: 3, hassle: 3 },
  },
  {
    name: "Judy", role: "designer, rents from Heidi", community: 2,
    concern: "The sharpest case: her landlord must not assess her income, " +
      "and her clients must not learn her rent. But she pays Heidi every " +
      "month from the same wallet her clients pay into, and the chain " +
      "keeps the receipts.",
    roots: [1_250_000, 600_000, 330_000, 210_000],
    stats: { privacy: 5, thrift: 2, hassle: 2 },
  },
];

export const CAST: string[] = PERSONAS.map((p) => p.name);
export const CARELESS = 2;
