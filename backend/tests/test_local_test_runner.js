const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(__dirname, 'run_local_tests.js'), 'utf8');
const manifest = require(path.join(root, 'package.json'));
const results = [];

function fixture(api, executable, cli, requested) {
  const calls = [];
  const sandbox = {
    require: name => name === 'node:fs' ? {
      existsSync: candidate => candidate === cli,
      mkdtempSync: () => '/isolated/tests', mkdirSync() {}, copyFileSync() {},
      readFileSync: () => '', writeFileSync() {}
    } : name === 'node:path' ? api : name === 'node:os' ? { tmpdir: () => '/tmp' }
      : name === 'node:child_process' ? { spawn() { throw Error('Unexpected subprocess'); } } : manifest,
    __dirname: api.dirname(executable),
    process: { execPath: executable, argv: [executable, 'runner', ...requested], env: {}, platform: 'linux' },
    console: { log() {}, error() {} }, setTimeout, clearTimeout,
    capture: args => calls.push(Array.from(args))
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/main\(\)\.catch\([\s\S]*$/, '') + '\nglobalThis.run = main; globalThis.resolvedNpm = npm;', sandbox);
  vm.runInContext('copySource = () => {}; linkDependencies = () => {}; execute = async args => { capture(args); return {exitCode:0, durationMs:0, log:"fixture.log"}; };', sandbox);
  return { sandbox, calls };
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
  console.log('LOCAL_RUNNER_RESULT ' + JSON.stringify({ passed: results.length, failed: 0, results }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
