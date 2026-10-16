const ROLE_PERMISSIONS = {
  ADMIN: ['user.read','user.create','user.update','user.delete','role.read','role.assign','account.lock','account.unlock','requisition.read','department.read','department.manage','competency.read','competency.manage','question_bank.read','question_bank.manage','recruitment_catalog.read','recruitment_catalog.manage','career_page.read','career_page.manage','candidate.read','candidate.create','candidate.update','interview.read','offer.read','audit.read'],
  HR_MANAGER: ['job_posting.approve','job_posting.publish','job_posting.read','job_posting.manage','requisition.lifecycle.manage','requisition.assign','headcount_budget.read','headcount_budget.manage','headcount_budget.override','user.read','role.read','audit.read','requisition.read','requisition.create','requisition.approve','requisition.draft.edit','requisition.edit','approval_configuration.manage','department.read','department.manage','competency.read','competency.manage','question_bank.read','question_bank.manage','recruitment_catalog.read','recruitment_catalog.manage','career_page.read','career_page.manage','candidate.read','candidate.create','candidate.update','candidate.stage.override','interview.read','interview.create','interview.update','interview.evaluate','interview.evaluation.read','offer.read','offer.create','offer.approve','salary_range.read','dashboard.read','report.read'],
  HIRING_MGR: ['job_posting.read','headcount_budget.read','requisition.read','requisition.create','requisition.draft.edit','requisition.edit','department.read','competency.read','recruitment_catalog.read','candidate.read','interview.read','interview.evaluation.read','offer.read','dashboard.read','report.read'],
  RECRUITER: ['job_posting.read','job_posting.manage','requisition.read','requisition.edit','department.read','competency.read','recruitment_catalog.read','candidate.read','candidate.create','candidate.update','interview.read','interview.create','interview.update','interview.evaluation.read','offer.read','offer.create','dashboard.read','report.read'],
  INTERVIEWER: ['department.read','competency.read','recruitment_catalog.read','candidate.read','interview.read','interview.evaluate','interview.evaluation.read','question_bank.read'],
  APPROVER: ['job_posting.read','department.read','competency.read','recruitment_catalog.read','requisition.read','requisition.approve','candidate.read','interview.evaluation.read','offer.read','offer.approve','dashboard.read','report.read'],
  CANDIDATE: ['candidate.read','candidate.create','interview.read','offer.read']
};
const EXTRA_PERMISSIONS = [
  ['perm-cand-stage-override','candidate.stage.override','Xác nhận ngoại lệ bỏ qua phỏng vấn','CANDIDATES'],
  ['perm-job-approve','job_posting.approve','Duyệt tin tuyển dụng','JOB_POSTINGS'],
  ['perm-job-publish','job_posting.publish','Xuất bản/gỡ tin tuyển dụng','JOB_POSTINGS'],
  ['perm-job-post-read','job_posting.read','Xem tin tuyển dụng nội bộ trong phạm vi','JOB_POSTINGS'],
  ['perm-job-post-manage','job_posting.manage','Soạn tin tuyển dụng trong phạm vi','JOB_POSTINGS'],
  ['perm-req-lifecycle','requisition.lifecycle.manage','Quản lý vòng đời yêu cầu tuyển dụng','REQUISITIONS'],
  ['perm-req-assign','requisition.assign','Ph?n c?ng recruiter','REQUISITIONS'],
  ['perm-budget-read','headcount_budget.read','Xem chỉ tiêu headcount','HEADCOUNT_BUDGETS'],
  ['perm-budget-manage','headcount_budget.manage','Quản lý ngân sách headcount','HEADCOUNT_BUDGETS'],
  ['perm-budget-override','headcount_budget.override','Xác nhận ngoại lệ ngân sách','HEADCOUNT_BUDGETS'],
  ['perm-approval-configuration-manage','approval_configuration.manage','Cấu hình luồng phê duyệt','REQUISITIONS'],
  ['perm-req-draft-edit','requisition.draft.edit','Sửa nháp yêu cầu tuyển dụng của mình','REQUISITIONS'],
  ['perm-req-edit','requisition.edit','Chỉnh sửa yêu cầu tuyển dụng trong phạm vi','REQUISITIONS'],
  ['perm-interview-create','interview.create','Tạo lịch phỏng vấn','INTERVIEWS'],
  ['perm-interview-update','interview.update','Điều phối lịch phỏng vấn','INTERVIEWS'],
  ['perm-interview-evaluation-read','interview.evaluation.read','Xem kết quả đánh giá phỏng vấn','INTERVIEWS'],
  ['perm-dashboard-read','dashboard.read','Xem bảng điều khiển tuyển dụng','REPORTS'],
  ['perm-report-read','report.read','Xem báo cáo tuyển dụng','REPORTS']
];
async function runsynchronizePermissions(db) {
  return db.transaction(async () => {
    for (const permission of EXTRA_PERMISSIONS) await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);
    const controlled = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (role !== 'ADMIN') await db.prepare('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code=?) AND permission_id IN (SELECT id FROM permissions WHERE code IN (' + controlled.map(() => '?').join(',') + ')) AND permission_id NOT IN (SELECT id FROM permissions WHERE code IN (' + permissions.map(() => '?').join(',') + '))').run(role,...controlled,...permissions);
      for (const permission of permissions) await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);
    }
  });
}

async function runsynchronizeBudgetPermissions(db){return db.transaction(async()=>{const required=code=>code.startsWith('headcount_budget.')||['requisition.edit','requisition.draft.edit'].includes(code);for(const permission of EXTRA_PERMISSIONS.filter(row=>required(row[1])))await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);for(const [role,permissions]of Object.entries(ROLE_PERMISSIONS))for(const permission of permissions.filter(required))await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);});}

async function runsynchronizeRecruiterPermissions(db){return db.transaction(async()=>{const related=new Set(['requisition.read','requisition.create','requisition.edit','requisition.draft.edit','requisition.assign','candidate.read','candidate.create','candidate.update','interview.read','interview.create','interview.update','interview.evaluate','interview.evaluation.read','offer.read','offer.create','offer.approve','dashboard.read','report.read']);for(const permission of EXTRA_PERMISSIONS.filter(row=>related.has(row[1])))await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);for(const [role,permissions]of Object.entries(ROLE_PERMISSIONS))for(const permission of permissions.filter(code=>related.has(code)))await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);});}

async function runsynchronizeLifecyclePermissions(db){return db.transaction(async()=>{await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run('perm-req-lifecycle','requisition.lifecycle.manage','Quản lý vòng đời yêu cầu tuyển dụng','REQUISITIONS','Quản lý vòng đời yêu cầu tuyển dụng');await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code='requisition.lifecycle.manage' WHERE r.code='HR_MANAGER' ON CONFLICT DO NOTHING").run();});}

async function runsynchronizeJobPostingPermissions(db){return db.transaction(async()=>{for(const permission of EXTRA_PERMISSIONS.filter(row=>row[1].startsWith('job_posting.')))await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);for(const [role,permissions] of Object.entries(ROLE_PERMISSIONS))for(const permission of permissions.filter(code=>code.startsWith('job_posting.')))await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);});}

async function runsynchronizeJobPublicationPermissions(db){return db.transaction(async()=>{for(const permission of EXTRA_PERMISSIONS.filter(row=>['job_posting.approve','job_posting.publish'].includes(row[1])))await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);for(const code of ['job_posting.approve','job_posting.publish'])await db.prepare("INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code='HR_MANAGER' ON CONFLICT DO NOTHING").run(code);});}

async function runsynchronizeCandidatePortalPermissions(db) {
  return db.transaction(async () => {
    const portalPermissions = [
      ['perm-cand-refer', 'candidate.refer', 'Giới thiệu ứng viên nội bộ', 'CANDIDATES', 'Nhân sự nội bộ giới thiệu ứng viên cho vị trí tuyển dụng'],
      ['perm-cand-parse', 'candidate.cv.parse', 'Bóc tách thông tin CV PDF', 'CANDIDATES', 'Trích xuất thông tin liên hệ từ CV PDF']
    ];
    for (const p of portalPermissions) {
      await db.prepare('INSERT INTO permissions(id, code, name, module, description) VALUES (?, ?, ?, ?, ?) ON CONFLICT(code) DO NOTHING').run(...p);
    }
    const internalRoles = ['ADMIN', 'HR_MANAGER', 'HIRING_MGR', 'RECRUITER', 'INTERVIEWER', 'APPROVER'];
    for (const role of internalRoles) {
      await db.prepare("INSERT INTO role_permissions(role_id, permission_id) SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code='candidate.refer' WHERE r.code=? ON CONFLICT DO NOTHING").run(role);
    }
    for (const role of ['ADMIN', 'HR_MANAGER', 'RECRUITER']) {
      await db.prepare("INSERT INTO role_permissions(role_id, permission_id) SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code='candidate.cv.parse' WHERE r.code=? ON CONFLICT DO NOTHING").run(role);
    }
  });
}

async function main() {
  const db=require('./database').getDatabase();
  try {
    if (!process.argv.includes('--check')) await synchronizePermissions(db);
    const rows=await db.prepare("SELECT r.code AS role,p.code AS permission FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.code IN ('approval_configuration.manage','interview.create') ORDER BY p.code,r.code").all();
    console.log(JSON.stringify({success:true,mode:process.argv.includes('--check')?'CHECK':'SYNC',grants:rows}));
  } finally { await db.close(); }
}

if(require.main===module)main().catch(()=>{console.error('[Permissions] SYNC_FAILED');process.exitCode=1;});
module.exports={synchronizeCandidatePortalPermissions,synchronizeJobPublicationPermissions,synchronizeJobPostingPermissions,synchronizeLifecyclePermissions,synchronizePermissions,synchronizeBudgetPermissions,synchronizeRecruiterPermissions,ROLE_PERMISSIONS};


async function synchronizePermissions(db) {
  if(db.provider!=='postgres')return runsynchronizePermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizePermissions(db));
}

async function synchronizeBudgetPermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeBudgetPermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeBudgetPermissions(db));
}

async function synchronizeRecruiterPermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeRecruiterPermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeRecruiterPermissions(db));
}

async function synchronizeLifecyclePermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeLifecyclePermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeLifecyclePermissions(db));
}

async function synchronizeJobPostingPermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeJobPostingPermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeJobPostingPermissions(db));
}

async function synchronizeJobPublicationPermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeJobPublicationPermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeJobPublicationPermissions(db));
}

async function synchronizeCandidatePortalPermissions(db) {
  if(db.provider!=='postgres')return runsynchronizeCandidatePortalPermissions(db);
  return require(require('node:path').join(__dirname,'schema-executor')).withStandardMigration(db,()=>runsynchronizeCandidatePortalPermissions(db));
}
