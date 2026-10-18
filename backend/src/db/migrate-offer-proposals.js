const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '021_offer_proposals_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function ensureOfferColumns(db) {
  if (db.provider === 'sqlite') {
    const cols = (await db.prepare('PRAGMA table_info(offers)').all()).map(c => c.name);
    if (!cols.includes('job_title_id')) {
      await db.exec('ALTER TABLE offers ADD COLUMN job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL');
    }
    if (!cols.includes('allowances')) {
      await db.exec('ALTER TABLE offers ADD COLUMN allowances NUMERIC DEFAULT 0');
    }
    if (!cols.includes('expiration_date')) {
      await db.exec('ALTER TABLE offers ADD COLUMN expiration_date TEXT');
    }
    if (!cols.includes('salary_justification')) {
      await db.exec('ALTER TABLE offers ADD COLUMN salary_justification TEXT');
    }
    if (!cols.includes('offer_letter')) {
      await db.exec('ALTER TABLE offers ADD COLUMN offer_letter TEXT');
    }
    if (!cols.includes('notes')) {
      await db.exec('ALTER TABLE offers ADD COLUMN notes TEXT');
    }
    if (!cols.includes('created_by')) {
      await db.exec('ALTER TABLE offers ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL');
    }
    if (!cols.includes('updated_at')) {
      await db.exec('ALTER TABLE offers ADD COLUMN updated_at TEXT');
    }
  }
}

async function migrate(db) {
  try {
    await require('./migrate-hiring-decisions').verify(db);
  } catch {
    await require('./migrate-hiring-decisions').migrate(db);
  }
  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265021);
    }
    await ensureOfferColumns(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_proposals_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_offer_proposals_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous && previous.checksum !== migration.checksum) {
      throw Error('OFFER_PROPOSALS_CHECKSUM_MISMATCH');
    }
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_offer_proposals_migrations(version, checksum) VALUES(1, ?)').run(migration.checksum);
    }
  });
}

async function verify(db) {
  const previous = await db.prepare('SELECT checksum FROM ats_offer_proposals_migrations WHERE version=1').get();
  if (previous?.checksum !== source(db).checksum) {
    throw Error('OFFER_PROPOSALS_MIGRATION_REQUIRED');
  }
  await db.prepare('SELECT id, candidate_id, job_title_id, salary_monthly, allowances, expiration_date FROM offers LIMIT 0').all();
}

module.exports = { migrate, verify, source, ensureOfferColumns };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('OFFER_PROPOSALS_MIGRATION_OK')).catch(err => {
    console.error('OFFER_PROPOSALS_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
