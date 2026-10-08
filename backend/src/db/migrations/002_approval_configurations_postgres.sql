CREATE TABLE approval_configurations (
 id TEXT PRIMARY KEY, department_id TEXT NOT NULL UNIQUE, department_name TEXT NOT NULL,
 published_version_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE approval_configuration_versions (
 id TEXT PRIMARY KEY, configuration_id TEXT NOT NULL REFERENCES approval_configurations(id) ON DELETE RESTRICT,
 version_number INTEGER NOT NULL CHECK(version_number>0), state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PUBLISHED')),
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, published_by TEXT, published_at TIMESTAMPTZ,
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
 snapshot_json TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_approval_snapshot_requisition ON requisition_approval_snapshots(requisition_id);
ALTER TABLE approval_configurations ADD CONSTRAINT s301_published_version_fk FOREIGN KEY(id,published_version_id) REFERENCES approval_configuration_versions(configuration_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION s301_guard_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='PUBLISHED' THEN RAISE EXCEPTION 'APPROVAL_VERSION_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER s301_version_immutable BEFORE UPDATE OR DELETE ON approval_configuration_versions FOR EACH ROW EXECUTE FUNCTION s301_guard_version();
CREATE FUNCTION s301_guard_level() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM approval_configuration_versions WHERE id=OLD.version_id AND state='PUBLISHED') THEN RAISE EXCEPTION 'APPROVAL_VERSION_IMMUTABLE'; END IF;
 IF TG_OP<>'DELETE' AND EXISTS(SELECT 1 FROM approval_configuration_versions WHERE id=NEW.version_id AND state='PUBLISHED') THEN RAISE EXCEPTION 'APPROVAL_VERSION_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER s301_level_immutable BEFORE INSERT OR UPDATE OR DELETE ON approval_configuration_levels FOR EACH ROW EXECUTE FUNCTION s301_guard_level();
CREATE FUNCTION s301_guard_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'APPROVAL_SNAPSHOT_IMMUTABLE';
END;
$$;
CREATE TRIGGER s301_snapshot_immutable BEFORE UPDATE OR DELETE ON requisition_approval_snapshots FOR EACH ROW EXECUTE FUNCTION s301_guard_snapshot();
CREATE TRIGGER s301_snapshot_no_truncate BEFORE TRUNCATE ON requisition_approval_snapshots FOR EACH STATEMENT EXECUTE FUNCTION s301_guard_snapshot();
CREATE TRIGGER s301_version_no_truncate BEFORE TRUNCATE ON approval_configuration_versions FOR EACH STATEMENT EXECUTE FUNCTION s301_guard_snapshot();
CREATE TRIGGER s301_level_no_truncate BEFORE TRUNCATE ON approval_configuration_levels FOR EACH STATEMENT EXECUTE FUNCTION s301_guard_snapshot();
