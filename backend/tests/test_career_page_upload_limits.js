const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const sharp = require('sharp');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('CAREER_UPLOAD_LIMITS');
const MiB = 1024 * 1024;

// A real PNG with a valid ancillary text chunk and CRC, generated at runtime.
// No fake file.size, trailing garbage or binary fixtures in the repository.
function pngAtSize(png, size) {
  const payload = Buffer.alloc(size - png.length - 12, 0x20);
  Buffer.from('padding\0').copy(payload);
  const type = Buffer.from('tEXt');
  const crcInput = Buffer.concat([type, payload]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  // Insert immediately before the standard 12-byte IEND chunk.
  return Buffer.concat([png.subarray(0, -12), length, type, payload, checksum, png.subarray(-12)]);
}

function descendants(node) {
  return node.children.flatMap(child => [child, ...descendants(child)]);
}
function file(buffer, name = 'upload.png') {
  const result = new Blob([buffer], { type: 'image/png' }); result.name = name; return result;
}
function observeToasts(f) {
  vm.runInContext('globalThis.uploadToasts = []; const originalUploadToast = showToast; showToast = (...args) => { uploadToasts.push(args); return originalUploadToast(...args); };', f.context);
}
async function chunked(app, token, buffer) {
  return new Promise((resolve, reject) => {
    const request = http.request(app.base + '/api/v1/career-page/media?kind=hero', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/png' }
    }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => { try { resolve({ status: response.statusCode, data: JSON.parse(text) }); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    // No Content-Length: reader must enforce actual streamed bytes.
    request.write(buffer.subarray(0, 64 * 1024)); request.end(buffer.subarray(64 * 1024));
  });
}

async function main() {
  const app = await openApplication();
  try {
    const hr = await app.login('hrmanager@company.com');
    const recruiter = await app.login('recruiter@company.com');
    const basePng = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#345678' } }).png().toBuffer();
    const sizes = [MiB, 2 * MiB, 2 * MiB + 1, 3 * MiB, 5 * MiB, 5 * MiB + 1];
    const images = new Map();
    await test('S2-09/S2-03', 'fixtures', 'Every exact-size fixture decodes as a valid PNG', async () => {
      for (const size of sizes) {
        const image = pngAtSize(basePng, size); images.set(size, image);
        assert.equal(image.length, size);
        const decoded = await sharp(image, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
        assert.equal(decoded.info.width, 80); assert.equal(decoded.info.height, 40);
        assert.equal(decoded.data.length, 80 * 40 * 3);
      }
    });
    const uploaded = {};
    for (const kind of ['logo', 'hero']) {
      for (const size of [MiB, 3 * MiB, 5 * MiB, 5 * MiB + 1]) {
        await test('S2-09', 'size boundary', `${kind}: real HTTP image ${size} bytes`, async () => {
          const response = await app.api('POST', '/career-page/media?kind=' + kind, hr.token, images.get(size), 'image/png');
          assert.equal(response.status, size > 5 * MiB ? 413 : 200);
          if (size > 5 * MiB) {
            assert.equal(response.data.success, false); assert.equal(response.data.code, 'CAREER_IMAGE_TOO_LARGE');
            assert.equal(response.data.message, 'Ảnh không được vượt quá 5 MB.');
          } else {
            assert.equal(response.data.success, true); assert.equal(response.data.data.kind, kind);
            uploaded[kind] = response.data.data.url;
            const asset = await fetch(app.base + uploaded[kind]); assert.equal(asset.status, 200);
            const metadata = await sharp(Buffer.from(await asset.arrayBuffer())).metadata();
            assert.equal(metadata.format, 'png'); assert.equal(metadata.width, 80); assert.equal(metadata.height, 40);
          }
        });
      }
    }
    await test('S2-09', 'service boundary', 'Direct service enforces 5 MB independently of HTTP parser', async () => {
      const CareerPageService = require('../src/services/careerPageService');
      const service = new CareerPageService(app.db);
      assert.equal(service.maxFileSize, 5 * MiB);
      for (const kind of ['logo', 'hero']) {
        assert.equal((await service.saveMedia(kind, images.get(5 * MiB), 'image/png')).success, true);
        const rejected = await service.saveMedia(kind, images.get(5 * MiB + 1), 'image/png');
        assert.equal(rejected.statusCode, 413); assert.equal(rejected.code, 'CAREER_IMAGE_TOO_LARGE');
        assert.equal(rejected.message, 'Ảnh không được vượt quá 5 MB.');
      }
    });
    for (const size of [5 * MiB, 5 * MiB + 1]) {
      await test('S2-09', 'transport', `Chunked image without Content-Length: ${size} bytes`, async () => {
        const response = await chunked(app, hr.token, images.get(size));
        assert.equal(response.status, size > 5 * MiB ? 413 : 200);
        assert.equal(response.data.success, size <= 5 * MiB);
        if (size > 5 * MiB) assert.equal(response.data.code, 'CAREER_IMAGE_TOO_LARGE');
      });
    }
    await test('S2-09', 'image security', 'MIME restrictions, content decoding, empty and unknown kind unchanged', async () => {
      for (const kind of ['logo', 'hero']) {
        const wrongType = await app.api('POST', '/career-page/media?kind=' + kind, hr.token, images.get(3 * MiB), 'image/gif');
        assert.equal(wrongType.status, 400); assert.equal(wrongType.data.code, 'INVALID_CAREER_IMAGE_TYPE');
        const wrongContent = await app.api('POST', '/career-page/media?kind=' + kind, hr.token, Buffer.from('not an image'), 'image/png');
        assert.equal(wrongContent.status, 400); assert.equal(wrongContent.data.code, 'INVALID_CAREER_IMAGE');
        const empty = await app.api('POST', '/career-page/media?kind=' + kind, hr.token, Buffer.alloc(0), 'image/png');
        assert.equal(empty.status, 400); assert.equal(empty.data.code, 'EMPTY_CAREER_IMAGE');
      }
      const unsupported = await sharp(basePng).webp().toBuffer();
      const spoofed = await app.api('POST', '/career-page/media?kind=logo', hr.token, unsupported, 'image/png');
      assert.equal(spoofed.status, 400); assert.equal(spoofed.data.code, 'INVALID_CAREER_IMAGE');
      const invalidKind = await app.api('POST', '/career-page/media?kind=other', hr.token, basePng, 'image/png');
      assert.equal(invalidKind.status, 400); assert.equal(invalidKind.data.code, 'INVALID_CAREER_MEDIA_KIND');
      const jpeg = await sharp(basePng).jpeg().toBuffer();
      assert.equal((await app.api('POST', '/career-page/media?kind=hero', hr.token, jpeg, 'image/jpeg')).status, 200);
    });
    await test('S2-09', 'RBAC', 'No authentication = 401; role without career_page.manage = 403', async () => {
      for (const kind of ['logo', 'hero']) {
        assert.equal((await app.api('POST', '/career-page/media?kind=' + kind, null, basePng, 'image/png')).status, 401);
        assert.equal((await app.api('POST', '/career-page/media?kind=' + kind, recruiter.token, basePng, 'image/png')).status, 403);
      }
    });
    for (const size of [MiB, 2 * MiB, 2 * MiB + 1, 3 * MiB]) {
      await test('S2-03', 'avatar regression', `Avatar real HTTP ${size} bytes retains 2 MB limit`, async () => {
        const response = await app.api('POST', '/profile/avatar', hr.token, images.get(size), 'image/png');
        assert.equal(response.status, size > 2 * MiB ? 413 : 200);
        if (size > 2 * MiB) {
          assert.equal(response.data.code, 'AVATAR_TOO_LARGE');
          assert.equal(response.data.message, 'Ảnh đại diện vượt quá giới hạn 2MB.');
        } else {
          for (const [key, dimension] of [['avatarUrl', 512], ['thumbnailUrl', 96]]) {
            const asset = await fetch(app.base + response.data.data[key]); assert.equal(asset.status, 200);
            const metadata = await sharp(Buffer.from(await asset.arrayBuffer())).metadata();
            assert.equal(metadata.width, dimension); assert.equal(metadata.height, dimension);
          }
        }
      });
    }
    await test('S2-03', 'service boundary', 'Avatar service independently rejects >2 MB, including 3 MB', async () => {
      const AvatarService = require('../src/services/avatarService'); const service = new AvatarService();
      assert.equal(service.maxFileSize, 2 * MiB);
      for (const size of [2 * MiB + 1, 3 * MiB]) {
        const response = await service.saveAvatar('usr-hr-mgr', images.get(size), 'image/png');
        assert.equal(response.statusCode, 413); assert.equal(response.code, 'AVATAR_TOO_LARGE');
      }
    });
    const f = await createFrontendRuntime(app.base, '/admin/career-page', [['ats_token', hr.token], ['ats_user', JSON.stringify(hr.user)]]);
    observeToasts(f);
    for (const kind of ['logo', 'hero']) {
      await test('S2-09', 'frontend validation', `${kind} selection accepts 3 MB and exactly 5 MB`, async () => {
        const input = f.nodes.get('career-page-' + kind + '-input');
        for (const size of [3 * MiB, 5 * MiB]) {
          const selected = file(images.get(size), `${kind}-${size}.png`);
          input.files = [selected]; input.value = selected.name; await input.dispatch('change');
          assert.equal(input.value, selected.name);
          assert.equal(f.nodes.get('career-page-' + kind + '-status').textContent, 'Đã chọn: ' + selected.name);
        }
        assert.equal(f.context.uploadToasts.length, 0);
      });
    }
    await test('S2-09', 'frontend validation', '5 MB + 1 byte: selection and save rejected, correct message, no upload', async () => {
      const before = f.requests.length;
      for (const kind of ['logo', 'hero']) {
        f.nodes.get('career-page-logo-input').files = []; f.nodes.get('career-page-hero-input').files = [];
        const input = f.nodes.get('career-page-' + kind + '-input');
        input.files = [file(images.get(5 * MiB + 1))]; input.value = 'oversize.png';
        await input.dispatch('change'); assert.equal(input.value, '');
        await f.nodes.get('career-page-save-btn').dispatch('click'); await f.settle();
      }
      assert.equal(f.requests.slice(before).filter(row => row.method === 'POST' || row.method === 'PUT').length, 0);
      assert.equal(f.context.uploadToasts.length, 4);
      for (const toast of f.context.uploadToasts) { assert.match(toast[2], /5 MB/); assert.doesNotMatch(toast[2], /2\s?MB/); }
    });
    await test('S2-09', 'persist/public/render', 'Frontend saves two 3 MB images -> SQLite -> public API/assets -> preview/public render', async () => {
      f.nodes.get('career-page-logo-input').files = [file(images.get(3 * MiB), 'logo-3mb.png')];
      f.nodes.get('career-page-hero-input').files = [file(images.get(3 * MiB), 'hero-3mb.png')];
      f.nodes.get('career-page-introduction-input').value = 'Career Page 5 MB regression';
      const before = f.requests.length;
      await f.nodes.get('career-page-save-btn').dispatch('click'); await f.settle();
      const requests = f.requests.slice(before);
      assert.equal(requests.filter(row => row.method === 'POST' && row.path === '/api/v1/career-page/media').length, 2);
      assert.equal(requests.filter(row => row.method === 'PUT' && row.path === '/api/v1/career-page').length, 1);
      const published = await app.api('GET', '/public/career-page'); assert.equal(published.status, 200);
      const data = published.data.data; assert.equal(data.introduction, 'Career Page 5 MB regression');
      const row = app.db.prepare('SELECT * FROM career_page_settings WHERE id=1').get();
      assert.equal(row.logo_url, data.logoUrl); assert.equal(row.hero_image_url, data.heroImageUrl);
      assert.equal(row.introduction, data.introduction);
      for (const url of [data.logoUrl, data.heroImageUrl]) {
        const asset = await fetch(app.base + url); assert.equal(asset.status, 200);
        assert.equal((await sharp(Buffer.from(await asset.arrayBuffer())).metadata()).format, 'png');
      }
      const preview = descendants(f.nodes.get('career-page-preview-container'));
      assert.ok(preview.some(node => node.src === data.logoUrl)); assert.ok(preview.some(node => node.src === data.heroImageUrl));
      assert.ok(preview.some(node => node.textContent === data.introduction));
      const guest = await createFrontendRuntime(app.base, '/login');
      assert.equal(guest.nodes.get('login-company-logo').src, data.logoUrl);
      assert.equal(guest.nodes.get('login-background').src, data.heroImageUrl);
      assert.equal(guest.nodes.get('public-career-page-content').textContent, data.introduction);
      assert.deepEqual(f.errors, []); assert.deepEqual(guest.errors, []);
    });
    await test('S2-03', 'frontend regression', 'Profile frontend still rejects 2 MB + 1 byte and 3 MB before HTTP upload', async () => {
      const profile = await createFrontendRuntime(app.base, '/profile', [['ats_token', hr.token], ['ats_user', JSON.stringify(hr.user)]]);
      observeToasts(profile); const before = profile.requests.length;
      for (const size of [2 * MiB + 1, 3 * MiB]) {
        const input = profile.nodes.get('profile-avatar-input'); input.files = [file(images.get(size))]; input.value = 'oversize.png';
        await input.dispatch('change'); await profile.settle(); assert.equal(input.value, '');
      }
      assert.equal(profile.requests.slice(before).filter(row => row.path === '/api/v1/profile/avatar').length, 0);
      assert.equal(profile.context.uploadToasts.length, 2);
      for (const toast of profile.context.uploadToasts) assert.equal(toast[2], 'Ảnh đại diện không được vượt quá 2MB.');
      assert.deepEqual(profile.errors, []);
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
