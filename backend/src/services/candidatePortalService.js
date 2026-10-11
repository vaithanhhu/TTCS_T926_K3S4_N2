const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config/config');
const { EmailService } = require('./emailService');
const Rbac = require('../middlewares/rbacMiddleware');
const Requisitions = require('./requisitionService');
const pdfParse = require('pdf-parse');

const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'cv_uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

class CandidatePortalService {
  constructor(db) {
    this.db = db;
    this.emailService = new EmailService(db);
    this.requisitions = new Requisitions(db);
    this.rbac = new Rbac(db);
    ensureUploadsDir();
  }

}

module.exports = CandidatePortalService;
