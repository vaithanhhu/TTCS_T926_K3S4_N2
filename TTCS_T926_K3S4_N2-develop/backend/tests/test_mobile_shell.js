const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm', 'backend/data/ats.db-wal', 'backend/data/ats_test.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run mobile shell tests in a fresh isolated TEMP copy without .git, .env or existing databases.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
const { startServer, server } = require('../src/server');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'frontend/css/style.css'), 'utf8');
const mobileCss = css.slice(css.indexOf('@media (max-width: 768px)'));
let base, passed = 0, failed = 0;
const users = {};
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
async function fixture({ role = 'hr', width = 360, height = 800, route = '/dashboard', guest = false } = {}) {
  const user = users[role];
  const f = await createFrontendRuntime(base, route, guest ? [] : [['ats_token', user.token], ['ats_user', JSON.stringify(user.user)]], { width, height });
  f.drawer = f.nodes.get('app-sidebar'); f.toggle = f.nodes.get('sidebar-toggle-btn'); f.backdrop = f.nodes.get('sidebar-backdrop');
  f.content = f.nodes.get('app-content-wrapper');
  // Mirror real sidebar containment for keyboard/focus tests; use the real retained nodes/listeners.
  const navigation = Array.from(f.nodes.values()).filter(node => node.classes.has('nav-link'));
  f.drawer.children = [f.nodes.get('sidebar-close-btn'), ...navigation, f.nodes.get('sidebar-logout-btn')];
  f.drawer.children.forEach(node => { node.parentNode = f.drawer; });
  f.drawer.querySelectorAll = selector => selector === 'button, [tabindex="0"], a[href]' ? f.drawer.children : [];
  f.menu = f.window.ATS_MOBILE_NAVIGATION;
  f.open = () => f.toggle.dispatch('click');
  f.closed = () => {
    assert.equal(f.drawer.classList.contains('show-mobile'), false);
    assert.equal(f.backdrop.classList.contains('hidden'), true);
    assert.equal(f.toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(f.document.body.style.overflow, undefined);
    assert.equal(f.document.documentElement.style.overflow, undefined);
    assert.equal(f.content.inert || false, false);
  };
  return f;
}
function listeners(f) {
  return JSON.stringify({ toggle: f.toggle.listeners.get('click').length,
    backdrop: f.backdrop.listeners.get('click').length, document: Array.from(f.documentEvents, ([key, values]) => [key, values.length]),
    window: Array.from(f.events, ([key, values]) => [key, values.length]) });
}
async function main() {
  await startServer(0); base = 'http://127.0.0.1:' + server.address().port;
  for (const [role, email] of Object.entries({ admin: 'admin@company.com', hr: 'hrmanager@company.com', hiring: 'hiringmgr@company.com', recruiter: 'recruiter@company.com', interviewer: 'interviewer@company.com', candidate: 'candidate@example.com' })) {
    const response = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Ats@123456' }) });
    assert.equal(response.status, 200); users[role] = (await response.json()).data;
  }
  await test('One retained sidebar, backdrop and accessible menu trigger in the authenticated shell', async () => {
    const f = await fixture(); f.closed(); assert.equal(f.nodes.get('app-shell').classList.contains('hidden'), false);
    assert.equal((html.match(/id="sidebar-backdrop"/g) || []).length, 1);
    assert.equal((html.match(/id="app-sidebar"/g) || []).length, 1);
    assert.equal(f.toggle.getAttribute('aria-label'), 'Mở menu'); assert.equal(f.toggle.getAttribute('aria-controls'), 'app-sidebar');
    assert.equal(f.drawer.inert, true); assert.equal(f.drawer.getAttribute('aria-hidden'), 'true'); assert.deepEqual(f.errors, []);
  });
  await test('Hamburger opens exactly the class consumed by CSS and updates aria-expanded', async () => {
    const f = await fixture(); await f.open();
    assert.equal(f.drawer.classList.contains('show-mobile'), true); assert.equal(f.drawer.classList.contains('open'), false);
    assert.match(mobileCss, /\.app-sidebar\.show-mobile\s*\{[^}]*transform:\s*translateX\(0\)/);
    assert.equal(f.toggle.getAttribute('aria-expanded'), 'true'); assert.equal(f.backdrop.classList.contains('hidden'), false);
    assert.equal(f.drawer.inert, false); assert.equal(f.drawer.getAttribute('aria-modal'), 'true'); assert.equal(f.drawer.getAttribute('role'), 'dialog');
  });
  await test('Second hamburger click closes and restores focus', async () => {
    const f = await fixture(); await f.open(); await f.open(); f.closed(); assert.equal(f.document.activeElement, f.toggle);
  });
  await test('Visible drawer header menu control closes without reaching the covered background toggle', async () => {
    const f = await fixture(); await f.open(); await f.nodes.get('sidebar-close-btn').dispatch('click'); f.closed(); assert.equal(f.document.activeElement, f.toggle);
  });
  await test('Backdrop click closes and restores focus', async () => {
    const f = await fixture(); await f.open(); await f.backdrop.dispatch('click'); f.closed(); assert.equal(f.document.activeElement, f.toggle);
  });
  await test('Escape closes with no retained scroll lock', async () => {
    const f = await fixture(); await f.open(); let prevented = 0; await f.document.dispatch('keydown', { key: 'Escape', preventDefault() { prevented++; } });
    f.closed(); assert.equal(prevented, 1); assert.equal(f.document.activeElement, f.toggle);
  });
  await test('Drawer locks both scroll roots and makes the covered content inert', async () => {
    const f = await fixture(); await f.open(); assert.equal(f.document.body.style.overflow, 'hidden'); assert.equal(f.document.documentElement.style.overflow, 'hidden'); assert.equal(f.content.inert, true);
    assert.equal(f.document.activeElement, f.nodes.get('sidebar-close-btn'));
  });
  await test('Close restores pre-existing overflow/inert state rather than forcing defaults', async () => {
    const f = await fixture(); f.document.body.style.overflow = 'auto'; f.document.documentElement.style.overflow = 'scroll'; f.content.inert = true;
    await f.open(); f.menu.close(); assert.equal(f.document.body.style.overflow, 'auto'); assert.equal(f.document.documentElement.style.overflow, 'scroll'); assert.equal(f.content.inert, true);
  });
  await test('Tab and Shift+Tab stay in the open drawer and skip permission-hidden links', async () => {
    const f = await fixture(); await f.open(); const first = f.nodes.get('sidebar-close-btn'), last = f.nodes.get('sidebar-logout-btn');
    first.focus(); await f.document.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(f.document.activeElement, last);
    last.focus(); await f.document.dispatch('keydown', { key: 'Tab' }); assert.equal(f.document.activeElement, first);
    f.nodes.get('nav-item-audit').focus(); await f.document.dispatch('keydown', { key: 'Escape' }); f.closed();
  });
  await test('Selecting the existing navigation item closes drawer and navigates once', async () => {
    const f = await fixture(); f.requests.length = 0; await f.open(); f.nodes.get('nav-item-requisitions').focus(); await f.nodes.get('nav-item-requisitions').dispatch('click'); await f.settle();
    f.closed(); assert.equal(f.window.location.pathname, '/requisitions'); assert.equal(f.requests.filter(req => req.path === '/api/v1/requisitions').length, 1);
    assert.equal(f.document.activeElement, f.toggle, 'Do not leave keyboard focus inside the closed/inert drawer');
  });
  await test('Keyboard Enter/Space activates the same retained navigation item', async () => {
    const f = await fixture(); await f.open(); await f.nodes.get('nav-item-requisitions').dispatch('keydown', { key: 'Enter' }); await f.settle(); f.closed();
    assert.equal(f.window.location.pathname, '/requisitions'); await f.open(); await f.nodes.get('nav-item-dashboard').dispatch('keydown', { key: ' ' }); await f.settle(); f.closed(); assert.equal(f.window.location.pathname, '/dashboard');
  });
  await test('Programmatic route change closes backdrop and scroll lock', async () => {
    const f = await fixture(); await f.open(); f.window.ATS_ROUTER.navigate('/profile'); await f.settle(); f.closed(); assert.equal(f.window.location.pathname, '/profile');
  });
  await test('Back/Forward lifecycle closes the drawer on each transition', async () => {
    const f = await fixture(); f.window.ATS_ROUTER.navigate('/profile'); await f.settle(); await f.open(); await f.back(); f.closed(); assert.equal(f.window.location.pathname, '/dashboard');
    await f.open(); await f.forward(); f.closed(); assert.equal(f.window.location.pathname, '/profile');
  });
  await test('Forbidden navigation keeps default-deny and cleans the drawer', async () => {
    const f = await fixture({ role: 'hiring' }); await f.open(); f.window.ATS_ROUTER.navigate('/admin/users'); await f.settle(); f.closed();
    assert.equal(f.nodes.get('users-view').classList.contains('hidden'), true); assert.equal(f.nodes.get('error-view').classList.contains('hidden'), false); assert.equal(f.nodes.get('mobile-page-title').textContent, 'Thông báo Lỗi');
  });
  await test('Repeated route renders do not bind a second hamburger or navigation listener', async () => {
    const f = await fixture(); const original = listeners(f), clickCount = f.nodes.get('nav-item-dashboard').listeners.get('click').length;
    for (let i = 0; i < 5; i++) { f.window.ATS_ROUTER.navigate('/profile'); await f.settle(); f.window.ATS_ROUTER.navigate('/dashboard'); await f.settle(); }
    assert.equal(listeners(f), original); assert.equal(clickCount, 1); assert.equal(f.nodes.get('nav-item-dashboard').listeners.get('click').length, clickCount);
    await f.open(); assert.equal(f.drawer.classList.contains('show-mobile'), true);
  });
  await test('Twenty open/close cycles reuse the same single backdrop and restore state', async () => {
    const f = await fixture(), original = f.backdrop; const count = listeners(f);
    for (let i = 0; i < 20; i++) { await f.open(); await f.open(); f.closed(); }
    assert.equal(f.nodes.get('sidebar-backdrop'), original); assert.equal(listeners(f), count); assert.equal((html.match(/id="sidebar-backdrop"/g) || []).length, 1);
  });
  await test('Resize to desktop closes drawer and removes hidden/inert sidebar semantics', async () => {
    const f = await fixture(); await f.open(); f.window.innerWidth = 1366; await f.dispatchWindow('resize'); f.closed();
    assert.equal(f.drawer.inert, false); assert.equal(f.drawer.getAttribute('aria-hidden'), ''); assert.equal(f.drawer.getAttribute('aria-modal'), '');
    f.window.innerWidth = 360; await f.dispatchWindow('resize'); assert.equal(f.drawer.inert, true); await f.open(); assert.equal(f.drawer.classList.contains('show-mobile'), true);
  });
  await test('Logout immediately closes drawer before pending API completes', async () => {
    const f = await fixture(); let finish; f.window.ATS_API.logoutApi = () => new Promise(resolve => { finish = resolve; }); await f.open();
    const pending = f.nodes.get('sidebar-logout-btn').dispatch('click'); f.closed(); finish({ ok: true, data: { success: true } }); await pending; await f.settle();
    assert.equal(f.window.location.pathname, '/login'); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), true); await f.open(); f.closed();
  });
  await test('Session expiry cleans drawer and prevents reopening the authenticated navigation', async () => {
    const f = await fixture(); await f.open(); vm.runInContext('handleSessionExpired()', f.context); await f.settle(); f.closed();
    assert.equal(f.window.location.pathname, '/login'); await f.open(); f.closed();
  });
  await test('Session replacement closes any previous drawer without duplicate handlers', async () => {
    const f = await fixture(); await f.open(); f.context.nextShellUser = users.hiring.user;
    await vm.runInContext('setupAuthenticatedSession(nextShellUser)', f.context); await f.settle(); f.closed(); assert.equal(f.toggle.listeners.get('click').length, 1);
  });
  await test('Pagehide cleanup restores background scrolling', async () => {
    const f = await fixture(); await f.open(); await f.dispatchWindow('pagehide'); f.closed();
  });
  await test('Component destroy closes and removes only its own listeners', async () => {
    const f = await fixture(); await f.open(); const keyCount = f.documentEvents.get('keydown').length, resizeCount = f.events.get('resize').length;
    f.menu.destroy(); f.closed(); assert.equal(f.toggle.listeners.get('click').length, 0); assert.equal(f.backdrop.listeners.get('click').length, 0);
    assert.equal(f.documentEvents.get('keydown').length, keyCount - 1); assert.equal(f.events.get('resize').length, resizeCount - 1);
  });
  for (const route of ['/login', '/forgot-password', '/reset-password']) {
    await test('Public ' + route + ' never opens the authenticated mobile drawer', async () => {
      const f = await fixture({ route, guest: true }); assert.equal(f.nodes.get('app-shell').classList.contains('hidden'), true); await f.open(); f.closed(); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), true);
    });
  }
  await test('Authenticated transition to public page also cleans and hides the drawer/FAB', async () => {
    const f = await fixture(); await f.open(); f.window.ATS_ROUTER.navigate('/forgot-password'); await f.settle(); f.closed(); assert.equal(f.nodes.get('app-shell').classList.contains('hidden'), true); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), true);
  });
  await test('Mobile title reuses the exact existing navigation title rather than a second route map', async () => {
    const f = await fixture({ role: 'admin' });
    for (const [route, expected] of [['/dashboard', 'Tổng quan Tuyển dụng'], ['/admin/users', 'Quản lý Người dùng & Tài khoản'], ['/admin/departments', 'Phòng ban & Sơ đồ tổ chức'], ['/profile', 'Hồ sơ Cá nhân']]) {
      f.window.ATS_ROUTER.navigate(route); await f.settle(); assert.equal(f.nodes.get('mobile-page-title').textContent, expected); assert.equal(f.nodes.get('mobile-page-title').textContent, f.nodes.get('breadcrumb-current-view').textContent);
    }
  });
  await test('Mobile CSS hides only desktop breadcrumb/username/chevron presentation', () => {
    assert.match(mobileCss, /\.topbar-breadcrumbs, #topbar-user-name, \.user-menu-btn > svg\s*\{\s*display: none/);
    assert.match(css, /\.topbar-breadcrumbs\s*\{\s*display: flex/); assert.match(html, /id="topbar-user-name"/); assert.match(html, /id="popover-user-name"/);
  });
  await test('Long titles use min-width zero and ellipsis; hamburger/avatar are fixed touch targets', () => {
    assert.match(mobileCss, /\.topbar-left\s*\{[^}]*flex: 1;[^}]*min-width: 0/);
    assert.match(mobileCss, /\.mobile-page-title\s*\{[^}]*min-width: 0;[^}]*white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/);
    assert.match(mobileCss, /\.user-menu-btn\s*\{[^}]*width: 44px;[^}]*height: 44px/); assert.match(mobileCss, /\.mobile-menu-toggle\s*\{[^}]*flex: 0 0 44px/);
    assert.match(mobileCss, /\.app-topbar\s*\{[^}]*height: 60px;[^}]*min-height: 60px/);
  });
  await test('Existing avatar/account trigger still opens existing profile/password/logout menu', async () => {
    const f = await fixture(); await f.nodes.get('user-menu-btn').dispatch('click'); assert.equal(f.nodes.get('user-menu-popover').classList.contains('show'), true); assert.equal(f.nodes.get('user-menu-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(f.nodes.get('popover-user-name').textContent, users.hr.user.fullName);
    await f.nodes.get('menu-item-profile').dispatch('click'); await f.settle(); assert.equal(f.window.location.pathname, '/profile'); assert.equal(f.nodes.get('user-menu-popover').classList.contains('show'), false);
    await f.nodes.get('user-menu-btn').dispatch('click'); await f.nodes.get('menu-item-change-pwd').dispatch('click'); assert.equal(f.nodes.get('change-pwd-modal').classList.contains('hidden'), false);
  });
  await test('Escape closes account popover without opening the drawer', async () => {
    const f = await fixture(); await f.nodes.get('user-menu-btn').dispatch('click'); await f.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(f.nodes.get('user-menu-popover').classList.contains('show'), false); assert.equal(f.nodes.get('user-menu-btn').getAttribute('aria-expanded'), 'false'); f.closed();
  });
  await test('Create control becomes a safe-area FAB in CSS with no duplicated trigger/handler', () => {
    assert.equal((html.match(/id="topbar-create-req-btn"/g) || []).length, 1);
    assert.match(mobileCss, /#topbar-create-req-btn\s*\{[^}]*position: fixed;[^}]*safe-area-inset-right[^}]*safe-area-inset-bottom[^}]*width: 52px;[^}]*height: 52px/);
    assert.match(mobileCss, /#topbar-create-req-btn span\s*\{\s*display: none/);
    assert.match(mobileCss, /padding-bottom: calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(html, /id="topbar-create-req-btn"[^>]*aria-label="Tạo yêu cầu"/);
  });
  await test('Authorized HR FAB invokes the existing form/options API once', async () => {
    const f = await fixture(); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), false);
    f.requests.length = 0; await f.nodes.get('topbar-create-req-btn').dispatch('click'); await f.settle();
    assert.equal(f.nodes.get('create-req-modal').classList.contains('hidden'), false); assert.equal(f.requests.filter(req => req.path === '/api/v1/requisitions/options').length, 1);
    assert.equal(f.nodes.get('topbar-create-req-btn').listeners.get('click').length, 1);
  });
  for (const role of ['hiring', 'recruiter', 'interviewer', 'admin', 'candidate']) {
    await test(role + ' mobile create action uses actual requisition.create permission/default-deny', async () => {
      const f = await fixture({ role, route: role === 'candidate' ? '/candidate' : '/dashboard' });
      const allowed = users[role].user.permissions.includes('requisition.create'); assert.equal(f.menu.canCreate(), allowed); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), !allowed);
      if (!allowed) { f.requests.length = 0; await f.nodes.get('topbar-create-req-btn').dispatch('click'); await f.settle(); assert.equal(f.requests.some(req => req.path === '/api/v1/requisitions/options'), false); assert.equal(f.nodes.get('create-req-modal').classList.contains('hidden'), true); }
    });
  }
  for (const role of ['hiring', 'recruiter', 'interviewer']) {
    await test(role + ' drawer reuses desktop permission-filtered navigation without exposing admin pages', async () => {
      const mobile = await fixture({ role }), desktop = await fixture({ role, width: 1366 }); await mobile.open();
      for (const [id, node] of mobile.nodes) if (node.classes.has('nav-link')) assert.equal(node.classList.contains('hidden'), desktop.nodes.get(id).classList.contains('hidden'));
      for (const id of ['nav-item-users', 'nav-item-roles', 'nav-item-audit']) assert.equal(mobile.nodes.get(id).classList.contains('hidden'), true);
    });
  }
  await test('Missing create permission metadata defaults to hidden with no options request', async () => {
    const f = await fixture(); vm.runInContext('delete currentAuthenticatedUser.permissions', f.context); f.menu.updateActions(); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), true);
    f.requests.length = 0; await f.nodes.get('topbar-create-req-btn').dispatch('click'); await f.settle(); assert.equal(f.requests.length, 0);
  });
  await test('Malformed permission metadata defaults to deny instead of treating a string as an array', async () => {
    const f = await fixture();
    for (const permissions of ['requisition.create', {}, null]) {
      f.context.shellPermissionFixture = permissions; vm.runInContext('currentAuthenticatedUser.permissions = shellPermissionFixture', f.context);
      f.menu.updateActions(); assert.equal(f.menu.canCreate(), false); assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), true);
    }
  });
  await test('Drawer overlay layers sit above normal action menus and below existing modal dialogs', () => {
    assert.match(mobileCss, /\.app-sidebar\s*\{[^}]*z-index: 95/); assert.match(mobileCss, /\.sidebar-backdrop\s*\{[^}]*z-index: 94/);
    assert.match(css, /\.modal-overlay\s*\{[^}]*z-index: 100/); assert.match(css, /\.users-action-menu\s*\{[^}]*z-index: 90/);
    assert.match(mobileCss, /\.app-content-wrapper\s*\{[^}]*margin-left: 0;[^}]*width: 100%/); assert.match(mobileCss, /\.mobile-navigation-open #topbar-create-req-btn\s*\{\s*visibility: hidden/);
  });
  for (const width of [320, 360, 375, 390, 412, 430]) {
    await test(width + 'px mobile lifecycle + fluid CSS geometry contract (not browser measurement)', async () => {
      const f = await fixture({ width }); await f.open(); assert.equal(f.drawer.classList.contains('show-mobile'), true); await f.backdrop.dispatch('click'); f.closed();
      assert.match(mobileCss, /width: min\(82vw, 300px\)/); assert.match(mobileCss, /width: min\(260px, calc\(100vw - 16px\)\)/);
      const drawerWidth = Math.min(width * .82, 300), titleBudget = width - 16 - 44 - 44 - 8 - 8;
      assert.ok(drawerWidth < width); assert.ok(titleBudget >= 200); assert.ok(52 + 16 < width); assert.deepEqual(f.errors, []);
    });
  }
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await test(width + 'x' + height + ' desktop keeps the existing sidebar/breadcrumb/name/create presentation', async () => {
      const f = await fixture({ width, height }); await f.open(); f.closed(); assert.equal(f.drawer.inert, false);
      assert.match(css, /\.app-sidebar\s*\{[^}]*width: var\(--sidebar-width\)/); assert.match(css, /\.app-content-wrapper\s*\{[^}]*margin-left: var\(--sidebar-width\)/);
      assert.equal(f.nodes.get('topbar-user-name').textContent, users.hr.user.fullName); assert.equal(f.nodes.get('breadcrumb-current-view').textContent, 'Tổng quan Tuyển dụng');
      assert.equal(f.nodes.get('topbar-create-req-btn').classList.contains('hidden'), false); assert.match(html, /<span>Tạo yêu cầu<\/span>/);
      await f.nodes.get('nav-item-requisitions').dispatch('click'); await f.settle(); assert.equal(f.window.location.pathname, '/requisitions'); assert.deepEqual(f.errors, []);
    });
  }
  await test('Dashboard login-history widget remains absent and backend/API implementation is untouched', () => {
    const dashboard = fs.readFileSync(path.join(root, 'frontend/pages/dashboard.html'), 'utf8');
    assert.doesNotMatch(dashboard, /dashboard-activity|Lịch sử đăng nhập|Nhật ký Hoạt động/);
    assert.ok(manifest.scripts.includes('/js/components/mobile-navigation.js')); assert.doesNotMatch(fs.readFileSync(path.join(root, 'frontend/js/components/mobile-navigation.js'), 'utf8'), /fetch\(|SMTP|OAuth|startTime|onboarding/);
  });
  console.log('MOBILE_SHELL_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed })); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
