import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { AiGenerationModule } from '../ai-generation/ai-generation.module.js';

@Module({
  // FileInterceptor defaults to Multer's in-memory storage (file.buffer),
  // which is what DocumentsService writes to disk itself — no MulterModule
  // registration needed for that default.
  imports: [AiGenerationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
