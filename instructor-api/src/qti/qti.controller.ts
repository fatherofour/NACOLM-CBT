import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { QtiService } from './qti.service.js';

@Controller('papers')
export class QtiController {
  constructor(private readonly qti: QtiService) {}

  // Same read access as everything else about a paper — this is an export
  // of already-published content, not a mutating action, so it isn't gated to
  // Exam Officer the way building the encrypted exam package is.
  @Get(':paperVersionId/qti')
  @Header('Content-Type', 'application/zip')
  async export(@Param('paperVersionId') paperVersionId: string): Promise<StreamableFile> {
    const { filename, data } = await this.qti.exportPaperVersion(paperVersionId);
    return new StreamableFile(data, { disposition: `attachment; filename="${filename}"` });
  }
}
