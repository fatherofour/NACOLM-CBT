-- central-api and instructor-api are unrelated schemas (different Prisma
-- vs. SQLAlchemy models); they share one Postgres container to save
-- resources but get separate databases, never a shared schema.
CREATE DATABASE instructor_api;
