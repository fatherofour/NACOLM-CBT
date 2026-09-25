/*
  Warnings:

  - You are about to drop the column `rosterSize` on the `ExamPackage` table. All the data in the column will be lost.
  - Added the required column `rank` to the `Candidate` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "rank" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ExamPackage" DROP COLUMN "rosterSize";
