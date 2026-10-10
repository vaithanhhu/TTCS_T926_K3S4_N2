const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-wal', 'backend/data/ats.db-shm', 'backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root, file)), false, 'Fresh isolated source copy required');
for (const name of Object.keys(process.env)) if (/^(SMTP_|MAIL_|GOOGLE_OAUTH_|DATABASE_|DB_|PG|EMAIL_|APPROVAL_|REQUISITION_APPROVAL_)/.test(name)) delete process.env[name];
Object.assign(process.env, { NODE_ENV: 'test', EMAIL_MODE: 'simulated', DB_PROVIDER: 'sqlite', APPROVAL_CONFIGURATION_ENABLED: 'true', REQUISITION_APPROVAL_ENABLED: 'true' });
const config = require('../src/config/config');
const { getDatabase } = require('../src/db/database');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { hashPassword } = require('../src/utils/password');
const results = [], accounts = [], requests = [];
const password = crypto.randomBytes(18).toString('base64url') + '!aA7';
const fixtures = [
  ['ADMIN', 'usr-admin', 'admin@company.com', '/admin'],
  ['HR_MANAGER', 'usr-hr-mgr', 'hrmanager@company.com', '/dashboard'],
  ['HIRING_MGR', 'usr-hiring-mgr', 'hiringmgr@company.com', '/hiring'],
  ['APPROVER', 'usr-approver', 'approver@company.com', '/approvals'],
  ['RECRUITER', 'usr-recruiter', 'recruiter@company.com', '/recruitment'],
  ['INTERVIEWER', 'usr-interviewer', 'interviewer@company.com', '/interviews'],
  ['CANDIDATE', 'usr-candidate', 'candidate@example.com', '/candidate']
];
async function test(name, action) {
  try { await action(); results.push({ name, status: 'PASS' }); console.log('[PASS] ' + name); }
  catch (error) { results.push({ name, status: 'FAIL', message: error.message }); console.error('[FAIL] ' + name + '\n' + error.stack); }
}
async function main() {
  assert.equal(config.DB_PROVIDER, 'sqlite');
  assert.equal(config.DATABASE_URL, '');
  assert.equal(config.EMAIL_MODE, 'simulated');
  assert.equal(config.SMTP_HOST + config.SMTP_USER + config.SMTP_PASSWORD, '');
  assert.equal(config.DB_PATH, path.join(root, 'backend/data/ats_test.db'));
  const db = getDatabase();
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
  await require('../src/db/migrate-approval-configurations').migrate(db);
  await require('../src/db/migrate-requisition-approvals').migrate(db);
  await require('../src/db/migrate-approval-configurations').verify(db);
  await require('../src/db/migrate-requisition-approvals').verify(db);
  console.log('ATS_E2E_ENV ' + JSON.stringify({ provider: config.DB_PROVIDER, database: config.DB_PATH, email: config.EMAIL_MODE, smtpConfigured: false, neon: false, s301: config.APPROVAL_CONFIGURATION_ENABLED, s302: config.REQUISITION_APPROVAL_ENABLED }));
  const { startServer, server } = require('../src/server');
  await startServer(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const sessions = {}, runtimes = {};
  async function api(method, route, role, body) {
    const started = performance.now();
    const response = await fetch(base + '/api/v1' + route, { method, headers: { ...(role ? { Authorization: 'Bearer ' + sessions[role].token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    requests.push({ method, route, role: role || 'ANONYMOUS', status: response.status, elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
    return { status: response.status, data };
  }
  async function loginRuntime(role, viewport = {}) {
    const runtime = await createFrontendRuntime(base, '/login', [], viewport);
    runtime.nodes.get('email').value = fixtures.find(row => row[0] === role)[2];
    runtime.nodes.get('password').value = password;
    await runtime.nodes.get('login-form').dispatch('submit'); await runtime.settle();
    return runtime;
  }
  const manifest = require('../../frontend/routes.json');
  try {
    for (const [role, id, email, home] of fixtures) {
      await db.prepare('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL, must_change_password=FALSE WHERE id=?').run(hashPassword(password), id);
      await test(role + ' seeded account login session and effective permissions', async () => {
        const login = await api('POST', '/auth/login', null, { email, password }); assert.equal(login.status, 200); sessions[role] = login.data.data;
        const me = await api('GET', '/auth/me', role); assert.equal(me.status, 200); assert.ok(me.data.data.user.roles.includes(role)); assert.equal(me.data.data.user.defaultHome, home);
        const menu = await api('GET', '/navigation/menu', role); assert.equal(menu.status, 200);
        accounts.push({ role, id, email, status: 'ACTIVE', home, permissions: me.data.data.user.permissions, menu: menu.data.menuItems.map(item => item.path) });
      });
      await test(role + ' frontend login renders role home full name and permitted navigation', async () => {
        const runtime = await loginRuntime(role); runtimes[role] = runtime;
        assert.equal(runtime.window.location.pathname, home); assert.equal(runtime.nodes.get('topbar-user-name').textContent, sessions[role].user.fullName); assert.ok(runtime.nodes.get('sidebar-user-role').textContent);
        const permitted = accounts.find(row => row.role === role).menu;
        for (const route of manifest.routes.filter(route => route.menu && !route.menuPath)) {
          runtime.window.ATS_ROUTER.navigate(route.path); await runtime.settle();
          const allowed = permitted.includes(route.path);
          assert.equal(runtime.nodes.get('error-view').classList.contains('hidden'), allowed, role + ' ' + route.path);
          if (!allowed) assert.equal(String(runtime.nodes.get('error-code-display').textContent), '403');
        }
        assert.deepEqual(runtime.errors, []);
      });
      await test(role + ' S3 configuration API and frontend guard agree', async () => {
        for (const route of ['/approval-configurations', '/approval-configurations/options']) assert.equal((await api('GET', route, role)).status, ['ADMIN', 'HR_MANAGER'].includes(role) ? 200 : 403);
      });
      await test(role + ' real module APIs enforce the expected role matrix', async () => {
        const matrix = [
          ['/admin/users?page=1&limit=20&role=ALL&status=ALL', ['ADMIN', 'HR_MANAGER']],
          ['/admin/roles/list', ['ADMIN', 'HR_MANAGER']], ['/departments', ['ADMIN', 'HR_MANAGER','HIRING_MGR','RECRUITER','INTERVIEWER','APPROVER']],
          ['/competency-frameworks', ['ADMIN', 'HR_MANAGER','HIRING_MGR','RECRUITER','INTERVIEWER','APPROVER']], ['/job-titles', ['ADMIN', 'HR_MANAGER','HIRING_MGR','RECRUITER','INTERVIEWER','APPROVER']],
          ['/interview-questions', ['ADMIN', 'HR_MANAGER', 'INTERVIEWER']],
          ['/recruitment-catalogs', ['ADMIN', 'HR_MANAGER', 'HIRING_MGR', 'RECRUITER','INTERVIEWER','APPROVER']],
          ['/career-page', ['ADMIN', 'HR_MANAGER']], ['/admin/audit-logs', ['ADMIN','HR_MANAGER']],
          ['/requisitions', ['ADMIN','HR_MANAGER','HIRING_MGR','RECRUITER','APPROVER']],
          ['/candidates', fixtures.map(row=>row[0])],
          ['/interviews', ['ADMIN', 'HR_MANAGER', 'HIRING_MGR', 'RECRUITER', 'INTERVIEWER', 'CANDIDATE']],
          ['/offers', ['ADMIN', 'HR_MANAGER', 'HIRING_MGR','RECRUITER', 'APPROVER', 'CANDIDATE']]
        ];
        for (const [route, roles] of matrix) assert.equal((await api('GET', route, role)).status, roles.includes(role) ? 200 : 403, role + route);
        if (['INTERVIEWER', 'CANDIDATE'].includes(role)) assert.equal(Object.hasOwn((await api('GET', '/requisitions', role)).data,'items'),false);
      });
    }
    await test('Anonymous protected APIs remain 401 and unknown API remains JSON 404', async () => {
      for (const route of ['/admin/users', '/approval-configurations', '/requisition-approvals', '/navigation/menu']) assert.equal((await api('GET', route)).status, 401);
      assert.equal((await api('GET', '/not-an-api')).status, 404);
    });
    await test('ADMIN and HR standard salary confidentiality remains a business restriction', async () => {
      assert.equal((await api('POST', '/job-titles', 'HR_MANAGER', { code: 'E2E-CONFIDENTIAL', name: 'E2E salary fixture', level: 'Senior', minSalary: 111, maxSalary: 222 })).status, 201);
      for (const role of ['ADMIN', 'HR_MANAGER']) {
        const response = await api('GET', '/job-titles', role); assert.equal(response.status, 200);
        assert.equal(response.data.jobTitles.some(row => Object.hasOwn(row, 'minSalary')), role === 'HR_MANAGER');
      }
    });
    const hr = runtimes.HR_MANAGER;
    let configuration, titleId, workflowId;
    await test('HR frontend creates and publishes persisted two-level S3-01 configuration', async () => {
      hr.window.ATS_ROUTER.navigate('/admin/approval-configurations'); await hr.settle();
      hr.nodes.get('s301-department').value = 'dept-3'; await hr.nodes.get('s301-add-level').dispatch('click');
      const levels = hr.nodes.get('s301-levels').children;
      for (const [index, salary, user] of [[0, 20000000, 'usr-hr-mgr'], [1, 50000000, 'usr-approver']]) { levels[index].querySelector('.s301-limit').value = String(salary); levels[index].querySelector('.s301-approver').value = user; }
      await hr.nodes.get('s301-form').dispatch('submit'); await hr.settle(); assert.equal(hr.nodes.get('s301-message').textContent, '');
      await hr.nodes.get('s301-publish').dispatch('click'); await hr.settle();
      const list = await api('GET', '/approval-configurations', 'ADMIN'); configuration = list.data.data.find(row => row.departmentId === 'dept-3'); assert.equal(configuration.publishedVersion, 1);
      const title = await api('POST', '/job-titles', 'HR_MANAGER', { code: 'E2E-TITLE', name: 'E2E Software Engineer', level: 'Senior', minSalary: 10000000, maxSalary: 50000000 }); assert.equal(title.status, 201); titleId = title.data.data.id;
    });
    await test('S3-01 resolver below equal above and uncovered salary validates real API', async () => {
      for (const [salary, count] of [[19000000, 1], [20000000, 1], [20000001, 2]]) { const result = await api('POST', '/approval-configurations/resolve', 'ADMIN', { departmentId: 'dept-3', proposedSalaryMax: salary }); assert.equal(result.status, 200); assert.equal(result.data.data.levels.length, count); }
      assert.equal((await api('POST', '/approval-configurations/resolve', 'ADMIN', { departmentId: 'dept-3', proposedSalaryMax: 50000001 })).status, 409);
      assert.equal((await api('POST', '/approval-configurations', 'HR_MANAGER', { departmentId: 'dept-7', levels: [{ order: 1, salaryLimit: 10, approverUserId: 'usr-approver' }, { order: 2, salaryLimit: 20, approverUserId: 'usr-approver' }] })).data.code, 'REPEATED_APPROVER_FORBIDDEN');
    });
    const valid = { formVersion: 'S2-10', departmentId: 'dept-3', jobTitleId: null, headcount: 2, recruitmentReason: 'REPLACEMENT', proposedSalaryMin: 15000000, proposedSalaryMax: 30000000, neededDate: new (require('../src/services/requisitionService'))(db).businessDate(), jobDescription: 'E2E original JD', candidateRequirements: 'E2E requirements' };
    async function createRequest() { const response = await api('POST', '/requisitions', 'HIRING_MGR', { ...valid, jobTitleId: titleId }); assert.equal(response.status, 201); assert.equal(response.data.data.status, 'OPEN'); return response.data.data.id; }
    function card(runtime, view) { return runtime.nodes.get(view + '-view').children.find(item => item.querySelectorAll('h3').length || item.children[0]?.textContent?.includes(view === 'requisitions' ? 'của tôi' : 'chờ tôi')); }
    async function openFromApprovalList(runtime, view, id) {
      runtime.window.ATS_ROUTER.navigate(view === 'approvals' ? '/approvals' : '/requisitions'); await runtime.settle();
      const panel = card(runtime, view), table = panel.children[3].children[0], body = table.children[1];
      const rows = body.children; assert.ok(rows.length > 0);
      for (const row of rows) { await row.children.at(-1).children[0].dispatch('click'); await runtime.settle(); if (runtime.nodes.get('s302-view-revision').value === (await api('GET', '/requisition-approvals/' + id, view === 'requisitions' ? 'HIRING_MGR' : runtime === hr ? 'HR_MANAGER' : 'APPROVER')).data.data.submissionId) return; }
      assert.fail('Requested workflow absent from visible list');
    }
    await test('Hiring frontend explicitly submits OPEN request and HR sees assigned first step', async () => {
      const id = await createRequest(), owner = runtimes.HIRING_MGR;
      assert.equal((await api('GET', '/requisition-approvals', 'HIRING_MGR')).data.data.length, 0);
      owner.window.ATS_ROUTER.navigate('/requisitions'); await owner.settle();
      const panel = card(owner, 'requisitions'); panel.children[1].children[0].value = id;
      await panel.children[1].children[1].dispatch('click'); await owner.settle();
      workflowId = (await api('GET', '/requisition-approvals', 'HIRING_MGR')).data.data.find(row => row.requisitionId === id).id;
      await openFromApprovalList(hr, 'approvals', workflowId); assert.equal(hr.nodes.get('s302-actions').classList.contains('hidden'), false);
      assert.match(hr.nodes.get('s302-levels').textContent, /Cấp 1:.*Chờ duyệt/);
    });
    await test('Frontend comment validation request info owner revision restart and preserved history', async () => {
      await hr.nodes.get('s302-info').dispatch('click'); assert.match(hr.nodes.get('s302-message').textContent, /ý kiến/);
      hr.nodes.get('s302-comment').value = 'E2E bổ sung mô tả'; await hr.nodes.get('s302-info').dispatch('click'); await hr.settle();
      assert.match(hr.nodes.get('s302-status').textContent, /Cần bổ sung/);
      const owner = runtimes.HIRING_MGR; await openFromApprovalList(owner, 'requisitions', workflowId);
      owner.nodes.get('s302-description').value = 'E2E revised JD';
      await Promise.all([owner.nodes.get('s302-revision-form').dispatch('submit'), owner.nodes.get('s302-revision-form').dispatch('submit')]); await owner.settle();
      const detail = (await api('GET', '/requisition-approvals/' + workflowId, 'HIRING_MGR')).data.data;
      assert.equal(detail.submissions.length, 2); assert.equal(detail.submissions[0].document.jobDescription, 'E2E original JD'); assert.equal(detail.submissions[1].document.jobDescription, 'E2E revised JD'); assert.equal(detail.steps[0].status, 'PENDING'); assert.equal(detail.steps[1].status, 'WAITING'); assert.equal(detail.events.length, 3);
    });
    await test('Frontend sequential approval reaches APPROVED without changing Sprint2 OPEN', async () => {
      await openFromApprovalList(hr, 'approvals', workflowId); await hr.nodes.get('s302-approve').dispatch('click'); await hr.settle();
      const reviewer = runtimes.APPROVER; await openFromApprovalList(reviewer, 'approvals', workflowId); await reviewer.nodes.get('s302-approve').dispatch('click'); await reviewer.settle();
      assert.match(reviewer.nodes.get('s302-status').textContent, /Đã duyệt/);
      const detail = (await api('GET', '/requisition-approvals/' + workflowId, 'HIRING_MGR')).data.data; assert.equal(detail.status, 'APPROVED'); assert.equal(detail.events.length, 5);
      assert.equal((await api('GET', '/requisitions/' + detail.requisitionId, 'HIRING_MGR')).data.data.status, 'OPEN');
    });
    await test('Frontend rejection persists comment and shows terminal REJECTED independently of Offer', async () => {
      const submit = await api('POST', '/requisition-approvals', 'HIRING_MGR', { requisitionId: await createRequest(), requestId: crypto.randomUUID() }); assert.equal(submit.status, 201);
      await openFromApprovalList(hr, 'approvals', submit.data.data.id); hr.nodes.get('s302-comment').value = 'E2E từ chối'; await hr.nodes.get('s302-reject').dispatch('click'); await hr.settle(); assert.match(hr.nodes.get('s302-status').textContent, /Đã từ chối/); assert.match(hr.nodes.get('s302-history').textContent, /E2E từ chối/);
    });
    await test('Candidate offer read contains only matching account records', async () => {
      const response = await api('GET', '/offers', 'CANDIDATE'); assert.equal(response.status, 200);
      assert.ok(response.data.offers.every(row => row.candidate.email.toLowerCase() === 'candidate@example.com'), 'Other candidates offers leaked');
    });
    await test('Read-only HIRING_MGR cannot create candidate or mutate candidate stage', async () => {
      const response = await api('POST', '/candidates', 'HIRING_MGR', { fullName: 'Denied test', email: 'denied@example.test' }); assert.equal(response.status, 403);
      assert.equal((await api('PUT', '/candidates/cand-001/stage', 'HIRING_MGR', { stage: 'HIRED' })).status, 403);
    });
    await test('Candidate cannot create or approve other peoples offers', async () => {
      const offers = await api('GET', '/offers', 'ADMIN'), target = offers.data.offers.find(row => row.candidate.email !== 'candidate@example.com'); assert.ok(target);
      const create = await api('POST', '/offers', 'CANDIDATE', { candidateId: target.candidate.id, salaryMonthly: 20000000 }); assert.equal(create.status, 403);
      assert.equal((await api('PUT', '/offers/' + target.id + '/status', 'CANDIDATE', { status: 'APPROVED' })).status, 403);
    });
    await test('Recruiter cannot use offer.read to approve an Offer', async () => {
      const offers = await api('GET', '/offers', 'ADMIN'); assert.equal((await api('PUT', '/offers/' + offers.data.offers[0].id + '/status', 'RECRUITER', { status: 'APPROVED' })).status, 403);
    });
    await test('Candidate cannot read internal recruitment analytics', async () => {
      for (const route of ['/reports/recruitment', '/dashboard/stats']) assert.equal((await api('GET', route, 'CANDIDATE')).status, 403);
    });
    await test('Interviewer cannot schedule interviews via interview.read', async () => {
      assert.equal((await api('POST', '/interviews', 'INTERVIEWER', { candidateId: 'cand-001', interviewerId: 'usr-interviewer', roundName: 'Denied', scheduledTime: '2027-01-01T12:00:00Z' })).status, 403);
    });
    await test('Candidate own profile interview and offers readback are scoped at backend', async () => {
      const candidate = await api('POST', '/candidates', 'RECRUITER', { fullName: 'E2E Candidate', email: 'candidate@example.com',requisitionId:'req-001' }); assert.equal(candidate.status, 201);
      const other = await api('POST', '/candidates', 'RECRUITER', { fullName: 'E2E Other', email: 'other@example.test',requisitionId:'req-001' }); assert.equal(other.status, 201);
      for (const id of [candidate.data.data.id, other.data.data.id]) {
        assert.equal((await api('POST', '/interviews', 'RECRUITER', { candidateId: id, interviewerId: 'usr-interviewer', roundName: 'E2E', scheduledTime: '2027-01-01T12:00:00Z' })).status, 201);
        assert.equal((await api('POST', '/offers', 'RECRUITER', { candidateId: id, salaryMonthly: 18000000, startDate: '2027-01-01' })).status, 201);
      }
      for (const [route, key] of [['/candidates', 'candidates'], ['/interviews', 'interviews'], ['/offers', 'offers']]) {
        const response = await api('GET', route, 'CANDIDATE'); assert.equal(response.status, 200); assert.ok(response.data[key].length > 0);
        assert.ok(response.data[key].every(row => (key === 'candidates' ? row.email : row.candidate.email) === 'candidate@example.com'));
      }
      const runtime = runtimes.CANDIDATE; runtime.window.ATS_ROUTER.navigate('/candidate'); await runtime.settle(); assert.equal(runtime.nodes.get('cand-portal-name').textContent, 'E2E Candidate'); assert.deepEqual(runtime.errors, []);
    });
    await test('Interview scheduling grants follow confirmed roles without expanding evaluator permissions', async () => {
      const candidateId = (await api('GET', '/candidates', 'ADMIN')).data.candidates[0].id;
      for (const [role] of fixtures) {
        const response = await api('POST', '/interviews', role, { candidateId, interviewerId: 'usr-interviewer', scheduledTime: '2027-01-02T12:00:00Z' }); assert.equal(response.status, ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role) ? 201 : 403, role);
        assert.equal(runtimes[role].nodes.get('open-create-interview-modal-btn').classList.contains('hidden'), !['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role), role);
      }
    });
    await test('Offer approval sending and candidate response enforce distinct permissions and ownership', async () => {
      const candidateId = (await api('GET', '/candidates', 'CANDIDATE')).data.candidates[0].id;
      const created = await api('POST', '/offers', 'RECRUITER', { candidateId, salaryMonthly: 18000000, startDate: '2027-01-01',approverId:'usr-approver' }); assert.equal(created.status, 201);
      const id = created.data.data.id;
      assert.equal((await api('PUT', '/offers/' + id + '/status', 'APPROVER', { status: 'SENT' })).status, 403);
      assert.equal((await api('PUT', '/offers/' + id + '/status', 'APPROVER', { status: 'APPROVED' })).status, 200);
      assert.equal((await api('PUT', '/offers/' + id + '/status', 'RECRUITER', { status: 'SENT' })).status, 200);
      assert.equal((await api('PUT', '/offers/' + id + '/status', 'CANDIDATE', { status: 'ACCEPTED' })).status, 200);
      const offers = await api('GET', '/offers', 'ADMIN'), foreign = offers.data.offers.find(row => row.candidate.email !== 'candidate@example.com');
      assert.equal((await api('PUT', '/offers/' + foreign.id + '/status', 'CANDIDATE', { status: 'ACCEPTED' })).status, 403);
      assert.equal(runtimes.RECRUITER.nodes.get('btn-action-approve-offer').classList.contains('hidden'), true);
      assert.equal(runtimes.APPROVER.nodes.get('btn-action-send-offer').classList.contains('hidden'), true);
    });
    await test('Internal plus candidate roles retain permission union navigation and refresh on heartbeat', async () => {
      const runtime = runtimes.RECRUITER, candidateRole = await db.prepare("SELECT id FROM roles WHERE code='CANDIDATE'").get();
      await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run('usr-recruiter', candidateRole.id);
      try {
        const me = await api('GET', '/auth/me', 'RECRUITER'); assert.ok(me.data.data.user.roles.includes('CANDIDATE')); assert.ok(me.data.data.user.permissions.includes('candidate.update'));
        const menu = await api('GET', '/navigation/menu', 'RECRUITER'); assert.ok(menu.data.menuItems.some(row => row.path === '/candidate')); assert.ok(menu.data.menuItems.some(row => row.path === '/candidates'));
        for (const heartbeat of [...runtime.intervals.values()]) await heartbeat(); await runtime.settle();
        assert.equal(runtime.nodes.get('nav-item-candidates').style.display, ''); assert.equal(runtime.nodes.get('nav-item-candidate-portal').style.display, '');
      } finally { await db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_id=?').run('usr-recruiter', candidateRole.id); }
      for (const heartbeat of [...runtime.intervals.values()]) await heartbeat(); await runtime.settle(); assert.equal(runtime.nodes.get('nav-item-candidate-portal').style.display, 'none');
    });
    await test('Seven roles log out and old session token cannot access protected API', async () => {
      for (const [role] of fixtures) { assert.equal((await api('POST', '/auth/logout', role, {})).status, 200); assert.equal((await api('GET', '/auth/me', role)).status, 401); }
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); }
  fs.writeFileSync(path.join(root, 'test-credentials.private.json'), JSON.stringify({ environment: 'isolated test fixtures only', password, accounts: fixtures.map(([role, id, email]) => ({ role, id, email })) }, null, 2), { mode: 0o600 });
  const { PGlite } = require('@electric-sql/pglite'), { PostgresDatabase } = require('../src/db/postgres'), engine = new PGlite();
  let tail = Promise.resolve();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: (result?.rows || []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? (result.fields.find(field => field.name === key)?.dataTypeID === 1082 ? value.toISOString().slice(0, 10) : value.toISOString()) : typeof value === 'bigint' ? Number(value) : value]))), rowCount: result?.affectedRows || result?.rows?.length || 0 };
  };
  const pg = new PostgresDatabase({}, { on() {}, query, async connect() { const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous; return { query, release }; }, async end() { await engine.close(); } });
  try {
    await require('../src/db/migrate-postgres').migrate(pg); await pg.transaction(() => require('../src/db/seed').seedDatabase(pg));
    await require('../src/db/migrate-approval-configurations').migrate(pg); await require('../src/db/migrate-requisition-approvals').migrate(pg);
    const rbac = new (require('../src/middlewares/rbacMiddleware'))(pg), service = new (require('../src/services/requisitionService'))(pg);
    await test('PostgreSQL embedded scheduling permissions and idempotent seed match SQLite', async () => {
      const before = await pg.prepare('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id,permission_id').all(); await pg.transaction(() => require('../src/db/seed').seedDatabase(pg)); assert.deepEqual(await pg.prepare('SELECT role_id,permission_id FROM role_permissions ORDER BY role_id,permission_id').all(), before);
      for (const [role, id] of fixtures) assert.equal(await rbac.hasPermission(id, 'interview.create'), ['ADMIN', 'HR_MANAGER', 'RECRUITER'].includes(role));
      assert.equal(await rbac.hasPermission('usr-hr-mgr', 'approval_configuration.manage'), true);
    });
    for (const email of ['candidate@example.com', 'other@example.test']) {
      const created = await service.createCandidate({ fullName: 'PG E2E', email }); assert.equal(created.success, true);
      await service.createInterview({ candidateId: created.data.id, interviewerId: 'usr-interviewer', scheduledTime: '2027-01-01T12:00:00Z' });
      await service.createOffer({ candidateId: created.data.id, salaryMonthly: 18000000, startDate: '2027-01-01' });
    }
    for (const [method, field] of [['getCandidates', 'candidates'], ['getInterviews', 'interviews'], ['getOffers', 'offers']]) await test('PostgreSQL embedded ' + method + ' enforces candidate scope with case-insensitive matching', async () => {
      const own = await service[method]({ candidateEmail: 'CANDIDATE@EXAMPLE.COM' }); assert.ok(own[field].length > 0);
      assert.ok(own[field].every(row => (field === 'candidates' ? row.email : row.candidate.email).toLowerCase() === 'candidate@example.com'));
      assert.deepEqual((await service[method]({ candidateEmail: 'absent@example.test' }))[field], []);
      assert.ok((await service[method]())[field].length > own[field].length);
    });
  } finally { await pg.close(); }
  const report = { provider: 'sqlite', database: config.DB_PATH, browser: 'NOT_RUN', smtp: 'simulated', accounts, requests, results, passed: results.filter(row => row.status === 'PASS').length, failed: results.filter(row => row.status === 'FAIL').length, total: results.length };
  fs.writeFileSync(path.join(root, 'ats-e2e-results.json'), JSON.stringify(report, null, 2));
  console.log('ATS_E2E_RESULT ' + JSON.stringify({ passed: report.passed, failed: report.failed, total: report.total, report: path.join(root, 'ats-e2e-results.json') })); process.exitCode = report.failed ? 1 : 0;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
