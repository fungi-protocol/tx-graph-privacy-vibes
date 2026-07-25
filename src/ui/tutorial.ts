// Guided tutorial: a sequence of narrated steps, each optionally moving the
// camera to look at something. Skippable at any point; the chapter select
// grows as milestones add chapters.
export interface TutorialStep {
  id: string;
  title: string;
  html: string;
  /** world rect to frame when the step becomes active */
  focus?: { x: number; y: number; w: number; h: number };
  /** which view this step wants: 0 = block explorer, 1 = bipartite */
  view?: 0 | 1;
}

export interface TutorialCallbacks {
  onFocus: (focus: NonNullable<TutorialStep["focus"]>) => void;
  onStepChange?: (index: number) => void;
  onView?: (view: 0 | 1) => void;
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
    if (animate && step.view !== undefined) this.cb.onView?.(step.view);
    if (animate && step.focus) this.cb.onFocus(step.focus);
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
