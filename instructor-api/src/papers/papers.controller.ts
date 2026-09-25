import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PapersService } from './papers.service.js';
import { FreezePaperDto } from './dto/freeze-paper.dto.js';

@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  @Post('freeze')
  freeze(@Body() dto: FreezePaperDto) {
    return this.papers.freeze(dto);
  }

  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.papers.listVersions(sessionId);
  }
}
