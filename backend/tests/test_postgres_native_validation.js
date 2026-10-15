const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const suites = {
  's3-01': ['test_s3_01_integration.js', 'databaseCases'],
  's3-02': ['test_s3_02_integration.js', 'cases'],
  's3-03': ['test_s3_03_04.js', 'trackingCases'],
  's3-04': ['test_s3_03_04.js', 'budgetCases'],
  's3-05': ['test_s3_05_06.js', 'copyCases'],
  's3-06': ['test_s3_05_06.js', 'assignmentCases'],
  's3-07': ['test_s3_07.js', 'lifecycleCases'],
  's3-08': ['test_s3_08_09.js', 'trackingCases'],
  's3-09': ['test_s3_08_09.js', 'jobCases'],
  reapproval: ['test_requisition_reapproval.js', 'cases']
};
function bridge(file, members) {
  const filename = path.join(__dirname, file), source = fs.readFileSync(filename, 'utf8');
  const marker = source.lastIndexOf('main().catch(');
  assert.ok(marker > 0, 'Explicit original test main boundary required');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(__dirname);
  compiled._compile(source.slice(0, marker) + 'module.exports={' + members + ',results:()=>({passed,failed,total:passed+failed})};', filename);
  return compiled.exports;
}
async function main() {
  for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats_test.db']) assert.equal(fs.existsSync(path.join(root, file)), false);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.EMAIL_MODE, 'simulated');
  const url = new URL(process.env.ATS_NATIVE_VALIDATION_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/ats_native_validation_[a-f0-9]{8}$/);
  process.env.DB_PROVIDER = 'postgres';
  process.env.DATABASE_URL = url.href;
  process.env.PG_SSL_MODE = 'disable';
  const config = require('../src/config/config');
  assert.equal(config.DB_PROVIDER, 'postgres');
  const db = require('../src/db/database').getDatabase();
  const close = db.close.bind(db);
  let closed = false;
  db.close = async () => { if (!closed) { closed = true; await close(); } };
  const identity = await db.prepare('SELECT version() AS version,current_database() AS name,host(inet_server_addr()) AS address').get();
  assert.match(identity.version, /PostgreSQL 16\./);
  assert.equal(identity.address, '127.0.0.1');
  assert.equal(identity.name, url.pathname.slice(1));
  assert.equal((await db.prepare("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'").get()).n, 0);
  await require('../src/db/migrate-postgres').migrate(db);
  await db.transaction(() => require('../src/db/seed').seedDatabase(db));
  const name = process.argv[2];
  console.log('NATIVE_VALIDATION_IDENTITY ' + JSON.stringify({version: identity.version, provider: db.provider, dataset: 'independent synthetic regression fixture, not imported source RBAC'}));
  if (suites[name]) {
    try {
      const [file, action] = suites[name], setup = /^s3-0[3-9]$/.test(name);
      const members = setup ? 'setup,' + action + (['s3-08','s3-09'].includes(name) ? ',prepare' : '') : action;
      const tests = bridge(file, members);
      if (setup) {
        const state = await tests.setup(db, 'Native PostgreSQL 16');
        if (tests.prepare) await tests.prepare(state);
        await tests[action](state, 'Native PostgreSQL 16');
      } else await tests[action](db, 'Native PostgreSQL 16');
      const result = tests.results();
      console.log('NATIVE_VALIDATION_RESULT ' + JSON.stringify({suite: name, ...result, provider: db.provider}));
      process.exitCode = result.failed ? 1 : 0;
    } finally { await db.close(); }
  } else if (name === 's4') {
    try { await require('./test_s4_candidate_portal').runSprint4Tests(); }
    finally { await db.close(); }
  } else if (name === 'browser') {
    const filename = path.join(__dirname, 'test_browser_e2e.js'), source = fs.readFileSync(filename, 'utf8');
    const guard = "assert.equal(config.DB_PROVIDER, 'sqlite');";
    assert.equal(source.split(guard).length, 2);
    const marker = source.lastIndexOf('main().catch(');
    assert.ok(marker > 0);
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(__dirname);
    compiled._compile(source.slice(0, marker).replace(guard, "assert.equal(config.DB_PROVIDER, 'postgres');") + 'module.exports={main};', filename);
    try { await compiled.exports.main(); } finally { await db.close(); }
  } else {
    assert.match(name, /^test_[a-z0-9_]+\.js$/);
    assert.ok(fs.existsSync(path.join(__dirname, name)));
    const filename = path.join(__dirname, name), compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(__dirname);
    process.mainModule = compiled;
    compiled._compile(fs.readFileSync(filename, 'utf8'), filename);
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
