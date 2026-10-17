const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const InterviewInvitationService = require('../src/services/interviewInvitationService');
const RequisitionService = require('../src/services/requisitionService');
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
  `);
  const schedSource = require('../src/db/migrate-interview-scheduling').source(db);
  db.exec('CREATE TABLE IF NOT EXISTS ats_interview_scheduling_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL);');
  db.prepare('INSERT INTO ats_interview_scheduling_migrations(version, checksum) VALUES(1, ?)').run(schedSource.checksum);
  await require('../src/db/migrate-interview-invitations').migrate(db);
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
    CREATE TABLE ats_interview_scheduling_migrations (
      version INTEGER PRIMARY KEY,
      checksum TEXT NOT NULL
    );
  `);
  const schedSource = require('../src/db/migrate-interview-scheduling').source(db);
  await db.prepare('INSERT INTO ats_interview_scheduling_migrations (version, checksum) VALUES (1, ?)').run(schedSource.checksum);
  await require('../src/db/migrate-interview-invitations').migrate(db);
}

async function seedFixture(db) {
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-rec-1', 'recruiter1@company.com', 'Recruiter One', 'ACTIVE')").run();
  await db.prepare("INSERT INTO users(id, email, full_name, status) VALUES('u-int-1', 'interviewer1@company.com', 'Interviewer One', 'ACTIVE')").run();
  await db.prepare("INSERT INTO roles(id, code, name) VALUES('r-rec', 'RECRUITER', 'Recruiter')").run();
  await db.prepare("INSERT INTO roles(id, code, name) VALUES('r-admin', 'ADMIN', 'Admin')").run();
  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-rec-1', 'r-rec')").run();
  await db.prepare("INSERT INTO user_roles(user_id, role_id) VALUES('u-rec-1', 'r-admin')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-cand-r', 'candidate.read', 'Read candidate', 'CANDIDATE')").run();
  await db.prepare("INSERT INTO permissions(id, code, name, module) VALUES('p-int-r', 'interview.read', 'Read interview', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO role_permissions(role_id, permission_id) VALUES('r-rec', 'p-cand-r')").run();
  await db.prepare("INSERT INTO role_permissions(role_id, permission_id) VALUES('r-rec', 'p-int-r')").run();
  await db.prepare("INSERT INTO requisitions(id, title, department_name, status, recruiter_id) VALUES('req-101', 'Senior Backend Engineer', 'Kỹ thuật', 'OPEN', 'u-rec-1')").run();
  await db.prepare("INSERT INTO candidates(id, full_name, email, phone_number, requisition_id, stage) VALUES('cand-201', 'Phạm Minh Anh', 'minhanh@example.com', '0901234567', 'req-101', 'INTERVIEW')").run();
  await db.prepare("INSERT INTO candidates(id, full_name, email, phone_number, requisition_id, stage) VALUES('cand-202', 'Lê Hoàng Long', 'hoanglong@example.com', '0907654321', 'req-101', 'INTERVIEW')").run();

  const timeFuture = new Date(Date.now() + 86400000 * 2).toISOString();
  await db.prepare(`
    INSERT INTO interviews(id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, duration_minutes, interview_format, meeting_link, status)
    VALUES('int-301', 'cand-201', 'req-101', 'u-int-1', 'Vòng Kỹ Thuật 1', ?, 60, 'ONLINE', 'https://meet.google.com/abc-defg-hij', 'SCHEDULED')
  `).run(timeFuture);

  await db.prepare(`
    INSERT INTO interviews(id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, duration_minutes, interview_format, meeting_room, status)
    VALUES('int-302', 'cand-202', 'req-101', 'u-int-1', 'Vòng Văn Hoá', ?, 45, 'IN_PERSON', 'Phòng Họp A203', 'SCHEDULED')
  `).run(timeFuture);
}

async function runTests() {
  const tests = [];
  function test(name, fn) { tests.push({ name, fn }); }

  test('TC01: createInvitation generates token, hashes it and populates email_outbox with required details', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    assert.equal(inv.success, true);
    assert.equal(inv.statusCode, 201);
    assert.ok(inv.token);
    assert.ok(inv.tokenHash);
    assert.equal(crypto.createHash('sha256').update(inv.token).digest('hex'), inv.tokenHash);

    const tokenRow = await db.prepare('SELECT * FROM interview_invitation_tokens WHERE id = ?').get('iit-' + inv.tokenHash.slice(0, 10));
    const tokenInDb = await db.prepare('SELECT * FROM interview_invitation_tokens WHERE token_hash = ?').get(inv.tokenHash);
    assert.ok(tokenInDb);
    assert.equal(tokenInDb.interview_id, 'int-301');
    assert.equal(tokenInDb.status, 'ACTIVE');

    const outbox = await db.prepare("SELECT * FROM email_outbox WHERE template_name = 'S605_INTERVIEW_INVITATION'").get();
    assert.ok(outbox);
    assert.equal(outbox.recipient, 'minhanh@example.com');
    assert.ok(outbox.subject.includes('Senior Backend Engineer'));
    assert.ok(outbox.body_text.includes('Senior Backend Engineer'));
    assert.ok(outbox.body_text.includes('Vòng Kỹ Thuật 1'));
    assert.ok(outbox.body_text.includes('https://meet.google.com/abc-defg-hij'));
    assert.ok(outbox.body_text.includes('Hướng dẫn chuẩn bị:'));
    assert.ok(outbox.body_text.includes(inv.token));
    assert.ok(outbox.body_html.includes(inv.token));
  });

  test('TC02: getInvitationByToken returns sanitized interview details with AC1 fields', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    const details = await service.getInvitationByToken(inv.token);
    assert.equal(details.success, true);
    assert.equal(details.statusCode, 200);
    assert.equal(details.interview.candidateName, 'Phạm Minh Anh');
    assert.equal(details.interview.requisitionTitle, 'Senior Backend Engineer');
    assert.equal(details.interview.roundName, 'Vòng Kỹ Thuật 1');
    assert.equal(details.interview.interviewFormat, 'ONLINE');
    assert.equal(details.interview.meetingLink, 'https://meet.google.com/abc-defg-hij');
    assert.ok(details.interview.instructions);
    assert.equal(details.interview.responseStatus, 'PENDING');
  });

  test('TC03: Candidate can confirm attendance (action=CONFIRM) and status updates to CONFIRMED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    const res = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseStatus, 'CONFIRMED');

    const interview = await db.prepare('SELECT candidate_response_status, candidate_responded_at FROM interviews WHERE id = ?').get('int-301');
    assert.equal(interview.candidate_response_status, 'CONFIRMED');
    assert.ok(interview.candidate_responded_at);

    const tokenDb = await db.prepare('SELECT status, used_at FROM interview_invitation_tokens WHERE token_hash = ?').get(inv.tokenHash);
    assert.equal(tokenDb.status, 'USED');
    assert.ok(tokenDb.used_at);
  });

  test('TC04: Candidate can request reschedule (action=REQUEST_RESCHEDULE) with note', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-302');
    const noteText = 'Tôi có chuyến công tác đột xuất, mong muốn chuyển sang chiều thứ Năm 14:00.';
    const res = await service.respondToInvitation(inv.token, { action: 'REQUEST_RESCHEDULE', note: noteText });
    assert.equal(res.success, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.responseStatus, 'RESCHEDULE_REQUESTED');
    assert.equal(res.responseNote, noteText);

    const interview = await db.prepare('SELECT candidate_response_status, candidate_response_note, status FROM interviews WHERE id = ?').get('int-302');
    assert.equal(interview.candidate_response_status, 'RESCHEDULE_REQUESTED');
    assert.equal(interview.candidate_response_note, noteText);
    assert.equal(interview.status, 'SCHEDULED');
  });

  test('TC05: One-time token prevents replay (second attempt returns 409 TOKEN_ALREADY_USED)', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    const res1 = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res1.success, true);

    const res2 = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res2.success, false);
    assert.equal(res2.statusCode, 409);
    assert.equal(res2.code, 'TOKEN_ALREADY_USED');

    const getRes = await service.getInvitationByToken(inv.token);
    assert.equal(getRes.statusCode, 409);
    assert.equal(getRes.code, 'TOKEN_ALREADY_USED');
  });

  test('TC06: Expired tokens are rejected with 400 TOKEN_EXPIRED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    await db.prepare("UPDATE interview_invitation_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE token_hash = ?").run(inv.tokenHash);

    const res = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res.success, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'TOKEN_EXPIRED');

    const getRes = await service.getInvitationByToken(inv.token);
    assert.equal(getRes.statusCode, 400);
    assert.equal(getRes.code, 'TOKEN_EXPIRED');
  });

  test('TC07: Revoked tokens (after re-inviting) cannot be used and return 400 TOKEN_REVOKED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv1 = await service.createInvitation('int-301');
    const inv2 = await service.createInvitation('int-301');

    const oldUse = await service.respondToInvitation(inv1.token, { action: 'CONFIRM' });
    assert.equal(oldUse.statusCode, 400);
    assert.equal(oldUse.code, 'TOKEN_REVOKED');

    const newUse = await service.respondToInvitation(inv2.token, { action: 'CONFIRM' });
    assert.equal(newUse.statusCode, 200);
    assert.equal(newUse.responseStatus, 'CONFIRMED');
  });

  test('TC08: Cancelled interview rejects response with 400 INTERVIEW_CANCELLED', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    await db.prepare("UPDATE interviews SET status = 'CANCELLED' WHERE id = 'int-301'").run();

    const res = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.code, 'INTERVIEW_CANCELLED');

    const getRes = await service.getInvitationByToken(inv.token);
    assert.equal(getRes.statusCode, 400);
    assert.equal(getRes.code, 'INTERVIEW_CANCELLED');
  });

  test('TC09: Cross-interview isolation: token is strictly bound to its own interview', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv1 = await service.createInvitation('int-301');
    const inv2 = await service.createInvitation('int-302');

    const details1 = await service.getInvitationByToken(inv1.token);
    const details2 = await service.getInvitationByToken(inv2.token);
    assert.equal(details1.interview.interviewId, 'int-301');
    assert.equal(details2.interview.interviewId, 'int-302');
    assert.notEqual(details1.interview.interviewId, details2.interview.interviewId);
  });

  test('TC10: Timeline service includes candidate interview response events', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);
    const timeline = new CandidateTimelineService(db);

    const inv = await service.createInvitation('int-301');
    await service.respondToInvitation(inv.token, { action: 'CONFIRM' });

    const viewer = { id: 'u-rec-1', roles: ['ADMIN'], email: 'admin@company.com' };
    const tl = await timeline.getCandidateTimeline('cand-201', viewer);
    const respEvent = (tl.data?.timeline || tl.timeline || []).find(e => e.eventType === 'INTERVIEW_CONFIRMED');
    assert.ok(respEvent);
    assert.equal(respEvent.title, 'Ứng viên xác nhận tham dự phỏng vấn');
  });

  test('TC11: Recruiter getInterviews query includes candidate response status and notes', async () => {
    const db = createSqliteDb();
    await bootstrapSqlite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);
    const reqService = new RequisitionService(db);

    const inv = await service.createInvitation('int-302');
    await service.respondToInvitation(inv.token, { action: 'REQUEST_RESCHEDULE', note: 'Bận đột xuất' });

    const viewer = { id: 'u-rec-1', roles: ['ADMIN'] };
    const list = await reqService.getInterviews({ viewer });
    const target = list.interviews.find(i => i.id === 'int-302');
    assert.ok(target);
    assert.equal(target.candidateResponseStatus, 'RESCHEDULE_REQUESTED');
    assert.equal(target.candidateResponseNote, 'Bận đột xuất');
    assert.ok(target.candidateRespondedAt);
  });

  test('TC12: Full migration and verification on PGlite (PostgreSQL)', async () => {
    const db = await createPgliteDb();
    await bootstrapPglite(db);
    await seedFixture(db);
    const service = new InterviewInvitationService(db);

    const inv = await service.createInvitation('int-301');
    assert.equal(inv.success, true);

    const details = await service.getInvitationByToken(inv.token);
    assert.equal(details.success, true);
    assert.equal(details.interview.roundName, 'Vòng Kỹ Thuật 1');

    const res = await service.respondToInvitation(inv.token, { action: 'CONFIRM' });
    assert.equal(res.success, true);
    assert.equal(res.responseStatus, 'CONFIRMED');

    const verifyRunner = require('../src/db/migrate-interview-invitations');
    await verifyRunner.verify(db);
    await db.close();
  });

  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`[PASS] ${t.name}`);
    } catch (err) {
      console.error(`[FAIL] ${t.name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  console.log(`\n================================================================`);
  console.log(`S6-05 TESTS: ${passed}/${tests.length} PASSED`);
  console.log(`================================================================`);
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
