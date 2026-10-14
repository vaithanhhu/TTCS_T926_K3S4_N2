const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false);
assert.equal(fs.existsSync(path.join(root, '.env')), false);
assert.equal(process.env.NODE_ENV, 'test');
const Portal = require('../src/services/candidatePortalService');
const Controller = require('../src/controllers/candidatePortalController');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
let passed = 0;
const results = [];
async function test(provider, name, action) {
  await action();
  passed++;
  results.push({ provider, name, status: 'PASS' });
  console.log('PASS ' + provider + ' ' + name);
}
async function run(db, provider) {
  const sqlite = provider === 'SQLite', type = sqlite ? 'INTEGER' : 'BOOLEAN';
  const bool = value => sqlite ? Number(value) : value;
  await db.exec(`
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,full_name TEXT,status TEXT,must_change_password ${type},locked_until TEXT);
    CREATE TABLE roles(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE permissions(id TEXT PRIMARY KEY,code TEXT);
    CREATE TABLE user_roles(user_id TEXT,role_id TEXT);
    CREATE TABLE role_permissions(role_id TEXT,permission_id TEXT);
    CREATE TABLE requisitions(id TEXT PRIMARY KEY,title TEXT,department_name TEXT,status TEXT);
    CREATE TABLE candidates(id TEXT PRIMARY KEY,full_name TEXT,email TEXT,phone_number TEXT,requisition_id TEXT REFERENCES requisitions(id),stage TEXT,tracking_code TEXT,referrer_id TEXT REFERENCES users(id),referrer_name TEXT,referral_notes TEXT,is_internal_referral ${type},created_at TEXT);
    CREATE TABLE candidate_documents(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id),file_name TEXT,storage_path TEXT,mime_type TEXT,file_size INTEGER,file_hash TEXT,document_type TEXT,created_at TEXT);
    CREATE TABLE candidate_status_history(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES candidates(id),before_stage TEXT,after_stage TEXT,actor_id TEXT REFERENCES users(id),actor_name TEXT,action TEXT,notes TEXT,created_at TEXT);
  `);
  await db.prepare('INSERT INTO permissions VALUES (?,?)').run('refer', 'candidate.refer');
  for (const role of ['ADMIN', 'HR_MANAGER', 'HIRING_MGR', 'CANDIDATE']) await db.prepare('INSERT INTO roles VALUES (?,?)').run(role, role);
  await db.prepare('INSERT INTO role_permissions VALUES (?,?)').run('HR_MANAGER', 'refer');
  for (const [id, role] of [['admin', 'ADMIN'], ['hr', 'HR_MANAGER'], ['hiring', 'HIRING_MGR'], ['candidate', 'CANDIDATE']]) {
    await db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(id, id + '@example.test', 'Verified ' + id, 'ACTIVE', bool(false), null);
    await db.prepare('INSERT INTO user_roles VALUES (?,?)').run(id, role);
  }
  await db.exec("INSERT INTO requisitions VALUES ('open','Fixture role','Fixture department','OPEN'); INSERT INTO requisitions VALUES ('closed','Closed role','Fixture department','CLOSED');");
  const service = new Portal(db), raw = db.prepare.bind(db), uploads = path.join(root, 'backend/data/cv_uploads');
  const cv = { filename: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nFake test fixture\n%%EOF') };
  const actor = id => ({ id, roles: ['ADMIN', 'EMPLOYEE'], fullName: 'Forged name', email: 'forged@example.test', status: 'ACTIVE' });
  let count = 0, writes = 0, validations = 0, requisitionReads = 0;
  const input = extra => ({ requisitionId: 'open', fullName: 'Fixture applicant', email: 'referral-' + (++count) + '@example.test', phoneNumber: '0000000000', referralNotes: 'Fixture note', ...extra });
  const originalValidate = service.validateCvFile.bind(service);
  service.validateCvFile = file => { validations++; return originalValidate(file); };
  db.prepare = query => {
    const statement = raw(query);
    if (/^(?:INSERT|UPDATE|DELETE)\b/i.test(query.trim())) {
      const run = statement.run.bind(statement);
      statement.run = (...args) => { writes++; return run(...args); };
    }
    if (query.includes('FROM requisitions')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => { requisitionReads++; return get(...args); };
    }
    return statement;
  };
  const snapshot = async () => ({
    candidates: await raw('SELECT * FROM candidates ORDER BY id').all(),
    documents: await raw('SELECT * FROM candidate_documents ORDER BY id').all(),
    history: await raw('SELECT * FROM candidate_status_history ORDER BY id').all(),
    files: fs.readdirSync(uploads).sort()
  });
  async function denied(user, status = 403, data = input({ cvFile: cv })) {
    const before = await snapshot(), counters = { writes, validations, requisitionReads };
    const result = await service.referCandidate(data, user);
    assert.deepEqual(result, { success: false, statusCode: status, code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: status === 401 ? 'Yêu cầu đăng nhập.' : 'Bạn không có quyền giới thiệu ứng viên.' });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual({ writes, validations, requisitionReads }, counters);
  }
  const check = (name, action) => test(provider, name, action);
  try {
    await check('missing actor rejected before null payload validation', () => denied(null, 401, null));
    await check('actor without id rejected', () => denied({ roles: ['ADMIN'] }, 401));
    await check('nonexistent actor and forged internal role rejected', () => denied(actor('missing')));
    await check('object actor id rejected without database binding errors', () => denied(actor({ toString: () => 'admin' })));
    await check('read-only role cannot forge ADMIN or EMPLOYEE privilege', () => denied(actor('candidate')));
    await check('internal role without grant denied', () => denied(actor('hiring')));
    await check('LOCKED administrator cannot use ADMIN bypass', async () => {
      await raw("UPDATE users SET status='LOCKED' WHERE id='admin'").run();
      try { await denied(actor('admin')); } finally { await raw("UPDATE users SET status='ACTIVE' WHERE id='admin'").run(); }
    });
    await check('disabled account denied', async () => {
      await raw("UPDATE users SET status='INACTIVE' WHERE id='hr'").run();
      try { await denied(actor('hr')); } finally { await raw("UPDATE users SET status='ACTIVE' WHERE id='hr'").run(); }
    });
    await check('future lock denied', async () => {
      await raw("UPDATE users SET locked_until='2999-01-01' WHERE id='hr'").run();
      try { await denied(actor('hr')); } finally { await raw("UPDATE users SET locked_until=NULL WHERE id='hr'").run(); }
    });
    await check('password reset required denied', async () => {
      await raw('UPDATE users SET must_change_password=? WHERE id=?').run(bool(true), 'hr');
      try { await denied(actor('hr')); } finally { await raw('UPDATE users SET must_change_password=? WHERE id=?').run(bool(false), 'hr'); }
    });
    await check('grant revoked takes effect for stale actor', async () => {
      await raw("DELETE FROM role_permissions WHERE role_id='HR_MANAGER'").run();
      try { await denied(actor('hr')); } finally { await raw("INSERT INTO role_permissions VALUES ('HR_MANAGER','refer')").run(); }
    });
    await check('role revoked takes effect for stale actor', async () => {
      await raw("DELETE FROM user_roles WHERE user_id='hr'").run();
      try { await denied(actor('hr')); } finally { await raw("INSERT INTO user_roles VALUES ('hr','HR_MANAGER')").run(); }
    });
    for (const id of ['admin', 'hr']) await check(id + ' valid actor preserves DTO and stores DB identity', async () => {
      const data = input(), result = await service.referCandidate(data, actor(id));
      assert.equal(result.statusCode, 201);
      assert.equal(result.success, true);
      assert.deepEqual(Object.keys(result).sort(), ['data', 'message', 'statusCode', 'success']);
      assert.deepEqual(Object.keys(result.data).sort(), ['candidateId', 'email', 'fullName', 'isInternalReferral', 'jobTitle', 'referrerId', 'referrerName', 'trackingCode']);
      assert.equal(result.data.referrerId, id);
      assert.equal(result.data.referrerName, 'Verified ' + id);
      assert.equal(result.data.email, data.email);
      const row = await raw('SELECT * FROM candidates WHERE id=?').get(result.data.candidateId);
      assert.equal(row.referrer_id, id);
      assert.equal(row.referrer_name, 'Verified ' + id);
      assert.equal(row.stage, 'NEW');
      assert.equal(row.is_internal_referral, bool(true));
      const history = await raw('SELECT * FROM candidate_status_history WHERE candidate_id=?').get(row.id);
      assert.equal(history.actor_id, id);
      assert.equal(history.actor_name, 'Verified ' + id);
      assert.equal(history.action, 'INTERNAL_REFERRAL');
    });
    await check('two-argument CV compatibility and immutable input', async () => {
      const data = input({ cvFile: cv }), original = { ...data }, result = await service.referCandidate(data, actor('hr'));
      assert.equal(result.statusCode, 201);
      assert.deepEqual(data, original);
      const doc = await raw('SELECT * FROM candidate_documents WHERE candidate_id=?').get(result.data.candidateId);
      assert.equal(doc.document_type, 'CV');
      assert.equal(doc.file_hash, crypto.createHash('sha256').update(cv.buffer).digest('hex'));
      assert.deepEqual(fs.readFileSync(path.join(uploads, doc.storage_path)), cv.buffer);
    });
    await check('three-argument CV compatibility', async () => {
      const result = await service.referCandidate(input(), cv, actor('hr'));
      assert.equal(result.statusCode, 201);
      assert.equal((await raw('SELECT * FROM candidate_documents WHERE candidate_id=?').get(result.data.candidateId)).candidate_id, result.data.candidateId);
    });
    await check('valid actor still gets field validation before mutation', async () => {
      const before = await snapshot();
      assert.equal((await service.referCandidate({}, actor('hr'))).code, 'INVALID_FIELDS');
      assert.deepEqual(await snapshot(), before);
    });
    await check('closed requisition remains rejected', async () => {
      const before = await snapshot();
      assert.equal((await service.referCandidate(input({ requisitionId: 'closed' }), actor('hr'))).code, 'REQUISITION_NOT_OPEN');
      assert.deepEqual(await snapshot(), before);
    });
    await check('duplicate referral remains rejected', async () => {
      const data = input();
      assert.equal((await service.referCandidate(data, actor('hr'))).statusCode, 201);
      const before = await snapshot();
      assert.equal((await service.referCandidate(data, actor('hr'))).code, 'DUPLICATE_CANDIDATE');
      assert.deepEqual(await snapshot(), before);
    });
    await check('multi-role actor uses actual grant union', async () => {
      await raw("INSERT INTO user_roles VALUES ('hr','CANDIDATE')").run();
      try { assert.equal((await service.referCandidate(input(), { id: 'hr', roles: ['CANDIDATE'] })).statusCode, 201); }
      finally { await raw("DELETE FROM user_roles WHERE user_id='hr' AND role_id='CANDIDATE'").run(); }
    });
    await check('failure after candidate insert rolls back candidate and history', async () => {
      const before = await snapshot(), prepare = db.prepare;
      db.prepare = query => {
        const stmt = prepare(query);
        if (query.includes('INSERT INTO candidate_status_history')) stmt.run = async () => { throw Error('REFERRAL_AUDIT_FAILURE'); };
        return stmt;
      };
      try { await assert.rejects(() => service.referCandidate(input(), actor('hr')), /REFERRAL_AUDIT_FAILURE/); }
      finally { db.prepare = prepare; }
      assert.deepEqual(await snapshot(), before);
    });
    if (sqlite) await check('HTTP anonymous and revoked caller cannot bypass service policy', async () => {
      const controller = new Controller(service, service.rbac, { validateSession: async token => ({ valid: true, user: actor(token) }) });
      const server = http.createServer((req, res) => db.withConnection(() => controller.handle(req, res, new URL(req.url, 'http://localhost'), async () => input())).catch(() => { res.writeHead(500); res.end(); }));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const before = await snapshot();
        for (const id of [null, 'missing', 'candidate']) {
          const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/candidates/refer', { method: 'POST', headers: id ? { Authorization: 'Bearer ' + id } : {} });
          assert.equal(response.status, id ? 403 : 401);
        }
        assert.deepEqual(await snapshot(), before);
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });
  } finally { db.prepare = raw; }
}
async function main() {
  const sqlite = sqliteBoundary(new (require('node:sqlite').DatabaseSync)(':memory:'));
  try { await run(sqlite, 'SQLite'); } finally { sqlite.close(); }
  const engine = new (require('@electric-sql/pglite').PGlite)();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: result?.rows || [], rowCount: result?.affectedRows || 0 };
  };
  const pg = new PostgresDatabase({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  try { await run(pg, 'PGlite'); } finally { await pg.close(); }
  if (process.env.ATS_REFERRAL_PG_URL) {
    const url = new URL(process.env.ATS_REFERRAL_PG_URL);
    assert.equal(url.hostname, '127.0.0.1');
    assert.match(url.pathname, /^\/ats_referral_test_[a-f0-9]{8}$/);
    const live = new PostgresDatabase({ DATABASE_URL: url.href, PG_SSL_MODE: 'verify' });
    try { await run(live, 'PostgreSQL native'); } finally { await live.close(); }
  }
  console.log('REFERRAL_AUTHORIZATION_RESULT ' + JSON.stringify({ passed, failed: 0, results, livePostgres: Boolean(process.env.ATS_REFERRAL_PG_URL) }));
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
