const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '023_offer_delivery_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function ensureDeliveryColumns(db) {
  if (db.provider === 'sqlite') {
    const cols = (await db.prepare('PRAGMA table_info(offers)').all()).map(c => c.name);
    if (!cols.includes('sent_at')) {
      await db.exec('ALTER TABLE offers ADD COLUMN sent_at TEXT');
    }
    if (!cols.includes('sent_by')) {
      await db.exec('ALTER TABLE offers ADD COLUMN sent_by TEXT REFERENCES users(id) ON DELETE SET NULL');
    }
    if (!cols.includes('response_token')) {
      await db.exec('ALTER TABLE offers ADD COLUMN response_token TEXT');
    }
    if (!cols.includes('token_expires_at')) {
      await db.exec('ALTER TABLE offers ADD COLUMN token_expires_at TEXT');
    }
    if (!cols.includes('responded_at')) {
      await db.exec('ALTER TABLE offers ADD COLUMN responded_at TEXT');
    }
    if (!cols.includes('candidate_response')) {
      await db.exec('ALTER TABLE offers ADD COLUMN candidate_response TEXT');
    }
    if (!cols.includes('candidate_comment')) {
      await db.exec('ALTER TABLE offers ADD COLUMN candidate_comment TEXT');
    }
    if (!cols.includes('rejection_reason_category')) {
      await db.exec('ALTER TABLE offers ADD COLUMN rejection_reason_category TEXT');
    }
    if (!cols.includes('predecessor_offer_id')) {
      await db.exec('ALTER TABLE offers ADD COLUMN predecessor_offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL');
    }
    if (!cols.includes('superseded_by_offer_id')) {
      await db.exec('ALTER TABLE offers ADD COLUMN superseded_by_offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL');
    }
  }
}

async function migrate(db) {
  try {
    await require('./migrate-offer-approvals').verify(db);
  } catch {
    await require('./migrate-offer-approvals').migrate(db);
  }
  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265023);
    }
    await ensureDeliveryColumns(db);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_offer_delivery_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_offer_delivery_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous && previous.checksum !== migration.checksum) {
      throw Error('OFFER_DELIVERY_CHECKSUM_MISMATCH');
    }
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_offer_delivery_migrations(version, checksum) VALUES(1, ?)').run(migration.checksum);
    }
  });
}

async function verify(db) {
  const previous = await db.prepare('SELECT checksum FROM ats_offer_delivery_migrations WHERE version=1').get();
  if (previous?.checksum !== source(db).checksum) {
    throw Error('OFFER_DELIVERY_MIGRATION_REQUIRED');
  }
  await db.prepare('SELECT id, sent_at, response_token, candidate_response FROM offers LIMIT 0').all();
}

module.exports = { migrate, verify, source, ensureDeliveryColumns };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('OFFER_DELIVERY_MIGRATION_OK')).catch(err => {
    console.error('OFFER_DELIVERY_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
