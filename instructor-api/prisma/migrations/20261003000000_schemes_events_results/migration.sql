
-- CreateEnum
CREATE TYPE "SchemeStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "MarkEventKind" AS ENUM ('AI_PROPOSED', 'CONFIRMED', 'CHANGED', 'PUBLISHED', 'CORRECTED');

-- AlterTable
ALTER TABLE "MarkingScheme" ADD COLUMN     "aiTask" TEXT,
ADD COLUMN     "aiTaskError" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "modelAnswer" TEXT,
ADD COLUMN     "partialCreditNotes" TEXT,
ADD COLUMN     "sampleAnswers" JSONB,
ADD COLUMN     "status" "SchemeStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "testResults" JSONB,
ADD COLUMN     "testedAt" TIMESTAMP(3),
ADD COLUMN     "zeroCreditNotes" TEXT,
ALTER COLUMN "totalMarks" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ConceptGroup" ADD COLUMN     "notes" TEXT,
ALTER COLUMN "marks" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "theoryOnPaper" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "PaperItem" ADD COLUMN     "markingSnapshot" JSONB;

-- AlterTable
ALTER TABLE "ExamPackage" ADD COLUMN     "resultsKeyHex" TEXT;

-- AlterTable
ALTER TABLE "TheoryScriptAnswer" ADD COLUMN     "aiBreakdown" JSONB;

-- CreateTable
CREATE TABLE "TheoryMarkEvent" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "kind" "MarkEventKind" NOT NULL,
    "score" DOUBLE PRECISION,
    "previousScore" DOUBLE PRECISION,
    "model" TEXT,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TheoryMarkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueResult" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "serviceNumber" TEXT NOT NULL,
    "candidateId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT NOT NULL,
    "responseHash" TEXT NOT NULL,
    "objectiveCorrect" INTEGER NOT NULL,
    "objectiveTotal" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "centre" TEXT NOT NULL,
    "importedBy" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSha256" TEXT NOT NULL,

    CONSTRAINT "VenueResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TheoryMarkEvent_answerId_idx" ON "TheoryMarkEvent"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueResult_paperVersionId_serviceNumber_key" ON "VenueResult"("paperVersionId", "serviceNumber");

-- AddForeignKey
ALTER TABLE "TheoryMarkEvent" ADD CONSTRAINT "TheoryMarkEvent_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "TheoryScriptAnswer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueResult" ADD CONSTRAINT "VenueResult_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueResult" ADD CONSTRAINT "VenueResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
