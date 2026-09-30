import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { readFile } from 'node:fs/promises';
import { TheoryScriptsService } from './theory-scripts.service.js';
import { ReviewScriptAnswerDto } from './dto/review-script-answer.dto.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';
import type { ScriptAnswerStatus } from '../generated/prisma/enums.js';

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

  @Get()
  list(
    @Query('paperVersionId') paperVersionId?: string,
    @Query('candidateId') candidateId?: string,
    @Query('status') status?: ScriptAnswerStatus,
  ) {
    if (!paperVersionId && !candidateId) throw new BadRequestException('paperVersionId or candidateId is required');
    return this.scripts.list({ paperVersionId, candidateId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.scripts.get(id);
  }

  // So a reviewer can see the actual scan next to the transcription/score,
  // not just trust the OCR blindly.
  @Get(':id/image')
  async image(@Param('id') id: string): Promise<StreamableFile> {
    const answer = await this.scripts.get(id);
    const type = /\.png$/i.test(answer.imagePath) ? 'image/png' : 'image/jpeg';
    return new StreamableFile(await readFile(answer.imagePath), { type });
  }

  @Post(':id/ocr')
  retryOcr(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    this.logger.log(`AI pipeline: OCR re-run on ${id} by ${actorName(user)}`);
    return this.scripts.restart(id, 'ocr');
  }

  @Post(':id/mark')
  retryMarking(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    this.logger.log(`AI pipeline: marking re-run on ${id} by ${actorName(user)}`);
    return this.scripts.restart(id, 'mark');
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewScriptAnswerDto, @CurrentUser() user: SessionUser) {
    return this.scripts.review(id, dto, actorName(user));
  }

  @Post('publish')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  publish(@Query('paperVersionId') paperVersionId: string) {
    if (!paperVersionId) throw new BadRequestException('paperVersionId is required');
    return this.scripts.publish(paperVersionId);
  }
}
