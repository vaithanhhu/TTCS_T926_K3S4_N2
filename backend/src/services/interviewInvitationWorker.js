const BulkInterviewService = require('./bulkInterviewService');
const {EmailService} = require('./emailService');

class InterviewInvitationWorker {
  constructor(db,email) {this.db=db;this.bulk=new BulkInterviewService(db);this.email=email || new EmailService(db);}

  async deliver(batchId,actor) {
    const initial=await this.bulk.status(batchId,actor);
    if(!initial.success)return initial;
    for(const item of initial.deliveries.filter(row=>row.state==='PENDING')){
      const message=await this.db.transaction(async()=>{
        const access=await this.bulk.status(batchId,actor);
        if(!access.success)return null;
        const claimed=await this.db.prepare("UPDATE interview_invitation_deliveries SET state='SENDING',attempts=attempts+1,updated_at=? WHERE interview_id=? AND state='PENDING'").run(new Date().toISOString(),item.interviewId);
        if(!claimed.changes)return null;
        return this.db.prepare('SELECT o.id,o.recipient,o.subject,o.body_html,o.body_text,o.template_name FROM email_outbox o JOIN interview_invitation_deliveries d ON d.outbox_id=o.id WHERE d.interview_id=?').get(item.interviewId);
      });
      if(!message)continue;
      let state='UNKNOWN',code='INVITATION_DELIVERY_UNCERTAIN';
      try{
        const result=await this.email.sendMail({to:message.recipient,subject:message.subject,html:message.body_html,text:message.body_text,templateName:message.template_name});
        if(result.success){state=result.simulated?'SIMULATED':'SENT';code=null;}
        else if(['SMTP_NOT_CONFIGURED','SMTP_OAUTH_NOT_CONFIGURED','SMTP_AUTH_MODE_INVALID','SMTP_INITIALIZATION_FAILED','SMTP_RECIPIENT_REJECTED'].includes(result.error)){state='FAILED';code=result.error;}
      }catch{}
      await this.db.transaction(async()=>{
        await this.db.prepare("UPDATE interview_invitation_deliveries SET state=?,error_code=?,updated_at=? WHERE outbox_id=? AND state='SENDING'").run(state,code,new Date().toISOString(),message.id);
        await this.db.prepare('UPDATE email_outbox SET status=?,retry_count=retry_count+1,error_message=?,sent_at=? WHERE id=?').run(['SENT','SIMULATED'].includes(state)?'SENT':'FAILED',code,['SENT','SIMULATED'].includes(state)?new Date().toISOString():null,message.id);
      });
    }
    return this.bulk.status(batchId,actor);
  }
}

module.exports=InterviewInvitationWorker;
