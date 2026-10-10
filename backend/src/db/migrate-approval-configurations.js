const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function migration(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '002_approval_configurations_' + db.provider + '.sql'), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
}

async function verify(db) {
  try {
    const row = await db.prepare('SELECT checksum FROM ats_approval_configuration_migrations WHERE version=1').get();
    if (!row || row.checksum !== migration(db).checksum) throw new Error('S301_MIGRATION_REQUIRED');
  } catch (error) {
    if (error.code === '42P01' || /no such table/i.test(error.message)) throw new Error('S301_MIGRATION_REQUIRED');
    throw error;
  }
}

async function migrate(db) {
  return db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74263001);
    const time = db.provider === 'postgres' ? 'TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP' : "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
    await db.exec('CREATE TABLE IF NOT EXISTS ats_approval_configuration_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at ' + time + ')');
    const source = migration(db);
    const applied = await db.prepare('SELECT checksum FROM ats_approval_configuration_migrations WHERE version=1').get();
    if (applied) { if (applied.checksum !== source.checksum) throw new Error('S301_MIGRATION_CHECKSUM_MISMATCH'); return; }
    await db.exec(source.sql);
    await db.prepare("INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING")
      .run('perm-approval-configuration-manage', 'approval_configuration.manage', 'Cấu hình luồng phê duyệt', 'REQUISITIONS', 'Quản lý phiên bản chuỗi phê duyệt theo phòng ban');
    await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='approval_configuration.manage' WHERE r.code='HR_MANAGER' ON CONFLICT DO NOTHING").run();
    await db.prepare('INSERT INTO ats_approval_configuration_migrations(version,checksum) VALUES (1,?)').run(source.checksum);
  });
}

async function main() {
  const db = require('./database').getDatabase();
  try { if (process.argv.includes('--check')) await verify(db); else await migrate(db); console.log('[S3-01] COMPLETED'); }
  finally { await db.close(); }
}

if (require.main === module) main().catch(() => { console.error('[S3-01] MIGRATION_FAILED'); process.exitCode = 1; });
module.exports = { migrate, verify };
