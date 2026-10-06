import { Roles } from '../auth/decorators.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service.js';
import type { DocumentType } from '../generated/prisma/enums.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024, files: 1 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('sessionId') sessionId: string,
    @Body('docType') docType: DocumentType,
    @Body('title') title: string,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!sessionId || !docType || !title) throw new BadRequestException('sessionId, docType and title are required');
    // Photos of handwritten past papers are read by the AI; study material must be a document.
    const allowed = docType === 'PAST_PAPER' ? /\.(pdf|docx|jpe?g|png)$/i : /\.(pdf|docx)$/i;
    if (!allowed.test(file.originalname)) {
      throw new BadRequestException(docType === 'PAST_PAPER' ? 'Upload a PDF, Word file, or a JPEG/PNG photo of the paper.' : 'Only PDF and DOCX files can be uploaded.');
    }
    return this.documents.upload(sessionId, docType, title, file);
  }

  @Get()
  list(
    @Query('sessionId') sessionId?: string,
    @Query('courseId') courseId?: string,
    @Query('docType') docType?: DocumentType,
  ) {
    if (!sessionId && !courseId) throw new BadRequestException('sessionId or courseId is required');
    return this.documents.list({ sessionId, courseId, docType });
  }

  @Get('destination')
  async destination(@Query('sessionId') sessionId: string, @Query('docType') docType: DocumentType) {
    if (!sessionId || !docType) throw new BadRequestException('sessionId and docType are required');
    return { path: await this.documents.destination(sessionId, docType) };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documents.delete(id);
  }

  // Upload already runs this automatically for a past paper — this is for
  // re-running it by hand (e.g. after the automatic pass failed, or to redo
  // it having deleted the draft items it made the first time).
  @Post(':id/extract-questions')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  extractQuestions(@Param('id') id: string) {
    return this.documents.extractPastPaperQuestions(id);
  }
}
