-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('OBJECTIVE', 'THEORY');

-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('PAST_PAPER', 'AI_DRAFTED');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PAST_PAPER', 'STUDY_MATERIAL');

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "DocumentType" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "centralApiDocumentId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionBankItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "type" "QuestionType" NOT NULL,
    "source" "QuestionSource" NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "options" JSONB,
    "correctIndex" INTEGER,
    "citation" TEXT,
    "citationExcerpt" TEXT,
    "rejectReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarkingScheme" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "ceilingPercent" INTEGER NOT NULL DEFAULT 50,
    "minWordCount" INTEGER NOT NULL DEFAULT 15,
    "reusedFromBank" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkingScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptGroup" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "synonyms" TEXT[],
    "marks" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConceptGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blueprint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "objectiveCount" INTEGER NOT NULL,
    "theoryCount" INTEGER NOT NULL,
    "sourceMode" TEXT NOT NULL,
    "pastQuestionRatio" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "distribution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperVersion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenBy" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,

    CONSTRAINT "PaperVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperItem" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PaperItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLog" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Session_courseId_label_key" ON "Session"("courseId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "MarkingScheme_questionId_key" ON "MarkingScheme"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperVersion_paperId_versionNumber_key" ON "PaperVersion"("paperId", "versionNumber");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionBankItem" ADD CONSTRAINT "QuestionBankItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarkingScheme" ADD CONSTRAINT "MarkingScheme_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptGroup" ADD CONSTRAINT "ConceptGroup_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "MarkingScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Blueprint" ADD CONSTRAINT "Blueprint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paper" ADD CONSTRAINT "Paper_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperVersion" ADD CONSTRAINT "PaperVersion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperItem" ADD CONSTRAINT "PaperItem_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperItem" ADD CONSTRAINT "PaperItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLog" ADD CONSTRAINT "ApprovalLog_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
