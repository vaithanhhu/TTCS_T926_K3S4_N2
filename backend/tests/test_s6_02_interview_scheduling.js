const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { sqliteBoundary, PostgresDatabase } = require('../src/db/postgres');
const RequisitionService = require('../src/services/requisitionService');
const CandidateTimelineService = require('../src/services/candidateTimelineService');
const config = require('../src/config/config');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failed++;
    console.error(`[FAIL] ${name}`, err);
    throw err;
  }
}

async function denied(action, expectedStatus = 403) {
  let result;
  let failure;
  try { result = await action(); } catch (error) { failure = error; }
  if (failure) {
    assert.ok(failure.statusCode || failure.status, 'Unexpected exception is not an authorization response');
    assert.equal(failure.statusCode || failure.status, expectedStatus);
    return;
  }
  assert.equal(result?.success, false, 'Successful request cannot satisfy a negative test');
  assert.equal(result.statusCode, expectedStatus);
}

async function setupFixture(db, provider = 'sqlite') {
  config.REQUISITION_OPERATIONS_ENABLED = true;

  await db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      full_name TEXT,
      status TEXT DEFAULT 'ACTIVE',
      must_change_password ${provider === 'postgres' ? 'BOOLEAN DEFAULT FALSE' : 'INTEGER DEFAULT 0'},
      locked_until TEXT
    );
    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT
    );
    CREATE TABLE permissions (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT
    );
    CREATE TABLE user_roles (
      user_id TEXT,
      role_id TEXT,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE role_permissions (
      role_id TEXT,
      permission_id TEXT,
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      manager_id TEXT
    );
    CREATE TABLE requisitions (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT,
      department_id TEXT,
      department_name TEXT,
      recruiter_id TEXT,
      hiring_manager_id TEXT,
      status TEXT DEFAULT 'OPEN'
    );
    CREATE TABLE requisition_recruiter_supports (
      requisition_id TEXT,
      user_id TEXT,
      PRIMARY KEY (requisition_id, user_id)
    );
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      requisition_id TEXT,
      full_name TEXT,
      email TEXT,
      phone_number TEXT,
      stage TEXT DEFAULT 'NEW',
      experience_years INTEGER DEFAULT 1,
      current_company TEXT,
      expected_salary INTEGER,
      notes TEXT,
      source_id TEXT,
      rejection_reason_id TEXT,
      created_at TEXT,
      cover_letter TEXT
    );
    CREATE TABLE candidate_status_history (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      before_stage TEXT,
      after_stage TEXT,
      actor_name TEXT,
      action TEXT,
      reason TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE interviews (
      id TEXT PRIMARY KEY,
      code TEXT,
      candidate_id TEXT NOT NULL,
      requisition_id TEXT,
      interviewer_id TEXT,
      round_name TEXT,
      scheduled_time TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 60,
      interview_format TEXT,
      meeting_room TEXT,
      meeting_link TEXT,
      location_or_link TEXT,
      status TEXT DEFAULT 'SCHEDULED',
      score REAL,
      feedback TEXT,
      created_at TEXT
    );

  `);

  await require('../src/db/migrate-interview-scheduling').migrate(db);

  const roles = [
    ['role-admin', 'ADMIN', 'Quản trị hệ thống'],
    ['role-hr', 'HR_MANAGER', 'Trưởng phòng nhân sự'],
    ['role-recruiter', 'RECRUITER', 'Nhân viên tuyển dụng'],
    ['role-hiring', 'HIRING_MGR', 'Trưởng bộ phận'],
    ['role-interviewer', 'INTERVIEWER', 'Người phỏng vấn'],
    ['role-candidate', 'CANDIDATE', 'Ứng viên']
  ];
  for (const [id, code, name] of roles) {
    await db.prepare('INSERT INTO roles (id, code, name) VALUES (?, ?, ?)').run(id, code, name);
  }

  const permissions = [
    ['p-int-create', 'interview.create', 'Tạo lịch phỏng vấn'],
    ['p-int-read', 'interview.read', 'Xem lịch phỏng vấn'],
    ['p-int-update', 'interview.update', 'Cập nhật lịch'],
    ['p-int-eval', 'interview.evaluate', 'Đánh giá phỏng vấn'],
    ['p-cand-read', 'candidate.read', 'Xem ứng viên'],
    ['p-cand-update', 'candidate.update', 'Cập nhật ứng viên'],
    ['p-req-read', 'requisition.read', 'Xem vị trí']
  ];
  for (const [id, code, name] of permissions) {
    await db.prepare('INSERT INTO permissions (id, code, name) VALUES (?, ?, ?)').run(id, code, name);
  }

  const roleGrants = {
    'role-admin': ['p-int-create', 'p-int-read', 'p-int-update', 'p-int-eval', 'p-cand-read', 'p-cand-update', 'p-req-read'],
    'role-hr': ['p-int-create', 'p-int-read', 'p-int-update', 'p-int-eval', 'p-cand-read', 'p-cand-update', 'p-req-read'],
    'role-recruiter': ['p-int-create', 'p-int-read', 'p-int-update', 'p-cand-read', 'p-cand-update', 'p-req-read'],
    'role-hiring': ['p-int-read', 'p-cand-read', 'p-req-read'],
    'role-interviewer': ['p-int-read', 'p-int-eval', 'p-cand-read'],
    'role-candidate': []
  };
  for (const [rId, pIds] of Object.entries(roleGrants)) {
    for (const pId of pIds) {
      await db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(rId, pId);
    }
  }

  const users = [
    ['usr-admin', 'admin@company.com', 'Admin System', 'ACTIVE', 'role-admin'],
    ['usr-hr', 'hr@company.com', 'HR Director', 'ACTIVE', 'role-hr'],
    ['usr-recruiter-1', 'recruiter1@company.com', 'Recruiter Alpha', 'ACTIVE', 'role-recruiter'],
    ['usr-recruiter-2', 'recruiter2@company.com', 'Recruiter Beta', 'ACTIVE', 'role-recruiter'],
    ['usr-recruiter-support', 'recruitersupport@company.com', 'Recruiter Support', 'ACTIVE', 'role-recruiter'],
    ['usr-interviewer-1', 'interviewer1@company.com', 'Lead Engineer', 'ACTIVE', 'role-interviewer'],
    ['usr-interviewer-2', 'interviewer2@company.com', 'Senior Architect', 'ACTIVE', 'role-interviewer'],
    ['usr-interviewer-3', 'interviewer3@company.com', 'Tech Manager', 'ACTIVE', 'role-interviewer'],
    ['usr-interviewer-unassigned', 'interviewer_free@company.com', 'External Reviewer', 'ACTIVE', 'role-interviewer'],
    ['usr-candidate', 'candidate@external.com', 'Applicant John', 'ACTIVE', 'role-candidate']
  ];
  for (const [id, email, fullName, status, roleId] of users) {
    await db.prepare('INSERT INTO users (id, email, full_name, status) VALUES (?, ?, ?, ?)').run(id, email, fullName, status);
    await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(id, roleId);
  }

  await db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, hiring_manager_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('req-backend', 'REQ-BE-01', 'Backend Node.js Engineer', 'Engineering', 'usr-recruiter-1', 'usr-hiring', 'OPEN');

  await db.prepare(`
    INSERT INTO requisitions (id, code, title, department_name, recruiter_id, hiring_manager_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('req-frontend', 'REQ-FE-01', 'Frontend React Engineer', 'Engineering', 'usr-recruiter-2', 'usr-hiring', 'OPEN');

  await db.prepare(`
    INSERT INTO requisition_recruiter_supports (requisition_id, user_id)
    VALUES (?, ?)
  `).run('req-backend', 'usr-recruiter-support');

  await db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-nguyen', 'req-backend', 'Nguyen Van A', 'nguyena@test.vn', '0912345678', 'SCREENING', '2026-03-01T08:00:00Z');

  await db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-tran', 'req-backend', 'Tran Thi B', 'tranb@test.vn', '0987654321', 'NEW', '2026-03-02T08:00:00Z');

  await db.prepare(`
    INSERT INTO candidates (id, requisition_id, full_name, email, phone_number, stage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('cand-le', 'req-frontend', 'Le Van C', 'lec@test.vn', '0933333333', 'NEW', '2026-03-03T08:00:00Z');
}

async function runTestSuite() {
  const rawDb = new DatabaseSync(':memory:');
  const db = sqliteBoundary(rawDb);
  await setupFixture(db, 'sqlite');

  const reqService = new RequisitionService(db);
  const timelineService = new CandidateTimelineService(db);

  const recruiter1 = { id: 'usr-recruiter-1', roles: ['RECRUITER'], permissions: ['interview.create', 'interview.read', 'candidate.read', 'candidate.update'] };
  const recruiter2 = { id: 'usr-recruiter-2', roles: ['RECRUITER'], permissions: ['interview.create', 'interview.read', 'candidate.read', 'candidate.update'] };
  const recruiterSupport = { id: 'usr-recruiter-support', roles: ['RECRUITER'], permissions: ['interview.create', 'interview.read', 'candidate.read', 'candidate.update'] };
  const adminActor = { id: 'usr-admin', roles: ['ADMIN'], permissions: ['interview.create', 'interview.read', 'interview.update', 'interview.evaluate', 'candidate.read', 'candidate.update'] };
  const int1Actor = { id: 'usr-interviewer-1', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read'] };
  const int2Actor = { id: 'usr-interviewer-2', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read'] };
  const intUnassigned = { id: 'usr-interviewer-unassigned', roles: ['INTERVIEWER'], permissions: ['interview.read', 'interview.evaluate', 'candidate.read'] };
  const candActor = { id: 'usr-candidate', roles: ['CANDIDATE'], permissions: [] };

  await test('TC01: Valid in-person interview creation with room and default duration', async () => {
    const res = await reqService.createInterview({
      candidateId: 'cand-nguyen',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1 - Kỹ thuật chuyên môn',
      scheduledTime: '2030-06-01T09:00:00',
      interviewFormat: 'IN_PERSON',
      meetingRoom: 'Phòng họp P.302 (Tầng 3)'
    }, recruiter1);

    assert.equal(res.candidateId, 'cand-nguyen');
    assert.equal(res.interviewFormat, 'IN_PERSON');
    assert.equal(res.meetingRoom, 'Phòng họp P.302 (Tầng 3)');
    assert.equal(res.durationMinutes, 60);
    assert.equal(res.locationOrLink, 'Phòng họp P.302 (Tầng 3)');

    const row = await db.prepare('SELECT * FROM interviews WHERE id = ?').get(res.id);
    assert.equal(row.interview_format, 'IN_PERSON');
    assert.equal(row.meeting_room, 'Phòng họp P.302 (Tầng 3)');
    assert.equal(row.duration_minutes, 60);
    assert.equal(row.location_or_link, 'Phòng họp P.302 (Tầng 3)');

    const candRow = await db.prepare('SELECT stage FROM candidates WHERE id = ?').get('cand-nguyen');
    assert.equal(candRow.stage, 'INTERVIEW');
  });

  await test('TC02: Valid online interview creation with meeting link and custom duration', async () => {
    const res = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-2',
      roundName: 'Vòng 2 - Phỏng vấn Quản lý',
      scheduledTime: '2030-06-01T14:00:00',
      durationMinutes: 45,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/abc-defg-hij'
    }, recruiterSupport);

    assert.equal(res.candidateId, 'cand-tran');
    assert.equal(res.interviewFormat, 'ONLINE');
    assert.equal(res.meetingLink, 'https://meet.google.com/abc-defg-hij');
    assert.equal(res.durationMinutes, 45);
    assert.equal(res.locationOrLink, 'https://meet.google.com/abc-defg-hij');

    const row = await db.prepare('SELECT * FROM interviews WHERE id = ?').get(res.id);
    assert.equal(row.interview_format, 'ONLINE');
    assert.equal(row.meeting_link, 'https://meet.google.com/abc-defg-hij');
    assert.equal(row.duration_minutes, 45);
  });

  await test('TC03: Single interviewer assignment records primary in interviews and interview_interviewers', async () => {
    const res = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1 - Kỹ thuật chuyên môn',
      scheduledTime: '2030-06-02T10:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-single'
    }, recruiter1);

    const interviewRow = await db.prepare('SELECT interviewer_id FROM interviews WHERE id = ?').get(res.id);
    assert.equal(interviewRow.interviewer_id, 'usr-interviewer-1');

    const assigned = await db.prepare('SELECT user_id, role FROM interview_interviewers WHERE interview_id = ?').all(res.id);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].user_id, 'usr-interviewer-1');
    assert.equal(assigned[0].role, 'PRIMARY');
  });

  await test('TC04: Multiple interviewer assignment records all members and designates primary', async () => {
    const res = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      interviewerIds: ['usr-interviewer-1', 'usr-interviewer-2', 'usr-interviewer-3'],
      roundName: 'Vòng 3 - Phỏng vấn Hội đồng',
      scheduledTime: '2030-06-03T09:00:00',
      durationMinutes: 90,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/panel-meet'
    }, recruiter1);

    const assigned = await db.prepare('SELECT user_id, role FROM interview_interviewers WHERE interview_id = ? ORDER BY user_id ASC').all(res.id);
    assert.equal(assigned.length, 3);
    const primary = assigned.find(a => a.role === 'PRIMARY');
    assert.ok(primary);
    assert.equal(primary.user_id, 'usr-interviewer-1');
    assert.deepEqual(assigned.map(a => a.user_id).sort(), ['usr-interviewer-1', 'usr-interviewer-2', 'usr-interviewer-3']);
  });

  await test('TC05: Rejection when scheduling in the past', async () => {
    await denied(() => reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1',
      scheduledTime: '2020-01-01T09:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/past-meet'
    }, recruiter1), 400);
  });

  await test('TC06: Rejection when duration is invalid (less than 15 or greater than 480 or non-integer)', async () => {
    for (const badDuration of [0, 5, 14, 481, 1000, -30, 'invalid']) {
      await denied(() => reqService.createInterview({
        candidateId: 'cand-tran',
        requisitionId: 'req-backend',
        interviewerId: 'usr-interviewer-1',
        roundName: 'Vòng 1',
        scheduledTime: '2030-06-04T09:00:00',
        durationMinutes: badDuration,
        interviewFormat: 'ONLINE',
        meetingLink: 'https://meet.google.com/test-duration'
      }, recruiter1), 400);
    }
  });

  await test('TC07: Rejection when meeting room is missing for IN_PERSON interview', async () => {
    for (const badRoom of [null, undefined, '', '   ']) {
      await denied(() => reqService.createInterview({
        candidateId: 'cand-tran',
        requisitionId: 'req-backend',
        interviewerId: 'usr-interviewer-1',
        roundName: 'Vòng 1',
        scheduledTime: '2030-06-04T10:00:00',
        interviewFormat: 'IN_PERSON',
        meetingRoom: badRoom
      }, recruiter1), 400);
    }
  });

  await test('TC08: Rejection when meeting link is missing for ONLINE interview', async () => {
    for (const badLink of [null, undefined, '', '   ']) {
      await denied(() => reqService.createInterview({
        candidateId: 'cand-tran',
        requisitionId: 'req-backend',
        interviewerId: 'usr-interviewer-1',
        roundName: 'Vòng 1',
        scheduledTime: '2030-06-04T11:00:00',
        interviewFormat: 'ONLINE',
        meetingLink: badLink
      }, recruiter1), 400);
    }
  });

  await test('TC09: Interviewer list validation: empty and duplicates rejected with 400', async () => {
    await denied(() => reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerIds: [],
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-04T13:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-empty'
    }, recruiter1), 400);

    await denied(() => reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      interviewerIds: ['usr-interviewer-1', 'usr-interviewer-2', 'usr-interviewer-1'],
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-04T13:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-duplicate'
    }, recruiter1), 400);

    const res = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      interviewerIds: ['usr-interviewer-1', 'usr-interviewer-2'],
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-04T13:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-valid'
    }, recruiter1);

    assert.ok(res.id);
    const assigned = await db.prepare('SELECT user_id FROM interview_interviewers WHERE interview_id = ?').all(res.id);
    assert.equal(assigned.length, 2);
  });

  await test('TC10: Scheduled interview appears on candidate interaction timeline', async () => {
    const timelineRes = await timelineService.getCandidateTimeline('cand-nguyen', recruiter1);
    assert.equal(timelineRes.success, true);
    const events = timelineRes.data.timeline || timelineRes.data.events || [];
    assert.ok(Array.isArray(events) && events.length > 0);
    const schedEvent = events.find(e => e.eventType === 'INTERVIEW_SCHEDULED');
    assert.ok(schedEvent, 'Candidate timeline must include INTERVIEW_SCHEDULED event');
    assert.equal(schedEvent.details.candidateId, 'cand-nguyen');
  });

  await test('TC11: All assigned interviewers see the interview on their schedule query', async () => {
    const int1Res = await reqService.getInterviews({ viewer: int1Actor });
    const int2Res = await reqService.getInterviews({ viewer: int2Actor });
    const int1List = int1Res.interviews || [];
    const int2List = int2Res.interviews || [];

    assert.ok(int1List.length > 0);
    assert.ok(int2List.length > 0);
    const sharedIv1 = int1List.find(iv => iv.scheduledTime && Date.parse(iv.scheduledTime) === Date.parse('2030-06-03T09:00:00+07:00'));
    const sharedIv2 = int2List.find(iv => iv.scheduledTime && Date.parse(iv.scheduledTime) === Date.parse('2030-06-03T09:00:00+07:00'));
    assert.ok(sharedIv1, 'Interviewer 1 must see panel interview');
    assert.ok(sharedIv2, 'Interviewer 2 must see panel interview');
    assert.equal(sharedIv1.id, sharedIv2.id);
  });

  await test('TC12: Unassigned interviewer cannot see interviews they are not part of', async () => {
    const unassignedRes = await reqService.getInterviews({ viewer: intUnassigned });
    const unassignedList = unassignedRes.interviews || [];
    assert.equal(unassignedList.length, 0);
  });

  await test('TC13: Recruiter scope enforcement: unassigned recruiter rejected with 403', async () => {
    await denied(() => reqService.createInterview({
      candidateId: 'cand-nguyen',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-05T09:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-forbidden'
    }, recruiter2), 403);
  });

  await test('TC14: Unauthorized roles (CANDIDATE) cannot create interview', async () => {
    await denied(() => reqService.createInterview({
      candidateId: 'cand-nguyen',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-05T09:00:00',
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-candidate-forbidden'
    }, candActor), 403);
  });

  await test('TC15: Backward compatibility: legacy payload creates interview successfully', async () => {
    const legacyRes = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1 - Legacy Call',
      scheduledTime: '2030-06-06T09:00:00',
      locationOrLink: 'https://meet.google.com/legacy-link'
    }, recruiter1);

    assert.ok(legacyRes.id);
    assert.equal(legacyRes.durationMinutes, 60);
    assert.equal(legacyRes.interviewFormat, 'ONLINE');
    assert.equal(legacyRes.meetingLink, 'https://meet.google.com/legacy-link');
    assert.equal(legacyRes.locationOrLink, 'https://meet.google.com/legacy-link');
  });

  await test('TC16: Legacy interview records with null duration/format display and evaluate safely', async () => {
    await db.prepare(`
      INSERT INTO interviews (id, code, candidate_id, requisition_id, interviewer_id, round_name, scheduled_time, duration_minutes, interview_format, location_or_link, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('iv-legacy-null', 'IV-LEG-01', 'cand-tran', 'req-backend', 'usr-interviewer-1', 'Round Legacy', '2030-06-07T09:00:00', null, null, 'Meeting Room A', 'SCHEDULED');

    await db.prepare("INSERT INTO interview_interviewers(interview_id,user_id,role) VALUES('iv-legacy-null','usr-interviewer-1','PRIMARY')").run();
    const res = await reqService.getInterviews({ viewer: recruiter1 });
    const list = res.interviews || [];
    const item = list.find(x => x.id === 'iv-legacy-null');
    assert.ok(item);
    assert.equal(item.durationMinutes, 60);
    assert.equal(item.interviewFormat, 'IN_PERSON');

    const evalRes = await reqService.updateInterviewStatus('iv-legacy-null', 'COMPLETED', 'Excellent candidate', 5, int1Actor);
    assert.equal(evalRes.success, true);
    assert.equal(evalRes.statusCode, 200);

    const updated = await db.prepare('SELECT status, score FROM interviews WHERE id = ?').get('iv-legacy-null');
    assert.equal(updated.status, 'COMPLETED');
    assert.equal(updated.score, 5);
  });

  await test('TC17: Candidate scheduling conflict detection: overlapping time rejected with 409', async () => {
    await reqService.createInterview({
      candidateId: 'cand-nguyen',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-10T10:00:00',
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-conflict-cand'
    }, recruiter1);

    await denied(() => reqService.createInterview({
      candidateId: 'cand-nguyen',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-2',
      roundName: 'Vòng 2',
      scheduledTime: '2030-06-10T10:30:00',
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-conflict-cand-2'
    }, recruiter1), 409);
  });

  await test('TC18: Interviewer scheduling conflict detection: overlapping time rejected with 409', async () => {
    await denied(() => reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-10T10:15:00',
      durationMinutes: 45,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-conflict-int'
    }, recruiter1), 409);
  });

  await test('TC19: Abutting interviews permitted without conflict', async () => {
    const res = await reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      roundName: 'Vòng 1 - Abutting',
      scheduledTime: '2030-06-10T11:00:00',
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-abutting'
    }, recruiter1);

    assert.ok(res.id);
  });

  await test('TC20: Atomic transaction rollback on validation failure', async () => {
    const ivCountBefore = (await db.prepare('SELECT count(*) as c FROM interviews').get()).c;
    const iiCountBefore = (await db.prepare('SELECT count(*) as c FROM interview_interviewers').get()).c;

    await denied(() => reqService.createInterview({
      candidateId: 'cand-tran',
      requisitionId: 'req-backend',
      interviewerId: 'usr-interviewer-1',
      interviewerIds: ['usr-interviewer-1', 'usr-candidate'],
      roundName: 'Vòng 1',
      scheduledTime: '2030-06-11T09:00:00',
      durationMinutes: 60,
      interviewFormat: 'ONLINE',
      meetingLink: 'https://meet.google.com/test-rollback'
    }, recruiter1), 400);

    const ivCountAfter = (await db.prepare('SELECT count(*) as c FROM interviews').get()).c;
    const iiCountAfter = (await db.prepare('SELECT count(*) as c FROM interview_interviewers').get()).c;

    assert.equal(ivCountAfter, ivCountBefore);
    assert.equal(iiCountAfter, iiCountBefore);
  });

  await test('TC21: Migration runner schema alter, legacy backfill and idempotency', async () => {
    const rawMigDb = new DatabaseSync(':memory:');
    const migDb = sqliteBoundary(rawMigDb);
    await migDb.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, full_name TEXT);
      CREATE TABLE candidates (id TEXT PRIMARY KEY, full_name TEXT);
      CREATE TABLE interviews (id TEXT PRIMARY KEY, candidate_id TEXT, interviewer_id TEXT, round_name TEXT, scheduled_time TEXT, location_or_link TEXT, status TEXT);
      INSERT INTO users VALUES ('usr-mig-1', 'mig1@test.com', 'Tester Mig 1');
      INSERT INTO candidates VALUES ('cand-1', 'Candidate One');
      INSERT INTO interviews VALUES ('iv-mig-1', 'cand-1', 'usr-mig-1', 'Round 1', '2030-01-01T09:00:00', 'Room 101', 'SCHEDULED');
    `);
    const { migrate } = require('../src/db/migrate-interview-scheduling');
    await migrate(migDb);
    const tableInfo = await migDb.prepare('PRAGMA table_info(interviews)').all();
    const cols = tableInfo.map(c => c.name);
    assert.ok(cols.includes('duration_minutes'));
    assert.ok(cols.includes('interview_format'));
    assert.ok(cols.includes('meeting_room'));
    assert.ok(cols.includes('meeting_link'));

    const backfilled = await migDb.prepare("SELECT * FROM interview_interviewers WHERE interview_id = 'iv-mig-1'").all();
    assert.equal(backfilled.length, 1);
    assert.equal(backfilled[0].user_id, 'usr-mig-1');
    assert.equal(backfilled[0].role, 'PRIMARY');

    await migrate(migDb);
    const count = (await migDb.prepare("SELECT count(*) as c FROM interview_interviewers WHERE interview_id = 'iv-mig-1'").get()).c;
    assert.equal(count, 1);
    const legacy = await migDb.prepare("SELECT interview_format,scheduled_time FROM interviews WHERE id='iv-mig-1'").get();
    assert.equal(legacy.interview_format, null);
    assert.equal(legacy.scheduled_time, '2030-01-01T09:00:00');
    await require('../src/db/migrate-interview-scheduling').verify(migDb);
    await migDb.exec('DROP INDEX idx_interview_interviewers_user');
    await assert.rejects(() => migrate(migDb), /SCHEMA_DRIFT/);
    assert.equal((await migDb.prepare('SELECT COUNT(*) AS n FROM ats_interview_scheduling_migrations').get()).n, 1);
    await migDb.close();
  });

  await test('TC22: Negative helper rejects successful responses and unrelated exceptions', async () => {
    await assert.rejects(() => denied(async () => ({success:true,statusCode:201}), 400), assert.AssertionError);
    await assert.rejects(() => denied(async () => undefined, 400), assert.AssertionError);
    await assert.rejects(() => denied(async () => { throw Error('DATABASE_FAILURE'); }, 400), assert.AssertionError);
    await denied(async () => ({success:false,statusCode:400}), 400);
  });

  await test('TC23: Co-interviewer reads calendar but cannot read or overwrite shared evaluation', async () => {
    const panel = (await reqService.getInterviews({viewer:int2Actor})).interviews.find(row => row.interviewer.id === int1Actor.id);
    assert.ok(panel);
    await db.prepare('UPDATE interviews SET score=9,feedback=? WHERE id=?').run('Primary feedback', panel.id);
    const before = await db.prepare('SELECT * FROM interviews WHERE id=?').get(panel.id);
    await denied(() => reqService.updateInterviewStatus(panel.id,'COMPLETED','Unauthorized',1,int2Actor),403);
    assert.deepEqual(await db.prepare('SELECT * FROM interviews WHERE id=?').get(panel.id),before);
    const visible = (await reqService.getInterviews({viewer:int2Actor})).interviews.find(row => row.id === panel.id);
    assert.equal(visible.score,null);
    assert.equal(visible.feedback,null);
    const primary = (await reqService.getInterviews({viewer:int1Actor})).interviews.find(row => row.id === panel.id);
    assert.equal(primary.score,9);
    assert.equal(primary.feedback,'Primary feedback');
    assert.equal((await reqService.updateInterviewStatus(panel.id,'COMPLETED','Primary allowed',9,int1Actor)).success,true);
    assert.equal((await reqService.updateInterviewStatus(panel.id,'COMPLETED','HR allowed',9,{id:'usr-hr'})).success,true);
    assert.equal((await reqService.updateInterviewStatus(panel.id,'COMPLETED','Admin allowed',9,adminActor)).success,true);
  });

  await test('TC24: Missing interview returns 404 rather than throwing', async () => {
    await denied(() => reqService.updateInterviewStatus('missing-interview','COMPLETED','feedback',5,int1Actor),404);
  });

  await test('TC25: Strict timestamps reject invalid dates, suffixes and invalid timezone offsets', async () => {
    for (const value of ['2030-02-30T09:00','2030-06-01T24:00','2030-06-01T09:00garbage','2030-06-01T09:00Zjunk','2030-06-01T09:00:00+07:99','2030-06-01']) {
      assert.equal(reqService.parseInterviewTimestamp(value),null,value);
    }
    const expected=Date.parse('2030-06-01T02:00:00Z');
    for (const value of ['2030-06-01T09:00','2030-06-01 09:00:00','2030-06-01T09:00:00+07:00','2030-06-01T02:00:00Z']) assert.equal(reqService.parseInterviewTimestamp(value),expected,value);
  });

  const freshFixture = async action => {
    const raw = new DatabaseSync(':memory:');
    raw.exec('PRAGMA foreign_keys=ON');
    const isolated = sqliteBoundary(raw);
    try { await setupFixture(isolated); await action(isolated,new RequisitionService(isolated),raw); }
    finally { await isolated.close(); }
  };
  const newPayload = {candidateId:'cand-nguyen',requisitionId:'req-backend',interviewerIds:['usr-interviewer-1','usr-interviewer-2'],scheduledTime:'2031-06-01T09:00',durationMinutes:60,interviewFormat:'ONLINE',meetingLink:'https://example.invalid/meeting'};

  await test('TC26: New online payload rejects absent links and non-HTTP URLs without database writes', () => freshFixture(async (isolated,service) => {
    for (const link of [undefined,null,'','javascript:alert(1)','ftp://example.invalid/cv','https://user:password@example.invalid/']) {
      const payload={...newPayload};
      if (link===undefined) delete payload.meetingLink; else payload.meetingLink=link;
      await denied(() => service.createInterview(payload,recruiter1),400);
      assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
      assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,0);
      assert.equal((await isolated.prepare("SELECT stage FROM candidates WHERE id='cand-nguyen'").get()).stage,'SCREENING');
    }
  }));

  await test('TC27: Missing, forged, locked and revoked actors cannot create schedules', () => freshFixture(async (isolated,service) => {
    for (const actor of [null,undefined,{id:'unknown',roles:['ADMIN']},{id:'usr-candidate',roles:['ADMIN']}]) await denied(() => service.createInterview(newPayload,actor),403);
    await isolated.prepare("UPDATE users SET status='LOCKED' WHERE id='usr-recruiter-1'").run();
    await denied(() => service.createInterview(newPayload,recruiter1),403);
    await isolated.prepare("UPDATE users SET status='ACTIVE' WHERE id='usr-recruiter-1'").run();
    await isolated.prepare("DELETE FROM role_permissions WHERE role_id='role-recruiter' AND permission_id='p-int-create'").run();
    await denied(() => service.createInterview(newPayload,recruiter1),403);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,0);
    assert.equal((await isolated.prepare("SELECT stage FROM candidates WHERE id='cand-nguyen'").get()).stage,'SCREENING');
  }));

  await test('TC28: Failure after all INSERTs rolls back interviews, memberships and candidate stage', () => freshFixture(async (isolated,service,raw) => {
    const before=await isolated.prepare('SELECT * FROM candidates ORDER BY id').all();
    raw.exec("CREATE TEMP TRIGGER fail_candidate_update BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT,'S602_INJECTED_FAILURE'); END;");
    await assert.rejects(() => service.createInterview(newPayload,recruiter1),/S602_INJECTED_FAILURE/);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,0);
    assert.deepEqual(await isolated.prepare('SELECT * FROM candidates ORDER BY id').all(),before);
    raw.exec('DROP TRIGGER fail_candidate_update');
    assert.equal((await service.createInterview(newPayload,recruiter1)).statusCode,201);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,1);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,2);
  }));

  await test('TC29: Readiness has no stale cache and incomplete schema never drops panel members', () => freshFixture(async (isolated,service) => {
    assert.equal(await service.hasInterviewSchedulingColumns(),true);
    await isolated.exec('DROP TABLE interview_interviewers');
    assert.equal(await service.hasInterviewSchedulingColumns(),false);
    await denied(() => service.createInterview(newPayload,recruiter1),503);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
    assert.equal((await service.createInterview({candidateId:'cand-nguyen',interviewerId:'usr-interviewer-1',scheduledTime:'2031-06-02T09:00',locationOrLink:'Room legacy'},recruiter1)).statusCode,201);
    await isolated.exec('DELETE FROM ats_interview_scheduling_migrations');
    await require('../src/db/migrate-interview-scheduling').migrate(isolated);
    assert.equal(await service.hasInterviewSchedulingColumns(),true);
    assert.equal((await service.createInterview(newPayload,recruiter1)).statusCode,201);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,3);
  }));

  await test('TC30: DDL failure rolls back ledger and columns; retry and drift verification are strict', async () => {
    const isolated=sqliteBoundary(new DatabaseSync(':memory:'));
    try {
      await isolated.exec('CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE candidates(id TEXT PRIMARY KEY); CREATE TABLE interviews(id TEXT PRIMARY KEY,interviewer_id TEXT,scheduled_time TEXT);');
      const exec=isolated.exec.bind(isolated);
      isolated.exec=async sql => { if(sql.includes('ADD COLUMN meeting_room')) throw Error('S602_DDL_FAILURE'); return exec(sql); };
      const runner=require('../src/db/migrate-interview-scheduling');
      await assert.rejects(() => runner.migrate(isolated),/S602_DDL_FAILURE/);
      assert.equal((await isolated.prepare('PRAGMA table_info(interviews)').all()).some(row => row.name==='duration_minutes'),false);
      assert.equal(await isolated.prepare("SELECT name FROM sqlite_master WHERE name='ats_interview_scheduling_migrations'").get(),undefined);
      isolated.exec=exec;
      await runner.migrate(isolated);
      await runner.verify(isolated);
      await isolated.exec('ALTER TABLE interviews DROP COLUMN meeting_link');
      await assert.rejects(() => runner.verify(isolated),/SCHEMA_DRIFT/);
      await assert.rejects(() => runner.migrate(isolated),/SCHEMA_DRIFT/);
      assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM ats_interview_scheduling_migrations').get()).n,1);
    } finally { await isolated.close(); }
  });

  await test('TC31: Concurrent SQLite requests serialize conflict checks before mutation', () => freshFixture(async (isolated,service) => {
    const second=new RequisitionService(isolated);
    const results=await Promise.all([service.createInterview(newPayload,recruiter1),second.createInterview({...newPayload,candidateId:'cand-tran'},recruiter1)]);
    assert.deepEqual(results.map(row => row.statusCode).sort(),[201,409]);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,1);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,2);
    assert.equal((await isolated.prepare("SELECT stage FROM candidates WHERE id='cand-tran'").get()).stage,'NEW');
  }));

  await test('TC32: Co-interviewer calendar does not widen candidate scope even with unrelated recruiter role', () => freshFixture(async (isolated,service) => {
    const created=await service.createInterview(newPayload,recruiter1);
    assert.equal(created.statusCode,201);
    await isolated.prepare('UPDATE interviews SET score=9,feedback=? WHERE id=?').run('Confidential primary feedback',created.id);
    await isolated.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-interviewer-2','role-recruiter')").run();
    const viewer=await new (require('../src/middlewares/rbacMiddleware'))(isolated).getAuthorizedActor('usr-interviewer-2','interview.read');
    const calendar=(await service.getInterviews({viewer})).interviews.find(row => row.id===created.id);
    assert.ok(calendar);
    assert.equal(calendar.score,null);
    assert.equal(calendar.feedback,null);
    assert.equal(Object.hasOwn(calendar.candidate,'email'),false);
    assert.equal(Object.hasOwn(calendar.candidate,'phone'),false);
    const scope=service.candidateVisibility(viewer);
    assert.deepEqual(await isolated.prepare('SELECT c.id FROM candidates c LEFT JOIN requisitions r ON r.id=c.requisition_id WHERE '+scope.condition).all(...scope.params),[]);
    await denied(() => service.updateInterviewStatus(created.id,'COMPLETED','denied',1,viewer),403);
    const before=await isolated.prepare('SELECT * FROM interviews WHERE id=?').get(created.id);
    await denied(() => service.updateInterviewStatus(created.id,'COMPLETED','denied',1),403);
    assert.deepEqual(await isolated.prepare('SELECT * FROM interviews WHERE id=?').get(created.id),before);
  }));

  await test('TC33: New payload cannot use legacy location fallback or silently drop malformed panel IDs', () => freshFixture(async (isolated,service) => {
    const {meetingLink,...withoutLink}=newPayload;
    await denied(() => service.createInterview({...withoutLink,locationOrLink:'https://example.invalid/legacy'},recruiter1),400);
    await denied(() => service.createInterview({...newPayload,interviewFormat:'IN_PERSON',meetingRoom:null,locationOrLink:'Legacy room'},recruiter1),400);
    for(const ids of ['interviewer-1',null,[null],['']]) await denied(() => service.createInterview({...newPayload,interviewerIds:ids},recruiter1),400);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interviews').get()).n,0);
    assert.equal((await isolated.prepare('SELECT COUNT(*) AS n FROM interview_interviewers').get()).n,0);
  }));

  await test('TC34: APPROVER evaluation read scope remains broad only with a current real grant', () => freshFixture(async (isolated,service) => {
    const created=await service.createInterview(newPayload,recruiter1);
    assert.equal(created.statusCode,201);
    await isolated.prepare('UPDATE interviews SET score=9,feedback=? WHERE id=?').run('Primary feedback',created.id);
    await isolated.prepare("INSERT INTO roles(id,code,name) VALUES('test-approver','APPROVER','Synthetic approver')").run();
    await isolated.prepare("INSERT INTO permissions(id,code,name) VALUES('test-evaluation-read','interview.evaluation.read','Synthetic evaluation read')").run();
    await isolated.prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES('test-approver','test-evaluation-read')").run();
    await isolated.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-interviewer-2','test-approver')").run();
    const list=await service.getInterviews({viewer:{id:'usr-interviewer-2'},evaluationsOnly:true});
    assert.equal(list.success,true);
    const item=list.interviews.find(row => row.id===created.id);
    assert.equal(item.score,9);assert.equal(item.feedback,'Primary feedback');
    await denied(() => service.updateInterviewStatus(created.id,'COMPLETED','denied',1,{id:'usr-interviewer-2'}),403);
    await isolated.prepare("DELETE FROM role_permissions WHERE role_id='test-approver'").run();
    const revoked=await service.getInterviews({viewer:{id:'usr-interviewer-2'},evaluationsOnly:true});
    assert.equal(revoked.statusCode,403);assert.deepEqual(revoked.interviews,[]);
  }));

  await test('TC35: Candidate ownership in a multi-role account preserves own contact fields without evaluations', () => freshFixture(async (isolated,service) => {
    const created=await service.createInterview(newPayload,recruiter1);
    assert.equal(created.statusCode,201);
    await isolated.prepare("UPDATE users SET email='nguyena@test.vn' WHERE id='usr-interviewer-2'").run();
    await isolated.prepare("INSERT INTO user_roles(user_id,role_id) VALUES('usr-interviewer-2','role-candidate')").run();
    await isolated.prepare('UPDATE interviews SET score=9,feedback=? WHERE id=?').run('Hidden feedback',created.id);
    const list=await service.getInterviews({viewer:{id:'usr-interviewer-2',email:'forged@example.invalid',roles:['ADMIN']}});
    const item=list.interviews.find(row => row.id===created.id);
    assert.equal(item.candidate.email,'nguyena@test.vn');assert.equal(item.candidate.phone,'0912345678');
    assert.equal(item.score,null);assert.equal(item.feedback,null);
    await denied(() => service.updateInterviewStatus(created.id,'COMPLETED','denied',1,{id:'usr-interviewer-2',roles:['ADMIN']}),403);
  }));

  await test('TC36: Existing ONLINE default is schema drift, never a completed migration', async () => {
    const isolated=sqliteBoundary(new DatabaseSync(':memory:'));
    try {
      await isolated.exec("CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE candidates(id TEXT PRIMARY KEY); CREATE TABLE interviews(id TEXT PRIMARY KEY,interviewer_id TEXT,scheduled_time TEXT,interview_format TEXT DEFAULT 'ONLINE');");
      await assert.rejects(() => require('../src/db/migrate-interview-scheduling').migrate(isolated),/SCHEMA_DRIFT/);
      const columns=await isolated.prepare('PRAGMA table_info(interviews)').all();
      assert.equal(columns.some(row => row.name==='duration_minutes'),false);
      assert.equal(columns.find(row => row.name==='interview_format').dflt_value,"'ONLINE'");
      assert.equal(await isolated.prepare("SELECT name FROM sqlite_master WHERE name='ats_interview_scheduling_migrations'").get(),undefined);
    } finally {await isolated.close();}
  });

  console.log('\n================================================================');
  console.log(`TOTAL: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('================================================================');
}

module.exports = { setupFixture, denied };

if (require.main === module) runTestSuite().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
