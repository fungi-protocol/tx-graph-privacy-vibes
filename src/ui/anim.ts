// Tiny tween engine driving all transitions (camera moves, morphs, pings).
// Everything animates so the user can track what changed.

export type Ease = (t: number) => number;
export const easeInOutCubic: Ease = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t);

interface Tween {
  start: number;
  duration: number;
  ease: Ease;
  update: (t: number) => void;   // t in [0, 1] after easing
  done?: () => void;
}

export class Animator {
  private tweens = new Set<Tween>();

  add(duration: number, update: (t: number) => void, opts: { ease?: Ease; done?: () => void } = {}): void {
    this.tweens.add({ start: performance.now(), duration, update, ease: opts.ease ?? easeInOutCubic, done: opts.done });
  }

  /** Advance all tweens; returns true while anything is still animating. */
  tick(now: number): boolean {
    for (const tw of this.tweens) {
      const raw = Math.min(1, (now - tw.start) / tw.duration);
      tw.update(tw.ease(raw));
      if (raw >= 1) {
        this.tweens.delete(tw);
        tw.done?.();
      }
    }
    return this.tweens.size > 0;
  }

  get active(): boolean {
    return this.tweens.size > 0;
  }
}
