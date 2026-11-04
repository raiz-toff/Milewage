export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number,
  ) {}

  private live(key: string): number[] {
    const hits = (this.hits.get(key) ?? []).filter((t) => t > this.now() - this.windowMs);
    this.hits.set(key, hits);
    return hits;
  }

  retryAfter(key: string): number {
    const hits = this.live(key);
    const first = hits[0];
    if (hits.length < this.limit || first === undefined) return 0;
    return Math.ceil((first + this.windowMs - this.now()) / 1000);
  }

  fail = (key: string) => void this.live(key).push(this.now());
  reset = (key: string) => void this.hits.delete(key);
}
