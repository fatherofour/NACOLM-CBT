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
    if (!/\.(pdf|docx)$/i.test(file.originalname)) {
      throw new BadRequestException('Only PDF and DOCX files can be uploaded.');
    }
    if (!sessionId || !docType || !title) throw new BadRequestException('sessionId, docType and title are required');
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
}
