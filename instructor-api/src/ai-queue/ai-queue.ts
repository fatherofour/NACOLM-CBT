export type Stage = 'ocr' | 'mark';

export interface AiJob {
  /** Dedupe key: a new job with the same id replaces the waiting one. */
  id: string;
  stage: Stage;
  model: string;
  /** Which registered handler runs it (see AiQueueService); defaults by stage. */
  kind?: string;
  /** The record the handler works on, when it differs from the dedupe id. */
  target?: string;
}

export interface QueueStatus {
  running: { id: string; stage: Stage; model: string; startedAt: string } | null;
  waiting: { ocr: number; mark: number };
  etaSeconds: number;
}

// First-run guesses from the server benchmark (4 CPU cores): about 2.5 min to
// read a page and 40s to mark. Replaced by measured averages as jobs finish.
const DEFAULT_SECONDS: Record<Stage, number> = { ocr: 150, mark: 40 };

/**
 * One-at-a-time scheduler for the CPU-bound local models, batched by stage.
 *
 * Loading a model costs 20-60s and the server cannot hold the vision model
 * and the marker at once, so instead of OCR→mark→OCR→mark per script (a
 * model swap every job), it reads every waiting script first and then marks
 * them all. After `batchMax` jobs in a row it lets the other stage have a
 * turn so a long bulk upload can't starve marking of earlier scripts.
 */
export class AiQueue {
  private readonly lists: Record<Stage, AiJob[]> = { ocr: [], mark: [] };
  private running: (AiJob & { startedAt: number }) | null = null;
  private lastStage: Stage | null = null;
  private lastModel: string | null = null;
  private streak = 0;
  private readonly avgSeconds: Record<Stage, number> = { ...DEFAULT_SECONDS };

  constructor(
    private readonly run: (job: AiJob) => Promise<void>,
    private readonly onModelSwitch: (previousModel: string) => Promise<void>,
    private readonly onError: (job: AiJob, err: unknown) => void,
    private readonly batchMax = 25,
  ) {}

  /** Adds a job; a job already waiting for the same script is replaced. */
  add(job: AiJob) {
    this.remove(job.id);
    this.lists[job.stage].push(job);
    void this.pump();
  }

  remove(id: string) {
    for (const stage of ['ocr', 'mark'] as const) {
      this.lists[stage] = this.lists[stage].filter((j) => j.id !== id);
    }
  }

  size() {
    return this.lists.ocr.length + this.lists.mark.length + (this.running ? 1 : 0);
  }

  status(now = Date.now()): QueueStatus {
    const r = this.running;
    const runningLeft = r ? Math.max(0, this.avgSeconds[r.stage] - (now - r.startedAt) / 1000) : 0;
    return {
      running: r ? { id: r.id, stage: r.stage, model: r.model, startedAt: new Date(r.startedAt).toISOString() } : null,
      waiting: { ocr: this.lists.ocr.length, mark: this.lists.mark.length },
      etaSeconds: Math.round(
        runningLeft + this.lists.ocr.length * this.avgSeconds.ocr + this.lists.mark.length * this.avgSeconds.mark,
      ),
    };
  }

  /** Exposed for tests: which job would run next. */
  peek(): AiJob | undefined {
    const stage = this.nextStage();
    if (!stage) return undefined;
    const list = this.lists[stage];
    return list.find((j) => j.model === this.lastModel) ?? list[0];
  }

  private nextStage(): Stage | null {
    const { ocr, mark } = this.lists;
    if (!ocr.length && !mark.length) return null;
    const cur = this.lastStage ?? (ocr.length ? 'ocr' : 'mark');
    const other: Stage = cur === 'ocr' ? 'mark' : 'ocr';
    const stayWouldStarve = this.streak >= this.batchMax && this.lists[other].length > 0;
    if (this.lists[cur].length && !stayWouldStarve) return cur;
    return this.lists[other].length ? other : cur;
  }

  private take(): AiJob | undefined {
    const job = this.peek();
    if (job) this.lists[job.stage] = this.lists[job.stage].filter((j) => j !== job);
    return job;
  }

  private pumping = false;

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      await this.drain();
    } finally {
      this.pumping = false;
    }
  }

  private async drain() {
    for (let job = this.take(); job; job = this.take()) {
      if (this.lastModel && this.lastModel !== job.model) {
        await this.onModelSwitch(this.lastModel).catch(() => undefined);
      }
      this.streak = job.stage === this.lastStage ? this.streak + 1 : 1;
      this.lastStage = job.stage;
      this.lastModel = job.model;
      const startedAt = Date.now();
      this.running = { ...job, startedAt };
      try {
        await this.run(job);
      } catch (err) {
        this.onError(job, err);
      } finally {
        const took = (Date.now() - startedAt) / 1000;
        this.avgSeconds[job.stage] = Math.round(this.avgSeconds[job.stage] * 0.7 + took * 0.3);
        this.running = null;
      }
    }
  }
}
