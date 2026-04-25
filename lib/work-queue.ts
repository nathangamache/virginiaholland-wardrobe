/**
 * A minimal concurrency-limited promise pool.
 *
 * Used so bulk uploads can process N items in parallel rather than
 * sequentially, without running 50 simultaneous bg-removal jobs that
 * would thrash the CPU.
 */

export class Pool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new Error('concurrency must be >= 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get active() {
    return this.running;
  }

  get waiting() {
    return this.queue.length;
  }
}

/**
 * Concurrency tuning for the Xeon E5-2687W v2 (8 cores / 16 threads).
 *
 * NOTE: Background removal manages its OWN concurrency internally via a
 * session pool (see lib/bg-removal-server.ts). The bgRemovalPool here is
 * kept for backward compatibility and any non-bg-removal CPU-bound tasks
 * that want a similar limit.
 *
 * If you increase the bg-removal session pool size (BG_REMOVAL_SESSION_POOL),
 * you don't need to change this value — they're independent.
 */
export const bgRemovalPool = new Pool(
  parseInt(process.env.BG_REMOVAL_CONCURRENCY ?? '6', 10)
);

/**
 * Image processing pool — sharp ops are cheap (50-200ms each) so we can
 * run many in parallel without much CPU contention.
 */
export const imageProcessingPool = new Pool(
  parseInt(process.env.IMAGE_PROCESSING_CONCURRENCY ?? '12', 10)
);
