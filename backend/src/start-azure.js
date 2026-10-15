const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspace = path.resolve(__dirname, '../..');
const profileDirectory = process.env.ATS_AZURE_PROFILE_DIR || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ATS', 'AzureStaging'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return Boolean(pid); } catch { return false; } };
let ownedRun = null;
let monitor = null;
let stopping = false;
let control;
let statePath;

function state() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
}

function command(op, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [control, op, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errorOutput += chunk; });
    child.once('error', () => reject(Error('AZURE_PROFILE_CONTROL_UNAVAILABLE')));
    child.once('close', code => {
      if (code !== 0) {
        const detail = errorOutput.trim().split(/\r?\n/).pop()?.trim();
        const codeMatch = detail && /^[A-Z0-9_]+$/.test(detail) ? detail : null;
        return reject(Error(codeMatch || ('AZURE_PROFILE_COMMAND_FAILED_' + op.toUpperCase())));
      }
      try { resolve(JSON.parse(output)); } catch { reject(Error('AZURE_PROFILE_RESPONSE_INVALID')); }
    });
  });
}

async function stopOwned() {
  if (ownedRun && state()?.runId === ownedRun && alive(state()?.managerPid)) await command('stop');
}

async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(monitor);
  try { await stopOwned(); process.exit(0); } catch { process.exit(1); }
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw Error('AZURE_DEVELOPMENT_LAUNCHER_NOT_FOR_PRODUCTION');
  if (!profileDirectory) throw Error('AZURE_PROFILE_MISSING');
  control = path.join(profileDirectory, 'control.js');
  statePath = path.join(profileDirectory, 'state.json');
  const profilePath = path.join(profileDirectory, 'profile.json');
  if (!fs.existsSync(control) || !fs.existsSync(profilePath)) throw Error('AZURE_PROFILE_MISSING');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (path.resolve(profile.workspace).toLowerCase() !== workspace.toLowerCase()) throw Error('AZURE_PROFILE_WORKSPACE_MISMATCH');
  if (profile.database !== 'ats_migration_validation_7cd908a1' || profile.testDatabase !== 'ats_migration_validation_9ed91916' || profile.httpPort !== 5051) throw Error('AZURE_PROFILE_TARGET_MISMATCH');
  for (const file of [profile.secretFile, profile.caFile, profile.ssh?.keyPath]) {
    if (!file || !path.isAbsolute(file) || !fs.existsSync(file)) throw Error('AZURE_PROFILE_RESOURCE_MISSING');
    const relative = path.relative(workspace, fs.realpathSync(file));
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw Error('AZURE_SECRET_RESOURCE_IN_REPOSITORY');
  }
  const operation = process.argv.includes('--stop') ? 'stop' : process.argv.includes('--status') ? 'status' : process.argv.includes('--test') ? 'test' : 'start';
  if (operation !== 'start') {
    const result = await command(operation === 'test' ? (state()?.mode === 'fixture' ? 'fixtureSmoke' : 'smoke') : operation);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const readOnly = process.argv.includes('--read-only');
  const mode = readOnly ? 'readonly' : 'fixture';
  const target = readOnly ? profile.database : profile.testDatabase;
  const before = state();
  const reused = Boolean(before && alive(before.managerPid) && !['FAILED', 'STOPPED'].includes(before.status));
  if (reused && (before.mode !== mode || before.tunnelOnly || before.httpPort !== 5051)) throw Error('AZURE_PROFILE_ALREADY_RUNNING_STOP_BEFORE_SWITCH');
  try {
    await command('start', readOnly ? [] : ['--fixture']);
    if (!reused) ownedRun = state()?.runId;
    for (let i = 0; i < 1000; i++) {
      const current = state();
      if (!current || !alive(current.managerPid) || ['FAILED', 'STOPPED'].includes(current.status)) throw Error('AZURE_UNAVAILABLE_NO_DATABASE_FALLBACK');
      if (current.mode !== mode || current.database !== target || current.httpPort !== 5051) throw Error('AZURE_RUNNING_TARGET_MISMATCH');
      if (current.status === 'READY') break;
      if (i === 999) throw Error('AZURE_STARTUP_TIMEOUT');
      await delay(500);
    }
    const result = await command('identity');
    const identity = result.value;
    if (!result.ok || identity?.database !== target || identity.provider !== 'postgres' || !identity.certificateVerified || !identity.ssl || identity.read_only !== (readOnly ? 'on' : 'off')) throw Error('AZURE_CONNECTION_VERIFICATION_FAILED');
    console.log('AZURE_ATS_READY ' + JSON.stringify({ database: target, url: 'http://127.0.0.1:5051/login', provider: identity.provider, version: identity.version, tls: identity.tls, readOnly, reused }));
    monitor = setInterval(() => {
      const current = state();
      if (!current || !alive(current.managerPid) || ['FAILED', 'STOPPED'].includes(current.status)) {
        console.error('AZURE_UNAVAILABLE_NO_DATABASE_FALLBACK');
        clearInterval(monitor);
        process.exitCode = 1;
      }
    }, 2000);
  } catch (error) {
    if (!reused) ownedRun = state()?.runId;
    await stopOwned().catch(() => {});
    throw error;
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
main().catch(error => {
  console.error(/^[A-Z0-9_]+$/.test(error.message) ? error.message : 'AZURE_STARTUP_FAILED_CHECK_PRIVATE_PROFILE');
  process.exitCode = 1;
});
