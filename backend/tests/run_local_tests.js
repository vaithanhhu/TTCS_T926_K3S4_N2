const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const manifest = require(path.join(source, 'package.json'));
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (/^(ATS_POSTGRES_|ATS_LOCAL_|ATS_E2E_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_|NODE_OPTIONS$)/.test(key)) delete environment[key];
}
Object.assign(environment, { NODE_ENV: 'test', DB_PROVIDER: 'sqlite', EMAIL_MODE: 'simulated' });
const npmCandidates = [
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  path.resolve(path.dirname(process.execPath), '../node_modules/npm/bin/npm-cli.js')
];
const npm = npmCandidates.find(candidate => fs.existsSync(candidate));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-local-regression-'));

function copySource(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const folder of ['backend', 'frontend', 'scripts', '.githooks'].filter(folder => fs.existsSync(path.join(source, folder)))) fs.cpSync(path.join(source, folder), path.join(root, folder), {
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

function safeSliceUtf8Tail(str, maxBytes) {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(str, 'utf8');
    if (buf.length <= maxBytes) return str;
    let start = buf.length - maxBytes;
    while (start < buf.length && (buf[start] & 0xC0) === 0x80) {
      start++;
    }
    return buf.subarray(start).toString('utf8');
  }
  return str.slice(-maxBytes);
}

function sanitizeLog(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s\/]+):([^@\s\/]+)@/g, '$1$2:[REDACTED]@')
    .replace(/([?&](?:token|access_token|refresh_token|apiKey|api_key|client_secret|clientSecret|secret|password|passwd|pass|authToken|auth_token|sessionToken|session_token|signature|sig|private_key|privateKey|key)\s*=\s*)([^&\s#'"]+)/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g, '[REDACTED_TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]')
    .replace(/\b((?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/(\\?['"]?(?:password|passwd|secret|apiKey|api_key|clientSecret|client_secret|accessToken|access_token|refreshToken|refresh_token|privateKey|private_key|authToken|auth_token|sessionToken|session_token|signature)\\?['"]?\s*[:=]\s*)(?:(\\?['"])[^\r\n]*?\2|[^\s'",;\r\n}&]+)/gi, '$1[REDACTED]');
}

function extractFailureSnippet(rawText, maxLines = 100, maxBytes = 16384) {
  if (!rawText || !rawText.trim()) return '(empty log)';
  const sanitized = sanitizeLog(rawText.trim());
  const marker = '[... log truncated; showing tail ...]\n';
  const getByteLength = str => typeof Buffer !== 'undefined' ? Buffer.byteLength(str, 'utf8') : encodeURIComponent(str).replace(/%[A-F\d]{2}/gi, 'U').length;
  const totalBytes = getByteLength(sanitized);

  if (totalBytes <= maxBytes) {
    const lines = sanitized.split(/\r?\n/);
    if (lines.length <= maxLines) {
      return sanitized;
    }
    const tailLines = lines.slice(-maxLines).join('\n');
    const markerBytes = getByteLength(marker);
    if (markerBytes + getByteLength(tailLines) <= maxBytes) {
      return marker + tailLines;
    }
  }

  const markerBytes = getByteLength(marker);
  if (maxBytes <= markerBytes) {
    return safeSliceUtf8Tail(marker.trim(), maxBytes);
  }

  const allowedTailBytes = maxBytes - markerBytes;
  let tail = safeSliceUtf8Tail(sanitized, allowedTailBytes);
  const firstNewline = tail.indexOf('\n');
  if (firstNewline !== -1) {
    const candidate = tail.slice(firstNewline + 1);
    if (candidate.length > 0) {
      tail = candidate;
    }
  }
  return marker + tail;
}

async function main() {
  const requested = process.argv.slice(2);
  const available = Object.keys(manifest.scripts).filter(name => name.startsWith('test:') && !['test:local', 'test:azure', 'test:postgres:live', 'test:s3-10:pg-live', 'test:qa-s3-06:pg-live', 'test:qa-s3-batch:pg-live'].includes(name));
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
    if (result.exitCode !== 0) {
      console.error(`--- LOCAL_TEST_FAILURE: ${script} (exitCode: ${result.exitCode}) ---\n${extractFailureSnippet(output)}\n--- END LOCAL_TEST_FAILURE: ${script} ---`);
    }
  }
  const report = { provider: 'isolated SQLite and embedded PostgreSQL only', email: 'simulated', directory, results, livePostgres: 'NOT RUN: use an explicitly isolated PostgreSQL environment', aggregateNote: 'test:sprint1 repeats individual S1 suites; execution counts are not unique test counts' };
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2));
  console.log('LOCAL_TEST_REPORT ' + path.join(directory, 'results.json'));
  process.exitCode = results.some(row => row.exitCode !== 0) ? 1 : 0;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
