import { Module } from '@nestjs/common';
import { TheoryScriptsController } from './theory-scripts.controller.js';
import { TheoryScriptsService } from './theory-scripts.service.js';
import { OllamaModule } from '../ollama/ollama.module.js';

@Module({
  imports: [OllamaModule],
  controllers: [TheoryScriptsController],
  providers: [TheoryScriptsService],
})
export class TheoryScriptsModule {}
