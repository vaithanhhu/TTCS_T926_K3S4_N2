const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('REVIEW_UPDATES');

async function frontend(app, email = 'admin@company.com', password = 'Ats@123456') {
  const f = await createFrontendRuntime(app.base);
  f.nodes.get('email').value = email; f.nodes.get('password').value = password;
  await f.nodes.get('login-form').dispatch('submit'); await f.settle();
  assert.deepEqual(f.errors, []); return f;
}

async function main() {
  const app = await openApplication();
  const AuthService = require('../src/services/authService');
  const UserService = require('../src/services/userService');
  const admin = await app.login('admin@company.com');
  const known = 'hrmanager@company.com', unknown = 'review.unknown@test.example';
  try {
    await test('REQ1', 'server attempts/enumeration', 'Known and unknown email have identical public countdown and lockout for five failures', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const a = await app.api('POST', '/auth/login', null, { email: known, password: 'Incorrect@12345' });
        const b = await app.api('POST', '/auth/login', null, { email: unknown, password: 'Incorrect@12345' });
        assert.deepEqual(a, b);
        assert.equal(a.data.remainingAttempts, 5 - attempt);
        assert.equal(a.status, attempt < 5 ? 401 : 423);
      }
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get(unknown)).n, 0);
      assert.equal((await app.db.prepare('SELECT failed_attempts FROM users WHERE email=?').get(known)).failed_attempts, 5);
    });
    await test('REQ1', 'durability/expiry', 'Lock survives new service instance; expired lock resets both known and unknown counters', async () => {
      const service = new AuthService(app.db);
      assert.equal((await service.login(unknown, 'Incorrect@12345')).statusCode, 423);
      (await app.db.prepare('UPDATE users SET locked_until=? WHERE email=?').run(new Date(Date.now() - 1000).toISOString(), known));
      (await app.db.prepare("UPDATE login_audit_logs SET attempted_at=datetime('now','-16 minutes') WHERE email=? AND reason='LOGIN_ATTEMPTS_LIMIT'").run(unknown));
      const a = await app.api('POST', '/auth/login', null, { email: known, password: 'Incorrect@12345' });
      const b = await app.api('POST', '/auth/login', null, { email: unknown, password: 'Incorrect@12345' });
      assert.deepEqual(a, b); assert.equal(a.data.remainingAttempts, 4);
      await app.login(known);
      assert.equal((await app.db.prepare('SELECT failed_attempts FROM users WHERE email=?').get(known)).failed_attempts, 0);
    });
    await test('REQ1', 'frontend', 'Login renders the actual server countdown rather than calculating its own', async () => {
      const f = await createFrontendRuntime(app.base); let received;
      const login = f.window.ATS_API.loginApi;
      f.window.ATS_API.loginApi = async (...args) => { received = await login(...args); return received; };
      f.nodes.get('email').value = 'countdown.ui@test.example'; f.nodes.get('password').value = 'Wrong@123';
      for (let attempt = 0; attempt < 2; attempt++) {
        await f.nodes.get('login-form').dispatch('submit'); await f.settle();
        assert.ok(f.nodes.get('alert-message').textContent.includes(`Bạn còn ${received.data.remainingAttempts} lần thử`));
      }
      assert.deepEqual(f.errors, []);
    });

    const responses = {};
    await test('REQ2', 'HTTP semantics', '400/401/403/404 remain JSON API errors with correct HTTP codes', async () => {
      const bad = await fetch(app.base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
      assert.equal(bad.status, 400); responses[400] = { status: bad.status, data: await bad.json() };
      responses[401] = await app.api('GET', '/admin/users', 'invalid-review-session');
      const hr = await app.login(known);
      responses[403] = await app.api('GET', '/admin/audit-logs', hr.token);
      const missing = await fetch(app.base + '/api/v1/not-a-real-api', { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } });
      assert.equal(missing.status, 404); assert.match(missing.headers.get('content-type'), /application\/json/);
      responses[404] = { status: missing.status, data: await missing.json() };
      for (const status of [400, 401, 403, 404]) assert.equal(responses[status].status, status);
    });
    await test('REQ2', 'browser deep link', 'Unknown browser document gets HTTP 404 and existing shell; actual runtime renders 404 without protected requests', async () => {
      const url = '/dashboah/user1';
      const response = await fetch(app.base + url, { headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } });
      assert.equal(response.status, 404); assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), fs.readFileSync(path.join(app.root, 'frontend/index.html'), 'utf8'));
      const f = await createFrontendRuntime(app.base, url);
      assert.equal(f.nodes.get('error-code-display').textContent, 404);
      assert.equal(f.nodes.get('error-view').classList.contains('hidden'), false);
      assert.equal(f.nodes.get('app-shell').classList.contains('error-only-shell'), true);
      assert.equal(f.requests.some(r => r.path === '/api/v1/dashboard/stats'), false);
      assert.deepEqual(f.errors, []);
    });
    await test('REQ2', 'server boundary', 'Unhandled service failure is safe JSON HTTP 500, with no SQL/path/stack in response', async () => {
      const original = AuthService.prototype.validateSession;
      AuthService.prototype.validateSession = () => { throw new Error('SELECT secret FROM users A:/private/database.js sensitive-stack'); };
      try {
        responses[500] = await app.api('GET', '/profile', admin.token);
        assert.equal(responses[500].status, 500);
        assert.equal(responses[500].data.code, 'INTERNAL_SERVER_ERROR');
        assert.doesNotMatch(JSON.stringify(responses[500].data), /SELECT|private|sensitive-stack/);
      } finally { AuthService.prototype.validateSession = original; }
    });
    await test('REQ2', 'API-to-error-page', 'Actual Users API HTTP 500 automatically renders safe server error page', async () => {
      const f = await frontend(app);
      const original = UserService.prototype.getUsers;
      UserService.prototype.getUsers = () => { throw new Error('SQL private server path'); };
      try {
        f.window.ATS_ROUTER.navigate('/admin/users'); await f.settle();
        assert.equal(f.nodes.get('error-code-display').textContent, 500);
        assert.equal(f.nodes.get('error-view').classList.contains('hidden'), false);
        assert.equal(f.nodes.get('error-view').dataset.category, 'SERVER_ERROR');
        assert.doesNotMatch(f.nodes.get('error-message-display').textContent, /SQL|private|path/);
        assert.deepEqual(f.errors, []);
      } finally { UserService.prototype.getUsers = original; }
    });
    for (const status of [400, 401, 403, 404, 500]) {
      await test('REQ2', 'error UI/recovery', `${status}: real response renders category/title/message and recovery works`, async () => {
        const f = await frontend(app, known);
        f.context.reviewError = { ...responses[status].data, statusCode: status,
          ...(status === 500 ? { message: 'SELECT private SQL A:/secret', heading: 'Internal secret', code: 'SECRET_SQL' } : {}) };
        vm.runInContext('showErrorView(reviewError)', f.context);
        assert.equal(f.nodes.get('error-code-display').textContent, status);
        assert.equal(f.nodes.get('error-view').dataset.category, status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR');
        if (status === 500) assert.doesNotMatch(f.nodes.get('error-message-display').textContent, /SELECT|private|SQL/);
        assert.ok(f.nodes.get('error-heading-display').textContent.includes(String(status)));
        await f.nodes.get('error-primary-btn').dispatch('click'); await f.settle();
        assert.equal(f.window.location.pathname, status === 401 ? '/login' : '/dashboard');
        assert.deepEqual(f.errors, []);
      });
    }
    await test('REQ3', 'shared design/compatibility', 'Shared CSS retains vanilla tokens, responsive geometry and accessible focus without React dependency', async () => {
      const css = fs.readFileSync(path.join(app.root, 'frontend/css/style.css'), 'utf8');
      const pkg = JSON.parse(fs.readFileSync(path.join(app.root, 'package.json'), 'utf8'));
      assert.ok(!pkg.dependencies.react && !pkg.dependencies.antd);
      assert.match(css, /\.app-shell \.btn:focus-visible/); assert.match(css, /outline-offset: 2px/);
      assert.match(css, /\.app-shell \.data-table td \{ line-height: 1.5; \}/);
      for (const width of [320, 360, 768, 1920]) {
        const f = await createFrontendRuntime(app.base, '/dashboard', [['ats_token', admin.token]], { width, height: 800 });
        assert.equal(f.nodes.get('dashboard-view').classList.contains('hidden'), false);
        assert.deepEqual(f.errors, []);
      }
      // CSS/DOM contracts above are not visual acceptance.
    });

    await test('REQ4', 'email encoding/templates', 'All four real template paths preserve Vietnamese/links/OTP/credentials with inline email-safe fonts and no emoji', async () => {
      const { EmailService } = require('../src/services/emailService');
      const service = new EmailService(app.db); service.mode = 'smtp'; const outgoing = [];
      service.transporter = { async sendMail(message) { outgoing.push(message); return { accepted: [message.to], messageId: 'offline-review-mail' }; } };
      await service.sendPasswordResetEmail('mail@test.example', 'review-reset-token', new Date(Date.now() + 1800000).toISOString());
      await service.sendAccountActivationEmail('mail@test.example', 'Nguyễn Văn Ánh <b>text</b>', 'Temporary@123', 'Người phỏng vấn');
      await service.sendOtpEmail('mail@test.example', '654321', 'Nguyễn Văn Ánh');
      await service.sendPasswordChangedEmail('mail@test.example', 'Nguyễn Văn Ánh');
      assert.equal(outgoing.length, 4);
      const MailComposer = require('nodemailer/lib/mail-composer');
      for (const mail of outgoing) {
        assert.doesNotMatch(mail.subject + mail.html, /\p{Extended_Pictographic}/u);
        assert.match(mail.html, /<meta charset="utf-8">/); assert.match(mail.html, /<body[^>]+style="[^\"]*font-family: Arial, Helvetica, sans-serif/);
        assert.doesNotMatch(mail.html, /googleapis|box-shadow|\uFFFD/);
        const buffer = await new MailComposer(mail).compile().build();
        assert.match(buffer.toString(), /charset=utf-8/i);
      }
      assert.match(outgoing[0].html, /30 phút/); assert.match(outgoing[0].html, /reset_token=review-reset-token/);
      assert.match(outgoing[1].html, /Nguyễn Văn Ánh &lt;b&gt;text&lt;\/b&gt;/); assert.match(outgoing[1].text, /Nguyễn Văn Ánh <b>text<\/b>/);
      assert.match(outgoing[1].html, /Temporary@123/); assert.match(outgoing[2].html, /654321/); assert.match(outgoing[2].html, /5 phút/);
    });

    let created, temporarySession;
    await test('REQ5', 'creation/login', 'Admin-created account persists required-change flag and authenticates temporary password into restricted session', async () => {
      const response = await app.api('POST', '/admin/users', admin.token, { fullName: 'Review New User', email: 'review.new@test.example', roleCode: 'INTERVIEWER' });
      assert.equal(response.status, 201); created = response.data.data;
      assert.equal((await app.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(created.user.id)).must_change_password, 1);
      temporarySession = await app.login(created.user.email, created.temporaryPassword);
      assert.equal(temporarySession.user.mustChangePassword, true);
      const me = await app.api('GET', '/auth/me', temporarySession.token); assert.equal(me.status, 200); assert.equal(me.data.data.user.mustChangePassword, true);
    });
    await test('REQ5', 'backend no bypass', 'Restricted token cannot read or mutate normal API/legacy routes even with role permissions', async () => {
      for (const [method, route] of [['GET', '/profile'], ['GET', '/navigation/menu'], ['GET', '/permissions'], ['GET', '/dashboard/stats'], ['GET', '/health'], ['POST', '/requisitions']]) {
        const result = await app.api(method, route, temporarySession.token, method === 'POST' ? {} : undefined);
        assert.equal(result.status, 403, route); assert.equal(result.data.code, 'MUST_CHANGE_PASSWORD');
      }
      const legacy = await fetch(app.base + '/profile', { headers: { Authorization: 'Bearer ' + temporarySession.token, Accept: 'application/json' } });
      assert.equal(legacy.status, 403); assert.equal((await legacy.json()).code, 'MUST_CHANGE_PASSWORD');
      assert.equal((await new AuthService(app.db).validateSession(temporarySession.token)).valid, false);
    });
    await test('REQ5', 'frontend/deep links', 'Temporary login, attempted navigation, refresh and close all remain on required password screen', async () => {
      const f = await frontend(app, created.user.email, created.temporaryPassword);
      assert.equal(f.window.location.pathname, '/change-password');
      assert.equal(f.nodes.get('app-shell').classList.contains('password-only-shell'), true);
      assert.equal(f.requests.some(r => r.path === '/api/v1/navigation/menu'), false);
      f.window.ATS_ROUTER.navigate('/dashboard'); await f.settle(); assert.equal(f.window.location.pathname, '/change-password');
      await f.nodes.get('close-change-pwd-modal').dispatch('click'); assert.equal(f.nodes.get('change-pwd-modal').classList.contains('hidden'), false);
      const refreshed = await createFrontendRuntime(app.base, '/admin/users', [...f.storage.entries()]);
      assert.equal(refreshed.window.location.pathname, '/change-password');
      assert.equal(refreshed.requests.some(r => r.path === '/api/v1/admin/users'), false);
      assert.deepEqual(refreshed.errors, []);
    });
    await test('REQ5', 'password policy', 'Wrong current, weak and identical temporary password cannot clear restriction', async () => {
      for (const [currentPassword, newPassword] of [['wrong', 'ValidNew@123'], [created.temporaryPassword, 'short'], [created.temporaryPassword, created.temporaryPassword]]) {
        const result = await app.api('POST', '/auth/change-password', temporarySession.token, { currentPassword, newPassword });
        assert.equal(result.status, 400);
        assert.equal((await app.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(created.user.id)).must_change_password, 1);
      }
    });
    await test('REQ5', 'completion', 'Real frontend change -> logout -> new login; temporary password dies and protected profile becomes available', async () => {
      const f = await frontend(app, created.user.email, created.temporaryPassword);
      const password = 'ReviewPermanent@123';
      f.nodes.get('change-current-pwd').value = created.temporaryPassword;
      f.nodes.get('change-new-pwd').value = password; f.nodes.get('change-confirm-pwd').value = password;
      await f.nodes.get('change-pwd-form').dispatch('submit'); await f.settle();
      assert.equal(f.window.location.pathname, '/login'); assert.equal(f.storage.has('ats_token'), false);
      assert.equal((await app.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(created.user.id)).must_change_password, 0);
      const old = await app.api('POST', '/auth/login', null, { email: created.user.email, password: created.temporaryPassword }); assert.equal(old.status, 401);
      const current = await app.login(created.user.email, password); assert.equal(current.user.mustChangePassword, false);
      assert.equal((await app.api('GET', '/profile', current.token)).status, 200);
      assert.equal((await app.api('GET', '/auth/me', temporarySession.token)).status, 401);
      assert.deepEqual(f.errors, []);
    });
    await test('REQ5', 'admin reset/forgot compatibility', 'Admin reset restricts again; valid 30-minute single-use reset clears flag, replaces temporary hash and revokes sessions', async () => {
      const service = new UserService(app.db);
      const reset = (await service.resetUserPassword(created.user.id)); assert.equal(reset.success, true);
      const login = await app.login(created.user.email, reset.data.temporaryPassword); assert.equal(login.user.mustChangePassword, true);
      const token = 'review-valid-reset-token';
      (await app.db.prepare('INSERT INTO password_reset_tokens (id,user_id,token,expires_at) VALUES (?,?,?,?)')
        .run('review-reset', created.user.id, token, new Date(Date.now() + 1800000).toISOString()));
      const auth = new AuthService(app.db);
      const same = (await auth.resetPassword(token, reset.data.temporaryPassword));
      assert.equal(same.statusCode, 400); assert.equal(same.code, 'SAME_PASSWORD');
      assert.equal((await app.db.prepare('SELECT must_change_password FROM users WHERE id=?').get(created.user.id)).must_change_password, 1);
      assert.equal((await auth.resetPassword(token, 'ReviewAfterReset@123')).success, true);
      assert.equal((await auth.resetPassword(token, 'CannotReuse@123')).success, false);
      const session = await app.login(created.user.email, 'ReviewAfterReset@123'); assert.equal(session.user.mustChangePassword, false);
      assert.equal((await app.api('GET', '/profile', session.token)).status, 200);
    });
    await test('REQ5', 'logout', 'Restricted session may logout; no access remains afterwards', async () => {
      const reset = (await new UserService(app.db).resetUserPassword(created.user.id));
      const f = await frontend(app, created.user.email, reset.data.temporaryPassword);
      await f.nodes.get('forced-password-logout-btn').dispatch('click'); await f.settle();
      assert.equal(f.window.location.pathname, '/login'); assert.equal(f.storage.has('ats_token'), false); assert.deepEqual(f.errors, []);
    });
    await test('REQ5', 'legacy/migration', 'Legacy account stays unrestricted; additive migration preserves existing data and defaults flag to zero', async () => {
      assert.equal(admin.user.mustChangePassword, false);
      const { DatabaseSync } = require('node:sqlite');
      const file = path.join(app.root, 'backend/data/review-legacy.db'); const legacy = new DatabaseSync(file);
      legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,full_name TEXT,job_title TEXT,department_id TEXT,department_name TEXT,phone_number TEXT,status TEXT,lock_reason TEXT,failed_attempts INTEGER,locked_until TEXT,created_at TEXT,updated_at TEXT);
        INSERT INTO users (id,email,password_hash,full_name,status) VALUES ('legacy','legacy@test.example','preserved-hash','Existing User','ACTIVE');`); legacy.close();
      const migrated = require('../src/db/migrate').runMigrations(file);
      const row = (await migrated.prepare("SELECT * FROM users WHERE id='legacy'").get());
      assert.equal(row.password_hash, 'preserved-hash'); assert.equal(row.full_name, 'Existing User'); assert.equal(row.must_change_password, 0); migrated.close();
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
