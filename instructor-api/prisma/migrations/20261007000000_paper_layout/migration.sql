-- Past-paper layouts (sections, "answer 3 from Section B") carried from upload to the published paper.
ALTER TABLE "SourceDocument" ADD COLUMN "layout" JSONB;
ALTER TABLE "QuestionBankItem" ADD COLUMN "section" TEXT, ADD COLUMN "sourceNumber" INTEGER;
ALTER TABLE "Blueprint" ADD COLUMN "format" JSONB;
ALTER TABLE "PaperVersion" ADD COLUMN "layout" JSONB;
ALTER TABLE "PaperItem" ADD COLUMN "section" TEXT;
