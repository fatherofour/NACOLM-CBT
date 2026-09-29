-- CreateEnum
CREATE TYPE "ScriptAnswerStatus" AS ENUM ('UPLOADED', 'OCR_FAILED', 'AI_MARKING_FAILED', 'PENDING_REVIEW', 'REVIEWED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "TheoryScriptAnswer" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcribedText" TEXT,
    "ocrModel" TEXT,
    "ocrError" TEXT,
    "aiScore" DOUBLE PRECISION,
    "aiMaxScore" DOUBLE PRECISION,
    "aiJustification" TEXT,
    "aiModel" TEXT,
    "aiError" TEXT,
    "instructorScore" DOUBLE PRECISION,
    "instructorNotes" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "status" "ScriptAnswerStatus" NOT NULL DEFAULT 'UPLOADED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TheoryScriptAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TheoryScriptAnswer_paperVersionId_candidateId_questionId_key" ON "TheoryScriptAnswer"("paperVersionId", "candidateId", "questionId");

-- AddForeignKey
ALTER TABLE "TheoryScriptAnswer" ADD CONSTRAINT "TheoryScriptAnswer_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryScriptAnswer" ADD CONSTRAINT "TheoryScriptAnswer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TheoryScriptAnswer" ADD CONSTRAINT "TheoryScriptAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuestionBankItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
