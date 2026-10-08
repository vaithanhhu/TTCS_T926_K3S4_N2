const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sql = () => fs.readFileSync(path.join(__dirname, 'migrations/001_postgres.sql'), 'utf8');
// Git/Windows may check out CRLF while the applied migration was hashed as LF.
// Canonicalize EOL only; content changes must still fail verification.
const checksum = () => crypto.createHash('sha256').update(sql().replace(/\r\n/g, '\n')).digest('hex');
async function migrate(db) {
  await db.transaction(async () => {
    await db.exec('SELECT pg_advisory_xact_lock(74261007)');
    await db.exec('CREATE TABLE IF NOT EXISTS ats_schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const applied = await db.prepare('SELECT checksum FROM ats_schema_migrations WHERE version=?').get(1);
    if (applied) { if (applied.checksum !== checksum()) throw new Error('MIGRATION_CHECKSUM_MISMATCH'); return; }
    await db.exec(sql());
    await db.prepare('INSERT INTO ats_schema_migrations(version,checksum) VALUES (?,?)').run(1, checksum());
  });
}
async function verifyMigration(db) {
  try {
    const row = await db.prepare('SELECT checksum FROM ats_schema_migrations WHERE version=?').get(1);
    if (!row || row.checksum !== checksum()) throw new Error('DATABASE_MIGRATION_REQUIRED');
  } catch (error) {
    if (error.code === '42P01') throw new Error('DATABASE_MIGRATION_REQUIRED');
    throw error;
  }
}
async function main() {
  process.env.DB_PROVIDER = 'postgres';
  const db = require('./database').getDatabase();
  try {
    if (process.argv.includes('--seed')) {
      if (!process.argv.includes('--demo')) throw new Error('EXPLICIT_DEMO_SEED_REQUIRED');
      await verifyMigration(db);
      for (const table of require('./import-sqlite').TABLES) {
        if (Number((await db.prepare('SELECT COUNT(*) AS n FROM '+table).get()).n)) throw new Error('DEMO_SEED_REQUIRES_EMPTY_DATABASE');
      }
      await db.transaction(() => require('./seed').seedDatabase(db, { preservePasswords: true }));
    } else await migrate(db);
    console.log('[PostgreSQL] COMPLETED');
  } finally { await db.close(); }
}
if (require.main === module) main().catch(error => { console.error('[PostgreSQL]', error.code || error.message.replace(/[^A-Z_]/g, '') || 'MIGRATION_FAILED'); process.exitCode = 1; });
module.exports = { migrate, verifyMigration };
