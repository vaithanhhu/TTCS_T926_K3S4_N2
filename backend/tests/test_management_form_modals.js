const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const frontend = path.resolve(__dirname, '../../frontend');
  const override = process.env.ATS_MANAGEMENT_FRONTEND;
  const read = file => fs.readFileSync(override && fs.existsSync(path.join(override, file)) ? path.join(override, file) : path.join(frontend, file), 'utf8');
  const artifacts = process.env.ATS_MANAGEMENT_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ats-management-modals-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const results = [], errors = [], writes = [];
  const state = {
    manage: true, salary: true, rejectNext: false,
    catalogs: [{ id: 'source-one', type: 'CANDIDATE_SOURCE', code: 'REFERRAL', name: 'Giới thiệu', displayOrder: 0, status: 'ACTIVE' }, { id: 'source-two', type: 'CANDIDATE_SOURCE', code: 'WEBSITE', name: 'Website', displayOrder: 1, status: 'ACTIVE' }],
    departments: [{ id: 'dept-fixture', code: 'HR', name: 'Phòng Nhân sự', status: 'ACTIVE', parentId: null, manager: { id: 'manager-fixture', fullName: 'Người quản lý thử nghiệm' }, openRequisitionCount: 0, children: [] }],
    frameworks: [{ id: 'framework-fixture', code: 'CORE', name: 'Năng lực nền tảng', description: 'Dữ liệu giả lập', status: 'ACTIVE', totalWeight: 100, criteria: [{ id: 'criterion-fixture', name: 'Chuyên môn', weight: 100 }] }],
    titles: [{ id: 'title-fixture', code: 'ENGINEER', name: 'Kỹ sư', level: 'Senior', minSalary: 20000000, maxSalary: 40000000, framework: { id: 'framework-fixture', name: 'Năng lực nền tảng' } }]
  };
  const markup = ['recruitment-catalogs', 'departments', 'competencies'].map(name => read('pages/' + name + '.html')).join('\n');
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ats-api-base" content="/api/v1"><link rel="stylesheet" href="/css/style.css"></head><body><main style="padding:20px;max-width:1280px;margin:auto">' + markup + '</main><div id="users-action-menu" class="hidden" role="menu"></div><script>let currentActiveView="";let currentAuthenticatedUser={permissions:["user.read","department.manage","competency.manage","recruitment_catalog.manage"]};function showToast(){}sessionStorage.setItem("ats_token","mock-session-not-a-credential");</script>' + ['js/api.js', 'js/components/action-menu.js', 'js/components/modal-focus.js', 'js/pages/recruitment-catalogs.js', 'js/pages/departments.js', 'js/pages/competencies.js'].map(file => '<script src="/' + file + '"></script>').join('') + '</body></html>');
      return;
    }
    const file = req.url.split('?')[0].slice(1);
    if (!/^(js|css)\/[\w/.-]+\.(js|css)$/.test(file) || file.includes('..')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
    res.end(read(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.slice('/api/v1'.length), method = request.method();
      assert.equal(url.origin, origin);
      assert.equal(request.headers().authorization, 'Bearer mock-session-not-a-credential');
      const body = method === 'GET' ? null : request.postDataJSON();
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(data) });
      if (method !== 'GET') {
        writes.push({ endpoint, method, body });
        if (state.rejectNext) { state.rejectNext = false; return reply({ success: false, message: 'Không có quyền lưu dữ liệu thử nghiệm.' }, 403); }
      }
      if (endpoint === '/auth/permissions') return reply({ success: true, permissions: state.manage ? ['department.manage', 'competency.manage'] : [] });
      if (endpoint === '/admin/users') return reply({ success: true, data: { items: [{ id: 'manager-fixture', fullName: 'Người quản lý thử nghiệm' }] } });
      if (endpoint === '/departments' && method === 'GET') {
        const tree = state.departments.filter(d => !d.parentId).map(d => ({ ...d, children: state.departments.filter(c => c.parentId === d.id) }));
        return reply({ success: true, departments: state.departments, tree, total: state.departments.length });
      }
      if (endpoint === '/competency-frameworks' && method === 'GET') return reply({ success: true, frameworks: state.frameworks });
      if (endpoint === '/job-titles' && method === 'GET') return reply({ success: true, jobTitles: state.titles.map(t => state.salary ? t : Object.fromEntries(Object.entries(t).filter(([key]) => !['minSalary', 'maxSalary'].includes(key)))), canManage: state.manage, canViewSalary: state.salary });
      if (endpoint === '/recruitment-catalogs' && method === 'GET') return reply({ success: true, items: state.catalogs.filter(c => c.type === url.searchParams.get('type')) });
      if (endpoint === '/recruitment-catalogs/reorder') {
        state.catalogs = body.orderedIds.map((id, index) => ({ ...state.catalogs.find(c => c.id === id), displayOrder: index }));
        return reply({ success: true, items: state.catalogs });
      }
      const groups = [['/recruitment-catalogs', 'catalogs'], ['/departments', 'departments'], ['/competency-frameworks', 'frameworks'], ['/job-titles', 'titles']];
      const group = groups.find(([base]) => endpoint === base || endpoint.startsWith(base + '/'));
      if (!group) return reply({ success: false }, 404);
      const [base, key] = group, id = endpoint.slice(base.length + 1);
      if (method === 'DELETE') { state[key] = state[key].filter(item => item.id !== id); return reply({ success: true }); }
      const existing = id ? state[key].find(item => item.id === id) : null;
      const item = { ...existing, ...body, id: existing?.id || 'new-' + key + '-' + writes.length, status: body.status || 'ACTIVE' };
      if (key === 'departments') { item.manager = { id: body.managerId, fullName: 'Người quản lý thử nghiệm' }; item.children = []; }
      if (key === 'frameworks') item.totalWeight = body.criteria.reduce((sum, c) => sum + c.weight, 0);
      if (key === 'titles') item.framework = state.frameworks.find(f => f.id === body.frameworkId) || null;
      if (existing) state[key][state[key].indexOf(existing)] = item; else state[key].push(item);
      return reply({ success: true, data: item }, existing ? 200 : 201);
    });
    await page.goto(origin);
    const test = async (name, action) => { await action(); results.push({ name, status: 'PASS' }); console.log('PASS ' + name); };
    const select = async name => {
      await page.evaluate(async name => {
        for (const id of ['recruitment-catalogs', 'departments', 'competencies']) document.getElementById(id + '-view').classList.add('hidden');
        document.getElementById(name + '-view').classList.remove('hidden');
        currentActiveView = name === 'recruitment-catalogs' ? 'recruitmentCatalogs' : name;
        if (name === 'recruitment-catalogs') await loadRecruitmentCatalogs();
        if (name === 'departments') await loadDepartments();
        if (name === 'competencies') await loadCompetencies();
      }, name);
    };
    const hidden = async id => assert.equal(await page.locator('#' + id).isVisible(), false);
    const screenshot = async name => page.screenshot({ path: path.join(artifacts, name + '.png'), fullPage: true });
    const visible = async id => { await page.locator('#' + id).waitFor({ state: 'visible' }); };
    const modalIds = ['recruitment-catalog-modal', 'department-modal', 'competency-framework-modal', 'job-title-modal'];
    await test('AC01 all four forms start hidden', async () => {
      assert.equal(await page.locator('.management-modal').count(), 4);
      for (const name of ['recruitment-catalogs', 'departments', 'competencies']) { await select(name); for (const id of modalIds) await hidden(id); await screenshot(name + '-list-desktop'); }
    });
    await select('recruitment-catalogs');
    await test('AC02 AC06 catalog opens with five original fields', async () => {
      await page.locator('#recruitment-catalog-new-btn').click(); await visible('recruitment-catalog-modal');
      for (const field of ['type', 'code', 'name', 'order', 'status']) assert.equal(await page.locator('#recruitment-catalog-' + field + '-input').isVisible(), true);
      await screenshot('catalog-modal-desktop');
    });
    await test('AC08 cancel makes no API mutation and restores focus', async () => {
      const before = writes.length; await page.locator('#recruitment-catalog-code-input').fill('DISCARD');
      await page.locator('#recruitment-catalog-modal [data-close-management-modal]').last().click(); await hidden('recruitment-catalog-modal'); assert.equal(writes.length, before);
      await page.waitForFunction(() => document.activeElement.id === 'recruitment-catalog-new-btn');
    });
    await test('AC09 catalog required and API error keep modal open', async () => {
      await page.locator('#recruitment-catalog-new-btn').click(); const before = writes.length; await page.locator('#recruitment-catalog-save-btn').click(); assert.equal(writes.length, before);
      await page.locator('#recruitment-catalog-code-input').fill('LINKEDIN'); await page.locator('#recruitment-catalog-name-input').fill('LinkedIn thử nghiệm'); state.rejectNext = true;
      await page.locator('#recruitment-catalog-save-btn').click(); await visible('recruitment-catalog-form-alert'); await visible('recruitment-catalog-modal');
    });
    await test('AC07 catalog save refreshes list and edit keeps status', async () => {
      await page.locator('#recruitment-catalog-save-btn').click(); await page.locator('#recruitment-catalog-modal').waitFor({ state: 'hidden' });
      const item = state.catalogs.find(c => c.code === 'LINKEDIN'); await page.locator('[data-catalog-action="edit"][data-catalog-id="' + item.id + '"]').click(); await visible('recruitment-catalog-modal');
      await page.locator('#recruitment-catalog-status-input').selectOption('INACTIVE'); await page.locator('#recruitment-catalog-save-btn').click(); await page.locator('#recruitment-catalog-modal').waitFor({ state: 'hidden' }); assert.equal(state.catalogs.find(c => c.id === item.id).status, 'INACTIVE');
    });
    await test('AC09 catalog reorder and delete still work', async () => {
      const id = state.catalogs[1].id; await page.locator('[data-catalog-action="up"][data-catalog-id="' + id + '"]').click(); await page.waitForFunction(id => document.querySelector('#recruitment-catalog-table-body tr [data-catalog-id]')?.dataset.catalogId === id, id);
      const last = state.catalogs.at(-1).id; await page.locator('[data-catalog-action="delete"][data-catalog-id="' + last + '"]').click(); await page.waitForFunction(id => !document.querySelector('[data-catalog-action="edit"][data-catalog-id="' + id + '"]'), last);
    });
    await select('departments');
    await test('AC03 AC06 department opens with parent and manager', async () => {
      await page.locator('#department-new-btn').click(); await visible('department-modal');
      for (const id of ['department-code-input', 'department-name-input', 'department-parent-select', 'department-manager-select']) assert.equal(await page.locator('#' + id).isVisible(), true);
      await screenshot('department-modal-desktop');
    });
    await test('department cancel and Escape do not submit', async () => {
      const before = writes.length; await page.keyboard.press('Escape'); await hidden('department-modal'); assert.equal(writes.length, before);
    });
    await test('AC07 department saves parent relation and refreshes org tree', async () => {
      await page.locator('#department-new-btn').click(); await page.locator('#department-code-input').fill('DEV'); await page.locator('#department-name-input').fill('Phòng Kỹ thuật thử nghiệm');
      await page.locator('#department-parent-select').selectOption('dept-fixture'); await page.locator('#department-manager-select').selectOption('manager-fixture'); await page.locator('#department-save-btn').click(); await page.locator('#department-modal').waitFor({ state: 'hidden' });
      assert.equal(state.departments.find(d => d.code === 'DEV').parentId, 'dept-fixture'); assert.match(await page.locator('#departments-tree-container').innerText(), /Phòng Kỹ thuật thử nghiệm/);
    });
    await test('AC09 org tree edit and delete remain available', async () => {
      const item = state.departments.find(d => d.code === 'DEV'); await page.locator('.department-action-trigger[data-department-id="' + item.id + '"]').click(); await page.locator('[data-department-action="edit"]').click(); await visible('department-modal');
      assert.equal(await page.locator('#department-parent-select').inputValue(), 'dept-fixture'); await page.locator('#department-name-input').fill('Phòng đã sửa'); await page.locator('#department-save-btn').click(); await page.locator('#department-modal').waitFor({ state: 'hidden' });
      await page.locator('.department-action-trigger[data-department-id="' + item.id + '"]').click(); await page.locator('[data-department-action="delete"]').click(); await page.waitForFunction(id => !document.querySelector('.department-action-trigger[data-department-id="' + id + '"]'), item.id);
    });
    await select('competencies');
    await test('AC04 AC06 framework opens full criteria editor', async () => {
      await page.locator('#competency-framework-new-btn').click(); await visible('competency-framework-modal');
      for (const id of ['competency-framework-code-input', 'competency-framework-name-input', 'competency-framework-description-input', 'competency-criteria-container', 'competency-add-criterion-btn']) assert.equal(await page.locator('#' + id).isVisible(), true);
      await screenshot('framework-modal-desktop');
    });
    await test('AC09 framework invalid weight is rejected without mutation', async () => {
      await page.locator('#competency-framework-code-input').fill('ENGINEERING'); await page.locator('#competency-framework-name-input').fill('Khung Kỹ thuật thử nghiệm'); await page.locator('[data-criterion-name]').fill('Chuyên môn'); await page.locator('[data-criterion-weight]').fill('50');
      const before = writes.length; await page.locator('#competency-framework-save-btn').click(); await visible('competency-framework-form-alert'); assert.equal(writes.length, before);
    });
    await test('AC07 framework saves criteria and refreshes list', async () => {
      await page.locator('[data-criterion-weight]').fill('100'); await page.locator('#competency-framework-save-btn').click(); await page.locator('#competency-framework-modal').waitFor({ state: 'hidden' }); assert.match(await page.locator('#competency-framework-list').innerText(), /Khung Kỹ thuật thử nghiệm/);
    });
    await test('AC09 framework edit retains criteria and updates', async () => {
      const item = state.frameworks.find(f => f.code === 'ENGINEERING'); await page.locator('[data-competency-edit="' + item.id + '"]').click(); await visible('competency-framework-modal'); assert.equal(await page.locator('[data-criterion-weight]').inputValue(), '100');
      await page.locator('#competency-framework-description-input').fill('Mô tả đã cập nhật'); await page.locator('#competency-framework-save-btn').click(); await page.locator('#competency-framework-modal').waitFor({ state: 'hidden' }); assert.equal(state.frameworks.find(f => f.id === item.id).description, 'Mô tả đã cập nhật');
    });
    await test('AC05 AC06 title opens full level salary and framework fields', async () => {
      await page.locator('#job-title-new-btn').click(); await visible('job-title-modal'); for (const id of ['job-title-code-input', 'job-title-name-input', 'job-title-level-input', 'job-title-min-salary-input', 'job-title-max-salary-input', 'job-title-framework-select']) assert.equal(await page.locator('#' + id).isVisible(), true);
      await screenshot('job-title-modal-desktop');
    });
    await test('AC09 inverted salary rejected without saving', async () => {
      await page.locator('#job-title-code-input').fill('QA'); await page.locator('#job-title-name-input').fill('Kỹ sư QA thử nghiệm'); await page.locator('#job-title-level-input').fill('Senior'); await page.locator('#job-title-min-salary-input').fill('40000000'); await page.locator('#job-title-max-salary-input').fill('20000000');
      const before = writes.length; await page.locator('#job-title-save-btn').click(); await visible('job-title-form-alert'); assert.equal(writes.length, before);
    });
    await test('AC07 title saves salary and framework relationship', async () => {
      await page.locator('#job-title-max-salary-input').fill('50000000'); await page.locator('#job-title-framework-select').selectOption('framework-fixture'); await page.locator('#job-title-save-btn').click(); await page.locator('#job-title-modal').waitFor({ state: 'hidden' });
      const title = state.titles.find(t => t.code === 'QA'); assert.equal(title.minSalary, 40000000); assert.equal(title.maxSalary, 50000000); assert.equal(title.framework.id, 'framework-fixture');
    });
    await test('AC09 title edit preserves level and salary', async () => {
      const item = state.titles.find(t => t.code === 'QA'); await page.locator('[data-job-title-edit="' + item.id + '"]').click(); await visible('job-title-modal'); assert.equal(await page.locator('#job-title-level-input').inputValue(), 'Senior'); assert.equal(await page.locator('#job-title-min-salary-input').inputValue(), '40000000');
      await page.locator('#job-title-name-input').fill('QA đã sửa'); await page.locator('#job-title-save-btn').click(); await page.locator('#job-title-modal').waitFor({ state: 'hidden' }); assert.equal(state.titles.find(t => t.id === item.id).name, 'QA đã sửa');
    });
    await test('modal keyboard focus remains trapped and close returns focus', async () => {
      await page.locator('#job-title-new-btn').click(); await page.locator('#job-title-save-btn').focus(); await page.keyboard.press('Tab'); await page.waitForFunction(() => document.activeElement.matches('#job-title-modal .modal-close'));
      await page.keyboard.press('Shift+Tab'); await page.waitForFunction(() => document.activeElement.id === 'job-title-save-btn'); await page.keyboard.press('Escape'); await hidden('job-title-modal'); await page.waitForFunction(() => document.activeElement.id === 'job-title-new-btn');
    });
    await test('navigation closes dialogs and returns to list-only view', async () => {
      await page.locator('#competency-framework-new-btn').click(); await select('departments'); await select('competencies'); for (const id of modalIds) await hidden(id);
    });
    await test('AC08 all four cancel buttons make no request', async () => {
      for (const [view, opener, modal] of [['recruitment-catalogs', 'recruitment-catalog-new-btn', 'recruitment-catalog-modal'], ['departments', 'department-new-btn', 'department-modal'], ['competencies', 'competency-framework-new-btn', 'competency-framework-modal'], ['competencies', 'job-title-new-btn', 'job-title-modal']]) {
        await select(view); await page.locator('#' + opener).click(); const before = writes.length; await page.locator('#' + modal + ' button[data-close-management-modal]').last().click(); await hidden(modal); assert.equal(writes.length, before);
      }
    });
    await test('AC09 read-only permissions hide create and edit controls', async () => {
      state.manage = false; state.salary = false; await select('departments'); await hidden('department-new-btn'); assert.equal(await page.locator('.department-action-trigger:enabled').count(), 0);
      await select('competencies'); await hidden('competency-framework-new-btn'); await hidden('job-title-new-btn'); assert.equal(await page.locator('[data-job-title-edit]:visible,[data-competency-edit]:visible').count(), 0);
      state.manage = true; await select('competencies'); await visible('competency-framework-new-btn'); await hidden('job-title-new-btn'); await page.locator('[data-job-title-edit="title-fixture"]').click(); await hidden('job-title-salary-fields'); await page.keyboard.press('Escape');
      state.salary = true;
    });
    await test('mobile 390px lists and four dialogs fit viewport', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const [view, opener, modal] of [['recruitment-catalogs', 'recruitment-catalog-new-btn', 'recruitment-catalog-modal'], ['departments', 'department-new-btn', 'department-modal'], ['competencies', 'competency-framework-new-btn', 'competency-framework-modal'], ['competencies', 'job-title-new-btn', 'job-title-modal']]) {
        await select(view); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.locator('#' + opener).click(); await visible(modal);
        const box = await page.locator('#' + modal + ' .modal-card').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 391 && box.height <= 844); assert.ok(await page.locator('#' + modal + ' .modal-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        await screenshot(modal + '-mobile'); await page.keyboard.press('Escape');
      }
    });
    await test('no JavaScript errors and only intercepted mock writes', async () => { assert.deepEqual(errors, []); assert.ok(writes.length > 0); });
    console.log('MANAGEMENT_MODAL_RESULT ' + JSON.stringify({ passed: results.length, failed: 0, database: 'NOT USED', artifacts }));
  } catch (error) {
    results.push({ status: 'FAIL', error: error.message });
    throw error;
  } finally {
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ results, database: 'NOT USED', backend: 'mock API', errors }, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
