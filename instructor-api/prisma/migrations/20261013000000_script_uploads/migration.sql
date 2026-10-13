-- Whole handwritten scripts: every page a candidate wrote on, split into answers per question.
CREATE TABLE "ScriptUpload" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "pagePaths" TEXT[],
    "pageTexts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'reading',
    "error" TEXT,
    "split" JSONB,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScriptUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScriptUpload_paperVersionId_candidateId_key" ON "ScriptUpload"("paperVersionId", "candidateId");
ALTER TABLE "ScriptUpload" ADD CONSTRAINT "ScriptUpload_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScriptUpload" ADD CONSTRAINT "ScriptUpload_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TheoryScriptAnswer" ADD COLUMN "scriptUploadId" TEXT;
ALTER TABLE "TheoryScriptAnswer" ADD CONSTRAINT "TheoryScriptAnswer_scriptUploadId_fkey" FOREIGN KEY ("scriptUploadId") REFERENCES "ScriptUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
