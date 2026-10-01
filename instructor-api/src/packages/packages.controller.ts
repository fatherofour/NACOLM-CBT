import { Controller, Get, Param, Post, StreamableFile } from '@nestjs/common';
import { PackagesService } from './packages.service.js';
import { CurrentUser, Roles, actorName, type SessionUser } from '../auth/decorators.js';

@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get(':paperVersionId')
  get(@Param('paperVersionId') paperVersionId: string) {
    return this.packages.get(paperVersionId);
  }

  // Same authority as publishing itself (spec: the exam officer performs
  // the final freeze/publish) — packaging is the step right after it.
  @Post(':paperVersionId/build')
  @Roles('EXAM_OFFICER')
  build(@Param('paperVersionId') paperVersionId: string, @CurrentUser() user: SessionUser) {
    return this.packages.build(paperVersionId, actorName(user));
  }

  // The file is encrypted and useless without the release key, but it is
  // still the paper: only the exam officer, who carries it to the venue, gets it.
  @Get(':paperVersionId/download')
  @Roles('EXAM_OFFICER')
  async download(@Param('paperVersionId') paperVersionId: string) {
    const file = await this.packages.download(paperVersionId);
    return new StreamableFile(file, { type: 'application/octet-stream', disposition: `attachment; filename="${paperVersionId}.cbtpkg"` });
  }
}
