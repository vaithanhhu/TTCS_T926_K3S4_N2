const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('S1_COVERAGE');

const roles = [
  ['ADMIN', 'admin@company.com', 'Quản trị viên'],
  ['HR_MANAGER', 'hrmanager@company.com', 'Trưởng phòng Nhân sự'],
  ['RECRUITER', 'recruiter@company.com', 'Chuyên viên Tuyển dụng'],
  ['HIRING_MGR', 'hiringmgr@company.com', 'Trưởng bộ phận'],
  ['INTERVIEWER', 'interviewer@company.com', 'Người phỏng vấn'],
  ['APPROVER', 'approver@company.com', 'Cấp phê duyệt'],
  ['CANDIDATE', 'candidate@example.com', 'Ứng viên']
];

async function frontend(base, email, width = 1280) {
  const runtime = await createFrontendRuntime(base, '/login', [], { width, height: 800 });
  runtime.nodes.get('email').value = email;
  runtime.nodes.get('password').value = 'Ats@123456';
  await runtime.nodes.get('login-form').dispatch('submit');
  await runtime.settle();
  assert.ok(runtime.storage.get('ats_token'));
  assert.equal(runtime.requests.filter(row => row.path === '/api/v1/auth/login').length, 1);
  assert.deepEqual(runtime.errors, []);
  return runtime;
}

function viewId(view) {
  return ({ candidatePortal: 'candidate-portal', questionBank: 'question-bank',
    recruitmentCatalogs: 'recruitment-catalogs', careerPage: 'career-page' })[view] || view;
}
function shown(runtime, id) {
  assert.equal(runtime.nodes.get(id).classList.contains('hidden'), false, id + ' must be visible');
}
function renderHttpError(runtime, response) {
  // Exercise the real error renderer with a real server response, not a fabricated API result.
  runtime.context.coverageHttpError = { ...response.data, statusCode: response.status };
  vm.runInContext('showErrorView(coverageHttpError)', runtime.context);
  assert.equal(runtime.nodes.get('error-code-display').textContent, response.status);
  shown(runtime, 'error-view');
}

async function main() {
  const app = await openApplication();
  const manifest = JSON.parse(fs.readFileSync(path.join(app.root, 'frontend/routes.json'), 'utf8'));
  try {
    for (const [role, email] of roles) {
      await test('S1-01', 'AC1', 'Real login/router reaches role home: ' + role, async () => {
        const f = await frontend(app.base, email);
        const session = await app.api('GET', '/auth/me', f.storage.get('ats_token'));
        assert.equal(session.status, 200);
        assert.ok(session.data.data.user.roles.includes(role));
        // The existing role/defaultHome contract is the oracle, not the router's own hardcoded home.
        const expected = (await app.db.prepare('SELECT default_path FROM roles WHERE code=?').get(role)).default_path;
        assert.equal(f.window.location.pathname, expected, role + ' must reach its configured home');
        const route = manifest.routes.find(row => row.path === expected);
        assert.ok(route, role + ' home must resolve to a real frontend route');
        shown(f, viewId(route.view) + '-view');
        assert.equal(f.nodes.get('error-view').classList.contains('hidden'), true);
      });
    }

    await test('S1-02', 'AC3', 'Expired real session -> heartbeat -> cleanup -> login notice', async () => {
      const f = await frontend(app.base, 'hrmanager@company.com');
      const token = f.storage.get('ats_token');
      (await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(Date.now() - 1000).toISOString(), token));
      const response = await app.api('GET', '/auth/me', token);
      assert.equal(response.status, 401); assert.equal(response.data.code, 'SESSION_EXPIRED');
      // The endpoint removes expired sessions. Reinsert the same isolated session with an expired
      // deadline so the actual frontend heartbeat independently receives SESSION_EXPIRED as well.
      const user = (await app.db.prepare("SELECT id FROM users WHERE email='hrmanager@company.com'").get());
      (await app.db.prepare('INSERT INTO sessions (id,user_id,token,expires_at) VALUES (?,?,?,?)')
        .run('coverage-expired-session', user.id, token, new Date(Date.now() - 1000).toISOString()));
      const heartbeat = [...f.intervals.values()]; assert.equal(heartbeat.length, 1);
      await heartbeat[0](); await f.settle();
      for (const key of ['ats_token', 'ats_user', 'ats_expires_at']) assert.equal(f.storage.has(key), false);
      assert.equal(f.intervals.size, 0);
      assert.equal(f.window.location.pathname, '/login'); shown(f, 'login-view'); shown(f, 'alert-box');
      assert.equal(f.nodes.get('app-shell').classList.contains('hidden'), true);
      assert.equal(f.nodes.get('alert-title').textContent, 'Phiên làm việc hết hạn');
      assert.equal(f.nodes.get('alert-message').textContent,
        'Phiên đăng nhập của bạn đã hết hạn do không hoạt động. Vui lòng đăng nhập lại để tiếp tục công việc.');
      assert.deepEqual(f.errors, []);
    });

    await test('S1-05', 'AC3', 'Real denied request is rendered as specific Vietnamese feedback', async () => {
      const f = await frontend(app.base, 'hrmanager@company.com');
      const permission = (await app.db.prepare("SELECT * FROM role_permissions WHERE role_id='role-hr-mgr' AND permission_id='perm-user-read'").get());
      assert.ok(permission);
      (await app.db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(permission.role_id, permission.permission_id));
      try {
        const denied = await app.api('GET', '/admin/users', f.storage.get('ats_token'));
        assert.equal(denied.status, 403);
        const message = 'Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: user.read).';
        assert.equal(denied.data.message, message);
        let received;
        const getUsers = f.window.ATS_API.getUsersApi;
        // Passive observation only: call the original API, return its unmodified real response.
        f.window.ATS_API.getUsersApi = async (...args) => { received = await getUsers(...args); return received; };
        const before = f.nodes.get('toast-container').children.length;
        f.window.ATS_ROUTER.navigate('/admin/users'); await f.settle();
        assert.equal(received.status, 403); assert.equal(received.data.message, message);
        const notices = f.nodes.get('toast-container').children.slice(before);
        const inline = f.nodes.get('users-table-body').innerHTML;
        const errorMessage = f.nodes.get('error-view').classList.contains('hidden') ? '' : f.nodes.get('error-message-display').textContent;
        assert.ok(notices.some(item => item.innerHTML.includes(message)) || inline.includes(message) || errorMessage.includes(message),
          'Received real 403 but no Vietnamese denial is rendered; table=' + inline);
        assert.deepEqual(f.errors, []);
      } finally {
        (await app.db.prepare('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)').run(permission.role_id, permission.permission_id));
      }
    });

    for (const [role, email, label] of roles) {
      await test('S1-06', 'AC1/AC2', 'Shell identity and real permission-filtered DOM: ' + role, async () => {
        const f = await frontend(app.base, email, 360);
        const token = f.storage.get('ats_token');
        const profile = await app.api('GET', '/profile', token); assert.equal(profile.status, 200);
        assert.equal(f.nodes.get('topbar-user-name').textContent, profile.data.data.fullName);
        assert.equal(f.nodes.get('sidebar-user-name').textContent, profile.data.data.fullName);
        assert.equal(f.nodes.get('sidebar-user-role').textContent, label);
        const menu = await app.api('GET', '/navigation/menu', token); assert.equal(menu.status, 200);
        const allowed = new Set(menu.data.menuItems.map(item => item.path));
        for (const node of f.nodes.values()) {
          if (!node.classes.has('nav-link')) continue;
          const route = manifest.routes.find(item => item.view === node.getAttribute('data-view'));
          assert.ok(route, 'Navigation item must reference a real route');
          assert.equal(node.classList.contains('hidden'), !allowed.has(route.path), role + ' visibility ' + route.path);
          assert.equal(node.style.display === 'none', !allowed.has(route.path));
        }
        assert.deepEqual(f.errors, []);
      });
    }
    await test('S1-06', 'AC3 automated portion', '360px real drawer opens/closes, title/account retained, no DOM duplication', async () => {
      const f = await frontend(app.base, 'hrmanager@company.com', 360);
      const trigger = f.nodes.get('sidebar-toggle-btn');
      const count = f.nodes.size;
      await trigger.dispatch('click');
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      assert.ok(f.nodes.get('app-sidebar').classList.contains('show-mobile'));
      shown(f, 'sidebar-backdrop');
      assert.ok(f.nodes.get('mobile-page-title').textContent);
      assert.ok(f.nodes.get('user-menu-btn'));
      await f.document.dispatch('keydown', { key: 'Escape' });
      assert.equal(trigger.getAttribute('aria-expanded'), 'false');
      assert.equal(f.nodes.get('sidebar-backdrop').classList.contains('hidden'), true);
      assert.equal(f.nodes.size, count); assert.deepEqual(f.errors, []);
      // Real CSS geometry/usability remains VISUAL/MANUAL ACCEPTANCE, not claimed by this DOM.
    });

    for (const status of [401, 403, 404]) {
      await test('S1-07', 'AC1/AC2', status + ' real error -> primary recovery click -> destination page', async () => {
        const f = await frontend(app.base, 'hrmanager@company.com');
        const token = f.storage.get('ats_token');
        const response = status === 401 ? await app.api('GET', '/admin/users', 'invalid-coverage-token')
          : status === 403 ? await app.api('POST', '/admin/users/test-create', token, {})
            : await app.api('GET', '/coverage-resource-does-not-exist', token);
        assert.equal(response.status, status); renderHttpError(f, response);
        await f.nodes.get('error-primary-btn').dispatch('click'); await f.settle();
        const expected = status === 401 ? '/login' : '/dashboard';
        assert.equal(f.window.location.pathname, expected);
        shown(f, status === 401 ? 'login-view' : 'dashboard-view');
        assert.equal(f.nodes.get('error-view').classList.contains('hidden'), true);
        if (status === 401) assert.equal(f.storage.has('ats_token'), false);
        assert.deepEqual(f.errors, []);
      });
    }
    await test('S1-07', 'AC2', 'Approver 403 recovery honors server role-home destination', async () => {
      const f = await frontend(app.base, 'approver@company.com');
      const response = await app.api('GET', '/admin/users', f.storage.get('ats_token'));
      assert.equal(response.status, 403); assert.equal(response.data.recovery.suggestedPath, '/approvals');
      renderHttpError(f, response); await f.nodes.get('error-primary-btn').dispatch('click'); await f.settle();
      assert.equal(f.window.location.pathname, '/approvals'); shown(f, 'approvals-view');
      assert.equal(f.nodes.get('error-view').classList.contains('hidden'), true);
    });

    let created;
    await test('S1-08', 'AC1 automated portion', 'Create -> actual simulated activation dispatch -> persisted ACTIVE -> temporary login', async () => {
      const admin = await app.login('admin@company.com');
      const res = await app.api('POST', '/admin/users', admin.token, {
        fullName: 'Coverage Activation User', email: 'coverage.activation@test.example',
        jobTitle: 'Internal interviewer', departmentName: 'Coverage department', roleCode: 'INTERVIEWER'
      });
      assert.equal(res.status, 201); created = res.data.data;
      assert.equal(created.activationEmail.recipient, 'coverage.activation@test.example');
      assert.ok(created.activationEmail.body.includes(created.temporaryPassword));
      const row = (await app.db.prepare('SELECT * FROM users WHERE id=?').get(created.user.id));
      assert.equal(row.status, 'ACTIVE'); assert.ok(row.password_hash !== created.temporaryPassword);
      const { verifyPassword } = require('../src/utils/password');
      assert.ok(verifyPassword(created.temporaryPassword, row.password_hash));
      await new Promise(resolve => setImmediate(resolve));
      const mail = require('../src/services/emailService').getEmailService(app.db).sentEmails
        .find(item => item.to === created.user.email && item.templateName === 'ACCOUNT_ACTIVATION');
      assert.ok(mail, 'Actual createUser must dispatch through the configured simulated EmailService');
      assert.ok(mail.content.includes(created.temporaryPassword));
      assert.equal(mail.mode, 'simulated'); assert.equal(mail.delivered, false);
      const session = await app.login(created.user.email, created.temporaryPassword);
      assert.equal(session.user.id, created.user.id); assert.ok(session.user.roles.includes('INTERVIEWER'));
    });
    await test('S1-08', 'AC1 automated portion', 'First temporary login can change password; persisted hash/new login replaces temporary password', async () => {
      assert.ok(created, 'Account creation prerequisite');
      const session = await app.login(created.user.email, created.temporaryPassword);
      const password = 'CoverageNew@123456';
      const changed = await app.api('POST', '/auth/change-password', session.token, {
        currentPassword: created.temporaryPassword, newPassword: password
      });
      assert.equal(changed.status, 200);
      const old = await app.api('POST', '/auth/login', null, { email: created.user.email, password: created.temporaryPassword });
      assert.equal(old.status, 401);
      const current = await app.login(created.user.email, password); assert.equal(current.user.id, created.user.id);
      const row = (await app.db.prepare('SELECT password_hash FROM users WHERE id=?').get(created.user.id));
      assert.ok(require('../src/utils/password').verifyPassword(password, row.password_hash));
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
