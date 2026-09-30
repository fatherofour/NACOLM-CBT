import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BlueprintsService } from './blueprints.service.js';
import { CreateBlueprintDto } from './dto/create-blueprint.dto.js';
import { Roles } from '../auth/decorators.js';

@Controller('blueprints')
export class BlueprintsController {
  constructor(private readonly blueprints: BlueprintsService) {}

  @Get()
  list(@Query('sessionId') sessionId: string) {
    return this.blueprints.listForSession(sessionId);
  }

  @Post()
  create(@Body() dto: CreateBlueprintDto) {
    return this.blueprints.create(dto);
  }

  @Post(':id/generate')
  @Roles('INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN')
  generate(@Param('id') id: string) {
    return this.blueprints.generate(id);
  }

  @Get(':id/coverage')
  coverage(@Param('id') id: string) {
    return this.blueprints.coverage(id);
  }
}
