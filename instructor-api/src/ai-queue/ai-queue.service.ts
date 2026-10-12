import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../ollama/ollama.service.js';
import { AiQueue, type AiJob } from './ai-queue.js';

// Each job holds a CPU-bound model for minutes, so an unbounded backlog would let
// one client (or a stuck loop) tie the model up indefinitely. Sized for one
// bulk upload of a class.
const MAX_QUEUED_AI_JOBS = Number(process.env.AI_MAX_QUEUED_JOBS ?? 200);

type Handler = (target: string, model: string) => Promise<void>;
/** Puts the record a cancelled job was working on into a clear "cancelled" state, so it can be retried. */
type OnCancel = (target: string, by: string) => Promise<unknown>;

/**
 * The one queue in front of the local models: script reading and marking,
 * and marking-scheme drafts and tests, all wait their turn here so the
 * server never loads two models at once.
 */
@Injectable()
export class AiQueueService {
  private readonly logger = new Logger('AiQueue');
  private readonly handlers = new Map<string, Handler>();
  private readonly onCancel = new Map<string, OnCancel>();
  // Who cancelled a running job, until its handler has wound down.
  private readonly cancelledBy = new Map<string, string>();
  private readonly queue: AiQueue;

  constructor(private readonly ollama: OllamaService) {
    this.queue = new AiQueue(
      async (job, signal) => {
        const kind = job.kind ?? job.stage;
        const handler = this.handlers.get(kind);
        if (!handler) throw new Error(`no handler registered for AI job "${kind}"`);
        try {
          await this.ollama.withSignal(signal, () => handler(job.target ?? job.id, job.model));
        } finally {
          // The handler may have recorded the abort as a failure; mark it cancelled instead.
          if (signal.aborted) await this.markCancelled(job, this.cancelledBy.get(job.id) ?? 'an instructor');
        }
      },
      (previous) => this.ollama.unload(previous),
      (job, err) => this.logger.error(`AI job ${job.kind ?? job.stage} for ${job.target ?? job.id} crashed: ${String(err)}`),
    );
  }

  register(kind: string, handler: Handler, onCancel?: OnCancel) {
    this.handlers.set(kind, handler);
    if (onCancel) this.onCancel.set(kind, onCancel);
  }

  private async markCancelled(job: AiJob, by: string) {
    this.cancelledBy.delete(job.id);
    const kind = job.kind ?? job.stage;
    const target = job.target ?? job.id;
    await this.onCancel.get(kind)?.(target, by).catch((err) => this.logger.error(`couldn't mark ${kind} ${target} cancelled: ${String(err)}`));
  }

  /** Cancels one job, waiting or running. `by` is recorded on the cancelled item. */
  async cancel(id: string, by: string) {
    this.cancelledBy.set(id, by);
    const { dropped, stopped } = this.queue.cancel(id);
    if (!stopped) this.cancelledBy.delete(id);
    for (const job of dropped) await this.markCancelled(job, by);
    const cancelled = dropped.length + (stopped ? 1 : 0);
    if (cancelled) this.logger.log(`${by} cancelled AI job ${id}`);
    return { cancelled };
  }

  /** Stops all AI work: the running job and everything waiting. */
  async cancelAll(by: string) {
    const running = this.queue.status().running;
    if (running) this.cancelledBy.set(running.id, by);
    const { dropped, stopped } = this.queue.cancelAll();
    for (const job of dropped) await this.markCancelled(job, by);
    const cancelled = dropped.length + (stopped ? 1 : 0);
    this.logger.log(`${by} stopped all AI work (${cancelled} job${cancelled === 1 ? '' : 's'})`);
    return { cancelled };
  }

  add(job: AiJob) {
    this.queue.add(job);
  }

  assertRoom(jobs = 1) {
    if (this.queue.size() + jobs > MAX_QUEUED_AI_JOBS) {
      throw new HttpException(
        `The AI is busy (${this.queue.size()} jobs waiting). Wait for some to finish, then try again.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  size() {
    return this.queue.size();
  }

  status() {
    return this.queue.status();
  }
}
