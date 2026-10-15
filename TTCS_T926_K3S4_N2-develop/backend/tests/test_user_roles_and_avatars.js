const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('USER_ROLES_AVATARS');

// Extend the existing lightweight DOM boundary with native checkbox state and
// row avatar placeholders. API, router, handlers, services and SQLite stay real.
function installControls(f) {
  const create = f.document.createElement.bind(f.document);
  const roles = f.nodes.get('assign-roles-checkbox-container');
  let roleMarkup = '';
  Object.defineProperty(roles, 'innerHTML', {
    get: () => roleMarkup,
    set(value) {
      roleMarkup = value; roles.children = [];
      for (const match of value.matchAll(/<input\b([^>]+)>/g)) {
        const input = create('input');
        for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) input.setAttribute(attr[1], attr[2]);
        input.value = input.getAttribute('value'); input.type = input.getAttribute('type');
        input.checked = /(?:^|\s)checked(?:\s|$)/.test(match[1]);
        input.click = async () => { input.checked = !input.checked; await input.dispatch('change'); };
        roles.appendChild(input);
      }
    }
  });
  const query = f.document.querySelectorAll.bind(f.document);
  f.document.querySelectorAll = selector => selector === 'input[name="assign-roles"]:checked'
    ? roles.children.filter(input => input.checked) : query(selector);
  const table = f.nodes.get('users-table-body');
  let tableMarkup = table.innerHTML;
  Object.defineProperty(table, 'innerHTML', {
    get: () => tableMarkup,
    set(value) {
      tableMarkup = value; table.children = [];
      for (const match of value.matchAll(/<div\b[^>]*data-user-avatar-id="([^"]+)"[^>]*>([^<]*)<\/div>/g)) {
        const avatar = create('div'); avatar.setAttribute('data-user-avatar-id', match[1]);
        avatar.textContent = match[2]; table.appendChild(avatar);
      }
    }
  });
  const images = [];
  f.document.createElement = tag => {
    const element = create(tag); if (tag === 'img') images.push(element); return element;
  };
  return {
    images,
    selected: () => roles.children.filter(input => input.checked).map(input => input.value).sort(),
    async select(values) {
      for (const input of roles.children) if (input.checked !== values.includes(input.value)) await input.click();
    },
    async open(userId) {
      const markup = [...tableMarkup.matchAll(/<button\b[^>]*data-user-id="([^"]+)"[^>]*>/g)].find(match => match[1] === userId);
      assert.ok(markup, 'Action trigger must come from rendered row');
      const trigger = create('button'); trigger.className = 'users-action-trigger'; trigger.setAttribute('data-user-id', userId);
      table.appendChild(trigger); await table.dispatch('click', { target: trigger });
      const menu = f.nodes.get('users-action-menu');
      const action = menu.children.find(item => item.getAttribute('data-user-action') === 'roles');
      assert.ok(action, 'Current permissions expose role assignment');
      await menu.dispatch('click', { target: action });
      assert.equal(f.nodes.get('assign-roles-user-id').value, userId);
      assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), false);
    },
    avatar: id => table.querySelectorAll('[data-user-avatar-id]').find(node => node.getAttribute('data-user-avatar-id') === id)
  };
}

async function main() {
  const app = await openApplication();
  try {
    let b = await app.login('admin@company.com');
    let a = await app.login('interviewer@company.com');
    const id = a.user.id, originalRole = ['INTERVIEWER'];
    const selected = ['RECRUITER', 'HIRING_MGR', 'INTERVIEWER'];
    const roleRoute = '/admin/users/' + id + '/roles';
    const persisted = async () => (await app.db.prepare('SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? ORDER BY r.code').all(id)).map(row => row.code);
    async function list() {
      const response = await app.api('GET', '/admin/users?search=' + encodeURIComponent(a.user.email), b.token);
      assert.equal(response.status, 200); return response.data.data.items.find(user => user.id === id);
    }
    let f = await createFrontendRuntime(app.base, '/admin/users', [['ats_token', b.token], ['ats_user', JSON.stringify(b.user)]]);
    let controls = installControls(f);
    f.nodes.get('users-search-input').value = a.user.email;
    async function reload() { await vm.runInContext('loadUsers()', f.context); await f.settle(); }
    await reload();
    const calls = [];
    const transport = f.context.fetch;
    f.context.fetch = async (url, options) => {
      if (new URL(url, app.base).pathname === '/api/v1' + roleRoute && options?.method === 'PUT') {
        calls.push(JSON.parse(options.body));
      }
      return transport(url, options);
    };
    await test('S1-09', 'multi-role UI/API', 'One role -> independent selection of three -> one PUT -> exact GET/SQL readback', async () => {
      await controls.open(id); assert.deepEqual(controls.selected(), originalRole);
      assert.equal(f.nodes.get('assign-roles-checkbox-container').children.length, 7);
      assert.ok(f.nodes.get('assign-roles-checkbox-container').children.every(input => input.type === 'checkbox'));
      await controls.select(selected); assert.deepEqual(controls.selected(), selected.toSorted());
      await f.nodes.get('assign-roles-form').dispatch('submit'); await f.settle();
      assert.deepEqual(calls, [{ roles: ['RECRUITER', 'HIRING_MGR', 'INTERVIEWER'] }]);
      const read = await app.api('GET', roleRoute, b.token); assert.equal(read.status, 200);
      assert.deepEqual(read.data.data.currentRoles.toSorted(), selected.toSorted());
      assert.deepEqual((await persisted()), selected.toSorted());
      assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), true);
    });
    await test('S1-09', 'reopen', 'Reopen through action menu checks all three persisted roles', async () => {
      await controls.open(id); assert.deepEqual(controls.selected(), selected.toSorted());
    });
    await test('S1-09', 'remove role', 'Unchecking one leaves exactly two roles after submit/readback', async () => {
      await controls.select(['RECRUITER', 'INTERVIEWER']);
      await f.nodes.get('assign-roles-form').dispatch('submit'); await f.settle();
      assert.deepEqual((await persisted()), ['INTERVIEWER', 'RECRUITER']);
      assert.deepEqual((await app.api('GET', roleRoute, b.token)).data.data.currentRoles.toSorted(), (await persisted()));
    });
    await test('S1-09', 'reload', 'Fresh frontend bootstrap and reopen retain persisted two-role state', async () => {
      const fresh = await createFrontendRuntime(app.base, '/admin/users', [['ats_token', b.token], ['ats_user', JSON.stringify(b.user)]]);
      const freshControls = installControls(fresh); fresh.nodes.get('users-search-input').value = a.user.email;
      await vm.runInContext('loadUsers()', fresh.context); await fresh.settle(); await freshControls.open(id);
      assert.deepEqual(freshControls.selected(), ['INTERVIEWER', 'RECRUITER']); assert.deepEqual(fresh.errors, []);
    });
    await test('S1-09', 'effective union', 'Next request on existing session sees exact database permission union for three roles', async () => {
      assert.equal((await app.api('PUT', roleRoute, b.token, { roles: selected })).status, 200);
      const expected = (await app.db.prepare('SELECT DISTINCT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id JOIN roles r ON r.id=rp.role_id WHERE r.code IN (?,?,?) ORDER BY p.code').all(...selected)).map(row => row.code);
      const read = await app.api('GET', '/auth/permissions', a.token); assert.equal(read.status, 200);
      assert.deepEqual(read.data.permissions.toSorted(), expected);
      assert.ok(expected.includes('requisition.create')); assert.ok(expected.includes('candidate.read'));
    });
    await test('S1-09', 'validation/security', 'Unknown/empty/unauthorized roles reject without changing mappings', async () => {
      const before = (await persisted());
      const bad = await app.api('PUT', roleRoute, b.token, { roles: ['INTERVIEWER', 'UNKNOWN_ROLE'] });
      assert.equal(bad.status, 400); assert.equal(bad.data.code, 'INVALID_ROLE_CODE'); assert.deepEqual((await persisted()), before);
      for (const roles of [[], [' ', null]]) {
        const empty = await app.api('PUT', roleRoute, b.token, { roles }); assert.equal(empty.status, 400);
        assert.equal(empty.data.code, 'EMPTY_ROLES'); assert.deepEqual((await persisted()), before);
      }
      const unprivileged = await app.login('hiringmgr@company.com');
      assert.equal((await app.api('PUT', roleRoute, unprivileged.token, { roles: ['ADMIN'] })).status, 403);
      assert.equal((await app.api('PUT', roleRoute, null, { roles: ['ADMIN'] })).status, 401);
      assert.deepEqual((await persisted()), before);
    });
    await test('S1-09', 'self Admin protection', 'Cannot revoke own ADMIN; persisted administrator survives', async () => {
      const response = await app.api('PUT', '/admin/users/' + b.user.id + '/roles', b.token, { roles: ['RECRUITER'] });
      assert.equal(response.status, 400); assert.equal(response.data.code, 'CANNOT_REVOKE_OWN_ADMIN_ROLE');
      assert.ok((await app.api('GET', '/admin/users/' + b.user.id + '/roles', b.token)).data.data.currentRoles.includes('ADMIN'));
    });
    await test('S1-09', 'atomic failure', 'Failure after first INSERT rolls back roles, permissions and keeps modal/retry', async () => {
      await app.api('PUT', roleRoute, b.token, { roles: originalRole }); await reload(); await controls.open(id);
      await controls.select(selected);
      const sessions = (await app.db.prepare('SELECT * FROM sessions WHERE user_id=? ORDER BY id').all(id));
      const failingRole = (await app.db.prepare('SELECT id FROM roles WHERE code=?').get('HIRING_MGR')).id;
      (await app.db.exec(`CREATE TEMP TRIGGER fail_role_insert BEFORE INSERT ON user_roles WHEN NEW.user_id='${id}' AND NEW.role_id='${failingRole}' BEGIN SELECT RAISE(ABORT,'isolated role insertion failure'); END`));
      try {
        await f.nodes.get('assign-roles-form').dispatch('submit'); await f.settle();
        assert.deepEqual((await persisted()), originalRole);
        assert.deepEqual((await app.db.prepare('SELECT * FROM sessions WHERE user_id=? ORDER BY id').all(id)), sessions);
        assert.equal(f.nodes.get('assign-roles-modal').classList.contains('hidden'), false);
        assert.equal(f.nodes.get('assign-roles-submit-btn').disabled, false);
        assert.equal(f.nodes.get('assign-roles-alert').classList.contains('hidden'), false);
        assert.equal(f.nodes.get('assign-roles-alert-msg').textContent, 'Lỗi máy chủ nội bộ khi gán vai trò.');
        (await app.db.exec('BEGIN')); (await app.db.exec('ROLLBACK'));
      } finally { (await app.db.exec('DROP TRIGGER fail_role_insert')); }
      await f.nodes.get('assign-roles-form').dispatch('submit'); await f.settle(); assert.deepEqual((await persisted()), selected.toSorted());
    });
    await test('S1-09', 'lifecycle', 'Repeated open and refresh bind one submit handler; double submit sends one PUT', async () => {
      await reload(); await controls.open(id); await f.nodes.get('cancel-assign-roles-btn').dispatch('click');
      await reload(); await controls.open(id);
      assert.equal(f.nodes.get('assign-roles-form').listeners.get('submit').length, 1);
      const before = calls.length;
      const pending = f.nodes.get('assign-roles-form').dispatch('submit');
      await f.nodes.get('assign-roles-form').dispatch('submit'); await pending; await f.settle();
      assert.equal(calls.length - before, 1);
    });

    await test('S2-03', 'no avatar', 'B sees A initials, null metadata and creates no guessed img request', async () => {
      const user = await list(); assert.equal(user.avatarUrl, null); assert.equal(user.thumbnailUrl, null); assert.equal(user.avatarVersion, null);
      const before = controls.images.length; await reload();
      assert.equal(controls.images.length, before); assert.equal(controls.avatar(id).textContent, 'Đ');
    });
    const imageA = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#223344' } }).png().toBuffer();
    const imageB = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#ff0000' } }).png().toBuffer();
    let uploadA, firstVersion, firstAsset;
    await test('S2-03', 'real upload', 'A uploads a real avatar with 512/96 image assets persisted', async () => {
      const response = await app.api('POST', '/profile/avatar', a.token, imageA, 'image/png');
      assert.equal(response.status, 200); uploadA = response.data.data;
      for (const [url, width] of [[uploadA.avatarUrl, 512], [uploadA.thumbnailUrl, 96]]) {
        const asset = await fetch(app.base + url); assert.equal(asset.status, 200);
        const bytes = Buffer.from(await asset.arrayBuffer()); assert.equal((await sharp(bytes).metadata()).width, width);
        if (width === 96) firstAsset = bytes;
      }
    });
    await test('S2-03', 'cross-account', 'A logout -> fresh B login -> protected Users-list publishes A metadata', async () => {
      assert.equal((await app.api('POST', '/auth/logout', a.token)).status, 200);
      assert.equal((await app.api('GET', '/profile', a.token)).status, 401);
      b = await app.login('admin@company.com');
      const user = await list(); assert.equal(user.avatarUrl, uploadA.avatarUrl); assert.equal(user.thumbnailUrl, uploadA.thumbnailUrl);
      assert.equal(typeof user.avatarVersion, 'number'); firstVersion = user.avatarVersion;
      assert.equal((await list()).avatarVersion, firstVersion, 'Version is stable without file changes');
      assert.equal((await app.api('GET', '/admin/users', null)).status, 401);
      const denied = await app.login('hiringmgr@company.com'); assert.equal((await app.api('GET', '/admin/users', denied.token)).status, 403);
    });
    await test('S2-03', 'row metadata', 'B row/avatar cannot replace A: real renderer prefers A thumbnail', async () => {
      assert.equal((await app.api('POST', '/profile/avatar', b.token, imageB, 'image/png')).status, 200);
      f = await createFrontendRuntime(app.base, '/admin/users', [['ats_token', b.token], ['ats_user', JSON.stringify(b.user)]]);
      controls = installControls(f); f.nodes.get('users-search-input').value = a.user.email; await reload();
      assert.equal(controls.images.length, 1);
      const avatar = controls.images[0]; assert.equal(avatar.src, uploadA.thumbnailUrl + '?v=' + firstVersion);
      assert.ok(!avatar.src.includes(b.user.id));
      const response = await fetch(app.base + avatar.src); assert.equal(response.status, 200);
      await avatar.dispatch('load'); assert.equal(controls.avatar(id).children[0], avatar);
      assert.deepEqual(f.errors, []);
    });
    function isolatedFile(url) {
      const file = path.resolve(app.root, 'frontend', '.' + url);
      assert.ok(file.startsWith(path.join(app.root, 'frontend', 'public', 'avatars') + path.sep)); return file;
    }
    await test('S2-03', 'full-only fallback', 'Missing thumbnail -> canonical full image without predicted second thumbnail', async () => {
      fs.unlinkSync(isolatedFile(uploadA.thumbnailUrl));
      const user = await list(); assert.equal(user.thumbnailUrl, null); assert.equal(user.avatarUrl, uploadA.avatarUrl);
      const before = controls.images.length; await reload(); assert.equal(controls.images.length - before, 1);
      assert.equal(new URL(controls.images.at(-1).src, app.base).pathname, uploadA.avatarUrl);
      const response = await fetch(app.base + controls.images.at(-1).src); assert.equal(response.status, 200);
    });
    await test('S2-03', 'missing files', 'Missing full + thumbnail -> null metadata and immediate initials without img', async () => {
      fs.unlinkSync(isolatedFile(uploadA.avatarUrl));
      const user = await list(); assert.equal(user.avatarUrl, null); assert.equal(user.thumbnailUrl, null); assert.equal(user.avatarVersion, null);
      const before = controls.images.length; await reload(); assert.equal(controls.images.length, before);
      assert.equal(controls.avatar(id).textContent, 'Đ');
    });
    await test('S2-03', 'updated image', 'A uploads different image -> B refetch/render uses new file version and actual bytes', async () => {
      a = await app.login('interviewer@company.com');
      assert.equal((await app.api('POST', '/profile/avatar', a.token, imageB, 'image/png')).status, 200);
      const user = await list(); assert.equal(user.thumbnailUrl, uploadA.thumbnailUrl); assert.notEqual(user.avatarVersion, firstVersion);
      const version = user.avatarVersion; assert.equal((await list()).avatarVersion, version);
      await reload(); const avatar = controls.images.at(-1); assert.equal(avatar.src, user.thumbnailUrl + '?v=' + version);
      const response = await fetch(app.base + avatar.src); assert.equal(response.status, 200);
      assert.notDeepEqual(Buffer.from(await response.arrayBuffer()), firstAsset);
      await avatar.dispatch('load'); assert.equal(controls.avatar(id).children[0], avatar); assert.deepEqual(f.errors, []);
    });
    await test('S2-03/S2-09', 'size isolation', 'Avatar remains 2 MB and Career Page remains 5 MB', async () => {
      const AvatarService = require('../src/services/avatarService'); const CareerPageService = require('../src/services/careerPageService');
      assert.equal(new AvatarService().maxFileSize, 2 * 1024 * 1024); assert.equal(new CareerPageService(app.db).maxFileSize, 5 * 1024 * 1024);
      const response = await app.api('POST', '/profile/avatar', a.token, Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png');
      assert.equal(response.status, 413); assert.equal(response.data.code, 'AVATAR_TOO_LARGE');
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
