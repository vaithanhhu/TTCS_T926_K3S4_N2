const ROLE_PERMISSIONS = {
  ADMIN: ['user.read','user.create','user.update','user.delete','role.read','role.assign','account.lock','account.unlock','requisition.read','department.read','department.manage','competency.read','competency.manage','question_bank.read','question_bank.manage','recruitment_catalog.read','recruitment_catalog.manage','career_page.read','career_page.manage','candidate.read','candidate.create','candidate.update','interview.read','offer.read','audit.read'],
  HR_MANAGER: ['headcount_budget.read','headcount_budget.manage','headcount_budget.override','user.read','role.read','audit.read','requisition.read','requisition.create','requisition.approve','requisition.draft.edit','requisition.edit','approval_configuration.manage','department.read','department.manage','competency.read','competency.manage','question_bank.read','question_bank.manage','recruitment_catalog.read','recruitment_catalog.manage','career_page.read','career_page.manage','candidate.read','candidate.create','candidate.update','interview.read','interview.create','interview.update','interview.evaluate','interview.evaluation.read','offer.read','offer.create','offer.approve','salary_range.read','dashboard.read','report.read'],
  HIRING_MGR: ['headcount_budget.read','requisition.read','requisition.create','requisition.draft.edit','requisition.edit','department.read','competency.read','recruitment_catalog.read','candidate.read','interview.read','interview.evaluation.read','offer.read','dashboard.read','report.read'],
  RECRUITER: ['requisition.read','requisition.edit','department.read','competency.read','recruitment_catalog.read','candidate.read','candidate.create','candidate.update','interview.read','interview.create','interview.update','interview.evaluation.read','offer.read','offer.create','dashboard.read','report.read'],
  INTERVIEWER: ['department.read','competency.read','recruitment_catalog.read','candidate.read','interview.read','interview.evaluate','interview.evaluation.read','question_bank.read'],
  APPROVER: ['department.read','competency.read','recruitment_catalog.read','requisition.read','requisition.approve','candidate.read','interview.evaluation.read','offer.read','offer.approve','dashboard.read','report.read'],
  CANDIDATE: ['candidate.read','candidate.create','interview.read','offer.read']
};
const EXTRA_PERMISSIONS = [
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
async function synchronizePermissions(db) {
  return db.transaction(async () => {
    for (const permission of EXTRA_PERMISSIONS) await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);
    const controlled = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (role !== 'ADMIN') await db.prepare('DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code=?) AND permission_id IN (SELECT id FROM permissions WHERE code IN (' + controlled.map(() => '?').join(',') + ')) AND permission_id NOT IN (SELECT id FROM permissions WHERE code IN (' + permissions.map(() => '?').join(',') + '))').run(role,...controlled,...permissions);
      for (const permission of permissions) await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);
    }
  });
}

async function synchronizeBudgetPermissions(db){return db.transaction(async()=>{const required=code=>code.startsWith('headcount_budget.')||['requisition.edit','requisition.draft.edit'].includes(code);for(const permission of EXTRA_PERMISSIONS.filter(row=>required(row[1])))await db.prepare('INSERT INTO permissions(id,code,name,module,description) VALUES (?,?,?,?,?) ON CONFLICT(code) DO NOTHING').run(...permission,permission[2]);for(const [role,permissions]of Object.entries(ROLE_PERMISSIONS))for(const permission of permissions.filter(required))await db.prepare('INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code=? WHERE r.code=? ON CONFLICT DO NOTHING').run(permission,role);});}

async function main() {
  const db=require('./database').getDatabase();
  try {
    if (!process.argv.includes('--check')) await synchronizePermissions(db);
    const rows=await db.prepare("SELECT r.code AS role,p.code AS permission FROM roles r JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id WHERE p.code IN ('approval_configuration.manage','interview.create') ORDER BY p.code,r.code").all();
    console.log(JSON.stringify({success:true,mode:process.argv.includes('--check')?'CHECK':'SYNC',grants:rows}));
  } finally { await db.close(); }
}

if(require.main===module)main().catch(()=>{console.error('[Permissions] SYNC_FAILED');process.exitCode=1;});
module.exports={synchronizePermissions,synchronizeBudgetPermissions,ROLE_PERMISSIONS};
