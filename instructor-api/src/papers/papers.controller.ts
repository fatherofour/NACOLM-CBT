import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PapersService } from './papers.service.js';
import { FreezePaperDto } from './dto/freeze-paper.dto.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  // Only the exam officer freezes (spec: "performs the final freeze"). The
  // name on the frozen version comes from the session, not the request body.
  @Post('freeze')
  @Roles('EXAM_OFFICER')
  freeze(@Body() dto: FreezePaperDto, @CurrentUser() user: SessionUser) {
    return this.papers.freeze({ ...dto, frozenBy: actorName(user) });
  }

  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.papers.listVersions(sessionId);
  }
}
