const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/** Real application, fresh SQLite and installed dependencies; never the working repository. */
async function openApplication() {
  const root = path.resolve(__dirname, '../../..');
  for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm',
    'backend/data/ats.db-wal', 'backend/data/ats_test.db']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, 'Fresh isolated copy required: ' + file);
  }
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_MODE = 'simulated';
  for (const key of Object.keys(process.env)) {
    if (/^(SMTP_|MAIL_|GOOGLE_OAUTH_)/.test(key)) delete process.env[key];
  }
  const config = require('../../src/config/config');
  assert.equal(config.EMAIL_MODE, 'simulated');
  assert.equal(config.DB_PATH, path.join(root, 'backend/data/ats_test.db'));
  for (const name of ['exceljs', 'sharp', 'nodemailer']) {
    assert.ok(require.resolve(name).startsWith(root + path.sep), 'Dependencies must belong to isolated copy');
  }
  const { startServer, server } = require('../../src/server');
  const { getDatabase } = require('../../src/db/database');
  await startServer(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const db = getDatabase();
  async function api(method, route, token, body, type = 'application/json') {
    assert.ok(route.startsWith('/'), 'Only isolated relative API routes are allowed');
    const response = await fetch(base + '/api/v1' + route, {
      method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'Content-Type': type } : {}) },
      ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  async function login(email, password = 'Ats@123456') {
    const result = await api('POST', '/auth/login', null, { email, password });
    assert.equal(result.status, 200, 'Fixture account login');
    return result.data.data;
  }
  return { root, db, base, api, login, async close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  } };
}

/** Each case retains a failure; independent stories continue without changing implementation. */
function cases(label) {
  const results = [];
  return {
    async test(story, ac, name, action) {
      try {
        await action(); results.push({ story, ac, name, status: 'PASS' });
        console.log(`[PASS] ${story} ${ac}: ${name}`);
      } catch (error) {
        results.push({ story, ac, name, status: 'FAIL', message: error.message });
        console.error(`[FAIL] ${story} ${ac}: ${name}\n${error.stack}`);
      }
    },
    finish() {
      const passed = results.filter(row => row.status === 'PASS').length;
      const failed = results.length - passed;
      console.log(label + '_RESULT ' + JSON.stringify({ passed, failed, total: results.length, cases: results }));
      process.exitCode = failed ? 1 : 0;
    }
  };
}
module.exports = { openApplication, cases };
