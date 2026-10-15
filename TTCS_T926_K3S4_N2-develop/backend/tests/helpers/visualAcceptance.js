const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = async function visualAcceptance({ pages, publicPage, app, s, check, output, expectNetworkFailure }) {
  const id = await s.create({ title: 'Tin kiểm thử trực quan', jobDescription: 'Mô tả công việc tiếng Việt.\nCộng tác, phỏng vấn và báo cáo.', candidateRequirements: 'Yêu cầu ứng viên: kỹ năng, kinh nghiệm và giao tiếp.' });
  const workflow = await s.submit(id), actors = new Map([s.hr, s.admin].map(user => [user.id, user]));
  while ((await s.approvals.read(workflow.id, s.hr)).status === 'PENDING') {
    const current = await s.approvals.read(workflow.id, s.hr), step = current.steps.find(row => row.status === 'PENDING');
    await s.approvals.decide(workflow.id, { requestId: crypto.randomUUID(), expectedVersion: current.version, expectedStepId: step.id, action: 'APPROVE', comment: 'Technical visual fixture approval' }, actors.get(step.approver_id));
  }
  await s.assign(id, s.rec.id, [s.r2.id]);
  const post = await s.draft(id, s.rec);
  const Publication = require('../../src/services/jobPostingPublicationService'), publication = new Publication(app.db);
  for (const [action, actor] of [['SUBMIT', s.rec], ['APPROVE', s.hr], ['PUBLISH', s.admin]]) {
    await publication.act(post.id, { requestId: crypto.randomUUID(), expectedVersion: (await publication.read(post.id, actor)).version, action }, actor);
  }
  const item = await s.service.getRequisitionById(id), visual = [];
  const screens = [
    ['login', pages.INTERVIEWER, '/login', '#login-view'],
    ['users', pages.ADMIN, '/admin/users', '#users-view'],
    ['departments', pages.HR_MANAGER, '/admin/departments', '#departments-view'],
    ['job-titles', pages.HR_MANAGER, '/admin/competencies', '#competencies-view'],
    ['company-introduction', pages.HR_MANAGER, '/admin/career-page', '#career-page-view'],
    ['requisitions', pages.HIRING_MGR, '/requisitions', '#requisitions-view'],
    ['approvals', pages.HR_MANAGER, '/approvals', '#approvals-view'],
    ['budget', pages.HR_MANAGER, '/admin/headcount-budgets', '#headcount-budgets-view'],
    ['recruiter-assignment', pages.HR_MANAGER, '/requisitions', '#create-req-modal', 'detail'],
    ['candidate-pipeline', pages.RECRUITER, '/candidates', '#candidates-view'],
    ['job-posting', pages.RECRUITER, '/requisitions', '#create-req-modal', 'detail'],
    ['preview', pages.HR_MANAGER, '/approvals', '#s310-modal', 'preview'],
    ['public-listing', publicPage, '/careers/jobs', '#public-jobs-view'],
    ['public-detail', publicPage, '/careers/jobs?id=' + post.id, '#public-jobs-view']
  ];
  for (const [width, height, mode] of [[1440, 1000, 'desktop'], [360, 800, 'mobile360']]) {
    for (const [name, page, route, selector, extra] of screens) {
      await check('Visual ' + mode + ' ' + name, page, async () => {
        await page.setViewportSize({ width, height });
        await page.goto(app.base + route);
        if (extra === 'detail') {
          await page.locator('.btn-detail-req[data-id="' + id + '"]').click();
        }
        if (extra === 'preview') {
          await page.locator('#s310-queue p').filter({ hasText: item.code }).getByRole('button', { name: 'Chi tiết / preview', exact: true }).click();
        }
        await page.locator(selector).waitFor({ state: 'visible' });
        await page.waitForFunction(selector => !document.querySelector(selector).innerText.includes('Đang tải'), selector);
        const text = await page.locator(selector).innerText();
        assert.ok(text.trim().length > 0);
        assert.doesNotMatch(text, /\uFFFD|Báº¡n|KhÃ´ng/);
        const geometry = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert.ok(geometry.scrollWidth <= geometry.width, JSON.stringify({ screen: name, ...geometry }));
        const clipped = await page.locator(selector).evaluate(root => Array.from(root.querySelectorAll('input,select,textarea,button')).filter(element => {
          const box = element.getBoundingClientRect();
          if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden' || element.closest('.table-wrapper')) return false;
          return box.left < -1 || box.right > window.innerWidth + 1;
        }).map(element => ({ id: element.id, tag: element.tagName, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })));
        assert.deepEqual(clipped, [], 'Interactive controls must be reachable without clipping');
        const screenshot = 'visual-' + mode + '-' + name + '.png';
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true, mask: [page.locator('#email'), page.locator('#password'), page.locator('#job-title-salary-fields'), page.locator('#s304-salary'), page.locator('#s304-list td:nth-child(4)')] });
        visual.push({ screen: name, mode, geometry, vietnameseRendered: true, screenshot });
      });
    }
  }
  const hr = pages.HR_MANAGER, owner = pages.HIRING_MGR;
  await check('Early login submit cannot put credentials in the URL before bootstrap', pages.INTERVIEWER, async () => {
    const page = await pages.INTERVIEWER.context().newPage(), queries = [];
    try {
      await page.route('**/js/pages/login.js', async route => { await new Promise(resolve => setTimeout(resolve, 1000)); await route.continue(); }, { times: 1 });
      page.on('request', request => { const url = new URL(request.url()); if (url.searchParams.has('password') || url.searchParams.has('email')) queries.push(true); });
      await page.goto(app.base + '/login', { waitUntil: 'domcontentloaded' });
      await page.locator('#email').fill('bootstrap@example.invalid');
      await page.locator('#password').fill('BOOTSTRAP_NO_SECRET');
      assert.notEqual(await page.evaluate(() => document.documentElement.dataset.appReady), 'true');
      await page.locator('#password').press('Enter');
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(queries.length, 0, 'No credential-bearing GET may occur before login handlers are ready');
      await page.waitForSelector('html[data-app-ready="true"]');
    } finally { await page.close(); }
  });
  await check('Keyboard login traverses email and password at360px', pages.INTERVIEWER, async () => {
    const page = pages.INTERVIEWER;
    await page.goto(app.base + '/login');
    await page.locator('#email').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'password');
    assert.equal(await page.locator('#password').evaluate(element => element.type), 'password');
  });
  await check('Keyboard desktop navigation activates the allowed requisition route', hr, async () => {
    await hr.setViewportSize({ width: 1440, height: 1000 });
    await hr.goto(app.base + '/dashboard');
    const link = hr.locator('#nav-item-requisitions');
    assert.equal(await link.getAttribute('role'), 'link');
    assert.equal(await link.getAttribute('tabindex'), '0');
    await link.focus();
    await hr.keyboard.press('Enter');
    await hr.waitForURL(app.base + '/requisitions');
  });
  await check('Keyboard mobile drawer opens and Escape restores toggle focus', hr, async () => {
    await hr.setViewportSize({ width: 360, height: 800 });
    await hr.goto(app.base + '/dashboard');
    await hr.locator('#sidebar-toggle-btn').focus();
    await hr.keyboard.press('Enter');
    assert.equal(await hr.locator('#sidebar-toggle-btn').getAttribute('aria-expanded'), 'true');
    await hr.keyboard.press('Escape');
    assert.equal(await hr.locator('#sidebar-toggle-btn').getAttribute('aria-expanded'), 'false');
    assert.equal(await hr.evaluate(() => document.activeElement.id), 'sidebar-toggle-btn');
  });
  await check('Keyboard modal close preserves request and supports native button action', owner, async () => {
    await owner.goto(app.base + '/requisitions');
    await owner.locator('#open-create-req-modal-btn').click();
    await owner.locator('#close-create-req-modal').focus();
    await owner.keyboard.press('Enter');
    await owner.locator('#create-req-modal').waitFor({ state: 'hidden' });
    assert.equal((await s.service.getRequisitionById(id)).status, 'OPEN');
  });
  await check('Loading and empty Requisition states displayed without stale rows', owner, async () => {
    await owner.goto(app.base + '/requisitions');
    await owner.route('**/api/v1/requisitions?**', async route => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], pagination: { totalItems: 0, currentPage: 1, totalPages: 1, limit: 20 }, features: { requisitionTracking: true } }) });
    }, { times: 1 });
    await owner.locator('#req-refresh-btn').click();
    assert.match(await owner.locator('#requisitions-table-body').innerText(), /Đang tải/);
    await owner.waitForFunction(() => !document.getElementById('requisitions-table-body').innerText.includes('Đang tải'));
    assert.match(await owner.locator('#requisitions-table-body').innerText(), /Không|Chưa/);
    assert.equal(await owner.locator('.btn-detail-req').count(), 0);
  });
  await check('S2-09 company block preview matches public style without saving', hr, async () => {
    await hr.goto(app.base + '/admin/career-page');
    const before = await app.db.prepare('SELECT * FROM career_page_settings WHERE id=1').get();
    await hr.locator('#career-page-introduction-input').fill('Giới thiệu UAT tiếng Việt, chưa lưu.');
    await hr.locator('#career-page-preview-btn').click();
    await hr.locator('#career-page-preview-container .login-introduction').waitFor();
    assert.equal(await hr.locator('#career-page-preview-container .login-company-introduction').innerText(), 'Giới thiệu UAT tiếng Việt, chưa lưu.');
    const previewBackground = await hr.locator('#career-page-preview-container > div').evaluate(element => getComputedStyle(element).backgroundImage);
    await publicPage.goto(app.base + '/login');
    const publicBackground = await publicPage.locator('#login-view').evaluate(element => getComputedStyle(element).backgroundImage);
    assert.match(publicBackground, /linear-gradient/);
    assert.equal(previewBackground, publicBackground);
    assert.deepEqual(await app.db.prepare('SELECT * FROM career_page_settings WHERE id=1').get(), before);
    assert.equal(await hr.locator('#career-page-preview-container form').count(), 0);
    const previewBox = await hr.locator('#career-page-preview-container').boundingBox();
    assert.ok(previewBox.x >= 0 && previewBox.x + previewBox.width <= (await hr.evaluate(() => innerWidth)) + 1);
    await hr.screenshot({ path: path.join(output, 'company-block-preview.png'), fullPage: true });
  });
  await check('Budget connection failure uses correct Vietnamese feedback', hr, async () => {
    expectNetworkFailure('/api/v1/headcount-budgets/options');
    await hr.route('**/api/v1/headcount-budgets/options', route => route.abort('failed'), { times: 1 });
    await hr.goto(app.base + '/admin/headcount-budgets');
    await hr.locator('#s304-alert').waitFor({ state: 'visible' });
    assert.equal(await hr.locator('#s304-message').innerText(), 'Không thể kết nối để xử lý ngân sách.');
  });
  return { visualScreens: visual, fixture: 'fresh isolated SQLite only; API fixture setup supports visual page coverage', brandSignoff: 'PENDING', publicPostingId: post.id };
};
