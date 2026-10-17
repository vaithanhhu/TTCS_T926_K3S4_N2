const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(__dirname, 'run_local_tests.js'), 'utf8');
const manifest = require(path.join(root, 'package.json'));
const results = [];

function fixture(api, executable, cli, requested, logs = {}) {
  const calls = [];
  const fsMock = {
    existsSync: candidate => candidate === cli,
    mkdtempSync: () => '/isolated/tests', mkdirSync() {}, copyFileSync() {},
    readFileSync: file => logs[file] !== undefined ? logs[file] : '', writeFileSync() {}
  };
  const sandbox = {
    require: name => name === 'node:fs' ? fsMock : name === 'node:path' ? api : name === 'node:os' ? { tmpdir: () => '/tmp' }
      : name === 'node:child_process' ? { spawn() { throw Error('Unexpected subprocess'); } } : manifest,
    __dirname: api.dirname(executable),
    process: { execPath: executable, argv: [executable, 'runner', ...requested], env: {}, platform: 'linux' },
    console: { log() {}, error() {} }, Buffer, setTimeout, clearTimeout,
    capture: args => calls.push(Array.from(args))
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/main\(\)\.catch\([\s\S]*$/, '') + '\nglobalThis.run = main; globalThis.resolvedNpm = npm;', sandbox);
  vm.runInContext('copySource = () => {}; linkDependencies = () => {}; execute = async args => { capture(args); return {exitCode:0, durationMs:0, log:"fixture.log"}; };', sandbox);
  return { sandbox, calls, fsMock };
}

async function test(name, action) {
  await action();
  results.push({ name, status: 'PASS' });
}

async function main() {
  for (const [name, api, executable, cli] of [
    ['Windows', path.win32, 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'],
    ['Actions Ubuntu', path.posix, '/opt/hostedtoolcache/node/24/x64/bin/node', '/opt/hostedtoolcache/node/24/x64/lib/node_modules/npm/bin/npm-cli.js'],
    ['macOS', path.posix, '/opt/homebrew/bin/node', '/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js'],
    ['alternate prefix', path.posix, '/usr/local/bin/node', '/usr/local/node_modules/npm/bin/npm-cli.js']
  ]) await test(name + ' resolves npm and preserves --all selection', async () => {
    const f = fixture(api, executable, cli, ['--all']);
    assert.equal(f.sandbox.resolvedNpm, cli);
    await f.sandbox.run();
    const excluded = ['test:local', 'test:azure', 'test:postgres:live', 'test:s3-10:pg-live', 'test:qa-s3-06:pg-live', 'test:qa-s3-batch:pg-live'];
    const expected = Object.keys(manifest.scripts).filter(name => name.startsWith('test:') && !excluded.includes(name));
    assert.deepEqual(f.calls.slice(1).map(args => args[2]), expected);
    assert.equal(f.calls[0][1], 'ci');
    assert.ok(f.calls.every(args => args[0] === cli));
    assert.equal(f.sandbox.process.exitCode, 0);
  });
  await test('invalid script fails before dependency installation', async () => {
    const f = fixture(path.posix, '/usr/bin/node', '/usr/lib/node_modules/npm/bin/npm-cli.js', ['test:missing']);
    await assert.rejects(f.sandbox.run(), /INVALID_LOCAL_TEST_COMMAND/);
    assert.equal(f.calls.length, 0);
  });
  await test('missing npm fails before dependency installation', async () => {
    const f = fixture(path.posix, '/usr/bin/node', '/missing/npm-cli.js', ['--all']);
    await assert.rejects(f.sandbox.run(), /INVALID_LOCAL_TEST_COMMAND/);
    assert.equal(f.calls.length, 0);
  });
  await test('DOM insertion preserves order and moves existing nodes without duplicates', () => {
    const helper = fs.readFileSync(path.join(__dirname, 'helpers/frontendRuntime.js'), 'utf8');
    const sandbox = { queueMicrotask, errors: [], document: {} };
    vm.createContext(sandbox);
    vm.runInContext(helper.slice(helper.indexOf('  const observers ='), helper.indexOf('  function parse(source) {')) + '\nglobalThis.createNode = node; globalThis.Observer = MutationObserver;', sandbox);
    const parent = sandbox.createNode(), a = sandbox.createNode(), b = sandbox.createNode();
    assert.equal(parent.firstChild, null);
    parent.insertBefore(a, null);
    parent.insertBefore(b, a);
    assert.equal(parent.firstChild, b);
    parent.insertBefore(b, null);
    assert.equal(parent.children[1], b);
    assert.equal(parent.children.length, 2);
    assert.throws(() => parent.insertBefore(a, sandbox.createNode()), /Reference node is not a child/);
    const other = sandbox.createNode();
    other.prepend(a);
    assert.equal(parent.children.length, 1);
    assert.equal(a.parentNode, other);
  });
  await test('DOM observer delivers filtered mutations asynchronously and disconnects', async () => {
    const helper = fs.readFileSync(path.join(__dirname, 'helpers/frontendRuntime.js'), 'utf8');
    const sandbox = { queueMicrotask, errors: [], document: {} };
    vm.createContext(sandbox);
    vm.runInContext(helper.slice(helper.indexOf('  const observers ='), helper.indexOf('  function parse(source) {')) + '\nglobalThis.createNode = node; globalThis.Observer = MutationObserver;', sandbox);
    const target = sandbox.createNode(), received = [];
    const observer = new sandbox.Observer(records => received.push(...records));
    observer.observe(target, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    target.setAttribute('data-ignored', 'value');
    target.classList.add('hidden');
    assert.equal(received.length, 0);
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(received.length, 1);
    assert.equal(received[0].target, target);
    assert.equal(received[0].attributeName, 'class');
    assert.equal(received[0].oldValue, null);
    target.classList.remove('hidden');
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(received[1].oldValue, 'hidden');
    observer.disconnect();
    target.classList.add('hidden');
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(received.length, 2);
    assert.equal(sandbox.errors.length, 0);
  });
  await test('legacy fixture supports insertion and real asynchronous attribute observation', async () => {
    const create = () => {
      const classes = new Set();
      return {children:[],getAttribute:()=>'',setAttribute(){},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}};
    };
    const element = create(), document = {getElementById:()=>element,createElement:create};
    const {MutationObserver} = require('./helpers/frontendFixture').domCompatibility(document);
    const target = document.getElementById('fixture'), child = document.createElement('div'), received = [];
    target.prepend(child);
    assert.equal(target.firstChild, child);
    const table=document.createElement('table'),section=document.createElement('section');
    table.prepend(target);
    assert.equal(table.closest('table'),table);
    assert.equal(child.closest('table'),table);
    assert.equal(child.closest('section'),null);
    section.prepend(child);
    assert.equal(child.closest('table'),null);
    assert.equal(child.closest('section'),section);
    assert.equal(document.createElement('div').closest('table'),null);
    const observer = new MutationObserver(records => received.push(...records));
    observer.observe(target,{attributes:true,attributeFilter:['class'],attributeOldValue:true});
    target.setAttribute('data-ignored','value');
    target.classList.add('hidden');
    assert.equal(received.length,0);
    await Promise.resolve();
    assert.equal(received.length,1);
    assert.equal(received[0].target,target);
    target.classList.remove('hidden');
    await Promise.resolve();
    assert.equal(received[1].oldValue,'hidden');
    observer.disconnect();
    target.classList.add('hidden');
    await Promise.resolve();
    assert.equal(received.length,2);
  });
  await test('frontend/routes.json and package.json remain valid without conflict markers or missing files', () => {
    for (const relative of ['frontend/routes.json', 'package.json']) {
      const text = fs.readFileSync(path.join(root, relative), 'utf8');
      assert.equal(/^(<{7}|={7}|>{7})/m.test(text), false, relative);
      JSON.parse(text);
    }
    const routes = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));
    for (const key of ['scripts', 'fragments']) {
      assert.ok(Array.isArray(routes[key]), key);
      assert.equal(new Set(routes[key]).size, routes[key].length, key);
      for (const entry of routes[key]) {
        assert.equal(fs.existsSync(path.join(root, 'frontend', entry.replace(/^\//, ''))), true, entry);
      }
    }
  });
  await test('runner reports sanitized and bounded failure snippet on test failure and sets exitCode 1', async () => {
    const errorLogs = [];
    const keyTag = ['PRIVATE', 'KEY'].join(' ');
    const beginRsa = ['-----', 'BEGIN ', 'RSA ', keyTag, '-----'].join('');
    const endRsa = ['-----', 'END ', 'RSA ', keyTag, '-----'].join('');
    const dbPass = ['super', 'Secret', 'Pass123'].join('');
    const dbUrl = ['postgres', 'ql://admin:', dbPass, '@postgres-server:5432/ats_db'].join('');
    const ghTok = ['gh', 'p_', '1234567890'.repeat(3)].join('');
    const queryTok = ['secret', 'QueryToken123'].join('');
    const queryKey = ['secret', 'QueryApiKey456'].join('');
    const basicToken = ['YWRtaW46', 'c2VjcmV0MTIz'].join('');
    const confPass = ['Confidential', 'Pass'].join('');
    const confApiKey = ['Confidential', 'ApiKey'].join('');
    const escPass = ['escaped', 'SecretPass999'].join('');
    const csVal = ['cs', 'Val789'].join('');
    const sensitiveLog = [
      'Starting test suite...',
      ...Array.from({ length: 150 }, (_, i) => `log line ${i + 1}`),
      'Connecting ' + dbUrl,
      'API call: https://api.ats.local/interviews?token=' + queryTok + '&apiKey=' + queryKey,
      'Headers: Authorization: Basic ' + basicToken,
      'Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
      'Config: ' + JSON.stringify({ [['pass', 'word'].join('')]: confPass, [['api', 'Key'].join('')]: confApiKey }),
      'Payload: ' + JSON.stringify(JSON.stringify({ [['pass', 'word'].join('')]: escPass, [['client', 'Secret'].join('')]: csVal })),
      'Token: ' + ghTok,
      beginRsa,
      'MIIEowIBAAKCAQEA0Y1...',
      endRsa,
      'AssertionError [ERR_ASSERTION]: Expected 200, got 500',
      '    at test.js:42:1'
    ].join('\n');
    const f = fixture(path.posix, '/usr/bin/node', '/usr/lib/node_modules/npm/bin/npm-cli.js', ['test:sprint1'], {
      'fixture.log': sensitiveLog
    });
    f.sandbox.console.error = msg => errorLogs.push(msg);
    vm.runInContext(`
      execute = async args => {
        capture(args);
        if (args[1] === 'run') return { exitCode: 1, durationMs: 40, log: 'fixture.log' };
        return { exitCode: 0, durationMs: 20, log: 'install.log' };
      };
    `, f.sandbox);
    await f.sandbox.run();
    assert.equal(f.sandbox.process.exitCode, 1);
    assert.equal(errorLogs.length >= 1, true);
    const failureOutput = errorLogs.join('\n');
    assert.ok(failureOutput.includes('LOCAL_TEST_FAILURE: test:sprint1 (exitCode: 1)'));
    assert.ok(failureOutput.includes('[... log truncated; showing tail ...]'));
    assert.ok(failureOutput.includes('AssertionError [ERR_ASSERTION]: Expected 200, got 500'));
    assert.ok(!failureOutput.includes(dbPass));
    assert.ok(failureOutput.includes(['postgres', 'ql://admin:[REDACTED]@postgres-server:5432/ats_db'].join('')));
    assert.ok(!failureOutput.includes(queryTok));
    assert.ok(!failureOutput.includes(queryKey));
    assert.ok(failureOutput.includes('token=[REDACTED]'));
    assert.ok(failureOutput.includes('apiKey=[REDACTED]'));
    assert.ok(!failureOutput.includes(basicToken));
    assert.ok(failureOutput.includes('Authorization: Basic [REDACTED]'));
    assert.ok(!failureOutput.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token'));
    assert.ok(failureOutput.includes('Bearer [REDACTED]'));
    assert.ok(!failureOutput.includes(confPass));
    assert.ok(failureOutput.includes(['pass', 'word'].join('') + '":[REDACTED]'));
    assert.ok(!failureOutput.includes(escPass));
    assert.ok(!failureOutput.includes(csVal));
    assert.ok(!failureOutput.includes(ghTok));
    assert.ok(failureOutput.includes('[REDACTED_TOKEN]'));
    assert.ok(!failureOutput.includes('MIIEowIBAAKCAQEA0Y1'));
    assert.ok(failureOutput.includes('[REDACTED_PRIVATE_KEY]'));
    assert.ok(failureOutput.includes('--- END LOCAL_TEST_FAILURE: test:sprint1 ---'));
  });
  await test('runner preserves exitCode 0 and outputs no failure logs when all tests pass', async () => {
    const errorLogs = [];
    const f = fixture(path.posix, '/usr/bin/node', '/usr/lib/node_modules/npm/bin/npm-cli.js', ['test:sprint1']);
    f.sandbox.console.error = msg => errorLogs.push(msg);
    await f.sandbox.run();
    assert.equal(f.sandbox.process.exitCode, 0);
    assert.equal(errorLogs.length, 0);
  });
  await test('sanitizeLog masks query credentials, JSON secrets, and bounding preserves redactions', () => {
    const f = fixture(path.posix, '/usr/bin/node', '/usr/lib/node_modules/npm/bin/npm-cli.js', ['test:sprint1']);
    const sanitize = f.sandbox.sanitizeLog;
    const extract = f.sandbox.extractFailureSnippet;
    const keyTag = ['PRIVATE', 'KEY'].join(' ');
    const beginKey = ['-----', 'BEGIN ', keyTag, '-----'].join('');
    const endKey = ['-----', 'END ', keyTag, '-----'].join('');
    const paramSecret = ['secret', 'ParamToken'].join('');
    const sigVal = ['sig', 'HexVal'].join('');
    const jsonSecretPass = ['unhashed', 'Password999'].join('');
    const jsonSecretKey = ['secret', 'SecretKey'].join('');
    const basicCredential = ['dXNlcjpw', 'YXNzd29yZA=='].join('');
    const envPass = ['env', 'SecretValue888'].join('');
    const raw = [
      'GET https://ats.example.com/v1/jobs?token=' + paramSecret + '&signature=' + sigVal + '&visibleParam=keepMe',
      'Config: ' + JSON.stringify({ user: 'recruiter', [['pass', 'word'].join('')]: jsonSecretPass, [['client', 'Secret'].join('')]: jsonSecretKey }),
      'Headers: Authorization: Basic ' + basicCredential,
      'DB_PASSWORD=' + envPass,
      beginKey,
      'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...',
      endKey
    ].join('\n');
    const sanitized = sanitize(raw);
    assert.ok(!sanitized.includes(paramSecret));
    assert.ok(!sanitized.includes(sigVal));
    assert.ok(sanitized.includes('visibleParam=keepMe'));
    assert.ok(!sanitized.includes(jsonSecretPass));
    assert.ok(!sanitized.includes(jsonSecretKey));
    assert.ok(!sanitized.includes(basicCredential));
    assert.ok(!sanitized.includes(envPass));
    assert.ok(!sanitized.includes('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...'));
    assert.ok(sanitized.includes('[REDACTED_PRIVATE_KEY]'));
    for (const byteLimit of [50, 100, 200, 500]) {
      const bounded = extract(raw, 50, byteLimit);
      assert.ok(!bounded.includes(paramSecret));
      assert.ok(!bounded.includes(sigVal));
      assert.ok(!bounded.includes(jsonSecretPass));
      assert.ok(!bounded.includes(jsonSecretKey));
      assert.ok(!bounded.includes(basicCredential));
      assert.ok(!bounded.includes(envPass));
      assert.ok(!bounded.includes('MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...'));
    }
  });
  await test('extractFailureSnippet safely bounds multi-line, Unicode Vietnamese and extreme single-line logs', () => {
    const f = fixture(path.posix, '/usr/bin/node', '/usr/lib/node_modules/npm/bin/npm-cli.js', ['test:sprint1']);
    const extract = f.sandbox.extractFailureSnippet;
    const vnMultiLine = [
      'Bắt đầu kiểm thử...',
      ...Array.from({ length: 80 }, (_, i) => `Dòng ${i + 1}: Kiểm tra tiến trình phỏng vấn ứng viên thành công.`),
      'Lỗi nghiêm trọng: Không thể kết nối cơ sở dữ liệu PostgreSQL cục bộ!',
      'AssertionError [ERR_ASSERTION]: Kỳ vọng mã trạng thái 200 nhưng nhận được 500',
      '    at Object.testRun (backend/tests/test_s6_03.js:55:10)'
    ].join('\n');
    for (const limit of [100, 250, 600, 2048, 16384]) {
      const snippet = extract(vnMultiLine, 40, limit);
      const byteLen = Buffer.byteLength(snippet, 'utf8');
      assert.ok(byteLen <= limit);
      assert.ok(!snippet.includes('\uFFFD'));
      if (limit >= 250) {
        assert.ok(snippet.includes('AssertionError [ERR_ASSERTION]'));
        assert.ok(snippet.includes('backend/tests/test_s6_03.js'));
      }
    }
    const extremeSingleLine = 'Lỗi tiếng Việt không ngắt dòng: ' + 'dữ liệu cực dài kiểm tra UTF-8 an toàn '.repeat(500);
    for (const limit of [50, 120, 400, 1500]) {
      const snippet = extract(extremeSingleLine, 100, limit);
      const byteLen = Buffer.byteLength(snippet, 'utf8');
      assert.ok(byteLen <= limit);
      assert.ok(!snippet.includes('\uFFFD'));
    }
  });
  console.log('LOCAL_RUNNER_RESULT ' + JSON.stringify({ passed: results.length, failed: 0, results }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
