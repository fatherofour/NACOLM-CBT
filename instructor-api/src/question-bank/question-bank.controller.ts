import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { QuestionBankService } from './question-bank.service.js';
import { CreateBankItemDto } from './dto/create-bank-item.dto.js';
import { EditQuestionDto } from './dto/edit-question.dto.js';
import { RejectQuestionDto } from './dto/reject-question.dto.js';
import type { QuestionStatus, QuestionType } from '../generated/prisma/enums.js';

@Controller('question-bank')
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

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
  edit(@Param('id') id: string, @Body() dto: EditQuestionDto) {
    return this.bank.edit(id, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.bank.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectQuestionDto) {
    return this.bank.reject(id, dto.reason);
  }

  @Get(':id/audit-log')
  auditLog(@Param('id') id: string) {
    return this.bank.auditLog(id);
  }
}
