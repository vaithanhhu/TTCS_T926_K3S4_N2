# PostgreSQL / Neon migration

## Scope and current verification

The serving application remains Node HTTP/CommonJS and vanilla frontend. PostgreSQL uses `pg` with asynchronous I/O; SQLite remains a compatibility/regression provider. The synchronous `prepare` method only constructs a statement. PostgreSQL `get`, `all`, `run`, `exec`, transaction and close are asynchronous. Services, controllers, middleware, seed and HTTP initialization await these calls.

The authoritative DDL is `backend/src/db/migrations/001_postgres.sql`, built from the complete `database.js` schema and an isolated snapshot of the runtime SQLite schema. The old SQLite migration and docker SQL files are not PostgreSQL schema sources.

`test:postgres` uses PostgreSQL compiled to WASM (PGlite), not SQL result mocks, for DDL and service tests. Pool isolation is separately tested with controlled clients. This does not verify Neon connectivity, TLS, pg-wire integration, production permissions or multi-process concurrency. Live testing is opt-in with a separate disposable database URL and an isolated source copy.

## Configuration (set locally; never share or commit secrets)

- `DATABASE_URL`: your own PostgreSQL/Neon connection URL.
- `DB_PROVIDER=postgres`: explicit provider; if unset a nonempty DATABASE_URL selects PostgreSQL, otherwise SQLite.
- `PG_SSL_MODE=url`: default, honors the connection URL TLS parameters.
- `PG_SSL_MODE=verify`: certificate validation option. URL `sslmode/sslcert/sslkey/sslrootcert` parameters can override the pg SSL object; use `sslmode=verify-full` in the URL when requiring full certificate/hostname verification.
- `PG_SSL_MODE=disable`: local disposable development servers only.
- Existing SMTP/OAuth settings stay unchanged. Automated tests never use them.

The PostgreSQL server startup verifies the migration checksum. It does not automatically create PostgreSQL tables or demo accounts. A missing DATABASE_URL with an explicit postgres provider fails clearly; no silent SQLite fallback occurs.

## Commands the operator runs

1. Configure Neon database/role/schema permissions and DATABASE_URL yourself.
2. Install dependencies with `npm ci`.
3. Run `npm run migrate:postgres`. The migration uses an advisory lock and an atomic version/checksum ledger.
4. Choose **existing data import** or **empty demo database seed**, never both:
   - Existing data: stop writers, make a consistent SQLite backup/copy outside `backend/data` (include WAL if applicable; do not delete original WAL/SHM), then dry-run:
     `npm run import:postgres -- --source <absolute-path-to-isolated-copy>`
   - Resolve reported ambiguous departments using a local JSON file mapping user IDs to real department IDs. Explicit JSON null means unassigned. No mapping is guessed from approximate names.
   - Apply only after review:
     `npm run import:postgres -- --source <copy> --department-map <local-json-file> --apply`
   - `--allow-unassigned` explicitly clears unresolved department IDs to NULL while keeping legacy display names. Use only after deciding this is correct for those records.
   - For an empty disposable/demo database only: `npm run seed:postgres -- --demo`. It refuses populated domain tables and retains the project's known demo account behavior. Do not use demo credentials for production.
5. Run `npm start`, then manually verify browser/API flows on the configured PostgreSQL environment.

The importer refuses the repository runtime data directory and a nonempty destination. It imports all tables on one transaction/client with deferred foreign keys. Existing IDs and password hashes are retained. No original SQLite data is updated or deleted.

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
