// The payment schedule — which obligations and impulse purchases exist —
// derives from the seed and the schedule parameters alone. Every draw comes
// from a stream namespaced per day and per edge (or per person), so the
// schedule for a day is a pure function of (seed, params, cast, edges, day):
// payment *behavior* — what gets paid when, at what feerate, in which
// collaborative form — lives on a separate stream in the Economy, and
// changing how people pay never changes what they owe. Parameter sweeps and
// manual play vary against a fixed payment universe.
//
// Obligation IDs are stable across runs and behaviors: `<day>.e<edge>.<k>`
// for community-edge draws, `<day>.s<k>` for scripted story beats,
// `<day>.x<payer>.<k>` for external purchases. Interventions and any future
// annotation anchor to these, never to (memo, due) coincidences.
import { Rng } from "../core/prng";
import { type Persona, type Edge } from "../scenario/cast";

/** the day the neighborhood learns payjoin exists */
export const PAYJOIN_DAY = 30;
/** the day the neighborhood starts settling offsetting obligations together */
export const SETTLE_DAY = 60;
/** the day word crosses community lines: strangers can share a transaction */
export const COINJOIN_DAY = 90;
/** the day the toxic-change slip is guaranteed if nobody made it organically */
export const TOXIC_DAY = 110;
/** the day somebody consolidates coins from two different sessions */
export const INTERSECT_DAY = 112;
/** the day the studio's rent falls due again — the playable moment */
export const GAME_DAY = 118;

export interface ScheduledObligation {
  id: string;
  payer: number;
  payee: number;
  memo: string;
  /** dollars, rounded to $10 like invoices and rent */
  usd: number;
  /** pay by this day */
  due: number;
}

export interface ScheduledPurchase {
  id: string;
  payer: number;
  memo: string;
  /** dollars, unrounded retail prices (to the cent) */
  usd: number;
}

export interface DaySchedule {
  obligations: ScheduledObligation[];
  purchases: ScheduledPurchase[];
}

/** the subset of the economy parameters the schedule depends on */
export interface ScheduleParams {
  /** expected obligations per community edge per day */
  oblRate: number;
  /** expected external purchases per person per day */
  extRate: number;
}

const EXTERNAL_MEMOS: [string, number, number][] = [
  ["groceries", 30, 140], ["hardware store", 8, 90], ["dinner out", 25, 85],
  ["online order", 15, 150], ["fuel", 35, 70], ["subscription", 5, 20],
];

export function scheduleForDay(
  seed: string,
  params: ScheduleParams,
  cast: readonly Persona[],
  edges: readonly Edge[],
  day: number,
): DaySchedule {
  const obligations: ScheduledObligation[] = [];
  // new internal obligations arrive with a few days' notice
  edges.forEach((edge, ei) => {
    const rng = new Rng(`${seed}/sched/${day}/e${ei}`);
    const n = rng.poisson(params.oblRate * (edge.rate ?? 1));
    for (let k = 0; k < n; k++) {
      const memo = rng.pick(edge.memos);
      const usd = memo[1] === memo[2]
        ? memo[1]
        : Math.round((memo[1] + rng.next() * (memo[2] - memo[1])) / 10) * 10;
      obligations.push({
        id: `${day}.e${ei}.${k}`, payer: edge.payer, payee: edge.payee,
        memo: memo[0], usd, due: day + 2 + rng.int(8),
      });
    }
  });
  // rent day at the studio: the one cycle in the community graph
  // (Judy -> Heidi -> Ivan -> Judy) gets its three obligations at once,
  // so the tutorial's full-cycle settlement exists on every seed
  if (day === SETTLE_DAY) {
    const rng = new Rng(`${seed}/sched/${day}/story`);
    obligations.push(
      { id: `${day}.s0`, payer: 9, payee: 7, memo: "studio rent", usd: 850, due: day + 6 },
      { id: `${day}.s1`, payer: 7, payee: 8, memo: "display shelves", usd: Math.round((200 + rng.next() * 300) / 10) * 10, due: day + 6 },
      { id: `${day}.s2`, payer: 8, payee: 9, memo: "logo design", usd: Math.round((150 + rng.next() * 200) / 10) * 10, due: day + 6 },
    );
  }
  // rent recurs: the studio cycle reassembles for the game chapter — the
  // rent first, its offsetting legs two days later, so a player has real
  // turns to weigh before the oracle can net them (rng-free amounts; the
  // catalogue commission nearly offsets the rent, so a waiting Judy can
  // fund her small net even on seeds where she is running dry)
  if (day === GAME_DAY) {
    obligations.push({ id: `${day}.s0`, payer: 9, payee: 7, memo: "studio rent", usd: 850, due: day + 8 });
  }
  if (day === GAME_DAY + 2) {
    obligations.push(
      { id: `${day}.s0`, payer: 7, payee: 8, memo: "display shelves", usd: 480, due: day + 6 },
      { id: `${day}.s1`, payer: 8, payee: 9, memo: "exhibition catalogue", usd: 780, due: day + 6 },
    );
  }
  // external purchases: unrounded retail prices, paid on the spot
  const purchases: ScheduledPurchase[] = [];
  for (let u = 0; u < cast.length; u++) {
    const rng = new Rng(`${seed}/sched/${day}/x${u}`);
    const n = rng.poisson(params.extRate);
    for (let k = 0; k < n; k++) {
      const memo = rng.pick(EXTERNAL_MEMOS);
      purchases.push({
        id: `${day}.x${u}.${k}`, payer: u, memo: memo[0],
        usd: Math.round((memo[1] + rng.next() * (memo[2] - memo[1])) * 100) / 100,
      });
    }
  }
  return { obligations, purchases };
}
