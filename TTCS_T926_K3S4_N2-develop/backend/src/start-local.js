const fs = require('node:fs');
const local = require('./config/local-demo');
const profile = local.configureLocalDemo();

async function startLocal() {
  const marker = local.readMarker();
  if (!marker || marker.state !== 'ready' || !fs.existsSync(profile.databasePath)) throw new Error('LOCAL_SETUP_REQUIRED: run npm run setup:local');
  const cfg = require('./config/config');
  if (cfg.DB_PROVIDER !== 'sqlite' || cfg.DB_PATH !== profile.databasePath || cfg.EMAIL_MODE !== 'simulated') throw new Error('LOCAL_CONFIGURATION_UNSAFE');
  const { startServer, server } = require('./server');
  server.on('error', async error => { console.error('[Local server]', error.code || 'START_FAILED'); await require('./db/database').getDatabase().close(); process.exitCode = 1; });
  await startServer(profile.port, '127.0.0.1');
  console.log('LOCAL_SERVER_READY ' + JSON.stringify({ url: 'http://localhost:' + profile.port, provider: 'sqlite', email: 'simulated', flags: profile.flags }));
}
startLocal().catch(error => { console.error('[Local startup]', error.code || error.message); process.exitCode = 1; });
