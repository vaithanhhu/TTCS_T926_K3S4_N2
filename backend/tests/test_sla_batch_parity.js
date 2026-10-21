// Run only in a fresh isolated application copy (see helpers/coverageApplication).
const assert = require('node:assert/strict');
const Service = require('../src/services/slaNotificationService');
const Reference = require('./fixtures/slaReference20261022');
const instant = '2026-10-22T00:00:00.000Z';

async function run(db) {
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
  await db.exec(`CREATE TABLE candidate_status_history (
    id TEXT PRIMARY KEY, candidate_id TEXT, before_stage TEXT, after_stage TEXT,
    actor_name TEXT, action TEXT, created_at ${db.provider === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT'}
  )`);
  const service = new Service(db), reference = new Reference(db);
  await service.ensureTables();
  if (process.argv.includes('--require-batch')) assert.equal(typeof service.prepareCandidateSlaBatch, 'function');
  const reqs = await db.prepare('SELECT id FROM requisitions ORDER BY id').all();
  const req = reqs[0].id;
  await db.prepare("INSERT INTO sla_configurations(id,stage,requisition_id,threshold_days,warning_days) VALUES ('parity-scoped','NEW',?,9,0)").run(req);
  // Duplicate globals are legal: the existing config loader's precedence must survive.
  await db.prepare("INSERT INTO sla_configurations(id,stage,requisition_id,threshold_days,warning_days) VALUES ('parity-global','NEW',NULL,12,6)").run();
  const candidates = [];
  const stages = ['NEW', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN', 'APPLIED', 'ONBOARDED', 'new', null];
  for (let i = 0; i < 36; i++) {
    const id = 'parity-' + i, stage = stages[i % stages.length];
    const created = i % 3 === 0 ? '2026-10-01T03:00:00+03:00' : '2026-10-01 00:00:00';
    await db.prepare('INSERT INTO candidates(id,full_name,email,requisition_id,stage,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, 'Fixture ' + i, id + '@example.invalid', req, stage || 'NEW', created);
    const c = { id, stage, created_at: created, requisition_id: i % 3 === 0 ? req : null };
    if (i % 3 === 1) c.requisitionId = reqs[1].id;
    if (i % 3 === 2) c.requisition = { id: req };
    candidates.push(c);
    if (i % 4 !== 0) {
      for (let n = 1; n <= 2; n++) {
        await db.prepare('INSERT INTO candidate_status_history(id,candidate_id,before_stage,after_stage,actor_name,action,created_at) VALUES (?,?,?,?,?,?,?)')
          .run(id + '-' + n, id, 'NEW', (stage || 'NEW').toUpperCase(), 'Fixture', 'STAGE_CHANGED', n === 1 ? '2026-10-02T00:00:00Z' : '2026-10-20T17:00:00Z');
      }
    }
  }
  candidates.push(null, {}, { id: 'no-date', stage: 'NEW' }, { id: 'future', stage: 'NEW', createdAt: '2026-10-23T00:00:00Z' });
  const maps = [null, {}, Object.fromEntries((await service.getSlaConfigs()).map(c => [c.stage, c])), { NEW: { thresholdDays: '0', warningDays: '0' } }];
  const NativeDate = Date, zone = process.env.TZ;
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return NativeDate.parse(instant); } static [Symbol.hasInstance](value) { return value instanceof NativeDate; } };
  try {
    for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']) {
      process.env.TZ = tz;
      for (const configMap of maps) {
        const batch = service.prepareCandidateSlaBatch ? await service.prepareCandidateSlaBatch(candidates, configMap) : null;
        for (const candidate of candidates) {
          assert.deepStrictEqual(await service.calculateCandidateSla(candidate, configMap, instant, batch),
            await reference.calculateCandidateSla(candidate, configMap, instant), `${db.provider}/${tz}/${candidate?.id}`);
        }
      }
    }
    for (const user of [null, { id: 'missing' }, { id: 'usr-candidate' }, { id: 'usr-admin' }, { id: 'usr-hr-mgr' }, { id: 'usr-recruiter' }, { id: 'usr-recruiter2' }]) {
      assert.deepStrictEqual(await service.getSlaSummary(user), await reference.getSlaSummary(user));
      for (const options of [{}, { includeAll: true }, { includeAll: true, requisitionId: req }, { stage: 'NEW' }, { search: 'Fixture' }]) {
        const opts = { ...options, referenceDate: instant };
        assert.deepStrictEqual(await service.getOverdueCandidates(user, opts), await reference.getOverdueCandidates(user, opts));
      }
    }
    const prepare = db.prepare.bind(db);
    let reads = 0;
    db.prepare = sql => { reads++; return prepare(sql); };
    try {
      const list = Array.from({ length: 1000 }, (_, i) => candidates[i % 36]);
      const map = maps[2];
      const batch = service.prepareCandidateSlaBatch ? await service.prepareCandidateSlaBatch(list, map) : null;
      for (const c of list) await service.calculateCandidateSla(c, map, instant, batch);
      if (batch) assert.ok(reads <= 12, 'SLA reads must not grow per repeated candidate: ' + reads);
      console.log('SLA_READS_1000 ' + db.provider + ' ' + reads);
    } finally { db.prepare = prepare; }
    if (service.prepareCandidateSlaBatch) {
      let terminalReads = 0;
      db.prepare = sql => { terminalReads++; return prepare(sql); };
      try {
        await service.prepareCandidateSlaBatch([], maps[2]);
        const terminal = candidates.filter(c => ['HIRED', 'REJECTED', 'WITHDRAWN'].includes(c?.stage));
        const context = await service.prepareCandidateSlaBatch(terminal, maps[2]);
        for (const c of terminal) await service.calculateCandidateSla(c, maps[2], instant, context);
        assert.equal(terminalReads, 0);
      } finally { db.prepare = prepare; }
      let bulkFailures = 0;
      db.prepare = sql => { if (/jsonb_array_elements_text|json_each/.test(sql)) { bulkFailures++; throw Error('SYNTHETIC_BATCH_FAILURE'); } return prepare(sql); };
      try {
        const context = await service.prepareCandidateSlaBatch(candidates, maps[2]);
        for (const c of candidates) assert.deepStrictEqual(await service.calculateCandidateSla(c, maps[2], instant, context), await reference.calculateCandidateSla(c, maps[2], instant));
        assert.ok(bulkFailures > 0);
      } finally { db.prepare = prepare; }
      db.prepare = sql => { if (/FROM candidate_status_history/.test(sql)) throw Error('SYNTHETIC_HISTORY_FAILURE'); return prepare(sql); };
      try {
        const context = await service.prepareCandidateSlaBatch(candidates, maps[2]);
        assert.equal(context, null);
        await assert.rejects(() => service.calculateCandidateSla(candidates[0], maps[2], instant, context), /SYNTHETIC_HISTORY_FAILURE/);
        await assert.rejects(() => reference.calculateCandidateSla(candidates[0], maps[2], instant), /SYNTHETIC_HISTORY_FAILURE/);
      } finally { db.prepare = prepare; }
    }
    await db.prepare("INSERT INTO candidate_status_history(id,candidate_id,after_stage,actor_name,action,created_at) VALUES ('null-history','parity-1','SCREENING','Fixture','STAGE_CHANGED',NULL)").run();
    const nullHistoryBatch = service.prepareCandidateSlaBatch ? await service.prepareCandidateSlaBatch(candidates, maps[2]) : null;
    assert.deepStrictEqual(await service.calculateCandidateSla(candidates[1], maps[2], instant, nullHistoryBatch), await reference.calculateCandidateSla(candidates[1], maps[2], instant));
    if (db.provider !== 'postgres') {
      await db.prepare("INSERT INTO candidate_status_history(id,candidate_id,after_stage,actor_name,action,created_at) VALUES ('invalid-history','parity-1','SCREENING','Fixture','STAGE_CHANGED','zzz-invalid')").run();
      const batch = service.prepareCandidateSlaBatch ? await service.prepareCandidateSlaBatch(candidates, maps[2]) : null;
      assert.deepStrictEqual(await service.calculateCandidateSla(candidates[1], maps[2], instant, batch), await reference.calculateCandidateSla(candidates[1], maps[2], instant));
    }
    await db.exec('DROP TABLE candidate_status_history');
    const batch = service.prepareCandidateSlaBatch ? await service.prepareCandidateSlaBatch(candidates, maps[2]) : null;
    for (const c of candidates) assert.deepStrictEqual(await service.calculateCandidateSla(c, maps[2], instant, batch), await reference.calculateCandidateSla(c, maps[2], instant));
    const invalid = { id: 'invalid-created', stage: 'NEW', created_at: 'invalid' };
    await assert.rejects(() => service.calculateCandidateSla(invalid, maps[2], instant, batch), RangeError);
    await assert.rejects(() => reference.calculateCandidateSla(invalid, maps[2], instant), RangeError);
  } finally { global.Date = NativeDate; if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
  console.log('SLA_REFERENCE_PARITY_PASS ' + db.provider);
}

async function main() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DB_PROVIDER, 'sqlite');
  assert.equal(process.env.ATS_LOCAL_DEMO, 'true');
  const fs = require('node:fs'), path = require('node:path'), root = path.resolve(__dirname, '../..');
  assert.equal(fs.existsSync(path.join(root, '../.env')), false);
  assert.equal(fs.existsSync(path.join(root, '../.git')), false);
  const db = require('../src/db/database').getDatabase(':memory:');
  try { await run(db); } finally { await db.close(); }
  const engine = new (require('@electric-sql/pglite').PGlite)();
  const query = async (sql, params) => { const r = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params); return { rows: r?.rows || [], rowCount: r?.affectedRows || 0 }; };
  const pg = new (require('../src/db/postgres').PostgresDatabase)({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  try { await require('../src/db/migrate-postgres').migrate(pg); await run(pg); } finally { await pg.close(); }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
