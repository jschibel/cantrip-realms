// The iris (tech.md B5, "Interiors"): a black screen closing to a point round the player, and opening again on the
// other side of a door or a stair - never a loading screen; what is behind it is built while it is shut, which is a
// moment, since the next rooms near the player are built ahead.

export class Iris {
  private readonly veil: HTMLElement;
  private radius = 2;

  constructor() {
    this.veil = document.createElement("div");
    this.veil.className = "iris";
    this.veil.dataset.test = "iris";
    this.veil.hidden = true;
    document.body.appendChild(this.veil);
  }

  /** Whether it is shut, or closing or opening. */
  get busy(): boolean {
    return !this.veil.hidden;
  }

  private draw(x: number, y: number): void {
    const r = Math.max(0, this.radius) * Math.hypot(window.innerWidth, window.innerHeight);
    const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + 1}px)`;
    this.veil.style.maskImage = mask;
    this.veil.style.webkitMaskImage = mask;
  }

  private animate(from: number, to: number, ms: number, at: () => { x: number; y: number }): Promise<void> {
    this.veil.hidden = false;
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = t * t * (3 - 2 * t);
        this.radius = from + (to - from) * eased;
        const p = at();
        this.draw(p.x, p.y);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Closes on a point of the page (followed as it moves). */
  close(ms: number, at: () => { x: number; y: number }): Promise<void> {
    return this.animate(0.75, 0, ms, at);
  }

  /** Opens from a point of the page, and is gone. */
  async open(ms: number, at: () => { x: number; y: number }): Promise<void> {
    await this.animate(0, 0.75, ms, at);
    this.veil.hidden = true;
  }
}
