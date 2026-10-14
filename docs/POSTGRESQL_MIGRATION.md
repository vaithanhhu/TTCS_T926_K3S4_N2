# PostgreSQL migration and Azure development

## Scope and current verification

The serving application remains Node HTTP/CommonJS and vanilla frontend. PostgreSQL uses `pg` with asynchronous I/O; SQLite remains a compatibility/regression provider. The synchronous `prepare` method only constructs a statement. PostgreSQL `get`, `all`, `run`, `exec`, transaction and close are asynchronous. Services, controllers, middleware, seed and HTTP initialization await these calls.

The authoritative DDL is `backend/src/db/migrations/001_postgres.sql`, built from the complete `database.js` schema and an isolated snapshot of the runtime SQLite schema. The old SQLite migration and docker SQL files are not PostgreSQL schema sources.

`test:postgres` uses PostgreSQL compiled to WASM (PGlite), not SQL result mocks, for DDL and service tests. Pool isolation is separately tested with controlled clients. This does not verify remote connectivity, TLS, pg-wire integration, production permissions or multi-process concurrency. Live testing is opt-in with a separate disposable database URL and an isolated source copy.

## Current development connection

`npm start` invokes `backend/src/start-azure.js` and the existing external profile `%LOCALAPPDATA%\ATS\AzureStaging`. Default writable target: `ats_migration_validation_9ed91916`; explicitly read-only target: `ats_migration_validation_7cd908a1` via `npm run start:azure:readonly`. Stop the current profile before switching modes.

The private launcher supplies `DB_PROVIDER=postgres` and an in-memory `DATABASE_URL` through a loopback SSH tunnel, validates the CA and PostgreSQL hostname, and uses the existing SCRAM credential. No credential is stored in this repository. Missing profile, target mismatch or failed connection fails startup; it never falls back to SQLite or another remote provider. `ats_db` is excluded.

Use `npm run status:azure`, `npm run test:azure` and `npm run stop:azure` for operations. Read the profile's private operating guide for tunnel-only startup and reconnect tests. SQLite remains available explicitly through `start:local` for isolated demos/tests.

Startup verifies existing schema and checksums. It does not run migration, seed, import or grant synchronization. Do not run the old migration runners against the accepted staging or development database: their RBAC side effects are not authorized. See [preserve-grants executor](POSTGRESQL_PRESERVE_GRANTS.md) for separately approved rebuilds. `ats_schema_execution` tracks applied DDL; `ats_rbac_reconciliation` remains PENDING. Preserve all 72 source grants; the 62 proposed grants remain unapproved.

Generic PostgreSQL adapter variables remain available for separately approved test/operations commands. They are not a replacement for the Azure development profile, and an explicit PostgreSQL provider without a connection URL must fail.

## Data/type decisions

- 21 domain tables plus `ats_schema_migrations` infrastructure ledger.
- Users email: application trim/lowercase, unique `lower(email)` index, and case-insensitive equality at the dialect boundary. A regular email unique constraint retains ON CONFLICT(email) compatibility. Search uses ILIKE; NOCASE name ordering uses lower(name).
- Audit keeps text `id`, adds BIGINT identity `sequence_id`, and uses sequence order rather than timestamp/UUID order. Import preserves SQLite rowid order and advances the identity sequence.
- SQLite datetime('now') system values are UTC. System time columns use TIMESTAMPTZ; imported naive system timestamps are explicitly treated as UTC. Driver serialization is ISO UTC.
- Offers start_date and requisitions needed_date use DATE and return YYYY-MM-DD strings, not local JS Date values.
- Interview scheduled_time stays TEXT intentionally. Mixed ISO UTC and datetime-local values are preserved byte-for-byte; a future conversion needs a business decision on the source timezone of naive values.
- must_change_password and handover_required become BOOLEAN; s210_version and singleton career_page_settings.id remain INTEGER.
- Monetary values use NUMERIC, with existing application validation preserved.
- users.department_id is nullable with a deferred FK and ON DELETE SET NULL. Department managers refer back to users, permitting the import cycle inside one transaction. No fake dept-auto/dept-ext records are created.

Initial snapshot: 59 users, 35 orphan department IDs. Exact canonical matching can resolve 19; external dept-ext resolves 1 to NULL; null legacy names resolve 2 to NULL; 13 retain unresolved legacy names until the operator explicitly maps or unassigns them. The importer reports these records before applying anything.

## Transaction semantics and regressions

Transaction scopes use AsyncLocalStorage and a checked-out pg client; no BEGIN/queries/COMMIT can hop across pool clients. Legacy transaction-control calls execute inside that scope. Savepoints remain on the same client. Bulk import uses an independent transaction per valid row, so a failed row cannot undo earlier successes. Activation/confirmation mail is dispatched after commit and after releasing the client.

Auth counter/token operations use transaction/advisory locking; password changes lock the user row. Requisition code allocation is serialized within a transaction. SQLite request serialization prevents async conversion from accidentally sharing an in-flight legacy transaction.

Existing test assertions are retained. Tests await asynchronous services/statements, use Promise-aware rejection assertions, and a selector fixture creates its real department before sending the canonical ID. PostgreSQL live testing is never inferred from SQLite or embedded-engine PASS.

Run all regression scripts in fresh TEMP copies without .git, .env, runtime DBs or runtime avatar/media assets, with their own `npm ci --offline`, `DB_PROVIDER=sqlite`, `NODE_ENV=test`, and simulated email. Run `test:postgres` separately in an isolated copy. For live verification, set `ATS_POSTGRES_TEST_URL` yourself to a disposable test database and run `test:postgres:live`; it creates and drops only its random test schema. Without that opt-in it prints NOT RUN.

Manual/external/deferred acceptance stays pending: real password-reset/activation email delivery, visual/mobile usability, Career Page visual matching, future Offer salary integration and Sprint 6 evaluation sheets.
