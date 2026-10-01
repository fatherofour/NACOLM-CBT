-- AlterTable
ALTER TABLE "TheoryScriptAnswer" ADD COLUMN "extraImagePaths" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "UnassignedScan" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnassignedScan_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UnassignedScan" ADD CONSTRAINT "UnassignedScan_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
