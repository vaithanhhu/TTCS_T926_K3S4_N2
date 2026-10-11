CREATE TABLE requisition_approval_workflows (
 id TEXT PRIMARY KEY, requisition_id TEXT NOT NULL UNIQUE, creator_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','NEEDS_INFO','APPROVED','REJECTED')), version INTEGER NOT NULL CHECK(version>0),
 current_submission_id TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), FOREIGN KEY(id,current_submission_id) REFERENCES requisition_approval_submissions(workflow_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE requisition_approval_submissions (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES requisition_approval_workflows(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>0), approval_snapshot_id TEXT NOT NULL REFERENCES requisition_approval_snapshots(workflow_id) ON DELETE RESTRICT,
 document_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(workflow_id,revision), UNIQUE(workflow_id,id)
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
 comment TEXT, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(workflow_id,workflow_version), UNIQUE(actor_id,request_id), CHECK(action NOT IN ('REJECT','REQUEST_INFO') OR (comment IS NOT NULL AND length(trim(comment))>0))
);
CREATE TRIGGER s302_events_update BEFORE UPDATE ON requisition_approval_events BEGIN SELECT RAISE(ABORT,'APPROVAL_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER s302_events_delete BEFORE DELETE ON requisition_approval_events BEGIN SELECT RAISE(ABORT,'APPROVAL_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER s302_documents_update BEFORE UPDATE ON requisition_approval_submissions BEGIN SELECT RAISE(ABORT,'APPROVAL_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER s302_documents_delete BEFORE DELETE ON requisition_approval_submissions BEGIN SELECT RAISE(ABORT,'APPROVAL_HISTORY_IMMUTABLE'); END;
CREATE TRIGGER s302_step_update BEFORE UPDATE ON requisition_approval_steps WHEN OLD.id<>NEW.id OR OLD.submission_id<>NEW.submission_id OR OLD.level_order<>NEW.level_order OR OLD.approver_id<>NEW.approver_id OR OLD.approver_name<>NEW.approver_name OR NOT ((OLD.status='WAITING' AND NEW.status='PENDING') OR (OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED','NEEDS_INFO'))) BEGIN SELECT RAISE(ABORT,'APPROVAL_STEP_IMMUTABLE'); END;
CREATE TRIGGER s302_step_delete BEFORE DELETE ON requisition_approval_steps BEGIN SELECT RAISE(ABORT,'APPROVAL_STEP_IMMUTABLE'); END;
