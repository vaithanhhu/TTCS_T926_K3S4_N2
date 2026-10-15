const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm', 'backend/data/ats.db-wal', 'backend/data/ats_test.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run avatar tests in a fresh isolated TEMP copy without .git, .env or existing databases.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
const sharp = require('sharp');
const AvatarService = require('../src/services/avatarService');
const { startServer, server } = require('../src/server');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
let base, image, passed = 0, failed = 0;
const users = {};
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name, error); }
}
async function api(route, token, body, contentType) {
  const res = await fetch(base + '/api/v1' + route, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': contentType || 'application/json' } : {}) },
    ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {})
  });
  return { status: res.status, data: await res.json() };
}
async function fixture(user = users.admin, initial = '/profile') {
  const f = await createFrontendRuntime(base, initial, [['ats_token', user.token], ['ats_user', JSON.stringify(user.user)]]);
  const original = f.document.createElement.bind(f.document); f.images = []; f.sources = [];
  f.document.createElement = tag => {
    const node = original(tag);
    if (tag === 'img') {
      f.images.push(node); let src = '';
      Object.defineProperty(node, 'src', { get: () => src, set(value) { src = value; f.sources.push(value); } });
    }
    return node;
  };
  f.render = (user, fallback = 'Nguyễn Văn A', version = '') => {
    f.context.avatarFixtureUser = user; f.context.avatarFixtureName = fallback; f.context.avatarFixtureVersion = version;
    vm.runInContext("renderUserAvatar(document.getElementById('profile-card-avatar'), avatarFixtureUser, avatarFixtureName, avatarFixtureVersion)", f.context);
  };
  return f;
}
async function main() {
  await startServer(0); base = 'http://127.0.0.1:' + server.address().port;
  for (const [key, email] of Object.entries({ admin: 'admin@company.com', hr: 'hrmanager@company.com', hiring: 'hiringmgr@company.com', interviewer: 'interviewer@company.com' })) {
    const login = await api('/auth/login', null, { email, password: 'Ats@123456' }); assert.equal(login.status, 200); users[key] = login.data.data;
  }
  await test('Canonical metadata reports no files as null, without creating avatars', () => {
    const service = new AvatarService();
    assert.deepEqual(service.getAvatarUrls('usr-hiring-mgr'), { avatarUrl: null, thumbnailUrl: null });
    assert.deepEqual(service.getAvatarUrls('usr-interviewer'), { avatarUrl: null, thumbnailUrl: null });
    assert.equal(fs.existsSync(service.avatarDir), false);
  });
  await test('Unsafe user IDs cannot inspect or publish a filesystem path', () => {
    const service = new AvatarService(); for (const id of ['../usr-admin', '', null, '/etc/passwd']) assert.equal(service.getAvatarUrls(id), null);
  });
  await test('Login, me and profile include additive null metadata for missing avatars', async () => {
    for (const key of ['hiring', 'interviewer']) {
      const user = users[key]; assert.equal(user.user.avatarUrl, null); assert.equal(user.user.thumbnailUrl, null);
      const me = await api('/auth/me', user.token); const profile = await api('/profile', user.token);
      assert.equal(me.status, 200); assert.equal(profile.status, 200);
      for (const item of [me.data.data.user, profile.data.data]) {
        assert.equal(item.id, user.user.id); assert.equal(item.avatarUrl, null); assert.equal(item.thumbnailUrl, null);
        assert.ok(item.email); assert.ok(Array.isArray(item.roles));
      }
    }
  });
  await test('Missing metadata renders existing initial immediately without constructing any image', async () => {
    const f = await fixture(); f.render({ id: 'usr-new' });
    assert.equal(f.images.length, 0); assert.deepEqual(f.sources, []); assert.equal(f.nodes.get('profile-card-avatar').textContent, 'N');
  });
  for (const [key, id] of [['hiring', 'usr-hiring-mgr'], ['interviewer', 'usr-interviewer']]) {
    await test(id + ' renders fallback with no predicted thumbnail request', async () => {
      const f = await fixture(users[key]); await vm.runInContext('loadUserProfile()', f.context);
      assert.deepEqual(f.sources, []); assert.equal(f.images.length, 0);
      assert.equal(f.requests.some(req => req.path === '/public/avatars/avatar-' + id + '-thumb.png'), false);
      assert.equal(f.nodes.get('profile-card-avatar').textContent, users[key].user.fullName.charAt(0));
    });
  }
  await test('Null metadata and invalid/external URLs do not produce image requests', async () => {
    const f = await fixture();
    for (const value of [null, '', 123, 'https://external.example/avatar.png', '//external.example/avatar.png', '/public/avatars/../secret.png']) f.render({ id: 'usr-admin', thumbnailUrl: value });
    assert.deepEqual(f.sources, []); assert.equal(f.images.length, 0);
  });
  await test('Canonical thumbnail is preferred and rendered using its exact URL', async () => {
    const f = await fixture(); const url = '/public/avatars/avatar-usr-valid-thumb.png';
    f.render({ id: 'ignored-for-url', avatarUrl: '/public/avatars/avatar-usr-valid.png', thumbnailUrl: url });
    assert.deepEqual(f.sources, [url]); await f.images[0].dispatch('load');
    assert.equal(f.nodes.get('profile-card-avatar').children[0], f.images[0]); assert.equal(f.nodes.get('profile-card-avatar').textContent, '');
  });
  await test('A canonical full image is used when no thumbnail metadata exists', async () => {
    const f = await fixture(); const url = '/public/avatars/avatar-usr-valid.png'; f.render({ avatarUrl: url, thumbnailUrl: null }); assert.deepEqual(f.sources, [url]);
  });
  await test('Legitimate image/network failure retains the initial without inventing a second URL', async () => {
    const f = await fixture(); f.render({ thumbnailUrl: '/public/avatars/avatar-usr-valid-thumb.png' }); await f.images[0].dispatch('error');
    assert.equal(f.nodes.get('profile-card-avatar').textContent, 'N'); assert.equal(f.sources.length, 1);
  });
  await test('Late image events cannot overwrite a subsequent user/fallback render', async () => {
    const f = await fixture(); f.render({ thumbnailUrl: '/public/avatars/avatar-usr-valid-thumb.png' }); const old = f.images[0];
    f.render({ id: 'usr-hiring-mgr' }, 'Lê Hoàng Nam'); await old.dispatch('load'); await old.dispatch('error');
    assert.equal(f.nodes.get('profile-card-avatar').textContent, 'L'); assert.equal(f.nodes.get('profile-card-avatar').children.length, 0);
  });
  await test('Interviews API publishes only existing interviewer avatar metadata', async () => {
    const response = await api('/interviews', users.admin.token); assert.equal(response.status, 200);
    for (const interview of response.data.interviews) if (interview.interviewer) {
      assert.equal(interview.interviewer.avatarUrl, null); assert.equal(interview.interviewer.thumbnailUrl, null);
    }
  });
  await test('Interview row callback uses metadata and never constructs URLs from interviewer IDs', async () => {
    const f = await fixture(users.admin, '/interviews'); const body = f.nodes.get('interviews-table-body');
    const nodes = [f.document.createElement('div'), f.document.createElement('div')]; nodes.forEach((node, index) => { node.dataset.interviewIndex = String(index); });
    body.querySelectorAll = selector => selector === '.interview-interviewer-avatar' ? nodes : [];
    f.window.ATS_API.getInterviewsApi = async () => ({ ok: true, data: { success: true, interviews: [
      { id: 'test-a', scheduledTime: '2026-10-05T14:00:00Z', interviewer: { id: 'usr-hiring-mgr', fullName: 'Lê Hoàng Nam' } },
      { id: 'test-b', scheduledTime: '2026-10-05T14:00:00Z', interviewer: { id: 'usr-interviewer', fullName: 'Đặng Tuấn Anh' } }
    ] } });
    await vm.runInContext('loadInterviews()', f.context);
    assert.equal(nodes[0].textContent, 'L'); assert.equal(nodes[1].textContent, 'Đ'); assert.deepEqual(f.sources, []);
    f.window.ATS_API.getInterviewsApi = async () => ({ ok: true, data: { success: true, interviews: [
      { id: 'test-a', scheduledTime: '2026-10-05T14:00:00Z', interviewer: { id: 'usr-admin', fullName: 'Admin', thumbnailUrl: '/public/avatars/avatar-usr-admin-thumb.png' } }
    ] } });
    nodes.pop(); await vm.runInContext('loadInterviews()', f.context);
    assert.deepEqual(f.sources, ['/public/avatars/avatar-usr-admin-thumb.png']); assert.deepEqual(f.errors, []);
  });
  image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#123456' } }).png().toBuffer();
  await test('Real upload preserves full image/thumbnail generation and canonical response', async () => {
    for (const key of ['admin', 'hr']) {
      const response = await api('/profile/avatar', users[key].token, image, 'image/png'); assert.equal(response.status, 200);
      for (const [url, width] of [[response.data.data.avatarUrl, 512], [response.data.data.thumbnailUrl, 96]]) {
        assert.ok(url); const asset = await fetch(base + url); assert.equal(asset.status, 200);
        const meta = await sharp(Buffer.from(await asset.arrayBuffer())).metadata(); assert.equal(meta.width, width); assert.equal(meta.height, width);
      }
    }
  });
  await test('Existing uploaded Admin and HR avatars survive login, session restore and profile refresh', async () => {
    for (const [key, email] of [['admin', 'admin@company.com'], ['hr', 'hrmanager@company.com']]) {
      const login = await api('/auth/login', null, { email, password: 'Ats@123456' }); assert.equal(login.status, 200);
      const expected = '/public/avatars/avatar-' + login.data.data.user.id + '-thumb.png'; assert.equal(login.data.data.user.thumbnailUrl, expected);
      const me = await api('/auth/me', users[key].token), profile = await api('/profile', users[key].token);
      assert.equal(me.data.data.user.thumbnailUrl, expected); assert.equal(profile.data.data.thumbnailUrl, expected);
      const f = await fixture(users[key]); await vm.runInContext('loadUserProfile()', f.context);
      assert.equal(f.sources.length, 3); assert.ok(f.sources.every(src => src === expected));
    }
  });
  await test('Filesystem metadata does not advertise directories or missing partial thumbnails', () => {
    const service = new AvatarService(); fs.mkdirSync(path.join(service.avatarDir, 'avatar-usr-directory.png'));
    assert.deepEqual(service.getAvatarUrls('usr-directory'), { avatarUrl: null, thumbnailUrl: null });
    fs.writeFileSync(path.join(service.avatarDir, 'avatar-usr-partial.png'), image);
    assert.deepEqual(service.getAvatarUrls('usr-partial'), { avatarUrl: '/public/avatars/avatar-usr-partial.png', thumbnailUrl: null });
  });
  await test('Real UI upload updates all three avatars from response metadata, preserving cache busting', async () => {
    const f = await fixture(users.hiring); const input = f.nodes.get('profile-avatar-input');
    const file = new Blob([image], { type: 'image/png' }); input.files = [file];
    const fetchApi = f.context.fetch; let uploads = 0;
    f.context.fetch = async (url, options) => { if (new URL(url, base).pathname === '/api/v1/profile/avatar') uploads++; return fetchApi(url, options); };
    await input.dispatch('change'); await f.settle(); assert.equal(uploads, 1);
    assert.equal(f.sources.length, 3); assert.ok(f.sources.every(src => /^\/public\/avatars\/avatar-usr-hiring-mgr-thumb\.png\?v=\d+$/.test(src)));
    const stored = JSON.parse(f.storage.get('ats_user')); assert.equal(stored.thumbnailUrl, '/public/avatars/avatar-usr-hiring-mgr-thumb.png');
    assert.equal(f.nodes.get('profile-avatar-upload-btn').disabled, false); assert.deepEqual(f.errors, []);
    assert.equal((await api('/profile', users.hiring.token)).data.data.thumbnailUrl, stored.thumbnailUrl);
  });
  await test('Failed UI upload keeps current avatar and error feedback without new image requests', async () => {
    const f = await fixture(users.hiring); const input = f.nodes.get('profile-avatar-input'); input.files = [new Blob([image], { type: 'image/png' })];
    f.window.ATS_API.uploadAvatarApi = async () => ({ ok: false, data: { success: false, message: 'Upload rejected' } });
    await input.dispatch('change'); assert.deepEqual(f.sources, []); assert.equal(f.nodes.get('profile-avatar-upload-btn').disabled, false);
    assert.equal(JSON.parse(f.storage.get('ats_user')).thumbnailUrl, '/public/avatars/avatar-usr-hiring-mgr-thumb.png');
  });
  await test('Late upload cannot attach the previous user avatar to a new session', async () => {
    const f = await fixture(users.hiring); const pending = deferred(); f.window.ATS_API.uploadAvatarApi = () => pending.promise;
    f.nodes.get('profile-avatar-input').files = [new Blob([image], { type: 'image/png' })]; const upload = f.nodes.get('profile-avatar-input').dispatch('change'); await f.settle();
    f.storage.set('ats_token', 'new-session'); vm.runInContext("currentAuthenticatedUser = {id:'usr-new',fullName:'New user'}", f.context);
    pending.resolve({ ok: true, data: { success: true, data: { thumbnailUrl: '/public/avatars/avatar-usr-hiring-mgr-thumb.png' } } }); await upload;
    assert.deepEqual(f.sources, []); assert.equal(vm.runInContext('currentAuthenticatedUser.thumbnailUrl', f.context), undefined);
  });
  await test('Canonical profile metadata clears stale cached avatar instead of using a guessed fallback', async () => {
    const f = await fixture(users.admin);
    f.window.ATS_API.getProfileApi = async () => ({ ok: true, data: { success: true, data: { id: 'usr-admin', fullName: 'Admin', avatarUrl: null, thumbnailUrl: null } } });
    await vm.runInContext('loadUserProfile()', f.context); assert.deepEqual(f.sources, []);
    assert.equal(JSON.parse(f.storage.get('ats_user')).thumbnailUrl, null); assert.equal(f.nodes.get('profile-card-avatar').textContent, 'A');
  });
  await test('Profile/upload authorization remains session-based; unauthorized requests stay 401', async () => {
    assert.equal((await api('/profile')).status, 401); assert.equal((await api('/profile/avatar', null, image, 'image/png')).status, 401);
    assert.equal((await api('/profile', users.interviewer.token)).status, 200);
    assert.equal((await api('/profile/avatar', users.interviewer.token, image, 'image/png')).status, 200);
    assert.equal((await api('/admin/users', users.interviewer.token)).status, 403);
  });
  console.log('AVATAR_RESULT ' + JSON.stringify({ passed, failed, total: passed + failed })); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
