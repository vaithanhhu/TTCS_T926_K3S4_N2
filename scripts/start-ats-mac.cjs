'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '..');
let runtimeDatabase;

function fail(code) { throw new Error(code); }
function configure(args) {
  const env = process.env;
  if (args.some(a => !['--check', '--check-db'].includes(a)) || args.length > 1) fail('USAGE: bash scripts/start-ats-mac.sh [--check|--check-db]');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) fail('NODE_22_13_OR_NEWER_REQUIRED');
  // The existing loader preserves exported environment variables over file values.
  env.ATS_ENV_FILE = path.resolve(env.ATS_ENV_FILE || path.join(root, '.env.mac'));
  if (env.ATS_LOCAL_DEMO === 'true') fail('USE_START_LOCAL_FOR_SQLITE_DEMO');
  if (fs.existsSync(env.ATS_ENV_FILE) && !fs.statSync(env.ATS_ENV_FILE).isFile()) fail('ENV_FILE_NOT_A_REGULAR_FILE');
  if (fs.existsSync(env.ATS_ENV_FILE)) process.loadEnvFile(env.ATS_ENV_FILE);
  if (env.ATS_LOCAL_DEMO === 'true') fail('USE_START_LOCAL_FOR_SQLITE_DEMO');
  env.NODE_ENV ||= 'development';
  env.DB_PROVIDER ||= 'postgres';
  env.PG_SSL_MODE ||= 'verify';
  env.PORT ||= '5050';
  env.APP_URL ||= 'http://127.0.0.1:' + env.PORT;
  const config = require('../backend/src/config/config');
  if (config.DB_PROVIDER !== 'postgres' || !config.DATABASE_URL) fail('POSTGRES_DATABASE_URL_REQUIRED_NO_SQLITE_FALLBACK');
  let url;
  try { url = new URL(config.DATABASE_URL); } catch { fail('INVALID_DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) fail('INVALID_DATABASE_URL');
  if (!['verify', 'disable', 'url'].includes(config.PG_SSL_MODE)) fail('INVALID_PG_SSL_MODE');
  if (config.PG_SSL_MODE === 'verify' && [...url.searchParams.keys()].some(k => /^ssl/i.test(k))) fail('USE_PG_SSL_MODE_WITHOUT_URL_SSL_OVERRIDES');
  if (!/^\d+$/.test(env.PORT) || !Number.isInteger(config.PORT) || config.PORT < 1 || config.PORT > 65535) fail('INVALID_PORT');
  let app;
  try { app = new URL(config.APP_URL); } catch { fail('INVALID_APP_URL'); }
  if (app.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(app.hostname) || Number(app.port || 80) !== config.PORT || app.username || app.password || app.search || app.hash || app.pathname !== '/') fail('APP_URL_MUST_MATCH_LOOPBACK_PORT');
  if (env.NODE_EXTRA_CA_CERTS && !fs.statSync(env.NODE_EXTRA_CA_CERTS, { throwIfNoEntry: false })?.isFile()) fail('CA_FILE_NOT_FOUND');
  for (const file of ['frontend/index.html', 'frontend/routes.json', 'backend/src/server.js']) {
    if (!fs.existsSync(path.join(root, file))) fail('APPLICATION_FILES_MISSING');
  }
  for (const name of Object.keys(require('../package.json').dependencies)) {
    try { require.resolve(name, { paths: [root] }); } catch { fail('DEPENDENCIES_MISSING_RUN_NPM_CI'); }
  }
  // Loading these validates the installed native binary for this Node/CPU/OS.
  try { require('sharp'); require('node:sqlite'); } catch { fail('NATIVE_DEPENDENCY_UNAVAILABLE_REINSTALL_ON_THIS_MACHINE'); }
  return config;
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('LOCAL_PORT_UNAVAILABLE')));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function checkDatabase(config) {
  // A separate, bounded, SELECT-only probe; does not load server/services/migrations.
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 5000, query_timeout: 5000,
    options: '-c default_transaction_read_only=on',
    ...(config.PG_SSL_MODE === 'verify' ? { ssl: { rejectUnauthorized: true } } : config.PG_SSL_MODE === 'disable' ? { ssl: false } : {}) });
  try { await pool.query('SELECT 1 AS ok'); } finally { await pool.end(); }
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: bash scripts/start-ats-mac.sh [--check|--check-db]\nDefault: start existing ATS server on loopback. --check: no DB connection. --check-db: SELECT-only connection probe. Env file: ATS_ENV_FILE or project/.env.mac.');
    return;
  }
  const config = configure(args);
  await checkPort(config.PORT);
  if (args[0] === '--check-db') await checkDatabase(config);
  if (args.length) {
    console.log(args[0] === '--check-db' ? 'MAC_DATABASE_CHECK_OK' : 'MAC_CONFIG_CHECK_OK');
    return;
  }
  runtimeDatabase = require('../backend/src/db/database').getDatabase();
  const { startServer, server } = require('../backend/src/server');
  server.on('error', async error => {
    console.error(error.code === 'EADDRINUSE' ? 'LOCAL_PORT_UNAVAILABLE' : 'MAC_SERVER_ERROR');
    await require('../backend/src/db/database').getDatabase().close();
    process.exitCode = 1;
  });
  await startServer(config.PORT, '127.0.0.1');
  console.log('MAC_ATS_READY ' + config.APP_URL.replace(/\/$/, '') + '/login');
}

module.exports = { configure, checkPort, checkDatabase, main };
if (require.main === module) main().catch(async error => {
  // Never echo URLs, credentials, .env content, SQL parameters or server messages.
  console.error(error.message?.startsWith('USAGE:') ? error.message : /^[A-Z][A-Z0-9_]+$/.test(error.message || '') ? error.message : 'MAC_START_FAILED_CHECK_CONFIGURATION');
  if (runtimeDatabase) await runtimeDatabase.close().catch(() => {});
  process.exitCode = 1;
});
