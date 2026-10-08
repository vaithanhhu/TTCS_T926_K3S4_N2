const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-wal', 'backend/data/ats.db-shm', 'backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root, file)), false, 'Fresh isolated source copy required');
for (const name of Object.keys(process.env)) if (/^(ATS_POSTGRES_|SMTP_|MAIL_|GOOGLE_OAUTH_|DATABASE_|DB_|PG|EMAIL_|APPROVAL_|REQUISITION_APPROVAL_)/.test(name)) delete process.env[name];
Object.assign(process.env, { NODE_ENV: 'test', EMAIL_MODE: 'simulated', DB_PROVIDER: 'sqlite' });
const config = require('../src/config/config');
assert.equal(config.DATABASE_URL + config.SMTP_HOST + config.SMTP_USER + config.SMTP_PASSWORD, '');
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { hashPassword } = require('../src/utils/password');
const RequisitionService = require('../src/services/requisitionService');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
let passed = 0, failed = 0;
async function test(name, action) {
  try { await action(); passed++; console.log('[PASS] ' + name); }
  catch (error) { failed++; console.error('[FAIL] ' + name + '\n' + error.stack); }
}
async function main() {
  await startServer(0);
  const db = getDatabase(), service = new RequisitionService(db), base = 'http://127.0.0.1:' + server.address().port;
  const password = crypto.randomBytes(18).toString('base64url') + '!aA7';
  await db.prepare('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL, must_change_password=FALSE').run(hashPassword(password));
  const fixture = await service.createRequisition({ title: 'Permission feedback fixture', departmentId: 'dept-3', hiringManagerId: 'usr-hiring-mgr', recruiterId: 'usr-recruiter', headcount: 2 });
  assert.equal(fixture.success, true);
  const runtime = await createFrontendRuntime(base, '/login');
  const createElement = runtime.document.createElement.bind(runtime.document);
  runtime.document.createElement = tag => {
    const node = createElement(tag);
    if (tag === 'div') Object.defineProperty(node, 'textContent', {
      configurable: true,
      get() { return this._textContent || ''; },
      set(value) { this._textContent = String(value); this.innerHTML = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    });
    return node;
  };
  runtime.nodes.get('email').value = 'hiringmgr@company.com'; runtime.nodes.get('password').value = password;
  await runtime.nodes.get('login-form').dispatch('submit'); await runtime.settle();
  const toasts = runtime.nodes.get('toast-container'), table = runtime.nodes.get('requisitions-table-body');
  const lastToast = () => toasts.children.at(-1)?.innerHTML || '';
  let buttons = [], markup = '';
  Object.defineProperty(table, 'innerHTML', {
    configurable: true,
    get() { return markup; },
    set(value) {
      markup = value;
      buttons = [...value.matchAll(/<button\b[^>]*class="[^"]*\bbtn-edit-req\b[^"]*"[^>]*>/g)].map(match => {
        const button = runtime.document.createElement('button');
        for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attribute[1], attribute[2]);
        return button;
      });
    }
  });
  const selectAll = runtime.document.querySelectorAll.bind(runtime.document);
  runtime.document.querySelectorAll = selector => selector === '.btn-edit-req' ? buttons : selectAll(selector);
  try {
    await test('Actual requisition row click reads backend details and opens retained legacy modal', async () => {
      await runtime.nodes.get('req-refresh-btn').dispatch('click'); await runtime.settle();
      const button = buttons.find(node => node.getAttribute('data-id') === fixture.data.id); assert.ok(button);
      const writes = runtime.requests.filter(row => ['POST', 'PUT', 'DELETE'].includes(row.method)).length;
      await button.dispatch('click'); await runtime.settle();
      assert.equal(runtime.nodes.get('requisition-detail-modal').classList.contains('hidden'), false);
      assert.equal(runtime.nodes.get('req-detail-title-input').value, 'Permission feedback fixture');
      assert.ok(runtime.requests.some(row => row.path === '/api/v1/requisitions/' + fixture.data.id && row.method === 'GET'));
      assert.equal(runtime.requests.filter(row => ['POST', 'PUT', 'DELETE'].includes(row.method)).length, writes);
    });
    await test('Detail reload uses persisted API data rather than stale list title', async () => {
      await db.prepare('UPDATE requisitions SET title=? WHERE id=?').run('Persisted revised fixture', fixture.data.id);
      await vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context);
      assert.equal(runtime.nodes.get('req-detail-title-input').value, 'Persisted revised fixture');
    });
    await test('Unknown detail ID renders actual HTTP404 feedback without stale modal', async () => {
      await vm.runInContext("openRequisitionDetails('req-does-not-exist')", runtime.context);
      assert.equal(runtime.nodes.get('requisition-detail-modal').classList.contains('hidden'), true);
      assert.match(lastToast(), /Không tìm thấy/);
    });
    await test('Older detail response cannot replace the latest opened persisted request', async () => {
      const original = runtime.window.ATS_API.getRequisitionByIdApi;
      let release, delayed = true;
      runtime.window.ATS_API.getRequisitionByIdApi = async (...args) => {
        const response = await original(...args);
        if (!delayed) return response;
        delayed = false;
        return new Promise(resolve => { release = () => resolve(response); });
      };
      try {
        const first = vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context); await runtime.settle(); assert.ok(release);
        await db.prepare('UPDATE requisitions SET title=? WHERE id=?').run('Newest detail wins', fixture.data.id);
        await vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context);
        assert.equal(runtime.nodes.get('req-detail-title-input').value, 'Newest detail wins');
        release(); await first; assert.equal(runtime.nodes.get('req-detail-title-input').value, 'Newest detail wins');
      } finally { runtime.window.ATS_API.getRequisitionByIdApi = original; }
    });
    await test('Delayed detail response after navigation cannot reopen a modal on another route', async () => {
      const original = runtime.window.ATS_API.getRequisitionByIdApi;
      let release;
      runtime.window.ATS_API.getRequisitionByIdApi = async (...args) => {
        const response = await original(...args); return new Promise(resolve => { release = () => resolve(response); });
      };
      try {
        const pending = vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context); await runtime.settle(); assert.ok(release);
        runtime.window.ATS_ROUTER.navigate('/profile'); await runtime.settle();
        release(); await pending; assert.equal(runtime.nodes.get('requisition-detail-modal').classList.contains('hidden'), true);
      } finally { runtime.window.ATS_API.getRequisitionByIdApi = original; }
      runtime.window.ATS_ROUTER.navigate('/requisitions'); await runtime.settle();
    });
    await test('Unexpected service failure renders safe HTTP500 feedback and no internal exception', async () => {
      const original = RequisitionService.prototype.getRequisitionById;
      RequisitionService.prototype.getRequisitionById = async function(id) { if (id === 'req-fault') throw Error('PRIVATE_SQL_SERVER_PATH'); return original.call(this, id); };
      try {
        await vm.runInContext("openRequisitionDetails('req-fault')", runtime.context);
        assert.match(lastToast(), /lỗi|thử lại|hệ thống/i); assert.ok(!lastToast().includes('PRIVATE_SQL_SERVER_PATH'));
      } finally { RequisitionService.prototype.getRequisitionById = original; }
    });
    await test('List failure clears loading and stale records instead of appearing successful', async () => {
      const original = RequisitionService.prototype.getRequisitions;
      RequisitionService.prototype.getRequisitions = async () => { throw Error('PRIVATE_LIST_SQL'); };
      try {
        await runtime.nodes.get('req-refresh-btn').dispatch('click'); await runtime.settle();
        assert.ok(!table.innerHTML.includes('Đang tải')); assert.ok(!table.innerHTML.includes('Newest detail wins'));
        assert.equal(runtime.nodes.get('requisitions-total-badge').textContent, '0 vị trí');
        assert.match(table.innerHTML, /lỗi|thử lại|hệ thống/i); assert.ok(!table.innerHTML.includes('PRIVATE_LIST_SQL'));
      } finally { RequisitionService.prototype.getRequisitions = original; }
    });
    let ownCandidate, foreignCandidate;
    await test('Hiring Manager candidate list and client-supplied scope are restricted by backend ownership', async () => {
      const foreign = await service.createRequisition({ title: 'Foreign scope fixture', departmentId: 'dept-2', hiringManagerId: 'usr-hr-mgr', recruiterId: 'usr-recruiter', headcount: 1 }); assert.equal(foreign.success, true);
      ownCandidate = await service.createCandidate({ fullName: 'Scope fixture own', email: 'scope-own@example.test', requisitionId: fixture.data.id });
      foreignCandidate = await service.createCandidate({ fullName: 'Scope fixture foreign', email: 'scope-foreign@example.test', requisitionId: foreign.data.id });
      assert.equal(ownCandidate.success, true); assert.equal(foreignCandidate.success, true);
      const response = await fetch(base + '/api/v1/candidates?search=Scope%20fixture&viewerId=usr-admin&candidateEmail=scope-foreign%40example.test', { headers: { Authorization: 'Bearer ' + runtime.storage.get('ats_token') } });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).candidates.map(row => row.id), [ownCandidate.data.id]);
    });
    await test('ADMIN HR_MANAGER and RECRUITER retain full candidate read permission', async () => {
      for (const email of ['admin@company.com', 'hrmanager@company.com', 'recruiter@company.com']) {
        const login = await (await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json(); assert.equal(login.success, true);
        try {
          const response = await fetch(base + '/api/v1/candidates?search=Scope%20fixture', { headers: { Authorization: 'Bearer ' + login.data.token } }); assert.equal(response.status, 200);
          assert.deepEqual((await response.json()).candidates.map(row => row.id).sort(), [ownCandidate.data.id, foreignCandidate.data.id].sort());
        } finally { await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + login.data.token } }); }
      }
    });
    await test('Foreign requisition is absent from list and detail click renders exact scope feedback without data', async () => {
      const foreign = await db.prepare("SELECT id FROM requisitions WHERE title='Foreign scope fixture'").get(); assert.ok(foreign);
      const token = runtime.storage.get('ats_token');
      const list = await (await fetch(base + '/api/v1/requisitions?viewerId=usr-admin', { headers: { Authorization: 'Bearer ' + token } })).json();
      assert.equal(list.items.some(row => row.id === foreign.id), false);
      const response = await fetch(base + '/api/v1/requisitions/' + foreign.id, { headers: { Authorization: 'Bearer ' + token } }); assert.equal(response.status, 403);
      const denied = await response.json(); assert.equal(denied.code, 'REQUISITION_OUT_OF_SCOPE'); assert.equal(Object.hasOwn(denied, 'data'), false);
      await vm.runInContext('openRequisitionDetails(' + JSON.stringify(foreign.id) + ')', runtime.context);
      assert.match(lastToast(), /Yêu cầu tuyển dụng này không thuộc phạm vi quản lý hoặc quyền chỉnh sửa của bạn\./);
      assert.equal(runtime.nodes.get('requisition-detail-modal').classList.contains('hidden'), true);
    });
    await test('Significant OPEN edit requires reapproval and persists no changes', async () => {
      await vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context);
      const before = await service.getRequisitionById(fixture.data.id);
      runtime.nodes.get('req-detail-title-input').value = 'Unauthorized edit must not persist';
      await runtime.nodes.get('req-detail-form').dispatch('submit'); await runtime.settle();
      assert.equal(runtime.nodes.get('req-detail-alert-msg').textContent, 'Thay đổi này ảnh hưởng đến nội dung đã phê duyệt và cần được gửi phê duyệt lại.');
      assert.equal(runtime.nodes.get('req-detail-alert').classList.contains('hidden'), false);
      assert.deepEqual(await service.getRequisitionById(fixture.data.id), before);
    });
    await test('Expired real token produces login feedback instead of silent detail click', async () => {
      await db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01T00:00:00Z', runtime.storage.get('ats_token'));
      await vm.runInContext('openRequisitionDetails(' + JSON.stringify(fixture.data.id) + ')', runtime.context);
      assert.match(lastToast(), /phiên|đăng nhập/i);
    });
    assert.deepEqual(runtime.errors, []);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); }
  const { PGlite } = require('@electric-sql/pglite'), { PostgresDatabase } = require('../src/db/postgres'), engine = new PGlite();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: (result?.rows || []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : value]))), rowCount: result?.affectedRows || result?.rows?.length || 0 };
  };
  const pg = new PostgresDatabase({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  try {
    await require('../src/db/migrate-postgres').migrate(pg); await pg.transaction(() => require('../src/db/seed').seedDatabase(pg));
    const service = new RequisitionService(pg);
    const own = await service.createRequisition({ title: 'PG scope own', departmentId: 'dept-3', hiringManagerId: 'usr-hiring-mgr', headcount: 1 });
    const foreign = await service.createRequisition({ title: 'PG scope foreign', departmentId: 'dept-2', hiringManagerId: 'usr-hr-mgr', headcount: 1 });
    const a = await service.createCandidate({ fullName: 'PG scope own', email: 'pg-own@example.test', requisitionId: own.data.id });
    const b = await service.createCandidate({ fullName: 'PG scope foreign', email: 'pg-foreign@example.test', requisitionId: foreign.data.id });
    await service.createInterview({ candidateId: b.data.id, interviewerId: 'usr-interviewer', scheduledTime: '2027-01-01T12:00:00Z' });
    await test('PostgreSQL Hiring Manager scope includes only owned requisition candidates', async () => {
      const response = await service.getCandidates({ search: 'PG scope', viewer: { id: 'usr-hiring-mgr', roles: ['HIRING_MGR'] } });
      assert.deepEqual(response.candidates.map(row => row.id), [a.data.id]);
      assert.equal(await service.canReadHiringRequisition(own.data.id, 'usr-hiring-mgr'), true);
      assert.equal(await service.canReadHiringRequisition(foreign.data.id, 'usr-hiring-mgr'), false);
      const requests = await service.getRequisitions({ hiringManagerId: 'usr-hiring-mgr' });
      assert.equal(requests.items.some(row => row.id === own.data.id), true); assert.equal(requests.items.some(row => row.id === foreign.data.id), false);
    });
    await test('PostgreSQL Interviewer visibility follows actual interview assignment', async () => {
      const response = await service.getCandidates({ search: 'PG scope', viewer: { id: 'usr-interviewer', roles: ['INTERVIEWER'] } });
      assert.deepEqual(response.candidates.map(row => row.id), [b.data.id]);
    });
    await test('PostgreSQL Candidate visibility is case-insensitive own email only', async () => {
      const response = await service.getCandidates({ search: 'PG scope', viewer: { id: 'usr-candidate', email: 'PG-OWN@EXAMPLE.TEST', roles: ['CANDIDATE'] } });
      assert.deepEqual(response.candidates.map(row => row.id), [a.data.id]);
    });
    await test('PostgreSQL visibility preserves role union and rejects unknown role scope', async () => {
      await service.createInterview({ candidateId: b.data.id, interviewerId: 'usr-hiring-mgr', scheduledTime: '2027-01-01T12:00:00Z' });
      const response = await service.getCandidates({ search: 'PG scope', viewer: { id: 'usr-hiring-mgr', roles: ['HIRING_MGR', 'INTERVIEWER'] } });
      assert.deepEqual(response.candidates.map(row => row.id).sort(), [a.data.id, b.data.id].sort());
      assert.deepEqual((await service.getCandidates({ viewer: { id: 'usr-hiring-mgr', roles: ['UNRELATED_ROLE'] } })).candidates, []);
    });
  } finally { await pg.close(); }
  console.log('REQUISITION_ACCESS_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed })); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
