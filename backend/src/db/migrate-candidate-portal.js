const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '009_candidate_portal_' + db.provider + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function verify(db) {
  try {
    const row = await db.prepare('SELECT checksum FROM ats_candidate_portal_migrations WHERE version=1').get();
    if (row?.checksum !== source(db).checksum) throw Error('S4_MIGRATION_REQUIRED');
    db.candidatePortalSchema = true;
  } catch (error) {
    if (error.code === '42P01' || /no such table/i.test(error.message)) throw Error('S4_MIGRATION_REQUIRED');
    throw error;
  }
}

async function migrate(db) {
  await require('./migrate-job-publication').verify(db);
  await db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74264001);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_candidate_portal_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_candidate_portal_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous) {
      if (previous.checksum !== migration.checksum) throw Error('S4_CHECKSUM_MISMATCH');
    } else {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_candidate_portal_migrations(version, checksum) VALUES (1, ?)').run(migration.checksum);
    }
    await require('./sync-permissions').synchronizeCandidatePortalPermissions(db);
    db.candidatePortalSchema = true;
  });
}

async function main() {
  const db = require('./database').getDatabase();
  try {
    if (process.argv.includes('--check')) await verify(db);
    else await migrate(db);
    console.log('[S4] COMPLETED');
  } finally {
    await db.close();
  }
}

if (require.main === module) main().catch((err) => {
  console.error('[S4] MIGRATION_FAILED', err);
  process.exitCode = 1;
});

module.exports = { migrate, verify };
