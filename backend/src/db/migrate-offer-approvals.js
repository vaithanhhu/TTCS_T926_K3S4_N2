const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '022_offer_approvals_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function ensureApprovalColumns(db) {
  if (db.provider === 'sqlite') {
    const cols = (await db.prepare('PRAGMA table_info(offers)').all()).map(c => c.name);
    if (!cols.includes('current_approval_level')) {
      await db.exec('ALTER TABLE offers ADD COLUMN current_approval_level INTEGER NOT NULL DEFAULT 1');
    }
    if (!cols.includes('required_approval_levels')) {
      await db.exec('ALTER TABLE offers ADD COLUMN required_approval_levels INTEGER NOT NULL DEFAULT 1');
    }
  }
}

async function migrate(db) {
  try {
    await require('./migrate-offer-proposals').verify(db);
  } catch {
    await require('./migrate-offer-proposals').migrate(db);
  }
  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265022);
    }
    await ensureApprovalColumns(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_approvals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_offer_approvals_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous && previous.checksum !== migration.checksum) {
      throw Error('OFFER_APPROVALS_CHECKSUM_MISMATCH');
    }
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_offer_approvals_migrations(version, checksum) VALUES(1, ?)').run(migration.checksum);
    }
  });
}

async function verify(db) {
  const previous = await db.prepare('SELECT checksum FROM ats_offer_approvals_migrations WHERE version=1').get();
  if (previous?.checksum !== source(db).checksum) {
    throw Error('OFFER_APPROVALS_MIGRATION_REQUIRED');
  }
  await db.prepare('SELECT id, offer_id, level, action, approver_id, approver_name, comment FROM offer_approvals LIMIT 0').all();
}

module.exports = { migrate, verify, source, ensureApprovalColumns };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('OFFER_APPROVALS_MIGRATION_OK')).catch(err => {
    console.error('OFFER_APPROVALS_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
