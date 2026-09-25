import { Module } from '@nestjs/common';
import { BlueprintsController } from './blueprints.controller.js';
import { BlueprintsService } from './blueprints.service.js';
import { AiGenerationModule } from '../ai-generation/ai-generation.module.js';

@Module({
  imports: [AiGenerationModule],
  controllers: [BlueprintsController],
  providers: [BlueprintsService],
})
export class BlueprintsModule {}
