-- Sign-in switches from serviceNumber (Army number) to a dedicated username.
-- Table has no rows at migration time, so a required column needs no backfill.
ALTER TABLE "User" ADD COLUMN "username" TEXT NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
