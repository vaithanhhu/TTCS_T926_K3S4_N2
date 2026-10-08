const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const TABLES = ['roles','permissions','users','departments','role_permissions','user_roles','competency_frameworks','competency_criteria','job_titles','recruitment_catalog_items','career_page_settings','requisitions','candidates','interviews','offers','sessions','login_audit_logs','password_reset_tokens','otps','email_logs','interview_questions'];
const SYSTEM_TIMES = new Set(['created_at','updated_at','attempted_at','expires_at','used_at','verified_at','sent_at','last_activity_at','locked_until']);
function utc(value) {
  if (value == null) return value;
  const raw = String(value), explicit = /(?:Z|[+-]\d\d:\d\d)$/i.test(raw);
  const parsed = new Date(explicit ? raw : raw.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(parsed.getTime())) throw new Error('INVALID_SYSTEM_TIMESTAMP');
  return parsed.toISOString();
}
function plan(data, departmentMap = {}, allowUnassigned = false) {
  const rows = structuredClone(data), departments = new Map(rows.departments.map(d => [d.id,d]));
  const report = { counts:Object.fromEntries(TABLES.map(t=>[t,rows[t].length])), exactDepartmentMatches:0, externalDepartments:0, unassignedDepartments:0, unresolvedDepartments:[], scheduledTimePreserved:rows.interviews.length };
  const emails = new Set();
  for (const user of rows.users) {
    user.email = user.email.trim().toLowerCase();
    if (emails.has(user.email)) throw new Error('CASE_INSENSITIVE_EMAIL_DUPLICATE'); emails.add(user.email);
    if (Object.hasOwn(departmentMap,user.id)) {
      if (departmentMap[user.id] === null) { user.department_id=null; report.unassignedDepartments++; }
      else {
        const department = departments.get(departmentMap[user.id]); if (!department) throw new Error('INVALID_DEPARTMENT_MAPPING');
        user.department_id = department.id; user.department_name = department.name;
      }
    } else if (user.department_id && !departments.has(user.department_id)) {
      const exact = rows.departments.filter(d => d.name === user.department_name);
      if (exact.length === 1) { user.department_id = exact[0].id; report.exactDepartmentMatches++; }
      else if (user.department_id === 'dept-ext') { user.department_id = null; report.externalDepartments++; }
      else if (!user.department_name) { user.department_id = null; report.unassignedDepartments++; }
      else {
        report.unresolvedDepartments.push({ userId:user.id,legacyDepartmentId:user.department_id,legacyName:user.department_name });
        if (allowUnassigned) user.department_id = null;
      }
    }
    user.must_change_password = Boolean(user.must_change_password);
  }
  for (const table of TABLES) for (const row of rows[table]) {
    for (const key of Object.keys(row)) if (SYSTEM_TIMES.has(key)) row[key] = utc(row[key]);
    if (table === 'requisitions') row.handover_required = Boolean(row.handover_required);
    if (table === 'login_audit_logs') row.sequence_id = row.source_order;
    delete row.source_order;
  }
  return { rows, report, ready:report.unresolvedDepartments.length === 0 || allowUnassigned };
}
function readCopy(filename) {
  const file = path.resolve(filename), runtime = path.resolve(__dirname,'../../data');
  const relative = path.relative(runtime,file);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('USE_ISOLATED_SQLITE_COPY');
  const db = new DatabaseSync(file,{readOnly:true});
  try { return Object.fromEntries(TABLES.map(table=>[table,db.prepare(table==='login_audit_logs'
    ? 'SELECT rowid AS source_order,* FROM login_audit_logs ORDER BY rowid' : 'SELECT * FROM '+table).all()])); }
  finally { db.close(); }
}
async function importRows(db, prepared) {
  if (!prepared.ready) throw new Error('DEPARTMENT_MAPPING_REQUIRED');
  await db.transaction(async () => {
    for (const table of TABLES) if (Number((await db.prepare('SELECT COUNT(*) AS n FROM '+table).get()).n)) throw new Error('IMPORT_REQUIRES_EMPTY_DATABASE');
    for (const table of TABLES) {
      const allowed = new Set((await db.prepare('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=?').all(table)).map(c=>c.column_name));
      for (const row of prepared.rows[table]) {
        const columns=Object.keys(row), placeholders=columns.map(()=>'?').join(',');
        if (columns.some(column=>!/^\w+$/.test(column)||!allowed.has(column))) throw new Error('INVALID_IMPORT_COLUMN');
        await db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`).run(...columns.map(c=>row[c]));
      }
    }
    await db.exec("SELECT setval(pg_get_serial_sequence('login_audit_logs','sequence_id'), COALESCE((SELECT MAX(sequence_id) FROM login_audit_logs),1), EXISTS(SELECT 1 FROM login_audit_logs))");
  });
}
async function main() {
  const args=process.argv.slice(2), source=args[args.indexOf('--source')+1];
  if (!args.includes('--source') || !source) throw new Error('SQLITE_COPY_SOURCE_REQUIRED');
  const mapFile=args.includes('--department-map')?args[args.indexOf('--department-map')+1]:null;
  const prepared=plan(readCopy(source),mapFile?JSON.parse(fs.readFileSync(mapFile,'utf8')):{},args.includes('--allow-unassigned'));
  console.log(JSON.stringify({ mode:args.includes('--apply')?'APPLY':'DRY_RUN',ready:prepared.ready,...prepared.report },null,2));
  if (!args.includes('--apply')) return;
  process.env.DB_PROVIDER='postgres'; const db=require('./database').getDatabase();
  try { await require('./migrate-postgres').verifyMigration(db); await importRows(db,prepared); console.log('[Import] COMPLETED'); }
  finally { await db.close(); }
}
if(require.main===module)main().catch(error=>{console.error('[Import]',error.code||error.message.replace(/[^A-Z_]/g,'')||'IMPORT_FAILED');process.exitCode=1;});
module.exports={TABLES,plan,readCopy,importRows,utc};
