const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const source=db=>{const sql=fs.readFileSync(path.join(__dirname,'migrations','017_interview_reschedule_cancel_'+(db.provider==='postgres'?'postgres':'sqlite')+'.sql'),'utf8');return{sql,checksum:crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')};};
async function migrate(db){
  try{await require('./migrate-interview-invitations').verify(db);}catch{await require('./migrate-interview-invitations').migrate(db);}
  return db.transaction(async()=>{
    if(db.provider==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265017);
    await db.exec('CREATE TABLE IF NOT EXISTS ats_interview_reschedule_cancel_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
    const previous=await db.prepare('SELECT checksum FROM ats_interview_reschedule_cancel_migrations WHERE version=1').get(),migration=source(db);
    if(previous&&previous.checksum!==migration.checksum)throw Error('INTERVIEW_RESCHEDULE_CANCEL_CHECKSUM_MISMATCH');
    if(db.provider!=='postgres'){
      const cols=(await db.prepare("PRAGMA table_info(interviews)").all()).map(c=>c.name);
      if(!cols.includes('cancellation_reason'))await db.exec("ALTER TABLE interviews ADD COLUMN cancellation_reason TEXT");
      if(!cols.includes('cancelled_at'))await db.exec("ALTER TABLE interviews ADD COLUMN cancelled_at TEXT");
      if(!cols.includes('rescheduled_at'))await db.exec("ALTER TABLE interviews ADD COLUMN rescheduled_at TEXT");
      if(!cols.includes('reschedule_reason'))await db.exec("ALTER TABLE interviews ADD COLUMN reschedule_reason TEXT");
    }
    if(!previous){
      await db.exec(migration.sql);
      await db.prepare('INSERT INTO ats_interview_reschedule_cancel_migrations(version,checksum) VALUES(1,?)').run(migration.checksum);
    }
  });
}
async function verify(db){
  const previous=await db.prepare('SELECT checksum FROM ats_interview_reschedule_cancel_migrations WHERE version=1').get();
  if(previous?.checksum!==source(db).checksum)throw Error('INTERVIEW_RESCHEDULE_CANCEL_MIGRATION_REQUIRED');
  await db.prepare('SELECT cancellation_reason,cancelled_at,rescheduled_at,reschedule_reason FROM interviews LIMIT 0').all();
}
module.exports={migrate,verify,source};
if(require.main===module){
  const db=require('./database').getDatabase();
  migrate(db).then(()=>console.log('INTERVIEW_RESCHEDULE_CANCEL_MIGRATION_OK')).catch(err=>{console.error('INTERVIEW_RESCHEDULE_CANCEL_MIGRATION_FAILED',err);process.exitCode=1;}).finally(()=>db.close());
}
