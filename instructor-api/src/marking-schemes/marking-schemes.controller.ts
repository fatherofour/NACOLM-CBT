import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { MarkingSchemesService } from './marking-schemes.service.js';
import { SaveMarkingSchemeDto } from './dto/save-marking-scheme.dto.js';
import { TestSchemeDto } from './dto/test-scheme.dto.js';
import { CurrentUser, actorName, type SessionUser } from '../auth/decorators.js';

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
}
