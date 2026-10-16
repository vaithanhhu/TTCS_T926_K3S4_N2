const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '011_candidate_stage_transitions_' + db.provider + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
};

async function verify(db) {
  try {
    const row = await db.prepare('SELECT checksum FROM ats_candidate_stage_transitions_migrations WHERE version=1').get();
    if (row?.checksum !== source(db).checksum) throw Error('STAGE_TRANSITIONS_MIGRATION_REQUIRED');
    db.candidateStageTransitionsSchema = true;
  } catch (error) {
    if (error.code === '42P01' || /no such table/i.test(error.message)) throw Error('STAGE_TRANSITIONS_MIGRATION_REQUIRED');
    throw error;
  }
}

async function migrate(db) {
  await require('./migrate-requisition-open-policy').verify(db);
  await db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265001);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_candidate_stage_transitions_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_candidate_stage_transitions_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous) {
      if (previous.checksum !== migration.checksum) throw Error('STAGE_TRANSITIONS_CHECKSUM_MISMATCH');
      return;
    }
    await db.exec(migration.sql);

    // In SQLite, add columns to candidate_status_history safely
    if (db.provider === 'sqlite') {
      const existingCols = (await db.prepare('PRAGMA table_info(candidate_status_history)').all()).map(c => c.name);
      const colsToAdd = [
        ['rejection_reason_id', 'TEXT REFERENCES recruitment_catalog_items(id)'],
        ['skipped_interview_approved_by', 'TEXT REFERENCES users(id)'],
        ['skipped_interview_approved_name', 'TEXT'],
        ['skipped_interview_approved_at', 'TEXT'],
        ['exception_request_id', 'TEXT REFERENCES candidate_stage_exceptions(id)']
      ];
      for (const [col, colType] of colsToAdd) {
        if (!existingCols.includes(col)) {
          try {
            await db.exec(`ALTER TABLE candidate_status_history ADD COLUMN ${col} ${colType};`);
          } catch (e) {
            // Ignore if column was already added
          }
        }
      }
    }

    await db.prepare('INSERT INTO ats_candidate_stage_transitions_migrations(version, checksum) VALUES (1, ?)').run(migration.checksum);
    await require('./sync-permissions').synchronizePermissions(db);
  });
  await verify(db);
}

async function main() {
  if (!process.env.DB_PATH && !process.env.ATS_DB_PATH && fs.existsSync(path.join(process.cwd(), '.local', 'ats-demo.db'))) {
    try { require('../config/local-demo').configureLocalDemo(); } catch {}
  }
  const db = require('./database').getDatabase();
  try {
    if (process.argv.includes('--check')) await verify(db);
    else await migrate(db);
    console.log('[S5-03] COMPLETED');
  } finally {
    await db.close();
  }
}

if (require.main === module) main().catch((err) => {
  console.error('[S5-03] MIGRATION_FAILED', err);
  process.exitCode = 1;
});

module.exports = { migrate, verify };
