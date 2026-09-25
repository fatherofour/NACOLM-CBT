import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CandidatesService } from './candidates.service.js';
import { CreateCandidateDto } from './dto/create-candidate.dto.js';
import { BulkImportDto } from './dto/bulk-import.dto.js';
import { UpdateCandidateDto } from './dto/update-candidate.dto.js';

@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.candidates.list(sessionId);
  }

  @Post()
  create(@Body() dto: CreateCandidateDto) {
    return this.candidates.create(dto);
  }

  @Post('bulk-import')
  bulkImport(@Body() dto: BulkImportDto) {
    return this.candidates.bulkImport(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCandidateDto) {
    return this.candidates.update(id, dto);
  }

  @Post(':id/reset-pin')
  resetPin(@Param('id') id: string) {
    return this.candidates.resetPin(id);
  }
}
