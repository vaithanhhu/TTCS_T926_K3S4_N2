const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sql = fs.readFileSync(path.join(__dirname,'migrations/013_talent_pool.sql'),'utf8');
const checksum = crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex');

async function migrate(db) {
  return db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265006);
    await db.prepare('SELECT id FROM users LIMIT 0').all();
    await db.prepare('SELECT id,stage,requisition_id FROM candidates LIMIT 0').all();
    await db.prepare('SELECT id,title,job_title_id,status FROM requisitions LIMIT 0').all();
    await db.prepare('SELECT candidate_id,tag_name FROM candidate_tags LIMIT 0').all();
    await db.prepare('SELECT candidate_id,document_type,parsed_text FROM candidate_documents LIMIT 0').all();
    await db.exec('CREATE TABLE IF NOT EXISTS ats_talent_pool_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_talent_pool_migrations WHERE version=1').get();
    if (previous && previous.checksum !== checksum) throw Error('S506_CHECKSUM_MISMATCH');
    if (!previous) {
      await db.exec(sql);
      await db.prepare('INSERT INTO ats_talent_pool_migrations(version,checksum) VALUES(1,?)').run(checksum);
    }
    await db.prepare('SELECT id,candidate_id,interested_title,reason,final_round_confirmed,confirmed_by,created_at FROM candidate_talent_pool LIMIT 0').all();
    return {success:true,checksum};
  });
}
module.exports = {migrate,checksum};
if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => console.log('S506_MIGRATION_OK')).catch(() => {console.error('S506_MIGRATION_FAILED');process.exitCode=1;}).finally(() => db.close());
}
