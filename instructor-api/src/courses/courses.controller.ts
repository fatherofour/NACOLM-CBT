import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import { CreateCourseDto } from './dto/create-course.dto.js';
import { UpdateCourseDto } from './dto/update-course.dto.js';
import { EnsureSessionDto } from './dto/ensure-session.dto.js';
import { Roles } from '../auth/decorators.js';

// The course catalog (code + name) is Admin-managed — every "Course"
// dropdown in the portal (new session, question bank, study material) is
// populated from this list, not free text. Any signed-in staff can read it
// and create a new term under an existing course; only Admins add, rename
// or remove a course itself.
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list() {
    return this.courses.listCourses();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateCourseDto) {
    return this.courses.createCourse(dto.code.trim().toUpperCase(), dto.name.trim());
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.updateCourse(id, dto.name.trim());
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.courses.deleteCourse(id);
  }

  @Post('ensure-session')
  ensureSession(@Body() dto: EnsureSessionDto) {
    return this.courses.ensureSession(dto.courseId, dto.sessionLabel.trim());
  }
}
