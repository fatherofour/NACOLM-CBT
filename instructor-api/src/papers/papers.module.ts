import { Module } from '@nestjs/common';
import { PapersController } from './papers.controller.js';
import { PapersService } from './papers.service.js';

@Module({
  controllers: [PapersController],
  providers: [PapersService],
})
export class PapersModule {}
