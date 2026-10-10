const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { openApplication, cases } = require('./helpers/coverageApplication');
const disposablePostgresAddress = process.env.ATS_POSTGRES_TEST_URL;
const { setup, prepare } = require('./test_s3_10');
const { PostgresDatabase, pgTypes } = require('../src/db/postgres');
const { RequisitionLifecycleService } = require('../src/services/requisitionLifecycleService');
const { test, finish } = cases('CANDIDATE_STAGE');
const stages = ['NEW', 'APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
const invalidStages = ['INVALID_STAGE_AUDIT', 'new', ' NEW', 'NEW ', ' ', 'HIRED\n', 1, true, [], {}, ['NEW']];
const uuid = () => crypto.randomUUID();

async function counts(db) {
  const tables = db.provider === 'postgres'
    ? await db.prepare("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename").all()
    : await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(await Promise.all(tables.map(async ({ name }) => {
    assert.match(name, /^[a-z_][a-z0-9_]*$/);
    return [name, Number((await db.prepare('SELECT COUNT(*) AS n FROM ' + name).get()).n)];
  })));
}

async function stageCases(db, engine, app) {
  const s = await setup(db, engine);
  await prepare(s);
  const id = await s.create();
  await s.assign(id, s.rec.id, []);
  const data = stage => ({ fullName: 'Isolated stage regression', email: uuid() + '@example.invalid', requisitionId: id, stage });
  for (const stage of stages) {
    await test(engine, 'valid create/update', stage, async () => {
      const created = await s.service.createCandidate(data(stage), s.rec);
      assert.equal(created.statusCode, 201);
      assert.equal(created.data.stage, stage);
      assert.equal((await db.prepare('SELECT stage FROM candidates WHERE id=?').get(created.data.id)).stage, stage);
      for (const next of stages) {
        const updated = await s.service.updateCandidateStage(created.data.id, next, undefined, undefined, s.rec);
        assert.equal(updated.statusCode, 200);
        assert.equal((await db.prepare('SELECT stage FROM candidates WHERE id=?').get(created.data.id)).stage, next);
      }
    });
  }
  for (const value of [undefined, null, '', false, 0]) {
    await test(engine, 'legacy default', JSON.stringify(value) ?? 'omitted', async () => {
      const payload = data(value);
      if (value === undefined) delete payload.stage;
      const result = await s.service.createCandidate(payload, s.rec);
      assert.equal(result.statusCode, 201);
      assert.equal(result.data.stage, 'NEW');
    });
  }
  const candidate = await s.service.createCandidate(data('NEW'), s.rec);
  const lifecycle = new RequisitionLifecycleService(db);
  for (const stage of invalidStages) {
    await test(engine, 'invalid stage has no writes', JSON.stringify(stage), async () => {
      const before = await counts(db);
      const pipeline = (await lifecycle.context(id, s.hr)).outstanding;
      const created = await s.service.createCandidate(data(stage), s.rec);
      assert.equal(created.success, false);
      assert.equal(created.statusCode, 400);
      assert.equal(created.code, 'INVALID_CANDIDATE_STAGE');
      const updated = await s.service.updateCandidateStage(candidate.data.id, stage, 'must not save', undefined, s.rec);
      assert.equal(updated.success, false);
      assert.equal(updated.statusCode, 400);
      assert.equal(updated.code, created.code);
      assert.deepEqual(await counts(db), before);
      assert.deepEqual((await lifecycle.context(id, s.hr)).outstanding, pipeline);
      const row = await db.prepare('SELECT stage,notes FROM candidates WHERE id=?').get(candidate.data.id);
      assert.equal(row.stage, 'NEW');
      assert.notEqual(row.notes, 'must not save');
    });
  }
  await test(engine, 'update never defaults', 'omitted/null/empty/false/zero remain invalid on update', async () => {
    for (const stage of [undefined, null, '', false, 0]) {
      const result = await s.service.updateCandidateStage(candidate.data.id, stage, undefined, undefined, s.rec);
      assert.equal(result.statusCode, 400);
      assert.equal(result.code, 'INVALID_CANDIDATE_STAGE');
    }
    assert.equal((await db.prepare('SELECT stage FROM candidates WHERE id=?').get(candidate.data.id)).stage, 'NEW');
  });
  await test(engine, 'candidate self-service', 'invalid input is rejected before the existing NEW override', async () => {
    const actor = s.users.CANDIDATE;
    const result = await s.service.createCandidate({ ...data('INVALID_STAGE_AUDIT'), email: actor.email }, actor);
    assert.equal(result.statusCode, 400);
    assert.equal(result.code, 'INVALID_CANDIDATE_STAGE');
  });
  if (app) {
    const token = (await app.login('recruiter@company.com')).token;
    await test(engine, 'HTTP create/update', '400 with a consistent code and no successful write or pipeline side effect', async () => {
      const before = await counts(db);
      const outstanding = (await lifecycle.context(id, s.hr)).outstanding;
      for (const stage of invalidStages) {
        const created = await app.api('POST', '/candidates', token, data(stage));
        assert.equal(created.status, 400);
        assert.equal(created.data.code, 'INVALID_CANDIDATE_STAGE');
        const updated = await app.api('PUT', '/candidates/' + candidate.data.id + '/stage', token, { stage });
        assert.equal(updated.status, 400);
        assert.equal(updated.data.code, 'INVALID_CANDIDATE_STAGE');
      }
      assert.deepEqual(await counts(db), before);
      assert.deepEqual((await lifecycle.context(id, s.hr)).outstanding, outstanding);
    });
    await test(engine, 'HTTP defaults/valid stage', 'omitted create stage is NEW; a valid create/update retains its behavior', async () => {
      const payload = data(undefined);
      delete payload.stage;
      const created = await app.api('POST', '/candidates', token, payload);
      assert.equal(created.status, 201);
      assert.equal(created.data.data.stage, 'NEW');
      const updated = await app.api('PUT', '/candidates/' + created.data.data.id + '/stage', token, { stage: 'HIRED' });
      assert.equal(updated.status, 200);
      assert.equal((await db.prepare('SELECT stage FROM candidates WHERE id=?').get(created.data.data.id)).stage, 'HIRED');
    });
  }
}

async function embedded() {
  const { PGlite } = require('@electric-sql/pglite');
  const engine = new PGlite();
  let tail = Promise.resolve();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: (result?.rows || []).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const type = result.fields.find(field => field.name === key)?.dataTypeID;
      return [key, value instanceof Date ? (type === 1082 ? value.toISOString().slice(0, 10) : value.toISOString()) : typeof value === 'bigint' ? Number(value) : typeof value === 'string' && [20, 1700].includes(type) ? pgTypes().getTypeParser(type)(value) : value];
    }))), rowCount: result?.affectedRows || result?.rows?.length || 0 };
  };
  return new PostgresDatabase({}, { on() {}, query, async connect() {
    const previous = tail;
    let release;
    tail = new Promise(resolve => release = resolve);
    await previous;
    return { query, release };
  }, async end() { await engine.close(); } });
}

async function initialize(db) {
  await require('../src/db/migrate-postgres').migrate(db);
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
}

async function main() {
  if (process.argv.includes('--postgres-only')) {
    const address = disposablePostgresAddress;
    assert.ok(address, 'Disposable local PostgreSQL required');
    const parsed = new URL(address);
    assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/ats_candidate_stage_test');
    const root = path.resolve(__dirname, '../..');
    assert.equal(fs.existsSync(path.join(root, '.env')), false);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    const db = new PostgresDatabase({ DATABASE_URL: address, PG_SSL_MODE: 'disable' });
    try {
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'").get()).n, 0);
      await initialize(db);
      const config = require('../src/config/config');
      Object.assign(config, { DB_PROVIDER: 'postgres', DATABASE_URL: address, PG_SSL_MODE: 'disable', EMAIL_MODE: 'simulated' });
      const { startServer, server } = require('../src/server');
      const serverDb = require('../src/db/database').getDatabase();
      try {
        await startServer(0);
        const base = 'http://127.0.0.1:' + server.address().port;
        const api = async (method, route, token, body) => {
          const response = await fetch(base + '/api/v1' + route, { method,
            headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
          return { status: response.status, data: await response.json() };
        };
        const login = async email => {
          const result = await api('POST', '/auth/login', null, { email, password: 'Ats@123456' });
          assert.equal(result.status, 200);
          return result.data.data;
        };
        await stageCases(db, 'PostgreSQL-real', { api, login });
      } finally {
        server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        await serverDb.close();
      }
    } finally { await db.close(); }
  } else {
    const app = await openApplication();
    try { await stageCases(app.db, 'SQLite', app); } finally { await app.close(); }
    const db = await embedded();
    try { await initialize(db); await stageCases(db, 'PGlite'); } finally { await db.close(); }
  }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
