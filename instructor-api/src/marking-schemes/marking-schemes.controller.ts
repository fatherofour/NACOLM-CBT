import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { MarkingSchemesService } from './marking-schemes.service.js';
import { SaveMarkingSchemeDto } from './dto/save-marking-scheme.dto.js';
import { TestSchemeDto } from './dto/test-scheme.dto.js';
import { DraftSchemeDto } from './dto/draft-scheme.dto.js';
import { AddVariationDto } from './dto/add-variation.dto.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('question-bank/:questionId/marking-scheme')
export class MarkingSchemesController {
  constructor(private readonly schemes: MarkingSchemesService) {}

  @Get()
  get(@Param('questionId') questionId: string) {
    return this.schemes.get(questionId);
  }

  @Get('suggest')
  suggest(@Param('questionId') questionId: string) {
    return this.schemes.suggest(questionId);
  }

  @Put()
  save(@Param('questionId') questionId: string, @Body() dto: SaveMarkingSchemeDto, @CurrentUser() user: SessionUser) {
    return this.schemes.save(questionId, dto, actorName(user));
  }

  @Post('test')
  test(@Param('questionId') questionId: string, @Body() dto: TestSchemeDto) {
    // If the caller supplies a scheme inline (the builder's live test box,
    // which must work before the scheme is saved), score against that;
    // otherwise fall back to the persisted scheme.
    if (dto.scheme) return this.schemes.testInline(dto.answer, dto.scheme);
    return this.schemes.testSaved(questionId, dto.answer);
  }

  // These run the local models, so they are limited to staff roles explicitly.
  @Post('ai-draft')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  draft(@Param('questionId') questionId: string, @Body() dto: DraftSchemeDto, @CurrentUser() user: SessionUser) {
    return this.schemes.draftWithAi(questionId, dto, actorName(user));
  }

  @Post('ai-test')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  aiTest(@Param('questionId') questionId: string) {
    return this.schemes.testWithAi(questionId);
  }

  @Post('approve')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  approve(@Param('questionId') questionId: string, @CurrentUser() user: SessionUser) {
    return this.schemes.approve(questionId, actorName(user));
  }

  @Post('variations')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  addVariation(@Param('questionId') questionId: string, @Body() dto: AddVariationDto, @CurrentUser() user: SessionUser) {
    return this.schemes.addVariation(questionId, dto, actorName(user));
  }
}
