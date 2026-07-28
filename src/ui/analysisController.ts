// The analysis controller (#122a): everything the observer's map is
// computed from — the heuristic knobs, the knowledge grant, the two
// cluster matchers with their replay cursors, the memo layer that makes
// re-toggling free (#85), and the worker gateway that keeps the heavy
// recomputes off the main thread (#84). The app shell owns the DOM, the
// camera, and the scenes; it reaches analysis only through the object
// this factory returns, and the controller reaches the app only through
// the injected host — one boundary, crossed in both directions in one
// place.
import { clusterObserver, gradeLinks, type Clustering, type Mistake } from "../analysis/clusters";
import { TELL_USD, TELL_BTC, TELL_AUX, TELL_SCRIPT, TELL_ALL, OV_CIOH, OV_CHANGE, OV_SUBSUM, OV_REUSE, OV_REMEET, OV_ALL, CIOH_MAX_OFF } from "../analysis/observer";
import { observerGrants, grantAttribution, grantMerges, clusterGrantOwners } from "../analysis/auxinfo";
import type { Attribution } from "../analysis/knowledge";
import { nsSocialRun, nsApply, partitionColumns, type NsEvent } from "../analysis/nssocial";
import { nfRun as runNetflix, type NfEvent } from "../analysis/nsnetflix";
import { observerOpts, type AnalysisKnobs, type AnalysisBundle } from "../analysis/pipeline";
// import type: guaranteed fully erased — the worker module's top-level
// message listener must never execute on the page's side
import type { AnalysisJob, AnalysisReply } from "../worker/analysis-worker";
import type { Chain } from "../model/chain";

// --- #85: the heavy results memoize across knob changes. simRev keeps
// bumping on every observer-map knob (the cheap per-rev caches stay
// honest that way), but clusterings, matcher runs, gradings and
// contracted layouts are keyed by WHAT they were computed from: the
// visible chain's identity plus the full knob signature. Unchecking
// and rechecking a heuristic lands back on a key already computed, so
// the toggle replays the repartition tween without repeating the work.
export interface Memo<V> {
  get(key: string, compute: () => V): V;
  /** whether the key is already computed — the async gateway's probe (#84) */
  has(key: string): boolean;
  /** install a result computed elsewhere (the worker's) under its key */
  set(key: string, v: V): void;
}
export function memoLRU<V>(cap: number): Memo<V> {
  const m = new Map<string, V>();
  const set = (key: string, v: V): void => {
    m.delete(key); // re-insertion keeps the map in recency order
    m.set(key, v);
    if (m.size > cap) m.delete(m.keys().next().value!);
  };
  return {
    get(key, compute) {
      if (m.has(key)) {
        const v = m.get(key)!;
        m.delete(key);
        m.set(key, v);
        return v;
      }
      const v = compute();
      set(key, v);
      return v;
    },
    has: (key) => m.has(key),
    set,
  };
}

export interface GrantState {
  attr: Map<string, Attribution>;
  /** attributed base-cluster representatives → the one owner their
   *  grants name (conflicted clusters are absent: the observer knows
   *  one of those links is a lie, so the vertex earns no name) */
  owners: Map<string, number | null>;
  fused: Clustering;
}

/** the knobs the gateway snapshots and reverts: everything a routed
 *  handler mutates (replay cursors stay out — finish() sets those) */
interface KnobSnap {
  ov: number; cm: number; ce: number; ct: number;
  kx: boolean; ax: number;
  ns: boolean; nth: number; npt: number;
  nf: boolean; nfth: number; mi: boolean;
}
interface SubmittedJob {
  msg: AnalysisJob;
  target: KnobSnap;
  finish: () => void;
  /** invalidated when a warm toggle lands synchronously mid-flight */
  epoch: number;
  /** the visible chain at submit time; a chain that grew mid-flight
   *  just misses the cache — one synchronous recompute on the next
   *  draw beats installing results under the wrong key */
  chainK: string;
  nsManualSig: string;
}

/** the worker surface the gateway drives — a seam, so tests hand in a
 *  counting fake and the page hands in the real inlined worker */
export interface WorkerLike {
  postMessage(msg: AnalysisJob): void;
  addEventListener(type: "message" | "error", fn: (ev: { data?: unknown }) => void): void;
}

/** everything the controller needs from the app shell, read lazily so
 *  the shell's own mutable state (scene, cursor, lens) stays where it
 *  is — the controller never caches a host answer across calls */
export interface AnalysisHost {
  /** the visible chain: the record grown to the cursor's freeze-frame */
  chain(): Chain;
  /** price lookup for the live economy; undefined outside it */
  priceAt(): ((d: number) => number | undefined) | undefined;
  /** whether the live economy is on stage — the only scene whose
   *  analysis is heavy enough to route through the worker */
  liveEconomy(): boolean;
  seed(): string;
  /** the replay inputs an off-thread job rebuilds the world from */
  jobSession(): AnalysisJob["session"];
  /** the recorded frontier day (only read while the economy is live) */
  day(): number;
  cursorDay(): number;
  viewTx(): number | null;
  /** whether the third-party observer lens is active — the matchers
   *  apply only to the observer's map */
  observerLens(): boolean;
  /** the singleton (uncontracted) view: matchers read the partition,
   *  so they are moot while it is flattened away */
  unclustered(): boolean;
  /** the visible world changed identity — every per-rev cache reheats */
  bumpSimRev(): void;
  /** the "thinking" pill the worker gateway shows on a cold wait */
  busy: HTMLElement | null;
  /** seam: build the analysis worker — tests hand in a counting fake;
   *  when absent the page's inlined worker source is used */
  makeWorker?: () => WorkerLike | null;
  /** called after every knob landing — the sync path, a worker reply,
   *  and the worker-down fallback all announce here, so the display
   *  engine can integrate() the new map (#141 slice 4f) */
  landed?: () => void;
}

export type AnalysisController = ReturnType<typeof createAnalysisController>;

export function createAnalysisController(host: AnalysisHost) {
  /** identity of the visible chain: which object, grown how far — the
   *  part of every analysis input that is not a knob */
  let chainIdNext = 1;
  const chainIdOf = new WeakMap<object, number>();

  const mistakeMemo = memoLRU<Map<string, Mistake[]>>(16);
  const clMemo = memoLRU<Clustering>(24);
  // the granted set itself, cached apart from the attribution state: the
  // base clustering consumes it too (as the change heuristic's auxiliary
  // payment identifier), and must not have to build attributions first
  const grantMapMemo = memoLRU<Map<string, number | null>>(16);
  const grantMemo = memoLRU<GrantState>(16);
  const observerModelMemo = memoLRU<Clustering>(16);
  const nsRunMemo = memoLRU<NsEvent[]>(16);
  const nfRunMemo = memoLRU<NfEvent[]>(16);

  // --- #84 worker gateway internals: at most one job in flight, a knob
  // moved again mid-flight replaces the queued follow-up (last wins)
  let inFlight: SubmittedJob | null = null;
  let queuedJob: SubmittedJob | null = null;
  let knobEpoch = 0;
  /** where the knobs are headed while a job is in flight — a further
   *  change mutates on top of this, not the frozen display state */
  let knobTarget: KnobSnap | null = null;
  let workerDown = false;
  let jobSeq = 0;
  const analysisWorker: WorkerLike | null = (() => {
    const w = host.makeWorker ? host.makeWorker() : makePageWorker();
    if (w) {
      w.addEventListener("message", (ev) => { onWorkerReply(ev.data as AnalysisReply); });
      w.addEventListener("error", () => { onWorkerDown(); });
    }
    return w;
  })();
  function makePageWorker(): WorkerLike | null {
    const src = (window as unknown as { __WORKER_SRC?: string }).__WORKER_SRC;
    if (!src || typeof Worker === "undefined") return null;
    try {
      return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { name: "analysis" });
    } catch {
      return null;
    }
  }

  function snapKnobs(): KnobSnap {
    return {
      ov: A.overlays, cm: A.ciohMax, ce: A.changeEvidence, ct: A.changeTells,
      kx: A.kycObs, ax: A.auxFrac,
      ns: A.nsSocial, nth: A.nsThreshold, npt: A.nsParts,
      nf: A.nfOn, nfth: A.nfThreshold, mi: A.showMistakes,
    };
  }
  function applyKnobsSnap(k: KnobSnap): void {
    A.overlays = k.ov; A.ciohMax = k.cm; A.changeEvidence = k.ce; A.changeTells = k.ct;
    A.kycObs = k.kx; A.auxFrac = k.ax;
    A.nsSocial = k.ns; A.nsThreshold = k.nth; A.nsParts = k.npt;
    A.nfOn = k.nf; A.nfThreshold = k.nfth; A.showMistakes = k.mi;
  }
  /** whether every memo the current settings will consult is warm */
  function analysisReady(): boolean {
    if (!clMemo.has(A.mapSig())) return false;
    if (A.grantsOn() && (!grantMapMemo.has(grantMapKey()) || !grantMemo.has(A.mapSig()))) return false;
    if (A.nsSocial && !nsRunMemo.has(nsRunKey())) return false;
    if (A.nfOn && !nfRunMemo.has(nfRunKey())) return false;
    if (A.showMistakes && !mistakeMemo.has(A.mapSig())) return false;
    return true;
  }
  function grantMapKey(): string {
    return `${A.chainKey()}|${A.grantSig()}`;
  }
  function nsRunKey(): string {
    return `${A.mapSig()}§ns${A.nsThreshold}|${A.nsParts}`;
  }
  function nfRunKey(): string {
    return `${A.mapSig()}§${A.nsSig()}§nf${A.nfThreshold}`;
  }
  /** the job message, built with the TARGET knobs applied; nsFull marks
   *  a handler about to pin the ns replay cursor to the end of the run */
  function buildAnalysisJob(nsFull: boolean): AnalysisJob {
    return {
      id: ++jobSeq,
      session: host.jobSession(),
      day: host.day(),
      cursor: host.cursorDay(),
      tx: host.viewTx(),
      knobs: A.analysisKnobs(),
      wants: {
        ns: A.nsSocial ? { threshold: A.nsThreshold, parts: A.nsParts } : null,
        nf: A.nfOn
          ? {
              threshold: A.nfThreshold,
              applyNs: A.nsActive(),
              nsCursor: nsFull ? Number.MAX_SAFE_INTEGER : A.nsCursor,
              nsManual: A.nsManual.slice(),
            }
          : null,
        mistakes: A.showMistakes,
      },
    };
  }
  function nsManualSigNow(): string {
    return A.nsManual.map((e) => `${e.a}+${e.b}`).join(",");
  }
  /** install the worker's results under the keys the applied target
   *  state derives — the same strings the draw path will ask for */
  function installBundle(b: AnalysisBundle): void {
    clMemo.set(A.mapSig(), b.cl);
    if (b.grantMap) grantMapMemo.set(grantMapKey(), b.grantMap);
    if (b.grant) grantMemo.set(A.mapSig(), b.grant);
    if (b.nsEvents) nsRunMemo.set(nsRunKey(), b.nsEvents);
    if (b.mistakes) mistakeMemo.set(A.mapSig(), b.mistakes);
  }
  /** the nf run's key includes the ns replay position, which finish()
   *  may move — install only when what the worker computed on is what
   *  the key denotes right now (called before AND after finish) */
  function tryInstallNf(job: SubmittedJob, b: AnalysisBundle): void {
    const want = job.msg.wants.nf;
    if (!want || !b.nfEvents || !A.nfOn) return;
    if (want.applyNs !== A.nsActive()) return;
    if (want.applyNs) {
      if (job.nsManualSig !== nsManualSigNow()) return;
      const runLen = b.nsEvents ? b.nsEvents.length : 0;
      if (Math.min(want.nsCursor, runLen) !== Math.min(A.nsCursor, runLen)) return;
    }
    nfRunMemo.set(nfRunKey(), b.nfEvents);
  }
  function onWorkerReply(reply: AnalysisReply): void {
    const job = inFlight;
    inFlight = null;
    if (queuedJob) {
      // superseded mid-flight: drop this result, run the newest job
      inFlight = queuedJob;
      queuedJob = null;
      analysisWorker!.postMessage(inFlight.msg);
      return;
    }
    A.spinnerOff();
    if (!job || job.msg.id !== reply.id || job.epoch !== knobEpoch) return;
    knobTarget = null;
    applyKnobsSnap(job.target);
    host.bumpSimRev();
    if (A.chainKey() === job.chainK) {
      installBundle(reply.bundle);
      tryInstallNf(job, reply.bundle);
    }
    job.finish();
    if (A.chainKey() === job.chainK) tryInstallNf(job, reply.bundle);
    host.landed?.();
  }
  function onWorkerDown(): void {
    workerDown = true;
    const last = queuedJob ?? inFlight;
    inFlight = null;
    queuedJob = null;
    A.spinnerOff();
    if (last && last.epoch === knobEpoch) {
      // land the change synchronously after all: one jank, not a lost click
      knobTarget = null;
      applyKnobsSnap(last.target);
      host.bumpSimRev();
      last.finish();
      host.landed?.();
    }
  }

  // the spinner waits 150ms before showing: a fast worker roundtrip
  // should not flash a "thinking" pill for every notch of a slider
  let busyTimer: number | null = null;

  const A = {
    // --- the observer-map knobs, mutable in place: the app's setters
    // and the fragment restore write these directly, then route the
    // recompute through commitKnobs
    overlays: OV_ALL,
    ciohMax: CIOH_MAX_OFF,
    changeEvidence: 1,
    // which payment-identification tells the change heuristic runs (#76):
    // TELL_USD | TELL_BTC | TELL_AUX, all on by default. The evidence bar
    // is how many of the ENABLED kinds must fire before the sole leftover
    // output is linked.
    changeTells: TELL_ALL,
    // grading toggle: mark transactions where a heuristic's local inference
    // is wrong against the hidden truth (storyteller's grading — latent
    // truth flows only toward the learner's display, never into analysis)
    showMistakes: false,
    // --- the observer's knowledge grant (#67): auxiliary information as a
    // slider — a seeded fraction of coins revealed with their true labels —
    // with the exchange's KYC records as an optional floor of specific
    // coins underneath. The slider's minimum is the plain observer, its
    // maximum is omniscience; the KYC box clamps its floor either way. The
    // grant is DISCLOSED knowledge: truth enters only as the granted set,
    // and everything downstream (attribution, fusion, the propagation
    // sweeps seeded by it) runs blind on the public graph.
    kycObs: false,
    auxFrac: 0,
    // --- ns-social (#59): Narayanan–Shmatikov propagation over the cluster
    // graph. A layer ON TOP of the observer's map: the base heuristics link
    // coins into clusters, this matches clusters to each other by graph
    // structure. The checkbox controls both whether it is applied and
    // whether it is in view; to only look without applying, push the
    // threshold past cosine's ceiling — nothing clears it.
    nsSocial: false,
    nsThreshold: 0.5,
    nsParts: 2,
    /** replay cursor: how many of the algorithmic run's events are applied */
    nsCursor: 0,
    /** user decisions from the paused examination — accepted proposals and
     *  forced below-threshold entries — applied after the replay prefix */
    nsManual: [] as NsEvent[],
    nsPlaying: false,
    nsPlayTimer: null as number | null,
    /** the second vertex of a paused-mode proposal (the first is the
     *  selected cluster); examined in the panel, accepted or dismissed */
    nsSecond: null as string | null,
    // --- the ns-netflix rendition: statistical de-anonymization on top of
    // the same map — clusters matched by how they behave (amounts, timing,
    // feerates absolute and relative), not whom they touch. Greedy playback:
    // best score first, no vertex revisited. The checkbox controls both
    // application and view; the threshold's maximum admits nothing.
    nfOn: false,
    nfThreshold: 0.65,
    nfCursor: 0,
    nfPlaying: false,
    nfPlayTimer: null as number | null,

    // what the analysis actually runs: the sub-transaction analysis
    // GENERALIZES CIOH (an unsplittable transaction reads as one user's
    // spend), so while it is on CIOH runs regardless — but the user's own
    // CIOH setting is kept, not overwritten, and returns when sub-tx is
    // switched back off (#80)
    effOverlays(): number {
      return (A.overlays & OV_SUBSUM) !== 0 ? A.overlays | OV_CIOH : A.overlays;
    },
    tellCount(mask: number): number {
      return ((mask & TELL_USD) !== 0 ? 1 : 0) + ((mask & TELL_BTC) !== 0 ? 1 : 0) +
        ((mask & TELL_AUX) !== 0 ? 1 : 0) + ((mask & TELL_SCRIPT) !== 0 ? 1 : 0);
    },
    chainKey(): string {
      const c = host.chain();
      let id = chainIdOf.get(c);
      if (id === undefined) {
        id = chainIdNext++;
        chainIdOf.set(c, id);
      }
      return `${id}#${c.order.length}`;
    },
    /** everything the observer's base map is a function of — the
     *  statistical-fingerprinting knob included, since its intra-transaction
     *  reading (divergent input fingerprints veto the one-owner links)
     *  reshapes the base clustering, not just the overlay run */
    mapSig(): string {
      return `${A.chainKey()}§${A.overlays}|${A.ciohMax}|${A.changeEvidence}|${A.changeTells}|${A.nfOn ? 1 : 0}|${A.grantSig()}`;
    },
    mistakes(): Map<string, Mistake[]> {
      return mistakeMemo.get(A.mapSig(), () => gradeLinks(host.chain(), A.clustering().links));
    },
    // the base clustering reads the grant too (#66): an auxiliary
    // attribution is one of the change heuristic's payment identifiers, so
    // the observer's map varies with the dial — the signature carries it
    /** the observer-map knobs, resolved for the shared pipeline — the sync
     *  path and the worker read this one translation (#84) */
    analysisKnobs(): AnalysisKnobs {
      return {
        reuse: (A.overlays & OV_REUSE) !== 0,
        cioh: (A.effOverlays() & OV_CIOH) !== 0,
        change: (A.overlays & OV_CHANGE) !== 0,
        subsum: (A.overlays & OV_SUBSUM) !== 0,
        remeet: (A.overlays & OV_REMEET) !== 0,
        ...(A.ciohMax < CIOH_MAX_OFF ? { ciohMaxInputs: A.ciohMax } : {}),
        ...(A.changeEvidence > 1 ? { changeEvidence: A.changeEvidence } : {}),
        ...(A.changeTells !== TELL_ALL ? { changeTells: A.changeTells } : {}),
        ...(A.nfOn ? { fingerprints: true } : {}),
        kycObs: A.kycObs,
        auxFrac: A.auxFrac,
      };
    },
    clustering(): Clustering {
      return clMemo.get(A.mapSig(), () =>
        clusterObserver(host.chain(), host.priceAt(),
          observerOpts(A.analysisKnobs(), A.currentGrants() ?? null)));
    },
    grantsOn(): boolean {
      return A.kycObs || A.auxFrac > 0;
    },
    currentGrants(): Map<string, number | null> | undefined {
      if (!A.grantsOn()) return undefined;
      return grantMapMemo.get(grantMapKey(), () =>
        observerGrants(host.chain(), host.seed(), A.auxFrac, A.kycObs));
    },
    grantState(): GrantState {
      // mapSig covers both the base clustering and the grant knobs
      return grantMemo.get(A.mapSig(), () => {
        const g = A.currentGrants() ?? new Map<string, number | null>();
        const base = A.clustering();
        return {
          attr: grantAttribution(g, base),
          owners: clusterGrantOwners(g, base),
          fused: nsApply(base, grantMerges(g, base)),
        };
      });
    },
    /** the observer's map with the grant compounded in: attributed clusters
     *  of one owner fused into one vertex — the base every matcher (and the
     *  contracted view) reads, so a sweep run on it is a sweep seeded by
     *  the grant */
    observerBase(): Clustering {
      return A.grantsOn() ? A.grantState().fused : A.clustering();
    },
    /** ns-social matches sit on top of a partition's links, and the
     *  behavioral (ns-netflix) matches fuse on top of both — the same
     *  fusion, composed: matched clusters become one vertex at each
     *  matcher's current replay position */
    fuseMatches(base: Clustering): Clustering {
      const cl0 = A.nsActive() ? nsApply(base, A.nsEvents()) : base;
      return A.nfActive() ? nsApply(cl0, A.nfEvents()) : cl0;
    },
    /** the ONE observer model (#124): the grant-fused base with the ns-social
     *  and ns-netflix matches compounded, exactly as the collapsed map draws
     *  it — the trace's candidate sets and the display must read the same
     *  partition, or the lens shows evidence its own trace ignores */
    observerModel(): Clustering {
      return observerModelMemo.get(`${A.mapSig()}§${A.matchSig()}`, () => A.fuseMatches(A.observerBase()));
    },
    /** cache signature of the grant; "" = none in force */
    grantSig(): string {
      return A.grantsOn() ? `${A.kycObs ? 1 : 0}|${A.auxFrac}` : "";
    },
    /** cache signature of the ns-social replay position; "" = not applied */
    nsSig(): string {
      return A.nsActive()
        ? `${A.nsThreshold}|${A.nsParts}|${A.nsCursor}|${A.nsManual.map((e) => `${e.a}+${e.b}`).join(",")}`
        : "";
    },
    /** combined overlay-matching signature (grant + ns-social + ns-netflix) */
    matchSig(): string {
      return `${A.grantSig()}§${A.nsSig()}§${A.nfActive() ? `${A.nfThreshold}|${A.nfCursor}` : ""}`;
    },
    nsRun(): NsEvent[] {
      // mapSig covers the base map (observerBase is a function of it)
      const events = nsRunMemo.get(nsRunKey(), () =>
        nsSocialRun(A.observerBase(), host.chain(), A.nsThreshold, A.nsParts));
      A.nsCursor = Math.min(A.nsCursor, events.length);
      return events;
    },
    /** the events in force at the current replay position: the algorithmic
     *  prefix, then the user's own entries (stale ones — naming vertices the
     *  base map no longer has — drop out silently) */
    nsEvents(): NsEvent[] {
      const run = A.nsRun();
      const base = A.observerBase();
      const live = A.nsManual.filter((e) => base.members.has(e.a) && base.members.has(e.b));
      return [...run.slice(0, Math.min(A.nsCursor, run.length)), ...live];
    },
    nsActive(): boolean {
      return A.nsSocial && host.observerLens() && !host.unclustered();
    },
    /** which columns each APPLIED vertex spans: the columns of the base
     *  vertices the matching fused into it (one lane before any match) */
    nsLanes(base: Clustering, applied: Clustering): Map<string, number[]> {
      const col = partitionColumns(base, host.chain(), A.nsParts);
      const out = new Map<string, number[]>();
      for (const rep of applied.members.keys()) out.set(rep, []);
      for (const [baseRep, lane] of col) {
        const leader = applied.rep.get(baseRep);
        if (leader === undefined) continue;
        const lanes = out.get(leader);
        if (lanes && !lanes.includes(lane)) lanes.push(lane);
      }
      for (const lanes of out.values()) lanes.sort((a, b) => a - b);
      return out;
    },
    nfActive(): boolean {
      return A.nfOn && host.observerLens() && !host.unclustered();
    },
    /** the clustering the behavioral matcher reads: the observer's links,
     *  with any ns-social matches already fused */
    nfBase(): Clustering {
      const base = A.observerBase();
      return A.nsActive() ? nsApply(base, A.nsEvents()) : base;
    },
    nfRun(): NfEvent[] {
      // nfBase is a function of the base map and the ns-social replay
      const events = nfRunMemo.get(nfRunKey(), () =>
        runNetflix(A.nfBase(), host.chain(), A.nfThreshold));
      A.nfCursor = Math.min(A.nfCursor, events.length);
      return events;
    },
    /** applied prefix, as merge events the shared fusion understands */
    nfEvents(): NsEvent[] {
      return A.nfRun().slice(0, Math.min(A.nfCursor, A.nfRun().length))
        .map((e) => ({ kind: "merge" as const, a: e.a, b: e.b, score: e.score }));
    },

    // --- #84: the heavy analysis off the main thread. Every observer-knob
    // handler routes through commitKnobs: when the #85 memos already hold
    // the target's results the change lands synchronously as before, and
    // when they are cold the job goes to the analysis worker — the display
    // freezes on the previous settings, a spinner appears if the wait is
    // noticeable, and when the results come back they are installed into
    // the memos and the change lands with the same repartition tween a
    // warm toggle replays. The worker holds at most one job; a knob moved
    // again mid-flight replaces the queued follow-up (last wins).
    /** route a knob change: mutate the settings, then either finish now
     *  (memos warm, no worker, or not the live economy) or freeze the
     *  display and finish when the worker's results land */
    commitKnobs(mutate: () => void, finish: () => void, opts: { nsFull?: boolean } = {}): void {
      const prev = knobTarget ?? snapKnobs();
      if (knobTarget) applyKnobsSnap(knobTarget);
      mutate();
      host.bumpSimRev(); // the observer's map — and every lens seeded from it — changes
      if (!host.liveEconomy() || workerDown || !analysisWorker || analysisReady()) {
        // a warm landing invalidates anything still in flight: its results
        // may install (right keys, right data) but must not re-apply an
        // older target over this newer state
        knobEpoch += 1;
        knobTarget = null;
        queuedJob = null;
        A.spinnerOff();
        finish();
        host.landed?.();
        return;
      }
      const target = snapKnobs();
      const sub: SubmittedJob = {
        msg: buildAnalysisJob(opts.nsFull === true),
        target,
        finish,
        epoch: knobEpoch,
        chainK: A.chainKey(),
        nsManualSig: nsManualSigNow(),
      };
      // the display keeps the settings it was drawn with; the DOM controls
      // already show the user's choice, and the spinner covers the gap
      applyKnobsSnap(knobTarget ?? prev);
      knobTarget = target;
      if (inFlight) queuedJob = sub;
      else {
        inFlight = sub;
        analysisWorker.postMessage(sub.msg);
      }
      A.spinnerSoon();
    },
    spinnerSoon(): void {
      const busyEl = host.busy;
      if (!busyEl || busyTimer !== null || !busyEl.hidden) return;
      busyTimer = window.setTimeout(() => {
        busyTimer = null;
        busyEl.hidden = false;
      }, 150);
    },
    spinnerOff(): void {
      if (busyTimer !== null) {
        clearTimeout(busyTimer);
        busyTimer = null;
      }
      if (host.busy) host.busy.hidden = true;
    },
  };
  return A;
}
