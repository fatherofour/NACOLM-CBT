import { Module } from '@nestjs/common';
import { QtiController } from './qti.controller.js';
import { QtiService } from './qti.service.js';

@Module({
  controllers: [QtiController],
  providers: [QtiService],
})
export class QtiModule {}
