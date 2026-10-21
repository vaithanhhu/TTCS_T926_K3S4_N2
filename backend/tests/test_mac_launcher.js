// Execute only in a disposable source copy with npm ci; never against Azure.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
for (const file of ['.git', '.env', '.env.mac']) assert.equal(fs.existsSync(path.join(root, file)), false, 'Isolated copy required');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-mac-env with spaces-'));
const envFile = path.join(folder, 'settings.env');
const defaults = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://fixture@unreachable.invalid/fixture', DB_PROVIDER: 'postgres', PG_SSL_MODE: 'verify', PORT: '59437', APP_URL: 'http://127.0.0.1:59437', EMAIL_MODE: 'simulated' };
let passed = 0;
function environment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ATS_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|NODE_ENV$|NODE_OPTIONS$|PORT$|APP_URL$)/.test(key)) delete env[key];
  return { ...env, ...defaults, ATS_ENV_FILE: envFile, ...extra };
}
function child(args, extra = {}, expected = 0) {
  const r = spawnSync(process.execPath, args, { cwd: os.tmpdir(), env: environment(extra), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(r.status, expected, String(r.stdout) + String(r.stderr));
  assert.ok(!String(r.stdout + r.stderr).includes('fixture-sensitive-marker'), 'Sensitive input leaked');
  return String(r.stdout) + String(r.stderr);
}
async function test(name, action) { await action(); passed++; console.log('PASS ' + name); }

async function smoke() {
  // Uses the real shared PostgreSQL adapter with an injected in-memory engine.
  const { PGlite } = require('@electric-sql/pglite');
  const engine = new PGlite();
  const query = async (sql, params) => { const r = params === undefined ? (await engine.exec(sql)).at(-1) : await engine.query(sql, params); return { rows: r?.rows || [], rowCount: r?.affectedRows || 0 }; };
  const db = new (require('../src/db/postgres').PostgresDatabase)({}, { on() {}, query, async connect() { return { query, release() {} }; }, async end() { await engine.close(); } });
  const database = require('../src/db/database'), original = database.getDatabase;
  let server;
  try {
    await require('../src/db/migrate-postgres').migrate(db);
    await db.transaction(() => require('../src/db/seed').seedDatabase(db));
    await require('../src/db/migrate-requisition-open-policy').migrate(db);
    database.getDatabase = () => db;
    const launcher = require('../../scripts/start-ats-mac.cjs');
    await launcher.main([]);
    server = require('../src/server').server;
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const route of ['/login', '/routes.json', '/js/app.js', '/api/v1/health']) {
      const r = await fetch(base + route); assert.equal(r.status, 200, route); await r.text();
    }
    assert.equal((await fetch(base + '/api/v1/candidates?advanced=1')).status, 401);
    const login = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'hrmanager@company.com', password: 'Ats@123456' }) });
    assert.equal(login.status, 200);
    const token = (await login.json()).data.token;
    assert.equal((await fetch(base + '/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + token } })).status, 200);
    console.log('MAC_SHARED_SERVER_SMOKE_PASS');
  } finally {
    database.getDatabase = original;
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await db.close();
  }
}

async function main() {
  const script = path.join(root, 'scripts/start-ats-mac.cjs');
  await test('help does not need configuration', () => assert.match(child([script, '--help']), /Usage:/));
  await test('check validates config without importing DB or server', () => {
    const code = `require(${JSON.stringify(script)}).main(['--check']).then(()=>{if(Object.keys(require.cache).some(p=>/backend[\\/]src[\\/](server|db[\\/]database)\.js$/.test(p)))process.exit(9)});`;
    assert.match(child(['-e', code]), /MAC_CONFIG_CHECK_OK/);
  });
  await test('missing database never falls back to SQLite', () => assert.match(child([script, '--check'], { DATABASE_URL: '' }, 1), /POSTGRES_DATABASE_URL_REQUIRED/));
  await test('invalid URL is redacted', () => assert.match(child([script, '--check'], { DATABASE_URL: 'fixture-sensitive-marker' }, 1), /INVALID_DATABASE_URL/));
  await test('TLS URL overrides cannot bypass verify', () => assert.match(child([script, '--check'], { DATABASE_URL: 'postgresql://fixture@invalid/fixture?sslmode=require' }, 1), /WITHOUT_URL_SSL_OVERRIDES/));
  await test('bad port and mismatched browser origin rejected', () => {
    assert.match(child([script, '--check'], { PORT: '12x' }, 1), /INVALID_PORT/);
    assert.match(child([script, '--check'], { APP_URL: 'http://127.0.0.1:5051' }, 1), /APP_URL_MUST_MATCH/);
  });
  await test('env file path with spaces and exported values take precedence', () => {
    fs.writeFileSync(envFile, 'PORT=59436\nAPP_URL=http://127.0.0.1:59436\n');
    fs.writeFileSync(path.join(root, '.env'), 'PORT=not-a-port\nDATABASE_URL=fixture-sensitive-marker\n');
    try {
      const inspect = `const c=require(${JSON.stringify(script)}).configure(['--check']);require('assert/strict').equal(c.PORT,59436);`;
      child(['-e', inspect], { PORT: undefined, APP_URL: undefined });
      assert.match(child([script, '--check']), /MAC_CONFIG_CHECK_OK/);
    } finally { fs.unlinkSync(path.join(root, '.env')); }
  });
  await test('unsupported Node rejected before application startup', () => {
    const code = `Object.defineProperty(process.versions,'node',{value:'22.12.0'});require(${JSON.stringify(script)}).main(['--check']).catch(e=>{console.error(e.message);process.exitCode=1});`;
    assert.match(child(['-e', code], {}, 1), /NODE_22_13_OR_NEWER_REQUIRED/);
  });
  await test('Windows/default .env loader remains unchanged without ATS_ENV_FILE', () => {
    fs.writeFileSync(path.join(root, '.env'), 'PORT=59436\nDB_PROVIDER=sqlite\n');
    try {
      const env = environment(); delete env.ATS_ENV_FILE; delete env.PORT; delete env.DB_PROVIDER;
      const code = `const c=require(${JSON.stringify(path.join(root, 'backend/src/config/config.js'))});require('assert/strict').equal(c.PORT,59436);require('assert/strict').equal(c.DB_PROVIDER,'sqlite');`;
      const r = spawnSync(process.execPath, ['-e', code], { env, cwd: os.tmpdir(), encoding: 'utf8', timeout: 10000, windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
    } finally { fs.unlinkSync(path.join(root, '.env')); }
  });
  await test('busy localhost port rejected without DB access', async () => {
    const net = require('node:net'), socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = String(socket.address().port);
    try { assert.match(child([script, '--check'], { PORT: port, APP_URL: 'http://127.0.0.1:' + port }, 1), /LOCAL_PORT_UNAVAILABLE/); }
    finally { await new Promise(resolve => socket.close(resolve)); }
  });
  await test('DB probe is SELECT-only and has bounded timeouts', async () => {
    const pg = require('pg'), Original = pg.Pool; let ended = false;
    pg.Pool = class { constructor(options) { assert.equal(options.options, '-c default_transaction_read_only=on'); assert.equal(options.connectionTimeoutMillis, 5000); } async query(sql) { assert.equal(sql, 'SELECT 1 AS ok'); } async end() { ended = true; } };
    try { await require('../../scripts/start-ats-mac.cjs').checkDatabase({ DATABASE_URL: defaults.DATABASE_URL, PG_SSL_MODE: 'verify' }); assert.equal(ended, true); }
    finally { pg.Pool = Original; }
  });
  await test('real shared server, static UI and session smoke in PGlite', () => {
    assert.match(child([__filename, '--smoke'], { NODE_ENV: 'test' }), /MAC_SHARED_SERVER_SMOKE_PASS/);
  });
  console.log('MAC_LAUNCHER_RESULT ' + JSON.stringify({ passed, failed: 0, host: process.platform, macOSNative: 'NOT RUN' }));
}
(process.argv.includes('--smoke') ? smoke() : main()).catch(e => { console.error(e); process.exitCode = 1; });
