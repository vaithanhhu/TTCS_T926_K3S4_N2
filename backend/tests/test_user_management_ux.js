const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db', 'backend/data/ats_test.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run user UX tests in a fresh isolated TEMP copy without .git, .env or runtime databases.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
const { startServer, server } = require('../src/server');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
let passed = 0, failed = 0, base;
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
const success = password => reply(201, { success: true, data: { temporaryPassword: password } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
  // Execute the real modular bootstrap, page listeners, shared toast and API helpers.
  // Only API responses and browser DOM/clipboard facilities are faked.
  const runtime = await createFrontendRuntime(base);
  const element = runtime.document.createElement.bind(runtime.document);
  function attach(node) {
    node.appendChild = function (child) { child.parentNode = this; this.children.push(child); return child; };
    node.remove = function () {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    };
    return node;
  }
  runtime.document.createElement = tag => attach(element(tag));
  const toasts = attach(runtime.nodes.get('toast-container'));
  // Retained dialog nodes mirror the new HTML component, rather than a corner toast.
  const result = runtime.nodes.get('create-user-result-modal');
  result.children = ['create-user-result-title', 'create-user-result-message', 'create-user-result-credential', 'create-user-result-close'].map(id => runtime.nodes.get(id));
  runtime.nodes.get('create-user-result-title').textContent = '✓ Tạo tài khoản thành công';
  runtime.nodes.get('create-user-result-credential').textContent = 'Mật khẩu tạm';
  runtime.nodes.get('create-user-result-credential').children = ['create-user-result-password', 'create-user-result-copy', 'create-user-result-copy-status'].map(id => runtime.nodes.get(id));
  const durations = new Map(), timer = runtime.context.setTimeout;
  runtime.context.setTimeout = (fn, duration) => { const id = timer(fn); durations.set(id, duration); return id; };
  const calls = [], catalogCalls = [], refreshState = [], clipboard = [];
  const model = {
    departments: () => reply(200, { success: true, departments: [{ id: 'dept-engineering', name: 'Engineering', status: 'ACTIVE' }], tree: [] }),
    jobTitles: () => reply(200, { success: true, jobTitles: [{ id: 'title-specialist', name: 'Specialist', status: 'ACTIVE' }] }),
    departmentUpdate: () => reply(200, { success: true }),
    departmentDelete: () => reply(200, { success: true }),
    departmentDeactivate: () => reply(200, { success: true }),
    permissions: () => reply(200, { permissions: ['user.update', 'role.assign', 'account.lock', 'account.unlock', 'user.create'] }),
    unlock: () => reply(200, { success: true }),
    remove: () => reply(200, { success: true }),
    resetPassword: () => success('Reset@Fixture-88'),
    create: () => success('Fixture@Secret-42'),
    roles: () => reply(200, { success: true }),
    users: () => reply(200, { success: true, data: { items: [] } })
  };
  runtime.context.navigator.clipboard.writeText = async value => { clipboard.push(value); };
  runtime.context.fetch = async (url, options = {}) => {
    const target = new URL(url, base);
    assert.equal(target.origin, base, 'External request forbidden');
    const method = options.method || 'GET';
    const call = { path: target.pathname, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (target.pathname === '/api/v1/departments' && method === 'GET') { catalogCalls.push(call); return model.departments(call); }
    if (target.pathname === '/api/v1/job-titles' && method === 'GET') { catalogCalls.push(call); return model.jobTitles(call); }
    if (/^\/api\/v1\/departments\/[^/]+\/deactivate$/.test(target.pathname)) return model.departmentDeactivate(call);
    if (/^\/api\/v1\/departments\/[^/]+$/.test(target.pathname) && method === 'PUT') return model.departmentUpdate(call);
    if (/^\/api\/v1\/departments\/[^/]+$/.test(target.pathname) && method === 'DELETE') return model.departmentDelete(call);
    if (target.pathname === '/api/v1/auth/permissions') return model.permissions(call);
    if (/^\/api\/v1\/admin\/users\/[^/]+\/unlock$/.test(target.pathname) && method === 'POST') return model.unlock(call);
    if (/^\/api\/v1\/admin\/users\/[^/]+\/reset-password$/.test(target.pathname) && method === 'POST') return model.resetPassword(call);
    if (/^\/api\/v1\/admin\/users\/[^/]+$/.test(target.pathname) && method === 'DELETE') return model.remove(call);
    if (target.pathname === '/api/v1/admin/users' && method === 'POST') return model.create(call);
    if (/^\/api\/v1\/admin\/users\/[^/]+\/roles$/.test(target.pathname) && method === 'PUT') return model.roles(call);
    if (target.pathname === '/api/v1/admin/users' && method === 'GET') {
      refreshState.push({ closed: runtime.nodes.get('create-user-modal').classList.contains('hidden'), name: runtime.nodes.get('create-user-fullname').value, toasts: toasts.children.length });
      return model.users(call);
    }
    throw new Error('Unexpected request in user UX fixture: ' + method + ' ' + target.pathname);
  };
  const html = fs.readFileSync(path.join(root, 'frontend/components/create-user-modal.html'), 'utf8');
  const defaults = [...html.matchAll(/<(input|select)\b[^>]*id="(create-user-[^"]+)"[^>]*>([\s\S]*?)(?=<\/select>|<|$)/g)];
  const fields = defaults.map(match => match[2]);
  // Model native form.reset(): input defaults are empty, select's first option is INTERVIEWER.
  runtime.nodes.get('create-user-form').reset = () => {
    fields.forEach(id => { runtime.nodes.get(id).value = id === 'create-user-role' ? 'INTERVIEWER' : ''; });
  };
  const queryAll = runtime.document.querySelectorAll.bind(runtime.document);
  runtime.document.querySelectorAll = selector => {
    if (selector === 'input[name="assign-roles"]:checked') {
      return [...runtime.nodes.get('assign-roles-checkbox-container').innerHTML.matchAll(/<input\b[^>]*value="([^"]+)"[^>]*\bchecked\b[^>]*>/g)].map(match => ({ value: match[1] }));
    }
    return queryAll(selector);
  };
  runtime.storage.set('ats_token', 'isolated-ui-token');
  vm.runInContext("currentAuthenticatedUser = {id:'admin-fixture',roles:['ADMIN']}; currentAllowedPaths = new Set(['/admin/users', '/admin/roles']); window.ATS_ROUTER.navigate('/admin/users');", runtime.context);
  await runtime.settle();
  calls.length = 0; refreshState.length = 0;
  async function open() {
    await runtime.nodes.get('open-create-user-modal-btn').dispatch('click');
    // Keep catalog setup reads separate, retaining all mutation and list-refresh calls.
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i].method === 'GET' && ['/api/v1/job-titles', '/api/v1/departments'].includes(calls[i].path)) calls.splice(i, 1);
    }
    for (const [id, value] of Object.entries({ fullname: ' Test User ', email: ' test@example.invalid ', jobtitle: 'title-specialist', department: 'dept-engineering', phone: ' 0123456789 ', role: 'INTERVIEWER' })) {
      runtime.nodes.get('create-user-' + id).value = value;
    }
  }
  function openRoles(roles = ['INTERVIEWER', 'RECRUITER']) {
    runtime.context.fixtureRoles = roles;
    vm.runInContext("openAssignRolesModal({id:'target-user',fullName:'Test User',email:'test@example.invalid',roles:fixtureRoles});", runtime.context);
  }
  return { ...runtime, model, calls, catalogCalls, refreshState, clipboard, durations, toasts, fields, open, openRoles,
    submit: () => runtime.nodes.get('create-user-form').dispatch('submit'),
    submitRoles: () => runtime.nodes.get('assign-roles-form').dispatch('submit') };
}
function credential(f) { const dialog = f.nodes.get('create-user-result-modal'); return dialog.classList.contains('hidden') ? undefined : dialog; }
function successes(f) { return [...f.toasts.children.filter(node => node.className === 'toast-item toast-success'), ...(credential(f) ? [credential(f)] : [])]; }
function text(node) { return node.textContent + node.innerHTML + node.children.map(text).join(''); }
function assertClosed(f) { assert.equal(f.nodes.get('create-user-modal').classList.contains('hidden'), true); }

const menuUsers = [
  { id: 'user-a', fullName: "Nguyễn Văn A <Admin> O'Neil", email: 'a@example.invalid', roles: ['INTERVIEWER'], status: 'ACTIVE', jobTitle: 'Specialist', department: 'IT' },
  { id: 'user-b', fullName: 'Nguyễn Văn B', email: 'b@example.invalid', roles: ['RECRUITER'], status: 'LOCKED', jobTitle: 'Recruiter', department: 'HR' }
];
const rowPermissions = ['user.update', 'role.assign', 'account.lock', 'account.unlock', 'user.create'];
async function menuFixture(permissions = rowPermissions) {
  const f = await fixture();
  f.model.users = () => reply(200, { success: true, data: { items: menuUsers } });
  f.model.permissions = () => reply(200, { permissions });
  const body = f.nodes.get('users-table-body'), menu = f.nodes.get('users-action-menu');
  async function reload() {
    await vm.runInContext('loadUsers()', f.context);
    // Model browser parsing of the actual rendered row buttons, not action logic.
    body.children = [];
    const triggers = new Map();
    for (const match of body.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const button = f.document.createElement('button');
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attr[1], attr[2]);
      button.disabled = /\bdisabled\b/.test(match[1]);
      body.appendChild(button);
      triggers.set(button.getAttribute('data-user-id'), button);
    }
    f.triggers = triggers;
  }
  await reload(); f.calls.length = 0;
  f.openMenu = async id => { await body.dispatch('click', { target: f.triggers.get(id) }); };
  f.items = () => menu.querySelectorAll('[role="menuitem"]');
  f.choose = async code => {
    const item = f.items().find(item => item.getAttribute('data-user-action') === code);
    assert.ok(item, 'Visible menu action ' + code);
    await menu.dispatch('click', { target: item }); await f.settle();
  };
  f.menu = menu; f.reload = reload;
  return f;
}

async function departmentMenuFixture(permissions = ['department.read', 'department.manage']) {
  const f = await fixture(), createElement = f.document.createElement.bind(f.document);
  // Native div.textContent serialization used by escapeDepartmentHtml.
  f.document.createElement = tag => {
    const node = createElement(tag);
    if (tag === 'div') {
      let assigned = null;
      Object.defineProperty(node, 'innerHTML', {
        get: () => assigned ?? String(node.textContent).replace(/[&<>]/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[value])),
        set: value => { assigned = value; }
      });
    }
    return node;
  };
  const child = { id: 'dept-b', code: 'DEV', name: 'Phòng Công nghệ', parentId: 'dept-a', status: 'ACTIVE', manager: { id: 'manager-b', fullName: 'Manager B' }, children: [] };
  const rootDepartment = { id: 'dept-a', code: 'ROOT', name: 'Phòng A <Company>', parentId: null, status: 'ACTIVE', manager: { id: 'manager-a', fullName: 'Manager A' }, children: [child] };
  const inactive = { id: 'dept-c', code: 'OLD', name: 'Phòng C', parentId: null, status: 'INACTIVE', manager: { id: 'manager-c', fullName: 'Manager C' }, children: [] };
  const departments = [rootDepartment, child, inactive], tree = [rootDepartment, inactive];
  f.model.departments = () => reply(200, { success: true, departments, tree, total: 3 });
  f.model.permissions = () => reply(200, { permissions });
  f.model.users = () => reply(200, { success: true, data: { items: departments.map(department => ({ id: department.manager.id, fullName: department.manager.fullName })) } });
  vm.runInContext("currentAllowedPaths.add('/admin/departments'); window.ATS_ROUTER.navigate('/admin/departments');", f.context);
  await f.settle();
  const container = f.nodes.get('departments-tree-container'), menu = f.nodes.get('users-action-menu');
  function parseTriggers() {
    container.children = [];
    const triggers = new Map();
    for (const match of container.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const button = f.document.createElement('button');
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) button.setAttribute(attr[1], attr[2]);
      button.disabled = /\bdisabled\b/.test(match[1]); container.appendChild(button);
      triggers.set(button.getAttribute('data-department-id'), button);
    }
    f.departmentTriggers = triggers;
  }
  parseTriggers(); f.calls.length = 0;
  f.openDepartmentMenu = id => container.dispatch('click', { target: f.departmentTriggers.get(id) });
  f.departmentItems = () => menu.querySelectorAll('[role="menuitem"]');
  f.chooseDepartment = async code => {
    const item = f.departmentItems().find(item => item.getAttribute('data-department-action') === code);
    assert.ok(item, 'Visible department action ' + code); await menu.dispatch('click', { target: item }); await f.settle();
  };
  f.reloadDepartments = async () => { await vm.runInContext('loadDepartments()', f.context); parseTriggers(); };
  f.rerenderDepartments = () => { vm.runInContext('renderDepartmentTree()', f.context); parseTriggers(); };
  return Object.assign(f, { tree, departments, container, menu });
}

async function main() {
  await startServer(0);
  base = 'http://127.0.0.1:' + server.address().port;
  await test('Create success: one real API helper request preserves every payload field', async () => {
    const f = await fixture(); await f.open(); await f.submit();
    const calls = f.calls.filter(call => call.method === 'POST'); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { fullName: 'Test User', email: 'test@example.invalid', jobTitle: 'Specialist', department: 'Engineering', phone: '0123456789', initialRole: 'INTERVIEWER', departmentName: 'Engineering', phoneNumber: '0123456789', roleCode: 'INTERVIEWER' });
  });
  await test('Create success: modal closes, native form resets and Save is hidden by overlay', async () => {
    const f = await fixture(); await f.open(); await f.submit(); assertClosed(f);
    for (const id of f.fields) assert.equal(f.nodes.get(id).value, id === 'create-user-role' ? 'INTERVIEWER' : '');
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, false); assert.equal(f.nodes.get('create-user-alert').classList.contains('hidden'), true);
  });
  await test('Create success: close/reset precede refresh, feedback follows refresh', async () => {
    const f = await fixture(); await f.open(); const pending = deferred(); f.model.users = () => pending.promise;
    const submit = f.submit(); await f.settle();
    assert.deepEqual(f.refreshState, [{ closed: true, name: '', toasts: 0 }]); assert.equal(f.toasts.children.length, 0);
    pending.resolve(reply(200, { success: true, data: { items: [] } })); await submit; assert.equal(successes(f).length, 1);
  });
  await test('Create success: centered dialog contains backend password, never a corner toast', async () => {
    const f = await fixture(); await f.open(); await f.submit();
    assert.equal(successes(f).length, 1); assert.match(text(credential(f)), /Tạo tài khoản thành công/); assert.match(text(credential(f)), /Mật khẩu tạm[\s\S]*Fixture@Secret-42/); assert.equal(f.toasts.children.length, 0);
    assert.equal(f.nodes.has('created-temp-pwd-display'), false); assert.equal([...f.storage.values()].some(value => String(value).includes('Fixture@Secret-42')), false);
    assert.equal(f.window.location.pathname, '/admin/users'); assert.equal(f.window.location.search, ''); assert.deepEqual(f.errors, []);
  });
  await test('Credential dialog supports copy without dismissing or duplicate feedback', async () => {
    const f = await fixture(); await f.open(); await f.submit(); const toast = credential(f);
    await f.nodes.get('create-user-result-copy').dispatch('click'); assert.deepEqual(f.clipboard, ['Fixture@Secret-42']); assert.equal(successes(f).length, 1); assert.equal(f.nodes.get('create-user-result-copy-status').textContent, 'Đã sao chép mật khẩu.');
  });
  await test('Clipboard failure preserves credential and offers manual copy', async () => {
    const f = await fixture(); await f.open(); await f.submit(); f.context.navigator.clipboard.writeText = async () => { throw new Error('Unavailable'); };
    const dialog = credential(f); await f.nodes.get('create-user-result-copy').dispatch('click'); assert.match(f.nodes.get('create-user-result-copy-status').textContent, /Hãy chọn/); assert.match(text(dialog), /Fixture@Secret-42/); assert.deepEqual(f.errors, []);
  });
  await test('Credential uses safe text nodes, never HTML interpolation', async () => {
    const f = await fixture(); await f.open(); const value = '<img src=x onerror=alert(1)>&"'; f.model.create = () => success(value); await f.submit();
    const body = f.nodes.get('create-user-result-password'); assert.equal(body.textContent, value); assert.equal(body.innerHTML, '');
  });
  await test('Explicit close immediately erases credential and prevents copying hidden data', async () => {
    const f = await fixture(); await f.open(); await f.submit(); const body = f.nodes.get('create-user-result-password'), copy = f.nodes.get('create-user-result-copy');
    await f.nodes.get('create-user-result-close').dispatch('click'); assert.equal(body.textContent, ''); assert.equal(credential(f), undefined); await copy.dispatch('click'); assert.deepEqual(f.clipboard, []);
    assert.equal(copy.disabled, true); assert.equal(f.document.activeElement, f.nodes.get('open-create-user-modal-btn'));
  });
  await test('Credential dialog has no auto-close, stays open until user explicitly closes', async () => {
    const f = await fixture(); await f.open(); const timersBefore = f.timeouts.size; await f.submit(); assert.equal(f.timeouts.size, timersBefore);
    assert.ok(credential(f)); assert.equal(f.nodes.get('create-user-result-password').textContent, 'Fixture@Secret-42'); await f.nodes.get('create-user-result-modal').dispatch('click'); assert.ok(credential(f));
  });
  await test('Navigation erases credential instead of retaining hidden sensitive DOM', async () => {
    const f = await fixture(); await f.open(); await f.submit(); const body = f.nodes.get('create-user-result-password'); vm.runInContext('leaveActivePage()', f.context);
    assert.equal(body.textContent, ''); assert.equal(credential(f), undefined); assert.equal(f.toasts.children.length, 0);
  });
  await test('Missing temporaryPassword never fabricates a fallback password', async () => {
    const f = await fixture(); await f.open(); f.model.create = () => reply(201, { success: true, data: {} }); await f.submit(); assertClosed(f);
    assert.equal(successes(f).length, 1); assert.match(text(successes(f)[0]), /Backend không trả về/); assert.doesNotMatch(text(successes(f)[0]), /Ats@Temp1234/);
  });
  await test('Create API rejection keeps modal and input, preserves error, enables retry', async () => {
    const f = await fixture(); await f.open(); f.model.create = () => reply(409, { success: false, message: 'Email đã tồn tại.' }); await f.submit();
    assert.equal(f.nodes.get('create-user-modal').classList.contains('hidden'), false); assert.equal(f.nodes.get('create-user-fullname').value, ' Test User '); assert.equal(f.nodes.get('create-user-alert-msg').textContent, 'Email đã tồn tại.');
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, false); assert.equal(successes(f).length, 0); assert.equal(f.calls.filter(call => call.method === 'GET').length, 0);
    f.model.create = () => success('Retry@Secret-42'); await f.submit(); assertClosed(f); assert.match(text(credential(f)), /Retry@Secret-42/);
  });
  await test('Create transport failure keeps modal, no success, submit re-enabled', async () => {
    const f = await fixture(); await f.open(); f.model.create = () => { throw new Error('Network unavailable'); }; await f.submit();
    assert.equal(f.nodes.get('create-user-modal').classList.contains('hidden'), false); assert.equal(f.nodes.get('create-user-alert').classList.contains('hidden'), false); assert.equal(successes(f).length, 0); assert.equal(f.nodes.get('create-user-submit-btn').disabled, false);
  });
  await test('Create double-submit sends one POST while button disabled', async () => {
    const f = await fixture(); await f.open(); const pending = deferred(); f.model.create = () => pending.promise;
    const submit = f.submit(); assert.equal(f.nodes.get('create-user-submit-btn').disabled, true); await f.submit(); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    pending.resolve(success('One@Secret-42')); await submit; assertClosed(f); assert.equal(successes(f).length, 1);
  });
  await test('Refresh rejection is separate: account success and credential remain visible', async () => {
    const f = await fixture(); await f.open(); f.model.users = () => reply(500, { success: false }); await f.submit(); assertClosed(f);
    assert.equal(successes(f).length, 1); assert.match(text(credential(f)), /Fixture@Secret-42/); assert.equal(f.toasts.children.filter(node => node.className === 'toast-item toast-warning').length, 1); assert.equal(f.nodes.get('create-user-alert').classList.contains('hidden'), true);
  });
  await test('Refresh transport failure does not turn create success into failure', async () => {
    const f = await fixture(); await f.open(); f.model.users = () => { throw new Error('Refresh unavailable'); }; await f.submit(); assertClosed(f); assert.equal(successes(f).length, 1); assert.equal(f.nodes.get('create-user-alert').classList.contains('hidden'), true);
  });
  await test('Reopen starts clean, removes previous credential, retains one listener', async () => {
    const f = await fixture(); await f.open(); await f.submit(); const body = f.nodes.get('create-user-result-password');
    await f.nodes.get('open-create-user-modal-btn').dispatch('click'); assert.equal(f.nodes.get('create-user-fullname').value, ''); assert.equal(body.textContent, ''); assert.equal(f.toasts.children.length, 0);
    await f.nodes.get('close-create-user-modal').dispatch('click'); await f.open(); await f.submit(); assert.equal(f.calls.filter(call => call.method === 'POST').length, 2); assert.equal(f.nodes.get('create-user-form').listeners.get('submit').length, 1);
  });
  await test('Late create response after logout never displays credential to a new session', async () => {
    const f = await fixture(); await f.open(); const pending = deferred(); f.model.create = () => pending.promise; const submit = f.submit();
    f.storage.delete('ats_token'); vm.runInContext("currentAuthenticatedUser=null; window.ATS_ROUTER.navigate('/login');", f.context); pending.resolve(success('Late@Secret-42')); await submit;
    assert.equal(f.toasts.children.length, 0); assert.equal(credential(f), undefined); assert.equal(f.calls.filter(call => call.method === 'GET').length, 0); assert.equal(f.nodes.get('create-user-submit-btn').disabled, false);
  });
  await test('Navigation during create never displays credential on another page', async () => {
    const f = await fixture(); await f.open(); const pending = deferred(); f.model.create = () => pending.promise; const submit = f.submit(); f.window.location.pathname = '/admin/roles'; vm.runInContext('leaveActivePage()', f.context);
    pending.resolve(success('Late@Secret-42')); await submit; assert.equal(f.toasts.children.length, 0); assert.equal(credential(f), undefined); assert.equal(f.nodes.get('create-user-submit-btn').disabled, false);
  });
  await test('Permission update uses existing PUT contract, exact roles and one success toast', async () => {
    const f = await fixture(); f.openRoles(); await f.submitRoles();
    const calls = f.calls.filter(call => call.method === 'PUT'); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/v1/admin/users/target-user/roles'); assert.deepEqual(calls[0].body, { roles: ['RECRUITER', 'INTERVIEWER'] });
    assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), true); assert.equal(successes(f).length, 1); assert.match(text(successes(f)[0]), /Cập nhật phân quyền thành công\./); assert.equal(f.nodes.get('assign-roles-submit-btn').disabled, false);
  });
  await test('Permission feedback waits for refresh and is emitted once', async () => {
    const f = await fixture(); f.openRoles(); const pending = deferred(); f.model.users = () => pending.promise; const submit = f.submitRoles(); await f.settle();
    assert.equal(f.toasts.children.length, 0); assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), true); pending.resolve(reply(200, { success: true, data: { items: [] } })); await submit; assert.equal(successes(f).length, 1);
  });
  await test('Permission 403 preserves error and modal, never emits success, enables retry', async () => {
    const f = await fixture(); f.openRoles(); f.model.roles = () => reply(403, { success: false, message: 'Không đủ quyền.' }); await f.submitRoles();
    assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), false); assert.equal(f.nodes.get('assign-roles-alert-msg').textContent, 'Không đủ quyền.'); assert.equal(successes(f).length, 0); assert.equal(f.nodes.get('assign-roles-submit-btn').disabled, false); assert.equal(f.calls.filter(call => call.method === 'GET').length, 0);
    f.model.roles = () => reply(200, { success: true }); await f.submitRoles(); assert.equal(successes(f).length, 1);
  });
  await test('Permission transport failure preserves error behavior and enables retry', async () => {
    const f = await fixture(); f.openRoles(); f.model.roles = () => { throw new Error('Network unavailable'); }; await f.submitRoles();
    assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), false); assert.equal(f.nodes.get('assign-roles-alert').classList.contains('hidden'), false); assert.equal(successes(f).length, 0); assert.equal(f.nodes.get('assign-roles-submit-btn').disabled, false);
  });
  await test('Permission double-submit sends one request and one success', async () => {
    const f = await fixture(); f.openRoles(); const pending = deferred(); f.model.roles = () => pending.promise; const submit = f.submitRoles();
    assert.equal(f.nodes.get('assign-roles-submit-btn').disabled, true); await f.submitRoles(); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); pending.resolve(reply(200, { success: true })); await submit; assert.equal(successes(f).length, 1);
  });
  await test('No selected role keeps validation, emits neither request nor success', async () => {
    const f = await fixture(); f.openRoles([]); await f.submitRoles(); assert.equal(f.calls.length, 0); assert.equal(successes(f).length, 0); assert.match(f.nodes.get('assign-roles-alert-msg').textContent, /ít nhất 1 vai trò/);
  });
  await test('Permission refresh failure preserves successful mutation feedback', async () => {
    const f = await fixture(); f.openRoles(); f.model.users = () => reply(500, { success: false }); await f.submitRoles(); assert.equal(successes(f).length, 1); assert.equal(f.toasts.children.filter(node => node.className === 'toast-item toast-warning').length, 1);
  });
  await test('Repeated role dialog open/close keeps one submit handler', async () => {
    const f = await fixture(); for (let i = 0; i < 3; i++) { f.openRoles(); await f.nodes.get('cancel-assign-roles-btn').dispatch('click'); } f.openRoles(); await f.submitRoles();
    assert.equal(f.nodes.get('assign-roles-form').listeners.get('submit').length, 1); assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(successes(f).length, 1);
  });
  await test('Result dialog has modal accessibility and contains keyboard focus', async () => {
    const f = await fixture(); await f.open(); await f.submit(); const modal = f.nodes.get('create-user-result-modal');
    assert.equal(modal.getAttribute('role'), 'dialog'); assert.equal(modal.getAttribute('aria-modal'), 'true');
    assert.equal(f.document.activeElement, f.nodes.get('create-user-result-copy'));
    f.nodes.get('create-user-result-close').focus(); await modal.dispatch('keydown', { key: 'Tab' }); assert.equal(f.document.activeElement, f.nodes.get('create-user-result-password'));
    await modal.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(f.document.activeElement, f.nodes.get('create-user-result-close'));
    await modal.dispatch('keydown', { key: 'Escape' }); assert.equal(credential(f), undefined); assert.equal(f.nodes.get('create-user-result-password').textContent, '');
  });
  await test('Login keeps original form IDs, password visibility and forgot-password route', async () => {
    const f = await fixture(); vm.runInContext("currentAuthenticatedUser=null; sessionStorage.removeItem('ats_token'); window.ATS_ROUTER.navigate('/login');", f.context);
    await f.nodes.get('toggle-pwd-btn').dispatch('click'); assert.equal(f.nodes.get('password').getAttribute('type'), 'text');
    await f.nodes.get('toggle-pwd-btn').dispatch('click'); assert.equal(f.nodes.get('password').getAttribute('type'), 'password');
    await f.nodes.get('open-forgot-pwd-btn').dispatch('click'); assert.equal(f.window.location.pathname, '/forgot-password'); assert.equal(f.nodes.get('login-form').listeners.get('submit').length, 1);
  });
  await test('Login uses configured local company hero/logo and safe introduction text', async () => {
    const f = await fixture(); f.context.branding = { heroImageUrl: '/public/company/hero-example.png', logoUrl: '/public/company/logo-example.png', introduction: '<script>plain text</script>' };
    vm.runInContext("renderCareerPagePublicContent(document.getElementById('public-career-page-content'), branding);", f.context);
    const background = f.nodes.get('login-background'), logo = f.nodes.get('login-company-logo'); assert.equal(background.src, '/public/company/hero-example.png'); assert.equal(logo.src, '/public/company/logo-example.png');
    background.onload(); logo.onload(); assert.equal(background.classList.contains('hidden'), false); assert.equal(logo.classList.contains('hidden'), false); assert.equal(f.nodes.get('login-logo-fallback').classList.contains('hidden'), true);
    assert.equal(f.nodes.get('public-career-page-content').textContent, '<script>plain text</script>'); assert.equal(f.nodes.get('public-career-page-content').innerHTML, '');
  });
  await test('Missing or failing company media falls back without random external images', async () => {
    const f = await fixture(); f.context.branding = { heroImageUrl: 'https://example.invalid/random.png', logoUrl: 'javascript:alert(1)' };
    vm.runInContext('renderLoginBranding(branding)', f.context); assert.equal(f.nodes.get('login-background').src, undefined); assert.equal(f.nodes.get('login-company-logo').src, undefined);
    f.context.branding = { heroImageUrl: '/public/company/hero-example.png', logoUrl: '/public/company/logo-example.png' }; vm.runInContext('renderLoginBranding(branding)', f.context);
    f.nodes.get('login-background').onerror(); f.nodes.get('login-company-logo').onerror(); assert.equal(f.nodes.get('login-background').classList.contains('hidden'), true); assert.equal(f.nodes.get('login-logo-fallback').classList.contains('hidden'), false); assert.deepEqual(f.errors, []);
  });
  await test('Login CSS defines cover, glass, underline controls and a mobile breakpoint', async () => {
    const css = fs.readFileSync(path.join(root, 'frontend/css/style.css'), 'utf8'), html = fs.readFileSync(path.join(root, 'frontend/pages/login.html'), 'utf8');
    assert.match(css, /#login-view\s*\{[^}]*grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\)/); assert.match(css, /object-fit: cover/); assert.match(css, /-webkit-backdrop-filter: blur\(8px\)/);
    assert.match(css, /\.login-glass-form \{ width: 80%; max-width: 440px; margin: 0; \}/);
    assert.match(css, /#login-view \.login-container::before\s*\{[^}]*background: rgba\(10, 18, 28, \.32\);[^}]*mask-image: linear-gradient\(to right, transparent, #000 12%\)/);
    assert.match(css, /#login-view \.form-input\s*\{[^}]*background: transparent;[^}]*border-bottom:/); assert.match(css, /@media \(max-width: 720px\)/);
    assert.match(css, /\.create-user-result-card \{ max-width: 540px; \}/); assert.doesNotMatch(html, /class="login-card"/); assert.match(html, /HỆ THỐNG TUYỂN DỤNG/);
  });
  await test('User rows render one accessible menu trigger, no old action buttons or embedded JSON', async () => {
    const f = await menuFixture(), html = f.nodes.get('users-table-body').innerHTML;
    assert.equal(f.triggers.size, 2);
    for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) assert.equal([...row[1].matchAll(/<button\b/g)].length, 1);
    assert.doesNotMatch(html, /btn-edit-user|btn-assign-roles|btn-lock-user|btn-delete-user|data-user='/);
    assert.match(html, /&lt;Admin&gt; O&#39;Neil/);
    for (const trigger of f.triggers.values()) {
      assert.equal(trigger.getAttribute('aria-label'), 'Thao tác'); assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
      assert.equal(trigger.getAttribute('aria-expanded'), 'false'); assert.equal(trigger.getAttribute('title'), 'Thao tác');
    }
  });
  await test('Opening A selects A; switching to B closes A and shows unlock instead of lock', async () => {
    const f = await menuFixture(); await f.openMenu('user-a');
    assert.equal(f.triggers.get('user-a').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(f.items().map(item => item.getAttribute('data-user-action')), ['edit', 'roles', 'reset', 'lock', 'delete']);
    await f.openMenu('user-b');
    assert.equal(f.triggers.get('user-a').getAttribute('aria-expanded'), 'false');
    assert.equal(f.triggers.get('user-b').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(f.items().map(item => item.getAttribute('data-user-action')), ['edit', 'roles', 'reset', 'unlock', 'delete']);
    await f.choose('edit'); assert.equal(f.nodes.get('edit-user-id').value, 'user-b');
  });
  await test('Clicking the same trigger again closes its menu', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); await f.openMenu('user-a');
    assert.equal(f.menu.classList.contains('hidden'), true); assert.equal(f.items().length, 0);
    assert.equal(f.document.activeElement, f.triggers.get('user-a'));
  });
  await test('Inside click keeps menu open, outside click closes without stealing focus', async () => {
    const f = await menuFixture(); await f.openMenu('user-a');
    await f.document.dispatch('click', { target: f.menu }); assert.equal(f.menu.classList.contains('hidden'), false);
    const outside = f.nodes.get('users-search-input'); outside.focus();
    await f.document.dispatch('click', { target: outside }); assert.equal(f.menu.classList.contains('hidden'), true);
    assert.equal(f.document.activeElement, outside);
  });
  await test('Escape closes and restores focus to the correct trigger', async () => {
    const f = await menuFixture(); await f.openMenu('user-b'); let prevented = false;
    await f.document.dispatch('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.menu.classList.contains('hidden'), true);
    assert.equal(f.document.activeElement, f.triggers.get('user-b'));
  });
  await test('Native button activation opens menu; arrow/Home/End/Tab retain keyboard navigation', async () => {
    const f = await menuFixture(); await f.openMenu('user-a');
    assert.equal(f.document.activeElement, f.items()[0]);
    await f.menu.dispatch('keydown', { key: 'ArrowDown' }); assert.equal(f.document.activeElement, f.items()[1]);
    await f.menu.dispatch('keydown', { key: 'End' }); assert.equal(f.document.activeElement, f.items().at(-1));
    await f.menu.dispatch('keydown', { key: 'Home' }); assert.equal(f.document.activeElement, f.items()[0]);
    await f.menu.dispatch('keydown', { key: 'ArrowUp' }); assert.equal(f.document.activeElement, f.items().at(-1));
    await f.menu.dispatch('keydown', { key: 'Tab' }); assert.equal(f.menu.classList.contains('hidden'), true);
  });
  await test('Edit closes menu and opens original form with A exact ID/name/email', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); await f.choose('edit');
    assert.equal(f.menu.classList.contains('hidden'), true);
    assert.equal(f.nodes.get('edit-user-modal').classList.contains('hidden'), false);
    assert.equal(f.nodes.get('edit-user-id').value, menuUsers[0].id);
    assert.equal(f.nodes.get('edit-user-fullname').value, menuUsers[0].fullName);
    assert.equal(f.nodes.get('edit-user-email').value, menuUsers[0].email);
    assert.equal(f.calls.length, 0);
  });
  await test('Permission action targets A and retains one successful PUT and notification', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); await f.choose('roles');
    assert.equal(f.nodes.get('assign-roles-user-id').value, 'user-a'); await f.submitRoles();
    const requests = f.calls.filter(call => call.method === 'PUT');
    assert.equal(requests.length, 1); assert.equal(requests[0].path, '/api/v1/admin/users/user-a/roles');
    assert.deepEqual(requests[0].body, { roles: ['INTERVIEWER'] });
    assert.equal(f.toasts.children.filter(item => item.className === 'toast-item toast-success').length, 1);
    assert.match(text(f.toasts.children[0]), /Cập nhật phân quyền thành công/);
  });
  await test('Lock opens original reason/confirmation/handover flow for A without an immediate mutation', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); await f.choose('lock');
    assert.equal(f.menu.classList.contains('hidden'), true);
    assert.equal(f.nodes.get('lock-user-modal').classList.contains('hidden'), false);
    assert.equal(f.nodes.get('lock-user-id').value, 'user-a');
    assert.equal(f.nodes.get('lock-user-email').textContent, menuUsers[0].email);
    assert.equal(f.calls.length, 0);
  });
  await test('Unlock retains confirmation and mutates exactly locked user B', async () => {
    const f = await menuFixture(); const confirmations = [];
    f.context.confirm = message => { confirmations.push(message); return true; };
    await f.openMenu('user-b'); await f.choose('unlock');
    assert.equal(confirmations.length, 1); assert.match(confirmations[0], /Nguyễn Văn B/);
    assert.deepEqual(f.calls.filter(call => call.method === 'POST').map(call => call.path), ['/api/v1/admin/users/user-b/unlock']);
    assert.equal(f.menu.classList.contains('hidden'), true);
  });
  await test('Cancelled unlock and delete do not send requests', async () => {
    const f = await menuFixture(); f.context.confirm = () => false;
    await f.openMenu('user-b'); await f.choose('unlock'); await f.openMenu('user-a'); await f.choose('delete');
    assert.equal(f.calls.length, 0);
  });
  await test('Reset keeps confirmation and shows only backend credential in existing dialog', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); await f.choose('reset');
    assert.equal(f.nodes.get('admin-reset-user-id').value, 'user-a');
    assert.equal(f.nodes.get('admin-reset-user-email').textContent, menuUsers[0].email);
    assert.equal(f.calls.length, 0);
    await f.nodes.get('confirm-admin-reset-pwd-btn').dispatch('click');
    assert.deepEqual(f.calls.filter(call => call.method === 'POST').map(call => call.path), ['/api/v1/admin/users/user-a/reset-password']);
    assert.equal(f.nodes.get('admin-reset-new-pwd-display').textContent, 'Reset@Fixture-88');
    assert.equal(f.nodes.get('admin-reset-result-box').classList.contains('hidden'), false);
    assert.equal([...f.storage.values()].some(value => String(value).includes('Reset@Fixture-88')), false);
    assert.equal(f.window.location.search, ''); assert.doesNotMatch(f.toasts.children.map(text).join(''), /Reset@Fixture-88/);
    await f.nodes.get('admin-reset-copy-pwd-btn').dispatch('click'); await f.settle();
    assert.deepEqual(f.clipboard, ['Reset@Fixture-88']); assert.deepEqual(f.errors, []);
  });
  await test('Delete retains irreversible-action confirmation and exact selected ID', async () => {
    const f = await menuFixture(); const confirmations = [];
    f.context.confirm = message => { confirmations.push(message); return true; };
    // Dashboard reload is independently verified by routing tests.
    vm.runInContext('loadDashboardData = () => {};', f.context);
    await f.openMenu('user-a'); await f.choose('delete');
    assert.match(confirmations[0], /không thể hoàn tác/);
    assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(call => call.path), ['/api/v1/admin/users/user-a']);
  });
  for (const [permission, activeActions, lockedActions] of [
    ['user.update', ['edit'], ['edit']], ['role.assign', ['roles'], ['roles']],
    ['account.lock', ['lock'], []], ['account.unlock', [], ['unlock']],
    ['user.create', ['reset', 'delete'], ['reset', 'delete']]
  ]) {
    await test('Action visibility follows backend permission ' + permission, async () => {
      const f = await menuFixture([permission]); await f.openMenu('user-a');
      assert.deepEqual(f.items().map(item => item.getAttribute('data-user-action')), activeActions);
      await f.openMenu('user-b');
      assert.deepEqual(f.items().map(item => item.getAttribute('data-user-action')), lockedActions);
    });
  }
  await test('Read-only user or permission API failure defaults to no actionable menu', async () => {
    const f = await menuFixture(['user.read']); await f.openMenu('user-a');
    assert.equal(f.triggers.get('user-a').disabled, true); assert.equal(f.menu.classList.contains('hidden'), true);
    f.model.permissions = () => reply(403, { success: false }); await f.reload(); await f.openMenu('user-b');
    assert.equal(f.items().length, 0); assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  });
  await test('Repeated refresh binds one delegated handler and sends only one role update', async () => {
    const f = await menuFixture(), events = [...f.documentEvents].map(([type, handlers]) => [type, handlers.length]);
    await f.openMenu('user-a'); await f.reload(); assert.equal(f.menu.classList.contains('hidden'), true);
    await f.reload(); await f.reload(); assert.equal(f.nodes.get('users-table-body').listeners.get('click').length, 1);
    assert.equal(f.menu.listeners.get('click').length, 1);
    assert.deepEqual([...f.documentEvents].map(([type, handlers]) => [type, handlers.length]), events);
    await f.openMenu('user-b'); await f.choose('roles'); await f.submitRoles();
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
  });
  await test('Double-clicking a detached action cannot invoke it twice or double-submit roles', async () => {
    const f = await menuFixture(); await f.openMenu('user-a'); const item = f.items().find(item => item.getAttribute('data-user-action') === 'roles');
    await f.menu.dispatch('click', { target: item }); await f.menu.dispatch('click', { target: item });
    const pending = deferred(); f.model.roles = () => pending.promise;
    const first = f.submitRoles(); await f.submitRoles();
    assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1);
    pending.resolve(reply(200, { success: true })); await first;
  });
  await test('Menu flips upward at viewport bottom and stays inside horizontal edges', async () => {
    const f = await menuFixture(); f.window.innerWidth = 320; f.window.innerHeight = 480;
    f.triggers.get('user-a').getBoundingClientRect = () => ({ top: 428, bottom: 464, left: 275, right: 311, width: 36, height: 36 });
    await f.openMenu('user-a');
    assert.ok(parseFloat(f.menu.style.top) < 428);
    assert.ok(parseFloat(f.menu.style.left) >= 8);
    assert.ok(parseFloat(f.menu.style.left) + 220 <= 312);
    assert.ok(parseFloat(f.menu.style.maxHeight) <= 414);
    const css = fs.readFileSync(path.join(root, 'frontend/css/style.css'), 'utf8');
    assert.match(css, /\.users-action-menu\s*\{[^}]*position: fixed;[^}]*z-index: 90;[^}]*max-width: calc\(100vw - 16px\);[^}]*overflow-y: auto;/);
    assert.ok(f.document.body.children.includes(f.menu));
  });
  await test('Navigation and scroll close menu; stale session cannot invoke an action', async () => {
    const f = await menuFixture(); await f.openMenu('user-a');
    await f.document.dispatch('scroll', { target: f.nodes.get('users-table-container') }); assert.equal(f.menu.classList.contains('hidden'), true);
    await f.openMenu('user-a'); vm.runInContext("window.ATS_ROUTER.navigate('/admin/roles');", f.context);
    assert.equal(f.menu.classList.contains('hidden'), true); await f.settle();
    vm.runInContext("currentActiveView = 'users';", f.context); await f.openMenu('user-a');
    f.storage.set('ats_token', 'different-session'); await f.choose('edit');
    assert.equal(f.nodes.get('edit-user-modal').classList.contains('hidden'), true);
  });
  await test('Department list/chart renders exactly one accessible trigger per actual node', async () => {
    const f = await departmentMenuFixture();
    assert.deepEqual([...f.departmentTriggers.keys()], ['dept-a', 'dept-b', 'dept-c']);
    assert.equal([...f.container.innerHTML.matchAll(/<button\b/g)].length, 3);
    assert.doesNotMatch(f.container.innerHTML, /data-department-action=/);
    assert.match(f.container.innerHTML, /Phòng A &lt;Company&gt;/);
    for (const button of f.departmentTriggers.values()) {
      assert.equal(button.getAttribute('aria-label'), 'Thao tác');
      assert.equal(button.getAttribute('aria-haspopup'), 'menu');
      assert.equal(button.getAttribute('aria-expanded'), 'false');
    }
  });
  await test('Organization node menus contain all existing actions, preserving ACTIVE/INACTIVE rule', async () => {
    const f = await departmentMenuFixture(); await f.openDepartmentMenu('dept-a');
    assert.deepEqual(f.departmentItems().map(item => item.getAttribute('data-department-action')), ['edit', 'deactivate', 'delete']);
    await f.openDepartmentMenu('dept-c');
    assert.deepEqual(f.departmentItems().map(item => item.getAttribute('data-department-action')), ['edit', 'delete']);
    assert.equal(f.departmentTriggers.get('dept-a').getAttribute('aria-expanded'), 'false');
  });
  await test('Organization A/B menu dispatch opens correct existing editor and preserves parent/manager', async () => {
    const f = await departmentMenuFixture(); await f.openDepartmentMenu('dept-a'); await f.chooseDepartment('edit');
    assert.equal(f.nodes.get('department-id-input').value, 'dept-a');
    assert.equal(f.nodes.get('department-parent-select').value, '');
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('edit');
    assert.equal(f.nodes.get('department-id-input').value, 'dept-b');
    assert.equal(f.nodes.get('department-name-input').value, 'Phòng Công nghệ');
    assert.equal(f.nodes.get('department-parent-select').value, 'dept-a');
    assert.equal(f.nodes.get('department-manager-select').value, 'manager-b');
    assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  });
  await test('Department edit from menu submits existing contract exactly once for selected child', async () => {
    const f = await departmentMenuFixture(); await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('edit');
    f.nodes.get('department-name-input').value = 'Updated name';
    await f.nodes.get('department-form').dispatch('submit');
    const requests = f.calls.filter(call => call.method === 'PUT');
    assert.equal(requests.length, 1); assert.equal(requests[0].path, '/api/v1/departments/dept-b');
    assert.deepEqual(requests[0].body, { code: 'DEV', name: 'Updated name', parentId: 'dept-a', managerId: 'manager-b' });
  });
  await test('Department deletion preserves confirmation and selects B instead of root/last node', async () => {
    const f = await departmentMenuFixture(), confirmations = [];
    f.window.confirm = message => { confirmations.push(message); return true; };
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('delete');
    assert.deepEqual(confirmations, ['Bạn có chắc muốn xóa phòng ban này?']);
    assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(call => call.path), ['/api/v1/departments/dept-b']);
    assert.equal(f.menu.classList.contains('hidden'), true);
  });
  await test('Department deactivation preserves confirmation and exact PATCH target A', async () => {
    const f = await departmentMenuFixture(), confirmations = [];
    f.window.confirm = message => { confirmations.push(message); return true; };
    await f.openDepartmentMenu('dept-a'); await f.chooseDepartment('deactivate');
    assert.deepEqual(confirmations, ['Ngừng áp dụng phòng ban này?']);
    assert.deepEqual(f.calls.filter(call => call.method === 'PATCH').map(call => call.path), ['/api/v1/departments/dept-a/deactivate']);
  });
  await test('Department delete failure preserves existing optional deactivation fallback', async () => {
    const f = await departmentMenuFixture(), confirmations = [];
    f.model.departmentDelete = () => reply(409, { success: false, code: 'DEPARTMENT_HAS_OPEN_REQUISITIONS', canDeactivate: true, message: 'Has open requisitions' });
    f.window.confirm = message => { confirmations.push(message); return true; };
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('delete');
    assert.equal(confirmations.length, 2); assert.match(confirmations[1], /ngừng áp dụng/);
    assert.deepEqual(f.calls.filter(call => ['DELETE', 'PATCH'].includes(call.method)).map(call => [call.method, call.path]),
      [['DELETE', '/api/v1/departments/dept-b'], ['PATCH', '/api/v1/departments/dept-b/deactivate']]);
  });
  await test('Cancelling department delete/deactivate preserves hierarchy and sends no mutation', async () => {
    const f = await departmentMenuFixture(), before = JSON.stringify(f.tree); f.window.confirm = () => false;
    await f.openDepartmentMenu('dept-a'); await f.chooseDepartment('delete');
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('deactivate');
    assert.equal(f.calls.length, 0); assert.equal(JSON.stringify(f.tree), before);
  });
  await test('Read-only department viewer sees no manage actions; permission failure defaults to deny', async () => {
    const f = await departmentMenuFixture(['department.read']); await f.openDepartmentMenu('dept-a');
    assert.equal(f.departmentTriggers.get('dept-a').disabled, true);
    assert.equal(f.departmentItems().length, 0);
    f.model.permissions = () => reply(403, { success: false }); await f.reloadDepartments(); await f.openDepartmentMenu('dept-b');
    assert.equal(f.departmentItems().length, 0); assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  });
  await test('Shared menu replaces node A with B, toggles closed, outside closes, Escape restores focus', async () => {
    const f = await departmentMenuFixture(); await f.openDepartmentMenu('dept-a'); await f.openDepartmentMenu('dept-b');
    assert.equal(f.departmentTriggers.get('dept-a').getAttribute('aria-expanded'), 'false');
    assert.equal(f.departmentTriggers.get('dept-b').getAttribute('aria-expanded'), 'true');
    await f.openDepartmentMenu('dept-b'); assert.equal(f.menu.classList.contains('hidden'), true);
    await f.openDepartmentMenu('dept-a'); await f.document.dispatch('click', { target: f.nodes.get('department-name-input') });
    assert.equal(f.menu.classList.contains('hidden'), true);
    await f.openDepartmentMenu('dept-b'); await f.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(f.menu.classList.contains('hidden'), true); assert.equal(f.document.activeElement, f.departmentTriggers.get('dept-b'));
  });
  await test('Shared menu guarantees one overlay across Users and Department owners', async () => {
    const f = await menuFixture(); await f.openMenu('user-a');
    const oldTrigger = f.triggers.get('user-a'), departmentTrigger = f.document.createElement('button');
    f.context.departmentTrigger = departmentTrigger;
    vm.runInContext("window.ATS_ACTION_MENU.toggle({owner:'departments',trigger:departmentTrigger,label:'Thao tác phòng ban',items:[{code:'edit',label:'Sửa',icon:'✎'}],valid:()=>true,onSelect:()=>{}});", f.context);
    assert.equal(oldTrigger.getAttribute('aria-expanded'), 'false');
    assert.equal(departmentTrigger.getAttribute('aria-expanded'), 'true');
    assert.equal(f.document.body.children.filter(node => node.id === 'users-action-menu').length, 1);
    vm.runInContext("window.ATS_ACTION_MENU.close(false, 'users');", f.context);
    assert.equal(f.menu.classList.contains('hidden'), false); // A background Users refresh cannot close a Department menu.
  });
  await test('Opening organization menus never changes hierarchy, indentation or node layout HTML', async () => {
    const f = await departmentMenuFixture(), before = JSON.stringify(f.tree), html = f.container.innerHTML;
    await f.openDepartmentMenu('dept-a'); await f.openDepartmentMenu('dept-b');
    assert.equal(f.container.innerHTML, html); assert.equal(JSON.stringify(f.tree), before);
    assert.match(html, /margin-left: 22px/);
    assert.ok(f.document.body.children.includes(f.menu));
  });
  await test('Repeated department rerender/reload has one handler and one delete request', async () => {
    const f = await departmentMenuFixture(), counts = [...f.documentEvents].map(([type, handlers]) => [type, handlers.length]);
    f.rerenderDepartments(); f.rerenderDepartments(); await f.reloadDepartments();
    assert.equal(f.container.listeners.get('click').length, 1);
    assert.equal(f.menu.listeners.get('click').length, 1);
    assert.deepEqual([...f.documentEvents].map(([type, handlers]) => [type, handlers.length]), counts);
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('delete');
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
  });
  await test('Department pending action cannot double-send even if another click tries to reopen', async () => {
    const f = await departmentMenuFixture(), pending = deferred();
    f.model.departmentDelete = () => pending.promise; await f.openDepartmentMenu('dept-b');
    const item = f.departmentItems().find(item => item.getAttribute('data-department-action') === 'delete');
    const first = f.menu.dispatch('click', { target: item });
    await f.menu.dispatch('click', { target: item }); await f.openDepartmentMenu('dept-b');
    const repeated = f.departmentItems().find(item => item.getAttribute('data-department-action') === 'delete');
    await f.menu.dispatch('click', { target: repeated });
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
    pending.resolve(reply(200, { success: true })); await first;
  });
  await test('Department node overlay stays within mobile edges and flips above bottom node', async () => {
    const f = await departmentMenuFixture(); f.window.innerWidth = 360; f.window.innerHeight = 480;
    f.departmentTriggers.get('dept-b').getBoundingClientRect = () => ({ left: 315, right: 351, top: 428, bottom: 464, width: 36, height: 36 });
    await f.openDepartmentMenu('dept-b');
    assert.ok(parseFloat(f.menu.style.top) < 428); assert.ok(parseFloat(f.menu.style.left) >= 8);
    assert.ok(parseFloat(f.menu.style.left) + 220 <= 352);
    const css = fs.readFileSync(path.join(root, 'frontend/css/style.css'), 'utf8');
    assert.match(css, /\.action-menu-trigger\s*\{[^}]*flex: 0 0 36px/);
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.department-workspace \{ grid-template-columns: minmax\(0, 1fr\)/);
  });
  await test('Department API failure retains existing feedback without success or repeated mutation', async () => {
    const f = await departmentMenuFixture();
    f.model.departmentDelete = () => reply(409, { success: false, message: 'Department is referenced' });
    await f.openDepartmentMenu('dept-b'); await f.chooseDepartment('delete');
    assert.match(f.toasts.children.map(text).join(''), /Department is referenced/);
    assert.equal(f.toasts.children.some(node => node.className === 'toast-item toast-success'), false);
    assert.equal(f.calls.filter(call => call.method === 'DELETE').length, 1);
  });
  await test('Shared route leave closes department overlay and rejects a stale session action', async () => {
    const f = await departmentMenuFixture(); await f.openDepartmentMenu('dept-b');
    f.storage.set('ats_token', 'new-session'); await f.chooseDepartment('delete');
    assert.equal(f.calls.some(call => call.method !== 'GET'), false);
    f.storage.set('ats_token', 'isolated-ui-token'); await f.openDepartmentMenu('dept-a');
    vm.runInContext("window.ATS_ROUTER.navigate('/admin/users');", f.context);
    assert.equal(f.menu.classList.contains('hidden'), true);
  });
  await test('Create catalog fields are selects with existing labels and no free-text inputs', async () => {
    const html = fs.readFileSync(path.join(root, 'frontend/components/create-user-modal.html'), 'utf8');
    for (const id of ['jobtitle', 'department']) {
      assert.match(html, new RegExp('<select[^>]*id="create-user-' + id + '"'));
      assert.doesNotMatch(html, new RegExp('<input[^>]*id="create-user-' + id + '"'));
    }
  });
  await test('Opening create form loads both existing catalogs once and preserves name payload', async () => {
    const f = await fixture(); await f.open(); await f.submit();
    for (const path of ['/api/v1/job-titles', '/api/v1/departments']) assert.equal(f.catalogCalls.filter(call => call.path === path).length, 1);
    const body = f.calls.find(call => call.method === 'POST').body;
    assert.equal(body.jobTitle, 'Specialist'); assert.equal(body.departmentName, 'Engineering');
    assert.equal(f.nodes.get('create-user-jobtitle').children[1].value, 'title-specialist');
    assert.equal(f.nodes.get('create-user-department').children[1].value, 'dept-engineering');
  });
  await test('Create catalogs are refreshed on reopen without duplicate options or submit handlers', async () => {
    const f = await fixture(); await f.open(); await f.nodes.get('close-create-user-modal').dispatch('click');
    f.model.jobTitles = () => reply(200, { success: true, jobTitles: [{ id: 'title-new', name: 'New title', status: 'ACTIVE' }] });
    await f.open(); f.nodes.get('create-user-jobtitle').value = 'title-new'; await f.submit();
    assert.equal(f.nodes.get('create-user-jobtitle').children.length, 2);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal(f.calls.find(call => call.method === 'POST').body.jobTitle, 'New title');
  });
  await test('Only active catalog entries are offered; labels use safe text nodes', async () => {
    const f = await fixture();
    const label = '<script>Not markup</script>';
    f.model.jobTitles = () => reply(200, { success: true, jobTitles: [{ id: 'active', name: label, status: 'ACTIVE' }, { id: 'inactive', name: 'Old', status: 'INACTIVE' }] });
    f.model.departments = () => reply(200, { success: true, departments: [{ id: 'd-active', name: label, status: 'ACTIVE' }, { id: 'd-inactive', name: 'Old', status: 'INACTIVE' }] });
    await f.open();
    for (const id of ['jobtitle', 'department']) {
      const select = f.nodes.get('create-user-' + id); assert.equal(select.children.length, 2);
      assert.equal(select.children[1].textContent, label); assert.equal(select.children[1].innerHTML, '');
    }
  });
  await test('Arbitrary job title values are rejected without a create request', async () => {
    const f = await fixture(); await f.open(); f.nodes.get('create-user-jobtitle').value = 'Typed title'; await f.submit();
    assert.equal(f.calls.some(call => call.method === 'POST'), false); assert.match(f.nodes.get('create-user-alert-msg').textContent, /từ danh mục/);
  });
  await test('Arbitrary department values are rejected without a create request', async () => {
    const f = await fixture(); await f.open(); f.nodes.get('create-user-department').value = 'Typed department'; await f.submit();
    assert.equal(f.calls.some(call => call.method === 'POST'), false); assert.match(f.nodes.get('create-user-alert-msg').textContent, /từ danh mục/);
  });
  await test('Empty optional selections preserve the existing create-user contract', async () => {
    const f = await fixture(); await f.open(); f.nodes.get('create-user-jobtitle').value = ''; f.nodes.get('create-user-department').value = ''; await f.submit();
    const body = f.calls.find(call => call.method === 'POST').body; assert.equal(body.jobTitle, ''); assert.equal(body.departmentName, ''); assertClosed(f);
  });
  await test('Empty catalogs never fall back to free text', async () => {
    const f = await fixture();
    f.model.jobTitles = () => reply(200, { success: true, jobTitles: [] }); f.model.departments = () => reply(200, { success: true, departments: [] });
    await f.nodes.get('open-create-user-modal-btn').dispatch('click');
    for (const id of ['jobtitle', 'department']) { const select = f.nodes.get('create-user-' + id); assert.equal(select.children.length, 1); assert.match(select.children[0].textContent, /Chưa có dữ liệu/); assert.equal(select.value, ''); }
  });
  await test('Catalog loading disables selection and Save and blocks early submission', async () => {
    const f = await fixture(); const pending = deferred(); f.model.jobTitles = () => pending.promise;
    const opened = f.nodes.get('open-create-user-modal-btn').dispatch('click'); await f.settle(); await f.submit();
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, true); assert.equal(f.nodes.get('create-user-jobtitle').disabled, true);
    assert.equal(f.calls.some(call => call.method === 'POST'), false);
    pending.resolve(reply(200, { success: true, jobTitles: [] })); await opened; assert.equal(f.nodes.get('create-user-submit-btn').disabled, false);
  });
  await test('Job-title permission denial blocks Save and preserves catalog error feedback', async () => {
    const f = await fixture(); f.model.jobTitles = () => reply(403, { success: false }); await f.open(); await f.submit();
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, true); assert.equal(f.calls.some(call => call.method === 'POST'), false);
    assert.match(f.nodes.get('create-user-alert-msg').textContent, /kiểm tra quyền/); assert.equal(successes(f).length, 0);
  });
  await test('Department API failure blocks Save and retry on reopen recovers', async () => {
    const f = await fixture(); const original = f.model.departments; f.model.departments = () => reply(500, { success: false }); await f.open(); await f.submit();
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, true); assert.equal(f.calls.some(call => call.method === 'POST'), false);
    await f.nodes.get('close-create-user-modal').dispatch('click'); f.model.departments = original; await f.open(); await f.submit(); assertClosed(f);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  });
  await test('Malformed catalog response fails safely without allowing account submission', async () => {
    const f = await fixture(); f.model.jobTitles = () => reply(200, { success: true, jobTitles: null }); await f.open(); await f.submit();
    assert.equal(f.calls.some(call => call.method === 'POST'), false); assert.equal(f.nodes.get('create-user-alert').classList.contains('hidden'), false);
  });
  await test('A catalog response received after modal close does not modify the form', async () => {
    const f = await fixture(); const pending = deferred(); f.model.jobTitles = () => pending.promise;
    const opened = f.nodes.get('open-create-user-modal-btn').dispatch('click'); await f.settle(); await f.nodes.get('close-create-user-modal').dispatch('click');
    pending.resolve(reply(200, { success: true, jobTitles: [{ id: 'late', name: 'Late', status: 'ACTIVE' }] })); await opened;
    assertClosed(f); assert.equal(f.nodes.get('create-user-jobtitle').children.length, 1); assert.equal(f.nodes.get('create-user-submit-btn').disabled, true);
  });
  await test('Late response from a previous opening cannot replace the current catalog', async () => {
    const f = await fixture(); const pending = deferred(); f.model.jobTitles = () => pending.promise;
    const first = f.nodes.get('open-create-user-modal-btn').dispatch('click'); await f.settle(); await f.nodes.get('close-create-user-modal').dispatch('click');
    f.model.jobTitles = () => reply(200, { success: true, jobTitles: [{ id: 'latest', name: 'Latest', status: 'ACTIVE' }] });
    await f.nodes.get('open-create-user-modal-btn').dispatch('click'); pending.resolve(reply(200, { success: true, jobTitles: [{ id: 'stale', name: 'Stale', status: 'ACTIVE' }] })); await first;
    assert.equal(f.nodes.get('create-user-jobtitle').children[1].value, 'latest');
  });
  await test('Changing session while catalogs load prevents applying the old-session response', async () => {
    const f = await fixture(); const pending = deferred(); f.model.jobTitles = () => pending.promise;
    const opened = f.nodes.get('open-create-user-modal-btn').dispatch('click'); await f.settle(); f.storage.set('ats_token', 'new-session');
    pending.resolve(reply(200, { success: true, jobTitles: [] })); await opened; await f.submit();
    assert.equal(f.nodes.get('create-user-submit-btn').disabled, true); assert.equal(f.calls.some(call => call.method === 'POST'), false);
  });
  console.log('USER_UX_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed }));
  process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
