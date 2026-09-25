#!/usr/bin/env node
// Create or update a portal user. This is the only way to create the first
// ADMIN account (the Users screen in the portal needs one to sign in as
// before it can create any more) — every account after that can be managed
// from Admin > Users instead.
//
//   node scripts/create-user.mjs --service NA/12345 --rank Capt --name "O. Nwosu" \
//     --role INSTRUCTOR [--password '...']
//
// --role is INSTRUCTOR, EXAM_OFFICER or ADMIN. Without --password a strong
// one is generated and printed once. Reads DATABASE_URL from the environment
// or .env. The hash format matches src/auth/password.ts.
import 'dotenv/config';
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const scrypt = promisify(scryptCb);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const serviceNumber = (args.service ?? '').trim().toUpperCase();
const role = (args.role ?? 'INSTRUCTOR').toUpperCase();
if (!serviceNumber || !args.rank || !args.name || !['INSTRUCTOR', 'EXAM_OFFICER', 'ADMIN'].includes(role)) {
  console.error('Usage: --service <no> --rank <rank> --name "<name>" --role INSTRUCTOR|EXAM_OFFICER|ADMIN [--password <pw>]');
  process.exit(1);
}
const password = args.password ?? randomBytes(12).toString('base64url');
if (password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const passwordHash = ['scrypt', 32768, 8, 1, salt.toString('base64'), hash.toString('base64')].join('$');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(
  `INSERT INTO "User" (id, "serviceNumber", rank, "fullName", role, "passwordHash")
   VALUES ($1, $2, $3, $4, $5::"UserRole", $6)
   ON CONFLICT ("serviceNumber") DO UPDATE SET rank = EXCLUDED.rank, "fullName" = EXCLUDED."fullName",
     role = EXCLUDED.role, "passwordHash" = EXCLUDED."passwordHash", active = true`,
  ['u_' + randomBytes(10).toString('hex'), serviceNumber, args.rank, args.name, role, passwordHash],
);
// A password change signs the user out everywhere.
await client.query(
  `UPDATE "AuthSession" SET "revokedAt" = now() WHERE "revokedAt" IS NULL AND "userId" = (SELECT id FROM "User" WHERE "serviceNumber" = $1)`,
  [serviceNumber],
);
await client.end();
console.log(`Saved ${role} ${args.rank} ${args.name} (${serviceNumber}).`);
if (!args.password) console.log(`Password: ${password}\nGive it to the user once; it isn't stored in plain text.`);
