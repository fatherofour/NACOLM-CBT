import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller.js';
import { QuestionBankService } from './question-bank.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [QuestionBankController],
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
