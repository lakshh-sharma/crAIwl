/**
 * Self-heal rate limiting.
 *
 * Two guard rails, independent of each other:
 *
 *  RepairBudget — a hard cap on repair LLM calls per crawl run. Stops the
 *  obvious failure mode where a per-field repair loop turns a routine job
 *  into a token-billing disaster.
 *
 *  RedesignDetector — a heuristic that flips when too high a fraction of
 *  crawled pages need repairs. Per-field thrashing on a site-wide redesign
 *  is wasted work; the right move is to recompile the templates from
 *  scratch. The detector surfaces the signal; the orchestrator decides
 *  whether to halt or just log.
 */

export class RepairBudget {
  private used = 0;

  constructor(readonly limit: number = 20) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error('RepairBudget: limit must be a non-negative integer');
    }
  }

  /** Consume one repair attempt. Returns false when the budget is exhausted. */
  tryConsume(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  get spent(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get exhausted(): boolean {
    return this.used >= this.limit;
  }
}

export type RedesignDetectorOptions = {
  /** Fraction of pages-with-failures that flips the detector. Default 0.5. */
  thresholdRatio?: number;
  /** Minimum total pages observed before the detector can trip. Default 4. */
  minPages?: number;
};

export class RedesignDetector {
  private pages = 0;
  private pagesWithFailures = 0;
  private readonly thresholdRatio: number;
  private readonly minPages: number;

  constructor(opts: RedesignDetectorOptions = {}) {
    this.thresholdRatio = opts.thresholdRatio ?? 0.5;
    this.minPages = opts.minPages ?? 4;
  }

  notePage(hadFailures: boolean): void {
    this.pages++;
    if (hadFailures) this.pagesWithFailures++;
  }

  get totalPages(): number {
    return this.pages;
  }

  get failingPages(): number {
    return this.pagesWithFailures;
  }

  get ratio(): number {
    return this.pages === 0 ? 0 : this.pagesWithFailures / this.pages;
  }

  get likelyRedesign(): boolean {
    if (this.pages < this.minPages) return false;
    return this.ratio >= this.thresholdRatio;
  }
}
