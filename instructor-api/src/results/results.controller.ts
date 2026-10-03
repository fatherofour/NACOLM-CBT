import { BadRequestException, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ResultsService } from './results.service.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  summary(@Query('paperVersionId') paperVersionId: string) {
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    return this.results.summary(paperVersionId);
  }

  // Bringing a venue's results into the record is the exam officer's or an admin's job.
  @Post('import')
  @Roles('EXAM_OFFICER', 'ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  import(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: SessionUser) {
    if (!file) throw new BadRequestException('attach the results file from the exam server');
    return this.results.importFile(file.buffer.toString('utf8'), actorName(user));
  }
}
