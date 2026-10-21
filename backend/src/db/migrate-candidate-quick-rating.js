const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sql = fs.readFileSync(path.join(__dirname, 'migrations/027_candidate_quick_rating.sql'), 'utf8');
const checksum = crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
async function hasColumn(db) {
  const columns = await db.prepare(db.provider === 'postgres'
    ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidates'"
    : 'PRAGMA table_info(candidates)').all();
  return columns.some(column => column.name === 'rating');
}
async function verify(db) {
  const row = await db.prepare('SELECT checksum FROM ats_candidate_quick_rating_migrations WHERE version=1').get();
  if (row?.checksum !== checksum || !await hasColumn(db)) throw Error('CANDIDATE_QUICK_RATING_MIGRATION_REQUIRED');
}
async function migrate(db) {
  return db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265027);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_candidate_quick_rating_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
    const row = await db.prepare('SELECT checksum FROM ats_candidate_quick_rating_migrations WHERE version=1').get();
    if (row && row.checksum !== checksum) throw Error('CANDIDATE_QUICK_RATING_CHECKSUM_MISMATCH');
    if (!row) {
      if (await hasColumn(db)) throw Error('CANDIDATE_QUICK_RATING_UNTRACKED_SCHEMA');
      await db.exec(sql);
      await db.prepare('INSERT INTO ats_candidate_quick_rating_migrations(version,checksum) VALUES(1,?)').run(checksum);
    }
    await verify(db);
  });
}
module.exports = { migrate, verify, hasColumn, checksum };
if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('CANDIDATE_QUICK_RATING_MIGRATION_OK'))
    .catch(error => { console.error(error.code || error.message); process.exitCode = 1; }).finally(() => db.close());
}
