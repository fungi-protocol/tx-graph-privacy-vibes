// Agent choice: a deliberately simple, legible cost function over the
// candidate plans, then a Markov-weighted random pick — NOT argmin. Agents
// usually do the sensible thing, sometimes not; the cost terms are meant
// to be read, not optimized.
import { type Rng } from "../core/prng";
import { type Persona } from "../scenario/cast";

export interface CostedPlan<T> {
  plan: T;
  cost: number;
  /** legible breakdown, e.g. { fee: 0.7, naive: 6 } */
  terms: Record<string, number>;
}

/** softmax over negative cost: cheaper plans are likelier, never certain */
export function chooseWeighted<T>(rng: Rng, plans: CostedPlan<T>[], temperature = 1.5): CostedPlan<T> {
  const min = Math.min(...plans.map((p) => p.cost));
  const weights = plans.map((p) => Math.exp(-(p.cost - min) / temperature));
  return plans[rng.weighted(weights)]!;
}

/** fee displeasure: sats scaled into "bother points", weighted by thrift */
export function feeCost(p: Persona, feeSats: number): number {
  return (feeSats / 500) * (0.5 + p.stats.thrift / 5);
}

/** the privacy price of a naive spend: linking this payment to the wallet */
export function naiveCost(p: Persona): number {
  return p.stats.privacy * 2;
}

/** coordinating a two-party transaction takes effort */
export function hassleCost(p: Persona): number {
  return 1 + p.stats.hassle * 1.2;
}

/** waiting is cheap when the deadline is far, painful when it is close */
export function urgencyCost(daysLeft: number): number {
  return 6 / Math.max(1, daysLeft);
}
