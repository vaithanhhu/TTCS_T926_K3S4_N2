const crypto = require('node:crypto');
const Rbac = require('../middlewares/rbacMiddleware');
const Requisitions = require('./requisitionService');
const { ApprovalConfigurationService, ApprovalConfigurationError } = require('./approvalConfigurationService');

class RequisitionApprovalService {
  constructor(db) { this.db=db; this.rbac=new Rbac(db); this.requisitions=new Requisitions(db); this.configurations=new ApprovalConfigurationService(db); }
  fail(code,message,status=409) { throw new ApprovalConfigurationError(code,message,status); }
  async permission(user,permission) { if(!user?.id||!await this.rbac.hasPermission(user.id,permission))this.fail('APPROVAL_FORBIDDEN','Bạn không có quyền thực hiện thao tác này.',403); }
  async transactionPermission(user,permission) {
    const actor=await this.rbac.getAuthorizedActor(user.id,permission);
    if(!actor)this.fail('APPROVAL_FORBIDDEN','Tài khoản hoặc quyền xử lý không còn hiệu lực.',403);
    return {...user,...actor};
  }
  async lock(key) { if(this.db.provider==='postgres')await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('requisition-approval:'+key); }
  request(data) { if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.requestId!=='string'||!data.requestId.trim()||data.requestId.length>128)this.fail('APPROVAL_REQUEST_ID_REQUIRED','Thiếu mã chống gửi trùng hợp lệ.',400); }
  fingerprint(type,id,data) { const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;return crypto.createHash('sha256').update(JSON.stringify(sorted({type,id,data}))).digest('hex'); }
  async replay(user,data,fingerprint) {
    const event=await this.db.prepare('SELECT fingerprint,response_json FROM requisition_approval_events WHERE actor_id=? AND request_id=?').get(user.id,data.requestId);
    if(!event)return null;if(event.fingerprint!==fingerprint)this.fail('APPROVAL_RETRY_CONFLICT','Mã yêu cầu đã được dùng cho thao tác khác.');return JSON.parse(event.response_json);
  }
  async workflow(id) { const row=await this.db.prepare('SELECT * FROM requisition_approval_workflows WHERE id=?').get(id);if(!row)this.fail('APPROVAL_WORKFLOW_NOT_FOUND','Không tìm thấy hồ sơ phê duyệt.',404);return row; }
  async submission(id) { const row=await this.db.prepare('SELECT * FROM requisition_approval_submissions WHERE id=?').get(id);return {...row,document:JSON.parse(row.document_json)}; }
  async steps(submissionId) { return this.db.prepare('SELECT * FROM requisition_approval_steps WHERE submission_id=? ORDER BY level_order').all(submissionId); }
  summary(workflow) { return {id:workflow.id,requisitionId:workflow.requisition_id,status:workflow.status,version:workflow.version,submissionId:workflow.current_submission_id,...(workflow.appliedRevision?{appliedRevision:workflow.appliedRevision}: {})}; }
  async event(workflow,user,action,comment,data,fingerprint,stepId=null) {
    const response=this.summary(workflow);
    await this.db.prepare('INSERT INTO requisition_approval_events(id,workflow_id,submission_id,step_id,workflow_version,actor_id,actor_name,action,comment,request_id,fingerprint,response_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('ape-'+crypto.randomUUID(),workflow.id,workflow.current_submission_id,stepId,workflow.version,user.id,user.fullName||user.id,action,comment||null,data.requestId,fingerprint,JSON.stringify(response));return response;
  }
  async validateDocument(previous,changes,user) {
    if(!changes||typeof changes!=='object'||Array.isArray(changes))this.fail('INVALID_APPROVAL_DOCUMENT','Nội dung bổ sung phải là đối tượng hợp lệ.',400);
    const allowed=['title','jobTitleId','departmentId','headcount','recruitmentReason','proposedSalaryMin','proposedSalaryMax','neededDate','jobDescription','candidateRequirements','salaryJustification','recruiterId','workLocationId','workModeId'];
    if(Object.keys(changes).some(key=>!allowed.includes(key)))this.fail('INVALID_APPROVAL_DOCUMENT_FIELD','Nội dung bổ sung chứa trường không được phép.',400);
    const validation=await this.requisitions.validateS210({...changes,status:'OPEN'},{...previous,status:previous.status||'OPEN'},user);
    if(!validation.success)throw new ApprovalConfigurationError(validation.code,validation.message,validation.statusCode||400);
    return {...validation.values,title:validation.values.title||validation.jobTitle.name,departmentName:validation.department.name,createdBy:previous.createdBy,code:previous.code,requisitionId:previous.requisitionId||previous.id,recruitmentStatus:previous.recruitmentStatus||previous.status};
  }
  validateChain(creatorId,approverIds) {
    if(approverIds.includes(creatorId))this.fail('SELF_APPROVAL_FORBIDDEN','Người tạo không được có mặt trong chuỗi duyệt của chính hồ sơ mình.',403);
    if(new Set(approverIds).size!==approverIds.length)this.fail('REPEATED_APPROVER_FORBIDDEN','Mỗi người chỉ được xuất hiện một lần trong chuỗi phê duyệt.');
  }
  async lockedRequisition(id) {
    await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(id);
    const item=await this.requisitions.getRequisitionById(id);
    if(!item)this.fail('REQUISITION_NOT_FOUND','Không tìm thấy yêu cầu tuyển dụng.',404);
    return item;
  }
  async submissionActor(original,user,data) {
    if(!original.createdBy)this.fail('APPROVAL_CREATOR_UNAVAILABLE','Yêu cầu chưa có người tạo xác thực; không thể gửi duyệt.');
    const access=await this.requisitions.requisitionAccess(original,user,true,true);
    if(!access.success)throw new ApprovalConfigurationError(access.code,access.message,access.statusCode);
    if(original.status!=='OPEN')this.fail('REQUISITION_EDIT_STATE_FORBIDDEN','Yêu cầu tuyển dụng đang ở trạng thái không cho phép chỉnh sửa.');
    const onBehalf=original.createdBy!==user.id;
    if(onBehalf&&!user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))this.fail('APPROVAL_OWNER_REQUIRED','Chỉ người tạo hoặc HR Manager/Admin trong phạm vi được gửi hồ sơ.',403);
    const reason=data.reason==null?'':data.reason;
    if(typeof reason!=='string'||reason.length>4000||(onBehalf&&!reason.trim()))this.fail('APPROVAL_DELEGATION_REASON_REQUIRED','Gửi thay phải có lý do không rỗng, tối đa 4000 ký tự.',400);
    return {actorId:user.id,actorName:user.fullName||user.id,creatorId:original.createdBy,onBehalf,reason:reason.trim(),submittedAt:new Date().toISOString()};
  }
  async context(requisitionId,user) {
    await this.permission(user,'requisition.read');
    user=await this.transactionPermission(user,'requisition.read');
    const original=await this.requisitions.getRequisitionById(requisitionId);
    const access=await this.requisitions.requisitionAccess(original,user,true,true);
    if(!access.success)throw new ApprovalConfigurationError(access.code,access.message,access.statusCode);
    const workflow=await this.db.prepare('SELECT id,status,version FROM requisition_approval_workflows WHERE requisition_id=?').get(requisitionId);
    const canSubmit=(original.createdBy===user.id||user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))&&await this.rbac.hasPermission(user.id,'requisition.create');
    return {requisitionId,creatorId:original.createdBy,effectiveDocument:original,editVersion:this.requisitions.approvalContentHash(original),workflow:workflow||null,canSubmit,onBehalf:original.createdBy!==user.id};
  }
  async revisionDocument(original,previous,changes,user,data,audit) {
    if(data.expectedDocumentHash!=null&&data.expectedDocumentHash!==this.requisitions.approvalContentHash(original))this.fail('REQUISITION_REVISION_STALE','Nội dung đang có hiệu lực đã thay đổi. Vui lòng tải lại trước khi gửi.');
    if(!changes||typeof changes!=='object'||Array.isArray(changes))this.fail('INVALID_APPROVAL_DOCUMENT','Nội dung revision phải là đối tượng hợp lệ.',400);
    const proposed={...changes};
    if(Object.hasOwn(proposed,'departmentName')){
      if(typeof proposed.departmentName!=='string')this.fail('INVALID_DEPARTMENT','Phòng ban không hợp lệ.',400);
      const matches=await this.db.prepare("SELECT id FROM departments WHERE name=? AND status='ACTIVE'").all(proposed.departmentName.trim());
      if(matches.length!==1||(proposed.departmentId&&proposed.departmentId!==matches[0].id))this.fail('INVALID_DEPARTMENT','Cần chọn phòng ban hợp lệ bằng mã phòng ban.',400);
      proposed.departmentId=matches[0].id;delete proposed.departmentName;
    }
    if(Object.hasOwn(proposed,'recruiterId')&&(proposed.recruiterId||null)!==(original.recruiterId||null))this.fail('INVALID_APPROVAL_DOCUMENT_FIELD','Phân công Recruiter là thao tác vận hành riêng.',400);
    const document=await this.validateDocument(previous,proposed,user);
    document.approvalRevision={...audit,applyToMain:true,baseHash:this.requisitions.approvalContentHash(original),effectiveContent:this.requisitions.approvalContent(original)};
    return document;
  }
  async applyRevision(workflow,submission,actor) {
    const revision=submission.document.approvalRevision;
    if(!revision?.applyToMain)return;
    const original=await this.lockedRequisition(workflow.requisition_id);
    if(original.status!=='OPEN')this.fail('REQUISITION_EDIT_STATE_FORBIDDEN','Yêu cầu tuyển dụng đang ở trạng thái không cho phép áp dụng thay đổi.');
    if(this.requisitions.approvalContentHash(original)!==revision.baseHash)this.fail('REQUISITION_REVISION_STALE','Dữ liệu nền của revision đã thay đổi; không thể ghi đè.');
    const document=submission.document;
    const validation=await this.requisitions.validateS210({...document,recruiterId:original.recruiterId,status:'OPEN'},original,null);
    if(!validation.success)throw new ApprovalConfigurationError(validation.code,validation.message,validation.statusCode||400);
    const v=validation.values;
    await this.db.prepare(`UPDATE requisitions SET title=?,job_title_id=?,department_id=?,department_name=?,headcount=?,hiring_manager_id=?,
      recruitment_reason=?,proposed_salary_min=?,proposed_salary_max=?,needed_date=?,job_description=?,candidate_requirements=?,salary_justification=?,
      work_location_id=?,work_mode_id=?,s210_version=1,updated_at=datetime('now') WHERE id=?`).run(v.title||validation.jobTitle.name,v.jobTitleId,v.departmentId,validation.department.name,v.headcount,validation.department.manager_id,
      v.recruitmentReason,v.proposedSalaryMin,v.proposedSalaryMax,v.neededDate,v.jobDescription,v.candidateRequirements,v.salaryJustification,v.workLocationId,v.workModeId,original.id);
    const appliedHash=this.requisitions.approvalContentHash(await this.requisitions.getRequisitionById(original.id));
    if(await require('./jobPostingPublicationService').available(this.db))await new(require('./jobPostingPublicationService'))(this.db).invalidateSource(original.id,appliedHash,actor);
    return {revision:submission.revision,submissionId:submission.id,contentHash:appliedHash};
  }
  async saveSubmission(workflow,document,chain,number) {
    this.validateChain(workflow.creator_id,chain.levels.map(level=>level.approverUserId));
    const id='aps-'+crypto.randomUUID();
    const snapshotId=number===1?workflow.id:id;
    if(number!==1)await this.db.prepare('INSERT INTO requisition_approval_snapshots(workflow_id,requisition_id,configuration_version_id,snapshot_json) VALUES (?,?,?,?)').run(snapshotId,workflow.requisition_id,chain.configurationVersionId,JSON.stringify({...chain,workflowId:snapshotId,requisitionId:workflow.requisition_id}));
    await this.db.prepare('INSERT INTO requisition_approval_submissions(id,workflow_id,revision,approval_snapshot_id,document_json) VALUES (?,?,?,?,?)').run(id,workflow.id,number,snapshotId,JSON.stringify(document));
    for(const level of chain.levels)await this.db.prepare('INSERT INTO requisition_approval_steps(id,submission_id,level_order,approver_id,approver_name,status) VALUES (?,?,?,?,?,?)').run('ast-'+crypto.randomUUID(),id,level.order,level.approverUserId,level.approverName,level.order===1?'PENDING':'WAITING');
    return id;
  }
  async submit(requisitionId,data,user) {
    this.request(data);await this.permission(user,'requisition.create');if(typeof requisitionId!=='string'||!requisitionId.trim())this.fail('INVALID_APPROVAL_REQUISITION','Thiếu mã yêu cầu tuyển dụng hợp lệ.',400);const fingerprint=this.fingerprint('SUBMIT',requisitionId,data);
    return this.db.transaction(async()=>{
      user=await this.transactionPermission(user,'requisition.create');
      await this.lock('request:'+user.id+':'+data.requestId);const replay=await this.replay(user,data,fingerprint);if(replay)return replay;
      await this.lock('requisition:'+requisitionId);
      await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(requisitionId);
      const original=await this.requisitions.getRequisitionById(requisitionId);if(!original)this.fail('REQUISITION_NOT_FOUND','Không tìm thấy yêu cầu tuyển dụng.',404);
      if(!original.createdBy)this.fail('APPROVAL_CREATOR_UNAVAILABLE','Yêu cầu chưa có thông tin người tạo xác thực; không thể gửi duyệt.');
      const audit=await this.submissionActor(original,user,data);
      if(await this.db.prepare('SELECT id FROM requisition_approval_workflows WHERE requisition_id=?').get(requisitionId))this.fail('APPROVAL_WORKFLOW_EXISTS','Yêu cầu đã có workflow. Hãy mở hồ sơ để theo dõi hoặc gửi lại.');
      if(data.document&&typeof data.expectedDocumentHash!=='string')this.fail('APPROVAL_EXPECTATION_REQUIRED','Thiếu phiên bản dữ liệu đang có hiệu lực.',400);
      const document=data.document?await this.revisionDocument(original,original,data.document,user,data,audit):await this.validateDocument(original,{},user);
      if(!data.document)document.submissionAudit=audit;
      const workflow={id:'apw-'+crypto.randomUUID(),requisition_id:requisitionId,creator_id:original.createdBy,status:'PENDING',version:1};
      let chain;
      if(data.document){await this.configurations.lock(document.departmentId);chain=await this.configurations.resolve(document.departmentId,document.proposedSalaryMax);this.validateChain(original.createdBy,chain.levels.map(level=>level.approverUserId));await this.db.prepare('INSERT INTO requisition_approval_snapshots(workflow_id,requisition_id,configuration_version_id,snapshot_json) VALUES (?,?,?,?)').run(workflow.id,requisitionId,chain.configurationVersionId,JSON.stringify({...chain,workflowId:workflow.id,requisitionId}));}
      else chain=await this.configurations.bindSnapshot(workflow.id,requisitionId);
      await this.db.prepare('INSERT INTO requisition_approval_workflows(id,requisition_id,creator_id,status,version) VALUES (?,?,?,?,?)').run(workflow.id,requisitionId,original.createdBy,'PENDING',1);
      workflow.current_submission_id=await this.saveSubmission(workflow,document,chain,1);
      await this.db.prepare('UPDATE requisition_approval_workflows SET current_submission_id=? WHERE id=?').run(workflow.current_submission_id,workflow.id);
      if(require('./headcountBudgetService').HeadcountBudgetService.enabled())await new (require('./headcountBudgetService').HeadcountBudgetService)(this.db).reserve(requisitionId,document,workflow.current_submission_id);
      return this.event(workflow,user,'SUBMIT',audit.reason||null,data,fingerprint);
    });
  }
  async read(id,user) {
    const actor=await this.rbac.getAuthorizedActor(user.id,'requisition.read')||await this.rbac.getAuthorizedActor(user.id,'requisition.approve');
    if(!actor)this.fail('APPROVAL_FORBIDDEN','Bạn không có quyền xem hồ sơ phê duyệt.',403);
    user={...user,...actor};
    const workflow=await this.workflow(id),steps=await this.steps(workflow.current_submission_id),effectiveDocument=await this.requisitions.getRequisitionById(workflow.requisition_id);
    if(workflow.creator_id===user.id||user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))await this.permission(user,'requisition.read');
    else {
      const scopedRead=await this.rbac.hasPermission(user.id,'requisition.read')&&(await this.requisitions.requisitionAccess(effectiveDocument,user,false,true)).success;
      if(!scopedRead){await this.permission(user,'requisition.approve');if(!steps.some(step=>step.approver_id===user.id))this.fail('APPROVAL_FORBIDDEN','Bạn không được phân công trong hồ sơ này.',403);}
    }
    const submissions=await this.db.prepare('SELECT id,revision,document_json,created_at FROM requisition_approval_submissions WHERE workflow_id=? ORDER BY revision').all(id);
    const historicalSteps=await this.db.prepare('SELECT s.* FROM requisition_approval_steps s JOIN requisition_approval_submissions d ON d.id=s.submission_id WHERE d.workflow_id=? ORDER BY d.revision,s.level_order').all(id);
    const events=await this.db.prepare('SELECT workflow_version,submission_id,step_id,actor_id,actor_name,action,comment,created_at,response_json FROM requisition_approval_events WHERE workflow_id=? ORDER BY workflow_version').all(id);
    const history=events.map(({response_json,...event})=>({...event,...(JSON.parse(response_json).appliedRevision?{appliedRevision:JSON.parse(response_json).appliedRevision}:{})}));
    const effectiveRevision=history.filter(event=>event.appliedRevision?.contentHash===this.requisitions.approvalContentHash(effectiveDocument)).at(-1)?.appliedRevision||null;
    return {...this.summary(workflow),creatorId:workflow.creator_id,effectiveDocument,effectiveRevision,editVersion:this.requisitions.approvalContentHash(effectiveDocument),canResubmit:['APPROVED','NEEDS_INFO','REJECTED'].includes(workflow.status)&&effectiveDocument.status==='OPEN'&&(workflow.creator_id===user.id||user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))&&await this.rbac.hasPermission(user.id,'requisition.create')&&(await this.requisitions.requisitionAccess(effectiveDocument,user,true,true)).success,onBehalf:workflow.creator_id!==user.id,recruitmentStatus:effectiveDocument.status,steps,submissions:submissions.map(row=>({...row,document_json:undefined,document:JSON.parse(row.document_json),steps:historicalSteps.filter(step=>step.submission_id===row.id)})),events:history};
  }
  async list(user) {
    const actor=await this.rbac.getAuthorizedActor(user.id,'requisition.read')||await this.rbac.getAuthorizedActor(user.id,'requisition.approve');
    if(!actor)this.fail('APPROVAL_FORBIDDEN','Bạn không có quyền xem hồ sơ phê duyệt.',403);
    user={...user,...actor};
    const canRead=await this.rbac.hasPermission(user.id,'requisition.read'),canApprove=await this.rbac.hasPermission(user.id,'requisition.approve');
    if(!canRead&&!canApprove)this.fail('APPROVAL_FORBIDDEN','Bạn không có quyền xem hồ sơ phê duyệt.',403);
    const supervisor=user.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role));
    const visibility=this.requisitions.requisitionVisibility(user,true);
    const scope=visibility?visibility.condition:'1=0',scopeParams=visibility?.params||[];
    return this.db.prepare(`SELECT w.id,w.requisition_id AS "requisitionId",w.status,w.version,w.creator_id AS "creatorId",s.id AS "expectedStepId",s.approver_name AS "waitingFor",s.approver_id AS "waitingUserId",r.code,r.title,r.status AS "recruitmentStatus"
      FROM requisition_approval_workflows w LEFT JOIN requisition_approval_steps s ON s.submission_id=w.current_submission_id AND s.status='PENDING'
      LEFT JOIN requisitions r ON r.id=w.requisition_id WHERE (?=1) OR (?=1 AND w.creator_id=?) OR (?=1 AND s.approver_id=? AND w.status='PENDING') OR (?=1 AND ${scope}) ORDER BY w.created_at DESC,w.id`).all(supervisor?1:0,canRead?1:0,user.id,canApprove?1:0,user.id,canRead?1:0,...scopeParams);
  }
  async tracking(requisitionId,user) {
    return this.db.transaction(async()=>{
      user=await this.transactionPermission(user,'requisition.read');
      const item=await this.requisitions.getRequisitionById(requisitionId),access=await this.requisitions.requisitionAccess(item,user,false,true);
      if(!access.success)throw new ApprovalConfigurationError(access.code,access.message,access.statusCode);
      const workflow=await this.db.prepare('SELECT id,status,version,current_submission_id FROM requisition_approval_workflows WHERE requisition_id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(requisitionId);
      if(!workflow)return {requisitionId,status:'NOT_SUBMITTED',workflowId:null,currentRevision:null,waitingFor:null,rounds:[]};
      const submissions=await this.db.prepare('SELECT d.id,d.revision,d.created_at,d.document_json,s.configuration_version_id,s.snapshot_json FROM requisition_approval_submissions d JOIN requisition_approval_snapshots s ON s.workflow_id=d.approval_snapshot_id WHERE d.workflow_id=? ORDER BY d.revision').all(workflow.id);
      const steps=await this.db.prepare('SELECT s.* FROM requisition_approval_steps s JOIN requisition_approval_submissions d ON d.id=s.submission_id WHERE d.workflow_id=? ORDER BY d.revision,s.level_order').all(workflow.id);
      const events=await this.db.prepare('SELECT step_id,actor_id,actor_name,action,comment,created_at,workflow_version,response_json FROM requisition_approval_events WHERE workflow_id=? ORDER BY workflow_version').all(workflow.id);
      const stepGroups=new Map(),decisions=new Map();let effectiveRevision=null;
      for(const step of steps){const group=stepGroups.get(step.submission_id)||[];group.push(step);stepGroups.set(step.submission_id,group);}
      for(const event of events){const applied=JSON.parse(event.response_json).appliedRevision;if(applied?.contentHash===this.requisitions.approvalContentHash(item))effectiveRevision=applied.revision;if(!event.step_id)continue;const group=decisions.get(event.step_id)||[];group.push({action:event.action,actor:{id:event.actor_id,name:event.actor_name},at:event.created_at,comment:event.comment||'',version:event.workflow_version});decisions.set(event.step_id,group);}
      const rounds=submissions.map(submission=>{const snapshot=JSON.parse(submission.snapshot_json),document=JSON.parse(submission.document_json),audit=document.approvalRevision||document.submissionAudit;
        return {submissionId:submission.id,revision:submission.revision,isCurrent:submission.id===workflow.current_submission_id,submittedAt:submission.created_at,submittedBy:audit?{id:audit.actorId,name:audit.actorName}:null,reason:audit?.reason||'',configurationVersionId:submission.configuration_version_id,configurationVersion:snapshot.version,steps:(stepGroups.get(submission.id)||[]).map(step=>({id:step.id,order:step.level_order,status:step.status,assignedApprover:{id:step.approver_id,name:step.approver_name},decisions:decisions.get(step.id)||[]}))};});
      const current=rounds.find(round=>round.isCurrent),pending=workflow.status==='PENDING'?current?.steps.find(step=>step.status==='PENDING'):null;
      return {requisitionId,workflowId:workflow.id,status:workflow.status,version:workflow.version,currentRevision:current?.revision||null,waitingFor:pending?{order:pending.order,...pending.assignedApprover}:null,effectiveRevision,rounds};
    });
  }
  async decide(id,data,user) {
    this.request(data);await this.permission(user,'requisition.approve');
    if(!['APPROVE','REJECT','REQUEST_INFO'].includes(data.action))this.fail('INVALID_APPROVAL_ACTION','Hành động phê duyệt không hợp lệ.',400);
    const comment=data.comment==null?'':data.comment;
    if(typeof comment!=='string'||comment.length>4000||(['REJECT','REQUEST_INFO'].includes(data.action)&&!comment.trim()))this.fail('APPROVAL_COMMENT_REQUIRED','Từ chối và Yêu cầu bổ sung cần ý kiến không rỗng, tối đa 4000 ký tự.',400);
    if(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1||typeof data.expectedStepId!=='string'||!data.expectedStepId.trim())this.fail('APPROVAL_EXPECTATION_REQUIRED','Thiếu phiên bản hoặc cấp duyệt cần xử lý.',400);
    const fingerprint=this.fingerprint('DECISION',id,data);
    return this.db.transaction(async()=>{
      user=await this.transactionPermission(user,'requisition.approve');
      await this.lock('request:'+user.id+':'+data.requestId);const replay=await this.replay(user,data,fingerprint);if(replay)return replay;await this.lock('workflow:'+id);
      const workflow=await this.workflow(id);await this.db.prepare('SELECT id FROM requisitions WHERE id=?'+(this.db.provider==='postgres'?' FOR SHARE':'')).get(workflow.requisition_id);const position=await this.requisitions.getRequisitionById(workflow.requisition_id);if(['PAUSED','CANCELLED'].includes(position?.status))this.fail('APPROVAL_LIFECYCLE_FROZEN','Yêu cầu đang tạm dừng hoặc đã huỷ; không thể xử lý phê duyệt.');const steps=await this.steps(workflow.current_submission_id),step=steps.find(item=>item.status==='PENDING');
      if(workflow.status!=='PENDING'||workflow.version!==data.expectedVersion||step?.id!==data.expectedStepId)this.fail('APPROVAL_STALE_STEP','Hồ sơ hoặc cấp duyệt đã thay đổi. Vui lòng tải lại.');
      if(step.approver_id!==user.id)this.fail('APPROVAL_ASSIGNEE_REQUIRED','Chỉ người được phân công ở cấp hiện tại được xử lý.',403);
      this.validateChain(workflow.creator_id,steps.map(item=>item.approver_id));
      const next=steps.find(item=>item.level_order===step.level_order+1);
      if(data.action==='APPROVE'&&!next){const submission=await this.submission(workflow.current_submission_id);if(require('./headcountBudgetService').HeadcountBudgetService.enabled())await new (require('./headcountBudgetService').HeadcountBudgetService)(this.db).final(workflow.requisition_id,submission.document);workflow.appliedRevision=await this.applyRevision(workflow,submission,user);}
      const state=data.action==='APPROVE'?'APPROVED':data.action==='REJECT'?'REJECTED':'NEEDS_INFO';
      await this.db.prepare('UPDATE requisition_approval_steps SET status=? WHERE id=?').run(state,step.id);
      workflow.status=data.action==='APPROVE'?(next?'PENDING':'APPROVED'):state;
      if(data.action==='APPROVE'&&next)await this.db.prepare("UPDATE requisition_approval_steps SET status='PENDING' WHERE id=?").run(next.id);
      workflow.version++;
      await this.db.prepare('UPDATE requisition_approval_workflows SET status=?,version=? WHERE id=?').run(workflow.status,workflow.version,id);
      if(require('./headcountBudgetService').HeadcountBudgetService.enabled()){const budget=new (require('./headcountBudgetService').HeadcountBudgetService)(this.db);if(workflow.status==='APPROVED')await budget.markApproved(workflow.requisition_id);else if(workflow.status!=='PENDING')await budget.release(workflow.requisition_id);}
      return this.event(workflow,user,data.action,comment.trim(),data,fingerprint,step.id);
    });
  }
  async resubmit(id,data,user) {
    this.request(data);await this.permission(user,'requisition.create');if(!Number.isSafeInteger(data.expectedVersion)||data.expectedVersion<1)this.fail('APPROVAL_EXPECTATION_REQUIRED','Thiếu phiên bản hồ sơ cần gửi lại.',400);const fingerprint=this.fingerprint('RESUBMIT',id,data);
    return this.db.transaction(async()=>{
      user=await this.transactionPermission(user,'requisition.create');
      await this.lock('request:'+user.id+':'+data.requestId);const replay=await this.replay(user,data,fingerprint);if(replay)return replay;await this.lock('workflow:'+id);
      const workflow=await this.workflow(id);
      if(!['NEEDS_INFO','APPROVED','REJECTED'].includes(workflow.status)||workflow.version!==data.expectedVersion)this.fail('APPROVAL_STALE_STEP','Hồ sơ hoặc phiên bản đã thay đổi; vui lòng tải lại.');
      const original=await this.lockedRequisition(workflow.requisition_id),audit=await this.submissionActor(original,user,data);
      if(workflow.status==='APPROVED'&&typeof data.expectedDocumentHash!=='string')this.fail('APPROVAL_EXPECTATION_REQUIRED','Thiếu phiên bản dữ liệu đang có hiệu lực.',400);
      const previous=await this.submission(workflow.current_submission_id);
      const baseline=workflow.status==='APPROVED'?original:previous.document;
      const document=await this.revisionDocument(original,baseline,data.document,user,data,audit);
      await this.configurations.lock(document.departmentId);
      const chain=await this.configurations.resolve(document.departmentId,document.proposedSalaryMax);
      workflow.current_submission_id=await this.saveSubmission(workflow,document,chain,previous.revision+1);workflow.status='PENDING';workflow.version++;
      await this.db.prepare('UPDATE requisition_approval_workflows SET current_submission_id=?,status=?,version=? WHERE id=?').run(workflow.current_submission_id,workflow.status,workflow.version,id);
      if(require('./headcountBudgetService').HeadcountBudgetService.enabled())await new (require('./headcountBudgetService').HeadcountBudgetService)(this.db).reserve(workflow.requisition_id,document,workflow.current_submission_id);
      return this.event(workflow,user,'RESUBMIT',audit.reason||null,data,fingerprint);
    });
  }
}
module.exports=RequisitionApprovalService;
