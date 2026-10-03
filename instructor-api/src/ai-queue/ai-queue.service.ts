import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { OllamaService } from '../ollama/ollama.service.js';
import { AiQueue, type AiJob } from './ai-queue.js';

// Each job holds a CPU-bound model for minutes, so an unbounded backlog would let
// one client (or a stuck loop) tie the model up indefinitely. Sized for one
// bulk upload of a class.
const MAX_QUEUED_AI_JOBS = Number(process.env.AI_MAX_QUEUED_JOBS ?? 200);

type Handler = (target: string, model: string) => Promise<void>;

/**
 * The one queue in front of the local models: script reading and marking,
 * and marking-scheme drafts and tests, all wait their turn here so the
 * server never loads two models at once.
 */
@Injectable()
export class AiQueueService {
  private readonly logger = new Logger('AiQueue');
  private readonly handlers = new Map<string, Handler>();
  private readonly queue: AiQueue;

  constructor(private readonly ollama: OllamaService) {
    this.queue = new AiQueue(
      (job) => {
        const kind = job.kind ?? job.stage;
        const handler = this.handlers.get(kind);
        if (!handler) throw new Error(`no handler registered for AI job "${kind}"`);
        return handler(job.target ?? job.id, job.model);
      },
      (previous) => this.ollama.unload(previous),
      (job, err) => this.logger.error(`AI job ${job.kind ?? job.stage} for ${job.target ?? job.id} crashed: ${String(err)}`),
    );
  }

  register(kind: string, handler: Handler) {
    this.handlers.set(kind, handler);
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
