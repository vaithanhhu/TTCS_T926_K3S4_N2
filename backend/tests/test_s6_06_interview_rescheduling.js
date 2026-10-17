const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const RequisitionService = require('../src/services/requisitionService');
const InterviewInvitationService = require('../src/services/interviewInvitationService');
const CandidateTimelineService = require('../src/services/candidateTimelineService');

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
          return res.rows[0] || null;
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
    },
    async close() {
      await pg.close();
    }
  };
  return db;
}

async function bootstrapSqlite(db) {
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
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE requisition_recruiter_supports (
      requisition_id TEXT NOT NULL REFERENCES requisitions(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (requisition_id, user_id)
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT NOT NULL DEFAULT 'NEW',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT NOT NULL DEFAULT 'Phỏng vấn chuyên môn',
      scheduled_time TEXT NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      feedback TEXT,
      score INTEGER,
      duration_minutes INTEGER DEFAULT 60,
      interview_format TEXT,
      meeting_room TEXT,
      meeting_link TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE INDEX idx_interview_interviewers_user ON interview_interviewers(user_id);
    CREATE INDEX idx_interviews_scheduled_time ON interviews(scheduled_time);
    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_text TEXT NOT NULL,
      template_name TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_invitation_deliveries (
      outbox_id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      updated_at TEXT
    );
    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      before_stage TEXT,
      after_stage TEXT,
      actor_id TEXT,
      actor_name TEXT,
      action TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE interview_conflict_override_audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      interview_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      conflicts_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const schedSource = require('../src/db/migrate-interview-scheduling').source(db);
  db.exec('CREATE TABLE IF NOT EXISTS ats_interview_scheduling_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);');
  db.prepare('INSERT INTO ats_interview_scheduling_migrations(version, checksum) VALUES(1, ?)').run(schedSource.checksum);
  const conflictOverrideSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/015_interview_conflict_override_sqlite.sql'), 'utf8');
  const conflictOverrideChecksum = crypto.createHash('sha256').update(conflictOverrideSql.replace(/\r\n/g, '\n')).digest('hex');
  db.exec('CREATE TABLE IF NOT EXISTS ats_interview_conflict_override_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);');
  db.prepare('INSERT INTO ats_interview_conflict_override_migrations(version, checksum) VALUES(1, ?)').run(conflictOverrideChecksum);
  await require('../src/db/migrate-interview-invitations').migrate(db);
  await require('../src/db/migrate-interview-reschedule-cancel').migrate(db);
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
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE requisition_recruiter_supports (
      requisition_id TEXT NOT NULL REFERENCES requisitions(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (requisition_id, user_id)
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT,
      requisition_id TEXT REFERENCES requisitions(id),
      stage TEXT NOT NULL DEFAULT 'NEW',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      candidate_id TEXT REFERENCES candidates(id),
      requisition_id TEXT REFERENCES requisitions(id),
      interviewer_id TEXT REFERENCES users(id),
      round_name TEXT NOT NULL DEFAULT 'Phỏng vấn chuyên môn',
      scheduled_time TIMESTAMPTZ NOT NULL,
      location_or_link TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      feedback TEXT,
      score INTEGER,
      duration_minutes INTEGER DEFAULT 60,
      interview_format TEXT,
      meeting_room TEXT,
      meeting_link TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE interview_interviewers (
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'INTERVIEWER',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (interview_id, user_id)
    );
    CREATE INDEX idx_interview_interviewers_user ON interview_interviewers(user_id);
    CREATE INDEX idx_interviews_scheduled_time ON interviews(scheduled_time);
    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      body_text TEXT NOT NULL,
      template_name TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE interview_invitation_deliveries (
      outbox_id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'PENDING',
      attempts INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      updated_at TIMESTAMPTZ
    );
    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      before_stage TEXT,
      after_stage TEXT,
      actor_id TEXT,
      actor_name TEXT,
      action TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ
    );
    CREATE TABLE interview_conflict_override_audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      interview_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      conflicts_json TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE ats_interview_scheduling_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL
    );
  `);
  const schedSource = require('../src/db/migrate-interview-scheduling').source(db);
  await db.prepare('INSERT INTO ats_interview_scheduling_migrations (version, checksum) VALUES (1, ?)').run(schedSource.checksum);
  const conflictOverrideSql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/015_interview_conflict_override_postgres.sql'), 'utf8');
  const conflictOverrideChecksum = crypto.createHash('sha256').update(conflictOverrideSql.replace(/\r\n/g, '\n')).digest('hex');
  await db.exec('CREATE TABLE IF NOT EXISTS ats_interview_conflict_override_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);');
  await db.prepare('INSERT INTO ats_interview_conflict_override_migrations (version, checksum) VALUES (1, ?)').run(conflictOverrideChecksum);
  await require('../src/db/migrate-interview-invitations').migrate(db);
  await require('../src/db/migrate-interview-reschedule-cancel').migrate(db);
}

async function seedFixture(db) {
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-rec-1', 'recruiter1@company.com', 'Recruiter One', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-rec-2', 'recruiter2@company.com', 'Recruiter Two', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-int-1', 'interviewer1@company.com', 'Interviewer One', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-int-2', 'interviewer2@company.com', 'Interviewer Two', 'ACTIVE')").run();

  await db.prepare("INSERT INTO roles(id, code, name) VALUES('r-rec', 'RECRUITER', 'Recruiter')").run();
  await db.prepare("INSERT INTO roles(id, code, name) VALUES('r-admin', 'ADMIN', 'Admin')").run();
  await db.prepare("INSERT INTO roles(id, code, name) VALUES('r-int', 'INTERVIEWER', 'Interviewer')").run();

  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-rec-1', 'r-rec')").run();
  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-rec-2', 'r-rec')").run();
  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-int-1', 'r-int')").run();
  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-int-2', 'r-int')").run();

  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-cand-r', 'candidate.read', 'Read candidate', 'CANDIDATE')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-cand-u', 'candidate.update', 'Update candidate', 'CANDIDATE')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-r', 'interview.read', 'Read interview', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-c', 'interview.create', 'Create interview', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-u', 'interview.update', 'Update interview', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-e', 'interview.evaluate', 'Evaluate interview', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-ov', 'interview.conflict.override', 'Override interview conflict', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-req-r', 'requisition.read', 'Read requisition', 'REQUISITION')").run();

  for (const pid of ['p-cand-r', 'p-cand-u', 'p-int-r', 'p-int-c', 'p-int-u', 'p-int-e', 'p-int-ov', 'p-req-r']) {
    await db.prepare("INSERT INTO role_permissions(role_id, permission_id) VALUES('r-rec', ?)").run(pid);
  }
  for (const pid of ['p-cand-r', 'p-int-r', 'p-int-e']) {
    await db.prepare("INSERT INTO role_permissions(role_id, permission_id) VALUES('r-int', ?)").run(pid);
  }

  await db.prepare("INSERT INTO requisitions(id, code, title, department_name, status, recruiter_id) VALUES('req-101', 'REQ-BACKEND', 'Senior Backend Engineer', 'Kỹ thuật', 'OPEN', 'u-rec-1')").run();
  await db.prepare("INSERT INTO requisitions(id, code, title, department_name, status, recruiter_id) VALUES('req-102', 'REQ-FRONTEND', 'Frontend Engineer', 'Kỹ thuật', 'OPEN', 'u-rec-2')").run();

  await db.prepare("INSERT INTO candidates(id, full_name, email, phone_number, requisition_id, stage) VALUES('cand-201', 'Phạm Minh Anh', 'minhanh@example.com', '0901234567', 'req-101', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO candidates(id, full_name, email, phone_number, requisition_id, stage) VALUES('cand-202', 'Lê Hoàng Long', 'hoanglong@example.com', '0907654321', 'req-101', 'INTERVIEW')").run();

  const timeFuture = new Date(Date.now() + 86400000 * 2).toISOString();
  await db.prepare(`
    INSERT INTO interviews(id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, duration_minutes, interview_format, meeting_room, status)
    VALUES('int-301', 'cand-201', 'req-101', 'u-int-1', 'Vòng Kỹ Thuật 1', ?, 60, 'IN_PERSON', 'Phòng Họp 1', 'SCHEDULED')
  `).run(timeFuture);

  await db.prepare(`
    INSERT INTO interview_interviewers(interview_id, user_id, role)
    VALUES('int-301', 'u-int-1', 'PRIMARY')
  `).run();

  await db.prepare(`
    INSERT INTO interviews(id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, duration_minutes, interview_format, meeting_link, status)
    VALUES('int-302', 'cand-202', 'req-101', 'u-int-2', 'Vòng Văn Hoá', ?, 45, 'ONLINE', 'https://meet.google.com/abc-defg-hij', 'SCHEDULED')
  `).run(timeFuture);

  await db.prepare(`
    INSERT INTO interview_interviewers(interview_id, user_id, role)
    VALUES('int-302', 'u-int-2', 'PRIMARY')
  `).run();
}

async function runTests() {
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test('TC01: Reschedule updates time, room/link, duration and resets candidate response to PENDING', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);
    const invService = new InterviewInvitationService(db);

    const inv = await invService.createInvitation('int-301');
    await invService.respondToInvitation(inv.token, { action: 'CONFIRM' });

    const newTime = new Date(Date.now() + 86400000 * 5).toISOString();
    const recruiter = { id: 'u-rec-1' };
    const res = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 90,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 2',
      interviewerIds: ['u-int-1'],
      rescheduleReason: 'Ứng viên bận công tác đột xuất'
    }, recruiter);

    assert.equal(res.success, true);
    assert.equal(res.durationMinutes, 90);
    assert.equal(res.meetingRoom, 'Phòng Họp 2');

    const updated = await db.prepare('SELECT scheduled_time, duration_minutes, meeting_room, candidate_response_status, candidate_response_note, reschedule_reason, rescheduled_at FROM interviews WHERE id=?').get('int-301');
    assert.equal(updated.duration_minutes, 90);
    assert.equal(updated.meeting_room, 'Phòng Họp 2');
    assert.equal(updated.candidate_response_status, 'PENDING');
    assert.equal(updated.candidate_response_note, null);
    assert.equal(updated.reschedule_reason, 'Ứng viên bận công tác đột xuất');
    assert.ok(updated.rescheduled_at);
  });

  test('TC02: Reschedule automatically revokes old invitation tokens and creates fresh token/outbox entry', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);
    const invService = new InterviewInvitationService(db);

    const oldInv = await invService.createInvitation('int-301');
    const newTime = new Date(Date.now() + 86400000 * 4).toISOString();
    await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/new-link-test',
      interviewerIds: ['u-int-1'],
      rescheduleReason: 'Đổi sang hình thức trực tuyến'
    }, { id: 'u-rec-1' });

    const oldTokenRow = await db.prepare('SELECT status FROM interview_invitation_tokens WHERE token_hash=?').get(oldInv.tokenHash);
    assert.equal(oldTokenRow.status, 'REVOKED');

    const oldResponse = await invService.respondToInvitation(oldInv.token, { action: 'CONFIRM' });
    assert.equal(oldResponse.success, false);
    assert.equal(oldResponse.code, 'TOKEN_REVOKED');

    const activeTokens = await db.prepare("SELECT token_hash FROM interview_invitation_tokens WHERE interview_id='int-301' AND status='ACTIVE'").all();
    assert.equal(activeTokens.length, 1);

    const outboxRows = await db.prepare("SELECT subject, body_text FROM email_outbox WHERE recipient='minhanh@example.com' ORDER BY created_at DESC").all();
    assert.ok(outboxRows.length >= 2);
    assert.ok(outboxRows[0].body_text.includes('https://meet.google.com/new-link-test'));
  });

  test('TC03: Reschedule detects resource conflicts with overlapping interviews and supports override', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    const conflictTime = (await db.prepare('SELECT scheduled_time FROM interviews WHERE id=?').get('int-302')).scheduled_time;
    const resConflict = await service.updateInterviewSchedule('int-301', {
      scheduledTime: conflictTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-2']
    }, { id: 'u-rec-1' });

    assert.equal(resConflict.code, 'INTERVIEW_RESOURCE_CONFLICT');
    assert.ok(resConflict.conflicts.length > 0);

    const resOverride = await service.updateInterviewSchedule('int-301', {
      scheduledTime: conflictTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-2'],
      conflictOverrideConfirmed: true,
      conflictOverrideReason: 'Đã thống nhất dời ca phỏng vấn'
    }, { id: 'u-rec-1' });

    assert.equal(resOverride.success, true);
    const audit = await db.prepare('SELECT reason FROM interview_conflict_override_audit WHERE interview_id=?').get('int-301');
    assert.equal(audit.reason, 'Đã thống nhất dời ca phỏng vấn');
  });

  test('TC04: Reschedule rejected with 400 INTERVIEW_ALREADY_EVALUATED if feedback or score exists', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    await db.prepare("UPDATE interviews SET score=4, feedback='Ứng viên trả lời tốt' WHERE id='int-301'").run();

    const newTime = new Date(Date.now() + 86400000 * 3).toISOString();
    const res = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-1']
    }, { id: 'u-rec-1' });

    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'INTERVIEW_ALREADY_EVALUATED');
  });

  test('TC05: Reschedule rejected with 400 INTERVIEW_ALREADY_CANCELLED if status is CANCELLED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    await db.prepare("UPDATE interviews SET status='CANCELLED', cancellation_reason='Hủy trước đó' WHERE id='int-301'").run();

    const newTime = new Date(Date.now() + 86400000 * 3).toISOString();
    const res = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-1']
    }, { id: 'u-rec-1' });

    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'INTERVIEW_ALREADY_CANCELLED');
  });

  test('TC06: Reschedule enforces recruiter scope (unassigned recruiter rejected with 403 INTERVIEW_OUT_OF_SCOPE)', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    const newTime = new Date(Date.now() + 86400000 * 3).toISOString();
    const res = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-1']
    }, { id: 'u-rec-2' });

    assert.equal(res.success, false);
    assert.equal(res.statusCode, 403);
    assert.ok(['CANDIDATE_OUT_OF_SCOPE', 'INTERVIEW_OUT_OF_SCOPE', 'FORBIDDEN_DATA_SCOPE'].includes(res.code));
  });

  test('TC07: Cancel updates status to CANCELLED and saves cancellation_reason', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    const res = await service.cancelInterview('int-301', {
      cancellationReason: 'Ứng viên xin rút hồ sơ ứng tuyển'
    }, { id: 'u-rec-1' });

    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.status, 'CANCELLED');
    assert.equal(res.cancellationReason, 'Ứng viên xin rút hồ sơ ứng tuyển');

    const updated = await db.prepare('SELECT status, cancellation_reason, cancelled_at FROM interviews WHERE id=?').get('int-301');
    assert.equal(updated.status, 'CANCELLED');
    assert.equal(updated.cancellation_reason, 'Ứng viên xin rút hồ sơ ứng tuyển');
    assert.ok(updated.cancelled_at);
  });

  test('TC08: Cancel requires reason and rejects empty or < 3 chars with 400 CANCELLATION_REASON_REQUIRED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    const resEmpty = await service.cancelInterview('int-301', { cancellationReason: '' }, { id: 'u-rec-1' });
    assert.equal(resEmpty.success, false);
    assert.equal(resEmpty.statusCode, 400);
    assert.equal(resEmpty.code, 'CANCELLATION_REASON_REQUIRED');

    const resShort = await service.cancelInterview('int-301', { cancellationReason: 'no' }, { id: 'u-rec-1' });
    assert.equal(resShort.success, false);
    assert.equal(resShort.statusCode, 400);
    assert.equal(resShort.code, 'CANCELLATION_REASON_REQUIRED');
  });

  test('TC09: Cancel revokes pending invitation tokens and candidate response returns 400 INTERVIEW_CANCELLED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);
    const invService = new InterviewInvitationService(db);

    const inv = await invService.createInvitation('int-301');
    await service.cancelInterview('int-301', { cancellationReason: 'Vị trí tuyển dụng tạm đóng' }, { id: 'u-rec-1' });

    const tokenRow = await db.prepare('SELECT status FROM interview_invitation_tokens WHERE token_hash=?').get(inv.tokenHash);
    assert.equal(tokenRow.status, 'REVOKED');

    const res = await invService.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res.success, false);
    assert.ok(['TOKEN_REVOKED', 'INTERVIEW_CANCELLED'].includes(res.code));
  });

  test('TC10: Cancel puts cancellation email notification into email_outbox', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    await service.cancelInterview('int-301', { cancellationReason: 'Thay đổi kế hoạch tuyển dụng' }, { id: 'u-rec-1' });

    const email = await db.prepare("SELECT recipient, subject, body_text, template_name FROM email_outbox WHERE template_name='S606_INTERVIEW_CANCELLATION'").get();
    assert.ok(email);
    assert.equal(email.recipient, 'minhanh@example.com');
    assert.ok(email.subject.includes('Thông báo hủy'));
    assert.ok(email.body_text.includes('Thay đổi kế hoạch tuyển dụng'));
  });

  test('TC11: Cancel is rejected with 400 INTERVIEW_ALREADY_EVALUATED if feedback or score exists', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    await db.prepare("UPDATE interviews SET score=5, feedback='Xuất sắc' WHERE id='int-301'").run();

    const res = await service.cancelInterview('int-301', { cancellationReason: 'Thử hủy phỏng vấn đã đánh giá' }, { id: 'u-rec-1' });
    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'INTERVIEW_ALREADY_EVALUATED');
  });

  test('TC12: Candidate timeline reflects both INTERVIEW_RESCHEDULED and INTERVIEW_CANCELLED events', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);
    const timelineService = new CandidateTimelineService(db);

    const newTime = new Date(Date.now() + 86400000 * 6).toISOString();
    await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp 1',
      interviewerIds: ['u-int-1'],
      rescheduleReason: 'Dời lịch theo yêu cầu ứng viên'
    }, { id: 'u-rec-1' });

    const viewer = { id: 'u-rec-1', roles: ['RECRUITER'], email: 'recruiter1@company.com' };
    const tl1 = await timelineService.getCandidateTimeline('cand-201', viewer);
    const reschedEvent = (tl1.data?.timeline || tl1.timeline || []).find(e => e.eventType === 'INTERVIEW_RESCHEDULED');
    assert.ok(reschedEvent);
    assert.ok(reschedEvent.summary.includes('Dời lịch theo yêu cầu ứng viên'));

    await service.cancelInterview('int-302', { cancellationReason: 'Ứng viên từ chối phỏng vấn' }, { id: 'u-rec-1' });
    const tl2 = await timelineService.getCandidateTimeline('cand-202', viewer);
    const cancelEvent = (tl2.data?.timeline || tl2.timeline || []).find(e => e.eventType === 'INTERVIEW_CANCELLED');
    assert.ok(cancelEvent);
    assert.ok(cancelEvent.summary.includes('Ứng viên từ chối phỏng vấn'));
  });

  test('TC13: Full migration and verification on PGlite (PostgreSQL)', async () => {
    const db = await createPgliteDb();
    await bootstrapPglite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);

    const newTime = new Date(Date.now() + 86400000 * 5).toISOString();
    const resResched = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 75,
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng Họp VIP',
      interviewerIds: ['u-int-1'],
      rescheduleReason: 'Cập nhật phòng VIP'
    }, { id: 'u-rec-1' });
    assert.equal(resResched.success, true);

    const resCancel = await service.cancelInterview('int-302', {
      cancellationReason: 'Chuyển sang đợt tuyển dụng sau'
    }, { id: 'u-rec-1' });
    assert.equal(resCancel.success, true);
    assert.equal(resCancel.status, 'CANCELLED');

    const verifyRow = await db.prepare('SELECT status, cancellation_reason, cancelled_at FROM interviews WHERE id=?').get('int-302');
    assert.equal(verifyRow.status, 'CANCELLED');
    assert.equal(verifyRow.cancellation_reason, 'Chuyển sang đợt tuyển dụng sau');
    assert.ok(verifyRow.cancelled_at);

    await db.close();
  });

  test('TC14: Reschedule and cancel succeed without transaction abort when interview_invitation_tokens table is missing (SQLite and PGlite)', async () => {
    {
      const db = createSqliteDb();
      await bootstrapSqlite(db);
      await seedFixture(db);
      db.exec('DROP TABLE IF EXISTS interview_invitation_tokens;');
      const service = new RequisitionService(db);
      const newTime = new Date(Date.now() + 86400000 * 3).toISOString();

      const resResched = await service.updateInterviewSchedule('int-301', {
        scheduledTime: newTime,
        durationMinutes: 70,
        interviewFormat: 'IN_PERSON',
        meetingRoom: 'Phòng 101',
        interviewerIds: ['u-int-1'],
        rescheduleReason: 'Doi lich khong co bang token'
      }, { id: 'u-rec-1' });
      assert.equal(resResched.success, true);

      const updated = await db.prepare('SELECT duration_minutes, reschedule_reason, status FROM interviews WHERE id=?').get('int-301');
      assert.equal(updated.duration_minutes, 70);
      assert.equal(updated.reschedule_reason, 'Doi lich khong co bang token');

      const historyResched = await db.prepare("SELECT action FROM candidate_status_history WHERE candidate_id='cand-201' AND action='INTERVIEW_RESCHEDULED'").get();
      assert.ok(historyResched);

      const resCancel = await service.cancelInterview('int-301', {
        cancellationReason: 'Huy lich khong co bang token'
      }, { id: 'u-rec-1' });
      assert.equal(resCancel.success, true);
      assert.equal(resCancel.status, 'CANCELLED');

      const cancelled = await db.prepare('SELECT status, cancellation_reason FROM interviews WHERE id=?').get('int-301');
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancellation_reason, 'Huy lich khong co bang token');

      const historyCancel = await db.prepare("SELECT action FROM candidate_status_history WHERE candidate_id='cand-201' AND action='INTERVIEW_CANCELLED'").get();
      assert.ok(historyCancel);
    }

    {
      const db = await createPgliteDb();
      await bootstrapPglite(db);
      await seedFixture(db);
      await db.exec('DROP TABLE IF EXISTS interview_invitation_tokens CASCADE;');
      const service = new RequisitionService(db);
      const newTime = new Date(Date.now() + 86400000 * 3).toISOString();

      const resResched = await service.updateInterviewSchedule('int-301', {
        scheduledTime: newTime,
        durationMinutes: 70,
        interviewFormat: 'IN_PERSON',
        meetingRoom: 'Phòng PGlite',
        interviewerIds: ['u-int-1'],
        rescheduleReason: 'Doi lich tren PGlite khong co bang token'
      }, { id: 'u-rec-1' });
      assert.equal(resResched.success, true);

      const updated = await db.prepare('SELECT duration_minutes, reschedule_reason, status FROM interviews WHERE id=?').get('int-301');
      assert.equal(updated.duration_minutes, 70);
      assert.equal(updated.reschedule_reason, 'Doi lich tren PGlite khong co bang token');

      const historyResched = await db.prepare("SELECT action FROM candidate_status_history WHERE candidate_id='cand-201' AND action='INTERVIEW_RESCHEDULED'").get();
      assert.ok(historyResched);

      const resCancel = await service.cancelInterview('int-301', {
        cancellationReason: 'Huy lich tren PGlite khong co bang token'
      }, { id: 'u-rec-1' });
      assert.equal(resCancel.success, true);
      assert.equal(resCancel.status, 'CANCELLED');

      const cancelled = await db.prepare('SELECT status, cancellation_reason FROM interviews WHERE id=?').get('int-301');
      assert.equal(cancelled.status, 'CANCELLED');
      assert.equal(cancelled.cancellation_reason, 'Huy lich tren PGlite khong co bang token');

      const historyCancel = await db.prepare("SELECT action FROM candidate_status_history WHERE candidate_id='cand-201' AND action='INTERVIEW_CANCELLED'").get();
      assert.ok(historyCancel);

      await db.close();
    }
  });

  test('TC15: Reschedule and cancel revoke tokens correctly on PGlite when table exists', async () => {
    const db = await createPgliteDb();
    await bootstrapPglite(db);
    await seedFixture(db);
    const service = new RequisitionService(db);
    const invService = new InterviewInvitationService(db);

    const oldInv = await invService.createInvitation('int-301');
    assert.equal(oldInv.success, true);

    const newTime = new Date(Date.now() + 86400000 * 4).toISOString();
    const resResched = await service.updateInterviewSchedule('int-301', {
      scheduledTime: newTime,
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/pglite-token-test',
      interviewerIds: ['u-int-1'],
      rescheduleReason: 'Doi lich sang online tren PGlite'
    }, { id: 'u-rec-1' });
    assert.equal(resResched.success, true);

    const oldTokenRow = await db.prepare('SELECT status FROM interview_invitation_tokens WHERE token_hash=?').get(oldInv.tokenHash);
    assert.equal(oldTokenRow.status, 'REVOKED');

    const activeTokens = await db.prepare("SELECT token_hash FROM interview_invitation_tokens WHERE interview_id='int-301' AND status='ACTIVE'").all();
    assert.equal(activeTokens.length, 1);

    const resCancel = await service.cancelInterview('int-301', {
      cancellationReason: 'Huy lich sau khi co token tren PGlite'
    }, { id: 'u-rec-1' });
    assert.equal(resCancel.success, true);
    assert.equal(resCancel.status, 'CANCELLED');

    const tokensAfterCancel = await db.prepare("SELECT status FROM interview_invitation_tokens WHERE interview_id='int-301'").all();
    assert.ok(tokensAfterCancel.length >= 2);
    assert.ok(tokensAfterCancel.every(t => t.status === 'REVOKED'));

    await db.close();
  });

  test('TC16: Transaction rollback on cancel failure leaves interview and tokens unchanged (SQLite and PGlite)', async () => {
    {
      const db = createSqliteDb();
      await bootstrapSqlite(db);
      await seedFixture(db);
      const service = new RequisitionService(db);
      const invService = new InterviewInvitationService(db);
      const inv = await invService.createInvitation('int-301');

      db.exec("CREATE TRIGGER test_cancel_rollback BEFORE UPDATE ON interviews BEGIN SELECT RAISE(ABORT, 'SIMULATED_CANCEL_ERROR'); END;");

      await assert.rejects(async () => {
        await service.cancelInterview('int-301', {
          cancellationReason: 'Lý do kiểm thử rollback SQLite'
        }, { id: 'u-rec-1' });
      }, /SIMULATED_CANCEL_ERROR/);

      const intRow = await db.prepare('SELECT status, cancellation_reason FROM interviews WHERE id=?').get('int-301');
      assert.equal(intRow.status, 'SCHEDULED');
      assert.equal(intRow.cancellation_reason, null);

      const tokenRow = await db.prepare('SELECT status FROM interview_invitation_tokens WHERE token_hash=?').get(inv.tokenHash);
      assert.equal(tokenRow.status, 'ACTIVE');

      const outbox = await db.prepare("SELECT id FROM email_outbox WHERE template_name='S606_INTERVIEW_CANCELLATION'").all();
      assert.equal(outbox.length, 0);
    }

    {
      const db = await createPgliteDb();
      await bootstrapPglite(db);
      await seedFixture(db);
      const service = new RequisitionService(db);
      const invService = new InterviewInvitationService(db);
      const inv = await invService.createInvitation('int-301');

      await db.exec("ALTER TABLE interviews ADD CONSTRAINT test_cancel_rollback CHECK (status != 'CANCELLED');");

      await assert.rejects(async () => {
        await service.cancelInterview('int-301', {
          cancellationReason: 'Lý do kiểm thử rollback PGlite'
        }, { id: 'u-rec-1' });
      }, /test_cancel_rollback/);

      const intRow = await db.prepare('SELECT status, cancellation_reason FROM interviews WHERE id=?').get('int-301');
      assert.equal(intRow.status, 'SCHEDULED');
      assert.equal(intRow.cancellation_reason, null);

      const tokenRow = await db.prepare('SELECT status FROM interview_invitation_tokens WHERE token_hash=?').get(inv.tokenHash);
      assert.equal(tokenRow.status, 'ACTIVE');

      const outbox = await db.prepare("SELECT id FROM email_outbox WHERE template_name='S606_INTERVIEW_CANCELLATION'").all();
      assert.equal(outbox.length, 0);

      await db.close();
    }
  });

  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`\n================================================================`);
  console.log(`S6-06 TESTS: ${passed}/${tests.length} PASSED`);
  console.log(`================================================================\n`);
}

runTests().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
