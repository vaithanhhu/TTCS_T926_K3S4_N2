const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root, '.git')), false);
assert.equal(fs.existsSync(path.join(root, '.env')), false);
assert.equal(process.env.NODE_ENV, 'test');
const importer = require('../src/db/import-sqlite');
const { PostgresDatabase } = require('../src/db/postgres');
const schema = fs.readFileSync(path.join(root, 'backend/src/db/migrations/001_postgres.sql'), 'utf8');
let passed = 0;
async function test(name, action) {
  const engine = new (require('@electric-sql/pglite').PGlite)();
  const query = async (sql, params) => {
    const result = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params);
    return { rows: result?.rows || [], rowCount: result?.affectedRows || 0 };
  };
  const db = new PostgresDatabase({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  try { await db.exec(schema); await action(db); passed++; console.log('PASS ' + name); }
  finally { await db.close(); }
}
const prepared = () => ({ ready: true, rows: Object.fromEntries(importer.TABLES.map(table => [table, []])) });
const audits = count => Array.from({ length: count }, (_, i) => ({ id: 'audit-' + i, email: 'fixture@example.test', status: 'SUCCESS', sequence_id: i * 2 + 1 }));
const empty = async db => {
  for (const table of importer.TABLES) assert.equal((await db.prepare('SELECT count(*) AS n FROM ' + table).get()).n, 0, table);
};
async function main() {
  await test('201 rows use three bounded inserts and preserve every value and sequence gap', async db => {
    const data = prepared(); data.rows.login_audit_logs = audits(201);
    const raw = db.prepare.bind(db), inserts = [];
    db.prepare = sql => {
      const stmt = raw(sql);
      if (sql.startsWith('INSERT INTO login_audit_logs')) {
        const run = stmt.run.bind(stmt);
        stmt.run = (...args) => { inserts.push(args.length); return run(...args); };
      }
      return stmt;
    };
    await importer.importRows(db, data);
    assert.deepEqual(inserts, [400, 400, 4]);
    assert.deepEqual(await raw('SELECT id,email,status,sequence_id FROM login_audit_logs ORDER BY sequence_id').all(), data.rows.login_audit_logs);
    assert.deepEqual(await raw('SELECT last_value,is_called FROM login_audit_logs_sequence_id_seq').get(), { last_value: 401, is_called: true });
  });
  await test('column shapes and key order retain original per-row default semantics', async db => {
    const data = prepared(); data.rows.login_audit_logs = [
      { id: 'a', email: 'fixture@example.test', status: 'SUCCESS', sequence_id: 1 },
      { sequence_id: 2, status: 'SUCCESS', email: 'fixture@example.test', id: 'b', reason: 'Fixture reason' },
      { id: 'c', email: 'fixture@example.test', status: 'SUCCESS', sequence_id: 3 }
    ];
    await importer.importRows(db, data);
    assert.deepEqual(await db.prepare('SELECT id,reason FROM login_audit_logs ORDER BY sequence_id').all(), [{ id: 'a', reason: null }, { id: 'b', reason: 'Fixture reason' }, { id: 'c', reason: null }]);
  });
  await test('late invalid column rolls back earlier batches', async db => {
    const data = prepared(); data.rows.login_audit_logs = audits(101); data.rows.login_audit_logs[100].unapproved_column = 'fixture';
    await assert.rejects(() => importer.importRows(db, data), /INVALID_IMPORT_COLUMN/);
    await empty(db);
  });
  await test('duplicate in second batch rolls back all earlier rows', async db => {
    const data = prepared(); data.rows.login_audit_logs = audits(101); data.rows.login_audit_logs[100].id = 'audit-0';
    await assert.rejects(() => importer.importRows(db, data), error => error.code === '23505');
    await empty(db);
  });
  await test('foreign-key failure rolls back roles permissions and invalid grant', async db => {
    const data = prepared(); data.rows.roles = [{ id: 'fixture-role', code: 'FIXTURE', name: 'Fixture', default_path: '/' }];
    data.rows.role_permissions = [{ role_id: 'fixture-role', permission_id: 'missing' }];
    await assert.rejects(() => importer.importRows(db, data), error => error.code === '23503');
    await empty(db);
  });
  await test('late sequence update failure rolls back imported data', async db => {
    const data = prepared(); data.rows.login_audit_logs = audits(101); const raw = db.exec.bind(db);
    db.exec = async sql => { if (sql.includes('setval')) throw Error('INJECTED_SEQUENCE_FAILURE'); return raw(sql); };
    await assert.rejects(() => importer.importRows(db, data), /INJECTED_SEQUENCE_FAILURE/);
    await empty(db);
  });
  await test('nonempty target is refused without overwriting existing data', async db => {
    await db.prepare('INSERT INTO roles(id,code,name,default_path) VALUES (?,?,?,?)').run('existing', 'EXISTING', 'Existing', '/');
    const before = await db.prepare('SELECT * FROM roles').all();
    await assert.rejects(() => importer.importRows(db, prepared()), /IMPORT_REQUIRES_EMPTY_DATABASE/);
    assert.deepEqual(await db.prepare('SELECT * FROM roles').all(), before);
  });
  console.log('IMPORT_BATCH_RESULT ' + JSON.stringify({ passed, failed: 0, provider: 'PGlite' }));
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
