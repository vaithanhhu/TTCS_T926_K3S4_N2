const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const directory = path.join(root, '.local');
const databasePath = path.join(directory, 'ats-demo.db');
const markerPath = path.join(directory, 'ats-demo.json');
const flags = ['APPROVAL_CONFIGURATION_ENABLED', 'REQUISITION_APPROVAL_ENABLED', 'HEADCOUNT_BUDGET_ENABLED', 'REQUISITION_OPERATIONS_ENABLED', 'REQUISITION_LIFECYCLE_ENABLED', 'REQUISITION_TRACKING_ENABLED', 'JOB_POSTING_DRAFTS_ENABLED', 'JOB_POSTING_PUBLICATION_ENABLED'];

function configureLocalDemo() {
  const port = Number(process.env.ATS_LOCAL_PORT || 5050);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LOCAL_PORT_INVALID');
  for (const key of Object.keys(process.env)) {
    if (/^(DATABASE_|DB_|PG|SMTP_|MAIL_|EMAIL_|GOOGLE_|APPROVAL_|REQUISITION_|HEADCOUNT_|JOB_POSTING_)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, { ATS_LOCAL_DEMO: 'true', NODE_ENV: 'development', DB_PROVIDER: 'sqlite', DB_PATH: databasePath, EMAIL_MODE: 'simulated', PORT: String(port), APP_URL: 'http://localhost:' + port });
  for (const flag of flags) process.env[flag] = 'true';
  return { root, directory, databasePath, markerPath, port, flags };
}

function checkLocalPath() {
  const folder = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (folder && (!folder.isDirectory() || folder.isSymbolicLink())) throw new Error('LOCAL_DIRECTORY_UNSAFE');
  for (const file of [databasePath, markerPath, markerPath + '.tmp']) {
    const entry = fs.lstatSync(file, { throwIfNoEntry: false });
    if (entry && (!entry.isFile() || entry.isSymbolicLink())) throw new Error('LOCAL_FILE_UNSAFE');
  }
}

function readMarker() {
  checkLocalPath();
  if (!fs.existsSync(markerPath)) return null;
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.profile !== 'ats-local-demo-v1' || marker.database !== 'ats-demo.db' || !['initializing', 'ready'].includes(marker.state)) throw new Error('LOCAL_MARKER_INVALID');
  return marker;
}

module.exports = { configureLocalDemo, checkLocalPath, readMarker, root, directory, databasePath, markerPath, flags };
