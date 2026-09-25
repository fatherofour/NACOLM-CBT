import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators.js';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
