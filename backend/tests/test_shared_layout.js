const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm', 'backend/data/ats.db-wal', 'backend/data/ats_test.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run shared layout tests in a fresh isolated TEMP copy without .git, .env or existing databases.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
const { startServer, server } = require('../src/server');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const read = file => fs.readFileSync(path.join(root, 'frontend', file), 'utf8');
const manifest = JSON.parse(read('routes.json')), css = read('css/style.css'), shell = read('index.html');
let passed = 0, failed = 0, base;
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
// Resolve actual declarations/media queries for the exact shared selectors below.
// This is a CSS contract test, not a browser layout engine or a visual measurement.
function rules(source, conditions = []) {
  const result = []; source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let start = 0; start < source.length;) {
    const brace = source.indexOf('{', start); if (brace < 0) break;
    let selector = source.slice(start, brace).trim();
    if (selector.includes(';')) selector = selector.slice(selector.lastIndexOf(';') + 1).trim();
    let depth = 1, end = brace + 1;
    while (end < source.length && depth) { if (source[end] === '{') depth++; else if (source[end] === '}') depth--; end++; }
    const body = source.slice(brace + 1, end - 1); start = end;
    if (selector.startsWith('@media')) result.push(...rules(body, conditions.concat(selector)));
    else if (!selector.startsWith('@')) {
      const declarations = Object.fromEntries(body.split(';').map(item => { const colon = item.indexOf(':'); return colon < 0 ? [] : [item.slice(0, colon).trim(), item.slice(colon + 1).trim()]; }).filter(item => item.length));
      for (const name of selector.split(',')) result.push({ selector: name.trim(), conditions, declarations });
    }
  }
  return result;
}
const parsed = rules(css);
function style(selector, width = 1920, height = 1080) {
  const applicable = query => {
    if (query.includes('prefers-reduced-motion')) return false;
    return Array.from(query.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)).every(([, direction, axis, limit]) =>
      direction === 'max' ? (axis === 'width' ? width : height) <= Number(limit) : (axis === 'width' ? width : height) >= Number(limit));
  };
  return Object.assign({}, ...parsed.filter(rule => rule.selector === selector && rule.conditions.every(applicable)).map(rule => rule.declarations));
}
function pixels(value) {
  const variable = value.match(/^var\((--[\w-]+)\)$/); if (variable) value = style(':root')[variable[1]];
  assert.match(value, /^\d+px$/); return Number(value.slice(0, -2));
}
function geometry(width, height) {
  const wrapper = style('.app-content-wrapper', width, height), main = style('.app-main', width, height);
  const margin = wrapper['margin-left'] === '0' ? 0 : pixels(wrapper['margin-left']);
  const padding = pixels(main.padding), available = width - margin;
  assert.equal(main.width, '100%'); assert.equal(main['max-width'], 'none');
  return { sidebar: margin, main: available, page: available - 2 * padding, padding, rightGap: padding };
}
async function main() {
  await test('Shared workspace removes the global page max-width while retaining width 100%', () => {
    assert.equal(style('.app-main')['max-width'], 'none'); assert.equal(style('.app-main').width, '100%');
    assert.equal(parsed.filter(rule => rule.selector === '.app-main' && rule.declarations['max-width'] && rule.declarations['max-width'] !== 'none').length, 0);
  });
  await test('Fixed-sidebar flex shell fills the remainder without using main width 100vw', () => {
    assert.equal(style('.app-shell').display, 'flex'); assert.equal(style('.app-sidebar').position, 'fixed');
    const wrapper = style('.app-content-wrapper'); assert.equal(wrapper.flex, '1'); assert.equal(wrapper.width, 'calc(100% - var(--sidebar-width))');
    assert.equal(wrapper['margin-left'], 'var(--sidebar-width)'); assert.equal(wrapper['min-width'], '0'); assert.notEqual(style('.app-main').width, '100vw');
  });
  await test('Shared main and page-root children allow shrinking without intrinsic-width overflow', () => {
    assert.equal(style('.app-main')['min-width'], '0'); assert.equal(style('.app-main > [id$="-view"]').width, '100%'); assert.equal(style('.app-main > [id$="-view"]')['min-width'], '0');
    assert.equal(style('*')['box-sizing'], 'border-box');
  });
  await test('Desktop page and topbar retain aligned 32px outer padding', () => {
    assert.equal(pixels(style('.app-main').padding), 32); assert.equal(style('.app-topbar').padding, '0 var(--space-8)');
    assert.equal(style('.app-topbar')['max-width'], undefined); assert.equal(style('.app-content-wrapper')['max-width'], undefined);
  });
  await test('Shared tables fill their wrapper and retain internal scrolling and content-based columns', () => {
    assert.equal(style('.table-wrapper').width, '100%'); assert.equal(style('.table-wrapper')['min-width'], '0'); assert.equal(style('.table-wrapper')['overflow-x'], 'auto');
    assert.equal(style('.data-table').width, '100%'); assert.equal(style('.data-table')['table-layout'], undefined); assert.equal(style('.users-actions-cell').width, '88px');
  });
  await test('Dashboard/shared two-column tracks use zero minimums and retain the original ratio', () => {
    assert.equal(style('.dashboard-grid-2col')['grid-template-columns'], 'minmax(0, 2fr) minmax(0, 1fr)');
    assert.equal(style('.dashboard-grid-2col', 1024)['grid-template-columns'], '1fr');
    assert.equal(style('.pipeline-funnel')['overflow-x'], 'auto');
    assert.match(style('.kpi-grid')['grid-template-columns'], /repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
  });
  await test('Dashboard keeps four KPI cards, full-flow funnel/lower grid and no login-history widget', () => {
    const html = read('pages/dashboard.html'); assert.equal((html.match(/class="kpi-card"/g) || []).length, 4);
    assert.match(html, /id="dashboard-funnel-container"/); assert.match(html, /class="dashboard-grid-2col"/); assert.doesNotMatch(html, /Lịch sử đăng nhập|dashboard-activity-table|Nhật ký Hoạt động Hệ thống/);
  });
  await test('Department workspace remains responsive without scaling nodes or changing hierarchy', () => {
    assert.equal(style('.department-workspace')['grid-template-columns'], 'minmax(0, 1.2fr) minmax(0, .8fr)');
    assert.equal(style('.department-workspace', 768)['grid-template-columns'], 'minmax(0, 1fr)');
    const source = read('js/pages/departments.js'); assert.match(source, /margin-left: \$\{depth \* 22\}px/); assert.match(source, /data-department-id=/);
    assert.equal(style('.users-action-menu').position, 'fixed'); assert.equal(style('.users-action-menu')['z-index'], '90');
  });
  for (const [width, height] of [[360, 800], [768, 1024], [1024, 768], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440]]) {
    await test(width + 'x' + height + ' resolves the full-width shared CSS contract (not measured browser geometry)', () => {
      const expectedSidebar = width <= 768 ? 0 : 260, expectedPadding = width <= 768 ? 16 : 32, layout = geometry(width, height);
      assert.equal(layout.sidebar, expectedSidebar); assert.equal(layout.main, width - expectedSidebar); assert.equal(layout.page, width - expectedSidebar - 2 * expectedPadding); assert.equal(layout.rightGap, expectedPadding);
      assert.ok(layout.main <= width); assert.ok(layout.page > 0);
      console.log('LAYOUT_CONTRACT ' + JSON.stringify({ width, height, ...layout }));
    });
  }
  await test('At wide desktops the former 1400px cap no longer leaves 260/900px unused', () => {
    assert.equal(geometry(1920, 1080).main, 1660); assert.equal(geometry(2560, 1440).main, 2300);
    assert.equal(geometry(1920, 1080).rightGap, 32); assert.equal(geometry(2560, 1440).rightGap, 32);
  });
  await test('Modal/form component limits remain independent from the full-width page roots', () => {
    assert.equal(style('.modal-card')['max-width'], '520px'); assert.equal(style('.create-user-result-card')['max-width'], '540px');
    for (const file of ['create-user-modal.html', 'edit-user-modal.html', 'assign-roles-modal.html', 'edit-profile-modal.html']) {
      const html = read('components/' + file); assert.match(html, /class="modal-card"/); assert.doesNotMatch(html, /class="app-main"/);
    }
    assert.match(read('components/edit-profile-modal.html'), /max-width: 500px/);
  });
  await test('Profile page fills the shell while its editable form keeps its existing 500px modal limit', () => {
    const profile = read('pages/profile.html'); assert.match(profile, /class="dashboard-grid-2col"/); assert.doesNotMatch(profile, /<form/);
    assert.match(read('components/edit-profile-modal.html'), /max-width: 500px/); assert.match(read('components/edit-profile-modal.html'), /id="edit-profile-form"/);
  });
  await test('Public login keeps its separate 60/40 desktop design and bounded glass form', () => {
    assert.equal(style('#login-view')['grid-template-columns'], 'minmax(0, 3fr) minmax(0, 2fr)'); assert.equal(style('.login-glass-form')['max-width'], '440px');
    assert.equal(style('#login-view', 360)['grid-template-columns'], 'minmax(0, 1fr)'); assert.equal(style('.login-container', 1920).width, '100%');
    const mainStart = shell.indexOf('<main class="app-main">'), mainEnd = shell.indexOf('</main>', mainStart), main = shell.slice(mainStart, mainEnd);
    for (const fragment of ['/pages/login.html', '/pages/forgot-password.html', '/pages/reset-password.html']) assert.ok(!main.includes('data-fragment="' + fragment + '"'));
  });
  await test('Mobile drawer/header and safe-area FAB retain their independent presentation', () => {
    assert.equal(style('.app-content-wrapper', 360)['margin-left'], '0'); assert.equal(style('.app-content-wrapper', 360).width, '100%');
    assert.equal(style('.app-sidebar', 360).width, 'min(82vw, 300px)'); assert.equal(style('.app-topbar', 360).height, '60px');
    assert.equal(style('#topbar-create-req-btn', 360).position, 'fixed'); assert.equal(style('#topbar-create-req-btn', 360).width, '52px');
    assert.equal(style('.topbar-breadcrumbs', 360).display, 'none'); assert.equal(style('.app-main', 360)['padding-bottom'], 'calc(88px + env(safe-area-inset-bottom))');
  });
  await startServer(0); base = 'http://127.0.0.1:' + server.address().port;
  await require('../src/db/migrate-approval-configurations').migrate(require('../src/db/database').getDatabase());
  require('../src/config/config').APPROVAL_CONFIGURATION_ENABLED = true;
  await require('../src/db/migrate-requisition-approvals').migrate(require('../src/db/database').getDatabase());
  await require('../src/db/migrate-headcount-budgets').migrate(require('../src/db/database').getDatabase());
  require('../src/config/config').HEADCOUNT_BUDGET_ENABLED = true;
  const sessions = {};
  for (const [key, email] of [['hr', 'hrmanager@company.com'], ['admin', 'admin@company.com'], ['candidate', 'candidate@example.com']]) {
    const response = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ats@123456' }) }); assert.equal(response.status, 200); sessions[key] = (await response.json()).data;
  }
  const clients = {};
  for (const key of Object.keys(sessions)) {
    const user = sessions[key]; clients[key] = await createFrontendRuntime(base, key === 'candidate' ? '/candidate' : '/dashboard', [['ats_token', user.token], ['ats_user', JSON.stringify(user.user)]], { width: 1920, height: 1080 });
  }
  const viewId = view => ({ questionBank: 'question-bank', recruitmentCatalogs: 'recruitment-catalogs', careerPage: 'career-page', candidatePortal: 'candidate-portal' })[view] || view;
  const mainStart = shell.indexOf('<main class="app-main">'), mainEnd = shell.indexOf('</main>', mainStart), mainMarkup = shell.slice(mainStart, mainEnd);
  for (const route of manifest.routes.filter(item => item.auth)) {
    await test(route.path + ' activates its retained page under the same full-width shell', async () => {
      const key = route.view === 'candidatePortal' ? 'candidate' : route.view === 'audit' ? 'admin' : 'hr', f = clients[key], id = viewId(route.view) + '-view';
      const fragment = manifest.fragments.find(file => file.startsWith('/pages/') && read(file).includes('id="' + id + '"'));
      assert.ok(fragment, 'Manifest page must exist'); assert.ok(mainMarkup.includes('data-fragment="' + fragment + '"'), 'Page must mount directly in main');
      const firstTag = read(fragment).match(/<div\b[^>]*>/)[0]; assert.match(firstTag, new RegExp('id="' + id + '"')); assert.doesNotMatch(firstTag, /max-width|width:|margin:/);
      f.window.ATS_ROUTER.navigate(route.path); await f.settle(); assert.equal(f.window.location.pathname, route.path); assert.equal(f.nodes.get(id).classList.contains('hidden'), false); assert.equal(f.nodes.get('app-shell').classList.contains('hidden'), false); assert.deepEqual(f.errors, []);
      assert.equal(style('.app-main > [id$="-view"]').width, '100%'); assert.equal(geometry(1920, 1080).page, 1596);
    });
  }
  await test('Desktop-to-mobile transition preserves the same page and drawer lifecycle', async () => {
    const f = clients.hr; f.window.ATS_ROUTER.navigate('/dashboard'); await f.settle(); f.window.innerWidth = 360; f.window.innerHeight = 800; await f.dispatchWindow('resize');
    await f.nodes.get('sidebar-toggle-btn').dispatch('click'); assert.equal(f.nodes.get('app-sidebar').classList.contains('show-mobile'), true);
    await f.nodes.get('sidebar-backdrop').dispatch('click'); assert.equal(f.nodes.get('sidebar-toggle-btn').getAttribute('aria-expanded'), 'false'); assert.equal(f.document.body.style.overflow, undefined); assert.equal(f.window.location.pathname, '/dashboard'); assert.deepEqual(f.errors, []);
  });
  await test('Page width has no universal zoom/scale or a new right-hand panel', () => {
    for (const selector of ['.app-shell', '.app-content-wrapper', '.app-main', '.app-main > [id$="-view"]']) { assert.equal(style(selector).zoom, undefined); assert.equal(style(selector).transform, undefined); }
    assert.equal((shell.match(/class="app-sidebar"/g) || []).length, 1); assert.equal((shell.match(/<main /g) || []).length, 1);
  });
  console.log('LAYOUT_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed })); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
