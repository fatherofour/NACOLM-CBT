import { Module } from '@nestjs/common';
import { MarkingSchemesController } from './marking-schemes.controller.js';
import { MarkingSchemesService } from './marking-schemes.service.js';

@Module({
  controllers: [MarkingSchemesController],
  providers: [MarkingSchemesService],
})
export class MarkingSchemesModule {}
