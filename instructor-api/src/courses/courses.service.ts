import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  listCourses() {
    return this.prisma.course.findMany({ include: { sessions: true }, orderBy: { code: 'asc' } });
  }

  async createCourse(code: string, name: string) {
    const exists = await this.prisma.course.findUnique({ where: { code } });
    if (exists) throw new ConflictException(`A course with code "${code}" already exists`);
    return this.prisma.course.create({ data: { code, name } });
  }

  async updateCourse(id: string, name: string) {
    await this.mustFind(id);
    return this.prisma.course.update({ where: { id }, data: { name } });
  }

  async deleteCourse(id: string) {
    const course = await this.mustFind(id);
    const sessionCount = await this.prisma.session.count({ where: { courseId: id } });
    if (sessionCount > 0) {
      throw new ConflictException(`Can't delete ${course.code} — it has ${sessionCount} exam session${sessionCount === 1 ? '' : 's'}. Remove those first.`);
    }
    return this.prisma.course.delete({ where: { id } });
  }

  // Terms (Sessions) are still created ad hoc from the wizard/upload panels,
  // but only under a course that already exists in the admin-managed catalog
  // above — this never creates a Course.
  async ensureSession(courseId: string, label: string) {
    await this.mustFind(courseId);
    return this.prisma.session.upsert({
      where: { courseId_label: { courseId, label } },
      update: {},
      create: { courseId, label },
      include: { course: true },
    });
  }

  private async mustFind(id: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException('Course not found. Ask an admin to add it first.');
    return course;
  }
}
