-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "armyNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPackage" (
    "id" TEXT NOT NULL,
    "paperVersionId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "poolSize" INTEGER NOT NULL,
    "rosterSize" INTEGER NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "builtBy" TEXT NOT NULL,

    CONSTRAINT "ExamPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_sessionId_armyNumber_key" ON "Candidate"("sessionId", "armyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPackage_paperVersionId_key" ON "ExamPackage"("paperVersionId");

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamPackage" ADD CONSTRAINT "ExamPackage_paperVersionId_fkey" FOREIGN KEY ("paperVersionId") REFERENCES "PaperVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
