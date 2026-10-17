const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const source=db=>{const sql=fs.readFileSync(path.join(__dirname,'migrations','016_interview_invitations_'+(db.provider==='postgres'?'postgres':'sqlite')+'.sql'),'utf8');return{sql,checksum:crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')};};
async function migrate(db){
  try{await require('./migrate-interview-scheduling').verify(db);}catch{await require('./migrate-interview-scheduling').migrate(db);}
  return db.transaction(async()=>{
  if(db.provider==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265016);
  await db.exec('CREATE TABLE IF NOT EXISTS ats_interview_invitation_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
  const previous=await db.prepare('SELECT checksum FROM ats_interview_invitation_migrations WHERE version=1').get(),migration=source(db);
  if(previous&&previous.checksum!==migration.checksum)throw Error('INTERVIEW_INVITATION_CHECKSUM_MISMATCH');
  if(db.provider!=='postgres'){
    const cols=(await db.prepare("PRAGMA table_info(interviews)").all()).map(c=>c.name);
    if(!cols.includes('candidate_response_status'))await db.exec("ALTER TABLE interviews ADD COLUMN candidate_response_status TEXT DEFAULT 'PENDING'");
    if(!cols.includes('candidate_response_note'))await db.exec("ALTER TABLE interviews ADD COLUMN candidate_response_note TEXT");
    if(!cols.includes('candidate_responded_at'))await db.exec("ALTER TABLE interviews ADD COLUMN candidate_responded_at TEXT");
  }
  if(!previous){
    await db.exec(migration.sql);
    await db.prepare('INSERT INTO ats_interview_invitation_migrations(version,checksum) VALUES(1,?)').run(migration.checksum);
  }
});}
async function verify(db){
  const previous=await db.prepare('SELECT checksum FROM ats_interview_invitation_migrations WHERE version=1').get();
  if(previous?.checksum!==source(db).checksum)throw Error('INTERVIEW_INVITATION_MIGRATION_REQUIRED');
  await db.prepare('SELECT id,interview_id,token_hash,status,expires_at,used_at,created_at FROM interview_invitation_tokens LIMIT 0').all();
}
module.exports={migrate,verify};
if(require.main===module){
  const db=require('./database').getDatabase();
  migrate(db).then(()=>console.log('INTERVIEW_INVITATION_MIGRATION_OK')).catch(err=>{console.error('INTERVIEW_INVITATION_MIGRATION_FAILED',err);process.exitCode=1;}).finally(()=>db.close());
}
