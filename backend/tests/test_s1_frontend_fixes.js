const assert = require('node:assert/strict');
const vm = require('node:vm');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('S1_FRONTEND_FIXES');

async function login(app, email = 'admin@company.com') {
  const f = await createFrontendRuntime(app.base);
  f.nodes.get('email').value = email;
  f.nodes.get('password').value = 'Ats@123456';
  await f.nodes.get('login-form').dispatch('submit');
  await f.settle();
  assert.ok(f.storage.get('ats_token'));
  assert.deepEqual(f.errors, []);
  return f;
}

function pagination(f, total, page = 1) {
  const pages = Math.max(1, Math.ceil(total / 20));
  const first = total ? (page - 1) * 20 + 1 : 0;
  const last = Math.min(page * 20, total);
  assert.equal(f.nodes.get('users-total-badge').textContent, `${total} tài khoản`);
  assert.equal(f.nodes.get('users-page-info').textContent, `Hiển thị ${first} - ${last} trên ${total} tài khoản`);
  assert.equal(f.nodes.get('users-current-page-badge').textContent, `${page} / ${pages}`);
  assert.equal(f.nodes.get('users-prev-btn').disabled, page === 1);
  assert.equal(f.nodes.get('users-next-btn').disabled, page === pages);
  assert.doesNotMatch(f.nodes.get('users-page-info').textContent, /NaN|undefined/);
  assert.deepEqual(f.errors, []);
}

async function main() {
  const app = await openApplication();
  try {
    const f = await login(app);
    await test('S1-08', 'AC4', '25 seeded users: page 1 -> page 2 -> previous, using real API/DOM', async () => {
      const response = await app.api('GET', '/admin/users?page=1&limit=20', f.storage.get('ats_token'));
      assert.equal(response.status, 200);
      assert.equal(response.data.data.pagination.totalItems, 25);
      pagination(f, 25);
      const before = f.requests.filter(r => r.path === '/api/v1/admin/users').length;
      await f.nodes.get('users-next-btn').dispatch('click'); await f.settle();
      pagination(f, 25, 2);
      assert.equal(f.requests.filter(r => r.path === '/api/v1/admin/users').length, before + 1);
      await f.nodes.get('users-prev-btn').dispatch('click'); await f.settle(); pagination(f, 25);
    });

    const hash = (await app.db.prepare("SELECT password_hash FROM users WHERE email='admin@company.com'").get()).password_hash;
    for (const total of [0, 1, 20, 21, 25]) {
      const prefix = `pagination-fixture-${total}-`;
      for (let i = 0; i < total; i++) {
        (await app.db.prepare('INSERT INTO users (id,email,full_name,password_hash,status) VALUES (?,?,?,?,?)')
          .run(prefix + i, prefix + i + '@test.example', prefix + i, hash, 'ACTIVE'));
      }
      await test('S1-08', 'AC3/AC4', `${total} matching users: search resets page; exact first/last range`, async () => {
        f.nodes.get('users-search-input').value = prefix;
        await f.nodes.get('users-search-btn').dispatch('click'); await f.settle();
        pagination(f, total);
        const result = await app.api('GET', '/admin/users?limit=20&search=' + prefix, f.storage.get('ats_token'));
        assert.equal(result.data.data.pagination.totalItems, total);
        if (total > 20) {
          await f.nodes.get('users-next-btn').dispatch('click'); await f.settle(); pagination(f, total, 2);
        }
        await f.nodes.get('users-search-btn').dispatch('click'); await f.settle(); pagination(f, total);
      });
    }

    await test('S1-05', 'ADMIN policy', 'ADMIN retains user.read access after its explicit grant is revoked', async () => {
      const grant = await app.db.prepare("SELECT * FROM role_permissions WHERE role_id='role-admin' AND permission_id='perm-user-read'").get();
      assert.ok(grant);
      await app.db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(grant.role_id, grant.permission_id);
      try {
        const response = await app.api('GET', '/admin/users?page=1&limit=20', f.storage.get('ats_token'));
        assert.equal(response.status, 200);
        await f.nodes.get('users-search-btn').dispatch('click'); await f.settle();
        assert.doesNotMatch(f.nodes.get('users-table-body').innerHTML, /Đang tải|Bạn không có quyền/);
        assert.deepEqual(f.errors, []);
      } finally {
        await app.db.prepare('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)').run(grant.role_id, grant.permission_id);
      }
    });

    await test('S1-05', 'AC3', 'Real HR_MANAGER user.read denial ends loading, clears stale rows and renders exact Vietnamese message', async () => {
      const hr = await login(app, 'hrmanager@company.com');
      const grant = await app.db.prepare("SELECT rp.* FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.code='HR_MANAGER' AND p.code='user.read'").get();
      assert.ok(grant);
      await app.db.prepare('DELETE FROM role_permissions WHERE role_id=? AND permission_id=?').run(grant.role_id, grant.permission_id);
      try {
        assert.equal((await app.api('GET', '/admin/users?page=1&limit=20', hr.storage.get('ats_token'))).status, 403);
        await hr.nodes.get('users-search-btn').dispatch('click'); await hr.settle();
        const row = hr.nodes.get('users-table-body').innerHTML;
        assert.ok(row.includes('Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: user.read).'));
        assert.doesNotMatch(row, /Đang tải|data-user-id/);
        assert.equal(hr.nodes.get('users-prev-btn').disabled, true);
        assert.equal(hr.nodes.get('users-next-btn').disabled, true);
        assert.deepEqual(hr.errors, []);
      } finally {
        await app.db.prepare('INSERT INTO role_permissions (role_id,permission_id) VALUES (?,?)').run(grant.role_id, grant.permission_id);
      }
    });

    for (const target of ['https://example.com/admin/users', '//example.com/admin/users', '/\\example.com/admin/users', '/missing-home', '/login']) {
      await test('S1-01/S1-07', 'safe destination', `Reject unsafe/unknown/public home and recovery target ${target}`, async () => {
        const hr = await login(app, 'hrmanager@company.com');
        hr.context.untrustedHome = target;
        vm.runInContext('currentAuthenticatedHome = untrustedHome', hr.context);
        hr.window.ATS_ROUTER.navigate('/login'); await hr.settle();
        assert.equal(hr.window.location.pathname, '/dashboard');
        hr.context.untrustedRecovery = { statusCode: 403, recovery: { action: 'NAVIGATE_HOME', suggestedPath: target } };
        vm.runInContext('showErrorView(untrustedRecovery)', hr.context);
        await hr.nodes.get('error-primary-btn').dispatch('click'); await hr.settle();
        assert.equal(hr.window.location.pathname, '/dashboard');
        assert.equal(hr.nodes.get('dashboard-view').classList.contains('hidden'), false);
        assert.deepEqual(hr.errors, []);
      });
    }

    for (const [path, email, view] of [['/admin', 'admin@company.com', 'users'], ['/recruitment', 'recruiter@company.com', 'requisitions'], ['/hiring', 'hiringmgr@company.com', 'requisitions']]) {
      await test('S1-01', 'alias/deep link', `${path}: direct GET, login and refresh resolve existing authorized view`, async () => {
        assert.equal((await fetch(app.base + path, { headers: { Accept: 'text/html' } })).status, 200);
        const runtime = await createFrontendRuntime(app.base, path);
        assert.equal(runtime.window.location.pathname, '/login');
        runtime.nodes.get('email').value = email; runtime.nodes.get('password').value = 'Ats@123456';
        await runtime.nodes.get('login-form').dispatch('submit'); await runtime.settle();
        assert.equal(runtime.window.location.pathname, path);
        const reloaded = await createFrontendRuntime(app.base, path, [...runtime.storage.entries()]);
        assert.equal(reloaded.window.location.pathname, path);
        assert.equal(reloaded.nodes.get(view + '-view').classList.contains('hidden'), false);
        assert.deepEqual(reloaded.errors, []);
      });
    }

    await test('S1-01', 'alias RBAC', 'Recruiter cannot bypass user.read via /admin alias', async () => {
      const recruiter = await login(app, 'recruiter@company.com');
      recruiter.window.ATS_ROUTER.navigate('/admin'); await recruiter.settle();
      assert.equal(recruiter.nodes.get('error-code-display').textContent, 403);
      assert.equal(recruiter.nodes.get('users-view').classList.contains('hidden'), true);
      assert.deepEqual(recruiter.errors, []);
    });

    await test('S1-02/S1-05', 'session compatibility', 'Expired session during Users reload still cleans session and returns to login', async () => {
      (await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(new Date(Date.now() - 1000).toISOString(), f.storage.get('ats_token')));
      await f.nodes.get('users-search-btn').dispatch('click'); await f.settle();
      assert.equal(f.storage.has('ats_token'), false);
      assert.equal(f.window.location.pathname, '/login');
      assert.equal(f.nodes.get('alert-title').textContent, 'Phiên làm việc hết hạn');
      assert.doesNotMatch(f.nodes.get('users-table-body').innerHTML, /Đang tải/);
      assert.deepEqual(f.errors, []);
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
