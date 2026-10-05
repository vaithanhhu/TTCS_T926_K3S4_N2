const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// These tests write data and images. Refuse to run in a repository or beside a working DB.
const root = path.resolve(__dirname, '../..');
if (fs.existsSync(path.join(root, '.git')) || fs.existsSync(path.join(root, 'backend/data/ats.db')) || fs.existsSync(path.join(root, '.env'))) {
  throw new Error('Run Sprint 2 tests in an isolated source/dependency copy without .git, .env or ats.db.');
}
process.env.NODE_ENV = 'test';
for (const key of ['MAIL_HOST', 'SMTP_HOST', 'MAIL_USERNAME', 'SMTP_USER', 'MAIL_PASSWORD', 'SMTP_PASSWORD']) delete process.env[key];
const config = require('../src/config/config');
assert.equal(config.DB_PATH, path.join(root, 'backend/data/ats_test.db'));
assert.equal(config.STATIC_DIR, path.join(root, 'frontend'));
for (const name of ['exceljs', 'sharp', 'nodemailer']) assert.ok(require.resolve(name).startsWith(root + path.sep));

const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const UserService = require('../src/services/userService');
const DepartmentService = require('../src/services/departmentService');
const CompetencyService = require('../src/services/competencyService');
const QuestionBankService = require('../src/services/questionBankService');
const CatalogService = require('../src/services/recruitmentCatalogService');
const RequisitionService = require('../src/services/requisitionService');
const AvatarService = require('../src/services/avatarService');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const db = getDatabase();
const users = new UserService(db), departments = new DepartmentService(db);
const competency = new CompetencyService(db), questions = new QuestionBankService(db);
const catalogs = new CatalogService(db), requisitions = new RequisitionService(db);
function assertNoOpenTransaction() { db.exec('BEGIN'); db.exec('ROLLBACK'); }
let origin, passed = 0, failed = 0;
const tokens = {};
let framework, jobTitle, department, question, source, reason, image, uiHarness;

async function test(name, action) {
  try { await action(); passed++; console.log('[PASS] ' + name); }
  catch (error) { failed++; console.error('[FAIL] ' + name, error); }
}
async function api(method, route, token, body, contentType) {
  const response = await fetch(origin + '/api/v1' + route, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}) },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function main() {
  await startServer(0);
  origin = 'http://127.0.0.1:' + server.address().port;
  await test('Startup with all six Sprint 2 services and isolated dependencies', async () => {
    for (const [role, email] of Object.entries({ admin: 'admin@company.com', hr: 'hrmanager@company.com', hiring: 'hiringmgr@company.com', recruiter: 'recruiter@company.com', interviewer: 'interviewer@company.com', candidate: 'candidate@example.com' })) {
      const res = await api('POST', '/auth/login', null, { email, password: 'Ats@123456' });
      assert.equal(res.status, 200); tokens[role] = res.data.data.token;
    }
  });
  await test('Sprint 2 APIs deny unauthenticated access', async () => {
    for (const route of ['/job-titles', '/departments', '/competency-frameworks', '/interview-questions', '/recruitment-catalogs', '/career-page']) {
      assert.equal((await api('GET', route)).status, 401, route);
    }
  });
  await test('Import template is a valid workbook and preview never writes users', async () => {
    const response = await fetch(origin + '/api/v1/admin/users/import/template', { headers: { Authorization: 'Bearer ' + tokens.admin } });
    assert.equal(response.status, 200);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet('NhanSu'); assert.ok(sheet);
    sheet.getRow(2).values = ['Import valid', 'bulk.valid@test.example', 'Engineer', 'Legacy dept', '0912345678', 'INTERVIEWER'];
    sheet.getRow(3).values = ['Invalid', 'invalid-email', '', '', '', 'UNKNOWN'];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    const preview = await api('POST', '/admin/users/import/preview', tokens.admin, buffer, 'application/octet-stream');
    assert.equal(preview.status, 200); assert.equal(preview.data.data.summary.validRows, 1); assert.equal(preview.data.data.summary.invalidRows, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, count);
    const imported = await api('POST', '/admin/users/import', tokens.admin, buffer, 'application/octet-stream');
    assert.equal(imported.status, 200); assert.equal(imported.data.data.summary.importedRows, 1); assert.equal(imported.data.data.summary.skippedRows, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, count + 1);
    assert.equal((await api('POST', '/admin/users/import', tokens.recruiter, buffer, 'application/octet-stream')).status, 403);
  });
  await test('Import rejects empty, malformed, wrong template and duplicate rows', async () => {
    assert.equal((await users.previewBulkUserImport(Buffer.alloc(0))).success, false);
    assert.equal((await users.previewBulkUserImport(Buffer.from('invalid'))).code, 'INVALID_EXCEL_FILE');
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('Wrong').addRow(['wrong']);
    assert.equal((await users.previewBulkUserImport(Buffer.from(await workbook.xlsx.writeBuffer()))).code, 'INVALID_EXCEL_TEMPLATE');
    const valid = new ExcelJS.Workbook(); await valid.xlsx.load(await users.buildBulkUserImportTemplate());
    const sheet = valid.getWorksheet('NhanSu');
    sheet.getRow(2).values = ['A', 'same@test.example']; sheet.getRow(3).values = ['B', 'SAME@test.example'];
    const res = await users.previewBulkUserImport(Buffer.from(await valid.xlsx.writeBuffer()));
    assert.equal(res.data.summary.invalidRows, 2);
  });
  await test('Import rolls back a failed row while importing the next valid row', async () => {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await users.buildBulkUserImportTemplate());
    workbook.getWorksheet('NhanSu').getRow(2).values = ['Fail', 'rollback@test.example'];
    workbook.getWorksheet('NhanSu').getRow(3).values = ['Success', 'after.rollback@test.example'];
    db.exec(`CREATE TEMP TRIGGER reject_import_role BEFORE INSERT ON user_roles WHEN NEW.user_id IN (SELECT id FROM users WHERE email = 'rollback@test.example') BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    try {
      const res = await users.importBulkUsers(Buffer.from(await workbook.xlsx.writeBuffer()));
      assert.equal(res.data.summary.importedRows, 1); assert.equal(res.data.summary.skippedRows, 1);
      assert.equal(db.prepare("SELECT id FROM users WHERE email = 'rollback@test.example'").get(), undefined);
      assert.ok(db.prepare("SELECT id FROM users WHERE email = 'after.rollback@test.example'").get());
      assertNoOpenTransaction();
    } finally { db.exec('DROP TRIGGER reject_import_role'); }
  });
  await test('Oversized Excel upload returns a structured error without connection reset', async () => {
    const res = await api('POST', '/admin/users/import/preview', tokens.admin, Buffer.alloc(5 * 1024 * 1024 + 1), 'application/octet-stream');
    assert.equal(res.data.code, 'EXCEL_FILE_TOO_LARGE'); assert.equal(res.status, 413);
  });
  await test('Profile preserves Sprint 1 response and permissive legacy phone input', async () => {
    const res = await api('PUT', '/profile', tokens.hiring, { fullName: 'Legacy profile', jobTitle: 'Lead', phoneNumber: 'legacy extension 123' });
    assert.equal(res.status, 200); assert.equal(res.data.code, 'USER_UPDATED'); assert.ok(res.data.data.user);
    assert.equal(res.data.data.user.phoneNumber, 'legacy extension 123');
  });
  await test('Sprint 2 profile validates VN phone and protects email, department and roles', async () => {
    const before = users.getUserById('usr-hiring-mgr');
    let res = await api('PUT', '/profile/personal', tokens.hiring, { fullName: 'Profile updated', jobTitle: 'Lead', phoneNumber: '+84 912 345 678', email: 'changed@test.example', departmentName: 'Changed', roles: ['ADMIN'] });
    assert.equal(res.status, 200); const user = res.data.data.user;
    assert.equal(user.email, before.email); assert.equal(user.departmentName, before.departmentName); assert.deepEqual(user.roles, before.roles); assert.equal(user.phoneNumber, '+84912345678');
    assert.equal((await api('PUT', '/profile/personal', tokens.hiring, { fullName: 'Name', phoneNumber: '123' })).status, 400);
    assert.equal((await api('PUT', '/profile/personal', tokens.hiring, { fullName: '' })).status, 400);
  });
  await test('Avatar crops JPG/PNG to square plus thumbnail', async () => {
    image = await sharp({ create: { width: 240, height: 100, channels: 3, background: '#234567' } }).png().toBuffer();
    const res = await api('POST', '/profile/avatar', tokens.hr, image, 'image/png'); assert.equal(res.status, 200);
    for (const [url, dimension] of [[res.data.data.avatarUrl, 512], [res.data.data.thumbnailUrl, 96]]) {
      const metadata = await sharp(path.join(root, 'frontend', url)).metadata(); assert.equal(metadata.width, dimension); assert.equal(metadata.height, dimension);
    }
    const jpeg = await sharp(image).jpeg().toBuffer(); assert.equal((await api('POST', '/profile/avatar', tokens.hr, jpeg, 'image/jpeg')).status, 200);
  });
  await test('Avatar rejects invalid type/content/empty/oversize and unsafe IDs', async () => {
    const service = new AvatarService(); assert.equal(service.sanitizeUserId('../usr-admin'), '');
    assert.equal((await service.saveAvatar('usr-admin', Buffer.alloc(0), 'image/png')).code, 'EMPTY_AVATAR');
    assert.equal((await api('POST', '/profile/avatar', tokens.hr, image, 'image/gif')).status, 400);
    assert.equal((await api('POST', '/profile/avatar', tokens.hr, Buffer.from('not an image'), 'image/png')).status, 400);
    assert.equal((await api('POST', '/profile/avatar', tokens.hr, Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png')).status, 413);
    assert.equal((await api('POST', '/profile/avatar', null, image, 'image/png')).status, 401);
  });
  await test('Department creation, multi-level tree, cycle and required manager validation', async () => {
    let res = await api('POST', '/departments', tokens.hr, { code: 'TEST-DEPT', name: 'Test department', managerId: 'usr-hiring-mgr' });
    assert.equal(res.status, 201); department = res.data.data;
    const child = departments.createDepartment({ code: 'TEST-CHILD', name: 'Child', parentId: department.id, managerId: 'usr-hr-mgr' }); assert.equal(child.success, true);
    assert.equal(departments.updateDepartment(department.id, { parentId: child.data.id }).code, 'DEPARTMENT_TREE_CYCLE');
    assert.equal(departments.updateDepartment(department.id, { managerId: null }).success, false);
    assert.equal(departments.updateDepartment(department.id, { name: 123 }).success, false);
    assert.equal(departments.createDepartment({ code: 'MISSING', name: 'Missing' }).success, false);
    assert.equal(departments.createDepartment({ code: 'BAD', name: 'Bad', managerId: 'unknown' }).success, false);
    assert.ok(departments.getDepartments().tree.find(row => row.id === department.id).children.length);
  });
  await test('Hiring Manager reads minimal requisition choices without department administration rights', async () => {
    const options = await api('GET', '/requisitions/options', tokens.hiring); assert.equal(options.status, 200); assert.ok(options.data.tree.length);
    assert.equal(JSON.stringify(options.data).includes('manager'), false);
    assert.equal((await api('GET', '/departments', tokens.hiring)).status, 403);
    assert.equal((await api('POST', '/departments', tokens.hiring, { code: 'NO' })).status, 403);
    assert.equal((await api('GET', '/requisitions/options', tokens.candidate)).status, 403);
  });
  await test('Competency framework CRUD and weights total 100', async () => {
    const res = await api('POST', '/competency-frameworks', tokens.hr, { code: 'TEST-CF', name: 'Test framework', criteria: [{ name: 'Skill', weight: 60 }, { name: 'Communication', weight: 40 }] });
    assert.equal(res.status, 201); framework = res.data.data;
    assert.equal(competency.createFramework({ code: 'BAD-CF', name: 'Bad', criteria: [{ name: 'Skill', weight: 10 }] }).success, false);
    assert.equal(competency.validateCriteria([null]).success, false);
    assert.equal(competency.updateFramework(framework.id, { criteria: {} }).success, false);
    assert.equal(competency.updateFramework(framework.id, { code: '' }).success, false);
    assert.equal(competency.validateCriteria([{ id: 'same', name: 'A', weight: 50 }, { id: 'same', name: 'B', weight: 50 }]).success, false);
    assert.equal((await api('POST', '/competency-frameworks', tokens.interviewer, {})).status, 403);
  });
  await test('S2-05 job title creation includes code/name/level/min/max with optional framework', async () => {
    const res = await api('POST', '/job-titles', tokens.hr, { code: 'TEST-JOB', name: 'Engineer', level: 'Senior', minSalary: 20000000, maxSalary: 40000000, frameworkId: framework.id });
    assert.equal(res.status, 201); jobTitle = res.data.data;
    assert.equal(jobTitle.level, 'Senior'); assert.equal(jobTitle.minSalary, 20000000); assert.equal(jobTitle.maxSalary, 40000000);
    const standalone = await api('POST', '/job-titles', tokens.hr, { code: 'STANDALONE', name: 'Standalone', level: 'Junior', minSalary: 0, maxSalary: 0 });
    assert.equal(standalone.status, 201); assert.equal(standalone.data.data.framework, null);
  });
  await test('S2-05 salary validation: missing, blank, negative, fractional, inverted, invalid type', async () => {
    const valid = { code: 'BAD-SALARY', name: 'Bad salary', level: 'Senior', minSalary: 1, maxSalary: 2 };
    for (const change of [{ level: '' }, { minSalary: undefined }, { minSalary: '' }, { minSalary: -1 }, { maxSalary: 0 }, { minSalary: 1.5 }, { minSalary: true }, { maxSalary: 'abc' }]) {
      assert.equal((await api('POST', '/job-titles', tokens.hr, { ...valid, ...change })).status, 400, JSON.stringify(change));
    }
    assert.equal((await api('POST', '/job-titles', tokens.hr, { ...valid, code: jobTitle.code })).status, 409);
    assert.equal((await api('POST', '/job-titles', tokens.hr, { ...valid, frameworkId: 'unknown' })).status, 400);
  });
  await test('Only HR sees/writes salary; Admin metadata updates neither expose nor erase it', async () => {
    const admin = await api('GET', '/job-titles', tokens.admin), hr = await api('GET', '/job-titles', tokens.hr);
    assert.equal(admin.data.canViewSalary, false); assert.equal(JSON.stringify(admin.data).includes('minSalary'), false); assert.equal(hr.data.canViewSalary, true);
    assert.equal((await api('PUT', '/job-titles/' + jobTitle.id, tokens.admin, { minSalary: 1, maxSalary: 2 })).status, 403);
    const updated = await api('PUT', '/job-titles/' + jobTitle.id, tokens.admin, { name: 'Engineer renamed' }); assert.equal(updated.status, 200); assert.equal('minSalary' in updated.data.data, false);
    assert.equal(db.prepare('SELECT min_salary FROM job_titles WHERE id = ?').get(jobTitle.id).min_salary, 20000000);
    assert.equal((await api('GET', '/job-titles', tokens.interviewer)).status, 403);
    assert.equal((await api('POST', '/job-titles', tokens.admin, { code: 'NO', name: 'No', level: 'Senior', minSalary: 1, maxSalary: 2 })).status, 403);
    const result = await api('PUT', '/job-titles/' + jobTitle.id, tokens.hr, { level: 'Lead', minSalary: 25000000, maxSalary: 45000000 }); assert.equal(result.status, 200); assert.equal(result.data.data.level, 'Lead');
    assert.equal(JSON.stringify((await api('GET', '/job-titles/' + jobTitle.id + '/framework', tokens.admin)).data).includes('minSalary'), false);
    db.prepare("UPDATE competency_frameworks SET status='INACTIVE' WHERE id=?").run(framework.id);
    try { assert.equal((await api('PUT', '/job-titles/' + jobTitle.id, tokens.admin, { name: 'Historical title still editable' })).status, 200); }
    finally { db.prepare("UPDATE competency_frameworks SET status='ACTIVE' WHERE id=?").run(framework.id); }
  });
  await test('Legacy job titles with unspecified level/salary remain readable and editable', async () => {
    db.prepare("INSERT INTO job_titles (id,code,name,status) VALUES ('jt-legacy','LEGACY','Legacy job','ACTIVE')").run();
    const res = await api('PUT', '/job-titles/jt-legacy', tokens.admin, { name: 'Legacy renamed' }); assert.equal(res.status, 200);
    const row = db.prepare("SELECT * FROM job_titles WHERE id = 'jt-legacy'").get(); assert.equal(row.min_salary, null); assert.equal(row.max_salary, null);
  });
  await test('Question bank CRUD, filters and validation', async () => {
    const res = await api('POST', '/interview-questions', tokens.hr, { criterionId: framework.criteria[0].id, questionText: 'Explain your design', goodAnswerHint: 'Discuss tradeoffs', difficulty: 'MEDIUM' });
    assert.equal(res.status, 201); question = res.data.data;
    const filtered = await api('GET', '/interview-questions?jobTitleId=' + jobTitle.id + '&criterionId=' + framework.criteria[0].id, tokens.interviewer); assert.equal(filtered.status, 200); assert.ok(filtered.data.questions.some(item => item.id === question.id));
    assert.equal(questions.updateQuestion(question.id, { questionText: '' }).success, false);
    assert.equal(questions.updateQuestion(question.id, { questionText: 123 }).success, false);
    assert.equal(questions.updateQuestion(question.id, { difficulty: 'UNKNOWN' }).success, false);
    assert.equal(questions.createQuestion({ criterionId: 'unknown', questionText: 'Question', goodAnswerHint: 'Hint', difficulty: 'EASY' }).success, false);
    assert.equal((await api('PUT', '/interview-questions/' + question.id, tokens.interviewer, { questionText: 'Changed' })).status, 403);
    assert.equal((await api('PUT', '/interview-questions/' + question.id, tokens.hr, { goodAnswerHint: 'Updated hint' })).status, 200);
  });
  await test('Framework refuses deleting referenced criteria and preserves all data', async () => {
    const before = competency.getFrameworkById(framework.id);
    const res = competency.updateFramework(framework.id, { name: 'Should not save', criteria: [{ name: 'Replacement', weight: 100 }] });
    assert.equal(res.code, 'COMPETENCY_CRITERION_IN_USE'); assert.deepEqual(competency.getFrameworkById(framework.id), before);
    assert.equal(competency.updateFramework(framework.id, { criteria: [{ id: 'foreign', name: 'Invalid', weight: 100 }] }).success, false);
    const success = competency.updateFramework(framework.id, { criteria: before.criteria.map(item => ({ ...item, name: item.name + ' updated' })) }); assert.equal(success.success, true);
    assert.equal(questions.getQuestionById(question.id).criterion.id, framework.criteria[0].id);
  });
  await test('Recruitment catalogs CRUD/order/types and write permissions', async () => {
    const res = await api('POST', '/recruitment-catalogs', tokens.hr, { type: 'CANDIDATE_SOURCE', code: 'TEST-SOURCE', name: 'Test source', displayOrder: 1 }); assert.equal(res.status, 201); source = res.data.data;
    reason = catalogs.createItem({ type: 'REJECTION_REASON', code: 'TEST-REASON', name: 'Test reason' }).data;
    assert.equal(catalogs.createItem({ type: 'WORK_MODE', code: 'BAD', name: 'Bad', displayOrder: 'abc' }).success, false);
    assert.equal(catalogs.createItem({ type: 'INVALID', code: 'BAD', name: 'Bad' }).success, false);
    assert.equal(catalogs.updateItem(source.id, { name: '' }).success, false);
    assert.equal(catalogs.updateItem(source.id, { name: false }).success, false);
    assert.equal(catalogs.reorderItems('CANDIDATE_SOURCE', [source.id, source.id]).success, false);
    assert.equal(catalogs.reorderItems('CANDIDATE_SOURCE', [reason.id]).success, false);
    assert.equal(catalogs.reorderItems('CANDIDATE_SOURCE', [source.id]).success, true);
    assert.equal((await api('POST', '/recruitment-catalogs', tokens.recruiter, {})).status, 403);
  });
  await test('Catalog references block deletion and legacy stage calls preserve reasons/notes', async () => {
    const created = requisitions.createCandidate({ fullName: 'Catalog candidate', email: 'candidate@test.example', sourceId: source.id }); assert.equal(created.success, true);
    assert.equal(catalogs.deleteItem(source.id).code, 'CATALOG_ITEM_IN_USE');
    let res = await api('PUT', '/candidates/' + created.data.id + '/stage', tokens.recruiter, { stage: 'REJECTED', notes: 'Reason note', rejectionReasonId: reason.id }); assert.equal(res.status, 200);
    assert.equal(catalogs.deleteItem(reason.id).code, 'CATALOG_ITEM_IN_USE');
    res = await api('PUT', '/candidates/' + created.data.id + '/stage', tokens.hiring, { stage: 'REJECTED', notes: 'Legacy ignored note' }); assert.equal(res.status, 200);
    const row = db.prepare('SELECT rejection_reason_id,notes FROM candidates WHERE id = ?').get(created.data.id); assert.equal(row.rejection_reason_id, reason.id); assert.equal(row.notes, 'Reason note');
    assert.equal((await api('PUT', '/candidates/' + created.data.id + '/stage', tokens.hiring, { stage: 'REJECTED', rejectionReasonId: reason.id })).status, 403);
    assert.equal(requisitions.createCandidate({ fullName: 'Bad', email: 'bad@test.example', sourceId: reason.id }).success, false);
  });
  await test('Career page uploads, saves, public output and invalid URL rejection', async () => {
    const media = await api('POST', '/career-page/media?kind=logo', tokens.hr, image, 'image/png'); assert.equal(media.status, 200);
    const saved = await api('PUT', '/career-page', tokens.hr, { introduction: '<script>plain text</script>', logoUrl: media.data.data.url }); assert.equal(saved.status, 200);
    const publicPage = await api('GET', '/public/career-page'); assert.equal(publicPage.status, 200); assert.equal(publicPage.data.data.logoUrl, media.data.data.url);
    assert.equal((await api('PUT', '/career-page', tokens.hr, { introduction: 'Updated' })).data.data.logoUrl, media.data.data.url);
    assert.equal((await api('PUT', '/career-page', tokens.hr, { logoUrl: '/public/company/../../js/app.js' })).status, 400);
    assert.equal((await api('PUT', '/career-page', tokens.hr, { logoUrl: false })).status, 400);
    assert.equal((await api('PUT', '/career-page', tokens.recruiter, {})).status, 403);
    assert.equal((await api('POST', '/career-page/media?kind=logo', tokens.hr, Buffer.from('invalid'), 'image/png')).status, 400);
  });
  await test('Sprint 1 requisition payload/response and Hiring Manager are preserved', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { title: 'Legacy position', departmentName: 'Unregistered legacy department', hiringManagerId: 'usr-hiring-mgr', recruiterId: 'usr-recruiter', headcount: 2 });
    assert.equal(res.status, 201); assert.deepEqual(Object.keys(res.data.data).sort(), ['id','code','title','departmentName','headcount','status'].sort());
    let req = requisitions.getRequisitionById(res.data.data.id); assert.equal(req.hiringManagerId, 'usr-hiring-mgr');
    const updated = requisitions.updateRequisition(req.id, { departmentName: 'Another legacy department' }); assert.equal(updated.success, true);
    req = requisitions.getRequisitionById(req.id); assert.equal(req.hiringManagerId, 'usr-hiring-mgr'); assert.equal(req.departmentName, 'Another legacy department');
    assert.equal(requisitions.reassignHandover(req.id, 'usr-recruiter-2', 'Legacy handover').success, true);
    assert.equal(requisitions.getRequisitionById(req.id).recruiterId, 'usr-recruiter-2');
  });
  await test('Sprint 2 requisition references coexist with old requests and block department deletion', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { title: 'New references', departmentId: department.id, jobTitleId: jobTitle.id }); assert.equal(res.status, 201);
    assert.equal(requisitions.getRequisitionById(res.data.data.id).jobTitleId, jobTitle.id);
    assert.equal(departments.deleteDepartment(department.id).code, 'DEPARTMENT_HAS_OPEN_REQUISITIONS');
    assert.equal(departments.deactivateDepartment(department.id).success, true);
    assert.equal((await api('POST', '/requisitions', tokens.hiring, { title: 'Inactive', departmentId: department.id })).status, 400);
    assert.equal((await api('POST', '/requisitions', tokens.hiring, { title: 'Legacy still works', departmentName: department.name })).status, 201);
    assert.equal((await api('POST', '/requisitions', tokens.hiring, { title: 'Invalid', departmentId: 'unknown' })).status, 400);
  });
  await test('Deleting a department manager leaves user, roles and sessions intact', async () => {
    const count = table => db.prepare('SELECT COUNT(*) AS count FROM ' + table + ' WHERE user_id = ?').get('usr-hiring-mgr').count;
    const before = { roles: count('user_roles'), sessions: count('sessions'), user: users.getUserById('usr-hiring-mgr') };
    const res = users.deleteUser('usr-hiring-mgr', { id: 'usr-admin' }); assert.equal(res.code, 'USER_IS_DEPARTMENT_MANAGER');
    assert.equal(count('user_roles'), before.roles); assert.equal(count('sessions'), before.sessions); assert.deepEqual(users.getUserById('usr-hiring-mgr'), before.user); assertNoOpenTransaction();
    const apiRes = await api('DELETE', '/admin/users/usr-hiring-mgr', tokens.admin); assert.equal(apiRes.status, 409);
  });
  await test('Deletion rolls back on late FK/SQL failure and ordinary users remain deletable', async () => {
    const created = users.createUser({ fullName: 'Delete test', email: 'delete@test.example' }).data.user;
    db.exec(`CREATE TEMP TRIGGER fail_user_delete BEFORE DELETE ON users WHEN OLD.email = 'delete@test.example' BEGIN SELECT RAISE(ABORT, 'late failure'); END`);
    try { assert.throws(() => users.deleteUser(created.id, { id: 'usr-admin' })); assert.ok(users.getUserById(created.id)); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_roles WHERE user_id = ?').get(created.id).count, 1); }
    finally { db.exec('DROP TRIGGER fail_user_delete'); }
    assert.equal(users.deleteUser(created.id, { id: 'usr-admin' }).success, true);
  });
  await test('Old job title schema migrates additively and idempotently without inventing salaries', async () => {
    const legacyPath = path.join(root, 'backend/data/legacy_schema_test.db');
    const { DatabaseSync } = require('node:sqlite');
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE job_titles (id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, framework_id TEXT, status TEXT DEFAULT 'ACTIVE', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))); INSERT INTO job_titles (id,code,name) VALUES ('old','OLD','Old title');"); legacy.close();
    const script = `const assert=require('node:assert/strict'); const db=require('./backend/src/db/database').getDatabase(${JSON.stringify(legacyPath)}); const row=db.prepare("SELECT * FROM job_titles WHERE id='old'").get(); assert.equal(row.name,'Old title'); assert.equal(row.min_salary,null); assert.equal(row.max_salary,null); assert.equal(row.level,null); db.close();`;
    for (let i = 0; i < 2; i++) { const res = spawnSync(process.execPath, ['-e', script], { cwd: root, env: process.env, encoding: 'utf8' }); assert.equal(res.status, 0, res.stderr); }
  });
  await test('Real create-user UI callback sends all fields using the backend contract', async () => {
    const html = require('./helpers/frontendFixture').html();
    const source = require('./helpers/frontendFixture').source();
    const nodes = new Map(), storage = new Map(); let ready;
    const makeNode = () => ({ value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, children: [], files: [], disabled: false,
      listeners: {}, classList: { values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, toggle(value, force) { const present = force === undefined ? !this.values.has(value) : force; if (present) this.values.add(value); else this.values.delete(value); }, contains(value) { return this.values.has(value); } },
      addEventListener(name, fn) { this.listeners[name] = fn; }, querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, getAttribute() { return ''; }, appendChild(node) { this.children.push(node); }, remove() {}, focus() {}, reset() {}, contains() { return false; } });
    for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], makeNode());
    const document = { getElementById: id => nodes.get(id) || null, querySelectorAll: () => [], querySelector: () => null, createElement: makeNode,
      addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, body: makeNode(), documentElement: makeNode() };
    let captured;
    const fallback = async () => ({ ok: false, data: { success: false } });
    const apiMock = new Proxy({
      getJobTitlesApi: async () => ({ ok: true, data: { success: true, jobTitles: [{ id: 'title-engineer', name: 'Engineer', status: 'ACTIVE' }] } }),
      getDepartmentsApi: async () => ({ ok: true, data: { success: true, departments: [{ id: 'dept-ui', name: 'UI department', status: 'ACTIVE' }] } }),
      createUserApi: async (_, payload) => { captured = payload; return { ok: false, data: { success: false, message: 'Captured' } }; }
    }, { get: (object, key) => object[key] || fallback });
    const context = { document, window: { ATS_API: apiMock, addEventListener() {}, location: { search: '', pathname: '/' } },
      sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      URL, URLSearchParams, console, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {}, navigator: {}, confirm: () => true };
    // Expose existing closure functions only inside the VM; the application file is untouched.
    const instrumented = source.replace('  loadPublicCareerPage();', '  window.__S2_TEST__ = { loadCompetencies, resetJobTitleForm, renderCareerPagePublicContent, performLogout };\n  loadPublicCareerPage();');
    vm.runInNewContext(instrumented, context); ready();
    uiHarness = { context, nodes, storage, apiMock, makeNode };
    storage.set('ats_token', tokens.admin);
    await nodes.get('open-create-user-modal-btn').listeners.click();
    for (const [id, value] of Object.entries({ 'create-user-fullname': 'UI User', 'create-user-email': 'ui@test.example', 'create-user-jobtitle': 'title-engineer', 'create-user-department': 'dept-ui', 'create-user-phone': '0912345678', 'create-user-role': 'RECRUITER' })) nodes.get(id).value = value;
    await nodes.get('create-user-form').listeners.submit({ preventDefault() {} });
    assert.ok(captured, 'UI must reach the API rather than catch ReferenceError');
    assert.equal(captured.departmentName, 'UI department'); assert.equal(captured.phoneNumber, '0912345678'); assert.equal(captured.roleCode, 'RECRUITER');
    const res = await api('POST', '/admin/users', tokens.admin, captured); assert.equal(res.status, 201); assert.equal(res.data.data.user.departmentName, 'UI department'); assert.deepEqual(res.data.data.user.roles, ['RECRUITER']);
  });
  await test('Job title UI submits level/salary, rejects inverted range and hides salary for Admin', async () => {
    const { context, nodes, storage, apiMock } = uiHarness;
    storage.set('ats_token', tokens.hr);
    apiMock.getCompetencyFrameworksApi = async token => ({ ok: true, data: (await api('GET', '/competency-frameworks', token)).data });
    apiMock.getJobTitlesApi = async token => ({ ok: true, data: (await api('GET', '/job-titles', token)).data });
    let payload;
    apiMock.createJobTitleApi = async (_, data) => { payload = data; return { ok: false, data: { message: 'Captured' } }; };
    await context.window.__S2_TEST__.loadCompetencies();
    assert.equal(nodes.get('job-title-salary-fields').disabled, false);
    for (const [id, value] of Object.entries({ 'job-title-code-input': 'UI-TITLE', 'job-title-name-input': 'UI title', 'job-title-level-input': 'Senior', 'job-title-min-salary-input': '100', 'job-title-max-salary-input': '200', 'job-title-framework-select': '' })) nodes.get(id).value = value;
    await nodes.get('job-title-form').listeners.submit({ preventDefault() {} });
    assert.ok(payload); assert.equal(payload.level, 'Senior'); assert.equal(payload.minSalary, 100); assert.equal(payload.maxSalary, 200);
    payload = null; nodes.get('job-title-min-salary-input').value = '300';
    await nodes.get('job-title-form').listeners.submit({ preventDefault() {} }); assert.equal(payload, null);
    await context.window.__S2_TEST__.performLogout(false);
    assert.equal(nodes.get('job-title-min-salary-input').value, ''); assert.equal(nodes.get('job-title-max-salary-input').value, '');
    assert.equal(nodes.get('job-title-list').innerHTML.includes('Dải lương:'), false);
    storage.set('ats_token', tokens.admin); await context.window.__S2_TEST__.loadCompetencies();
    assert.equal(nodes.get('job-title-salary-fields').disabled, true); assert.equal(nodes.get('job-title-salary-fields').classList.contains('hidden'), true);
    assert.equal(nodes.get('job-title-list').innerHTML.includes('Dải lương:'), false);
  });
  await test('Existing candidate stage UI omits new catalog fields when no reason is selected', async () => {
    const { nodes, storage, apiMock } = uiHarness;
    storage.set('ats_token', tokens.hiring);
    nodes.get('cand-detail-id').value = 'cand-ui'; nodes.get('cand-detail-change-stage-select').value = 'REJECTED';
    nodes.get('cand-detail-rejection-reason-select').value = '';
    let argumentsSent;
    apiMock.updateCandidateStageApi = async (...args) => { argumentsSent = args; return { ok: false, data: { message: 'Captured' } }; };
    await nodes.get('cand-detail-save-stage-btn').listeners.click();
    assert.ok(argumentsSent); assert.equal(argumentsSent[3], undefined); assert.equal(argumentsSent[4], undefined);
  });
  await test('Career preview and public rendering use the same function and keep introduction as text', async () => {
    const { context, makeNode } = uiHarness;
    const preview = makeNode(), publicView = makeNode();
    const settings = { introduction: '<script>text only</script>', logoUrl: '/public/company/logo-test.png', heroImageUrl: '/public/company/hero-test.png' };
    context.window.__S2_TEST__.renderCareerPagePublicContent(preview, settings);
    context.window.__S2_TEST__.renderCareerPagePublicContent(publicView, settings);
    const previewBody = preview.children[0].children[1];
    assert.equal(previewBody.children[2].textContent, settings.introduction); assert.equal(previewBody.children[2].innerHTML, '');
    assert.equal(JSON.stringify(preview.children), JSON.stringify(publicView.children));
  });
  await test('Frontend API preserves the stage-only legacy payload', async () => {
    let sent;
    const context = { window: { location: { protocol: 'https:', hostname: 'ats.example', port: '' } }, URLSearchParams,
      fetch: async (url, options) => { sent = JSON.parse(options.body); return { status: 200, ok: true, json: async () => ({ success: true }) }; } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/js/api.js'), 'utf8'), context);
    await context.window.ATS_API.updateCandidateStageApi('token', 'candidate', 'NEW'); assert.deepEqual(sent, { stage: 'NEW' });
    await context.window.ATS_API.updateCandidateStageApi('token', 'candidate', 'REJECTED', 'Note', reason.id); assert.equal(sent.rejectionReasonId, reason.id);
  });
  console.log('SPRINT2_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed }));
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
