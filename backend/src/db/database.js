const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/config');

let dbInstance = null;

function getDatabase(customPath) {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = customPath || config.DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA journal_mode = WAL;');

  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      job_title TEXT,
      department_id TEXT,
      department_name TEXT,
      phone_number TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      lock_reason TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
      manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competency_frameworks (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competency_criteria (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL
        REFERENCES competency_frameworks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      weight INTEGER NOT NULL
        CHECK (weight > 0 AND weight <= 100),
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_titles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      framework_id TEXT
        REFERENCES competency_frameworks(id) ON DELETE RESTRICT,
      level TEXT,
      min_salary INTEGER CHECK (min_salary IS NULL OR min_salary >= 0),
      max_salary INTEGER CHECK (max_salary IS NULL OR max_salary >= min_salary),
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_competency_criteria_framework
      ON competency_criteria(framework_id);

    CREATE INDEX IF NOT EXISTS idx_job_titles_framework
      ON job_titles(framework_id);

    CREATE INDEX IF NOT EXISTS idx_job_titles_status
      ON job_titles(status);
    CREATE TABLE IF NOT EXISTS interview_questions (
      id TEXT PRIMARY KEY,
      criterion_id TEXT NOT NULL
        REFERENCES competency_criteria(id) ON DELETE RESTRICT,
      question_text TEXT NOT NULL,
      difficulty TEXT NOT NULL
        CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
      good_answer_hint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_interview_questions_criterion
      ON interview_questions(criterion_id);

    CREATE INDEX IF NOT EXISTS idx_interview_questions_difficulty
      ON interview_questions(difficulty);

    CREATE INDEX IF NOT EXISTS idx_interview_questions_status
      ON interview_questions(status);
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_audit_logs (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      ip_address TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'PASSWORD_RESET',
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_otps_email ON otps(email);

    CREATE TABLE IF NOT EXISTS recruitment_catalog_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL
        CHECK (type IN ('CANDIDATE_SOURCE', 'REJECTION_REASON', 'WORK_LOCATION', 'WORK_MODE')),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, code)
    );
    CREATE TABLE IF NOT EXISTS career_page_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      introduction TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      hero_image_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      job_title_id TEXT REFERENCES job_titles(id) ON DELETE RESTRICT,
      department_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
      work_location_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT,
      work_mode_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT,
      department_name TEXT NOT NULL,
      hiring_manager_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      recruiter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      headcount INTEGER NOT NULL DEFAULT 1,
      handover_required INTEGER NOT NULL DEFAULT 0,
      handover_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
      stage TEXT NOT NULL DEFAULT 'NEW',
      experience_years INTEGER NOT NULL DEFAULT 1,
      current_company TEXT,
      expected_salary TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
      requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
      interviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      round_name TEXT NOT NULL DEFAULT 'Phỏng vấn chuyên môn',
      scheduled_time TEXT NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      feedback TEXT,
      score INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
      requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
      salary_monthly INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
      approver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(code);
    CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_audit_email ON login_audit_logs(email);
    CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_requisitions_recruiter ON requisitions(recruiter_id);
    CREATE INDEX IF NOT EXISTS idx_requisitions_hiring_mgr ON requisitions(hiring_manager_id);
    CREATE INDEX IF NOT EXISTS idx_requisitions_status ON requisitions(status);
    CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient);
    CREATE INDEX IF NOT EXISTS idx_candidates_requisition ON candidates(requisition_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
    CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_interviews_interviewer ON interviews(interviewer_id);
    CREATE INDEX IF NOT EXISTS idx_offers_candidate ON offers(candidate_id);
  `);

  // Additive migration: existing job titles remain valid with unspecified salary.
  const jobTitleColumns = db.prepare('PRAGMA table_info(job_titles)').all();
  for (const [name, definition] of [
    ['level', 'TEXT'],
    ['min_salary', 'INTEGER CHECK (min_salary IS NULL OR min_salary >= 0)'],
    ['max_salary', 'INTEGER CHECK (max_salary IS NULL OR max_salary >= min_salary)']
  ]) {
    if (!jobTitleColumns.some(column => column.name === name)) {
      db.exec(`ALTER TABLE job_titles ADD COLUMN ${name} ${definition}`);
    }
  }

  const requisitionColumns = db.prepare('PRAGMA table_info(requisitions)').all();
  // S2-10: additive fields; legacy requisitions keep their existing behavior.
  for (const [name, definition] of [
    ['s210_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['created_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL'],
    ['recruitment_reason', "TEXT CHECK (recruitment_reason IS NULL OR recruitment_reason IN ('REPLACEMENT', 'NEW_HEADCOUNT'))"],
    ['proposed_salary_min', 'REAL CHECK (proposed_salary_min IS NULL OR proposed_salary_min >= 0)'],
    ['proposed_salary_max', 'REAL CHECK (proposed_salary_max IS NULL OR (proposed_salary_max >= 0 AND proposed_salary_max >= proposed_salary_min))'],
    ['needed_date', 'TEXT'],
    ['job_description', 'TEXT'],
    ['candidate_requirements', 'TEXT'],
    ['salary_justification', 'TEXT']
  ]) {
    if (!requisitionColumns.some(column => column.name === name)) {
      db.exec(`ALTER TABLE requisitions ADD COLUMN ${name} ${definition}`);
    }
  }
  const hasDepartmentId = requisitionColumns.some(column => column.name === 'department_id');
  const hasJobTitleId = requisitionColumns.some(column => column.name === 'job_title_id');
  const hasWorkLocationId = requisitionColumns.some(column => column.name === 'work_location_id');
  const hasWorkModeId = requisitionColumns.some(column => column.name === 'work_mode_id');

  const candidateColumns = db.prepare('PRAGMA table_info(candidates)').all();
  const hasCandidateSourceId = candidateColumns.some(column => column.name === 'source_id');
  const hasRejectionReasonId = candidateColumns.some(column => column.name === 'rejection_reason_id');

  if (!hasDepartmentId) {
    db.exec(`
      ALTER TABLE requisitions
      ADD COLUMN department_id TEXT REFERENCES departments(id) ON DELETE RESTRICT;
    `);
  }

  if (!hasJobTitleId) {
    db.exec(`
      ALTER TABLE requisitions
      ADD COLUMN job_title_id TEXT REFERENCES job_titles(id) ON DELETE RESTRICT;
    `);
  }

  if (!hasWorkLocationId) {
    db.exec(`
      ALTER TABLE requisitions
      ADD COLUMN work_location_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT;
    `);
  }

  if (!hasWorkModeId) {
    db.exec(`
      ALTER TABLE requisitions
      ADD COLUMN work_mode_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT;
    `);
  }

  if (!hasCandidateSourceId) {
    db.exec(`
      ALTER TABLE candidates
      ADD COLUMN source_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT;
    `);
  }

  if (!hasRejectionReasonId) {
    db.exec(`
      ALTER TABLE candidates
      ADD COLUMN rejection_reason_id TEXT REFERENCES recruitment_catalog_items(id) ON DELETE RESTRICT;
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_id);
    CREATE INDEX IF NOT EXISTS idx_departments_manager ON departments(manager_id);
    CREATE INDEX IF NOT EXISTS idx_departments_status ON departments(status);
    CREATE INDEX IF NOT EXISTS idx_requisitions_department ON requisitions(department_id);
    CREATE INDEX IF NOT EXISTS idx_requisitions_job_title ON requisitions(job_title_id);
    CREATE INDEX IF NOT EXISTS idx_recruitment_catalog_type_order
      ON recruitment_catalog_items(type, display_order);
    CREATE INDEX IF NOT EXISTS idx_requisitions_work_location
      ON requisitions(work_location_id);
    CREATE INDEX IF NOT EXISTS idx_requisitions_work_mode
      ON requisitions(work_mode_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_source
      ON candidates(source_id);
    CREATE INDEX IF NOT EXISTS idx_candidates_rejection_reason
      ON candidates(rejection_reason_id);
  `);
}

module.exports = {
  getDatabase
};
