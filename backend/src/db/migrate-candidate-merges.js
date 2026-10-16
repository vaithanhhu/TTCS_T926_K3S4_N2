const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function source(db) {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', `015_candidate_merges_${db.provider}.sql`), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') };
}
async function verify(db) {
  const row = await db.prepare('SELECT checksum FROM ats_candidate_merge_migrations WHERE version=1').get();
  if (row?.checksum !== source(db).checksum) throw Error('CANDIDATE_MERGE_MIGRATION_REQUIRED');
  return true;
}
async function runStandardMigration(db) {
  return db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74264015);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_candidate_merge_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const migration = source(db);
    const previous = await db.prepare('SELECT checksum FROM ats_candidate_merge_migrations WHERE version=1').get();
    if (previous && previous.checksum !== migration.checksum) throw Error('CANDIDATE_MERGE_CHECKSUM_MISMATCH');
    if (!previous) {
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_candidate_merge_migrations(version,checksum) VALUES (1,?)').run(migration.checksum);
    }
    for (const [id, code, name] of [
      ['perm-candidate-merge', 'candidate.merge', 'Gộp hồ sơ ứng viên'],
      ['perm-candidate-merge-undo', 'candidate.merge.undo', 'Hoàn tác gộp hồ sơ ứng viên']
    ]) await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,\'CANDIDATES\',?) ON CONFLICT(code) DO NOTHING').run(id, code, name, name);
    for (const role of ['ADMIN', 'HR_MANAGER', 'RECRUITER']) {
      await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN (\'candidate.merge\',\'candidate.merge.undo\') WHERE r.code=? ON CONFLICT DO NOTHING').run(role);
    }
  });
}
async function migrate(db) {
  if (db.provider !== 'postgres') return runStandardMigration(db);
  return require('./schema-executor').withStandardMigration(db, () => runStandardMigration(db));
}
module.exports = { migrate, verify };
