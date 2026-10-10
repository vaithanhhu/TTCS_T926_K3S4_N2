CREATE TABLE requisition_approval_workflows (
 id TEXT PRIMARY KEY, requisition_id TEXT NOT NULL UNIQUE, creator_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','NEEDS_INFO','APPROVED','REJECTED')), version INTEGER NOT NULL CHECK(version>0),
 current_submission_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE requisition_approval_submissions (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES requisition_approval_workflows(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>0), approval_snapshot_id TEXT NOT NULL REFERENCES requisition_approval_snapshots(workflow_id) ON DELETE RESTRICT,
 document_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(workflow_id,revision), UNIQUE(workflow_id,id)
);
CREATE TABLE requisition_approval_steps (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES requisition_approval_submissions(id) ON DELETE RESTRICT,
 level_order INTEGER NOT NULL CHECK(level_order>0), approver_id TEXT NOT NULL, approver_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('WAITING','PENDING','APPROVED','REJECTED','NEEDS_INFO','PRIOR_APPROVED')), UNIQUE(submission_id,level_order)
);
CREATE UNIQUE INDEX s302_single_pending_step ON requisition_approval_steps(submission_id) WHERE status='PENDING';
CREATE INDEX s302_assignee ON requisition_approval_steps(approver_id,status);
CREATE TABLE requisition_approval_events (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES requisition_approval_workflows(id) ON DELETE RESTRICT,
 submission_id TEXT NOT NULL REFERENCES requisition_approval_submissions(id) ON DELETE RESTRICT,
 step_id TEXT REFERENCES requisition_approval_steps(id) ON DELETE RESTRICT, workflow_version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('SUBMIT','APPROVE','REJECT','REQUEST_INFO','RESUBMIT')),
 comment TEXT, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workflow_id,workflow_version), UNIQUE(actor_id,request_id), CHECK(action NOT IN ('REJECT','REQUEST_INFO') OR (comment IS NOT NULL AND length(trim(comment))>0))
);
ALTER TABLE requisition_approval_workflows ADD CONSTRAINT s302_current_submission FOREIGN KEY(id,current_submission_id) REFERENCES requisition_approval_submissions(workflow_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION s302_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'APPROVAL_HISTORY_IMMUTABLE'; END; $$;
CREATE TRIGGER s302_events_immutable BEFORE UPDATE OR DELETE ON requisition_approval_events FOR EACH ROW EXECUTE FUNCTION s302_immutable();
CREATE TRIGGER s302_documents_immutable BEFORE UPDATE OR DELETE ON requisition_approval_submissions FOR EACH ROW EXECUTE FUNCTION s302_immutable();
CREATE TRIGGER s302_events_no_truncate BEFORE TRUNCATE ON requisition_approval_events FOR EACH STATEMENT EXECUTE FUNCTION s302_immutable();
CREATE TRIGGER s302_documents_no_truncate BEFORE TRUNCATE ON requisition_approval_submissions FOR EACH STATEMENT EXECUTE FUNCTION s302_immutable();
CREATE FUNCTION s302_step_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'PENDING' OR NEW.status NOT IN ('APPROVED','REJECTED','NEEDS_INFO') THEN
  IF TG_OP='UPDATE' AND OLD.status='WAITING' AND NEW.status='PENDING' AND OLD.id=NEW.id AND OLD.submission_id=NEW.submission_id AND OLD.level_order=NEW.level_order AND OLD.approver_id=NEW.approver_id AND OLD.approver_name=NEW.approver_name THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'APPROVAL_STEP_IMMUTABLE';
 END IF;
 IF OLD.id<>NEW.id OR OLD.submission_id<>NEW.submission_id OR OLD.level_order<>NEW.level_order OR OLD.approver_id<>NEW.approver_id OR OLD.approver_name<>NEW.approver_name THEN RAISE EXCEPTION 'APPROVAL_STEP_IMMUTABLE'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER s302_steps_immutable BEFORE UPDATE OR DELETE ON requisition_approval_steps FOR EACH ROW EXECUTE FUNCTION s302_step_guard();
CREATE TRIGGER s302_steps_no_truncate BEFORE TRUNCATE ON requisition_approval_steps FOR EACH STATEMENT EXECUTE FUNCTION s302_immutable();
