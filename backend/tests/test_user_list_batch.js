const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { PostgresDatabase, pgTypes } = require('../src/db/postgres');
const UserService = require('../src/services/userService');
const { test, finish } = cases('USER_LIST_BATCH');
const measurements = [];

async function reference(db, options) {
  const conditions = [], params = [];
  if (options.search) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.department_name LIKE ? OR u.job_title LIKE ?)');
    params.push(...Array(4).fill('%' + options.search.trim() + '%'));
  }
  if (options.role && options.role !== 'ALL') {
    conditions.push('EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND (r.code=? OR r.name=?))');
    params.push(options.role, options.role);
  }
  if (options.status && options.status !== 'ALL') {
    conditions.push('u.status=?');
    params.push(options.status);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const totalItems = (await db.prepare('SELECT COUNT(*) AS n FROM users u ' + where).get(...params)).n;
  const totalPages = Math.ceil(totalItems / options.limit) || 1;
  const rows = await db.prepare('SELECT u.* FROM users u ' + where + ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?').all(...params, options.limit, (options.page - 1) * options.limit);
  const roles = await db.prepare('SELECT ur.user_id,r.code,r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id ORDER BY r.code').all();
  const items = rows.map(user => {
    const assigned = roles.filter(role => role.user_id === user.id);
    return { id: user.id, email: user.email, fullName: user.full_name, jobTitle: user.job_title || '', departmentId: user.department_id || '', departmentName: user.department_name || '', phoneNumber: user.phone_number || '', status: user.status, lockReason: user.lock_reason || null, roles: assigned.map(role => role.code), roleNames: assigned.map(role => role.name), createdAt: user.created_at, updatedAt: user.updated_at };
  });
  return { success: true, data: { items, pagination: { totalItems, totalPages, currentPage: options.page, limit: options.limit, hasNextPage: options.page < totalPages, hasPrevPage: options.page > 1 } } };
}

async function verify(db, engine) {
  const users = new UserService(db);
  const hash = (await db.prepare("SELECT password_hash FROM users WHERE email='admin@company.com'").get()).password_hash;
  const roles = await db.prepare("SELECT id,code FROM roles WHERE code IN ('RECRUITER','HIRING_MGR','APPROVER') ORDER BY code DESC").all();
  const measure = async options => {
    const expected = await reference(db, options), original = db.prepare.bind(db), sqls = [];
    db.prepare = sql => {
      const statement = original(sql);
      return Object.fromEntries(['all', 'get', 'run'].map(key => [key, async (...args) => {
        sqls.push(sql.replace(/\s+/g, ' ').trim());
        return statement[key](...args);
      }]));
    };
    let actual;
    try { actual = await users.getUsers(options); } finally { db.prepare = original; }
    assert.deepEqual(actual, expected);
    assert.equal(sqls.length, actual.data.items.length ? 3 : 2);
    assert.equal(sqls.filter(sql => sql.includes('FROM roles r')).length, actual.data.items.length ? 1 : 0);
    measurements.push({ engine, options, rows: actual.data.items.length, queries: sqls.length });
  };
  for (const size of [0, 1, 20, 120]) {
    const prefix = 'batch-' + engine + '-' + size + '-';
    for (let n = 0; n < size; n++) {
      const id = prefix + n;
      await db.prepare('INSERT INTO users(id,email,full_name,password_hash,status,job_title,department_name,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, id + '@example.invalid', id, hash, n % 2 ? 'LOCKED' : 'ACTIVE', n % 3 ? 'Fixture job' : null, n % 3 ? 'Fixture department' : null, new Date(Date.UTC(2030, 0, 1, 0, 0, n)).toISOString());
      for (const role of n % 4 ? roles : []) await db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run(id, role.id);
    }
    await test(engine, 'batch count and complete contract', size + ' users', () => measure({ search: prefix, page: 1, limit: 200 }));
  }
  const prefix = 'batch-' + engine + '-120-';
  await test(engine, 'pagination', 'page2, last page, out-of-range page preserve count/order', async () => {
    for (const page of [1, 2, 6, 7]) await measure({ search: prefix, page, limit: 20 });
  });
  await test(engine, 'combined filters', 'search/status/role code or role name and multi-role order', async () => {
    for (const role of ['RECRUITER', 'APPROVER', (await db.prepare("SELECT name FROM roles WHERE code='RECRUITER'").get()).name, 'UNKNOWN_ROLE']) {
      await measure({ search: '  ' + prefix + '  ', status: 'ACTIVE', role, page: 1, limit: 20 });
    }
  });
  await test(engine, 'parameter safety', 'search SQL text cannot change the query', () => measure({ search: "' OR 1=1 --", role: 'ALL', status: 'ALL', page: 1, limit: 20 }));
  await test(engine, 'normalization', 'invalid page/limit retain defaults', async () => {
    assert.deepEqual(await users.getUsers({ page: 0, limit: -1 }), await users.getUsers({ page: 1, limit: 20 }));
  });
}

async function embedded() {
  const { PGlite } = require('@electric-sql/pglite'), engine = new PGlite();
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
    const address = process.env.ATS_POSTGRES_TEST_URL;
    assert.ok(address);
    const parsed = new URL(address);
    assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/ats_user_list_test');
    const root = path.resolve(__dirname, '../..');
    assert.equal(fs.existsSync(path.join(root, '.env')), false);
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    const db = new PostgresDatabase({ DATABASE_URL: address, PG_SSL_MODE: 'disable' });
    try {
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'").get()).n, 0);
      await initialize(db);
      await verify(db, 'PostgreSQL-real');
    } finally { await db.close(); }
  } else {
    const app = await openApplication();
    try { await verify(app.db, 'SQLite'); } finally { await app.close(); }
    const db = await embedded();
    try { await initialize(db); await verify(db, 'PGlite'); } finally { await db.close(); }
  }
  console.log('USER_LIST_QUERY_MEASUREMENTS ' + JSON.stringify(measurements));
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
