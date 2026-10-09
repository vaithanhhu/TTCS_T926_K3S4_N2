const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { chromium } = require('playwright');
const { openApplication } = require('./helpers/coverageApplication');
const { setup, prepare } = require('./test_s3_10');
const output = process.env.ATS_E2E_ARTIFACTS || path.resolve(__dirname, '../../test-artifacts/browser');
const results = [], network = [], errors = [], consoleErrors = [], contexts = [], secrets = new Set(['Ats@123456']);
const expectedNetworkFailures = new Set(), networkFailures = [];
let visualAcceptance = null;
const roles = { ADMIN: ['admin@company.com', '/admin'], HR_MANAGER: ['hrmanager@company.com', '/dashboard'], HIRING_MGR: ['hiringmgr@company.com', '/hiring'], APPROVER: ['approver@company.com', '/approvals'], RECRUITER: ['recruiter@company.com', '/recruitment'], INTERVIEWER: ['interviewer@company.com', '/interviews'], CANDIDATE: ['candidate@example.com', '/candidate'] };
const flags = ['APPROVAL_CONFIGURATION_ENABLED', 'REQUISITION_APPROVAL_ENABLED', 'HEADCOUNT_BUDGET_ENABLED', 'REQUISITION_OPERATIONS_ENABLED', 'REQUISITION_LIFECYCLE_ENABLED', 'REQUISITION_TRACKING_ENABLED', 'JOB_POSTING_DRAFTS_ENABLED', 'JOB_POSTING_PUBLICATION_ENABLED'];
const wait = async predicate => {
  const deadline = Date.now() + 12000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Browser backend state wait timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
async function check(name, page, action) {
  try {
    await action();
    results.push({ name, status: 'PASS' });
    console.log('[PASS] ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', message: error.message });
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure-' + results.length + '.png'), fullPage: true }).catch(() => {});
    console.error('[FAIL] ' + name + '\n' + error.stack);
  }
}
async function sanitizeTrace(file) {
  const JSZip = createRequire(require.resolve('exceljs'))('jszip'), archive = await JSZip.loadAsync(fs.readFileSync(file));
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const bytes = await entry.async('nodebuffer');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { continue; }
    for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED_TEST_SECRET]');
    archive.file(entry.name, text);
  }
  fs.writeFileSync(file, await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await openApplication(), s = await setup(app.db, 'Browser'), config = require('../src/config/config');
  await prepare(s);
  for (const flag of flags) config[flag] = true;
  assert.equal(config.DB_PROVIDER, 'sqlite');
  assert.equal(config.EMAIL_MODE, 'simulated');
  assert.ok(config.DB_PATH.startsWith(app.root));
  await s.budgets.save({ departmentId: 'dept-3', year: s.year, approvedHeadcount: 100, annualSalaryBudget: 1000000000 }, s.hr);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const pages = {}, adminSession = await app.login(roles.ADMIN[0]);
    secrets.add(adminSession.token);
    const makePage = async name => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Ho_Chi_Minh' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === app.base || url.protocol === 'data:') return route.continue();
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const goto = page.goto.bind(page);
      page.goto = async (...args) => {
        const response = await goto(...args);
        await page.waitForSelector('html[data-app-ready="true"]');
        return response;
      };
      page.on('dialog', dialog => dialog.accept());
      page.on('pageerror', error => errors.push({ page: name, message: error.message }));
      page.on('console', message => { if (message.type() === 'error') { const url = message.location().url; let injected = false; try { injected = expectedNetworkFailures.has(new URL(url).pathname); } catch {} consoleErrors.push({ page: name, message: message.text(), injected }); } });
      page.on('requestfailed', request => { const url = new URL(request.url()); networkFailures.push({ page: name, path: url.pathname, error: request.failure()?.errorText, injected: expectedNetworkFailures.has(url.pathname) }); });
      page.on('response', async response => {
        const request = response.request(), url = new URL(response.url());
        if (url.origin !== app.base) return;
        network.push({ page: name, method: request.method(), path: url.pathname, status: response.status(), injected: response.headers()['x-e2e-injected-error'] === 'true' });
        if (url.pathname === '/api/v1/auth/login') {
          const data = await response.json().catch(() => null);
          if (data?.data?.token) secrets.add(data.data.token);
        }
      });
      contexts.push({ name, context });
      return page;
    };
    for (const [role, [email, home]] of Object.entries(roles)) {
      pages[role] = await makePage(role);
      await check('S1 login/home/navigation ' + role, pages[role], async () => {
        const page = pages[role];
        await page.goto(app.base + '/login');
        await page.locator('#email').fill(email);
        await page.locator('#password').fill('Ats@123456');
        await page.locator('#login-form button[type=submit]').click();
        await page.waitForURL(app.base + home);
        await page.locator('#login-view').waitFor({ state: 'hidden' });
        await page.screenshot({ path: path.join(output, 'home-' + role + '.png'), fullPage: true });
      });
    }
    const hr = pages.HR_MANAGER, owner = pages.HIRING_MGR, admin = pages.ADMIN, recruiter = pages.RECRUITER;
    await check('S1 users real table and pagination after batching', admin, async () => {
      await admin.goto(app.base + '/admin/users');
      await admin.locator('#users-table-body [data-user-id]').first().waitFor();
      assert.doesNotMatch(await admin.locator('#users-page-info').innerText(), /undefined|NaN/);
      await admin.locator('#users-next-btn').click();
      await wait(async () => (await admin.locator('#users-current-page-badge').innerText()).startsWith('2 /'));
    });
    await check('RBAC Hiring Manager configuration route denied', owner, async () => {
      await owner.goto(app.base + '/admin/approval-configurations');
      await wait(async () => (await owner.locator('#error-code-display').innerText()) === '403');
      await owner.goto(app.base + '/requisitions');
    });
    for (const role of ['CANDIDATE', 'INTERVIEWER']) {
      await check('RBAC real route blocks internal administration ' + role, pages[role], async () => {
        await pages[role].goto(app.base + '/admin/users');
        await wait(async () => (await pages[role].locator('#error-code-display').innerText()) === '403');
      });
    }
    await check('Configuration API failure displays user-facing error', hr, async () => {
      await hr.route('**/api/v1/approval-configurations/options', route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-e2e-injected-error': 'true' }, body: JSON.stringify({ success: false, code: 'INTERNAL_SERVER_ERROR', message: 'Không thể tải cấu hình trong phép thử lỗi cách ly.' }) }), { times: 1 });
      await hr.goto(app.base + '/admin/approval-configurations');
      await hr.locator('#s301-alert').waitFor({ state: 'visible' });
      assert.match(await hr.locator('#s301-message').innerText(), /Không thể tải cấu hình/);
    });
    await check('S3-01 HR creates and publishes two-level configuration version', hr, async () => {
      await hr.goto(app.base + '/admin/approval-configurations');
      const configuration = (await s.configurations.list()).find(item => item.departmentId === 'dept-3');
      await hr.locator('[data-configuration-id="' + configuration.id + '"]').click();
      await hr.locator('.s301-limit').fill('200');
      await hr.locator('.s301-approver').selectOption(s.hr.id);
      await hr.locator('#s301-add-level').click();
      await hr.locator('.s301-limit').nth(1).fill('1000');
      await hr.locator('.s301-approver').nth(1).selectOption(s.admin.id);
      await hr.locator('#s301-save').click();
      await wait(async () => !(await hr.locator('#s301-publish').isDisabled()));
      await hr.locator('#s301-publish').click();
      await wait(async () => (await s.configurations.list()).find(item => item.id === configuration.id).publishedVersion === 2);
      await hr.screenshot({ path: path.join(output, 'configuration-version2.png'), fullPage: true });
    });
    const create = async label => {
      await owner.goto(app.base + '/requisitions');
      await owner.locator('#open-create-req-modal-btn').click();
      await owner.locator('#create-req-modal').waitFor({ state: 'visible' });
      await owner.locator('#create-req-job-title-input').selectOption(s.title.data.id);
      await owner.locator('#create-req-dept-input').selectOption('dept-3');
      await owner.locator('#create-req-title-input').fill(label);
      await owner.locator('#create-req-headcount-input').fill('2');
      await owner.locator('#create-req-reason-input').selectOption('NEW_HEADCOUNT');
      await owner.locator('#create-req-needed-date-input').fill(s.valid.neededDate);
      await owner.locator('#create-req-salary-min-input').fill('150');
      await owner.locator('#create-req-salary-max-input').fill('300');
      await owner.locator('#create-req-description-input').fill('Browser JD tiếng Việt\nResponsibilities and collaboration.');
      await owner.locator('#create-req-requirements-input').fill('Browser requirements: experience and teamwork.');
      await owner.locator('#create-req-work-location-select').selectOption('s309-location');
      await owner.locator('#create-req-work-mode-select').selectOption('s309-mode');
      const response = owner.waitForResponse(r => r.url() === app.base + '/api/v1/requisitions' && r.request().method() === 'POST');
      await owner.locator('#submit-create-req-btn').click();
      const result = await (await response).json();
      assert.equal(result.success, true);
      await owner.locator('#create-req-modal').waitFor({ state: 'hidden' });
      return result.data.id;
    };
    const detail = async (page, id) => {
      await page.goto(app.base + '/requisitions');
      await page.locator('.btn-detail-req[data-id="' + id + '"]').click();
      await page.locator('#create-req-modal').waitFor({ state: 'visible' });
    };
    const approve = async id => {
      await owner.goto(app.base + '/requisitions');
      await owner.getByLabel('Yêu cầu gửi phê duyệt').first().selectOption(id);
      await owner.getByRole('button', { name: 'Gửi phê duyệt', exact: true }).first().click();
      await owner.locator('#s302-modal').waitFor({ state: 'visible' });
      const row = await app.db.prepare('SELECT id FROM requisition_approval_workflows WHERE requisition_id=?').get(id);
      for (const page of [hr, admin]) {
        await page.goto(app.base + '/approvals');
        const item = await s.service.getRequisitionById(id);
        const tr = page.locator('#approvals-view tr').filter({ hasText: item.code });
        await tr.getByRole('button', { name: 'Mở hồ sơ', exact: true }).click();
        await page.locator('#s302-approve').waitFor({ state: 'visible' });
        await page.locator('#s302-comment').fill('Browser approved with recorded opinion');
        await page.locator('#s302-approve').click();
        await wait(async () => (await s.approvals.read(row.id, s.hr)).events.filter(e => e.action === 'APPROVE').length === (page === hr ? 1 : 2));
      }
      assert.equal((await s.approvals.read(row.id, s.hr)).status, 'APPROVED');
    };
    const assign = async id => {
      await detail(hr, id);
      await hr.locator('#s306-s210 [data-recruiter-primary]').selectOption(s.rec.id);
      await hr.locator('#s306-s210 input[type=checkbox][value="' + s.r2.id + '"]').check();
      await hr.locator('#s306-s210').getByRole('button', { name: 'Cập nhật phân công', exact: true }).click();
      await wait(async () => (await s.operations.assignments(id, s.hr)).primary?.id === s.rec.id);
    };
    const publish = async id => {
      await detail(recruiter, id);
      await recruiter.locator('#s309-s210 [data-job-create]').click();
      assert.match(await recruiter.locator('[data-job-field="jobDescription"]').inputValue(), /Browser JD/);
      await recruiter.locator('[data-job-field="applicationDeadline"]').fill(s.year + '-12-31');
      await recruiter.locator('[data-job-field="showSalary"]').uncheck();
      await recruiter.locator('[data-job-form]').getByRole('button', { name: 'Lưu bản nháp', exact: true }).click();
      await recruiter.locator('#s309-s210 [data-job-id]').waitFor();
      const idPost = (await s.jobs.context(id, s.hr)).postings[0].id;
      await recruiter.locator('#s309-s210').getByRole('button', { name: 'Preview / gửi duyệt / xuất bản', exact: true }).click();
      await recruiter.locator('[data-job-action="SUBMIT"]').click();
      await wait(async () => (await s.jobs.read(idPost, s.hr)).status === 'PENDING_APPROVAL');
      assert.equal(await recruiter.locator('[data-job-action="APPROVE"]').count(), 0);
      await hr.goto(app.base + '/approvals');
      const row = hr.locator('#s310-queue p').filter({ hasText: (await s.service.getRequisitionById(id)).code });
      await row.getByRole('button', { name: 'Chi tiết / preview', exact: true }).click();
      await hr.locator('[data-job-action="APPROVE"]').click();
      await hr.locator('[data-job-action="PUBLISH"]').waitFor();
      await hr.locator('[data-job-action="PUBLISH"]').click();
      await wait(async () => (await s.jobs.read(idPost, s.hr)).status === 'PUBLISHED');
      return idPost;
    };
    const lifecycle = async (id, action) => {
      await detail(hr, id);
      await hr.locator('#s307-s210 [data-lifecycle-action]').selectOption(action);
      await hr.locator('#s307-s210 [data-lifecycle-reason]').fill('Browser lifecycle reason ' + action);
      await hr.locator('#s307-s210').getByRole('button', { name: 'Xác nhận thao tác', exact: true }).click();
      await wait(async () => (await s.service.getRequisitionById(id)).status === (action === 'FULFILLED' ? 'CLOSED' : action));
    };
    let mainId, postId;
    await check('S2-10 invalid quantity has visible validation and no write', owner, async () => {
      await owner.goto(app.base + '/requisitions');
      await owner.locator('#open-create-req-modal-btn').click();
      await owner.locator('#create-req-headcount-input').fill('-1');
      const count = (await app.db.prepare('SELECT COUNT(*) AS n FROM requisitions').get()).n;
      await owner.locator('#submit-create-req-btn').click();
      await owner.locator('#create-req-alert').waitFor({ state: 'visible' });
      assert.match(await owner.locator('#create-req-alert-msg').innerText(), /Số lượng/);
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM requisitions').get()).n, count);
      await owner.locator('#close-create-req-modal').click();
    });
    await check('S2-10 real UI creates OPEN without auto approval', owner, async () => {
      mainId = await create('Browser main position');
      assert.equal((await s.service.getRequisitionById(mainId)).status, 'OPEN');
      assert.equal(await app.db.prepare('SELECT id FROM requisition_approval_workflows WHERE requisition_id=?').get(mainId), undefined);
    });
    if (mainId) {
      await check('S3-02 two assigned approval levels through real UI', hr, () => approve(mainId));
      await check('S3-03 owner sees ordered approval history and decisions', owner, async () => {
        await detail(owner, mainId);
        await owner.locator('#s303-s210 table').waitFor();
        const history = await owner.locator('#s303-s210').innerText();
        assert.match(history, /Đã duyệt/);
        assert.match(history, /Browser approved with recorded opinion/);
        assert.equal(await owner.locator('#s303-s210 tbody tr').count(), 2);
        await owner.screenshot({ path: path.join(output, 'approval-history.png'), fullPage: true });
      });
      await check('S3-06 real UI assigns primary and support recruiter', hr, () => assign(mainId));
      await check('S3-09/10 UI composes, submits, independently approves and publishes', recruiter, async () => { postId = await publish(mainId); });
    }
    const publicPage = await makePage('PUBLIC');
    if (postId) {
      await check('S3-10 preview and public share exact DOM and hidden salary', hr, async () => {
        await publicPage.goto(app.base + '/careers/jobs');
        await publicPage.locator('[data-public-job-id="' + postId + '"]').click();
        await publicPage.locator('[data-public-job]').waitFor();
        const preview = await hr.locator('#s310-preview [data-public-job]').evaluate(n => n.outerHTML);
        const publicDom = await publicPage.locator('#public-jobs-content [data-public-job]').evaluate(n => n.outerHTML);
        assert.equal(publicDom, preview);
        assert.equal(Object.hasOwn((await s.jobs.publicList(postId))[0], 'salaryMin'), false);
        await publicPage.screenshot({ path: path.join(output, 'public-desktop.png'), fullPage: true });
        await hr.screenshot({ path: path.join(output, 'preview-desktop.png'), fullPage: true });
      });
      await check('Mobile public detail and HR preview render without horizontal overflow', hr, async () => {
        for (const page of [publicPage, hr]) {
          await page.setViewportSize({ width: 390, height: 844 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        }
        await publicPage.screenshot({ path: path.join(output, 'public-mobile.png'), fullPage: true });
        await hr.screenshot({ path: path.join(output, 'preview-mobile.png'), fullPage: true });
        await hr.setViewportSize({ width: 1440, height: 1000 });
      });
      await check('S3-07 CLOSED via UI unpublishes and retains quota', hr, async () => {
        await s.service.createCandidate({ fullName: 'Browser hired1', email: 'hired1@browser.example.invalid', requisitionId: mainId, stage: 'HIRED' }, s.rec);
        await s.service.createCandidate({ fullName: 'Browser hired2', email: 'hired2@browser.example.invalid', requisitionId: mainId, stage: 'HIRED' }, s.rec);
        const usage = await s.budgets.measure('dept-3', s.year);
        await lifecycle(mainId, 'FULFILLED');
        assert.deepEqual(await s.budgets.measure('dept-3', s.year), usage);
        await publicPage.reload();
        await publicPage.locator('#public-jobs-content [data-public-job]').waitFor({ state: 'hidden' });
        assert.equal((await s.jobs.publicList(postId)).length, 0);
      });
    }
    for (const action of ['PAUSED', 'CANCELLED']) {
      await check('S3-07 ' + action + ' real UI and public removal', hr, async () => {
        const id = await create('Browser ' + action);
        await approve(id);
        await assign(id);
        const post = await publish(id), usage = await s.budgets.measure('dept-3', s.year);
        await lifecycle(id, action);
        assert.equal((await s.jobs.publicList(post)).length, 0);
        if (action === 'PAUSED') assert.deepEqual(await s.budgets.measure('dept-3', s.year), usage);
        await publicPage.goto(app.base + '/careers/jobs?id=' + post);
        await publicPage.locator('#public-jobs-content [data-public-job]').waitFor({ state: 'hidden' });
        const application = await s.service.createCandidate({ fullName: 'Must block', email: action + '@browser.example.invalid', requisitionId: id }, s.rec);
        assert.equal(application.code, 'REQUISITION_NOT_ACCEPTING_APPLICATIONS');
        await hr.screenshot({ path: path.join(output, action.toLowerCase() + '-history.png'), fullPage: true });
      });
    }
    await check('Feature flags ON agree with backend capabilities and navigation', admin, async () => {
      assert.ok(flags.every(flag => config[flag] === true));
      const list = await app.api('GET', '/requisitions', adminSession.token);
      for (const feature of ['requisitionLifecycle', 'requisitionOperations', 'requisitionTracking']) assert.equal(list.data.features[feature], true);
      const menu = await app.api('GET', '/navigation/menu', adminSession.token);
      assert.match(JSON.stringify(menu.data), /nav-approval-configurations/);
      assert.match(JSON.stringify(menu.data), /nav-headcount-budgets/);
    });
    await check('Eight feature flags OFF enforce API and hide frontend features', admin, async () => {
      try {
        for (const flag of flags) config[flag] = false;
        for (const endpoint of ['/approval-configurations', '/requisition-approvals', '/headcount-budgets', '/requisition-operations/' + mainId + '/assignments', '/requisition-lifecycles/' + mainId, '/requisition-tracking/options', '/job-posting-drafts/requisitions/' + mainId, '/job-posting-publication']) assert.equal((await app.api('GET', endpoint, adminSession.token)).status, 404, endpoint);
        const menu = await app.api('GET', '/navigation/menu', adminSession.token);
        assert.doesNotMatch(JSON.stringify(menu.data), /nav-approval-configurations|nav-headcount-budgets/);
        await detail(admin, mainId);
        for (const id of ['s303-s210', 's306-s210', 's307-s210', 's309-s210']) await admin.locator('#' + id).waitFor({ state: 'hidden' });
        await admin.screenshot({ path: path.join(output, 'flags-off.png'), fullPage: true });
      } finally { for (const flag of flags) config[flag] = true; }
    });
    await check('S1 logout clears session and protected deep link requires login', pages.INTERVIEWER, async () => {
      await pages.INTERVIEWER.goto(app.base + '/interviews');
      await pages.INTERVIEWER.locator('#sidebar-logout-btn').click();
      await pages.INTERVIEWER.waitForURL(app.base + '/login');
      await pages.INTERVIEWER.goto(app.base + '/interviews');
      await pages.INTERVIEWER.waitForURL(app.base + '/login');
    });
    visualAcceptance = await require('./helpers/visualAcceptance')({ pages, publicPage, app, s, check, output, expectNetworkFailure: path => expectedNetworkFailures.add(path) });
    await check('Browser console/page runtime and HTTP5xx clean', null, async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(networkFailures.filter(item => !item.injected), []);
      assert.deepEqual(network.filter(item => item.status >= 500 && !item.injected), []);
      assert.deepEqual(consoleErrors.filter(item => !item.injected && !/Failed to load resource.*(?:401|403|404|500)/.test(item.message)), []);
    });
  } finally {
    for (const { name, context } of contexts) {
      const trace = path.join(output, 'trace-' + name + '.zip');
      await context.tracing.stop({ path: trace });
      await sanitizeTrace(trace);
      await context.close();
    }
    if (browser) await browser.close();
    await app.close();
    const report = { engine: 'Playwright Chromium real headless browser', database: 'fresh isolated SQLite', email: 'simulated', featureFlags: 'ON and OFF only in test process', productionFlagsChanged: false, passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, total: results.length, cases: results, network, pageErrors: errors, consoleErrors, networkFailures, visualAcceptance, browserVersion: browser?.version(), artifacts: fs.readdirSync(output).filter(name => /\.(png|zip)$/.test(name)), traceSecretsRedacted: true, externalFonts: 'blocked with empty response to keep test offline', viewportDesktop: '1440x1000', viewportMobile: '390x844' };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    console.log('BROWSER_E2E_RESULT ' + JSON.stringify({ passed: report.passed, failed: report.failed, total: report.total }));
    process.exitCode = report.failed ? 1 : 0;
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
