const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// Requisitions, fixtures and migrations must never touch the working database.
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run S2-10 tests in an isolated source/dependency copy without .git, .env or ats.db.');
}
process.env.NODE_ENV = 'test';
for (const key of ['MAIL_HOST', 'SMTP_HOST', 'MAIL_USERNAME', 'SMTP_USER', 'MAIL_PASSWORD', 'SMTP_PASSWORD']) delete process.env[key];
const config = require('../src/config/config');
assert.equal(config.DB_PATH, path.join(root, 'backend/data/ats_test.db'));
for (const name of ['exceljs', 'sharp', 'nodemailer']) assert.ok(require.resolve(name).startsWith(root + path.sep));
const { server, startServer } = require('../src/server');
const db = require('../src/db/database').getDatabase();
const RequisitionService = require('../src/services/requisitionService');
const service = new RequisitionService(db);
const tokens = {};
let origin, job, department, foreignDepartment, draft, valid, ui;
let passed = 0, failed = 0;
async function test(name, action) {
  try { await action(); passed++; console.log('[PASS] ' + name); }
  catch (error) { failed++; console.error('[FAIL] ' + name, error); }
}
async function api(method, route, token = tokens.hiring, body) {
  const res = await fetch(origin + '/api/v1' + route, { method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}
const create = changes => api('POST', '/requisitions', tokens.hiring, { ...valid, ...changes });
const rejected = async (changes, code) => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM requisitions').get().n;
  const res = await create(changes); assert.equal(res.status, 400, JSON.stringify(res.data));
  if (code) assert.equal(res.data.code, code);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requisitions').get().n, before);
};
function dayOffset(offset) {
  const date = new Date(service.businessDate() + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function main() {
  await startServer(0); origin = 'http://127.0.0.1:' + server.address().port;
  for (const [role, email] of Object.entries({ hiring: 'hiringmgr@company.com', hr: 'hrmanager@company.com', recruiter: 'recruiter@company.com', interviewer: 'interviewer@company.com', admin: 'admin@company.com', candidate: 'candidate@example.com' })) {
    const res = await api('POST', '/auth/login', null, { email, password: 'Ats@123456' });
    assert.equal(res.status, 200); tokens[role] = res.data.data.token;
  }
  let res = await api('POST', '/job-titles', tokens.hr, { code: 'S210-TITLE', name: 'Kỹ sư S2-10', level: 'Senior', minSalary: 15000000, maxSalary: 25000000 });
  assert.equal(res.status, 201); job = res.data.data;
  res = await api('POST', '/departments', tokens.hr, { code: 'S210-DEPT', name: 'Bộ phận S2-10', managerId: 'usr-hiring-mgr' });
  assert.equal(res.status, 201); department = res.data.data;
  res = await api('POST', '/departments', tokens.hr, { code: 'S210-OTHER', name: 'Bộ phận khác', managerId: 'usr-hr-mgr' });
  assert.equal(res.status, 201); foreignDepartment = res.data.data;
  valid = { formVersion: 'S2-10', jobTitleId: job.id, departmentId: department.id, headcount: 2,
    recruitmentReason: 'REPLACEMENT', proposedSalaryMin: 18000000, proposedSalaryMax: 23000000,
    neededDate: service.businessDate(), jobDescription: '  Thiết kế API\nDuy trì hệ thống.  ', candidateRequirements: '  Node.js\nSQLite\nKỹ năng làm việc nhóm.  ' };

  await test('01 Valid requisition is persisted in the existing OPEN workflow', async () => {
    const res = await create({}); assert.equal(res.status, 201); assert.equal(res.data.data.status, 'OPEN');
    assert.equal(res.data.data.title, job.name); assert.equal(db.prepare('SELECT s210_version FROM requisitions WHERE id=?').get(res.data.data.id).s210_version, 1);
  });
  await test('02 Job title must reference an active S2-05 title; framework is optional', async () => {
    assert.equal(job.framework, null); assert.equal((await create({})).status, 201);
    await rejected({ jobTitleId: 'not-a-title' }, 'INVALID_JOB_TITLE');
    db.prepare("UPDATE job_titles SET status='INACTIVE' WHERE id=?").run(job.id);
    try { await rejected({}, 'INVALID_JOB_TITLE'); } finally { db.prepare("UPDATE job_titles SET status='ACTIVE' WHERE id=?").run(job.id); }
  });
  await test('03 Department must reference an active department', async () => {
    await rejected({ departmentId: 'not-a-department' }, 'INVALID_DEPARTMENT');
    db.prepare("UPDATE departments SET status='INACTIVE' WHERE id=?").run(department.id);
    try { await rejected({}, 'INVALID_DEPARTMENT'); } finally { db.prepare("UPDATE departments SET status='ACTIVE' WHERE id=?").run(department.id); }
  });
  await test('04 Positive integer headcount including numeric strings is accepted', async () => {
    for (const headcount of [1, 501, '3']) { const res = await create({ headcount }); assert.equal(res.status, 201); assert.equal(res.data.data.headcount, Number(headcount)); }
  });
  await test('05 Zero headcount is rejected', () => rejected({ headcount: 0 }, 'INVALID_HEADCOUNT'));
  await test('06 Negative headcount is rejected', () => rejected({ headcount: -1 }, 'INVALID_HEADCOUNT'));
  await test('07 Replacement reason is accepted', async () => assert.equal((await create({ recruitmentReason: 'REPLACEMENT' })).status, 201));
  await test('08 New headcount reason is accepted', async () => assert.equal((await create({ recruitmentReason: 'NEW_HEADCOUNT' })).status, 201));
  await test('09 Other recruitment reasons are rejected by the backend', () => rejected({ recruitmentReason: 'OTHER' }, 'INVALID_RECRUITMENT_REASON'));
  await test('10 Salary inside or exactly on the standard range needs no justification', async () => {
    for (const range of [{}, { proposedSalaryMin: 15000000, proposedSalaryMax: 25000000 }]) assert.equal((await create(range)).status, 201);
  });
  await test('11 Minimum below standard without justification is rejected', async () => {
    for (const salaryJustification of [undefined, null, '', '   \n ']) await rejected({ proposedSalaryMin: 14000000, salaryJustification }, 'SALARY_JUSTIFICATION_REQUIRED');
  });
  await test('12 Maximum above standard without justification is rejected', () => rejected({ proposedSalaryMax: 30000000 }, 'SALARY_JUSTIFICATION_REQUIRED'));
  await test('13 Outside salary with justification is accepted and preserved', async () => {
    const res = await create({ proposedSalaryMin: 14000000, proposedSalaryMax: 30000000, salaryJustification: 'Năng lực chuyên biệt' });
    assert.equal(res.status, 201); assert.equal(res.data.data.salaryJustification, 'Năng lực chuyên biệt');
  });
  await test('14 Inverted proposed salary range is rejected', () => rejected({ proposedSalaryMin: 24000000, proposedSalaryMax: 18000000 }, 'INVALID_PROPOSED_SALARY_RANGE'));
  await test('15 Yesterday is rejected', () => rejected({ neededDate: dayOffset(-1) }, 'NEEDED_DATE_IN_PAST'));
  await test('16 Today in Vietnam is accepted', async () => assert.equal((await create({ neededDate: service.businessDate() })).status, 201));
  await test('17 A future needed date is accepted', async () => assert.equal((await create({ neededDate: dayOffset(3) })).status, 201));
  await test('18 Entire authored job description is stored and read back', async () => {
    const res = await create({}); const read = await api('GET', '/requisitions/' + res.data.data.id); assert.equal(read.data.data.jobDescription, valid.jobDescription);
  });
  await test('19 Entire authored candidate requirements are stored and read back', async () => {
    const res = await create({}); assert.equal(db.prepare('SELECT candidate_requirements FROM requisitions WHERE id=?').get(res.data.data.id).candidate_requirements, valid.candidateRequirements);
  });
  await test('20 Incomplete and empty DRAFT can be persisted without invented data', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' }); assert.equal(res.status, 201); draft = res.data.data;
    assert.equal(draft.status, 'DRAFT'); assert.equal(draft.headcount, null); assert.equal(draft.jobTitleId, null); assert.equal(draft.neededDate, null);
  });
  await test('21 Owner reads DRAFT through the existing detail and list APIs', async () => {
    const read = await api('GET', '/requisitions/' + draft.id); assert.equal(read.status, 200); assert.equal(read.data.data.status, 'DRAFT');
    const list = await api('GET', '/requisitions?status=DRAFT'); assert.ok(list.data.items.some(row => row.id === draft.id));
  });
  await test('22 Partial DRAFT update keeps existing fields and remains editable', async () => {
    let res = await api('PUT', '/requisitions/' + draft.id, tokens.hiring, { jobDescription: 'Nháp\nđang viết', headcount: 2 }); assert.equal(res.status, 200);
    res = await api('PUT', '/requisitions/' + draft.id, tokens.hiring, { candidateRequirements: 'Yêu cầu nháp' }); assert.equal(res.status, 200);
    assert.equal(res.data.data.jobDescription, 'Nháp\nđang viết'); assert.equal(res.data.data.headcount, 2);
  });
  await test('23 Complete DRAFT transitions to existing OPEN without adding approval steps', async () => {
    const res = await api('PUT', '/requisitions/' + draft.id, tokens.hiring, { ...valid, status: 'OPEN' }); assert.equal(res.status, 200); assert.equal(res.data.data.status, 'OPEN');
    assert.equal(res.data.data.jobTitleId, job.id);
  });
  await test('24 Completing DRAFT missing any mandatory field is rejected atomically', async () => {
    for (const key of ['jobTitleId', 'departmentId', 'headcount', 'recruitmentReason', 'proposedSalaryMin', 'proposedSalaryMax', 'neededDate', 'jobDescription', 'candidateRequirements']) {
      const empty = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' });
      const before = service.getRequisitionById(empty.data.data.id);
      const res = await api('PUT', '/requisitions/' + before.id, tokens.hiring, { ...valid, status: 'OPEN', [key]: null }); assert.equal(res.status, 400, key);
      assert.deepEqual(service.getRequisitionById(before.id), before);
    }
  });
  await test('25 Hiring Manager uses minimal choices and only managed departments', async () => {
    const options = await api('GET', '/requisitions/options'); assert.equal(options.status, 200);
    assert.ok(options.data.jobTitles.some(row => row.id === job.id)); assert.ok(options.data.s210Departments.some(row => row.id === department.id));
    assert.ok(!options.data.s210Departments.some(row => row.id === foreignDepartment.id));
    assert.equal((await api('POST', '/requisitions', tokens.hiring, { ...valid, departmentId: foreignDepartment.id })).status, 403);
    assert.equal((await api('GET', '/departments')).status, 403); assert.equal((await api('POST', '/job-titles', tokens.hiring, {})).status, 403);
  });
  await test('26 Roles without create/draft-write permission get 403; unauthenticated gets 401', async () => {
    for (const role of ['recruiter', 'interviewer', 'admin']) assert.equal((await api('POST', '/requisitions', tokens[role], valid)).status, 403);
    assert.equal((await api('POST', '/requisitions', null, valid)).status, 401);
    const empty = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' });
    assert.equal((await api('PUT', '/requisitions/' + empty.data.data.id, tokens.recruiter, { title: 'No access' })).status, 403);
  });
  await test('27 Legacy requisition request/response, manager and handover remain compatible', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { title: 'Legacy title', departmentName: 'Legacy free text', headcount: 2, hiringManagerId: 'usr-hiring-mgr' });
    assert.equal(res.status, 201); assert.deepEqual(Object.keys(res.data.data).sort(), ['id', 'code', 'title', 'departmentName', 'headcount', 'status'].sort());
    assert.equal(service.getRequisitionById(res.data.data.id).hiringManagerId, 'usr-hiring-mgr');
    assert.equal(service.updateRequisition(res.data.data.id, { departmentName: 'Changed legacy name' }).success, true);
    assert.equal(service.reassignHandover(res.data.data.id, 'usr-recruiter', 'Legacy handover').success, true);
    const legacyS2 = await api('POST', '/requisitions', tokens.hiring, { title: 'Old department reference', departmentId: department.id }); assert.equal(legacyS2.status, 201);
  });
  await test('28 Backend reads current standard salary directly from S2-05, never from client', async () => {
    db.prepare('UPDATE job_titles SET min_salary=20000000 WHERE id=?').run(job.id);
    try { await rejected({ standardMin: 0, standardMax: 999999999 }, 'SALARY_JUSTIFICATION_REQUIRED'); }
    finally { db.prepare('UPDATE job_titles SET min_salary=15000000 WHERE id=?').run(job.id); }
    assert.equal(db.prepare('SELECT min_salary,max_salary FROM job_titles WHERE id=?').get(job.id).max_salary, 25000000);
  });
  await test('29 Wrong types, fractions, blank and nonnumeric headcounts are rejected', async () => {
    for (const headcount of ['', null, 'bad', '1.5', 1.5, true, {}, []]) await rejected({ headcount });
    for (const field of ['jobTitleId', 'departmentId', 'recruitmentReason', 'neededDate', 'jobDescription', 'candidateRequirements', 'salaryJustification']) await rejected({ [field]: {} });
  });
  await test('30 Proposed salary rejects negative, nonnumeric and wrong types; zero remains valid', async () => {
    for (const value of [-1, 'bad', true, [], {}]) await rejected({ proposedSalaryMin: value });
    assert.equal((await create({ proposedSalaryMin: 0, proposedSalaryMax: 0, salaryJustification: 'Đào tạo' })).status, 201);
    assert.equal((await create({ proposedSalaryMin: '18000000', proposedSalaryMax: '23000000' })).status, 201);
  });
  await test('31 Draft input still enforces format, salary and date rules', async () => {
    for (const change of [{ headcount: 0 }, { proposedSalaryMin: -1 }, { neededDate: dayOffset(-1) }, { recruitmentReason: 'OTHER' }, { proposedSalaryMin: 14000000, salaryJustification: ' ' }]) await rejected({ ...change, status: 'DRAFT' });
    const partial = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT', proposedSalaryMin: 100 }); assert.equal(partial.status, 201);
  });
  await test('32 Invalid calendar dates are rejected; timezone uses Vietnam across UTC midnight', async () => {
    for (const neededDate of ['2026-02-30', '2026-13-01', '2026-1-1', '2026-10-04T00:00:00Z']) await rejected({ neededDate }, 'INVALID_NEEDED_DATE');
    assert.equal(service.businessDate(new Date('2026-10-03T18:30:00Z')), '2026-10-04');
    assert.equal(service.businessDate(new Date('2026-10-04T00:00:00Z')), '2026-10-04');
  });
  await test('33 Draft ownership is enforced for read, list and update even for HR', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' }); const id = res.data.data.id;
    assert.equal((await api('GET', '/requisitions/' + id, tokens.hr)).status, 403);
    assert.equal((await api('PUT', '/requisitions/' + id, tokens.hr, { title: 'Not owner' })).status, 403);
    const list = await api('GET', '/requisitions?status=DRAFT', tokens.hr); assert.ok(!list.data.items.some(row => row.id === id));
  });
  await test('34 Invalid draft transitions and version downgrade cannot bypass required fields', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' }); const id = res.data.data.id;
    assert.equal((await api('PUT', '/requisitions/' + id, tokens.hiring, { status: 'IN_PROGRESS' })).status, 400);
    assert.equal((await api('PUT', '/requisitions/' + id, tokens.hiring, { formVersion: 'old', status: 'OPEN' })).status, 400);
    assert.equal(service.getRequisitionById(id).status, 'DRAFT');
  });
  await test('35 Failed SQL update leaves the complete draft unchanged', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' }); const before = service.getRequisitionById(res.data.data.id);
    db.exec(`CREATE TEMP TRIGGER s210_fail BEFORE UPDATE ON requisitions WHEN OLD.id='${before.id}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    try { assert.equal((await api('PUT', '/requisitions/' + before.id, tokens.hiring, { ...valid, status: 'OPEN' })).status, 400); assert.deepEqual(service.getRequisitionById(before.id), before); }
    finally { db.exec('DROP TRIGGER s210_fail'); }
    db.exec('BEGIN'); db.exec('ROLLBACK'); assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  });
  await test('36 Additive requisition migration preserves old records and is idempotent', async () => {
    const fixture = path.join(root, 'backend/data/old_requisition.db');
    const { DatabaseSync } = require('node:sqlite'); const old = new DatabaseSync(fixture);
    old.exec("CREATE TABLE requisitions (id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,department_name TEXT NOT NULL,hiring_manager_id TEXT,recruiter_id TEXT,status TEXT DEFAULT 'OPEN',headcount INTEGER DEFAULT 1,handover_required INTEGER DEFAULT 0,handover_notes TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now'))); INSERT INTO requisitions(id,code,title,department_name,headcount) VALUES('old','OLD','Old title','Old department',3)"); old.close();
    const script = `const assert=require('node:assert/strict');const db=require('./backend/src/db/database').getDatabase(${JSON.stringify(fixture)});const row=db.prepare("SELECT * FROM requisitions WHERE id='old'").get();assert.equal(row.headcount,3);assert.equal(row.department_name,'Old department');assert.equal(row.s210_version,0);assert.equal(row.proposed_salary_min,null);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();`;
    for (let i = 0; i < 2; i++) { const child = spawnSync(process.execPath, ['-e', script], { cwd: root, env: process.env, encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr); }
  });
  await test('37 Existing frontend callbacks send complete S2-10 data and persist a partial draft', async () => {
    const nodes = new Map(), storage = new Map(); let ready, sent;
    const makeNode = () => {
      const node = { value: '', min: '', required: false, innerHTML: '', style: {}, dataset: {}, children: [], disabled: false,
      listeners: {}, classList: { set: new Set(), add(v) { this.set.add(v); }, remove(v) { this.set.delete(v); }, toggle(v, force) { if (force) this.set.add(v); else this.set.delete(v); }, contains(v) { return this.set.has(v); } },
      addEventListener(name, fn) { this.listeners[name] = fn; }, querySelectorAll() { return []; }, querySelector() { return null; },
      setAttribute() {}, getAttribute() { return ''; }, appendChild(child) { this.children.push(child); }, reset() {}, remove() {}, focus() {} };
      let content = '';
      // Model the browser's textContent -> escaped innerHTML behavior used by option rendering.
      Object.defineProperty(node, 'textContent', { get: () => content, set(value) {
        content = String(value); node.innerHTML = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      } });
      return node;
    };
    const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8'); for (const match of html.matchAll(/id="([^"]+)"/g)) nodes.set(match[1], makeNode());
    const fallback = async () => ({ ok: false, data: { success: false } });
    const apiMock = new Proxy({ getRequisitionOptionsApi: async (token, params = {}) => {
      const query = new URLSearchParams(params).toString();
      const res = await api('GET', '/requisitions/options' + (query ? '?' + query : ''), token); return { ok: res.status === 200, data: res.data };
    },
      getPermissionsApi: async token => { const res = await api('GET', '/auth/permissions', token); return { ok: res.status === 200, data: res.data }; },
      createRequisition: async (_, payload) => { sent = payload; return { ok: false, data: { message: 'Captured' } }; } }, { get: (object, key) => object[key] || fallback });
    const document = { getElementById: id => nodes.get(id) || null, querySelectorAll: () => [], querySelector: () => null, createElement: makeNode,
      addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; }, body: makeNode(), documentElement: makeNode() };
    const context = { document, window: { ATS_API: apiMock, addEventListener() {}, location: { search: '', pathname: '/' } }, sessionStorage: {
      getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      URL, URLSearchParams, console, setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {}, navigator: {}, confirm: () => true };
    const code = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8').replace('  loadPublicCareerPage();', '  window.__S210_TEST__ = { openCreateReqModal, updateRequisitionSalaryHint, refreshRequisitionSalaryCheck, requisitionBusinessDate, performLogout };\n  loadPublicCareerPage();');
    vm.runInNewContext(code, context); ready(); storage.set('ats_token', tokens.hiring);
    await context.window.__S210_TEST__.openCreateReqModal();
    const values = { 'create-req-job-title-input': job.id, 'create-req-dept-input': department.id, 'create-req-headcount-input': '2',
      'create-req-reason-input': 'REPLACEMENT', 'create-req-salary-min-input': '18000000', 'create-req-salary-max-input': '23000000',
      'create-req-needed-date-input': valid.neededDate, 'create-req-description-input': valid.jobDescription, 'create-req-requirements-input': valid.candidateRequirements };
    for (const [id, value] of Object.entries(values)) nodes.get(id).value = value;
    await nodes.get('create-req-form').listeners.submit({ preventDefault() {} }); assert.ok(sent); assert.equal(sent.formVersion, 'S2-10'); assert.equal(sent.jobTitleId, job.id); assert.equal(sent.jobDescription, valid.jobDescription);
    assert.equal((await api('POST', '/requisitions', tokens.hiring, sent)).status, 201);
    for (const id of Object.keys(values)) nodes.get(id).value = '';
    sent = null; await nodes.get('save-create-req-draft-btn').listeners.click(); assert.ok(sent); assert.equal(sent.status, 'DRAFT'); assert.equal(sent.headcount, null);
    assert.equal((await api('POST', '/requisitions', tokens.hiring, sent)).status, 201);
    ui = { context, nodes, storage, apiMock, getSent: () => sent, clearSent: () => { sent = null; } };
  });
  await test('38 Frontend rejects inverted salary and past dates before sending', async () => {
    const { nodes } = ui; ui.clearSent(); nodes.get('create-req-salary-min-input').value = '200'; nodes.get('create-req-salary-max-input').value = '100';
    await nodes.get('save-create-req-draft-btn').listeners.click(); assert.equal(ui.getSent(), null);
    nodes.get('create-req-salary-min-input').value = ''; nodes.get('create-req-salary-max-input').value = ''; nodes.get('create-req-needed-date-input').value = dayOffset(-1);
    await nodes.get('save-create-req-draft-btn').listeners.click(); assert.equal(ui.getSent(), null);
    assert.equal(nodes.get('create-req-needed-date-input').min, service.businessDate());
    assert.equal(ui.context.window.__S210_TEST__.requisitionBusinessDate(new Date('2026-10-03T18:30:00Z')), '2026-10-04');
  });
  await test('39 Frontend restores draft contents and updates through the existing endpoint', async () => {
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT', jobDescription: 'Khôi phục\nnháp' });
    const req = res.data.data; let updated;
    ui.apiMock.updateRequisitionApi = async (_, id, data) => { updated = { id, data }; return { ok: false, data: { message: 'Captured' } }; };
    await ui.context.window.__S210_TEST__.openCreateReqModal(req);
    assert.equal(ui.nodes.get('create-req-description-input').value, req.jobDescription);
    ui.nodes.get('create-req-needed-date-input').value = '';
    await ui.nodes.get('save-create-req-draft-btn').listeners.click(); assert.ok(updated); assert.equal(updated.id, req.id);
    assert.equal((await api('PUT', '/requisitions/' + req.id, tokens.hiring, updated.data)).status, 200);
  });
  await test('40 Logout clears requisition salary values and closes the form', async () => {
    ui.nodes.get('create-req-salary-min-input').value = '15000000'; await ui.context.window.__S210_TEST__.performLogout(false);
    assert.equal(ui.nodes.get('create-req-salary-min-input').value, ''); assert.equal(ui.nodes.get('create-req-standard-salary').textContent, '');
    assert.equal(ui.nodes.get('create-req-modal').classList.contains('hidden'), true);
  });
  await test('41 Existing S2-05 salary confidentiality is retained in requisition options', async () => {
    const hiring = await api('GET', '/requisitions/options');
    assert.equal(Object.hasOwn(hiring.data.jobTitles.find(row => row.id === job.id), 'minSalary'), false);
    const hr = await api('GET', '/requisitions/options', tokens.hr);
    const title = hr.data.jobTitles.find(row => row.id === job.id); assert.equal(title.minSalary, 15000000); assert.equal(title.maxSalary, 25000000);
    const catalog = await api('GET', '/job-titles', tokens.admin); assert.equal(Object.hasOwn(catalog.data.jobTitles.find(row => row.id === job.id), 'minSalary'), false);
  });
  await test('42 HR frontend shows standard range and requires justification outside it', async () => {
    ui.storage.set('ats_token', tokens.hr); await ui.context.window.__S210_TEST__.openCreateReqModal();
    ui.nodes.get('create-req-job-title-input').value = job.id; ui.nodes.get('create-req-salary-min-input').value = '14000000'; ui.nodes.get('create-req-salary-max-input').value = '23000000';
    assert.equal(ui.context.window.__S210_TEST__.updateRequisitionSalaryHint(), true);
    assert.ok(ui.nodes.get('create-req-standard-salary').textContent.includes('15.000.000'));
    assert.equal(ui.nodes.get('create-req-justification-input').required, true);
    ui.clearSent(); await ui.nodes.get('save-create-req-draft-btn').listeners.click(); assert.equal(ui.getSent(), null);
  });
  await test('43 Legacy title without salary can be drafted but is explicitly blocked from completion', async () => {
    db.prepare('UPDATE job_titles SET min_salary=NULL,max_salary=NULL WHERE id=?').run(job.id);
    try {
      const complete = await create({}); assert.equal(complete.status, 409); assert.equal(complete.data.code, 'JOB_TITLE_SALARY_RANGE_UNAVAILABLE');
      const partial = await create({ status: 'DRAFT' }); assert.equal(partial.status, 201); assert.equal(partial.data.data.status, 'DRAFT');
    } finally { db.prepare('UPDATE job_titles SET min_salary=15000000,max_salary=25000000 WHERE id=?').run(job.id); }
  });
  await test('44 Legacy list access never exposes S2-10 data to roles without requisition.read', async () => {
    for (const role of ['interviewer', 'candidate']) {
      const res = await api('GET', '/requisitions', tokens[role]); assert.equal(res.status, 200);
      assert.ok(res.data.items.every(row => row.formVersion !== 'S2-10'));
      assert.equal((await api('GET', '/requisitions/' + draft.id, tokens[role])).status, 403);
    }
  });
  await test('45 Draft form retains stored selections missing from current dropdown choices', async () => {
    const selected = ui.nodes.get('create-req-recruiter-select'); selected.tagName = 'SELECT'; selected.options = [];
    ui.storage.set('ats_token', tokens.hiring);
    const res = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT', recruiterId: 'usr-recruiter' }); assert.equal(res.status, 201);
    await ui.context.window.__S210_TEST__.openCreateReqModal(res.data.data);
    assert.ok(selected.innerHTML.includes('value="usr-recruiter"')); assert.equal(selected.value, 'usr-recruiter');
  });
  const assertNoStandardSalary = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['standardMin', 'standardMax', 'standardSalaryMin', 'standardSalaryMax', 'standard_min', 'standard_max', 'minSalary', 'maxSalary', 'min_salary', 'max_salary'].includes(key), 'Standard salary leak: ' + key);
      assertNoStandardSalary(child);
    }
  };
  const preview = (min, max, token = tokens.hiring) => api('GET', '/requisitions/options?' + new URLSearchParams({ jobTitleId: job.id, proposedSalaryMin: min, proposedSalaryMax: max }), token);
  await test('46 Hiring Manager receives no standard salary in options or salary permission', async () => {
    const options = await api('GET', '/requisitions/options'); assertNoStandardSalary(options.data);
    const perms = await api('GET', '/auth/permissions'); assert.ok(!perms.data.permissions.includes('salary_range.read'));
    assert.equal((await api('GET', '/job-titles')).status, 403);
  });
  await test('47 Within-range preview and create return only the safe classification', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM requisitions').get().n;
    const res = await preview(18000000, 23000000); assert.equal(res.status, 200); assert.equal(res.data.salaryRangeStatus, 'WITHIN_STANDARD_RANGE');
    assert.deepEqual(Object.keys(res.data).sort(), ['success', 'statusCode', 'salaryRangeStatus'].sort()); assertNoStandardSalary(res.data);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM requisitions').get().n, before);
    const saved = await create({}); assert.equal(saved.status, 201); assert.equal(saved.data.salaryRangeStatus, 'WITHIN_STANDARD_RANGE'); assertNoStandardSalary(saved.data);
    for (const path of ['/requisitions/' + saved.data.data.id, '/requisitions']) assertNoStandardSalary((await api('GET', path)).data);
  });
  await test('48 Outside-range preview returns OUTSIDE_STANDARD_RANGE without revealing limits', async () => {
    for (const [min, max] of [[14000000, 23000000], [18000000, 30000000]]) {
      const res = await preview(min, max); assert.equal(res.status, 200); assert.equal(res.data.salaryRangeStatus, 'OUTSIDE_STANDARD_RANGE'); assertNoStandardSalary(res.data);
    }
  });
  await test('49 Outside-range writes without justification reject safely and cannot disable validation', async () => {
    const res = await create({ proposedSalaryMin: 14000000, requireJustification: false }); assert.equal(res.status, 400);
    assert.equal(res.data.code, 'SALARY_JUSTIFICATION_REQUIRED'); assert.equal(res.data.salaryRangeStatus, 'OUTSIDE_STANDARD_RANGE'); assertNoStandardSalary(res.data);
    assert.ok(!/15000000|25000000|15\.000\.000|25\.000\.000/.test(res.data.message));
    const incomplete = await api('POST', '/requisitions', tokens.hiring, { status: 'DRAFT' });
    const update = await api('PUT', '/requisitions/' + incomplete.data.data.id, tokens.hiring, { ...valid, status: 'OPEN', proposedSalaryMax: 30000000 });
    assert.equal(update.status, 400); assert.equal(update.data.salaryRangeStatus, 'OUTSIDE_STANDARD_RANGE'); assertNoStandardSalary(update.data);
    assert.equal(service.getRequisitionById(incomplete.data.data.id).status, 'DRAFT');
  });
  await test('50 Justified outside salary saves and completes a draft with safe status', async () => {
    const res = await create({ status: 'DRAFT', proposedSalaryMax: 30000000, salaryJustification: 'Kinh nghiệm chuyên sâu' }); assert.equal(res.status, 201);
    assert.equal(res.data.salaryRangeStatus, 'OUTSIDE_STANDARD_RANGE'); assertNoStandardSalary(res.data);
    const updated = await api('PUT', '/requisitions/' + res.data.data.id, tokens.hiring, { status: 'OPEN' }); assert.equal(updated.status, 200);
    assert.equal(updated.data.salaryRangeStatus, 'OUTSIDE_STANDARD_RANGE'); assertNoStandardSalary(updated.data);
  });
  await test('51 HR sees standards only while holding the existing salary-range permission', async () => {
    const row = db.prepare(`SELECT rp.role_id, rp.permission_id FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='HR_MANAGER' AND p.code='salary_range.read'`).get(); assert.ok(row);
    let res = await api('GET', '/requisitions/options', tokens.hr); let title = res.data.jobTitles.find(item => item.id === job.id);
    assert.equal(title.minSalary, 15000000); assert.equal(title.maxSalary, 25000000);
    db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(row.role_id, row.permission_id);
    try {
      res = await api('GET', '/requisitions/options', tokens.hr); assertNoStandardSalary(res.data);
      const catalog = await api('GET', '/job-titles', tokens.hr); assertNoStandardSalary(catalog.data);
    } finally { db.prepare('INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)').run(row.role_id, row.permission_id); }
    res = await api('GET', '/job-titles', tokens.hr); title = res.data.jobTitles.find(item => item.id === job.id); assert.equal(title.minSalary, 15000000); assert.equal(title.maxSalary, 25000000);
  });
  await test('52 Standard minimum NULL permits draft with no invented salary or justification', async () => {
    db.prepare('UPDATE job_titles SET min_salary=NULL WHERE id=?').run(job.id);
    try {
      const res = await create({ status: 'DRAFT', proposedSalaryMin: 14000000, proposedSalaryMax: 30000000 }); assert.equal(res.status, 201); assertNoStandardSalary(res.data);
      assert.equal(db.prepare('SELECT min_salary FROM job_titles WHERE id=?').get(job.id).min_salary, null);
    } finally { db.prepare('UPDATE job_titles SET min_salary=15000000 WHERE id=?').run(job.id); }
  });
  await test('53 Standard maximum NULL permits draft even when proposal is below the remaining minimum', async () => {
    db.prepare('UPDATE job_titles SET max_salary=NULL WHERE id=?').run(job.id);
    try {
      const res = await create({ status: 'DRAFT', proposedSalaryMin: 14000000 }); assert.equal(res.status, 201); assertNoStandardSalary(res.data);
      assert.equal(db.prepare('SELECT max_salary FROM job_titles WHERE id=?').get(job.id).max_salary, null);
    } finally { db.prepare('UPDATE job_titles SET max_salary=25000000 WHERE id=?').run(job.id); }
  });
  await test('54 Either missing standard bound returns 409 on create/complete with explicit HR guidance and no leak', async () => {
    for (const [min, max] of [[null, 25000000], [15000000, null], [null, null]]) {
      db.prepare('UPDATE job_titles SET min_salary=?,max_salary=? WHERE id=?').run(min, max, job.id);
      try {
        const created = await create({}); assert.equal(created.status, 409); assert.equal(created.data.code, 'JOB_TITLE_SALARY_RANGE_UNAVAILABLE');
        assert.match(created.data.message, /HR Manager/); assert.match(created.data.message, /thiết lập/); assertNoStandardSalary(created.data);
        assert.ok(!/15000000|25000000|15\.000\.000|25\.000\.000/.test(created.data.message));
        const partial = await create({ status: 'DRAFT' }); assert.equal(partial.status, 201);
        const completed = await api('PUT', '/requisitions/' + partial.data.data.id, tokens.hiring, { status: 'OPEN' }); assert.equal(completed.status, 409);
        assert.equal(completed.data.code, 'JOB_TITLE_SALARY_RANGE_UNAVAILABLE'); assertNoStandardSalary(completed.data); assert.equal(service.getRequisitionById(partial.data.data.id).status, 'DRAFT');
        const checked = await preview(18000000, 23000000); assert.equal(checked.status, 409); assertNoStandardSalary(checked.data);
      } finally { db.prepare('UPDATE job_titles SET min_salary=15000000,max_salary=25000000 WHERE id=?').run(job.id); }
    }
    assert.equal((await create({})).status, 201);
  });
  await test('55 Salary-check API retains default-deny and rejects invalid proposal inputs', async () => {
    assert.equal((await preview(18000000, 23000000, null)).status, 401);
    for (const role of ['recruiter', 'interviewer', 'admin']) assert.equal((await preview(18000000, 23000000, tokens[role])).status, 403);
    for (const [min, max] of [['bad', 23000000], [-1, 23000000], [24000000, 18000000], ['', 23000000]]) {
      const res = await preview(min, max); assert.equal(res.status, 400); assertNoStandardSalary(res.data);
    }
  });
  await test('56 Hiring Manager frontend receives safe status and requires/clears justification accordingly', async () => {
    const { context, nodes, storage } = ui; storage.set('ats_token', tokens.hiring); await context.window.__S210_TEST__.openCreateReqModal();
    for (const [id, value] of Object.entries({ 'create-req-job-title-input': job.id, 'create-req-salary-min-input': '14000000', 'create-req-salary-max-input': '23000000', 'create-req-justification-input': '', 'create-req-needed-date-input': '' })) nodes.get(id).value = value;
    assert.equal(await context.window.__S210_TEST__.refreshRequisitionSalaryCheck(), 'OUTSIDE_STANDARD_RANGE'); assert.equal(nodes.get('create-req-justification-input').required, true);
    assert.ok(!/15\.000\.000|25\.000\.000|15000000|25000000/.test(nodes.get('create-req-standard-salary').textContent));
    ui.clearSent(); await nodes.get('save-create-req-draft-btn').listeners.click(); assert.equal(ui.getSent(), null);
    nodes.get('create-req-salary-min-input').value = '18000000';
    assert.equal(await context.window.__S210_TEST__.refreshRequisitionSalaryCheck(), 'WITHIN_STANDARD_RANGE'); assert.equal(nodes.get('create-req-justification-input').required, false);
    nodes.get('create-req-headcount-input').value = ''; nodes.get('create-req-reason-input').value = ''; nodes.get('create-req-description-input').value = ''; nodes.get('create-req-requirements-input').value = '';
    await nodes.get('save-create-req-draft-btn').listeners.click(); assert.ok(ui.getSent()); assert.equal(ui.getSent().salaryJustification, '');
  });
  await test('57 Salary-check responses from older input/session cannot overwrite current UI state', async () => {
    const { context, nodes, apiMock, storage } = ui; const original = apiMock.getRequisitionOptionsApi;
    let resolveOld;
    apiMock.getRequisitionOptionsApi = () => new Promise(resolve => { resolveOld = resolve; });
    nodes.get('create-req-salary-min-input').value = '14000000'; const old = context.window.__S210_TEST__.refreshRequisitionSalaryCheck();
    apiMock.getRequisitionOptionsApi = original; nodes.get('create-req-salary-min-input').value = '18000000';
    await context.window.__S210_TEST__.refreshRequisitionSalaryCheck(); resolveOld({ ok: true, data: { salaryRangeStatus: 'OUTSIDE_STANDARD_RANGE' } }); await old;
    assert.equal(nodes.get('create-req-justification-input').required, false);
    apiMock.getRequisitionOptionsApi = () => new Promise(resolve => { resolveOld = resolve; }); const previousSession = context.window.__S210_TEST__.refreshRequisitionSalaryCheck();
    await context.window.__S210_TEST__.performLogout(false); storage.set('ats_token', tokens.hr);
    resolveOld({ ok: true, data: { salaryRangeStatus: 'OUTSIDE_STANDARD_RANGE' } }); await previousSession;
    assert.equal(nodes.get('create-req-standard-salary').textContent, ''); apiMock.getRequisitionOptionsApi = original;
  });
  await test('58 Frontend API sends only proposal parameters to the existing options route', async () => {
    let called;
    const context = { window: { location: { protocol: 'https:', hostname: 'ats.example', port: '' } }, URLSearchParams,
      fetch: async (url, options) => { called = { url, options }; return { status: 200, ok: true, json: async () => ({ success: true, salaryRangeStatus: 'WITHIN_STANDARD_RANGE' }) }; } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/js/api.js'), 'utf8'), context);
    await context.window.ATS_API.getRequisitionOptionsApi('token', { jobTitleId: 'job + test', proposedSalaryMin: 0, proposedSalaryMax: 100, standardMin: 50, standardMax: 80 });
    const url = new URL(called.url, 'https://ats.example'); assert.equal(url.pathname, '/api/v1/requisitions/options'); assert.equal(url.searchParams.get('jobTitleId'), 'job + test');
    assert.equal(url.searchParams.get('proposedSalaryMin'), '0'); assert.equal(url.searchParams.has('standardMin'), false); assert.equal(url.searchParams.has('standardMax'), false);
    await context.window.ATS_API.getRequisitionOptionsApi('token'); assert.equal(new URL(called.url, 'https://ats.example').search, '');
  });
  await test('59 Delayed HR options cannot restore standard salaries into a new Hiring Manager session', async () => {
    const { context, nodes, apiMock, storage } = ui; const original = apiMock.getRequisitionOptionsApi;
    let resolveOptions;
    storage.set('ats_token', tokens.hr);
    apiMock.getRequisitionOptionsApi = () => new Promise(resolve => { resolveOptions = resolve; });
    const oldModal = context.window.__S210_TEST__.openCreateReqModal();
    await context.window.__S210_TEST__.performLogout(false);
    storage.set('ats_token', tokens.hiring); apiMock.getRequisitionOptionsApi = original;
    await context.window.__S210_TEST__.openCreateReqModal();
    nodes.get('create-req-job-title-input').value = job.id;
    nodes.get('create-req-salary-min-input').value = '18000000'; nodes.get('create-req-salary-max-input').value = '23000000';
    await context.window.__S210_TEST__.refreshRequisitionSalaryCheck();
    resolveOptions({ ok: true, data: { success: true, tree: [], s210Departments: [],
      jobTitles: [{ id: job.id, name: job.name, minSalary: 15000000, maxSalary: 25000000 }] } });
    await oldModal; context.window.__S210_TEST__.updateRequisitionSalaryHint();
    assert.equal(nodes.get('create-req-standard-salary').textContent, 'Dải lương đề xuất nằm trong chuẩn chức danh.');
    assert.ok(!/15\.000\.000|25\.000\.000|15000000|25000000/.test(nodes.get('create-req-standard-salary').textContent));
  });
  console.log('S210_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed })); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
