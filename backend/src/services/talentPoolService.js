const crypto = require('node:crypto');
const Rbac = require('../middlewares/rbacMiddleware');
const fail = (code,message,statusCode=400) => ({success:false,statusCode,code,message});
const like = value => '%'+value.replace(/[!%_]/g,'!$&')+'%';
const fold = value => String(value ?? '').normalize('NFC').toLowerCase();

class TalentPoolService {
  constructor(db) {
    this.db=db; this.rbac=new Rbac(db);
    if(db.provider==='sqlite')db.function('ats_talent_pool_fold',{deterministic:true},fold);
  }
  folded(column) { return this.db.provider==='sqlite'?'ats_talent_pool_fold('+column+')':'LOWER(NORMALIZE('+column+',NFC))'; }
  async actor(viewer,permission='candidate.read') {
    const actor=await this.rbac.getAuthorizedActor(viewer?.id,permission);
    if(!actor || !actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))) throw fail('TALENT_POOL_FORBIDDEN','Chỉ HR/ADMIN có quyền quản lý kho ứng viên theo quyền hiện hành.',403);
    return actor;
  }
  async availability(viewer) {
    await this.actor(viewer);
    const names=['candidate_talent_pool','ats_talent_pool_migrations','candidate_tags','candidate_documents'];
    const tables=await this.db.prepare(this.db.provider==='postgres'
      ?"SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN (?,?,?,?)"
      :"SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?)").all(...names);
    if(tables.length!==names.length)return {success:true,enabled:false};
    const ledger=await this.db.prepare('SELECT checksum FROM ats_talent_pool_migrations WHERE version=1').get();
    return {success:true,enabled:ledger?.checksum===require('../db/migrate-talent-pool').checksum};
  }
  text(input,key,max=200) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_TALENT_POOL_INPUT','Thông tin kho ứng viên không hợp lệ.');
    const value=input[key];
    if(value===undefined || value==='')return '';
    if(typeof value!=='string' || value.trim().length>max)throw fail('INVALID_TALENT_POOL_INPUT','Thông tin kho ứng viên không hợp lệ.');
    return value.trim();
  }
  async add(input,viewer) {
    return this.db.transaction(async()=>{
      const actor=await this.actor(viewer,'candidate.update');
      const candidateId=this.text(input,'candidateId'),reason=this.text(input,'reason',2000),interestedTitle=this.text(input,'interestedTitle');
      if(!candidateId || !reason || input.finalRoundConfirmed!==true)throw fail('FINAL_ROUND_CONFIRMATION_REQUIRED','HR phải xác nhận hồ sơ đã trượt vòng cuối và nhập lý do đưa vào kho.');
      const candidate=await this.db.prepare('SELECT id,requisition_id,stage FROM candidates WHERE id=?'+(this.db.provider==='postgres'?' FOR UPDATE':'')).get(candidateId);
      if(!candidate)throw fail('CANDIDATE_NOT_FOUND','Không tìm thấy hồ sơ ứng viên.',404);
      if(candidate.stage!=='REJECTED')throw fail('CANDIDATE_NOT_REJECTED','Chỉ hồ sơ bị loại đã được HR xác nhận trượt vòng cuối mới được đưa vào kho.',409);
      const req=await this.db.prepare('SELECT title FROM requisitions WHERE id=?').get(candidate.requisition_id);
      const title=interestedTitle || req?.title;
      if(!title)throw fail('INTERESTED_TITLE_REQUIRED','Cần cung cấp chức danh quan tâm.');
      const id=crypto.randomUUID();
      const inserted=await this.db.prepare('INSERT INTO candidate_talent_pool(id,candidate_id,interested_title,reason,final_round_confirmed,confirmed_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(candidate_id) DO NOTHING').run(id,candidate.id,title,reason,this.db.provider==='postgres'?true:1,actor.id,new Date().toISOString());
      const saved=await this.db.prepare('SELECT id FROM candidate_talent_pool WHERE candidate_id=?').get(candidate.id);
      return {success:true,statusCode:inserted.changes?201:200,id:saved.id,alreadyInPool:!inserted.changes};
    });
  }
  async search(input,viewer) {
    await this.actor(viewer);
    const title=this.text(input,'title'),skill=this.text(input,'skill');
    const page=input.page===undefined?1:Number(input.page),pageSize=input.pageSize===undefined?25:Number(input.pageSize);
    if(!Number.isSafeInteger(page)||page<1||page>1000000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw fail('INVALID_PAGINATION','Phân trang không hợp lệ.');
    const conditions=[],params=[];
    if(title){conditions.push(this.folded('p.interested_title')+" LIKE ? ESCAPE '!'");params.push(like(fold(title)));}
    if(skill){conditions.push("(EXISTS (SELECT 1 FROM candidate_tags t WHERE t.candidate_id=c.id AND "+this.folded('t.tag_name')+" LIKE ? ESCAPE '!') OR EXISTS (SELECT 1 FROM candidate_documents d WHERE d.candidate_id=c.id AND d.document_type='CV' AND "+this.folded('d.parsed_text')+" LIKE ? ESCAPE '!'))");params.push(like(fold(skill)),like(fold(skill)));}
    const from=' FROM candidate_talent_pool p JOIN candidates c ON c.id=p.candidate_id WHERE '+(conditions.length?conditions.join(' AND '):'1=1');
    const total=Number((await this.db.prepare('SELECT COUNT(*) AS total'+from).get(...params)).total);
    const rows=await this.db.prepare('SELECT p.id,p.candidate_id,p.interested_title,p.reason,p.confirmed_by,p.created_at,c.full_name,c.email'+from+' ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize);
    return {success:true,total,page,pageSize,candidates:rows.map(row=>({id:row.id,candidateId:row.candidate_id,fullName:row.full_name,email:row.email,interestedTitle:row.interested_title,reason:row.reason,confirmedBy:row.confirmed_by,createdAt:row.created_at}))};
  }
  async suggest(requisitionId,viewer) {
    const actor=await this.actor(viewer);
    if(typeof requisitionId!=='string'||!requisitionId||requisitionId.length>200)throw fail('INVALID_REQUISITION','Vị trí không hợp lệ.');
    const req=await this.db.prepare('SELECT id,title,job_title_id,status FROM requisitions WHERE id=?').get(requisitionId);
    if(!req)throw fail('REQUISITION_NOT_FOUND','Không tìm thấy vị trí.',404);
    if(!['OPEN','IN_PROGRESS'].includes(req.status))throw fail('REQUISITION_NOT_OPEN','Chỉ gợi ý khi vị trí đang mở tuyển.',409);
    const exists=this.db.provider==='postgres'
      ?await this.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='requisition_screening_criteria'").get()
      :await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='requisition_screening_criteria'").get();
    const criteria=exists?await this.db.prepare('SELECT required_skills_json FROM requisition_screening_criteria WHERE requisition_id=?').get(req.id):null;
    let skills=[];
    if(criteria?.required_skills_json)try{const parsed=JSON.parse(criteria.required_skills_json);if(Array.isArray(parsed))skills=parsed.filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()).slice(0,100);}catch{}
    const matchColumns=skills.map((skill,index)=>`CASE WHEN EXISTS (SELECT 1 FROM candidate_tags t WHERE t.candidate_id=c.id AND ${this.folded('t.tag_name')}=?) OR EXISTS (SELECT 1 FROM candidate_documents d WHERE d.candidate_id=c.id AND d.document_type='CV' AND ${this.folded('d.parsed_text')} LIKE ? ESCAPE '!') THEN 1 ELSE 0 END AS skill_${index}`);
    const pool=await this.db.prepare('SELECT p.candidate_id,p.interested_title,c.requisition_id,r.job_title_id'+(matchColumns.length?','+matchColumns.join(','):'')+' FROM candidate_talent_pool p JOIN candidates c ON c.id=p.candidate_id LEFT JOIN requisitions r ON r.id=c.requisition_id ORDER BY p.created_at DESC,p.id').all(...skills.flatMap(skill=>[fold(skill),like(fold(skill))]));
    const matches=[];
    for(const candidate of pool){
      const titleMatch=Boolean(req.job_title_id&&req.job_title_id===candidate.job_title_id)||fold(candidate.interested_title.trim())===fold(req.title.trim());
      const matchedSkills=skills.filter((skill,index)=>Number(candidate['skill_'+index])===1);
      if(titleMatch||matchedSkills.length)matches.push({...candidate,titleMatch,matchedSkills,matchScore:matchedSkills.length+Number(titleMatch)});
    }
    matches.sort((a,b)=>b.matchScore-a.matchScore||a.candidate_id.localeCompare(b.candidate_id));
    const candidates=[];
    for(const match of matches.slice(0,10)){
      const row=await this.db.prepare('SELECT c.full_name,c.email,p.reason,p.interested_title FROM candidates c JOIN candidate_talent_pool p ON p.candidate_id=c.id WHERE c.id=?').get(match.candidate_id);
      if(row)candidates.push({candidateId:match.candidate_id,fullName:row.full_name,email:row.email,interestedTitle:row.interested_title,reason:row.reason,titleMatch:match.titleMatch,matchedSkills:match.matchedSkills,matchScore:match.matchScore});
    }
    await this.actor(actor);
    return {success:true,requisitionId:req.id,candidates};
  }
}
module.exports=TalentPoolService;
