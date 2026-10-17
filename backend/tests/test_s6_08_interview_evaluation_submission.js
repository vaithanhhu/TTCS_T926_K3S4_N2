const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const InterviewEvaluationService = require('../src/services/interviewEvaluationService');
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
    CREATE TABLE competency_frameworks (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE competency_criteria (
      id TEXT PRIMARY KEY,
      framework_id TEXT NOT NULL REFERENCES competency_frameworks(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      weight INTEGER NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE job_titles (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      level TEXT,
      framework_id TEXT REFERENCES competency_frameworks(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      department_id TEXT,
      department_name TEXT,
      job_title_id TEXT REFERENCES job_titles(id),
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
    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id),
      from_stage TEXT,
      to_stage TEXT,
      change_reason TEXT,
      changed_by TEXT,
      notes TEXT,
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
    CREATE TABLE interview_invitation_tokens (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      template_code TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE interview_evaluations (
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
    CREATE TABLE interview_evaluation_items (
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
  `);

  const roles = [
    ['r-admin', 'ADMIN', 'Quản trị viên'],
    ['r-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự'],
    ['r-recruiter', 'RECRUITER', 'Chuyên viên tuyển dụng'],
    ['r-interviewer', 'INTERVIEWER', 'Người phỏng vấn']
  ];
  for (const r of roles) {
    db.prepare('INSERT INTO roles VALUES (?, ?, ?)').run(...r);
  }

  const permissions = [
    ['p1', 'interview.read', 'Xem phỏng vấn', 'INTERVIEW'],
    ['p2', 'interview.create', 'Tạo phỏng vấn', 'INTERVIEW'],
    ['p3', 'interview.update', 'Cập nhật phỏng vấn', 'INTERVIEW'],
    ['p4', 'interview.evaluate', 'Đánh giá phỏng vấn', 'INTERVIEW'],
    ['p5', 'interview.evaluation.read', 'Xem kết quả đánh giá', 'INTERVIEW'],
    ['p6', 'candidate.read', 'Xem ứng viên', 'CANDIDATE'],
    ['p7', 'requisition.read', 'Xem yêu cầu', 'REQUISITION']
  ];
  for (const p of permissions) {
    db.prepare('INSERT INTO permissions VALUES (?, ?, ?, ?)').run(...p);
  }

  const rolePermMap = {
    'ADMIN': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'HR_MANAGER': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'RECRUITER': ['interview.read', 'interview.create', 'interview.update', 'interview.evaluation.read', 'candidate.read', 'requisition.read'],
    'INTERVIEWER': ['interview.read', 'interview.evaluate', 'interview.evaluation.read', 'candidate.read']
  };

  for (const [rCode, pCodes] of Object.entries(rolePermMap)) {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode);
    for (const pCode of pCodes) {
      const perm = db.prepare('SELECT id FROM permissions WHERE code = ?').get(pCode);
      if (role && perm) {
        db.prepare('INSERT INTO role_permissions VALUES (?, ?)').run(role.id, perm.id);
      }
    }
  }

  const users = [
    ['u-admin', 'admin@example.com', 'Admin System', 'ADMIN'],
    ['u-hr', 'hr@example.com', 'HR Director', 'HR_MANAGER'],
    ['u-rec', 'rec@example.com', 'Recruiter In-Charge', 'RECRUITER'],
    ['u-lead-iv', 'lead@example.com', 'Lead Interviewer', 'INTERVIEWER'],
    ['u-peer-iv', 'peer@example.com', 'Peer Interviewer', 'INTERVIEWER'],
    ['u-stranger', 'stranger@example.com', 'Stranger Interviewer', 'INTERVIEWER']
  ];
  for (const [uid, email, name, rCode] of users) {
    db.prepare("INSERT INTO users VALUES (?, ?, ?, 'ACTIVE', 0, NULL)").run(uid, email, name);
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(rCode);
    db.prepare('INSERT INTO user_roles VALUES (?, ?)').run(uid, role.id);
  }
}

async function runTests() {
  console.log('=== TEST SUITE: S6-08 SECURE INTERVIEW EVALUATION SUBMISSION ===');

  let passedCount = 0;
  let totalCount = 0;

  async function testCase(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  const db = createSqliteDb();
  await bootstrapSqlite(db);
  const evalService = new InterviewEvaluationService(db);
  const reqService = new RequisitionService(db);
  const timelineService = new CandidateTimelineService(db);

  db.prepare("INSERT INTO competency_frameworks (id, code, name, description) VALUES ('cf-qa', 'CF-QA', 'Khung Năng Lực QA/QC', 'Khung kiểm thử')").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-testcase', 'cf-qa', 'Thiết kế Test Case', 'Kỹ năng thiết kế ca kiểm thử', 40, 1)").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-automation', 'cf-qa', 'Automation Testing', 'Kỹ năng automation', 30, 2)").run();
  db.prepare("INSERT INTO competency_criteria (id, framework_id, name, description, weight, display_order) VALUES ('crit-mindset', 'cf-qa', 'Tư duy chất lượng', 'Quality mindset', 30, 3)").run();

  db.prepare("INSERT INTO job_titles (id, code, name, level, framework_id) VALUES ('jt-qa', 'QA-01', 'QA Automation Engineer', 'Mid', 'cf-qa')").run();
  db.prepare("INSERT INTO requisitions (id, title, job_title_id, recruiter_id, status) VALUES ('req-qa', 'QA Engineer', 'jt-qa', 'u-rec', 'OPEN')").run();
  db.prepare("INSERT INTO candidates (id, full_name, email, requisition_id) VALUES ('cand-qa', 'Le Van C', 'c@test.com', 'req-qa')").run();
  db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-qa-01', 'cand-qa', 'req-qa', 'u-lead-iv', 'Vòng Chuyên Môn QA', '2026-11-10T09:00:00Z', 'SCHEDULED')").run();
  db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-qa-01', 'u-lead-iv', 'INTERVIEWER')").run();
  db.prepare("INSERT INTO interview_interviewers (interview_id, user_id, role) VALUES ('int-qa-01', 'u-peer-iv', 'INTERVIEWER')").run();

  await testCase('TC01: Invited-only access - Unassigned interviewer rejected with 403', async () => {
    const strangerActor = { id: 'u-stranger', roles: ['INTERVIEWER'] };

    const getForm = await evalService.getOrCreateEvaluationForm('int-qa-01', 'u-stranger', strangerActor);
    assert.equal(getForm.code, 'INTERVIEW_ACCESS_DENIED');
    assert.equal(getForm.statusCode, 403);

    const saveForm = await evalService.saveEvaluation('int-qa-01', {
      interviewerId: 'u-stranger',
      status: 'DRAFT',
      criteria: []
    }, strangerActor);
    assert.equal(saveForm.code, 'INTERVIEW_ACCESS_DENIED');
    assert.equal(saveForm.statusCode, 403);

    const getEvals = await evalService.getEvaluationsForInterview('int-qa-01', strangerActor);
    assert.equal(getEvals.code, 'INTERVIEW_ACCESS_DENIED');
    assert.equal(getEvals.statusCode, 403);
  });

  await testCase('TC02: Invited-only access - Assigned interviewers open own forms successfully', async () => {
    const leadActor = { id: 'u-lead-iv', roles: ['INTERVIEWER'] };
    const peerActor = { id: 'u-peer-iv', roles: ['INTERVIEWER'] };

    const leadForm = await evalService.getOrCreateEvaluationForm('int-qa-01', null, leadActor);
    assert.equal(leadForm.success, true);
    assert.equal(leadForm.evaluation.interviewerId, 'u-lead-iv');

    const peerForm = await evalService.getOrCreateEvaluationForm('int-qa-01', null, peerActor);
    assert.equal(peerForm.success, true);
    assert.equal(peerForm.evaluation.interviewerId, 'u-peer-iv');
    assert.notEqual(leadForm.evaluation.id, peerForm.evaluation.id);
  });

  await testCase('TC03: Anti-IDOR protection - Interviewer cannot view or tamper with other interviewers form', async () => {
    const peerActor = { id: 'u-peer-iv', roles: ['INTERVIEWER'] };

    const forgedGet = await evalService.getOrCreateEvaluationForm('int-qa-01', 'u-lead-iv', peerActor);
    assert.equal(forgedGet.success, true);
    assert.equal(forgedGet.evaluation.interviewerId, 'u-peer-iv');

    const forgedSave = await evalService.saveEvaluation('int-qa-01', {
      interviewerId: 'u-lead-iv',
      status: 'DRAFT',
      criteria: [{ id: 'crit-testcase', score: 2 }]
    }, peerActor);
    assert.equal(forgedSave.success, true);
    assert.equal(forgedSave.evaluation.interviewerId, 'u-peer-iv');
  });

  await testCase('TC04: Conclusion is mandatory upon submission - Rejects missing or invalid conclusion', async () => {
    const leadActor = { id: 'u-lead-iv', roles: ['INTERVIEWER'] };

    const missingRec = await evalService.saveEvaluation('int-qa-01', {
      status: 'SUBMITTED',
      recommendation: null,
      criteria: [
        { id: 'crit-testcase', score: 5 },
        { id: 'crit-automation', score: 4 },
        { id: 'crit-mindset', score: 4 }
      ]
    }, leadActor);
    assert.equal(missingRec.code, 'RECOMMENDATION_REQUIRED');

    const invalidRec = await evalService.saveEvaluation('int-qa-01', {
      status: 'SUBMITTED',
      recommendation: 'HIRE_IMMEDIATELY',
      criteria: [
        { id: 'crit-testcase', score: 5 },
        { id: 'crit-automation', score: 4 },
        { id: 'crit-mindset', score: 4 }
      ]
    }, leadActor);
    assert.equal(invalidRec.code, 'RECOMMENDATION_REQUIRED');
  });

  await testCase('TC05: Successful submission locks evaluation and records reliable timestamp', async () => {
    const leadActor = { id: 'u-lead-iv', roles: ['INTERVIEWER'] };

    const validSubmit = await evalService.saveEvaluation('int-qa-01', {
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      generalNotes: 'Ứng viên nắm vững kiến thức automation và test design.',
      criteria: [
        { id: 'crit-testcase', score: 5, comment: 'Đầy đủ boundary value analysis' },
        { id: 'crit-automation', score: 4, comment: 'Có kinh nghiệm Cypress/Playwright' },
        { id: 'crit-mindset', score: 4, comment: 'Cẩn thận, chú trọng chi tiết' }
      ]
    }, leadActor);

    assert.equal(validSubmit.success, true);
    assert.equal(validSubmit.evaluation.status, 'SUBMITTED');
    assert.equal(validSubmit.evaluation.recommendation, 'RECOMMENDED');
    assert.equal(validSubmit.evaluation.totalScore, 4.40);
    assert.ok(validSubmit.evaluation.submittedAt);
  });

  await testCase('TC06: Submit lock rejects any edit attempts after submission', async () => {
    const leadActor = { id: 'u-lead-iv', roles: ['INTERVIEWER'] };

    const attemptEdit = await evalService.saveEvaluation('int-qa-01', {
      status: 'DRAFT',
      recommendation: 'NOT_RECOMMENDED',
      criteria: [{ id: 'crit-testcase', score: 1 }]
    }, leadActor);

    assert.equal(attemptEdit.code, 'EVALUATION_ALREADY_SUBMITTED');
    assert.equal(attemptEdit.statusCode, 400);
  });

  await testCase('TC07: Blind evaluation - Peer interviewer cannot see lead evaluation before submitting own', async () => {
    const peerActor = { id: 'u-peer-iv', roles: ['INTERVIEWER'] };

    const blindList = await evalService.getEvaluationsForInterview('int-qa-01', peerActor);
    assert.equal(blindList.success, true);
    assert.equal(blindList.evaluations.length, 1);
    assert.equal(blindList.evaluations[0].interviewerId, 'u-peer-iv');
    assert.equal(blindList.evaluations[0].status, 'DRAFT');

    const hrActor = { id: 'u-hr', roles: ['HR_MANAGER'] };
    const hrList = await evalService.getEvaluationsForInterview('int-qa-01', hrActor);
    assert.equal(hrList.success, true);
    assert.equal(hrList.evaluations.length, 2);
    assert.equal(hrList.evaluations.some(e => e.interviewerId === 'u-lead-iv' && e.status === 'SUBMITTED'), true);
  });

  await testCase('TC08: Blind evaluation lifts once peer interviewer submits own evaluation', async () => {
    const peerActor = { id: 'u-peer-iv', roles: ['INTERVIEWER'] };

    const submitPeer = await evalService.saveEvaluation('int-qa-01', {
      status: 'SUBMITTED',
      recommendation: 'CONSIDER',
      generalNotes: 'Cần trau dồi thêm performance testing.',
      criteria: [
        { id: 'crit-testcase', score: 4, comment: 'Khá tốt' },
        { id: 'crit-automation', score: 3, comment: 'Mức cơ bản' },
        { id: 'crit-mindset', score: 4, comment: 'Thái độ tốt' }
      ]
    }, peerActor);
    assert.equal(submitPeer.success, true);
    assert.equal(submitPeer.evaluation.totalScore, 3.70);

    const postSubmitList = await evalService.getEvaluationsForInterview('int-qa-01', peerActor);
    assert.equal(postSubmitList.success, true);
    assert.equal(postSubmitList.evaluations.length, 2);
  });

  await testCase('TC09: Reopen within 24h by Recruiter/HR resets lock and logs audit', async () => {
    const recActor = { id: 'u-rec', roles: ['RECRUITER'] };

    const reopenRes = await evalService.reopenEvaluation('int-qa-01', 'u-peer-iv', recActor, {
      reason: 'Bổ sung thêm điểm đánh giá sau khi hội ý ban giám khảo'
    });
    assert.equal(reopenRes.success, true);
    assert.equal(reopenRes.evaluation.status, 'REOPENED');
    assert.equal(reopenRes.evaluation.reopenedBy, 'u-rec');
    assert.equal(reopenRes.evaluation.reopenReason, 'Bổ sung thêm điểm đánh giá sau khi hội ý ban giám khảo');

    const historyLog = db.prepare("SELECT * FROM candidate_status_history WHERE candidate_id = 'cand-qa' AND change_reason = 'REOPEN_EVALUATION'").get();
    assert.ok(historyLog);
    assert.equal(historyLog.changed_by, 'u-rec');

    const peerActor = { id: 'u-peer-iv', roles: ['INTERVIEWER'] };
    const editAfterReopen = await evalService.saveEvaluation('int-qa-01', {
      status: 'DRAFT',
      criteria: [{ id: 'crit-automation', score: 4, comment: 'Đã kiểm tra lại bài test, đạt yêu cầu' }]
    }, peerActor);
    assert.equal(editAfterReopen.success, true);
    assert.equal(editAfterReopen.evaluation.criteria.find(c => c.id === 'crit-automation').score, 4);

    await evalService.saveEvaluation('int-qa-01', {
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      criteria: [
        { id: 'crit-testcase', score: 4 },
        { id: 'crit-automation', score: 4 },
        { id: 'crit-mindset', score: 4 }
      ]
    }, peerActor);
  });

  await testCase('TC10: Reopen rejected when expired (> 24 hours) or lacking permissions', async () => {
    const strangerActor = { id: 'u-stranger', roles: ['INTERVIEWER'] };
    const unauthReopen = await evalService.reopenEvaluation('int-qa-01', 'u-lead-iv', strangerActor, { reason: 'Mở lại' });
    assert.equal(unauthReopen.code, 'FORBIDDEN');
    assert.equal(unauthReopen.statusCode, 403);

    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE interview_evaluations SET submitted_at = ? WHERE interview_id = 'int-qa-01' AND interviewer_id = 'u-lead-iv'").run(oldDate);

    const recActor = { id: 'u-rec', roles: ['RECRUITER'] };
    const expiredReopen = await evalService.reopenEvaluation('int-qa-01', 'u-lead-iv', recActor, { reason: 'Mở lại quá muộn' });
    assert.equal(expiredReopen.code, 'REOPEN_WINDOW_EXPIRED');
    assert.equal(expiredReopen.statusCode, 400);
  });

  await testCase('TC11: Cancelled interview rejects evaluation submission', async () => {
    db.prepare("INSERT INTO interviews (id, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, status) VALUES ('int-cancelled', 'cand-qa', 'req-qa', 'u-lead-iv', 'Vòng Bị Hủy', '2026-11-12T10:00:00Z', 'CANCELLED')").run();

    const leadActor = { id: 'u-lead-iv', roles: ['INTERVIEWER'] };
    const submitCancelled = await evalService.saveEvaluation('int-cancelled', {
      status: 'SUBMITTED',
      recommendation: 'RECOMMENDED',
      criteria: [
        { id: 'crit-testcase', score: 5 },
        { id: 'crit-automation', score: 5 },
        { id: 'crit-mindset', score: 5 }
      ]
    }, leadActor);
    assert.equal(submitCancelled.code, 'INTERVIEW_CANCELLED');
    assert.equal(submitCancelled.statusCode, 400);
  });

  await testCase('TC12: Candidate timeline and rescheduling guard verify submitted evaluations', async () => {
    const adminActor = { id: 'u-admin', roles: ['ADMIN'] };

    const cancelRes = await reqService.cancelInterview('int-qa-01', { cancellationReason: 'Hủy buổi phỏng vấn' }, adminActor);
    assert.equal(cancelRes.code, 'INTERVIEW_ALREADY_EVALUATED');

    const reschedRes = await reqService.updateInterviewSchedule('int-qa-01', {
      scheduledTime: '2026-11-15T10:00:00Z',
      rescheduleReason: 'Dời lịch'
    }, adminActor);
    assert.equal(reschedRes.code, 'INTERVIEW_ALREADY_EVALUATED');

    const timelineRes = await timelineService.getCandidateTimeline('cand-qa', adminActor);
    assert.equal(timelineRes.success, true);
    const timelineList = timelineRes.data && timelineRes.data.timeline ? timelineRes.data.timeline : [];
    assert.equal(timelineList.some(e => e.eventType === 'EVALUATION_SUBMITTED'), true);
  });

  console.log('================================================================');
  console.log(`TOTAL: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);
  if (passedCount === totalCount) {
    console.log('ALL S6-08 TESTS PASSED!');
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
