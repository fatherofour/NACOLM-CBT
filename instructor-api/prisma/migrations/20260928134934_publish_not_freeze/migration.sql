-- "Freeze" renamed to "Publish" throughout the app, plus a planned exam
-- date attached to each published version. Table has no rows at migration
-- time in either environment, so the new NOT NULL column needs no backfill.
ALTER TABLE "PaperVersion" RENAME COLUMN "frozenAt" TO "publishedAt";
ALTER TABLE "PaperVersion" RENAME COLUMN "frozenBy" TO "publishedBy";
ALTER TABLE "PaperVersion" ADD COLUMN "examDate" TIMESTAMP(3) NOT NULL;
