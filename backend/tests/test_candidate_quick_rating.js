const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false);
assert.equal(fs.existsSync(path.join(root, '.env')), false);
const migration = require('../src/db/migrate-candidate-quick-rating');
const Requisitions = require('../src/services/requisitionService');
async function run(db, label) {
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
  const service = new Requisitions(db), actor = { id: 'usr-hr-mgr' };
  const data = { fullName: 'Synthetic Rating', email: 'rating@example.test', rating: 5 };
  const before = Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).n);
  const missing = await service.createCandidate(data, actor);
  assert.equal(missing.statusCode, 503);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM candidates').get()).n), before);
  await migration.migrate(db);
  await migration.migrate(db);
  for (const rating of [0, 6, -1, 1.2, '5', {}, true]) {
    const invalid = await service.createCandidate({ ...data, rating }, actor);
    assert.equal(invalid.statusCode, 400);
  }
  const result = await service.createCandidate(data, actor);
  assert.equal(result.success, true);
  assert.equal((await db.prepare('SELECT rating FROM candidates WHERE id=?').get(result.data.id)).rating, 5);
  const dto = await service.getCandidateById(result.data.id, actor);
  assert.equal(dto.data.rating, 5);
  assert.equal((await service.updateCandidateRating(result.data.id, 3, actor)).success, true);
  assert.equal((await service.getCandidateById(result.data.id, actor)).data.rating, 3);
  assert.equal((await service.updateCandidateRating(result.data.id, 6, actor)).statusCode, 400);
  for (const viewer of [null, { id: 'missing', roles: ['ADMIN'] }, { id: 'usr-candidate', roles: ['HR_MANAGER'] }, { id: 'usr-recruiter-2' }]) {
    assert.equal((await service.updateCandidateRating(result.data.id, 1, viewer)).statusCode, 403);
  }
  assert.equal((await db.prepare('SELECT rating FROM candidates WHERE id=?').get(result.data.id)).rating, 3);
  await db.prepare('UPDATE candidates SET email=(SELECT email FROM users WHERE id=?) WHERE id=?').run('usr-candidate', result.data.id);
  assert.equal(Object.hasOwn((await service.getCandidateById(result.data.id, { id: 'usr-candidate' })).data, 'rating'), false);
  const legacy = await service.createCandidate({ fullName: 'Legacy', email: 'legacy-rating@example.test' }, actor);
  assert.equal(legacy.success, true);
  assert.equal((await service.getCandidateById(legacy.data.id, actor)).data.rating, null);
  assert.equal((await service.createCandidate(data, { id: 'missing', roles: ['ADMIN'] })).statusCode, 403);
  await db.prepare('UPDATE ats_candidate_quick_rating_migrations SET checksum=?').run('drift');
  await assert.rejects(() => migration.migrate(db), /CHECKSUM_MISMATCH/);
  console.log(label + ' QUICK_RATING_PASS');
}
async function main() {
  const db = require('../src/db/database').getDatabase(':memory:');
  try { await run(db, 'SQLite'); } finally { db.close(); }
  const engine = new (require('@electric-sql/pglite').PGlite)();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: result?.rows || [], rowCount: result?.affectedRows || 0 };
  };
  const pg = new (require('../src/db/postgres').PostgresDatabase)({}, {
    on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); }
  });
  try {
    await require('../src/db/migrate-postgres').migrate(pg);
    await run(pg, 'PGlite');
  } finally { await pg.close(); }
}
module.exports = { run };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
