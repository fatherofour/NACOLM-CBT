import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  ensureCourse(code: string, name: string) {
    return this.prisma.course.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
  }

  async ensureSession(courseCode: string, courseName: string, label: string) {
    const course = await this.ensureCourse(courseCode, courseName);
    return this.prisma.session.upsert({
      where: { courseId_label: { courseId: course.id, label } },
      update: {},
      create: { courseId: course.id, label },
      include: { course: true },
    });
  }

  listCourses() {
    return this.prisma.course.findMany({ include: { sessions: true }, orderBy: { code: 'asc' } });
  }
}
