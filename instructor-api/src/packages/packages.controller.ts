import { Controller, Get, Param, Post } from '@nestjs/common';
import { PackagesService } from './packages.service.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get(':paperVersionId')
  get(@Param('paperVersionId') paperVersionId: string) {
    return this.packages.get(paperVersionId);
  }

  // Same authority as freeze itself (spec: the exam officer performs the
  // final freeze) — packaging is the step right after it.
  @Post(':paperVersionId/build')
  @Roles('EXAM_OFFICER')
  build(@Param('paperVersionId') paperVersionId: string, @CurrentUser() user: SessionUser) {
    return this.packages.build(paperVersionId, actorName(user));
  }
}
