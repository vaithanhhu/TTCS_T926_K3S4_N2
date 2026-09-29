const path = require('node:path');

module.exports = {
  PORT: process.env.PORT || 5050,
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'ats.db'),
  LOCK_TIME_MINUTES: 15,
  MAX_FAILED_ATTEMPTS: 5,
  SESSION_TTL_MINUTES: 30,
  PASSWORD_RESET_TTL_MINUTES: 30,
  STATIC_DIR: path.join(__dirname, '..', '..', '..', 'frontend')
};
