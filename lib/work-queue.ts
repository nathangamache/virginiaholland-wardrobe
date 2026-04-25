/**
 * A minimal concurrency-limited promise pool.
 *
 * Used so bulk uploads can process N items in parallel rather than
 * sequentially, without running 50 simultaneous bg-removal jobs that
 * would thrash the CPU.
 *
 * Usage:
 *   const pool = new Pool(4); // 4 concurrent jobs
 *   const results = await Promise.all(
 *     items.map(item => pool.run(() => processItem(item)))
 *   );
 */

export class Pool {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly concurrency: number) {
    if (concurrency < 1) throw new Error('concurrency must be >= 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a slot to open up
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
 * Shared pool for background-removal jobs. Default concurrency is tuned for
 * an 8-core server; override with BG_REMOVAL_CONCURRENCY env var.
 *
 * ONNX Runtime itself is single-threaded per InferenceSession by default,
 * so we can safely run several sessions in parallel on separate CPU cores.
 */
export const bgRemovalPool = new Pool(
  parseInt(process.env.BG_REMOVAL_CONCURRENCY ?? '4', 10)
);

/**
 * Pool for lighter image processing (thumbnails, normalization) — can run
 * more in parallel since each operation is cheap.
 */
export const imageProcessingPool = new Pool(
  parseInt(process.env.IMAGE_PROCESSING_CONCURRENCY ?? '8', 10)
);
