const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '025_onboarding_checklists_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function migrate(db) {
  try {
    await require('./migrate-offer-negotiation').verify(db);
  } catch {
    await require('./migrate-offer-negotiation').migrate(db);
  }
  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265025);
    }
    await db.exec('CREATE TABLE IF NOT EXISTS ats_onboarding_checklists_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_onboarding_checklists_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous && previous.checksum !== migration.checksum) {
      throw Error('ONBOARDING_CHECKLISTS_CHECKSUM_MISMATCH');
    }
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_onboarding_checklists_migrations(version, checksum) VALUES(1, ?)').run(migration.checksum);
    }
  });
}

async function verify(db) {
  const previous = await db.prepare('SELECT checksum FROM ats_onboarding_checklists_migrations WHERE version=1').get();
  if (previous?.checksum !== source(db).checksum) {
    throw Error('ONBOARDING_CHECKLISTS_MIGRATION_REQUIRED');
  }
  await db.prepare('SELECT id, name FROM onboarding_templates LIMIT 0').all();
  await db.prepare('SELECT id, category FROM onboarding_template_items LIMIT 0').all();
  await db.prepare('SELECT id, progress_percentage FROM onboarding_checklists LIMIT 0').all();
  await db.prepare('SELECT id, status FROM onboarding_checklist_items LIMIT 0').all();
}

module.exports = { migrate, verify, source };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('ONBOARDING_CHECKLISTS_MIGRATION_OK')).catch(err => {
    console.error('ONBOARDING_CHECKLISTS_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
