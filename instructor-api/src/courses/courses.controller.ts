import { Body, Controller, Get, Post } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import { EnsureSessionDto } from './dto/ensure-session.dto.js';

@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list() {
    return this.courses.listCourses();
  }

  // Idempotent: the top bar's course/session context calls this on every
  // load so the wizard always has a Session row to attach to, without a
  // separate "create course" admin screen.
  @Post('ensure-session')
  ensureSession(@Body() dto: EnsureSessionDto) {
    return this.courses.ensureSession(dto.courseCode, dto.courseName, dto.sessionLabel);
  }
}
