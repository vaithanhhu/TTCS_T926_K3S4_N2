const crypto = require('node:crypto');
const RequisitionService = require('./requisitionService');
const RBAC = require('../middlewares/rbacMiddleware');
const migration = require('../db/migrate-bulk-interviews');
const {escapeEmailHtml} = require('./emailService');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (code,statusCode=400) => ({success:false,statusCode,code,message:code});
const abort = result => {const error=new Error(result.code || 'BULK_INTERVIEW_FAILED');error.result=result;throw error;};

class BulkInterviewService {
  constructor(db) {this.db=db;this.scheduling=new RequisitionService(db);this.rbac=new RBAC(db);}

  async actor(actor) {
    const fresh=await this.rbac.getAuthorizedActor(actor?.id,'interview.create');
    if(!fresh || !fresh.roles.some(role=>['ADMIN','HR_MANAGER','RECRUITER'].includes(role)))abort(failure('BULK_INTERVIEW_FORBIDDEN',403));
    return fresh;
  }

  normalize(data,allowPast=false) {
    if(!data || typeof data!=='object' || !Array.isArray(data.candidateIds) || !data.candidateIds.length || data.candidateIds.length>100 || data.candidateIds.some(id=>typeof id!=='string' || !id.trim()) || new Set(data.candidateIds).size!==data.candidateIds.length)abort(failure('BULK_CANDIDATES_INVALID'));
    if(typeof data.requisitionId!=='string' || !data.requisitionId.trim())abort(failure('BULK_REQUISITION_REQUIRED'));
    if(!Array.isArray(data.interviewerIds) || !data.interviewerIds.length || data.interviewerIds.length>100 || data.interviewerIds.some(id=>typeof id!=='string' || !id.trim()) || new Set(data.interviewerIds).size!==data.interviewerIds.length)abort(failure('INTERVIEW_ASSIGNEES_INVALID'));
    const durationMinutes=Number(data.durationMinutes),breakMinutes=data.breakMinutes===undefined?0:Number(data.breakMinutes);
    if(!Number.isInteger(durationMinutes) || durationMinutes<15 || durationMinutes>480 || !Number.isInteger(breakMinutes) || breakMinutes<0 || breakMinutes>480)abort(failure('BULK_DURATION_INVALID'));
    const start=this.scheduling.parseInterviewTimestamp(data.windowStart),end=this.scheduling.parseInterviewTimestamp(data.windowEnd);
    if(start===null || end===null || end<=start)abort(failure('BULK_WINDOW_INVALID'));
    if(start<Date.now() && !allowPast)abort(failure('SCHEDULED_TIME_IN_PAST'));
    if(data.candidateIds.length*durationMinutes+(data.candidateIds.length-1)*breakMinutes>(end-start)/60000)abort(failure('BULK_WINDOW_TOO_SHORT'));
    if(typeof data.roundName!=='string' || !data.roundName.trim() || data.roundName.length>120)abort(failure('BULK_ROUND_INVALID'));
    if(!['ONLINE','IN_PERSON'].includes(data.interviewFormat))abort(failure('INVALID_INTERVIEW_FORMAT'));
    return {candidateIds:[...data.candidateIds].sort(),requisitionId:data.requisitionId,interviewerIds:[...data.interviewerIds],roundName:data.roundName.trim(),durationMinutes,breakMinutes,windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),interviewFormat:data.interviewFormat,meetingRoom:data.interviewFormat==='IN_PERSON' && typeof data.meetingRoom==='string'?data.meetingRoom.trim():'',meetingLink:data.interviewFormat==='ONLINE' && typeof data.meetingLink==='string'?data.meetingLink.trim():''};
  }

  async plan(config,actor) {
    const candidates=[];
    for(const id of config.candidateIds){
      const access=await this.scheduling.candidateAccess(id,actor);
      if(!access.success)abort(failure('BULK_CANDIDATE_OUT_OF_SCOPE',access.statusCode===404?404:403));
      const candidate=await this.db.prepare('SELECT id,requisition_id,full_name,email,stage FROM candidates WHERE id=?').get(id);
      if(candidate.requisition_id!==config.requisitionId)abort(failure('BULK_REQUISITION_MISMATCH'));
      if(typeof candidate.email!=='string' || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(candidate.email))abort(failure('BULK_CANDIDATE_EMAIL_INVALID'));
      candidates.push(candidate);
    }
    const requisition=await this.db.prepare('SELECT id,title,status FROM requisitions WHERE id=?').get(config.requisitionId);
    if(!requisition)abort(failure('BULK_REQUISITION_NOT_FOUND',404));
    const slots=[],errors=[],panel=[];
    for(const id of config.interviewerIds){
      const user=await this.rbac.getAuthorizedActor(id,'interview.evaluate');
      if(!user)abort(failure('INTERVIEW_ASSIGNEE_INVALID'));
      panel.push({id:user.id,fullName:user.fullName});
    }
    for(let index=0;index<candidates.length;index++){
      const candidate=candidates[index],start=Date.parse(config.windowStart)+index*(config.durationMinutes+config.breakMinutes)*60000;
      const slot={...config,candidateId:candidate.id,scheduledTime:new Date(start).toISOString()};
      const result=await this.scheduling.previewInterview(slot,actor);
      if(!result.success){if(result.statusCode===403)abort(failure('BULK_INTERVIEW_FORBIDDEN',403));errors.push({candidateId:candidate.id,code:result.code,statusCode:result.statusCode});}
      slots.push({candidateId:candidate.id,fullName:candidate.full_name,start:slot.scheduledTime,end:new Date(start+config.durationMinutes*60000).toISOString(),roundName:config.roundName,interviewers:panel,meetingRoom:config.meetingRoom,meetingLink:config.meetingLink});
    }
    return {config,candidates,requisition,slots,errors,fingerprint:digest({config,candidates,requisition,panel})};
  }

  async preview(data,actor) {
    try{
      const fresh=await this.actor(actor),config=this.normalize(data);
      const plan=await this.plan(config,fresh);
      return {success:!plan.errors.length,statusCode:plan.errors.length?(plan.errors.some(row=>row.statusCode===409)?409:400):200,code:plan.errors.length?'BULK_PREVIEW_INVALID':undefined,fingerprint:plan.fingerprint,slots:plan.slots,errors:plan.errors};
    }catch(error){if(error.result)return error.result;throw error;}
  }

  async lock(config) {
    if(this.db.provider!=='postgres')return;
    for(const id of config.candidateIds)await this.db.prepare('SELECT id FROM candidates WHERE id=? FOR UPDATE').get(id);
    for(const id of [...config.interviewerIds].sort())await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get('interview-scheduling:user:'+id);
  }

  async create(data,actor) {
    try{
      return await this.db.transaction(async()=>{
        let fresh=await this.actor(actor);
        if(typeof data?.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestKey))abort(failure('BULK_REQUEST_KEY_INVALID'));
        if(typeof data.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(data.fingerprint))abort(failure('BULK_PREVIEW_REQUIRED'));
        const config=this.normalize(data,true),hash=digest({config,fingerprint:data.fingerprint});
        await migration.verify(this.db);
        if(this.db.provider==='postgres')await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get('interview-batch:'+fresh.id+':'+data.requestKey);
        const previous=await this.db.prepare('SELECT id,payload_hash,result_json FROM interview_batches WHERE actor_id=? AND request_key=?').get(fresh.id,data.requestKey);
        if(previous){
          if(previous.payload_hash!==hash)abort(failure('BULK_IDEMPOTENCY_CONFLICT',409));
          const result=await this.status(previous.id,fresh);
          if(!result.success)abort(result);
          return {...result,statusCode:200,replayed:true};
        }
        await this.lock(config);
        fresh=await this.actor(actor);
        const plan=await this.plan(config,fresh);
        if(plan.fingerprint!==data.fingerprint)abort(failure('BULK_PREVIEW_STALE',409));
        if(plan.errors.length)abort({...failure('BULK_INTERVIEW_CONFLICT',409),errors:plan.errors});
        const batchId='ib-'+crypto.randomUUID(),interviews=[];
        await this.db.prepare('INSERT INTO interview_batches(id,actor_id,actor_snapshot,request_key,payload_hash,fingerprint,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(batchId,fresh.id,fresh.id,data.requestKey,hash,plan.fingerprint,'{}',new Date().toISOString());
        for(const slot of plan.slots){
          const result=await this.scheduling.createInterview({...config,candidateId:slot.candidateId,scheduledTime:slot.start},fresh);
          if(!result.success)abort(result);
          interviews.push(result.data);
          await this.db.prepare('INSERT INTO interview_batch_items(batch_id,interview_id,candidate_id) VALUES(?,?,?)').run(batchId,result.id,slot.candidateId);
          const candidate=plan.candidates.find(row=>row.id===slot.candidateId);
          const recipient=candidate.email.trim(),outboxId='invite-'+digest([result.id,recipient.toLowerCase(),'INTERVIEW_INVITATION']);
          const date=value=>new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false});
          const text=`Xin chào ${candidate.full_name},\nVị trí: ${plan.requisition.title}\nVòng: ${config.roundName}\nThời gian: ${date(slot.start)} – ${date(slot.end)} (Asia/Ho_Chi_Minh)\nHình thức: ${config.interviewFormat}\n${config.interviewFormat==='ONLINE'?config.meetingLink:config.meetingRoom}`;
          await this.db.prepare("INSERT INTO email_outbox(id,recipient,subject,body_html,body_text,template_name,status) VALUES(?,?,?,?,?,?,'PENDING')").run(outboxId,recipient,'[ATS] Lời mời phỏng vấn',`<p>${escapeEmailHtml(text).replace(/\n/g,'<br>')}</p>`,text,'S603_INTERVIEW_INVITATION');
          await this.db.prepare("INSERT INTO interview_invitation_deliveries(outbox_id,interview_id,state,updated_at) VALUES(?,?,'PENDING',?)").run(outboxId,result.id,new Date().toISOString());
        }
        const result={success:true,statusCode:201,batchId,interviews};
        await this.db.prepare('UPDATE interview_batches SET result_json=? WHERE id=?').run(JSON.stringify(result),batchId);
        return {...result,deliveries:interviews.map(row=>({interviewId:row.id,state:'PENDING',attempts:0}))};
      });
    }catch(error){if(error.result)return error.result;throw error;}
  }

  async status(batchId,actor) {
    try{
      const fresh=await this.actor(actor);
      const batch=await this.db.prepare('SELECT actor_id,result_json FROM interview_batches WHERE id=?').get(batchId);
      if(!batch || (batch.actor_id!==fresh.id && !fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))))return failure('BULK_NOT_FOUND',404);
      const rows=await this.db.prepare('SELECT candidate_id FROM interview_batch_items WHERE batch_id=?').all(batchId);
      for(const row of rows){const access=await this.scheduling.candidateAccess(row.candidate_id,fresh);if(!access.success)return failure('BULK_NOT_FOUND',404);}
      const deliveries=await this.db.prepare('SELECT d.interview_id AS "interviewId",d.state,d.attempts,d.error_code AS "errorCode" FROM interview_invitation_deliveries d JOIN interview_batch_items b ON b.interview_id=d.interview_id WHERE b.batch_id=? ORDER BY d.interview_id').all(batchId);
      return {...JSON.parse(batch.result_json),statusCode:200,deliveries};
    }catch(error){if(error.result)return error.result;throw error;}
  }

  async retry(batchId,actor) {
    try{return await this.db.transaction(async()=>{
      const result=await this.status(batchId,actor);
      if(!result.success)return result;
      if(result.deliveries.some(row=>['UNKNOWN','SENDING'].includes(row.state)))return failure('INVITATION_DELIVERY_UNCERTAIN',409);
      for(const row of result.deliveries.filter(row=>row.state==='FAILED')){
        await this.db.prepare("UPDATE interview_invitation_deliveries SET state='PENDING',error_code=NULL,updated_at=? WHERE interview_id=? AND state='FAILED'").run(new Date().toISOString(),row.interviewId);
      }
      return {success:true,statusCode:200,batchId};
    });}catch(error){if(error.result)return error.result;throw error;}
  }
}

module.exports=BulkInterviewService;
