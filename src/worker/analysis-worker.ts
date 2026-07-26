// The analysis worker (#84): the same deterministic town, rebuilt from
// the session's replay inputs, analyzed by the shared pipeline off the
// main thread. No chain crosses the message boundary — the seed, params
// and recorded choices fully determine the world, so the worker replays
// it once and keeps it warm; jobs carry only knob settings and the
// display cursor. Results are plain Maps and arrays, structured-cloned
// back for the page to install into its memos.
import { Economy, type EconomyParams, type ParamPatch, type Intervention } from "../engine/economy";
import { runAnalysis, type AnalysisKnobs, type AnalysisWants, type AnalysisBundle } from "../analysis/pipeline";

export interface AnalysisJob {
  id: number;
  session: {
    seed: string;
    params: Partial<EconomyParams>;
    timeline: ParamPatch[];
    manual: number | null;
    manualFrom: number;
    interventions: Intervention[];
  };
  /** the record's frontier day on the page's side */
  day: number;
  /** the display cursor's day (= day when riding the frontier) */
  cursor: number;
  /** freeze-frame position within the cursor day, if any */
  tx: number | null;
  knobs: AnalysisKnobs;
  wants: AnalysisWants;
}

export interface AnalysisReply {
  id: number;
  bundle: AnalysisBundle;
}

let eco: Economy | null = null;
let ecoKey = "";

addEventListener("message", (ev) => {
  const job = (ev as MessageEvent).data as AnalysisJob;
  const s = job.session;
  const key = JSON.stringify([s.seed, s.params, s.timeline, s.manual, s.manualFrom, s.interventions]);
  if (!eco || ecoKey !== key) {
    eco = new Economy(s.seed, s.params);
    eco.manual = s.manual;
    eco.manualFrom = s.manualFrom;
    eco.interventions = s.interventions;
    eco.timeline = s.timeline;
    ecoKey = key;
  }
  if (eco.day < job.day) eco.runTo(job.day);
  // the worker's copy may have outlived a page-side rebuild to an
  // earlier day (the record is append-only under one key, so the prefix
  // matches); truncation makes the analyzed chain the visible one either
  // way
  const whole = eco.day === job.day && job.cursor >= job.day && job.tx === null;
  const chain = whole
    ? eco.chain
    : eco.chain.through(Math.min(job.cursor, job.day), job.tx ?? Infinity);
  const priceAt = (d: number): number | undefined => eco!.prices[d];
  const bundle = runAnalysis(chain, priceAt, s.seed, job.knobs, job.wants);
  postMessage({ id: job.id, bundle } satisfies AnalysisReply);
});
