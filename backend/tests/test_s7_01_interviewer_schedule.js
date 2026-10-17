const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const RequisitionService = require('../src/services/requisitionService');

function createSqliteDb() {
  const db = new DatabaseSync(':memory:');
  db.provider = 'sqlite';
  const originalPrepare = db.prepare.bind(db);
  db.prepare = function (sql) {
    const stmt = originalPrepare(sql);
    return {
      run: (...params) => stmt.run(...params),
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params)
    };
  };
  let inTx = false;
  db.transaction = async function (fn) {
    if (inTx) return fn();
    inTx = true;
    db.exec('BEGIN TRANSACTION;');
    try {
      const res = await fn();
      db.exec('COMMIT;');
      return res;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    } finally {
      inTx = false;
    }
  };
  return db;
}

function bootstrapSqlite(db) {
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      must_change_password INTEGER DEFAULT 0,
      locked_until TEXT
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id),
      permission_id TEXT NOT NULL REFERENCES permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      department_id TEXT,
      department_name TEXT,
      job_title_id TEXT,
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT NOT NULL DEFAULT 'INTERVIEW',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE candidate_documents (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT,
      document_type TEXT NOT NULL DEFAULT 'CV',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT NOT NULL DEFAULT 'Vòng chuyên môn',
      scheduled_time TEXT NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      duration_minutes INTEGER DEFAULT 60,
      interview_format TEXT DEFAULT 'ONLINE',
      meeting_room TEXT,
      meeting_link TEXT,
      feedback TEXT,
      score INTEGER,
      cancellation_reason TEXT,
      cancelled_at TEXT,
      rescheduled_at TEXT,
      reschedule_reason TEXT,
      candidate_response_status TEXT DEFAULT 'PENDING',
      candidate_response_note TEXT,
      candidate_responded_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE TABLE interview_evaluations (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_name TEXT NOT NULL DEFAULT 'Standard',
      snapshot_criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      recommendation TEXT,
      total_score REAL,
      submitted_at TEXT,
      reopened_at TEXT,
      reopened_by TEXT,
      reopen_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(interview_id, interviewer_id)
    );
  `);
}

async function createPgliteDb() {
  const pg = new PGlite();
  let inTx = false;
  const db = {
    provider: 'postgres',
    raw: pg,
    async exec(sql) {
      await pg.exec(sql);
    },
    prepare(sql) {
      return {
        async run(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
          const res = await pg.query(pgSql, params);
          return { changes: res.affectedRows || 0 };
        },
        async get(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
          const res = await pg.query(pgSql, params);
          return res.rows[0];
        },
        async all(...params) {
          let pIdx = 0;
          const pgSql = sql.replace(/\?/g, () => `$${++pIdx}`);
          const res = await pg.query(pgSql, params);
          return res.rows;
        }
      };
    },
    async transaction(fn) {
      if (inTx) return fn();
      inTx = true;
      await pg.exec('BEGIN;');
      try {
        const res = await fn();
        await pg.exec('COMMIT;');
        return res;
      } catch (err) {
        try { await pg.exec('ROLLBACK;'); } catch {}
        throw err;
      } finally {
        inTx = false;
      }
    }
  };
  return db;
}

async function bootstrapPglite(db) {
  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      must_change_password BOOLEAN DEFAULT FALSE,
      locked_until TIMESTAMPTZ
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE user_roles (
      user_id TEXT NOT NULL REFERENCES users(id),
      role_id TEXT NOT NULL REFERENCES roles(id),
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      module TEXT NOT NULL
    );
    CREATE TABLE role_permissions (
      role_id TEXT NOT NULL REFERENCES roles(id),
      permission_id TEXT NOT NULL REFERENCES permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      department_id TEXT,
      department_name TEXT,
      job_title_id TEXT,
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT NOT NULL DEFAULT 'INTERVIEW',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE candidate_documents (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT,
      document_type TEXT NOT NULL DEFAULT 'CV',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT NOT NULL DEFAULT 'Vòng chuyên môn',
      scheduled_time TIMESTAMPTZ NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      duration_minutes INTEGER DEFAULT 60,
      interview_format TEXT DEFAULT 'ONLINE',
      meeting_room TEXT,
      meeting_link TEXT,
      feedback TEXT,
      score INTEGER,
      cancellation_reason TEXT,
      cancelled_at TIMESTAMPTZ,
      rescheduled_at TIMESTAMPTZ,
      reschedule_reason TEXT,
      candidate_response_status TEXT DEFAULT 'PENDING',
      candidate_response_note TEXT,
      candidate_responded_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE TABLE interview_evaluations (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      interviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_name TEXT NOT NULL DEFAULT 'Standard',
      snapshot_criteria TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      recommendation TEXT,
      total_score REAL,
      submitted_at TIMESTAMPTZ,
      reopened_at TIMESTAMPTZ,
      reopened_by TEXT,
      reopen_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(interview_id, interviewer_id)
    );
  `);
}

async function seedData(db) {
  await db.prepare("INSERT INTO roles (id, code, name) VALUES ('r-admin', 'ADMIN', 'Quản trị viên')").run();
  await db.prepare("INSERT INTO roles (id, code, name) VALUES ('r-int', 'INTERVIEWER', 'Người phỏng vấn')").run();

  await db.prepare("INSERT INTO permissions (id, code, name, module) VALUES ('p-int-read', 'interview.read', 'Xem lịch phỏng vấn', 'INTERVIEWS')").run();
  await db.prepare("INSERT INTO permissions (id, code, name, module) VALUES ('p-int-eval', 'interview.evaluate', 'Đánh giá phỏng vấn', 'INTERVIEWS')").run();
  await db.prepare("INSERT INTO permissions (id, code, name, module) VALUES ('p-cand-read', 'candidate.read', 'Xem ứng viên', 'CANDIDATES')").run();
  await db.prepare("INSERT INTO permissions (id, code, name, module) VALUES ('p-req-read', 'requisition.read', 'Xem yêu cầu', 'REQUISITIONS')").run();

  await db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES ('r-admin', 'p-int-read'), ('r-admin', 'p-int-eval'), ('r-admin', 'p-cand-read'), ('r-admin', 'p-req-read')").run();
  await db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES ('r-int', 'p-int-read'), ('r-int', 'p-int-eval'), ('r-int', 'p-cand-read'), ('r-int', 'p-req-read')").run();

  await db.prepare("INSERT INTO users (id, email, full_name, status) VALUES ('u-int1', 'int1@example.com', 'Phỏng vấn viên 1', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users (id, email, full_name, status) VALUES ('u-int2', 'int2@example.com', 'Phỏng vấn viên 2', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users (id, email, full_name, status) VALUES ('u-int3', 'int3@example.com', 'Phỏng vấn viên 3 (Chưa gán)', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users (id, email, full_name, status) VALUES ('u-admin', 'admin@example.com', 'Hệ thống Admin', 'ACTIVE')").run();

  await db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES ('u-int1', 'r-int'), ('u-int2', 'r-int'), ('u-int3', 'r-int'), ('u-admin', 'r-admin')").run();

  await db.prepare("INSERT INTO requisitions (id, code, title, status) VALUES ('req-1', 'REQ-001', 'Kỹ sư Backend Senior', 'OPEN')").run();

  await db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-1', 'Nguyễn Văn A', 'nguyenvana@gmail.com', '0901234567', 'req-1', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-2', 'Trần Thị B', 'tranthib@gmail.com', '0902345678', 'req-1', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO candidates (id, full_name, email, phone_number, requisition_id, stage) VALUES ('cand-3', 'Lê Văn C', 'levanc@gmail.com', '0903456789', 'req-1', 'INTERVIEW')").run();

  await db.prepare(`
    INSERT INTO candidate_documents (id, candidate_id, file_name, storage_path, mime_type, file_size, document_type)
    VALUES ('doc-cv-1', 'cand-1', 'nguyen_van_a_cv.pdf', 'candidates/cand-1/cv.pdf', 'application/pdf', 10240, 'CV')
  `).run();
  await db.prepare(`
    INSERT INTO candidate_documents (id, candidate_id, file_name, storage_path, mime_type, file_size, document_type)
    VALUES ('doc-cv-3', 'cand-3', 'le_van_c_cv.pdf', 'candidates/cand-3/cv.pdf', 'application/pdf', 12345, 'CV')
  `).run();

  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  await db.prepare(`
    INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, duration_minutes, interview_format, meeting_room, meeting_link)
    VALUES ('iv-1', 'cand-1', 'req-1', 'u-int1', 'Vòng 1 - Chuyên môn', ?, 'Google Meet Online', 'SCHEDULED', 60, 'ONLINE', NULL, 'https://meet.google.com/abc-defg-hij')
  `).run(tomorrow);

  await db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('iv-1', 'u-int1', 'PRIMARY'), ('iv-1', 'u-int2', 'INTERVIEWER')").run();

  await db.prepare(`
    INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, duration_minutes, interview_format, meeting_room, meeting_link)
    VALUES ('iv-2', 'cand-2', 'req-1', 'u-int2', 'Vòng 2 - Hội đồng', ?, 'Phòng họp 302', 'COMPLETED', 45, 'IN_PERSON', 'Phòng họp 302', NULL)
  `).run(yesterday);

  await db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('iv-2', 'u-int2', 'PRIMARY'), ('iv-2', 'u-int1', 'INTERVIEWER')").run();

  await db.prepare(`
    INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, duration_minutes, interview_format, cancellation_reason, cancelled_at)
    VALUES ('iv-3', 'cand-3', 'req-1', 'u-int2', 'Vòng 1 - Chuyên môn', ?, 'Google Meet Online', 'CANCELLED', 60, 'ONLINE', 'Ứng viên bận việc đột xuất', ?)
  `).run(tomorrow, new Date().toISOString());

  await db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('iv-3', 'u-int2', 'PRIMARY')").run();

  await db.prepare(`
    INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, location_or_link, status, duration_minutes, interview_format, rescheduled_at, reschedule_reason)
    VALUES ('iv-4', 'cand-3', 'req-1', 'u-int2', 'Vòng 1 - Dời lịch', ?, 'Google Meet Online', 'SCHEDULED', 60, 'ONLINE', ?, 'Dời sang tuần sau')
  `).run(nextWeek, new Date().toISOString());

  await db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('iv-4', 'u-int2', 'PRIMARY')").run();

  await db.prepare(`
    INSERT INTO interview_evaluations (id, interview_id, interviewer_id, status, total_score, submitted_at)
    VALUES ('eval-1-int1', 'iv-1', 'u-int1', 'SUBMITTED', 88.5, ?)
  `).run(new Date().toISOString());

  await db.prepare(`
    INSERT INTO interview_evaluations (id, interview_id, interviewer_id, status, total_score)
    VALUES ('eval-2-int1', 'iv-2', 'u-int1', 'REOPENED', NULL)
  `).run();

  await db.prepare(`
    INSERT INTO interview_evaluations (id, interview_id, interviewer_id, status, total_score, submitted_at)
    VALUES ('eval-2-int2', 'iv-2', 'u-int2', 'SUBMITTED', 92.0, ?)
  `).run(new Date().toISOString());
}

async function runTestSuite(db, label) {
  const service = new RequisitionService(db);

  const actorInt1 = { id: 'u-int1', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] };
  const actorInt2 = { id: 'u-int2', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] };
  const actorInt3 = { id: 'u-int3', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] };
  const actorAdmin = { id: 'u-admin', roles: ['ADMIN'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] };

  {
    const res = await service.getInterviews({ viewer: actorInt1, mySchedule: true });
    assert.equal(res.success, true);
    assert.equal(res.total, 2);
    const ids = res.interviews.map(i => i.id);
    assert.ok(ids.includes('iv-1'));
    assert.ok(ids.includes('iv-2'));
    assert.ok(!ids.includes('iv-3'));
    assert.ok(!ids.includes('iv-4'));

    const iv1 = res.interviews.find(i => i.id === 'iv-1');
    assert.equal(iv1.candidate.fullName, 'Nguyễn Văn A');
    assert.equal(iv1.requisition.title, 'Kỹ sư Backend Senior');
    assert.equal(iv1.cvDocumentId, 'doc-cv-1');
    assert.equal(iv1.cvFileName, 'nguyen_van_a_cv.pdf');
    assert.equal(iv1.cvUrl, '/api/v1/candidates/documents/doc-cv-1/download');
    assert.equal(iv1.candidate.cvDocumentId, 'doc-cv-1');
    assert.equal(iv1.isUpcoming, true);
    assert.equal(iv1.isCancelled, false);
    assert.equal(iv1.isRescheduled, false);

    const iv2 = res.interviews.find(i => i.id === 'iv-2');
    assert.equal(iv2.candidate.fullName, 'Trần Thị B');
    assert.equal(iv2.cvDocumentId, null);
    assert.equal(iv2.cvUrl, null);
    assert.equal(iv2.isUpcoming, false);
  }

  {
    const res = await service.getInterviews({ viewer: actorInt3, mySchedule: true });
    assert.equal(res.success, true);
    assert.equal(res.total, 0);
    assert.deepEqual(res.interviews, []);
  }

  {
    const res = await service.getInterviews({ viewer: actorInt1, mySchedule: false });
    assert.equal(res.success, true);
    assert.equal(res.total, 2);
    const ids = res.interviews.map(i => i.id);
    assert.ok(ids.includes('iv-1'));
    assert.ok(ids.includes('iv-2'));
    assert.ok(!ids.includes('iv-3'));
    assert.ok(!ids.includes('iv-4'));
  }

  {
    const res1 = await service.getInterviews({ viewer: actorInt1, mySchedule: true });
    const iv1ForInt1 = res1.interviews.find(i => i.id === 'iv-1');
    assert.equal(iv1ForInt1.evaluationStatus, 'SUBMITTED');
    assert.equal(iv1ForInt1.hasSubmittedEvaluation, true);
    assert.equal(iv1ForInt1.evaluationId, 'eval-1-int1');

    const iv2ForInt1 = res1.interviews.find(i => i.id === 'iv-2');
    assert.equal(iv2ForInt1.evaluationStatus, 'REOPENED');
    assert.equal(iv2ForInt1.hasSubmittedEvaluation, false);
    assert.equal(iv2ForInt1.evaluationId, 'eval-2-int1');

    const res2 = await service.getInterviews({ viewer: actorInt2, mySchedule: true });
    const iv1ForInt2 = res2.interviews.find(i => i.id === 'iv-1');
    assert.equal(iv1ForInt2.evaluationStatus, 'NOT_SUBMITTED');
    assert.equal(iv1ForInt2.hasSubmittedEvaluation, false);
    assert.equal(iv1ForInt2.evaluationId, null);

    const iv2ForInt2 = res2.interviews.find(i => i.id === 'iv-2');
    assert.equal(iv2ForInt2.evaluationStatus, 'SUBMITTED');
    assert.equal(iv2ForInt2.hasSubmittedEvaluation, true);
    assert.equal(iv2ForInt2.evaluationId, 'eval-2-int2');
  }

  {
    const resSub = await service.getInterviews({ viewer: actorInt1, mySchedule: true, evaluationStatus: 'SUBMITTED' });
    assert.equal(resSub.total, 1);
    assert.equal(resSub.interviews[0].id, 'iv-1');

    const resNotSub = await service.getInterviews({ viewer: actorInt1, mySchedule: true, evaluationStatus: 'NOT_SUBMITTED' });
    assert.equal(resNotSub.total, 1);
    assert.equal(resNotSub.interviews[0].id, 'iv-2');
  }

  {
    const res = await service.getInterviews({ viewer: actorInt2, mySchedule: true });
    assert.equal(res.total, 4);

    const iv3 = res.interviews.find(i => i.id === 'iv-3');
    assert.equal(iv3.status, 'CANCELLED');
    assert.equal(iv3.isCancelled, true);
    assert.equal(iv3.cancellationReason, 'Ứng viên bận việc đột xuất');

    const iv4 = res.interviews.find(i => i.id === 'iv-4');
    assert.equal(iv4.status, 'SCHEDULED');
    assert.equal(iv4.isRescheduled, true);
    assert.equal(iv4.rescheduleReason, 'Dời sang tuần sau');
    assert.ok(iv4.rescheduledAt !== null);

    const resUpcoming = await service.getInterviews({ viewer: actorInt2, mySchedule: true, timeframe: 'UPCOMING' });
    const upcomingIds = resUpcoming.interviews.map(i => i.id);
    assert.ok(upcomingIds.includes('iv-1'));
    assert.ok(upcomingIds.includes('iv-4'));
    assert.ok(!upcomingIds.includes('iv-2'));
    assert.ok(!upcomingIds.includes('iv-3'));

    const resPast = await service.getInterviews({ viewer: actorInt2, mySchedule: true, timeframe: 'PAST' });
    const pastIds = resPast.interviews.map(i => i.id);
    assert.ok(pastIds.includes('iv-2'));
    assert.ok(!pastIds.includes('iv-1'));
    assert.ok(!pastIds.includes('iv-4'));
  }

  {
    assert.equal(await service.canAccessCandidateCv('cand-1', actorInt1), true);
    assert.equal(await service.canAccessCandidateCv('cand-1', actorInt2), true);
    assert.equal(await service.canAccessCandidateCv('cand-1', actorInt3), false);
    assert.equal(await service.canAccessCandidateCv('cand-3', actorInt1), false);
    assert.equal(await service.canAccessCandidateCv('cand-3', actorInt2), true);
    assert.equal(await service.canAccessCandidateCv('cand-1', actorAdmin), true);
  }

  {
    const resAll = await service.getInterviews({ viewer: actorAdmin, mySchedule: false });
    assert.equal(resAll.total, 4);

    const resMine = await service.getInterviews({ viewer: actorAdmin, mySchedule: true });
    assert.equal(resMine.total, 0);
  }

  {
    const resAsc = await service.getInterviews({ viewer: actorInt2, mySchedule: true, sortOrder: 'ASC' });
    for (let i = 0; i < resAsc.interviews.length - 1; i++) {
      const t1 = new Date(resAsc.interviews[i].scheduledTime).getTime();
      const t2 = new Date(resAsc.interviews[i + 1].scheduledTime).getTime();
      assert.ok(t1 <= t2);
    }

    const resDesc = await service.getInterviews({ viewer: actorInt2, mySchedule: true, sortOrder: 'DESC' });
    for (let i = 0; i < resDesc.interviews.length - 1; i++) {
      const t1 = new Date(resDesc.interviews[i].scheduledTime).getTime();
      const t2 = new Date(resDesc.interviews[i + 1].scheduledTime).getTime();
      assert.ok(t1 >= t2);
    }
  }

  {
    const resSearch = await service.getInterviews({ viewer: actorInt1, mySchedule: true, search: 'Nguyễn Văn A' });
    assert.equal(resSearch.total, 1);
    assert.equal(resSearch.interviews[0].id, 'iv-1');
  }

  console.log(`PASS [${label}] S7-01 service and business logic verification`);
}

async function testHttpEndpoints(db) {
  const service = new RequisitionService(db);
  const users = {
    'token-int1': { id: 'u-int1', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] },
    'token-int3': { id: 'u-int3', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] },
    'token-admin': { id: 'u-admin', roles: ['ADMIN'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read', 'requisition.read'] }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/, '');
    const user = users[token];

    if (req.method === 'GET' && (pathname === '/api/v1/interviews' || pathname === '/api/v1/interviews/my-schedule')) {
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
        return;
      }
      const query = Object.fromEntries(url.searchParams.entries());
      const isMySchedule = pathname.endsWith('/my-schedule') || query.mySchedule === 'true' || query.mySchedule === '1' || query.scope === 'mine' || query.mine === '1' || query.mine === 'true';
      const result = await service.getInterviews({
        viewer: user,
        mySchedule: isMySchedule,
        status: query.status,
        search: query.search,
        timeframe: query.timeframe || (pathname.endsWith('/my-schedule') ? (query.timeframe !== undefined ? query.timeframe : 'UPCOMING') : undefined),
        sortOrder: query.sortOrder,
        evaluationStatus: query.evaluationStatus
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Not found' }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const resNoAuth = await fetch(`${baseUrl}/api/v1/interviews/my-schedule`);
    assert.equal(resNoAuth.status, 401);

    const resMySched = await fetch(`${baseUrl}/api/v1/interviews/my-schedule`, {
      headers: { Authorization: 'Bearer token-int1' }
    });
    assert.equal(resMySched.status, 200);
    const bodyMySched = await resMySched.json();
    assert.equal(bodyMySched.success, true);
    assert.equal(bodyMySched.interviews.length, 1);
    assert.equal(bodyMySched.interviews[0].id, 'iv-1');

    const resMineParam = await fetch(`${baseUrl}/api/v1/interviews?mine=1`, {
      headers: { Authorization: 'Bearer token-int1' }
    });
    assert.equal(resMineParam.status, 200);
    const bodyMineParam = await resMineParam.json();
    assert.equal(bodyMineParam.success, true);
    assert.equal(bodyMineParam.total, 2);

    const resEmpty = await fetch(`${baseUrl}/api/v1/interviews/my-schedule`, {
      headers: { Authorization: 'Bearer token-int3' }
    });
    assert.equal(resEmpty.status, 200);
    const bodyEmpty = await resEmpty.json();
    assert.equal(bodyEmpty.total, 0);

    const resAdmin = await fetch(`${baseUrl}/api/v1/interviews?scope=mine`, {
      headers: { Authorization: 'Bearer token-admin' }
    });
    assert.equal(resAdmin.status, 200);
    const bodyAdmin = await resAdmin.json();
    assert.equal(bodyAdmin.total, 0);

    console.log('PASS [HTTP API] S7-01 /interviews/my-schedule and ?mine=1 verification');
  } finally {
    server.close();
  }
}

async function main() {
  console.log('--- START S7-01 Interviewer Schedule Tests ---');

  const sqliteDb = createSqliteDb();
  bootstrapSqlite(sqliteDb);
  await seedData(sqliteDb);
  await runTestSuite(sqliteDb, 'SQLite');
  await testHttpEndpoints(sqliteDb);

  const pgliteDb = await createPgliteDb();
  await bootstrapPglite(pgliteDb);
  await seedData(pgliteDb);
  await runTestSuite(pgliteDb, 'PGlite (Postgres)');

  console.log('ALL S7-01 TESTS PASSED SUCCESSFULLY');
}

main().catch(err => {
  console.error('TEST S7-01 FAILED:', err);
  process.exit(1);
});
