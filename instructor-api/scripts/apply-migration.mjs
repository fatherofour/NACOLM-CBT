// One-off runner for hand-written migration SQL, since `prisma migrate dev`
// needs an interactive terminal this environment doesn't have. Usage:
//   node scripts/apply-migration.mjs prisma/migrations/<name>/migration.sql
// Then: npx prisma migrate resolve --applied <name>
import { readFileSync } from 'node:fs';
import pg from 'pg';
import 'dotenv/config';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to-migration.sql>');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query(sql);
  console.log('applied', file);
} finally {
  await client.end();
}
