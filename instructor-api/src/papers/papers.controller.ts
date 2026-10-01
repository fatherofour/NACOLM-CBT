import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PapersService } from './papers.service.js';
import { PublishPaperDto } from './dto/publish-paper.dto.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  // The exam officer or an admin publishes (spec: "performs the final
  // freeze"). The name on the published version comes from the session, not
  // the request body, so the record shows who signed it off.
  @Post('publish')
  @Roles('EXAM_OFFICER', 'ADMIN')
  publish(@Body() dto: PublishPaperDto, @CurrentUser() user: SessionUser) {
    return this.papers.publish({ ...dto, publishedBy: actorName(user) });
  }

  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.papers.listVersions(sessionId);
  }
}
