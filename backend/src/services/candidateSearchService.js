const crypto = require('node:crypto');
const Rbac = require('../middlewares/rbacMiddleware');
const Requisitions = require('./requisitionService');

const fields = ['search','stage','requisitionId','sourceId','tag','submittedFrom','submittedTo','ratingMin','ratingMax'];
const stages = ['ALL','NEW','APPLIED','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN','RECEIVED','IN_REVIEW','INTERVIEWING','CLOSED'];
const fail = (code, message, statusCode = 400) => ({success:false,statusCode,code,message});
const like = value => '%' + value.replace(/[!%_]/g, '!$&') + '%';
const fold = value => String(value ?? '').normalize('NFC').toLowerCase();

class CandidateSearchService {
  constructor(db) {
    this.db = db; this.rbac = new Rbac(db); this.requisitions = new Requisitions(db);
    if(db.provider==='sqlite')db.function('ats_candidate_search_fold',{deterministic:true},fold);
  }
  folded(column) { return this.db.provider==='sqlite'?'ats_candidate_search_fold('+column+')':'LOWER(NORMALIZE('+column+',NFC))'; }
  async hasMergeColumn() {
    const columns=this.db.provider==='postgres'
      ?await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidates'").all()
      :await this.db.prepare('PRAGMA table_info(candidates)').all();
    return columns.some(column=>column.name==='merged_into_id');
  }

  normalize(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_FILTER','Điều kiện lọc không hợp lệ.');
    const filters = {};
    for (const key of fields) {
      if (input[key] === undefined || input[key] === '') continue;
      if (typeof input[key] !== 'string' || input[key].length > (key === 'search' ? 500 : 200)) throw fail('INVALID_FILTER','Điều kiện lọc không hợp lệ.');
      const value = input[key].trim();
      if (value && !(value === 'ALL' && ['stage','requisitionId','sourceId'].includes(key))) filters[key] = value;
    }
    if (filters.stage && !stages.includes(filters.stage)) throw fail('INVALID_STAGE','Giai đoạn không hợp lệ.');
    for (const key of ['submittedFrom','submittedTo']) if (filters[key]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filters[key]) || !Number.isFinite(Date.parse(filters[key])) || new Date(filters[key]).toISOString().slice(0,10) !== filters[key]) throw fail('INVALID_DATE','Ngày nộp không hợp lệ.');
    }
    if (filters.submittedFrom && filters.submittedTo && filters.submittedFrom > filters.submittedTo) throw fail('INVALID_DATE_RANGE','Khoảng ngày nộp không hợp lệ.');
    for (const key of ['ratingMin','ratingMax']) if (filters[key] && (!/^-?\d+(\.\d+)?$/.test(filters[key]) || !Number.isFinite(Number(filters[key])) || Math.abs(Number(filters[key])) > Number.MAX_SAFE_INTEGER)) throw fail('INVALID_RATING','Điểm đánh giá không hợp lệ.');
    if (filters.ratingMin !== undefined && filters.ratingMax !== undefined && Number(filters.ratingMin) > Number(filters.ratingMax)) throw fail('INVALID_RATING_RANGE','Khoảng điểm không hợp lệ.');
    return filters;
  }

  async actor(viewer) {
    const actor = await this.rbac.getAuthorizedActor(viewer?.id,'candidate.read');
    if (!actor) throw fail('CANDIDATE_FORBIDDEN','Bạn không có quyền xem hồ sơ ứng viên.',403);
    return actor;
  }

  async availability(viewer) {
    await this.actor(viewer);
    const names=['candidate_saved_filters','ats_candidate_search_migrations','candidate_tags'];
    const tables=await this.db.prepare(this.db.provider==='postgres'
      ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN (?,?,?)"
      : "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?)").all(...names);
    if(tables.length!==names.length)return {success:true,enabled:false};
    const columns=this.db.provider==='postgres'
      ?await this.db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='candidates'").all()
      :await this.db.prepare('PRAGMA table_info(candidates)').all();
    if(!columns.some(column=>column.name==='cover_letter'))return {success:true,enabled:false};
    const ledger=await this.db.prepare('SELECT checksum FROM ats_candidate_search_migrations WHERE version=1').get();
    return {success:true,enabled:ledger?.checksum===require('../db/migrate-candidate-search').checksum};
  }

  async options(viewer) {
    const actor = await this.actor(viewer);
    const scope = this.requisitions.candidateVisibility({...actor,roles:actor.roles.filter(role => role !== 'CANDIDATE')});
    const where = scope?.condition || '1=1', params = scope?.params || [];
    const from = ' FROM candidates c LEFT JOIN requisitions r ON r.id=c.requisition_id ';
    const requisitions = await this.db.prepare('SELECT DISTINCT r.id,r.title'+from+'WHERE r.id IS NOT NULL AND '+where+' ORDER BY r.title,r.id').all(...params);
    const sources = await this.db.prepare('SELECT DISTINCT s.id,s.name'+from+'JOIN recruitment_catalog_items s ON s.id=c.source_id WHERE '+where+' ORDER BY s.name,s.id').all(...params);
    const tags = await this.db.prepare('SELECT DISTINCT t.tag_name AS name'+from+'JOIN candidate_tags t ON t.candidate_id=c.id WHERE '+where+' ORDER BY t.tag_name').all(...params);
    await this.actor(viewer);
    return {success:true,requisitions,sources,tags};
  }

  async search(input, viewer) {
    return this.db.transaction(async () => {
      if (this.db.provider === 'postgres') await this.db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      return this.searchRows(input,viewer);
    });
  }

  async scoreAccess(actor) {
    const canInterview=await this.rbac.getAuthorizedActor(actor.id,'interview.read');
    const canEvaluate=await this.rbac.getAuthorizedActor(actor.id,'interview.evaluation.read');
    if(!canInterview&&!canEvaluate)return {condition:'1=0',params:[],allowed:false};
    if(actor.roles.some(role=>['ADMIN','HR_MANAGER'].includes(role))||(canEvaluate&&actor.roles.includes('APPROVER')))return {condition:'1=1',params:[],allowed:true};
    const scopes=[],params=[];
    if(actor.roles.includes('HIRING_MGR')){scopes.push(this.requisitions.hiringRequisitionScope());params.push(actor.id,actor.id,actor.id);}
    if(actor.roles.includes('RECRUITER')){
      const position=this.requisitions.recruiterScope('r',actor.id),candidatePosition=this.requisitions.recruiterScope('candidate_position',actor.id);
      scopes.push('('+position.condition+' AND '+candidatePosition.condition+')');params.push(...position.params,...candidatePosition.params);
    }
    if(actor.roles.includes('INTERVIEWER')){scopes.push('i.interviewer_id=?');params.push(actor.id);}
    return {condition:scopes.length?'('+scopes.join(' OR ')+')':'1=0',params,allowed:scopes.length>0};
  }

  async searchRows(input, viewer) {
    const actor = await this.actor(viewer), filters = this.normalize(input);
    const scores=await this.scoreAccess(actor);
    const page = input.page === undefined ? 1 : Number(input.page), pageSize = input.pageSize === undefined ? 50 : Number(input.pageSize);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw fail('INVALID_PAGINATION','Phân trang không hợp lệ.');
    const visibility = this.requisitions.candidateVisibility(actor);
    const internal = this.requisitions.candidateVisibility({...actor,roles:actor.roles.filter(role => role !== 'CANDIDATE')});
    const where = [], params = [];
    if (await this.hasMergeColumn()) where.push('c.merged_into_id IS NULL');
    if (visibility) { where.push(visibility.condition); params.push(...visibility.params); }
    if (filters.sourceId || filters.tag || filters.ratingMin !== undefined || filters.ratingMax !== undefined) {
      if (internal) { where.push(internal.condition); params.push(...internal.params); }
    }
    if (filters.search) {
      where.push('('+['c.full_name','c.email','c.phone_number','c.current_company','c.cover_letter'].map(column=>this.folded(column)+" LIKE ? ESCAPE '!'").join(' OR ')+')');
      params.push(...Array(5).fill(like(fold(filters.search))));
    }
    for (const [field,column] of [['requisitionId','c.requisition_id'],['sourceId','c.source_id']]) if (filters[field]) { where.push(column+'=?'); params.push(filters[field]); }
    if (filters.tag) { where.push('EXISTS (SELECT 1 FROM candidate_tags t WHERE t.candidate_id=c.id AND '+this.folded('t.tag_name')+'=?)'); params.push(fold(filters.tag)); }
    if (filters.submittedFrom) { where.push('DATE(c.created_at)>=?'); params.push(filters.submittedFrom); }
    if (filters.submittedTo) { where.push('DATE(c.created_at)<=?'); params.push(filters.submittedTo); }
    if (filters.stage) {
      const closed=filters.stage==='CLOSED';
      const publicStages = ['NEW','APPLIED','SCREENING','INTERVIEW','OFFER','HIRED','REJECTED','WITHDRAWN'].filter(stage => closed ? require('./candidatePortalService').mapPublicStatus(stage).code !== filters.stage : require('./candidatePortalService').mapPublicStatus(stage).code === filters.stage);
      const placeholders=publicStages.map(() => '?').join(',');
      const publicCondition = closed ? `(c.stage IS NULL OR c.stage NOT IN (${placeholders}))` : publicStages.length ? `c.stage IN (${placeholders})` : '1=0';
      const scope = internal?.condition || '1=1';
      where.push(`((${scope} AND c.stage=?) OR (NOT ${scope} AND ${publicCondition}))`);
      params.push(...(internal?.params || []),filters.stage,...(internal?.params || []),...publicStages);
    }
    const cte="WITH candidate_scores AS (SELECT i.candidate_id,AVG(CAST(i.score AS DOUBLE PRECISION)) AS average_score FROM interviews i LEFT JOIN candidates score_candidate ON score_candidate.id=i.candidate_id LEFT JOIN requisitions r ON r.id=COALESCE(i.requisition_id,score_candidate.requisition_id) LEFT JOIN requisitions candidate_position ON candidate_position.id=score_candidate.requisition_id WHERE i.status='COMPLETED' AND "+scores.condition+' GROUP BY i.candidate_id) ';
    for (const [key,op] of [['ratingMin','>='],['ratingMax','<=']]) if (filters[key] !== undefined) { where.push('score.average_score'+op+'?'); params.push(Number(filters[key])); }
    const from = 'FROM candidates c LEFT JOIN requisitions r ON r.id=c.requisition_id LEFT JOIN candidate_scores score ON score.candidate_id=c.id WHERE '+(where.length ? where.join(' AND ') : '1=1');
    const total = Number((await this.db.prepare(cte+'SELECT COUNT(*) AS total '+from).get(...scores.params,...params)).total);
    const rows = await this.db.prepare(cte+'SELECT c.id,score.average_score '+from+' ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?').all(...scores.params,...params,pageSize,(page-1)*pageSize);
    const mapped = await this.requisitions.getCandidates({viewer:actor,candidateIds:rows.map(row => row.id)});
    if (!mapped.success) return mapped;
    const byId = new Map(mapped.candidates.map(row => [row.id,row]));
    return {success:true,total,page,pageSize,candidates:rows.filter(row => byId.has(row.id)).map(row => {
      const dto = byId.get(row.id);
      return Object.hasOwn(dto,'stage')&&scores.allowed ? {...dto,interviewAverage:row.average_score === null ? null : Number(row.average_score)} : dto;
    })};
  }

  async saved(viewer, method = 'GET', input = {}, id = null) {
    return this.db.transaction(async () => {
      if (method === 'POST' && this.db.provider === 'postgres') await this.db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(viewer?.id || '');
      const actor = await this.actor(viewer);
      if (method === 'GET') {
        const rows = await this.db.prepare('SELECT id,name,filters_json,created_at FROM candidate_saved_filters WHERE user_id=? ORDER BY created_at,id').all(actor.id);
        return {success:true,filters:rows.map(row => ({id:row.id,name:row.name,filters:JSON.parse(row.filters_json),createdAt:row.created_at}))};
      }
      if (method === 'DELETE') {
        await this.db.prepare('DELETE FROM candidate_saved_filters WHERE id=? AND user_id=?').run(id,actor.id);
        return {success:true};
      }
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || !input.filters || typeof input.filters !== 'object' || Array.isArray(input.filters)) throw fail('INVALID_SAVED_FILTER','Tên và bộ lọc không hợp lệ.');
      const filters = this.normalize(input.filters);
      const count = Number((await this.db.prepare('SELECT COUNT(*) AS count FROM candidate_saved_filters WHERE user_id=?').get(actor.id)).count);
      if (count >= 50) throw fail('SAVED_FILTER_LIMIT','Chỉ lưu tối đa 50 bộ lọc.',409);
      const filterId = crypto.randomUUID();
      await this.db.prepare('INSERT INTO candidate_saved_filters(id,user_id,name,filters_json,created_at) VALUES(?,?,?,?,?)').run(filterId,actor.id,input.name.trim(),JSON.stringify(filters),new Date().toISOString());
      return {success:true,statusCode:201,id:filterId};
    });
  }
}
module.exports = CandidateSearchService;
