import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CoursesModule } from './courses/courses.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { AiGenerationModule } from './ai-generation/ai-generation.module.js';
import { QuestionBankModule } from './question-bank/question-bank.module.js';
import { MarkingSchemesModule } from './marking-schemes/marking-schemes.module.js';
import { BlueprintsModule } from './blueprints/blueprints.module.js';
import { PapersModule } from './papers/papers.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CandidatesModule } from './candidates/candidates.module.js';
import { PackagesModule } from './packages/packages.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    CandidatesModule,
    PackagesModule,
    AuditModule,
    CoursesModule,
    DocumentsModule,
    AiGenerationModule,
    QuestionBankModule,
    MarkingSchemesModule,
    BlueprintsModule,
    PapersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
