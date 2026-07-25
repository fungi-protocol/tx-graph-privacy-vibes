// Guided tutorial: a sequence of narrated steps, each optionally moving the
// camera to look at something. Skippable at any point; the chapter select
// grows as milestones add chapters.
export interface TutorialStep {
  id: string;
  title: string;
  html: string;
  /** world rect to frame when the step becomes active (function = resolved late) */
  focus?: Rect | (() => Rect);
  /** which view this step wants: 0 = block explorer, 1 = bipartite, 2 = clusters */
  view?: 0 | 1 | 2;
  /** which lens this step wants: 0 = all-seeing, 1 = observer */
  lens?: 0 | 1;
  /** which scene this step plays in: 0 = intro story, 1 = the economy */
  scene?: 0 | 1;
  /** economy steps may require the simulation to have reached this day */
  minDay?: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface TutorialCallbacks {
  onFocus: (focus: Rect) => void;
  onStepChange?: (index: number) => void;
  onView?: (view: 0 | 1 | 2) => void;
  onLens?: (lens: 0 | 1) => void;
  /** scene change + fast-forward requirement, fired before focus */
  onScene?: (scene: 0 | 1, minDay: number) => void;
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
      if (this.index === this.steps.length - 1) this.hide();
      else this.go(this.index + 1);
    });
    this.panel.querySelector(".tut-skip")!.addEventListener("click", () => this.hide());
  }

  go(index: number, animate = true): void {
    this.index = Math.max(0, Math.min(this.steps.length - 1, index));
    const step = this.steps[this.index]!;
    this.title.textContent = step.title;
    this.progress.textContent = `${this.index + 1} / ${this.steps.length}`;
    this.body.innerHTML = step.html;
    this.prevBtn.disabled = this.index === 0;
    this.nextBtn.textContent = this.index === this.steps.length - 1 ? "done ✓" : "next →";
    if (animate && step.scene !== undefined) this.cb.onScene?.(step.scene, step.minDay ?? 0);
    if (animate && step.view !== undefined) this.cb.onView?.(step.view);
    if (animate) this.cb.onLens?.(step.lens ?? 0);
    if (animate && step.focus) {
      this.cb.onFocus(typeof step.focus === "function" ? step.focus() : step.focus);
    }
    this.cb.onStepChange?.(this.index);
    this.panel.style.display = "block";
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
