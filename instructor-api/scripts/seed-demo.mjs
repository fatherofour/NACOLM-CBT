#!/usr/bin/env node
// Demo data for trying the portal: one course, a past-paper year with
// approved bank questions (with a marking scheme), and this term's session.
// Safe to re-run: it skips anything that already exists.
//
//   node scripts/seed-demo.mjs
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const id = (p) => `${p}_${randomBytes(10).toString('hex')}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function course(code, name) {
  const r = await db.query(`SELECT id FROM "Course" WHERE code=$1`, [code]);
  if (r.rows[0]) return r.rows[0].id;
  const cid = id('c');
  await db.query(`INSERT INTO "Course"(id, code, name) VALUES ($1,$2,$3)`, [cid, code, name]);
  return cid;
}
async function session(courseId, label) {
  const r = await db.query(`SELECT id FROM "Session" WHERE "courseId"=$1 AND label=$2`, [courseId, label]);
  if (r.rows[0]) return r.rows[0].id;
  const sid = id('s');
  await db.query(`INSERT INTO "Session"(id, "courseId", label) VALUES ($1,$2,$3)`, [sid, courseId, label]);
  return sid;
}
async function question(sessionId, q) {
  const r = await db.query(`SELECT id FROM "QuestionBankItem" WHERE "sessionId"=$1 AND body=$2`, [sessionId, q.body]);
  if (r.rows[0]) return r.rows[0].id;
  const qid = id('q');
  await db.query(
    `INSERT INTO "QuestionBankItem"(id,"sessionId",topic,difficulty,type,source,status,body,options,"correctIndex",citation,"citationExcerpt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
    [qid, sessionId, q.topic, q.difficulty, q.type, q.source, q.status, q.body, q.options ? JSON.stringify(q.options) : null, q.correctIndex ?? null, q.citation ?? null, q.excerpt ?? null],
  );
  if (q.scheme) {
    const msid = id('m');
    await db.query(`INSERT INTO "MarkingScheme"(id,"questionId","totalMarks","updatedAt") VALUES ($1,$2,$3,now())`, [msid, qid, q.scheme.total]);
    let i = 0;
    for (const g of q.scheme.groups) {
      await db.query(
        `INSERT INTO "ConceptGroup"(id,"schemeId","canonicalTerm",synonyms,marks,required,"order") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id('g'), msid, g[0], g[1], g[2], g[3], i++],
      );
    }
  }
  return qid;
}

const log301 = await course('LOG301', 'Movement Control');
await course('LOG210', 'Supply Chain Management');
const y2024 = await session(log301, '2024/2025');
const y2025 = await session(log301, '2025/2026');
const now = await session(log301, '2026/2027');

const past = [
  ['Movement control', 'easy', 'What is the recommended vehicle interval for a convoy moving by day on a main supply route?', ['25 metres', '50 metres', '100 metres', '200 metres'], 2],
  ['Movement control', 'medium', 'Which document authorises the movement of a unit convoy along a main supply route?', ['Route card', 'Movement order', 'Load manifest', 'March table'], 1],
  ['Movement control', 'hard', 'Which headquarters normally allocates road space on a main supply route?', ['Unit headquarters', 'Movement control headquarters', 'Brigade workshop', 'Field ambulance'], 1],
  ['Supply chain', 'easy', 'What does the abbreviation POL stand for?', ['Petrol, oil and lubricants', 'Point of loading', 'Port of landing', 'Personnel on leave'], 0],
  ['Supply chain', 'medium', 'Which class of supply covers rations?', ['Class I', 'Class III', 'Class V', 'Class IX'], 0],
  ['Supply chain', 'hard', 'In a forward supply point, which stock is issued first?', ['Newest stock', 'Oldest serviceable stock', 'Heaviest stock', 'Stock nearest the gate'], 1],
];
for (const [sid, list] of [[y2024, past.slice(0, 3)], [y2025, past.slice(3)]]) {
  for (const [topic, difficulty, body, options, correctIndex] of list) {
    await question(sid, { topic, difficulty, type: 'OBJECTIVE', source: 'PAST_PAPER', status: 'APPROVED', body, options, correctIndex });
  }
}
await question(y2025, {
  topic: 'Supply chain', difficulty: 'hard', type: 'THEORY', source: 'PAST_PAPER', status: 'APPROVED',
  body: 'Explain three factors that determine the siting of a forward supply point.',
  scheme: { total: 10, groups: [['security', ['protection', 'protected'], 4, true], ['access', ['road network', 'accessible'], 3, false], ['dispersion', ['dispersal', 'dispersed'], 3, false]] },
});

// This term: a few drafts waiting for review.
await question(now, {
  topic: 'Movement control', difficulty: 'medium', type: 'OBJECTIVE', source: 'AI_DRAFTED', status: 'DRAFT',
  body: 'Which authority issues a movement order for a unit convoy?', options: ['Unit quartermaster', 'Movement control authority', 'Transport officer', 'Provost marshal'], correctIndex: 1,
  citation: 'Movement Control Study Guide p.14', excerpt: 'A movement order, issued by the movement control authority, authorises the use of a route and allocates timings to each serial.',
});
await question(now, {
  topic: 'Supply chain', difficulty: 'easy', type: 'OBJECTIVE', source: 'PAST_PAPER', status: 'DRAFT',
  body: 'Which class of supply covers fuel?', options: ['Class I', 'Class III', 'Class V', 'Class VIII'], correctIndex: 1,
});
await question(now, {
  topic: 'Supply chain', difficulty: 'hard', type: 'THEORY', source: 'AI_DRAFTED', status: 'DRAFT',
  body: 'Describe how a replenishment park is protected and explain why stocks in it are dispersed and kept accessible to the road network.',
  citation: 'Supply Chain Handbook p.41', excerpt: 'Stocks in a replenishment park are dispersed to reduce the effect of air attack and sited for access to the road network.',
});

await db.end();
console.log('Demo data ready: LOG301 Movement Control with past years 2024/2025 and 2025/2026, and drafts in 2026/2027.');
