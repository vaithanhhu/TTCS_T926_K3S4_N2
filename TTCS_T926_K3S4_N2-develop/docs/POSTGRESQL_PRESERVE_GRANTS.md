# PostgreSQL validation with source grants preserved

This is a local disposable database validation path. It does not authorize a remote deployment or RBAC grant reconciliation.

## Execution contract

`backend/src/db/schema-executor.js` executes the unmodified PostgreSQL SQL files 001–009. It never runs baseline permission synchronization. Migration 010 is absent from this workspace and is not created.

The executor requires a new database named `ats_migration_validation_<8 lowercase hexadecimal characters>` served on loopback. It refuses an existing standard migration ledger or an unrelated populated schema. Use a newly initialized local cluster and a distinct database; do not reset or reuse a business database.

DDL/data receipts are recorded in `ats_schema_execution` with the original normalized SQL checksum and phase `DDL_DATA`. `ats_rbac_reconciliation` separately records `PENDING` for 002 and 004–009, and `NOT_REQUIRED` for 001/003. The overall result remains `rbacReconciliation=PENDING` and `fullMigrationComplete=false`. No standard ledger is populated to imply that its grant mutations were completed.

Existing standard migration ledgers keep their original verification behavior. On a split-ledger database, migration verifiers can establish DDL readiness with checksum/object checks; this is not full RBAC migration approval. Standard migration and permission-synchronization entry points refuse to write to split-ledger databases. Their rejection must not be bypassed by deleting or fabricating ledgers.

All execution uses the database transaction abstraction and a shared advisory lock. DDL and receipts commit together; failure rolls both back. Retrying verifies existing receipts rather than reapplying SQL or changing grants. Historical SQL files and checksums are not rewritten.

## Local validation sequence

1. Make a consistent SQLite snapshot outside the repository; retain the original DB, WAL and SHM. Never run migration/import against the business SQLite file.
2. Create a fresh loopback-only PostgreSQL test cluster/database with the required name. Configure a separate process environment with `DB_PROVIDER=postgres`, its local test `DATABASE_URL`, `PG_SSL_MODE=disable`, `NODE_ENV=test`, and `EMAIL_MODE=simulated`. Do not change `.env` or production flags.
3. Execute `node backend/src/db/schema-executor.js --through 1`.
4. Dry-run `node backend/src/db/import-sqlite.js --source <private-snapshot> --department-map <approved-private-map>`.
5. Apply the reviewed import using the same command with `--apply`. The map is an object keyed by source user ID; values are approved canonical department IDs or JSON null. Do not put the private snapshot or mapping manifest in Git.
6. Execute `node backend/src/db/schema-executor.js --through 9`.
7. Run verifiers with `--check`, review both phase ledgers and compare every source row/column, PK, FK, password hash, role, permission and grant. Do not interpret DDL readiness as RBAC approval.
8. Run supported tests in a separate source export without `.git`, `.env` or runtime databases. `backend/tests/test_schema_executor.js` requires an explicit loopback validation URL, a separate empty scratch database, and external private evidence paths. It never selects a default production database.

The reviewed source snapshot has 59 users, 14 requisitions, 7 roles, 32 permissions and 72 grants. The approved department mapping is 20 users to dept-3, 5 to dept-2, and 10 to NULL; old department values remain in a private audit manifest. Do not auto-create workflow/approval/job/history records missing from the source.

The 62 baseline grant additions remain unapproved. Preserve `HIRING_MGR → interview.evaluate` and all other source grants; service role/assignment/ownership conditions continue to apply. No grant alone enables an operation beyond those service conditions. Missing baseline permissions/features are an explicit remaining reconciliation dependency, not a reason to add privileges during import.

## Operational limits

The executor does not reconcile grants, adopt existing standard histories, seed data, disable constraints/triggers, or silently repair checksum drift. A pending contract checksum mismatch requires review; it is not automatically rewritten. Extending this local-only executor to an Azure test target requires a separately authorized safety boundary.

Snapshots, PostgreSQL data directories, session/reset/OTP values, raw data comparisons, CVs and credentials must remain private and excluded from Git. Reports use counts, equality checks and keyed fingerprints instead of raw sensitive fields. Full native PostgreSQL Sprint 1–4/browser parity must only be claimed for suites actually run on that provider.
