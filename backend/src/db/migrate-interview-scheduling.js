const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const additions = [['duration_minutes', 'INTEGER DEFAULT 60'], ['interview_format', 'TEXT'], ['meeting_room', 'TEXT'], ['meeting_link', 'TEXT']];

const source = db => {
  const file = '014_interview_scheduling_' + (db.provider === 'postgres' ? 'postgres' : 'sqlite') + '.sql';
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
  return { sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n') + JSON.stringify(additions)).digest('hex') };
};

async function verify(db) {
  try {
    const row = await db.prepare('SELECT checksum FROM ats_interview_scheduling_migrations WHERE version=1').get();
    if (row?.checksum !== source(db).checksum) throw Error('INTERVIEW_SCHEDULING_MIGRATION_REQUIRED');
    await verifySchema(db);
  } catch (error) {
    if (error.code === '42P01' || /no such table/i.test(error.message)) throw Error('INTERVIEW_SCHEDULING_MIGRATION_REQUIRED');
    throw error;
  }
}

async function verifySchema(db) {
  const fail = () => { throw Error('INTERVIEW_SCHEDULING_SCHEMA_DRIFT'); };
  const pg = db.provider === 'postgres';
  const columns = pg
    ? await db.prepare("SELECT column_name AS name, data_type AS type,column_default,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interviews'").all()
    : await db.prepare('PRAGMA table_info(interviews)').all();
  for (const [name, type] of [['duration_minutes', 'integer'], ['interview_format', 'text'], ['meeting_room', 'text'], ['meeting_link', 'text']]) {
    const column = columns.find(item => item.name === name);
    if (!column || column.type.toLowerCase() !== type) fail();
    const defaultValue=pg?column.column_default:column.dflt_value;
    if (name==='duration_minutes' ? String(defaultValue).trim()!=='60' : defaultValue!==null) fail();
    if (pg ? column.is_nullable!=='YES' : column.notnull!==0) fail();
  }
  await db.prepare('SELECT interview_id,user_id,role,created_at FROM interview_interviewers LIMIT 0').all();
  if (pg) {
    const members = await db.prepare("SELECT column_name,is_nullable,data_type,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='interview_interviewers'").all();
    for (const name of ['interview_id','user_id','role','created_at']) {
      const column=members.find(row => row.column_name===name);
      if (!column || column.is_nullable!=='NO' || column.data_type!==(name==='created_at'?'timestamp with time zone':'text')) fail();
      const expected=name==='role'?"'INTERVIEWER'::text":name==='created_at'?'CURRENT_TIMESTAMP':null;
      if (column.column_default!==expected) fail();
    }
    const constraints = await db.prepare("SELECT contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='interview_interviewers'::regclass").all();
    if (!constraints.some(row => row.contype === 'p' && /PRIMARY KEY \(interview_id, user_id\)/.test(row.definition))) fail();
    for (const [column, table] of [['interview_id', 'interviews'], ['user_id', 'users']]) {
      if (!constraints.some(row => row.contype === 'f' && row.definition.includes(`FOREIGN KEY (${column}) REFERENCES ${table}(id) ON DELETE CASCADE`))) fail();
    }
    const indexes = await db.prepare("SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname=current_schema() AND tablename IN ('interviews','interview_interviewers')").all();
    for (const [name, column] of [['idx_interviews_scheduled_time', 'scheduled_time'], ['idx_interview_interviewers_user', 'user_id']]) {
      if (!indexes.some(row => row.name === name && row.definition.includes(`(${column})`))) fail();
    }
  } else {
    const members = await db.prepare('PRAGMA table_info(interview_interviewers)').all();
    for (const name of ['interview_id','user_id','role','created_at']) {
      const column=members.find(row => row.name===name);
      if (!column || column.notnull!==1 || column.type.toUpperCase()!=='TEXT') fail();
      const expected=name==='role'?"'INTERVIEWER'":name==='created_at'?"datetime('now')":null;
      if (column.dflt_value!==expected) fail();
    }
    if (members.find(row => row.name === 'interview_id')?.pk !== 1 || members.find(row => row.name === 'user_id')?.pk !== 2) fail();
    const keys = await db.prepare('PRAGMA foreign_key_list(interview_interviewers)').all();
    for (const [column, table] of [['interview_id', 'interviews'], ['user_id', 'users']]) {
      if (!keys.some(row => row.from === column && row.table === table && row.to === 'id' && row.on_delete === 'CASCADE')) fail();
    }
    for (const [table, name, column] of [['interviews', 'idx_interviews_scheduled_time', 'scheduled_time'], ['interview_interviewers', 'idx_interview_interviewers_user', 'user_id']]) {
      const indexes = await db.prepare(`PRAGMA index_list(${table})`).all();
      if (!indexes.some(row => row.name === name)) fail();
      const fields = await db.prepare(`PRAGMA index_info(${name})`).all();
      if (fields.length !== 1 || fields[0].name !== column) fail();
    }
  }
  const missing = await db.prepare("SELECT i.id FROM interviews i WHERE i.interviewer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id=i.id AND ii.user_id=i.interviewer_id AND ii.role='PRIMARY') LIMIT 1").get();
  if (missing) fail();
  const orphan = await db.prepare('SELECT ii.interview_id FROM interview_interviewers ii LEFT JOIN interviews i ON i.id=ii.interview_id LEFT JOIN users u ON u.id=ii.user_id WHERE i.id IS NULL OR u.id IS NULL LIMIT 1').get();
  if (orphan) fail();
}

async function migrate(db) {
  return db.transaction(async () => {
    if (db.provider === 'postgres') await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265014);
    await db.prepare('SELECT id FROM users LIMIT 0').all();
    await db.prepare('SELECT id FROM candidates LIMIT 0').all();
    await db.prepare('SELECT id, interviewer_id, scheduled_time FROM interviews LIMIT 0').all();
    await db.exec('CREATE TABLE IF NOT EXISTS ats_interview_scheduling_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    const previous = await db.prepare('SELECT checksum FROM ats_interview_scheduling_migrations WHERE version=1').get();
    const migration = source(db);
    if (previous) {
      if (previous.checksum !== migration.checksum) throw Error('S602_CHECKSUM_MISMATCH');
      await verifySchema(db);
      return { success: true, checksum: migration.checksum };
    }
    if (db.provider === 'sqlite') {
      const existingCols = (await db.prepare('PRAGMA table_info(interviews)').all()).map(c => c.name);
      for (const [col, colType] of additions) {
        if (!existingCols.includes(col)) {
          await db.exec(`ALTER TABLE interviews ADD COLUMN ${col} ${colType};`);
        }
      }
    }
    await db.exec(migration.sql);
    await db.exec("INSERT INTO interview_interviewers (interview_id, user_id, role) SELECT id, interviewer_id, 'PRIMARY' FROM interviews WHERE interviewer_id IS NOT NULL ON CONFLICT (interview_id, user_id) DO NOTHING;");
    await verifySchema(db);
    await db.prepare('INSERT INTO ats_interview_scheduling_migrations (version, checksum) VALUES (1, ?)').run(migration.checksum);
    return { success: true, checksum: migration.checksum };
  });
}

module.exports = { migrate, verify, verifySchema, source };

if (require.main === module) {
  const db = require('./database').getDatabase();
  migrate(db).then(() => {
    console.log('S602_MIGRATION_OK');
  }).catch(err => {
    console.error('S602_MIGRATION_FAILED', err);
    process.exitCode = 1;
  }).finally(() => db.close());
}
