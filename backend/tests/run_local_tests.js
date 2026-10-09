const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const manifest = require(path.join(source, 'package.json'));
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (/^(ATS_POSTGRES_|ATS_LOCAL_|ATS_E2E_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|NODE_OPTIONS$)/.test(key)) delete environment[key];
}
Object.assign(environment, { NODE_ENV: 'test', DB_PROVIDER: 'sqlite', EMAIL_MODE: 'simulated' });
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-local-regression-'));

function copySource(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const folder of ['backend', 'frontend']) fs.cpSync(path.join(source, folder), path.join(root, folder), {
    recursive: true, filter(file) {
      const relative = path.relative(path.join(source, folder), file);
      return !relative.split(path.sep).some(part => ['data', 'node_modules', '.git', '.local'].includes(part))
        && !path.basename(file).startsWith('.env')
        && !(folder === 'frontend' && /^public[\\/](avatars|company)([\\/]|$)/.test(relative));
    }
  });
  for (const file of ['package.json', 'package-lock.json', 'README.md', '.env.example']) fs.copyFileSync(path.join(source, file), path.join(root, file));
}

function linkDependencies(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const original = path.join(from, entry.name), target = path.join(to, entry.name);
    if (entry.isDirectory()) linkDependencies(original, target);
    else if (entry.isSymbolicLink()) fs.copyFileSync(original, target);
    else fs.linkSync(original, target);
  }
}

async function execute(args, cwd, log, env = environment) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(log);
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    const timeout = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    }, 600000);
    child.on('error', error => { clearTimeout(timeout); output.end(); reject(error); });
    child.on('close', code => { clearTimeout(timeout); output.end(() => resolve({ exitCode: code, durationMs: Date.now() - started, log })); });
  });
}

async function main() {
  const requested = process.argv.slice(2);
  const available = Object.keys(manifest.scripts).filter(name => name.startsWith('test:') && !['test:local', 'test:postgres:live', 'test:s3-10:pg-live'].includes(name));
  const scripts = requested.includes('--all') ? available : requested.length ? requested : ['test:local-demo', 'test:sprint1', 'test:sprint2', 'test:s2-10', ...available.filter(name => /^test:s3-\d\d$/.test(name))];
  if (!fs.existsSync(npm) || scripts.some(name => !available.includes(name))) throw new Error('INVALID_LOCAL_TEST_COMMAND');
  const cache = path.join(directory, 'dependencies');
  fs.mkdirSync(cache);
  for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, file), path.join(cache, file));
  const installed = await execute([npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cache, path.join(directory, 'install.log'));
  if (installed.exitCode !== 0) throw new Error('LOCAL_TEST_DEPENDENCY_INSTALL_FAILED: ' + installed.log);
  const results = [];
  for (const script of scripts) {
    const name = script.replaceAll(':', '-'), root = path.join(directory, name);
    copySource(root);
    linkDependencies(path.join(cache, 'node_modules'), path.join(root, 'node_modules'));
    const env = { ...environment, ATS_E2E_ARTIFACTS: path.join(directory, name + '-browser') };
    console.log('LOCAL_TEST_START ' + script);
    const result = await execute([npm, 'run', script], root, path.join(directory, name + '.log'), env);
    const output = fs.readFileSync(result.log, 'utf8');
    const summaries = output.split(/\r?\n/).filter(line => /_RESULT |BROWSER_E2E_RESULT |passed|failed|KẾT QUẢ|Tổng.*[0-9]/i.test(line));
    results.push({ script, ...result, summaries });
    console.log('LOCAL_TEST_RESULT ' + JSON.stringify({ script, exitCode: result.exitCode, durationMs: result.durationMs, log: result.log }));
  }
  const report = { provider: 'isolated SQLite and embedded PostgreSQL only', email: 'simulated', directory, results, livePostgres: 'NOT RUN: use an explicitly isolated PostgreSQL environment', aggregateNote: 'test:sprint1 repeats individual S1 suites; execution counts are not unique test counts' };
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log('LOCAL_TEST_REPORT ' + path.join(directory, 'results.json'));
  process.exitCode = results.some(row => row.exitCode !== 0) ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
