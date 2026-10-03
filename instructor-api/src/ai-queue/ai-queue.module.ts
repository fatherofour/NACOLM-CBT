import { Global, Module } from '@nestjs/common';
import { OllamaModule } from '../ollama/ollama.module.js';
import { AiQueueService } from './ai-queue.service.js';

@Global()
@Module({
  imports: [OllamaModule],
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
