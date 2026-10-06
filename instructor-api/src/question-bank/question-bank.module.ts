import { Module } from '@nestjs/common';
import { QuestionBankController } from './question-bank.controller.js';
import { QuestionBankService } from './question-bank.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { OllamaModule } from '../ollama/ollama.module.js';
import { QuestionGenerationService } from './question-generation.service.js';

@Module({
  imports: [AuditModule, OllamaModule],
  controllers: [QuestionBankController],
  providers: [QuestionBankService, QuestionGenerationService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
