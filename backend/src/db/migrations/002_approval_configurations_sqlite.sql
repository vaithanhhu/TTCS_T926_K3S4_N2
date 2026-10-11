CREATE TABLE approval_configurations (
 id TEXT PRIMARY KEY, department_id TEXT NOT NULL UNIQUE, department_name TEXT NOT NULL,
 published_version_id TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), FOREIGN KEY (id,published_version_id) REFERENCES approval_configuration_versions(configuration_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE approval_configuration_versions (
 id TEXT PRIMARY KEY, configuration_id TEXT NOT NULL REFERENCES approval_configurations(id) ON DELETE RESTRICT,
 version_number INTEGER NOT NULL CHECK(version_number>0), state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHED')),
 created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), published_by TEXT, published_at TEXT,
 UNIQUE(configuration_id,version_number), UNIQUE(configuration_id,id),
 CHECK((state='DRAFT' AND published_by IS NULL AND published_at IS NULL) OR (state='PUBLISHED' AND published_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE approval_configuration_levels (
 version_id TEXT NOT NULL REFERENCES approval_configuration_versions(id) ON DELETE RESTRICT,
 level_order INTEGER NOT NULL CHECK(level_order>0), salary_limit NUMERIC NOT NULL CHECK(salary_limit>=0 AND salary_limit<=9007199254740991),
 approver_user_id TEXT NOT NULL, approver_name TEXT NOT NULL, PRIMARY KEY(version_id,level_order)
);
CREATE TABLE requisition_approval_snapshots (
 workflow_id TEXT PRIMARY KEY, requisition_id TEXT NOT NULL,
 configuration_version_id TEXT NOT NULL REFERENCES approval_configuration_versions(id) ON DELETE RESTRICT,
 snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_approval_snapshot_requisition ON requisition_approval_snapshots(requisition_id);
CREATE TRIGGER s301_version_update BEFORE UPDATE ON approval_configuration_versions WHEN OLD.state='PUBLISHED' BEGIN SELECT RAISE(ABORT,'APPROVAL_VERSION_IMMUTABLE'); END;
CREATE TRIGGER s301_version_delete BEFORE DELETE ON approval_configuration_versions WHEN OLD.state='PUBLISHED' BEGIN SELECT RAISE(ABORT,'APPROVAL_VERSION_IMMUTABLE'); END;
CREATE TRIGGER s301_level_insert BEFORE INSERT ON approval_configuration_levels WHEN EXISTS(SELECT 1 FROM approval_configuration_versions WHERE id=NEW.version_id AND state='PUBLISHED') BEGIN SELECT RAISE(ABORT,'APPROVAL_VERSION_IMMUTABLE'); END;
CREATE TRIGGER s301_level_update BEFORE UPDATE ON approval_configuration_levels WHEN EXISTS(SELECT 1 FROM approval_configuration_versions WHERE id IN (OLD.version_id,NEW.version_id) AND state='PUBLISHED') BEGIN SELECT RAISE(ABORT,'APPROVAL_VERSION_IMMUTABLE'); END;
CREATE TRIGGER s301_level_delete BEFORE DELETE ON approval_configuration_levels WHEN EXISTS(SELECT 1 FROM approval_configuration_versions WHERE id=OLD.version_id AND state='PUBLISHED') BEGIN SELECT RAISE(ABORT,'APPROVAL_VERSION_IMMUTABLE'); END;
CREATE TRIGGER s301_snapshot_update BEFORE UPDATE ON requisition_approval_snapshots BEGIN SELECT RAISE(ABORT,'APPROVAL_SNAPSHOT_IMMUTABLE'); END;
CREATE TRIGGER s301_snapshot_delete BEFORE DELETE ON requisition_approval_snapshots BEGIN SELECT RAISE(ABORT,'APPROVAL_SNAPSHOT_IMMUTABLE'); END;
