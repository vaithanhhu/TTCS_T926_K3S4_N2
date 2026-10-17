const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const source=db=>{const sql=fs.readFileSync(path.join(__dirname,'migrations','015_interview_conflict_override_'+(db.provider==='postgres'?'postgres':'sqlite')+'.sql'),'utf8');return{sql,checksum:crypto.createHash('sha256').update(sql.replace(/\r\n/g,'\n')).digest('hex')};};

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const source = db => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      'migrations',
      '015_interview_conflict_override_' +
        (db.provider === 'postgres' ? 'postgres' : 'sqlite') +
        '.sql'
    ),
    'utf8'
  );

  return {
    sql,
    checksum: crypto
      .createHash('sha256')
      .update(sql.replace(/\r\n/g, '\n'))
      .digest('hex')
  };
};

async function migrate(db) {
  await require('./migrate-interview-scheduling').migrate(db);

  return db.transaction(async () => {
    if (db.provider === 'postgres') {
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265015);
    }

    await db.exec(
      'CREATE TABLE IF NOT EXISTS ats_interview_conflict_override_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)'
    );

    const previous = await db
      .prepare(
        'SELECT checksum FROM ats_interview_conflict_override_migrations WHERE version=1'
      )
      .get();

    const migration = source(db);

    if (previous && previous.checksum !== migration.checksum) {
      throw Error('INTERVIEW_CONFLICT_OVERRIDE_CHECKSUM_MISMATCH');
    }

    if (!previous) {
      await db.exec(migration.sql);

      await db
        .prepare(
          'INSERT INTO ats_interview_conflict_override_migrations(version,checksum) VALUES(1,?) ON CONFLICT (version) DO NOTHING'
        )
        .run(migration.checksum);
    }

    await require('./sync-permissions')
      .synchronizeInterviewConflictOverridePermission(db);
  });
}

async function verify(db) {
  const previous = await db
    .prepare(
      'SELECT checksum FROM ats_interview_conflict_override_migrations WHERE version=1'
    )
    .get();

  if (previous?.checksum !== source(db).checksum) {
    throw Error('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_REQUIRED');
  }

  await db
    .prepare(
      'SELECT id,actor_id,interview_id,reason,conflicts_json,created_at FROM interview_conflict_override_audit LIMIT 0'
    )
    .all();
}

module.exports = { migrate, verify };

if (require.main === module) {
  const db = require('./database').getDatabase();

  migrate(db)
    .then(() => console.log('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_OK'))
    .catch(() => {
      console.error('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_FAILED');
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
async function verify(db){const previous=await db.prepare('SELECT checksum FROM ats_interview_conflict_override_migrations WHERE version=1').get();if(previous?.checksum!==source(db).checksum)throw Error('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_REQUIRED');await db.prepare('SELECT id,actor_id,interview_id,reason,conflicts_json,created_at FROM interview_conflict_override_audit LIMIT 0').all();}
module.exports={migrate,verify};
if(require.main===module){const db=require('./database').getDatabase();migrate(db).then(()=>console.log('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_OK')).catch(()=>{console.error('INTERVIEW_CONFLICT_OVERRIDE_MIGRATION_FAILED');process.exitCode=1;}).finally(()=>db.close());}
