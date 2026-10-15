const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sql = () => fs.readFileSync(path.join(__dirname, 'migrations/001_postgres.sql'), 'utf8');
// Git/Windows may check out CRLF while the applied migration was hashed as LF.
// Canonicalize EOL only; content changes must still fail verification.
const checksum = () => crypto.createHash('sha256').update(sql().replace(/\r\n/g, '\n')).digest('hex');
async function runStandardMigration(db) {
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
    const row = await db.prepare('SELECT checksum FROM ats_schema_migrations WHERE version=?').get(1);if(!row&&db.provider==='postgres'){const phase=await require(path.join(__dirname,'schema-executor')).verifyDDL(db,1);if(phase){return phase;}}
    if (!row || row.checksum !== checksum()) throw new Error('DATABASE_MIGRATION_REQUIRED');
  } catch (error) {if(db.provider==='postgres'&&error.code==='42P01'){const phase=await require(path.join(__dirname,'schema-executor')).verifyDDL(db,1);if(phase){return phase;}}
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
    console.log(db.schemaExecutionStatus?JSON.stringify(db.schemaExecutionStatus):'[PostgreSQL] COMPLETED');
  } finally { await db.close(); }
}
if (require.main === module) main().catch(error => { console.error('[PostgreSQL]', error.code || error.message.replace(/[^A-Z_]/g, '') || 'MIGRATION_FAILED'); process.exitCode = 1; });
module.exports = { migrate, verifyMigration };

async function migrate(db) {
  if(db.provider!=='postgres')return runStandardMigration(db);
  return require(path.join(__dirname,'schema-executor')).withStandardMigration(db,()=>runStandardMigration(db));
}
