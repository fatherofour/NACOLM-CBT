import { Module } from '@nestjs/common';
import { AiGenerationService } from './ai-generation.service.js';

@Module({
  providers: [AiGenerationService],
  exports: [AiGenerationService],
})
export class AiGenerationModule {}
