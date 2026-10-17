const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function source() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/015_bulk_interviews.sql'), 'utf8').replace(/\r\n/g, '\n');
  return {sql, checksum:crypto.createHash('sha256').update(sql).digest('hex')};
}

async function shape(db, table) {
  if (db.provider === 'postgres') {
    const columns = await db.prepare('SELECT column_name AS name,data_type AS type,is_nullable,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? ORDER BY ordinal_position').all(table);
    const constraints = await db.prepare('SELECT contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=?::regclass ORDER BY contype,pg_get_constraintdef(oid)').all(table);
    return {columns, constraints};
  }
  return {
    columns:await db.prepare(`PRAGMA table_info(${table})`).all(),
    keys:await db.prepare(`PRAGMA foreign_key_list(${table})`).all(),
    sql:(await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table))?.sql,
    indexes:await Promise.all((await db.prepare(`PRAGMA index_list(${table})`).all()).map(async row => ({unique:row.unique,partial:row.partial,columns:(await db.prepare(`PRAGMA index_info(${row.name})`).all()).map(item=>item.name)})))
  };
}

async function verifySchema(db) {
  await db.prepare('SELECT id,recipient,subject,body_html,body_text,template_name,status,retry_count,error_message,sent_at,created_at FROM email_outbox LIMIT 0').all();
  const definitions = {
    interview_batches:{columns:['id','actor_id','actor_snapshot','request_key','payload_hash','fingerprint','result_json','created_at'],pk:'id',unique:['actor_id','request_key'],fk:[['actor_id','users','SET NULL']]},
    interview_batch_items:{columns:['batch_id','interview_id','candidate_id'],pk:'interview_id',unique:['batch_id','candidate_id'],fk:[['batch_id','interview_batches','CASCADE'],['interview_id','interviews','CASCADE'],['candidate_id','candidates','NO ACTION']]},
    interview_invitation_deliveries:{columns:['outbox_id','interview_id','state','attempts','error_code','updated_at'],pk:'outbox_id',unique:['interview_id'],fk:[['outbox_id','email_outbox','NO ACTION'],['interview_id','interviews','NO ACTION']]}
  };
  const fail = () => {throw Error('S603_SCHEMA_DRIFT');};
  for (const [table, definition] of Object.entries(definitions)) {
    const actual = await shape(db,table);
    if (actual.columns.length !== definition.columns.length) fail();
    for (const name of definition.columns) {
      const column = actual.columns.find(row=>row.name===name);
      if (!column || column.type.toLowerCase() !== (name==='attempts'?'integer':'text')) fail();
      const nullable = name==='error_code' || name==='actor_id';
      if (db.provider==='postgres' ? column.is_nullable!==(nullable?'YES':'NO') : column.notnull!==(nullable?0:1)) fail();
      const value = db.provider==='postgres'?column.column_default:column.dflt_value;
      if (name==='attempts'?String(value)!=='0':value!==null) fail();
    }
    if (db.provider==='postgres') {
      if (!actual.constraints.some(row=>row.contype==='p' && row.definition===`PRIMARY KEY (${definition.pk})`)) fail();
      if (!actual.constraints.some(row=>row.contype==='u' && row.definition===`UNIQUE (${definition.unique.join(', ')})`)) fail();
      for (const [column,target,onDelete] of definition.fk) if (!actual.constraints.some(row=>row.contype==='f' && row.definition===`FOREIGN KEY (${column}) REFERENCES ${target}(id)${onDelete==='NO ACTION'?'':' ON DELETE '+onDelete}`)) fail();
      if (table==='interview_invitation_deliveries') {
        const checks=actual.constraints.filter(row=>row.contype==='c');
        const values=['PENDING','SENDING','SENT','SIMULATED','FAILED','UNKNOWN'].map(value=>"'"+value+"'::text").join(', ');
        if (checks.length!==1 || checks[0].definition!==`CHECK ((state = ANY (ARRAY[${values}])))`) fail();
      }
    } else {
      if (actual.columns.filter(row=>row.pk).map(row=>row.name).join(',')!==definition.pk) fail();
      if (!actual.indexes.some(row=>row.unique===1 && row.partial===0 && row.columns.join(',')===definition.unique.join(','))) fail();
      for (const [column,target,onDelete] of definition.fk) if (!actual.keys.some(row=>row.from===column && row.table===target && row.to==='id' && row.on_delete===onDelete)) fail();
      if (table==='interview_invitation_deliveries' && !actual.sql.includes("CHECK(state IN ('PENDING','SENDING','SENT','SIMULATED','FAILED','UNKNOWN'))")) fail();
    }
  }
  const indexes=db.provider==='postgres'
    ? await db.prepare("SELECT indexdef AS definition FROM pg_indexes WHERE schemaname=current_schema() AND indexname='idx_interview_deliveries_state'").all()
    : await db.prepare('PRAGMA index_info(idx_interview_deliveries_state)').all();
  if (db.provider==='postgres'?!indexes.some(row=>row.definition.includes('(state)')):indexes.length!==1 || indexes[0].name!=='state') fail();
}

async function verify(db) {
  await require('./migrate-interview-scheduling').verify(db);
  const row=await db.prepare('SELECT checksum FROM ats_bulk_interview_migrations WHERE version=1').get();
  if (row?.checksum!==source().checksum) throw Error('S603_MIGRATION_REQUIRED');
  await verifySchema(db);
}

async function migrate(db) {
  return db.transaction(async()=>{
    if(db.provider==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(?)').get(74265015);
    await require('./migrate-interview-scheduling').verify(db);
    await db.prepare('SELECT id FROM email_outbox LIMIT 0').all();
    await db.exec('CREATE TABLE IF NOT EXISTS ats_bulk_interview_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)');
    const row=await db.prepare('SELECT checksum FROM ats_bulk_interview_migrations WHERE version=1').get();
    const migration=source();
    if(row){if(row.checksum!==migration.checksum)throw Error('S603_CHECKSUM_MISMATCH');}
    else await db.exec(migration.sql);
    await verifySchema(db);
    if(!row)await db.prepare('INSERT INTO ats_bulk_interview_migrations(version,checksum) VALUES(1,?)').run(migration.checksum);
    return {success:true};
  });
}

module.exports={migrate,verify,verifySchema,source};
if(require.main===module){const db=require('./database').getDatabase();migrate(db).then(()=>console.log('S603_MIGRATION_OK')).catch(()=>{console.error('S603_MIGRATION_FAILED');process.exitCode=1;}).finally(()=>db.close());}
