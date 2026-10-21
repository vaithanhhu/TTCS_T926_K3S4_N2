'use strict';
// The working checkout is read only. All application execution uses fresh copies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '../../..');
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^(ATS_|DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_|CANDIDATE_|NODE_OPTIONS$)/.test(k)) delete env[k];
}
Object.assign(env, { NODE_ENV: 'test', DB_PROVIDER: 'sqlite', EMAIL_MODE: 'simulated', ATS_LOCAL_DEMO: 'true' });
const benchmark = process.argv.includes('--benchmark');
const scripts = benchmark ? ['performance/benchmark_sla_p0.cjs'] : [
  'test_sla_batch_parity.js', 'test_sla_batch_http.js', 'test_sla_security.js',
  'test_s5_10_sla_notification.js', 'test_s5_05_candidate_search.js', 'test_rbac_admin.js',
  'test_private_feature_auth.js', 'test_requisition_access.js', 'test_e2e213_reports.js',
  'test_candidate_merge.js', 'test_s7_08_onboarding.js', 'test_authenticated_feature_lifecycle.js', 'test_frontend_routing.js'
];
const results = [];
for (const script of scripts) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-p0-isolated-'));
  for (const folder of ['backend', 'frontend']) {
    const base = path.join(source, folder);
    fs.cpSync(base, path.join(copy, folder), { recursive: true, filter: p =>
      !path.relative(base, p).split(path.sep).some(x => ['data', 'node_modules', '.env', '.local', 'uploads', '.git'].includes(x)) });
  }
  for (const file of ['package.json', 'package-lock.json', 'README.md']) fs.copyFileSync(path.join(source, file), path.join(copy, file));
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const args = ['--preserve-symlinks', path.join(copy, 'backend/tests', script)];
  if (script === 'test_sla_batch_parity.js') args.push('--require-batch');
  const result = spawnSync(process.execPath, args, { cwd: copy, env, encoding: 'utf8', windowsHide: true,
    timeout: benchmark ? 900000 : 180000, maxBuffer: 16 * 1024 * 1024 });
  const log = String(result.stdout || '') + String(result.stderr || '');
  fs.writeFileSync(path.join(copy, 'result.log'), log);
  const summary = { script, exitCode: result.status, signal: result.signal, errorCode: result.error?.code,
    summary: log.split(/\r?\n/).filter(l => /PASS|FAIL|RESULT|COMPLETE|Error|SLA_READS/.test(l)).slice(-15) };
  results.push(summary);
  console.log(JSON.stringify({ ...summary, isolatedCopy: copy }));
  if (benchmark && result.status === 0) {
    const output = path.join(source, 'reports/p0-performance-2026-10-22');
    fs.mkdirSync(output, { recursive: true });
    fs.copyFileSync(path.join(copy, 'benchmark-results.json'), path.join(output, 'benchmark-current.json'));
  }
}
const output = path.join(source, 'reports/p0-performance-2026-10-22');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, benchmark ? 'benchmark-run-current.json' : 'regression-current.json'), JSON.stringify(results, null, 2));
if (results.some(r => r.exitCode !== 0)) process.exitCode = 1;
