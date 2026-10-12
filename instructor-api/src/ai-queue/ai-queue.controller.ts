import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { AiQueueService } from './ai-queue.service.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

/** What the local AI is doing, and the stop button for it. */
@Controller('ai-queue')
export class AiQueueController {
  constructor(private readonly queue: AiQueueService) {}

  @Get()
  status() {
    return this.queue.status();
  }

  /** Cancels one job, e.g. "scheme:<id>", "paper:<id>", "generate:<sessionId>" or a script answer's id. */
  @Post('cancel')
  cancel(@Body() body: { id?: unknown }, @CurrentUser() user: SessionUser) {
    if (typeof body?.id !== 'string' || !body.id.trim()) throw new BadRequestException('id is required');
    return this.queue.cancel(body.id, actorName(user));
  }

  /** Stops everything the AI is doing or waiting to do. */
  @Post('cancel-all')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  cancelAll(@CurrentUser() user: SessionUser) {
    return this.queue.cancelAll(actorName(user));
  }
}
