// Guided tutorial: a sequence of narrated steps, each optionally moving the
// camera to look at something. Skippable at any point; the chapter select
// grows as milestones add chapters.
export interface TutorialStep {
  id: string;
  title: string;
  /** body markup; a function is resolved when the step becomes active,
   *  so a step can display a value computed from the live world (e.g.
   *  the analysis verdict for the selected transaction) instead of
   *  asserting one */
  html: string | (() => string);
  /** world rect to frame when the step becomes active (function = resolved late) */
  focus?: Rect | (() => Rect);
  /** which view this step wants: 0 = block explorer, 1 = bipartite,
   *  2 = clusters, 3 = the singleton ring (clusters view, unclustered —
   *  the coin graph laid on the time circle, nothing stacked) */
  view?: 0 | 1 | 2 | 3;
  /** which lens this step wants: 0 = all-seeing, 1 = observer, 2 = agent */
  lens?: 0 | 1 | 2;
  /** lens 2: whose eyes (function = resolved late; undefined = app default) */
  agent?: () => number | undefined;
  /** lens 1: observer heuristics bitmask (1 CIOH, 2 change,
   * 4 sub-transaction analysis); undefined = inherit from the last step
   * that set it, so a heuristic stays off until the chapter that
   * introduces it switches it on (a jump to any step lands on the same
   * value the walked path would) */
  overlays?: number;
  /** lens 1: which of the change/payment identification's heuristics
   * run (TELL_* bitmask); undefined = inherit from the last step that
   * set it (default all), same walked-path rule as `overlays`, so the
   * chapter can introduce the family one member at a time */
  changeTells?: number;
  /** lens 1: the observer's knowledge grant [1 = KYC records held,
   * auxiliary reveals as % of coins]; undefined = inherit from the last
   * step that set it (default none — the plain observer), same rule as
   * `overlays` so jumps land on the walked path's value */
  grants?: [number, number];
  /** lens 1: whether the statistical-fingerprinting analysis runs;
   * undefined = inherit from the last step that set it (default off),
   * same walked-path rule as `overlays` */
  nf?: boolean;
  /** lens 1: whether the social-network analysis runs; same walked-path
   * rule and default as `nf` */
  ns?: boolean;
  /** whether the mistakes grading (deviation from the hidden truth) is
   * shown; same walked-path rule and default as `nf`. The storyteller's
   * display, not an observer capability — steps switch it on where the
   * map first disagrees with the truth outright */
  mi?: boolean;
  /** which scene this step plays in: 0 = intro story, 1 = the economy */
  scene?: 0 | 1;
  /** economy steps may require the simulation to have reached this day */
  minDay?: number;
  /** something to select when the step becomes active (trace highlight);
   * null clears the selection; undefined leaves it alone */
  select?: () => { kind: "coin" | "tx"; id: string } | null | undefined;
  /** heuristics-panel rows this step unhides without running them — for
   * a step that invites the reader to flip a switch itself. Walked-path
   * rule like `overlays`: revealed at every step at or after this one */
  reveals?: string[];
  /** top-level controls this step introduces explicitly — for widgets
   * whose reveal is not derivable from the step's view/lens (the cast
   * and params panels). Same prefix rule as the derived reveals */
  stages?: TutorialWidget[];
  /** start the named analysis playback when the step lands: "ns" opens
   * the epoch-columns modal and replays the propagation from the top,
   * "nf" replays the greedy matching in place. NOT walked-path
   * inherited — the playback belongs to this one step; stepping away
   * stops it (the navigation backstop closes the ns modal) */
  replay?: "ns" | "nf";
}

export interface Rect { x: number; y: number; w: number; h: number }

/** the stageable top-level controls: the view/layout/grouping knobs,
 *  the clusters shortcut, the lens cycler, and the cast/params panel
 *  buttons. "chord" is not a button of its own but the layout knob's
 *  third position — staged separately so the cycle skips the ring
 *  until the tour has drawn it */
export type TutorialWidget =
  "view" | "layout" | "cluster" | "uncluster" | "lens" | "chord" | "cast" | "params";

/** which controls the walked path has introduced by `index` (#116, the
 *  full schedule per #141 slice 6): everything starts hidden; the view
 *  knob AND the layout knob (layered|force — no chord position yet)
 *  appear with the first step drawn in the graph — the bipartite
 *  slide; the chord position appears with the ring's introduction (the
 *  singleton ring, view 3); the grouping controls with the first step
 *  that stacks the ring into cluster discs (view 2 — which also covers
 *  chord, for a tour that never shows the bare ring); the lens with
 *  the first step seen through other eyes; the cast and params panels
 *  where a step names them (`stages`). A prefix property, so a jump to
 *  any step reveals exactly what walking there would have — and
 *  re-scanning after a back-step can only re-add, never hide. */
export function widgetRevealsAt(steps: TutorialStep[], index: number): Set<TutorialWidget> {
  const out = new Set<TutorialWidget>();
  for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
    const s = steps[i]!;
    if (s.view !== undefined && s.view >= 1) { out.add("view"); out.add("layout"); }
    if (s.view === 3) out.add("chord");
    if (s.view === 2) { out.add("cluster"); out.add("uncluster"); out.add("chord"); }
    if (s.lens === 1 || s.lens === 2) out.add("lens");
    for (const w of s.stages ?? []) out.add(w);
  }
  return out;
}

export interface TutorialCallbacks {
  onFocus: (focus: Rect) => void;
  onStepChange?: (index: number) => void;
  onView?: (view: 0 | 1 | 2 | 3) => void;
  onLens?: (lens: 0 | 1 | 2, agent?: number) => void;
  /** observer-lens steps set which heuristics run, after lens */
  onOverlays?: (overlays: number) => void;
  /** observer-lens steps stage the change/payment heuristics too */
  onChangeTells?: (mask: number) => void;
  /** observer-lens steps set the knowledge grant, after overlays */
  onGrants?: (kyc: number, aux: number) => void;
  /** observer-lens steps stage the statistical-fingerprinting analysis */
  onNf?: (on: boolean) => void;
  /** observer-lens steps stage the social-network analysis */
  onNs?: (on: boolean) => void;
  /** steps stage the mistakes grading (the storyteller's error display) */
  onMi?: (on: boolean) => void;
  /** fired on every step landing with the step's `replay` (null when it
   *  has none, so a running playback stops when the story moves on);
   *  re-fired after a time ride lands — the run the playback walks is
   *  computed from the day the step is written for */
  onReplay?: (kind: "ns" | "nf" | null) => void;
  /** scene change + fast-forward requirement, fired before focus */
  /** advance the scene and the economy to the step's minDay. When the
   *  step jumps time forward, the visible day RIDES there (#24) — and
   *  the step's exhibit may not exist until the ride lands, so onRode
   *  fires once the visible day reaches minDay (and only then; a step
   *  that moved no time never calls it). */
  onScene?: (scene: 0 | 1, minDay: number, onRode?: () => void) => void;
  /** steps that trace something fire this after lens, before focus */
  onSelect?: (sel: { kind: "coin" | "tx"; id: string } | null) => void;
  /** the learner pressed "done ✓" on the last step: hand the town over */
  onDone?: () => void;
  /** the learner pressed "skip the tour": free play from here */
  onSkip?: () => void;
}

export class Tutorial {
  private index = 0;
  private panel: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;
  private progress: HTMLElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;

  constructor(private steps: TutorialStep[], private cb: TutorialCallbacks) {
    this.panel = document.createElement("div");
    this.panel.id = "tutorial";
    this.panel.innerHTML = `
      <div class="tut-head">
        <span class="tut-title"></span>
        <span class="tut-progress"></span>
      </div>
      <div class="tut-body"></div>
      <div class="tut-nav">
        <button class="tut-prev">← back</button>
        <button class="tut-next">next →</button>
        <button class="tut-skip" title="you can bring the tour back from the menu">skip the tour</button>
      </div>`;
    document.body.appendChild(this.panel);
    this.body = this.panel.querySelector(".tut-body")!;
    this.title = this.panel.querySelector(".tut-title")!;
    this.progress = this.panel.querySelector(".tut-progress")!;
    this.prevBtn = this.panel.querySelector(".tut-prev")!;
    this.nextBtn = this.panel.querySelector(".tut-next")!;
    this.prevBtn.addEventListener("click", () => this.go(this.index - 1));
    this.nextBtn.addEventListener("click", () => {
      if (this.index === this.steps.length - 1) {
        this.hide();
        this.cb.onDone?.();
      } else this.go(this.index + 1);
    });
    this.panel.querySelector(".tut-skip")!.addEventListener("click", () => {
      this.hide();
      this.cb.onSkip?.();
    });
  }

  go(index: number, animate = true): void {
    this.index = Math.max(0, Math.min(this.steps.length - 1, index));
    const step = this.steps[this.index]!;
    this.title.textContent = step.title;
    this.progress.textContent = `${this.index + 1} / ${this.steps.length}`;
    // advance the scene (and the economy, to the step's minDay) before
    // rendering the body: html() closures that stage an exhibit off the
    // record must read the chain the step is written for, not whatever
    // day a fragment jump happens to restore into
    // a step whose minDay lies ahead of the visible day rides time
    // forward; its body/select/focus closures read the VISIBLE chain, so
    // anything they staged before the ride landed (an exhibit that does
    // not exist yet, a camera framing that fell back to the whole graph)
    // is re-dispatched once the day arrives
    if (animate && step.scene !== undefined) {
      this.cb.onScene?.(step.scene, step.minDay ?? 0, () => {
        if (this.steps[this.index] !== step || this.panel.style.display === "none") return;
        this.body.innerHTML = typeof step.html === "function" ? step.html() : step.html;
        if (step.select) {
          const sel = step.select();
          if (sel !== undefined) this.cb.onSelect?.(sel);
        }
        if (step.focus) {
          this.cb.onFocus(typeof step.focus === "function" ? step.focus() : step.focus);
        }
        this.cb.onReplay?.(step.replay ?? null);
      });
    }
    this.body.innerHTML = typeof step.html === "function" ? step.html() : step.html;
    this.prevBtn.disabled = this.index === 0;
    this.nextBtn.textContent = this.index === this.steps.length - 1 ? "done ✓" : "next →";
    if (animate && step.view !== undefined) this.cb.onView?.(step.view);
    if (animate) this.cb.onLens?.(step.lens ?? 0, step.agent?.());
    // the family mask lands before the change row turns on: the two
    // route through the analysis worker as separate commits, and the
    // overlays commit must not surface with last step's wider mask
    // still in effect (that transient would mark the not-yet-introduced
    // family members as seen and unhide them early)
    if (animate) this.cb.onChangeTells?.(this.changeTellsAt(this.index));
    if (animate) this.cb.onOverlays?.(this.overlaysAt(this.index));
    if (animate) {
      const [kyc, aux] = this.grantsAt(this.index);
      this.cb.onGrants?.(kyc, aux);
    }
    if (animate) this.cb.onNf?.(this.flagAt(this.index, "nf"));
    if (animate) this.cb.onNs?.(this.flagAt(this.index, "ns"));
    if (animate) this.cb.onMi?.(this.flagAt(this.index, "mi"));
    if (animate) this.cb.onReplay?.(step.replay ?? null);
    if (animate && step.select) {
      const sel = step.select();
      if (sel !== undefined) this.cb.onSelect?.(sel);
    }
    if (animate && step.focus) {
      this.cb.onFocus(typeof step.focus === "function" ? step.focus() : step.focus);
    }
    this.cb.onStepChange?.(this.index);
    this.panel.style.display = "flex"; // the panel is a flex column (body scrolls alone)
  }

  /** effective heuristics at a step: the last explicit `overlays` at or
   *  before it — jumping to a step lands on the same value the walked
   *  path would. Before any step declares one, CIOH + change only: the
   *  sub-transaction analysis waits for the chapter that needs it. */
  private overlaysAt(index: number): number {
    for (let i = index; i >= 0; i--) {
      const o = this.steps[i]!.overlays;
      if (o !== undefined) return o;
    }
    return 3;
  }

  /** effective change/payment heuristics at a step, same walked-path
   *  rule as overlaysAt; before any step declares one, all of them */
  private changeTellsAt(index: number): number {
    for (let i = index; i >= 0; i--) {
      const t = this.steps[i]!.changeTells;
      if (t !== undefined) return t;
    }
    return 15;
  }

  /** effective staged flag (`nf`, `ns` or `mi`) at a step, same
   *  walked-path rule as overlaysAt; before any step declares one, off */
  private flagAt(index: number, key: "nf" | "ns" | "mi"): boolean {
    for (let i = index; i >= 0; i--) {
      const v = this.steps[i]![key];
      if (v !== undefined) return v;
    }
    return false;
  }

  /** effective knowledge grant at a step, same walked-path rule as
   *  overlaysAt; before any step declares one, none — the plain observer */
  private grantsAt(index: number): [number, number] {
    for (let i = index; i >= 0; i--) {
      const g = this.steps[i]!.grants;
      if (g !== undefined) return g;
    }
    return [0, 0];
  }

  hide(): void {
    this.panel.style.display = "none";
    this.cb.onStepChange?.(-1);
  }

  show(index?: number): void {
    this.go(index ?? this.index);
  }

  get currentIndex(): number {
    return this.panel.style.display === "none" ? -1 : this.index;
  }
}
