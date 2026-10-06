import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { QuestionBankService } from './question-bank.service.js';
import { CreateBankItemDto } from './dto/create-bank-item.dto.js';
import { EditQuestionDto } from './dto/edit-question.dto.js';
import { RejectQuestionDto } from './dto/reject-question.dto.js';
import type { QuestionStatus, QuestionType } from '../generated/prisma/enums.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';
import { QuestionGenerationService } from './question-generation.service.js';
import { GenerateSimilarDto } from './dto/generate-similar.dto.js';

@Controller('question-bank')
export class QuestionBankController {
  constructor(
    private readonly bank: QuestionBankService,
    private readonly generator: QuestionGenerationService,
  ) {}

  // Runs the local models, so staff roles only.
  @Post('generate-similar')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  generateSimilar(@Body() dto: GenerateSimilarDto) {
    return this.generator.start(dto);
  }

  @Get('generate-similar/status')
  generationStatus(@Query('sessionId') sessionId: string) {
    return this.generator.status(sessionId) ?? { state: 'idle' };
  }

  @Get()
  list(
    @Query('sessionId') sessionId: string,
    @Query('status') status?: QuestionStatus,
    @Query('type') type?: QuestionType,
    @Query('topic') topic?: string,
  ) {
    return this.bank.list(sessionId, { status, type, topic });
  }

  @Get('review-progress')
  reviewProgress(@Query('sessionId') sessionId: string) {
    return this.bank.reviewProgress(sessionId);
  }

  @Post()
  create(@Body() dto: CreateBankItemDto) {
    return this.bank.create(dto);
  }

  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: EditQuestionDto, @CurrentUser() user: SessionUser) {
    return this.bank.edit(id, dto, actorName(user));
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.bank.approve(id, actorName(user));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectQuestionDto, @CurrentUser() user: SessionUser) {
    return this.bank.reject(id, dto.reason, actorName(user));
  }

  @Get(':id/audit-log')
  auditLog(@Param('id') id: string) {
    return this.bank.auditLog(id);
  }
}
