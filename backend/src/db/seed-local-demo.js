const crypto = require('node:crypto');
const { hashPassword } = require('../utils/password');

async function seedLocalDemo(db) {
  if (db.provider !== 'sqlite' || process.env.ATS_LOCAL_DEMO !== 'true') throw new Error('LOCAL_SEED_ONLY');
  const Rbac = require('../middlewares/rbacMiddleware'), rbac = new Rbac(db), actors = {};
  for (const [name, email] of Object.entries({ admin: 'admin@company.com', hr: 'hrmanager@company.com', owner: 'hiringmgr@company.com', approver: 'approver@company.com', recruiter: 'recruiter@company.com', interviewer: 'interviewer@company.com' })) {
    const row = await db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (!row) throw new Error('LOCAL_ACCOUNT_MISSING');
    actors[name] = await rbac.getAuthorizedActor(row.id, name === 'owner' ? 'requisition.create' : name === 'interviewer' ? 'interview.evaluate' : 'requisition.read');
    if (!actors[name]) throw new Error('LOCAL_ACCOUNT_PERMISSION_MISSING');
  }
  const supportId = 'local-demo-support-recruiter';
  await db.prepare("INSERT INTO users(id,email,full_name,password_hash,status,department_id,department_name) VALUES (?,?,?,?,'ACTIVE','dept-3',(SELECT name FROM departments WHERE id='dept-3'))")
    .run(supportId, 'recruiter.support@demo.example', 'Recruiter hỗ trợ demo', hashPassword('Ats@123456'));
  await db.prepare("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE code='RECRUITER'").run(supportId);
  const { ApprovalConfigurationService: Configurations } = require('../services/approvalConfigurationService');
  const { HeadcountBudgetService: Budgets } = require('../services/headcountBudgetService');
  const { RequisitionOperationsService: Operations } = require('../services/requisitionOperationsService');
  const Requisitions = require('../services/requisitionService'), Approvals = require('../services/requisitionApprovalService');
  const Competencies = require('../services/competencyService'), Jobs = require('../services/jobPostingService'), Publication = require('../services/jobPostingPublicationService');
  const requisitions = new Requisitions(db), configurations = new Configurations(db), budgets = new Budgets(db), operations = new Operations(db), approvals = new Approvals(db), jobs = new Jobs(db), publication = new Publication(db);
  const neededDate = requisitions.businessDate(new Date(Date.now() + 30 * 86400000)), year = Number(neededDate.slice(0, 4));
  const departments = await db.prepare("SELECT id FROM departments WHERE status='ACTIVE' ORDER BY id").all();
  for (const department of departments) {
    const config = await configurations.create({ departmentId: department.id, levels: [{ order: 1, salaryLimit: 30000000, approverUserId: actors.hr.id }, { order: 2, salaryLimit: 100000000, approverUserId: actors.approver.id }] }, actors.hr.id);
    await configurations.publish(config.id, config.versions[0].id, actors.hr.id);
    for (const budgetYear of [...new Set([Number(requisitions.businessDate().slice(0, 4)), year])]) {
      await budgets.save({ departmentId: department.id, year: budgetYear, approvedHeadcount: 100, annualSalaryBudget: 20000000000 }, actors.hr);
    }
  }
  const competency = new Competencies(db);
  const framework = await competency.createFramework({ code: 'DEMO-ENGINEERING', name: 'Khung năng lực demo', criteria: [{ name: 'Chuyên môn', weight: 60 }, { name: 'Giao tiếp', weight: 40 }] });
  if (!framework.success) throw new Error(framework.code || 'LOCAL_FRAMEWORK_FAILED');
  const title = await competency.createJobTitle({ code: 'DEMO-SOFTWARE', name: 'Kỹ sư phần mềm demo', level: 'Middle', minSalary: 15000000, maxSalary: 35000000, frameworkId: framework.data.id });
  if (!title.success) throw new Error(title.code || 'LOCAL_JOB_TITLE_FAILED');
  const catalogs = new (require('../services/recruitmentCatalogService'))(db);
  for (const value of [{ type: 'WORK_LOCATION', code: 'DEMO-OFFICE', name: 'Văn phòng demo' }, { type: 'WORK_MODE', code: 'DEMO-HYBRID', name: 'Kết hợp tại văn phòng và từ xa' }]) {
    const result = await catalogs.createItem(value);
    if (!result.success) throw new Error(result.code || 'LOCAL_CATALOG_FAILED');
  }
  const location = await db.prepare("SELECT id FROM recruitment_catalog_items WHERE type='WORK_LOCATION' AND status='ACTIVE' ORDER BY display_order,id LIMIT 1").get();
  const mode = await db.prepare("SELECT id FROM recruitment_catalog_items WHERE type='WORK_MODE' AND status='ACTIVE' ORDER BY display_order,id LIMIT 1").get();
  if (!location || !mode) throw new Error('LOCAL_CATALOG_MISSING');
  const document = { formVersion: 'S2-10', departmentId: 'dept-3', jobTitleId: title.data.id, headcount: 2, recruitmentReason: 'NEW_HEADCOUNT', proposedSalaryMin: 20000000, proposedSalaryMax: 25000000, neededDate, jobDescription: 'Phát triển phần mềm và phối hợp với nhóm.\nDữ liệu này chỉ dùng để kiểm thử localhost.', candidateRequirements: 'Có kiến thức lập trình, kỹ năng giao tiếp và làm việc nhóm.', workLocationId: location.id, workModeId: mode.id };
  const create = async (name, extra = {}) => {
    const result = await requisitions.createRequisition({ ...document, title: name, ...extra }, actors.owner);
    if (!result.success) throw new Error(result.code || 'LOCAL_REQUISITION_FAILED');
    return result.data.id;
  };
  const submit = id => approvals.submit(id, { requestId: crypto.randomUUID() }, actors.owner);
  const completeApproval = async id => {
    const workflow = await submit(id);
    while ((await approvals.read(workflow.id, actors.hr)).status === 'PENDING') {
      const current = await approvals.read(workflow.id, actors.hr), step = current.steps.find(row => row.status === 'PENDING');
      const actor = Object.values(actors).find(actor => actor.id === step.approver_id);
      await approvals.decide(workflow.id, { requestId: crypto.randomUUID(), expectedVersion: current.version, expectedStepId: step.id, action: 'APPROVE', comment: 'Phê duyệt dữ liệu demo localhost' }, actor);
    }
    return workflow.id;
  };
  const draft = await create('DEMO — Nháp để chỉnh sửa', { status: 'DRAFT' });
  const readyToSubmit = await create('DEMO — Sẵn sàng gửi duyệt');
  const pending = await create('DEMO — Chờ duyệt hai cấp', { proposedSalaryMin: 30000000, proposedSalaryMax: 35000000 });
  await submit(pending);
  const approved = await create('DEMO — Đã duyệt để soạn tin');
  await completeApproval(approved);
  const published = await create('DEMO — Tin tuyển dụng công khai');
  await completeApproval(published);
  for (const id of [approved, published]) await operations.assign(id, { requestId: crypto.randomUUID(), expectedVersion: 0, primaryRecruiterId: actors.recruiter.id, supportRecruiterIds: [supportId], reason: 'Phân công demo localhost' }, actors.hr);
  const posting = await jobs.save(published, null, { requestId: crypto.randomUUID(), expectedSourceHash: (await jobs.context(published, actors.recruiter)).sourceHash, applicationDeadline: neededDate, showSalary: false }, actors.recruiter);
  for (const [action, actor] of [['SUBMIT', actors.recruiter], ['APPROVE', actors.hr], ['PUBLISH', actors.admin]]) {
    await publication.act(posting.id, { requestId: crypto.randomUUID(), expectedVersion: (await publication.read(posting.id, actor)).version, action }, actor);
  }
  const candidate = await requisitions.createCandidate({ fullName: 'Ứng viên demo localhost', email: 'candidate@example.com', requisitionId: published, stage: 'NEW' }, actors.recruiter);
  if (!candidate.success) throw new Error(candidate.code || 'LOCAL_CANDIDATE_FAILED');
  const interview = await requisitions.createInterview({ candidateId: candidate.data.id, requisitionId: published, interviewerId: actors.interviewer.id, scheduledTime: new Date(Date.now() + 2 * 86400000).toISOString(), roundName: 'Phỏng vấn demo', locationOrLink: 'Phòng họp demo' }, actors.hr);
  if (!interview.success) throw new Error(interview.code || 'LOCAL_INTERVIEW_FAILED');
  await db.prepare('UPDATE career_page_settings SET introduction=? WHERE id=1').run('ATS Sprint 1–3: môi trường demo localhost, không phải dữ liệu doanh nghiệp thật.');
  return { neededDate, budgetYear: year, draft, readyToSubmit, pending, approved, published, postingId: posting.id, candidateId: candidate.data.id, interviewId: interview.data.id, supportRecruiter: 'recruiter.support@demo.example', deferred: ['S2-05-AC2', 'S2-06-AC4'] };
}

module.exports = { seedLocalDemo };
