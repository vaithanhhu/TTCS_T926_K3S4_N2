CREATE TABLE requisition_open_policy (
 requisition_id TEXT PRIMARY KEY REFERENCES requisitions(id) ON DELETE CASCADE,
 policy_kind TEXT NOT NULL CHECK(policy_kind IN ('STRICT','GRANDFATHERED')),
 document_version INTEGER NOT NULL DEFAULT 1 CHECK(document_version>0),
 effective_submission_id TEXT,
 activation_event_id TEXT,
 effective_hash TEXT,
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO requisition_open_policy(requisition_id,policy_kind)
 SELECT id,CASE WHEN status IN ('OPEN','IN_PROGRESS','PAUSED') THEN 'GRANDFATHERED' ELSE 'STRICT' END FROM requisitions;
CREATE TRIGGER open_policy_classification BEFORE UPDATE ON requisition_open_policy
 WHEN OLD.requisition_id<>NEW.requisition_id OR OLD.policy_kind<>NEW.policy_kind
 BEGIN SELECT RAISE(ABORT,'OPEN_POLICY_IMMUTABLE'); END;
CREATE TRIGGER open_policy_insert_guard BEFORE INSERT ON requisitions
 WHEN NEW.status IN ('OPEN','IN_PROGRESS') AND NOT EXISTS (
 SELECT 1 FROM requisition_open_policy WHERE requisition_id=NEW.id AND
 (policy_kind='GRANDFATHERED' OR (effective_submission_id IS NOT NULL AND activation_event_id IS NOT NULL AND effective_hash IS NOT NULL)))
 BEGIN SELECT RAISE(ABORT,'REQUISITION_APPROVAL_REQUIRED'); END;
CREATE TRIGGER open_policy_update_guard BEFORE UPDATE OF status ON requisitions
 WHEN NEW.status IN ('OPEN','IN_PROGRESS') AND NOT EXISTS (
 SELECT 1 FROM requisition_open_policy WHERE requisition_id=NEW.id AND
 (policy_kind='GRANDFATHERED' OR (effective_submission_id IS NOT NULL AND activation_event_id IS NOT NULL AND effective_hash IS NOT NULL)))
 BEGIN SELECT RAISE(ABORT,'REQUISITION_APPROVAL_REQUIRED'); END;
CREATE TRIGGER open_policy_enroll AFTER INSERT ON requisitions
 BEGIN INSERT INTO requisition_open_policy(requisition_id,policy_kind) VALUES(NEW.id,'STRICT') ON CONFLICT DO NOTHING; END;
CREATE TRIGGER open_policy_version AFTER UPDATE OF title,job_title_id,department_id,department_name,headcount,recruitment_reason,proposed_salary_min,proposed_salary_max,needed_date,job_description,candidate_requirements,salary_justification,work_location_id,work_mode_id ON requisitions
 BEGIN UPDATE requisition_open_policy SET document_version=document_version+1 WHERE requisition_id=NEW.id; END;
