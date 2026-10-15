const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LOCK = 74261007;
const manifest = [
  [1,'001_postgres.sql','migrate-postgres.js','ats_schema_migrations',false],
  [2,'002_approval_configurations_postgres.sql','migrate-approval-configurations.js','ats_approval_configuration_migrations',true],
  [3,'003_requisition_approvals_postgres.sql','migrate-requisition-approvals.js','ats_requisition_approval_migrations',false],
  [4,'004_headcount_budgets_postgres.sql','migrate-headcount-budgets.js','ats_headcount_budget_migrations',true],
  [5,'005_requisition_operations_postgres.sql','migrate-requisition-operations.js','ats_requisition_operation_migrations',true],
  [6,'006_requisition_lifecycle_postgres.sql','migrate-requisition-lifecycle.js','ats_requisition_lifecycle_migrations',true],
  [7,'007_requisition_tracking_job_drafts_postgres.sql','migrate-requisition-tracking-job-drafts.js','ats_requisition_tracking_job_migrations',true],
  [8,'008_job_publication_postgres.sql','migrate-job-publication.js','ats_job_publication_migrations',true],
  [9,'009_candidate_portal_postgres.sql','migrate-candidate-portal.js','ats_candidate_portal_migrations',true]
];
const digest = text => crypto.createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
function source(entry) {
  const sql = fs.readFileSync(path.join(__dirname,'migrations',entry[1]),'utf8');
  if (/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:roles|permissions|role_permissions|user_roles)\b/i.test(sql)) throw Error('DDL_CONTAINS_RBAC_MUTATION');
  return {sql,checksum:digest(sql),rbacChecksum:digest(fs.readFileSync(path.join(__dirname,entry[2]),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'sync-permissions.js'),'utf8'))};
}
async function present(db, name) { return Boolean((await db.prepare('SELECT to_regclass(?) AS present').get(name))?.present); }
async function verifyObjects(db, sql) {
  for (const match of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) if (!await present(db,match[1])) throw Error('DDL_OBJECT_MISSING');
  for (const match of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi)) {
    if (!await db.prepare('SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=? AND column_name=?').get(match[1],match[2])) throw Error('DDL_COLUMN_MISSING');
  }
  for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)/gi)) if (!await db.prepare('SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=?').get(match[1])) throw Error('DDL_FUNCTION_MISSING');
  for (const match of sql.matchAll(/CREATE\s+TRIGGER\s+(\w+)\s+[\s\S]*?\s+ON\s+(\w+)\s+/gi)) if (!await db.prepare('SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=? AND t.tgname=?').get(match[2],match[1])) throw Error('DDL_TRIGGER_MISSING');
}
async function verifyDDL(db, version) {
  if (db.provider !== 'postgres' || !await present(db,'ats_schema_execution')) return null;
  const rows = await db.prepare('SELECT version,sql_checksum FROM ats_schema_execution WHERE version<=? ORDER BY version').all(version);
  if (rows.length !== version) throw Error('DDL_DEPENDENCY_MISSING');
  for (const [index,row] of rows.entries()) {
    const entry=manifest[index],expected=source(entry);
    if (row.version!==entry[0] || row.sql_checksum!==expected.checksum) throw Error('DDL_CHECKSUM_MISMATCH');
    await verifyObjects(db,expected.sql);
    const phase=await db.prepare('SELECT status,contract_checksum FROM ats_rbac_reconciliation WHERE version=?').get(entry[0]);
    if (!phase || phase.status!==(entry[4]?'PENDING':'NOT_REQUIRED') || phase.contract_checksum!==expected.rbacChecksum) throw Error('RBAC_PHASE_CONTRACT_MISMATCH');
  }
  db.schemaExecutionStatus={ddl:'VERIFIED',rbacReconciliation:'PENDING',fullMigrationComplete:false};
  return db.schemaExecutionStatus;
}
async function withStandardMigration(db, action) {
  if (db.provider !== 'postgres') return action();
  return db.transaction(async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(?)').get(LOCK);
    if (await present(db,'ats_schema_execution')) throw Error('RBAC_RECONCILIATION_PENDING_USE_SCHEMA_EXECUTOR');
    return action();
  });
}
async function fingerprintRBAC(db) {
  const rows={};
  for(const [table,order]of [['roles','id'],['permissions','id'],['role_permissions','role_id,permission_id'],['user_roles','user_id,role_id']]) {
    if (!await present(db,table)) return null;
    rows[table]=await db.prepare('SELECT * FROM '+table+' ORDER BY '+order).all();
  }
  return digest(JSON.stringify(rows));
}
function assertLocalURL(value) {
  let url;
  try { url=new URL(value); } catch { throw Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^\/ats_migration_validation_[a-f0-9]{8}$/.test(url.pathname)) throw Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
}
async function executeDDL(db, through = 9) {
  if (db.provider!=='postgres' || !Number.isInteger(through) || through<1 || through>9) throw Error('SCHEMA_EXECUTOR_TARGET_INVALID');
  assertLocalURL(db.pool?.options?.connectionString);
  return db.transaction(async()=>{
    const identity=await db.prepare('SELECT current_database() AS name,host(inet_server_addr()) AS address').get();
    if (!/^ats_migration_validation_[a-f0-9]{8}$/.test(identity?.name||'') || !['127.0.0.1','::1'].includes(identity.address)) throw Error('DISPOSABLE_LOCAL_DATABASE_REQUIRED');
    await db.prepare('SELECT pg_advisory_xact_lock(?)').get(LOCK);
    for(const entry of manifest) if(await present(db,entry[3])) throw Error('STANDARD_MIGRATION_HISTORY_REQUIRES_SEPARATE_REVIEW');
    if (!await present(db,'ats_schema_execution')) {
      const tables=await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'").all();
      if(tables.length) throw Error('SCHEMA_EXECUTOR_REQUIRES_EMPTY_DATABASE');
      await db.exec("CREATE TABLE ats_schema_execution(version INTEGER PRIMARY KEY,sql_checksum TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase='DDL_DATA'),applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE ats_rbac_reconciliation(version INTEGER PRIMARY KEY REFERENCES ats_schema_execution(version),status TEXT NOT NULL CHECK(status IN ('PENDING','NOT_REQUIRED')),contract_checksum TEXT NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    }
    const before=await fingerprintRBAC(db);
    for(const entry of manifest.slice(0,through)) {
      const expected=source(entry),applied=await db.prepare('SELECT sql_checksum FROM ats_schema_execution WHERE version=?').get(entry[0]);
      if(applied){if(applied.sql_checksum!==expected.checksum)throw Error('DDL_CHECKSUM_MISMATCH');continue;}
      if(entry[0]>1)await verifyDDL(db,entry[0]-1);
      await db.exec(expected.sql);
      await verifyObjects(db,expected.sql);
      await db.prepare("INSERT INTO ats_schema_execution(version,sql_checksum,phase) VALUES (?,?,'DDL_DATA')").run(entry[0],expected.checksum);
      await db.prepare('INSERT INTO ats_rbac_reconciliation(version,status,contract_checksum) VALUES (?,?,?)').run(entry[0],entry[4]?'PENDING':'NOT_REQUIRED',expected.rbacChecksum);
    }
    if(before!==null && before!==await fingerprintRBAC(db)) throw Error('SOURCE_RBAC_CHANGED_BY_DDL');
    return verifyDDL(db,through);
  });
}
async function main() {
  const config=require('../config/config');
  if(config.DB_PROVIDER!=='postgres')throw Error('POSTGRES_TEST_CONFIGURATION_REQUIRED');
  assertLocalURL(config.DATABASE_URL);
  const db=require('./database').getDatabase();
  try {const index=process.argv.indexOf('--through'),through=index<0?9:Number(process.argv[index+1]);console.log(JSON.stringify(await executeDDL(db,through)));}finally{await db.close();}
}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message.replace(/[^A-Z_]/g,''));process.exitCode=1;});
module.exports={executeDDL,verifyDDL,withStandardMigration,fingerprintRBAC,manifest};
