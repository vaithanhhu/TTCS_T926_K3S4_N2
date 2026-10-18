const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '020_hiring_decisions_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function migrate(db) {
  try {
    await require('./migrate-interview-question-suggestions').verify(db);
  } catch {
    await require('./migrate-interview-question-suggestions').migrate(db);
  }
  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265020);
    }
    await db.exec('CREATE TABLE IF NOT EXISTS ats_hiring_decisions_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_hiring_decisions_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous && previous.checksum !== migration.checksum) {
      throw Error('HIRING_DECISIONS_CHECKSUM_MISMATCH');
    }
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_hiring_decisions_migrations(version, checksum) VALUES(1, ?)').run(migration.checksum);
    }
  });
}

async function verify(db) {
  const previous = await db.prepare('SELECT checksum FROM ats_hiring_decisions_migrations WHERE version=1').get();
  if (previous?.checksum !== source(db).checksum) {
    throw Error('HIRING_DECISIONS_MIGRATION_REQUIRED');
  }
  await db.prepare('SELECT id, candidate_id, decision, decided_by FROM hiring_decisions LIMIT 0').all();
}

module.exports = { migrate, verify, source };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('HIRING_DECISIONS_MIGRATION_OK')).catch(err => {
    console.error('HIRING_DECISIONS_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
