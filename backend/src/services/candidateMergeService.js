const crypto = require('node:crypto');
const Rbac = require('../middlewares/rbacMiddleware');

class CandidateMergeError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

const CHILD_TABLES = ['interviews', 'offers', 'candidate_documents', 'candidate_status_history', 'candidate_tags', 'candidate_notes', 'application_tracking_tokens', 'candidate_stage_exceptions', 'hiring_decisions'];

class CandidateMergeService {
  constructor(db) { this.db = db; this.rbac = new Rbac(db); }
  fail(code, message, status = 400) { throw new CandidateMergeError(code, message, status); }
  async actor(user, permission) {
    const actor = await this.rbac.getAuthorizedActor(user?.id, permission);
    if (!actor) this.fail('CANDIDATE_MERGE_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.', 403);
    return actor;
  }
  async candidate(id, lock = false) {
    const row = await this.db.prepare(`SELECT * FROM candidates WHERE id=?${lock && this.db.provider === 'postgres' ? ' FOR UPDATE' : ''}`).get(id);
    if (!row) this.fail('CANDIDATE_NOT_FOUND', 'Không tìm thấy hồ sơ ứng viên.', 404);
    return row;
  }
  async assertScope(id, actor, permission) {
    if (actor.roles.some(role => ['ADMIN', 'HR_MANAGER'].includes(role))) return;
    const access = await new (require('./requisitionService'))(this.db).candidateAccess(id, actor, permission);
    if (!access.success) this.fail(access.code || 'CANDIDATE_OUT_OF_SCOPE', access.message || 'Hồ sơ không thuộc vị trí bạn được phân công.', access.statusCode || 403);
  }
  async tableExists(table) {
    if (this.db.provider === 'postgres') return Boolean(await this.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?").get(table));
    return Boolean(await this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  async compare(firstId, secondId, user) {
    const actor = await this.actor(user, 'candidate.read');
    if (!firstId || !secondId || firstId === secondId) this.fail('CANDIDATE_COMPARE_INVALID', 'Chọn hai hồ sơ khác nhau.');
    const [first, second] = await Promise.all([this.candidate(firstId), this.candidate(secondId)]);
    await Promise.all([this.assertScope(firstId, actor, 'candidate.read'), this.assertScope(secondId, actor, 'candidate.read')]);
    const summary = async row => {
      const result = Object.fromEntries(['id','full_name','email','phone_number','requisition_id','stage','experience_years','current_company','expected_salary','notes','source_id','created_at','job_posting_id','cover_letter','referrer_name','referral_notes','is_internal_referral'].filter(key => Object.hasOwn(row,key)).map(key => [key,row[key]]));
      result.related = {};
      for (const table of CHILD_TABLES.concat('candidate_talent_pool', 'onboarding_checklists', 'candidate_communications', 'interview_batch_items')) {
        if (!await this.tableExists(table)) { result.related[table] = 0; continue; }
        result.related[table] = (await this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE candidate_id=?`).get(row.id)).count;
      }
      return result;
    };
    return { first: await summary(first), second: await summary(second) };
  }
  async merge({ primaryId, secondaryId }, user) {
    return this.db.transaction(async () => {
      const actor = await this.actor(user, 'candidate.merge');
      if (!primaryId || !secondaryId || primaryId === secondaryId) this.fail('CANDIDATE_MERGE_INVALID', 'Chọn hai hồ sơ khác nhau.');
      const ids = [primaryId, secondaryId].sort();
      const locked = await Promise.all(ids.map(id => this.candidate(id, true)));
      const byId = new Map(locked.map(row => [row.id, row]));
      const primary = byId.get(primaryId), secondary = byId.get(secondaryId);
      await Promise.all([this.assertScope(primaryId, actor, 'candidate.merge'), this.assertScope(secondaryId, actor, 'candidate.merge')]);
      if (primary.merged_into_id || secondary.merged_into_id) this.fail('CANDIDATE_ALREADY_MERGED', 'Một hồ sơ đã thuộc về một lần gộp khác.', 409);
      if (await this.tableExists('offers')) {
        const primaryOffer = await this.db.prepare("SELECT 1 FROM offers WHERE candidate_id=? AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT') LIMIT 1").get(primaryId);
        const secondaryOffer = await this.db.prepare("SELECT 1 FROM offers WHERE candidate_id=? AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT') LIMIT 1").get(secondaryId);
        if (primaryOffer && secondaryOffer) this.fail('CANDIDATE_MERGE_OFFER_CONFLICT', 'Cả hai hồ sơ đều có thư mời nhận việc đang hoạt động. Vui lòng xử lý trước khi gộp.', 409);
      }
      const eventId = `merge-${crypto.randomUUID()}`;
      const moved = {};
      for (const table of CHILD_TABLES) {
        if (!await this.tableExists(table)) continue;
        const rows = await this.db.prepare(`SELECT id FROM ${table} WHERE candidate_id=? ORDER BY id`).all(secondaryId);
        moved[table] = rows.map(row => row.id);
        if (rows.length) await this.db.prepare(`UPDATE ${table} SET candidate_id=? WHERE candidate_id=?`).run(primaryId, secondaryId);
      }
      // candidate_talent_pool is unique per candidate. Preserve a secondary record if both exist;
      // moving it when the primary already has one would violate the invariant and lose its history.
      if (await this.tableExists('candidate_talent_pool')) {
        const hasPrimary = await this.db.prepare('SELECT id FROM candidate_talent_pool WHERE candidate_id=?').get(primaryId);
        const poolRows = await this.db.prepare('SELECT id FROM candidate_talent_pool WHERE candidate_id=? ORDER BY id').all(secondaryId);
        moved.candidate_talent_pool = hasPrimary ? [] : poolRows.map(row => row.id);
        if (moved.candidate_talent_pool.length) await this.db.prepare('UPDATE candidate_talent_pool SET candidate_id=? WHERE candidate_id=?').run(primaryId, secondaryId);
      }
      if (await this.tableExists('onboarding_checklists')) {
        const hasPrimary = await this.db.prepare('SELECT id FROM onboarding_checklists WHERE candidate_id=?').get(primaryId);
        const checklistRows = await this.db.prepare('SELECT id FROM onboarding_checklists WHERE candidate_id=? ORDER BY id').all(secondaryId);
        moved.onboarding_checklists = hasPrimary ? [] : checklistRows.map(row => row.id);
        if (moved.onboarding_checklists.length) await this.db.prepare('UPDATE onboarding_checklists SET candidate_id=? WHERE candidate_id=?').run(primaryId, secondaryId);
      }
      if (await this.tableExists('candidate_communications')) {
        const hasPrimaryRejection = Boolean(await this.db.prepare("SELECT 1 FROM candidate_communications WHERE candidate_id=? AND type='REJECTION' AND status IN ('DELIVERED', 'SENT_LOCAL') LIMIT 1").get(primaryId));
        const commRows = await this.db.prepare('SELECT id, type, status FROM candidate_communications WHERE candidate_id=? ORDER BY id').all(secondaryId);
        const commIds = commRows.filter(row => !(hasPrimaryRejection && row.type === 'REJECTION' && ['DELIVERED', 'SENT_LOCAL'].includes(row.status))).map(row => row.id);
        moved.candidate_communications = commIds;
        if (commIds.length) {
          const placeholders = commIds.map(() => '?').join(',');
          await this.db.prepare(`UPDATE candidate_communications SET candidate_id=? WHERE candidate_id=? AND id IN (${placeholders})`).run(primaryId, secondaryId, ...commIds);
        }
      }
      if (await this.tableExists('interview_batch_items')) {
        const batchRows = await this.db.prepare('SELECT interview_id, batch_id FROM interview_batch_items WHERE candidate_id=? ORDER BY interview_id').all(secondaryId);
        const batchMoveIds = [];
        for (const row of batchRows) {
          const inBatch = await this.db.prepare('SELECT 1 FROM interview_batch_items WHERE batch_id=? AND candidate_id=? LIMIT 1').get(row.batch_id, primaryId);
          if (!inBatch) batchMoveIds.push(row.interview_id);
        }
        moved.interview_batch_items = batchMoveIds;
        for (const interviewId of batchMoveIds) {
          await this.db.prepare('UPDATE interview_batch_items SET candidate_id=? WHERE candidate_id=? AND interview_id=?').run(primaryId, secondaryId, interviewId);
        }
      }
      const before = { primary, secondary };
      const now = new Date().toISOString();
      await this.db.prepare('UPDATE candidates SET merged_into_id=? WHERE id=?').run(primaryId, secondaryId);
      await this.db.prepare(`INSERT INTO candidate_merge_events
        (id,primary_candidate_id,secondary_candidate_id,actor_id,actor_name,merged_at,before_json,moved_rows_json,status)
        VALUES (?,?,?,?,?,?,?,?,'MERGED')`).run(eventId, primaryId, secondaryId, actor.id, actor.fullName || actor.email, now, JSON.stringify(before), JSON.stringify(moved));
      return { success: true, eventId, primaryId, secondaryId, mergedAt: now, undoUntil: new Date(Date.now() + 86400000).toISOString() };
    });
  }
  async undo(eventId, user) {
    return this.db.transaction(async () => {
      const actor = await this.actor(user, 'candidate.merge.undo');
      const event = await this.db.prepare(`SELECT * FROM candidate_merge_events WHERE id=?${this.db.provider === 'postgres' ? ' FOR UPDATE' : ''}`).get(eventId);
      if (!event) this.fail('CANDIDATE_MERGE_NOT_FOUND', 'Không tìm thấy lần gộp.', 404);
      if (event.status !== 'MERGED') this.fail('CANDIDATE_MERGE_ALREADY_UNDONE', 'Lần gộp này đã được hoàn tác.', 409);
      const mergedAt = new Date(String(event.merged_at).replace(' ', 'T') + (String(event.merged_at).includes('Z') || /[+-]\d\d:?\d\d$/.test(String(event.merged_at)) ? '' : 'Z')).getTime();
      if (!Number.isFinite(mergedAt) || Date.now() - mergedAt >= 86400000) this.fail('CANDIDATE_MERGE_UNDO_EXPIRED', 'Đã quá 24 giờ, không thể hoàn tác lần gộp này.', 410);
      await this.candidate(event.primary_candidate_id, true);
      const secondary = await this.candidate(event.secondary_candidate_id, true);
      await Promise.all([this.assertScope(event.primary_candidate_id, actor, 'candidate.merge.undo'), this.assertScope(event.secondary_candidate_id, actor, 'candidate.merge.undo')]);
      if (secondary.merged_into_id !== event.primary_candidate_id) this.fail('CANDIDATE_MERGE_STATE_CHANGED', 'Trạng thái hồ sơ đã thay đổi; cần kiểm tra thủ công trước khi hoàn tác.', 409);
      const moved = JSON.parse(event.moved_rows_json || '{}');
      for (const [table, rowIds] of Object.entries(moved)) {
        if (!rowIds.length || !await this.tableExists(table)) continue;
        if (table === 'interview_batch_items') {
          const placeholders = rowIds.map(() => '?').join(',');
          await this.db.prepare(`UPDATE interview_batch_items SET candidate_id=? WHERE candidate_id=? AND interview_id IN (${placeholders})`).run(event.secondary_candidate_id, event.primary_candidate_id, ...rowIds);
          const movedElsewhere = await this.db.prepare(`SELECT COUNT(*) AS count FROM interview_batch_items WHERE candidate_id NOT IN (?,?) AND interview_id IN (${placeholders})`).get(event.primary_candidate_id, event.secondary_candidate_id, ...rowIds);
          if (Number(movedElsewhere.count)) this.fail('CANDIDATE_MERGE_UNDO_CONFLICT', 'Một số dữ liệu đã thay đổi sau khi gộp; hoàn tác đã bị hủy để tránh ghi đè.', 409);
          continue;
        }
        const placeholders = rowIds.map(() => '?').join(',');
        await this.db.prepare(`UPDATE ${table} SET candidate_id=? WHERE candidate_id=? AND id IN (${placeholders})`).run(event.secondary_candidate_id, event.primary_candidate_id, ...rowIds);
        const movedElsewhere = await this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE candidate_id NOT IN (?,?) AND id IN (${placeholders})`).get(event.primary_candidate_id, event.secondary_candidate_id, ...rowIds);
        if (Number(movedElsewhere.count)) this.fail('CANDIDATE_MERGE_UNDO_CONFLICT', 'Một số dữ liệu đã thay đổi sau khi gộp; hoàn tác đã bị hủy để tránh ghi đè.', 409);
      }
      await this.db.prepare('UPDATE candidates SET merged_into_id=NULL WHERE id=?').run(event.secondary_candidate_id);
      await this.db.prepare("UPDATE candidate_merge_events SET status='UNDONE',undone_at=?,undone_by=? WHERE id=? AND status='MERGED'").run(new Date().toISOString(), actor.id, eventId);
      return { success: true, eventId, primaryId: event.primary_candidate_id, secondaryId: event.secondary_candidate_id };
    });
  }
  async recent(user) {
    const actor = await this.actor(user, 'candidate.merge.undo');
    const rows = await this.db.prepare(`SELECT id,primary_candidate_id,secondary_candidate_id,actor_id,actor_name,merged_at,status
      FROM candidate_merge_events WHERE status='MERGED' ORDER BY merged_at DESC LIMIT 30`).all();
    return { rows, actorId: actor.id };
  }
}
CandidateMergeService.CandidateMergeError = CandidateMergeError;
module.exports = CandidateMergeService;
