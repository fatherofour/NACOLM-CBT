import { Global, Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module.js';
import { AiQueueService } from './ai-queue.service.js';
import { AiQueueController } from './ai-queue.controller.js';

@Global()
@Module({
  imports: [OllamaModule],
  controllers: [AiQueueController],
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
