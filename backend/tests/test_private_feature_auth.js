/** Run only in a disposable source copy. Uses its fresh SQLite fixture and simulated email. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats_test.db']) {
  assert.equal(fs.existsSync(path.join(root, file)), false, 'Fresh isolated copy required: ' + file);
}
for (const key of Object.keys(process.env)) {
  if (/^(DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|ATS_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_)/.test(key)) delete process.env[key];
}
Object.assign(process.env, { NODE_ENV: 'test', DB_PROVIDER: 'sqlite', EMAIL_MODE: 'simulated', ATS_LOCAL_DEMO: 'true' });

async function main() {
  const { startServer, server } = require('../src/server');
  const db = require('../src/db/database').getDatabase();
  assert.notEqual(db.provider, 'postgres');
  await startServer(0, '127.0.0.1');
  const base = 'http://127.0.0.1:' + server.address().port + '/api/v1';
  async function api(route, token, body) {
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, data: await response.json() };
  }
  async function login(email) {
    const res = await api('/auth/login', null, { email, password: 'Ats@123456' });
    assert.equal(res.status, 200); return res.data.data.token;
  }
  try {
    assert.equal((await api('/candidates/merge/recent')).status, 401);
    assert.equal((await api('/candidates/merge/recent', 'invalid-fixture')).status, 401);
    const restricted = await login('interviewer@company.com');
    assert.equal((await api('/candidates/merge/recent', restricted)).status, 403);
    const permitted = await login('hrmanager@company.com');
    assert.equal((await api('/candidates/merge/recent', permitted)).status, 200);
    await db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01T00:00:00.000Z', permitted);
    assert.equal((await api('/candidates/merge/recent', permitted)).status, 401);
    console.log('PRIVATE_FEATURE_AUTH_RESULT PASS: anonymous/invalid/expired=401, forbidden=403, permitted=200');
  } finally {
    await new Promise(resolve => server.close(resolve)); await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
