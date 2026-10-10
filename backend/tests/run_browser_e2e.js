const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (/^(ATS_POSTGRES_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|NODE_OPTIONS$)/.test(key)) delete environment[key];
}
Object.assign(environment, { NODE_ENV: 'test', DB_PROVIDER: 'sqlite', EMAIL_MODE: 'simulated' });
const artifacts = process.env.ATS_E2E_ARTIFACTS
  ? path.resolve(process.env.ATS_E2E_ARTIFACTS)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'ats-browser-e2e-evidence-'));
environment.ATS_E2E_ARTIFACTS = artifacts;

async function execute(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: environment, windowsHide: true, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', resolve);
  });
}

async function main() {
  const isolated = !fs.existsSync(path.join(source, '.git')) && !fs.existsSync(path.join(source, '.env'));
  const root = isolated ? source : fs.mkdtempSync(path.join(os.tmpdir(), 'ats-browser-e2e-source-'));
  if (!isolated) {
    for (const directory of ['backend', 'frontend']) {
      fs.cpSync(path.join(source, directory), path.join(root, directory), { recursive: true, filter(file) {
        const relative = path.relative(path.join(source, directory), file);
        return !relative.split(path.sep).some(part => ['node_modules', '.git', 'data', '.env'].includes(part))
          && !path.basename(file).startsWith('.env')
          && !(directory === 'frontend' && /^public[\\/](avatars|company)([\\/]|$)/.test(relative));
      } });
    }
    for (const file of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, file), path.join(root, file));
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!fs.existsSync(npm)) throw new Error('NPM_CLI_NOT_FOUND');
    const installed = await execute([npm, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], root);
    if (installed !== 0) throw new Error('ISOLATED_DEPENDENCY_INSTALL_FAILED');
  }
  for (const file of ['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm', 'backend/data/ats.db-wal', 'backend/data/ats_test.db']) {
    if (fs.existsSync(path.join(root, file))) throw new Error('FRESH_ISOLATED_SOURCE_REQUIRED');
  }
  console.log('BROWSER_E2E_ENVIRONMENT ' + JSON.stringify({ provider: 'sqlite', isolated: true, email: 'simulated', artifacts }));
  process.exitCode = await execute(['backend/tests/test_browser_e2e.js'], root);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
