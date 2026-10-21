/** Real browser + real frontend, deterministic HTTP fixtures. No DB, SMTP or application server imports. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../frontend');
const permissions = ['candidate.read', 'candidate.create', 'candidate.update', 'candidate.merge', 'candidate.merge.undo', 'requisition.read', 'requisition.edit'];
const user = { id: 'fixture', fullName: 'Lifecycle fixture', roles: ['HR_MANAGER'], permissions, defaultHome: '/candidates' };

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) { res.writeHead(500); res.end('Unmocked API forbidden'); return; }
    const file = path.resolve(root, '.' + (path.extname(pathname) ? pathname : '/index.html'));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const requests = [], errors = [], rejections = [];
    let activeUser = user, expired = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__rejections = [];
      window.addEventListener('unhandledrejection', event => window.__rejections.push(String(event.reason)));
    });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.fulfill({ status: 200, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push({ path: url.pathname, method: route.request().method(), authorization: route.request().headers().authorization });
      let data = { success: true, data: [], candidates: [] }, status = 200;
      if (url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/me')) {
        status = expired ? 401 : 200;
        data = expired ? { success: false, code: 'SESSION_EXPIRED' } : { success: true, data: { token: 'fixture-session', user: activeUser, expiresAt: new Date(Date.now() + 3600000).toISOString() } };
      } else if (url.pathname.endsWith('/navigation/menu')) data = { success: true, menuItems: [{ path: '/candidates' }, { path: '/requisitions' }, { path: '/profile' }] };
      else if (url.pathname.endsWith('/career-page')) data = { success: true, data: {} };
      else if (url.pathname.endsWith('/merge/recent')) {
        status = expired ? 401 : 200;
        data = expired ? { success: false, code: 'SESSION_EXPIRED' } : { success: true, data: { rows: [] } };
      }
      else if (url.pathname.includes('/availability') || url.pathname.includes('-availability')) data = { success: false };
      else if (url.pathname.endsWith('/sla/reminders')) data = { success: true, data: { reminders: [], unreadCount: 0 } };
      else if (url.pathname.includes('/onboarding/candidates/')) data = { success: true, data: { hasOnboarding: false } };
      else if (url.pathname.endsWith('/screen')) data = { success: true, data: { fitScore: 80, mandatoryPass: true } };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
    const count = prefix => requests.filter(r => r.path.startsWith('/api/v1/' + prefix)).length;
    const privateCount = () => requests.filter(r => /\/api\/v1\/(candidates|sla|onboarding|requisitions)/.test(r.path)).length;
    const login = async () => {
      await page.locator('#email').fill('fixture@example.test');
      await page.locator('#password').fill('fixture-password');
      await page.locator('#login-form').evaluate(form => form.requestSubmit());
      await page.waitForURL('**/candidates');
      await page.waitForFunction(() => !!document.getElementById('create-cand-cv-file'));
      await page.waitForFunction(() => !!document.getElementById('sla-bell-container'));
    };

    await page.goto(base + '/login'); await ready();
    assert.equal(privateCount(), 0, 'Login must not request private data');
    assert.equal(await page.locator('#create-cand-cv-file').count(), 0, 'Manual entry must remain dormant');
    assert.equal(await page.locator('#sla-bell-container').count(), 0, 'SLA must remain dormant');
    console.log('PASS anonymous login: no private requests or eager initialization');

    await login();
    await page.waitForFunction(() => !document.getElementById('candidates-table-body')?.textContent.includes('Đang tải'));
    assert.equal(count('candidates/merge/recent'), 1);
    await page.evaluate(async () => {
      await Promise.all([CandidateScreening.screenCandidateApi('fixture'), CandidateManualEntry.checkDuplicateApi(sessionStorage.getItem('ats_token'), { email: 'candidate@example.test' })]);
      await loadCandidateOnboarding({ id: 'fixture', stage: 'HIRED', requisition: {} }, sessionStorage.getItem('ats_token'));
    });
    assert.equal(count('candidates/fixture/screen'), 1);
    assert.equal(count('candidates/check-duplicate'), 1);
    assert.equal(count('onboarding/candidates/fixture'), 1);
    console.log('PASS authenticated merge, screening, manual entry, onboarding and SLA');

    const beforeSla = count('sla/configs');
    await page.evaluate(async () => {
      CandidateManualEntry.init(); CandidateManualEntry.init();
      CandidateScreening.init(); CandidateScreening.init();
      await Promise.all([CandidateSlaModule.init(), CandidateSlaModule.init()]);
    });
    assert.equal(count('sla/configs'), beforeSla, 'Initialization must be idempotent');
    const beforeDuplicate = count('candidates/check-duplicate');
    await page.locator('#create-cand-email').evaluate(input => { input.value = 'unique@example.test'; input.dispatchEvent(new Event('input')); });
    await page.waitForTimeout(500);
    assert.equal(count('candidates/check-duplicate'), beforeDuplicate + 1, 'One debounced listener');
    console.log('PASS repeated initialization does not duplicate requests/listeners');

    await page.evaluate(async () => {
      const original = ATS_API.getCandidateOnboardingApi;
      ATS_API.getCandidateOnboardingApi = () => Promise.reject(undefined);
      await loadCandidateOnboarding({ id: 'fixture', stage: 'HIRED' }, sessionStorage.getItem('ats_token'));
      ATS_API.getCandidateOnboardingApi = original;
    });
    assert.match(await page.locator('#toast-container').innerText(), /Onboarding/);
    console.log('PASS undefined rejection in ATS onboarding is normalized and reported');

    await page.evaluate(() => {
      window.__mergeOriginal = ATS_API.candidateMergeApi;
      ATS_API.candidateMergeApi = () => new Promise(resolve => { window.__releaseMerge = resolve; });
      window.__lateMerge = loadCandidateMergeUndoList();
    });
    await page.evaluate(() => performLogout(false));
    await page.waitForURL('**/login');
    await page.evaluate(async () => {
      window.__releaseMerge({ ok: true, data: { data: { rows: [{ id: 'stale', primary_candidate_id: 'PRIVATE_STALE_DATA' }] } } });
      await window.__lateMerge;
      ATS_API.candidateMergeApi = window.__mergeOriginal;
    });
    assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE_STALE_DATA/);
    assert.equal(await page.locator('#candidate-merge-tools').innerText(), '');
    console.log('PASS late merge response cannot restore private UI after logout');
    const afterLogout = privateCount();
    await page.evaluate(async () => {
      CandidateManualEntry.init(); CandidateScreening.init(); await CandidateSlaModule.init();
      await loadCandidateMergeUndoList();
      await CandidateScreening.screenCandidateApi('fixture');
      await CandidateManualEntry.checkDuplicateApi('fixture-session', {});
      await ATS_API.getCandidateOnboardingApi('fixture-session', 'fixture');
    });
    assert.equal(privateCount(), afterLogout);
    console.log('PASS logout clears private effects and guards stale handlers');

    await page.evaluate(() => {
      sessionStorage.setItem('ats_token', 'expired-fixture');
      sessionStorage.setItem('ats_user', JSON.stringify({ roles: ['HR_MANAGER'], permissions: ['candidate.read'] }));
    });
    expired = true;
    const beforeExpired = privateCount();
    await page.reload(); await ready();
    assert.equal(privateCount(), beforeExpired, 'Unvalidated stored session must not enable private modules');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ats_token')), null);
    console.log('PASS expired restored token: auth check only, no private module requests');

    expired = false; activeUser = { ...user, roles: ['HIRING_MGR'], permissions: ['candidate.read'] };
    const beforeRestricted = count('candidates/merge/recent');
    // Restricted users may read candidates, but must not initialize manual entry or merge undo.
    await page.locator('#email').fill('fixture@example.test'); await page.locator('#password').fill('fixture-password');
    await page.locator('#login-form').evaluate(form => form.requestSubmit());
    await page.waitForURL('**/candidates');
    assert.equal(count('candidates/merge/recent'), beforeRestricted);
    const denied = await page.evaluate(() => ATS_API.candidateMergeApi(sessionStorage.getItem('ats_token'), '/recent', 'GET'));
    assert.equal(denied.ok, false);
    assert.equal(count('candidates/merge/recent'), beforeRestricted);
    console.log('PASS missing merge permission does not dispatch a request');
    assert.equal(await page.locator('#sla-bell-container').count(), 0, 'Role denied by SLA service must not mount SLA');

    await page.evaluate(() => performLogout(false)); activeUser = user;
    await login(); expired = true;
    await page.evaluate(() => loadCandidateMergeUndoList());
    await page.waitForURL('**/login');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ats_token')), null);
    console.log('PASS server 401 during active session clears session and private effects');
    rejections.push(...await page.evaluate(() => window.__rejections));
    assert.deepEqual(errors, []); assert.deepEqual(rejections, []);
    console.log('AUTHENTICATED_FEATURE_LIFECYCLE_RESULT PASS');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
