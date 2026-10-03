import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { TheoryScriptsService } from './theory-scripts.service.js';
import { ReviewScriptAnswerDto } from './dto/review-script-answer.dto.js';
import { AssignScanDto } from './dto/assign-scan.dto.js';
import { CorrectMarkDto } from './dto/correct-mark.dto.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';
import type { ScriptAnswerStatus } from '../generated/prisma/enums.js';

const imageType = (path: string) => (/\.png$/i.test(path) ? 'image/png' : 'image/jpeg');

// This controller drives the local AI models, so it is limited to staff roles
// explicitly rather than "any signed-in user": a role added later gets no AI
// access until someone decides it should.
@Controller('theory-scripts')
@Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
export class TheoryScriptsController {
  private readonly logger = new Logger(TheoryScriptsController.name);

  constructor(private readonly scripts: TheoryScriptsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('paperVersionId') paperVersionId: string,
    @Body('candidateId') candidateId: string,
    @Body('questionId') questionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!file) throw new BadRequestException('file is required');
    if (!/\.(jpe?g|png)$/i.test(file.originalname)) {
      throw new BadRequestException('Only JPEG or PNG scans can be uploaded.');
    }
    if (!paperVersionId || !candidateId || !questionId) {
      throw new BadRequestException('paperVersionId, candidateId and questionId are required');
    }
    this.logger.log(`AI pipeline: scan uploaded by ${actorName(user)} for candidate ${candidateId}, question ${questionId}`);
    return this.scripts.upload({ paperVersionId, candidateId, questionId, uploadedBy: actorName(user), file });
  }

  @Post('bulk')
  @UseInterceptors(FilesInterceptor('files', 150, { limits: { fileSize: 20 * 1024 * 1024, files: 150 } }))
  async bulk(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('paperVersionId') paperVersionId: string,
    @Body('batchId') batchId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    if (batchId && !/^[A-Za-z0-9-]{8,64}$/.test(batchId)) throw new BadRequestException('invalid batchId');
    if (!files?.length) throw new BadRequestException('attach at least one scanned page');
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    this.logger.log(`AI pipeline: bulk upload of ${files.length} page(s) by ${actorName(user)} for paper version ${paperVersionId}`);
    return this.scripts.bulkUpload({ paperVersionId, uploadedBy: actorName(user), files, batchId });
  }

  @Get()
  list(
    @Query('paperVersionId') paperVersionId?: string,
    @Query('candidateId') candidateId?: string,
    @Query('status') status?: ScriptAnswerStatus,
  ) {
    if (!paperVersionId && !candidateId) throw new BadRequestException('paperVersionId or candidateId is required');
    return this.scripts.list({ paperVersionId, candidateId, status });
  }

  @Get('queue')
  queue() {
    return this.scripts.queueStatus();
  }

  @Get('agreement')
  agreement(@Query('paperVersionId') paperVersionId?: string) {
    return this.scripts.agreement(paperVersionId);
  }

  @Get('answer-sheets')
  answerSheets(@Query('paperVersionId') paperVersionId: string, @Query('pages') pages?: string) {
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    return this.scripts.answerSheets(paperVersionId, Number(pages ?? 2));
  }

  @Get('unassigned')
  unassigned(@Query('paperVersionId') paperVersionId: string) {
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    return this.scripts.listUnassigned(paperVersionId);
  }

  @Get('unassigned/:id/image')
  async unassignedImage(@Param('id') id: string): Promise<StreamableFile> {
    const scan = await this.scripts.getUnassigned(id);
    return new StreamableFile(await readFile(scan.imagePath), { type: imageType(scan.imagePath) });
  }

  @Post('unassigned/:id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignScanDto, @CurrentUser() user: SessionUser) {
    this.logger.log(`AI pipeline: unassigned scan ${id} filed by ${actorName(user)}`);
    return this.scripts.assignScan(id, dto, actorName(user));
  }

  @Delete('unassigned/:id')
  discard(@Param('id') id: string) {
    return this.scripts.discardUnassigned(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.scripts.get(id);
  }

  // So a reviewer can see the actual scan next to the transcription/score,
  // not just trust the OCR blindly. `page` is 1-based.
  @Get(':id/image')
  async image(@Param('id') id: string, @Query('page') page?: string): Promise<StreamableFile> {
    const pages = this.scripts.pagePaths(await this.scripts.get(id));
    const path = pages[Math.max(0, Math.min(pages.length - 1, Number(page ?? 1) - 1 || 0))];
    return new StreamableFile(await readFile(path), { type: imageType(path) });
  }

  @Post(':id/ocr')
  retryOcr(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    this.logger.log(`AI pipeline: OCR re-run on ${id} by ${actorName(user)}`);
    return this.scripts.restart(id, 'ocr');
  }

  @Post(':id/mark')
  retryMarking(@Param('id') id: string, @Body('deep') deep: unknown, @CurrentUser() user: SessionUser) {
    const second = deep === true;
    this.logger.log(`AI pipeline: ${second ? 'second-opinion ' : ''}marking re-run on ${id} by ${actorName(user)}`);
    return this.scripts.restart(id, 'mark', second);
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewScriptAnswerDto, @CurrentUser() user: SessionUser) {
    return this.scripts.review(id, dto, actorName(user));
  }

  @Post('publish')
  publish(@Query('paperVersionId') paperVersionId: string, @CurrentUser() user: SessionUser) {
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    return this.scripts.publish(paperVersionId, actorName(user));
  }

  @Get(':id/events')
  events(@Param('id') id: string) {
    return this.scripts.events(id);
  }

  // Correcting a published mark is the exam officer's or an admin's call, and always needs a reason.
  @Post(':id/correct')
  @Roles('EXAM_OFFICER', 'ADMIN')
  correct(@Param('id') id: string, @Body() dto: CorrectMarkDto, @CurrentUser() user: SessionUser) {
    return this.scripts.correct(id, dto, actorName(user));
  }
}
