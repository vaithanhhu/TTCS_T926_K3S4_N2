const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/config');

/**
 * Migration runner: Creates all required tables from scratch if not exists.
 * Tables:
 * 1. roles
 * 2. permissions
 * 3. role_permissions
 * 4. users
 * 5. user_roles
 * 6. sessions
 * 7. login_audit_logs
 * 8. password_reset_tokens
 */
function runMigrations(customPath) {
  const dbPath = customPath || config.DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  console.log(`[Migration] Running migrations on: ${dbPath}`);

  db.exec(`
    -- 1. ROLES TABLE
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      default_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 2. PERMISSIONS TABLE (S1-05 RBAC Matrix)
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. ROLE_PERMISSIONS TABLE (S1-05 Many-to-Many RBAC Mapping)
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (role_id, permission_id)
    );

    -- 4. USERS TABLE
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
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 5. USER_ROLES TABLE
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_id)
    );

    -- 6. SESSIONS TABLE
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 7. LOGIN_AUDIT_LOGS TABLE
    CREATE TABLE IF NOT EXISTS login_audit_logs (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      ip_address TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. PASSWORD_RESET_TOKENS TABLE
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8.1 OTPS TABLE (6-digit random numeric OTP verification)
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

    -- 9. REQUISITIONS TABLE (S1-10 AC-03 Handover Warning & Assignment)
    CREATE TABLE IF NOT EXISTS requisitions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
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

    -- 10. EMAIL_LOGS TABLE (Real Transactional Email Auditing)
    CREATE TABLE IF NOT EXISTS email_logs (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_name TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 11. CANDIDATES TABLE
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

    -- 12. INTERVIEWS TABLE
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

    -- 13. OFFERS TABLE
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

    -- INDEXES FOR PERFORMANCE & LOOKUP CONSTRAINTS
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

  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))');
  }

  const interviewCols = db.prepare('PRAGMA table_info(interviews)').all().map(column => column.name);
  if (!interviewCols.includes('candidate_response_status')) {
    db.exec("ALTER TABLE interviews ADD COLUMN candidate_response_status TEXT DEFAULT 'PENDING'");
  }
  if (!interviewCols.includes('candidate_response_note')) {
    db.exec("ALTER TABLE interviews ADD COLUMN candidate_response_note TEXT");
  }
  if (!interviewCols.includes('candidate_responded_at')) {
    db.exec("ALTER TABLE interviews ADD COLUMN candidate_responded_at TEXT");
  }
  if (!interviewCols.includes('cancellation_reason')) {
    db.exec("ALTER TABLE interviews ADD COLUMN cancellation_reason TEXT");
  }
  if (!interviewCols.includes('cancelled_at')) {
    db.exec("ALTER TABLE interviews ADD COLUMN cancelled_at TEXT");
  }
  if (!interviewCols.includes('rescheduled_at')) {
    db.exec("ALTER TABLE interviews ADD COLUMN rescheduled_at TEXT");
  }
  if (!interviewCols.includes('reschedule_reason')) {
    db.exec("ALTER TABLE interviews ADD COLUMN reschedule_reason TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS interview_invitation_tokens (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invitation_tokens_hash ON interview_invitation_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitation_tokens_interview ON interview_invitation_tokens(interview_id);

    CREATE TABLE IF NOT EXISTS interview_evaluations (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_title_id TEXT REFERENCES job_titles(id) ON DELETE SET NULL,
      framework_id TEXT REFERENCES competency_frameworks(id) ON DELETE SET NULL,
      template_name TEXT NOT NULL,
      snapshot_criteria TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'REOPENED')),
      recommendation TEXT CHECK (recommendation IS NULL OR recommendation IN ('RECOMMENDED', 'CONSIDER', 'NOT_RECOMMENDED')),
      general_notes TEXT,
      total_score REAL,
      submitted_at TEXT,
      reopened_at TEXT,
      reopened_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reopen_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(interview_id, interviewer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interview ON interview_evaluations(interview_id);
    CREATE INDEX IF NOT EXISTS idx_interview_evaluations_interviewer ON interview_evaluations(interviewer_id);
    CREATE INDEX IF NOT EXISTS idx_interview_evaluations_status ON interview_evaluations(status);

    CREATE TABLE IF NOT EXISTS interview_evaluation_items (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL REFERENCES interview_evaluations(id) ON DELETE CASCADE,
      criterion_id TEXT NOT NULL,
      criterion_name TEXT NOT NULL,
      weight INTEGER NOT NULL,
      score INTEGER CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
      comment TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(evaluation_id, criterion_id)
    );
    CREATE INDEX IF NOT EXISTS idx_evaluation_items_eval ON interview_evaluation_items(evaluation_id);

    CREATE TABLE IF NOT EXISTS interview_asked_questions (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES interview_questions(id) ON DELETE CASCADE,
      asked_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(interview_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_asked_questions_interview ON interview_asked_questions(interview_id);
    CREATE INDEX IF NOT EXISTS idx_asked_questions_question ON interview_asked_questions(question_id);
  `);
  console.log('[Migration] All tables and indexes migrated successfully.');
  return db;
}

if (require.main === module) {
  runMigrations();
}

module.exports = {
  runMigrations
};
