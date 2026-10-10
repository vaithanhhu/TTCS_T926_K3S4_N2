const fs = require('node:fs');
const path = require('node:path');
const local = require('../config/local-demo');
const profile = local.configureLocalDemo();
const migrations = ['migrate-approval-configurations', 'migrate-requisition-approvals', 'migrate-headcount-budgets', 'migrate-requisition-operations', 'migrate-requisition-lifecycle', 'migrate-requisition-tracking-job-drafts', 'migrate-job-publication'];

async function setupLocal() {
  local.checkLocalPath();
  let marker = local.readMarker();
  if (fs.existsSync(profile.databasePath) && !marker) throw new Error('LOCAL_DATABASE_NOT_OWNED');
  if (marker?.state === 'ready' && !fs.existsSync(profile.databasePath)) throw new Error('LOCAL_DATABASE_MISSING');
  if (!marker) {
    fs.mkdirSync(profile.directory, { recursive: true });
    marker = { profile: 'ats-local-demo-v1', database: 'ats-demo.db', state: 'initializing', createdAt: new Date().toISOString() };
    fs.writeFileSync(profile.markerPath, JSON.stringify(marker, null, 2), { flag: 'wx' });
  }
  const cfg = require('../config/config');
  if (cfg.DB_PROVIDER !== 'sqlite' || cfg.DB_PATH !== profile.databasePath || cfg.EMAIL_MODE !== 'simulated') throw new Error('LOCAL_CONFIGURATION_UNSAFE');
  const lockPath = path.join(profile.directory, 'setup.lock');
  const lock = fs.openSync(lockPath, 'wx');
  let db;
  try {
    db = require('./database').getDatabase();
    if (marker.state === 'initializing' && !(await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n) await db.transaction(() => require('./seed').seedDatabase(db));
    for (const file of migrations) await require('./' + file).migrate(db);
    if (marker.state !== 'ready') {
      const demo = await db.transaction(() => require('./seed-local-demo').seedLocalDemo(db));
      marker = { ...marker, state: 'ready', completedAt: new Date().toISOString(), demo };
      fs.writeFileSync(profile.markerPath + '.tmp', JSON.stringify(marker, null, 2));
      fs.renameSync(profile.markerPath + '.tmp', profile.markerPath);
    }
    for (const file of migrations) await require('./' + file).verify(db);
    if ((await db.prepare('PRAGMA foreign_key_check').all()).length) throw new Error('LOCAL_FOREIGN_KEYS_INVALID');
    const users = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
    console.log('LOCAL_SETUP_RESULT ' + JSON.stringify({ success: true, provider: 'sqlite', database: path.relative(profile.root, profile.databasePath), users, schema: 'Sprint1-3 verified', email: 'simulated', flags: profile.flags, demo: marker.demo }));
    return marker;
  } finally {
    if (db) await db.close();
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}
if (require.main === module) setupLocal().catch(error => { console.error('[Local setup]', error.code || error.message); process.exitCode = 1; });
module.exports = { setupLocal };
