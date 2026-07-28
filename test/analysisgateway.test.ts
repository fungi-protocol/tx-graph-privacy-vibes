// The #84 worker gateway, pinned through the seams #141 slice 4f
// opened: a fake worker counts the jobs the controller schedules, and
// the landed() hook counts the landings the display engine would
// integrate. Acceptance #27: a knob retoggle whose results the #85
// memos already hold schedules NO analysis job — the transition
// replays from cache. Also pinned: last-wins supersede (a knob moved
// again mid-flight replaces the queued follow-up), and the
// worker-down fallback landing synchronously — every landing path
// announcing through landed() exactly once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnalysisController, type WorkerLike } from "../src/ui/analysisController";
import { runAnalysis } from "../src/analysis/pipeline";
import { CIOH_MAX_OFF } from "../src/analysis/observer";
import { Economy } from "../src/engine/economy";
import type { AnalysisJob, AnalysisReply } from "../src/worker/analysis-worker";

function makeRig(): {
  A: ReturnType<typeof createAnalysisController>;
  posted: AnalysisJob[];
  reply: (job: AnalysisJob) => void;
  fail: () => void;
  landings: () => number;
} {
  const eco = new Economy("golden");
  eco.runTo(20);
  const posted: AnalysisJob[] = [];
  const listeners = new Map<string, (ev: { data?: unknown }) => void>();
  const worker: WorkerLike = {
    postMessage: (m) => { posted.push(m); },
    addEventListener: (t, fn) => { listeners.set(t, fn); },
  };
  let landings = 0;
  const A = createAnalysisController({
    chain: () => eco.chain,
    priceAt: () => (d: number): number | undefined => eco.prices[d],
    liveEconomy: () => true,
    seed: () => "golden",
    jobSession: () => ({
      seed: "golden", params: {}, timeline: [],
      manual: null, manualFrom: 0, interventions: [],
    }),
    day: () => eco.day,
    cursorDay: () => eco.day,
    viewTx: () => null,
    observerLens: () => true,
    unclustered: () => false,
    bumpSimRev: () => {},
    busy: null,
    makeWorker: () => worker,
    landed: () => { landings += 1; },
  });
  // an honest reply: the same pipeline the real worker runs, on the
  // same replayed world, with the job's own knobs and wants
  const reply = (job: AnalysisJob): void => {
    const bundle = runAnalysis(
      eco.chain, (d) => eco.prices[d], "golden", job.knobs, job.wants);
    listeners.get("message")!({ data: { id: job.id, bundle } satisfies AnalysisReply });
  };
  const fail = (): void => { listeners.get("error")!({}); };
  return { A, posted, reply, fail, landings: () => landings };
}

test("#27: a warm retoggle schedules no analysis job — the cached transition replays", () => {
  const { A, posted, reply, landings } = makeRig();
  A.clustering(); // warm the boot-state map, as the first draw does
  const finished: string[] = [];

  // cold change: one job to the worker, display frozen until the reply
  A.commitKnobs(() => { A.ciohMax = 5; }, () => { finished.push("cold"); });
  assert.equal(posted.length, 1);
  assert.deepEqual(finished, []);
  assert.equal(A.ciohMax, CIOH_MAX_OFF, "display keeps the drawn settings while in flight");

  reply(posted[0]!);
  assert.deepEqual(finished, ["cold"]);
  assert.equal(A.ciohMax, 5, "the landing applies the target knobs");
  assert.equal(landings(), 1);

  // back to the boot state: warmed by clustering() above — synchronous
  A.commitKnobs(() => { A.ciohMax = CIOH_MAX_OFF; }, () => { finished.push("back"); });
  assert.equal(posted.length, 1, "no job for a memoized state");
  assert.deepEqual(finished, ["cold", "back"]);

  // retoggle to the worker-computed state: its results were installed
  // into the memos, so the second toggle schedules nothing (#27/#85)
  A.commitKnobs(() => { A.ciohMax = 5; }, () => { finished.push("warm"); });
  assert.equal(posted.length, 1, "the retoggle replays from cache — zero recompute");
  assert.deepEqual(finished, ["cold", "back", "warm"]);
  assert.equal(landings(), 3, "every landing path announces exactly once");
});

test("last wins: a knob moved again mid-flight replaces the queued follow-up", () => {
  const { A, posted, reply, landings } = makeRig();
  A.clustering();
  const finished: string[] = [];

  A.commitKnobs(() => { A.ciohMax = 3; }, () => { finished.push("first"); });
  assert.equal(posted.length, 1);
  // two more changes while the first is in flight: they mutate on top
  // of the in-flight target, and only the NEWEST queued job survives
  A.commitKnobs(() => { A.changeEvidence = 2; }, () => { finished.push("second"); });
  A.commitKnobs(() => { A.changeEvidence = 3; }, () => { finished.push("third"); });
  assert.equal(posted.length, 1, "the queue holds, not the worker");

  // the first reply is superseded: dropped, the queued job goes out
  reply(posted[0]!);
  assert.equal(posted.length, 2);
  assert.deepEqual(finished, [], "a superseded result must not land");
  assert.equal(landings(), 0);

  reply(posted[1]!);
  assert.deepEqual(finished, ["third"], "only the newest change lands");
  assert.equal(A.ciohMax, 3, "mid-flight mutations compose on the target");
  assert.equal(A.changeEvidence, 3);
  assert.equal(landings(), 1);
});

test("worker down: the change lands synchronously and still announces", () => {
  const { A, posted, fail, landings } = makeRig();
  A.clustering();
  const finished: string[] = [];

  A.commitKnobs(() => { A.ciohMax = 4; }, () => { finished.push("fallback"); });
  assert.equal(posted.length, 1);
  fail();
  assert.deepEqual(finished, ["fallback"], "one jank, not a lost click");
  assert.equal(A.ciohMax, 4);
  assert.equal(landings(), 1);

  // with the worker marked down, further changes land synchronously
  A.commitKnobs(() => { A.ciohMax = 6; }, () => { finished.push("sync"); });
  assert.equal(posted.length, 1, "no more jobs go to a dead worker");
  assert.deepEqual(finished, ["fallback", "sync"]);
  assert.equal(landings(), 2);
});
