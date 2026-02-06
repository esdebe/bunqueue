/**
 * Throughput Tracker
 * Tracks per-second throughput rates using exponential moving average (EMA)
 * O(1) per observation, no allocations
 */

/** EMA-based rate tracker */
class RateTracker {
  private count = 0;
  private lastRate = 0;
  private lastCalcTime = Date.now();
  /** EMA smoothing factor (0-1). Lower = smoother. 0.3 gives ~3 sample memory */
  private readonly alpha: number;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
  }

  /** Record one event */
  increment(n = 1): void {
    this.count += n;
  }

  /** Calculate current rate (calls per second) */
  getRate(): number {
    const now = Date.now();
    const elapsed = (now - this.lastCalcTime) / 1000;

    if (elapsed < 0.1) return this.lastRate; // Avoid division by tiny numbers

    const currentRate = this.count / elapsed;
    this.lastRate =
      this.lastRate === 0
        ? currentRate
        : this.alpha * currentRate + (1 - this.alpha) * this.lastRate;

    this.count = 0;
    this.lastCalcTime = now;

    return this.lastRate;
  }
}

export class ThroughputTracker {
  readonly pushRate = new RateTracker();
  readonly pullRate = new RateTracker();
  readonly completeRate = new RateTracker();
  readonly failRate = new RateTracker();

  /** Get all rates (per second) */
  getRates(): {
    pushPerSec: number;
    pullPerSec: number;
    completePerSec: number;
    failPerSec: number;
  } {
    return {
      pushPerSec: Math.round(this.pushRate.getRate() * 100) / 100,
      pullPerSec: Math.round(this.pullRate.getRate() * 100) / 100,
      completePerSec: Math.round(this.completeRate.getRate() * 100) / 100,
      failPerSec: Math.round(this.failRate.getRate() * 100) / 100,
    };
  }
}

/** Global singleton */
export const throughputTracker = new ThroughputTracker();
