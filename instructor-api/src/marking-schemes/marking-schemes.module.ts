import { Module } from '@nestjs/common';
import { MarkingSchemesController } from './marking-schemes.controller.js';
import { MarkingSchemesService } from './marking-schemes.service.js';
import { OllamaModule } from '../ollama/ollama.module.js';

@Module({
  imports: [OllamaModule],
  controllers: [MarkingSchemesController],
  providers: [MarkingSchemesService],
})
export class MarkingSchemesModule {}
