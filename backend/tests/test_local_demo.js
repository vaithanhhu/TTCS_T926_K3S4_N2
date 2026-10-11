const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
const { cases } = require('./helpers/coverageApplication');
const { test, finish } = cases('LOCAL_DEMO');
const root = path.resolve(__dirname, '../..');
const output = process.env.ATS_E2E_ARTIFACTS || path.join(root, 'test-artifacts/local-demo');
const flags = require('../src/config/local-demo').flags;
const users = { ADMIN: ['admin@company.com', '/admin'], HR_MANAGER: ['hrmanager@company.com', '/dashboard'], HIRING_MGR: ['hiringmgr@company.com', '/hiring'], APPROVER: ['approver@company.com', '/approvals'], RECRUITER: ['recruiter@company.com', '/recruitment'], INTERVIEWER: ['interviewer@company.com', '/interviews'], CANDIDATE: ['candidate@example.com', '/candidate'] };
const environment = { ...process.env, DATABASE_URL: 'postgres://invalid:invalid@127.0.0.1:1/never-connect', DB_PROVIDER: 'postgres', EMAIL_MODE: 'smtp', SMTP_HOST: 'never-connect.invalid' };
const run = () => spawnSync(process.execPath, ['backend/src/db/setup-local.js'], { cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 90000 });
async function wait(predicate) {
  const deadline = Date.now() + 15000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('LOCAL_DEMO_WAIT_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
async function main() {
  for (const file of ['.git', '.env', '.local', 'backend/data/ats.db', 'backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root, file)), false, 'Fresh isolated source required: ' + file);
  fs.mkdirSync(output, { recursive: true });
  await test('LOCAL', 'ownership', 'Setup refuses an existing database without ownership marker', async () => {
    fs.mkdirSync(path.join(root, '.local'));
    fs.writeFileSync(path.join(root, '.local/ats-demo.db'), 'foreign test fixture');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /LOCAL_DATABASE_NOT_OWNED/);
    assert.equal(fs.readFileSync(path.join(root, '.local/ats-demo.db'), 'utf8'), 'foreign test fixture');
    fs.unlinkSync(path.join(root, '.local/ats-demo.db'));
  });
  await test('LOCAL', 'setup', 'Fresh setup ignores inherited PostgreSQL and SMTP configuration', async () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /LOCAL_SETUP_RESULT/);
    assert.equal(fs.existsSync(path.join(root, 'backend/data/ats.db')), false);
  });
  const marker = JSON.parse(fs.readFileSync(path.join(root, '.local/ats-demo.json'), 'utf8'));
  const db = new DatabaseSync(path.join(root, '.local/ats-demo.db'), { readOnly: true });
  const demo = marker.demo;
  await test('LOCAL', 'database', 'Complete migrations, valid foreign keys and demo states', async () => {
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare('SELECT status FROM requisitions WHERE id=?').get(demo.draft).status, 'DRAFT');
    assert.equal(db.prepare('SELECT status FROM job_postings WHERE id=?').get(demo.postingId).status, 'PUBLISHED');
    assert.deepEqual(demo.deferred, ['S2-05-AC2', 'S2-06-AC4']);
  });
  await test('LOCAL', 'repeat', 'Repeated setup preserves rows, snapshots and marker', async () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const counts = tables.map(row => db.prepare('SELECT COUNT(*) AS n FROM "' + row.name + '"').get().n);
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(tables.map(row => db.prepare('SELECT COUNT(*) AS n FROM "' + row.name + '"').get().n), counts);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.local/ats-demo.json'), 'utf8')), marker);
  });
  await test('LOCAL', 'setup-lock', 'Concurrent setup is refused without modifying the database', async () => {
    const lock = path.join(root, '.local/setup.lock');
    fs.writeFileSync(lock, 'test fixture');
    const result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EEXIST/);
    fs.unlinkSync(lock);
  });
  fs.writeFileSync(path.join(root, '.env'), 'DB_PROVIDER=postgres\nDATABASE_URL=postgres://invalid:invalid@127.0.0.1:1/never-connect\nEMAIL_MODE=smtp\nSMTP_HOST=never-connect.invalid\nPORT=1\n');
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  let serverOutput = '';
  const child = spawn(process.execPath, ['backend/src/start-local.js'], { cwd: root, env: { ...environment, ATS_LOCAL_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { serverOutput += data; });
  child.stderr.on('data', data => { serverOutput += data; });
  let browser;
  const contexts = [], pages = {}, sessions = {}, errors = [];
  const base = 'http://127.0.0.1:' + port;
  const api = async (route, token, method = 'GET', body) => {
    const response = await fetch(base + '/api/v1' + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  try {
    await test('LOCAL', 'startup', 'Local server ignores existing .env and binds loopback with all eight flags', async () => {
      await wait(() => serverOutput.includes('LOCAL_SERVER_READY'));
      const ready = JSON.parse(serverOutput.match(/LOCAL_SERVER_READY (\{[^\n]+\})/)[1]);
      assert.equal(ready.provider, 'sqlite');
      assert.equal(ready.email, 'simulated');
      assert.deepEqual(ready.flags, flags);
      const conflict = spawnSync(process.execPath, ['backend/src/start-local.js'], { cwd: root, env: { ...environment, ATS_LOCAL_PORT: String(port) }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
      assert.equal(conflict.status, 1);
      assert.match(conflict.stderr, /EADDRINUSE/);
    });
    browser = await chromium.launch({ headless: true });
    for (const [role, [email, home]] of Object.entries(users)) {
      await test('LOCAL', 'login-' + role, 'Real browser login and role home ' + role, async () => {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Ho_Chi_Minh' });
        contexts.push(context);
        await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.fulfill({ status: 200, body: '' }));
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        pages[role] = page;
        page.on('dialog', dialog => dialog.accept());
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/login');
        await page.waitForSelector('html[data-app-ready="true"]');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill('Ats@123456');
        const response = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
        await page.locator('#login-form button[type=submit]').click();
        const data = await (await response).json();
        sessions[role] = data.data;
        await page.waitForURL(base + home);
        await page.locator('#login-view').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(output, 'local-home-' + role + '.png'), fullPage: true });
      });
    }
    await test('LOCAL', 'RBAC', 'Configuration and user API enforce demo permissions', async () => {
      for (const role of ['ADMIN', 'HR_MANAGER']) assert.equal((await api('/approval-configurations/options', sessions[role].token)).status, 200);
      for (const role of ['HIRING_MGR', 'APPROVER', 'RECRUITER', 'INTERVIEWER', 'CANDIDATE']) assert.equal((await api('/approval-configurations/options', sessions[role].token)).status, 403);
      assert.equal((await api('/admin/users?page=1&limit=20', sessions.ADMIN.token)).status, 200);
      assert.equal((await api('/admin/users', sessions.CANDIDATE.token)).status, 403);
      assert.equal((await api('/admin/users')).status, 401);
    });
    const detail = async (page, id) => {
      await page.goto(base + '/requisitions');
      await page.waitForSelector('html[data-app-ready="true"]');
      await page.locator('.btn-detail-req[data-id="' + id + '"]').click();
      await page.locator('#create-req-modal').waitFor({ state: 'visible' });
    };
    const owner = pages.HIRING_MGR, hr = pages.HR_MANAGER, recruiter = pages.RECRUITER;
    await test('LOCAL', 'approval', 'Creator submits ready demo request and assigned HR approves through UI', async () => {
      await owner.goto(base + '/requisitions');
      await owner.getByLabel('Yêu cầu gửi phê duyệt').first().selectOption(demo.readyToSubmit);
      await owner.getByRole('button', { name: 'Gửi phê duyệt', exact: true }).first().click();
      await owner.locator('#s302-modal').waitFor({ state: 'visible' });
      await hr.goto(base + '/approvals');
      const code = db.prepare('SELECT code FROM requisitions WHERE id=?').get(demo.readyToSubmit).code;
      await hr.locator('#approvals-view tr').filter({ hasText: code }).getByRole('button', { name: 'Mở hồ sơ', exact: true }).click();
      await hr.locator('#s302-comment').fill('Duyệt hồ sơ demo sau setup sạch');
      await hr.locator('#s302-approve').click();
      await wait(() => db.prepare('SELECT status FROM requisition_approval_workflows WHERE requisition_id=?').get(demo.readyToSubmit)?.status === 'APPROVED');
    });
    await test('LOCAL', 'assignment', 'HR assigns recruiter through detail UI', async () => {
      await detail(hr, demo.readyToSubmit);
      const recruiterId = db.prepare('SELECT id FROM users WHERE email=?').get(users.RECRUITER[0]).id;
      await hr.locator('#s306-s210 [data-recruiter-primary]').selectOption(recruiterId);
      await hr.locator('#s306-s210').getByRole('button', { name: 'Cập nhật phân công', exact: true }).click();
      await wait(async () => (await api('/requisition-operations/' + demo.readyToSubmit + '/assignments', sessions.HR_MANAGER.token)).data.data?.primary?.id === recruiterId);
      await detail(recruiter, demo.readyToSubmit);
      await recruiter.locator('#s309-s210 [data-job-create]').waitFor();
    });
    let postingId;
    await test('LOCAL', 'posting', 'Assigned recruiter composes and submits; independent HR approves and publishes', async () => {
      await recruiter.locator('#s309-s210 [data-job-create]').click();
      assert.match(await recruiter.locator('[data-job-field="jobDescription"]').inputValue(), /Phát triển phần mềm/);
      await recruiter.locator('[data-job-field="applicationDeadline"]').fill(demo.neededDate);
      await recruiter.locator('[data-job-form]').getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
      await recruiter.locator('#s309-s210 [data-job-id]').waitFor();
      postingId = db.prepare('SELECT id FROM job_postings WHERE requisition_id=?').get(demo.readyToSubmit).id;
      await recruiter.locator('#s309-s210').getByRole('button', { name: 'Preview / gửi duyệt / xuất bản', exact: true }).click();
      await recruiter.locator('[data-job-action="SUBMIT"]').click();
      await wait(() => db.prepare('SELECT status FROM job_postings WHERE id=?').get(postingId).status === 'PENDING_APPROVAL');
      await hr.goto(base + '/approvals');
      const code = db.prepare('SELECT code FROM requisitions WHERE id=?').get(demo.readyToSubmit).code;
      await hr.locator('#s310-queue p').filter({ hasText: code }).getByRole('button', { name: 'Chi tiết / preview', exact: true }).click();
      await hr.locator('[data-job-action="APPROVE"]').click();
      await hr.locator('[data-job-action="PUBLISH"]').click();
      await wait(() => db.prepare('SELECT status FROM job_postings WHERE id=?').get(postingId).status === 'PUBLISHED');
    });
    await test('LOCAL', 'public', 'Public page matches protected preview and contains no hidden salary', async () => {
      const publicContext = await browser.newContext();
      contexts.push(publicContext);
      const page = await publicContext.newPage();
      await page.goto(base + '/careers/jobs?id=' + postingId);
      await page.locator('#public-jobs-content [data-public-job]').waitFor();
      assert.equal(await page.locator('#public-jobs-content [data-public-job]').evaluate(node => node.outerHTML), await hr.locator('#s310-preview [data-public-job]').evaluate(node => node.outerHTML));
      await page.screenshot({ path: path.join(output, 'local-public-detail.png'), fullPage: true });
    });
    await test('LOCAL', 'mobile', 'Demo requisition detail works at 360px with no horizontal overflow', async () => {
      await owner.setViewportSize({ width: 360, height: 800 });
      await detail(owner, demo.readyToSubmit);
      assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await owner.screenshot({ path: path.join(output, 'local-requisition-mobile.png'), fullPage: true });
    });
    await test('LOCAL', 'browser-errors', 'No unhandled browser page errors', async () => assert.deepEqual(errors, []));
  } finally {
    for (const context of contexts) await context.close();
    if (browser) await browser.close();
    db.close();
    child.kill();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('close', resolve));
  }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
