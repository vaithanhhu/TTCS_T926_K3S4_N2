const RbacMiddleware=require('../middlewares/rbacMiddleware');

async function authorizeInterview(db,interviewId,actor,permission){
 const denied={success:false,statusCode:403,code:'INTERVIEW_ACCESS_DENIED',message:'Access denied.'};
 const fresh=await new RbacMiddleware(db).getAuthorizedActor(actor?.id,permission);
 if(!fresh)return denied;
 const interview=await db.prepare('SELECT i.id,i.interviewer_id,i.requisition_id,c.requisition_id AS candidate_requisition_id FROM interviews i LEFT JOIN candidates c ON c.id=i.candidate_id WHERE i.id=?').get(interviewId);
 if(!interview)return {success:false,statusCode:404,code:'INTERVIEW_NOT_FOUND',message:'Interview not found.'};
 if(fresh.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role)))return {success:true,actor:fresh};
 if(fresh.roles.includes('INTERVIEWER')){
  if(interview.interviewer_id===fresh.id)return {success:true,actor:fresh};
  const table=db.provider==='postgres'
   ?await db.prepare("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='interview_interviewers'").get()
   :await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interview_interviewers'").get();
  if(table&&await db.prepare('SELECT user_id FROM interview_interviewers WHERE interview_id=? AND user_id=?').get(interviewId,fresh.id))return {success:true,actor:fresh};
 }
 const ids=[...new Set([interview.requisition_id,interview.candidate_requisition_id].filter(Boolean))];
 if(!ids.length)return denied;
 const requisitions=new(require('./requisitionService'))(db);
 if(fresh.roles.includes('RECRUITER')&&(await Promise.all(ids.map(id=>requisitions.recruiterAssigned(id,fresh.id)))).every(Boolean))return {success:true,actor:fresh};
 if(fresh.roles.includes('HIRING_MGR')&&(await Promise.all(ids.map(id=>requisitions.canReadHiringRequisition(id,fresh.id)))).every(Boolean))return {success:true,actor:fresh};
 return denied;
}

module.exports={authorizeInterview};
