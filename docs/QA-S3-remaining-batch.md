# Remaining Sprint3 QA batch — 2026-10-13

**READY FOR COMMIT.** All six QA findings verified; no commit/staging/push/PR performed.

## Baseline and protection

- Isolated implementation clone: `C:\ATS_QA_S3_BATCH_20261013-5d501892`, branch `fix/s3-remaining-qa-batch`.
- Baseline remote develop `2c204ba78a0a7093ec43f3daeffc5dcb5c534dfe` already contains QA-S3-06 `132bef767ec143b55656fc0333007fccd107fcee` through PR#7. No QA-S3-06 merge was performed.
- Original workspace: 499 hashes and prior QA-S3-06 clone: 425 hashes unchanged, including their HEAD/branch/status. Batch clone: 23 runtime/migration hashes unchanged. Exact before/after hashes in JSON evidence.
- No historical migrations, schemas, API contracts, RBAC policy, production feature flags or dependencies changed. No Neon connection, SMTP delivery or test writes to either protected workspace.

## Per-QA results

### QA-S3-01 — PASS

Root cause: Preview used an unstyled modal-content shell; nested modal layering, scroll, backdrop/Escape closure and focus restoration were incomplete.

Fix: Reuse modal-card, raise only s310 overlay, keep close fixed and body scrollable, lock background scroll, trap Tab and restore focus.

Evidence: Chromium 1440x900 and 390x700: background, bounds, scroll, Tab, Escape/backdrop, opener focus and underlying modal preservation.

Production files: `frontend/js/components/job-posting-publication.js`, `frontend/css/style.css`.

### QA-S3-02 — PASS

Root cause: Reject/Request Info already worked in backend, but overflow-hidden modal clipped controls on long snapshots; Approval Center only exposed Open entrypoint.

Fix: Scoped scrollable s302 card/sticky header and assigned, non-self approver entrypoints to existing decision modal and mandatory comment. No quick-write decision, service or RBAC change.

Evidence: Actual mobile Chromium rejects/requests info, validates missing reason, displays history; three providers validate assignee, audit, retained submission and restart level 1.

Production files: `frontend/js/components/requisition-approval.js`, `frontend/css/style.css`.

### QA-S3-03A — TESTED PASS

Root cause: No production defect reproduced.

Fix: Isolated expired neededDate fixtures; no production change.

Evidence: Only active OPEN shows overdue badge; PAUSED/CLOSED/CANCELLED are not mislabelled; status stays unchanged; Chromium and 3 SQL providers.

Production files: None; test fixture/coverage only.

### QA-S3-03B — TESTED PASS

Root cause: No production defect reproduced.

Fix: 1114 isolated fixtures, 1107 authorized and 7 foreign; no production change.

Evidence: 56 pages of 20, final 7, stable ordering/IDs, counts, status/department/date/handover filters, IDOR, constant 7 prepared statements for page sizes 1 and 100; Chromium traverses all56 pages.

Production files: None; test fixture/coverage only.

### QA-S3-04 — PASS

Root cause: Form rendered whole-department remaining quota instead of backend projection excluding the same effective requisition. A fully allocated department returned 0 even though an edited approved requisition could reuse its 2 slots.

Fix: Display authoritative projection.remainingHeadcount/remainingSalary with whole-department fallback and label availability for this requisition. No hardcoded quota/mapping/year or budget formula change.

Evidence: API top-level 0/projection 2 checked; actual browser displays 2; provider tests cover correct mapping/year/scope.

Production files: `frontend/js/pages/headcount-budgets.js`.

### QA-S3-05 — PASS

Root cause: Missing job-title/change listeners, shared debounce timer and delayed invalidation let stale availability/override plans survive input changes.

Fix: Per-form timers; invalidate generation and exception plan immediately; listen to input/change including job title; require matching input, requisition ID and session before accepting response.

Evidence: Below/equal/over checks; real browser changes quantity/department/job; delayed old response released after new response cannot overwrite warning; backend remains authority.

Production files: `frontend/js/pages/headcount-budgets.js`.

## Before/after verification

New regression against unchanged baseline frontend: **15 PASS / 4 FAIL**, exit 1, reproducing QA01/02/04/05. QA03A/03B already passed. After fixes: **19/19**, exit 0, including 6 SQLite, 6 PGlite and 7 actual Chromium cases. Native PostgreSQL adds 6/6 new batch cases.

An exploratory new-suite run initially had17 PASS / 2 FAIL. The test had checked history before async rendering completed and used HR_MANAGER for another creator private DRAFT. Corrected fixture wait/role selection; no existing assertions or production authorization were weakened.

## Final regression

Command: `npm run test -- --all`. **51/51 scripts PASS; exit 0.** Every old suite was executed again on edited source. Counts below are reported execution checks, not unique cases; `test:sprint1` repeats individual S1 suites. S4 separately reports 9 User Stories.

| Script | PASS | FAIL | Exit | Time ms |
|---|---:|---:|---:|---:|
| `test:browser-e2e` | 65 | 0 | 0 | 167843 |
| `test:user-list-batch` | 16 | 0 | 0 | 6825 |
| `test:candidate-stage` | 52 | 0 | 0 | 9405 |
| `test:s1-frontend-fixes` | 18 | 0 | 0 | 5733 |
| `test:final-rbac-open` | 33 | 0 | 0 | 8603 |
| `test:requisition-access` | 16 | 0 | 0 | 7371 |
| `test:ats-e2e` | 51 | 0 | 0 | 14558 |
| `test:rbac` | 47 | 0 | 0 | 12854 |
| `test:s3-02` | 93 | 0 | 0 | 13780 |
| `test:s3-01` | 108 | 0 | 0 | 8317 |
| `test:postgres` | 15 | 0 | 0 | 6353 |
| `test:review-updates` | 22 | 0 | 0 | 7801 |
| `test:s1-01` | 8 | 0 | 0 | 2772 |
| `test:s1-02` | 5 | 0 | 0 | 2150 |
| `test:s1-03` | 5 | 0 | 0 | 2131 |
| `test:s1-03:email` | 49 | 0 | 0 | 2034 |
| `test:s1-04` | 5 | 0 | 0 | 2567 |
| `test:s1-05` | 6 | 0 | 0 | 2111 |
| `test:s1-06` | 3 | 0 | 0 | 1971 |
| `test:s1-07` | 4 | 0 | 0 | 2518 |
| `test:s1-08` | 5 | 0 | 0 | 2353 |
| `test:s1-09` | 7 | 0 | 0 | 2348 |
| `test:s1-10` | 8 | 0 | 0 | 2176 |
| `test:otp` | 8 | 0 | 0 | 2639 |
| `test:sprint2` | 32 | 0 | 0 | 5851 |
| `test:s2-10` | 60 | 0 | 0 | 6500 |
| `test:routing` | 188 | 0 | 0 | 6998 |
| `test:user-ux` | 87 | 0 | 0 | 10105 |
| `test:datetime-dashboard` | 28 | 0 | 0 | 4734 |
| `test:avatar` | 21 | 0 | 0 | 5998 |
| `test:mobile-shell` | 53 | 0 | 0 | 9867 |
| `test:layout` | 45 | 0 | 0 | 4281 |
| `test:coverage:sprint1` | 23 | 0 | 0 | 7787 |
| `test:coverage:sprint2` | 25 | 0 | 0 | 4837 |
| `test:career-upload` | 24 | 0 | 0 | 4990 |
| `test:user-roles-avatar` | 17 | 0 | 0 | 4371 |
| `test:sprint1` | 56 | 0 | 0 | 14723 |
| `test:reapproval` | 94 | 0 | 0 | 25793 |
| `test:s3-03` | 29 | 0 | 0 | 10360 |
| `test:s3-04` | 55 | 0 | 0 | 15646 |
| `test:s3-05` | 36 | 0 | 0 | 11389 |
| `test:s3-06` | 46 | 0 | 0 | 10492 |
| `test:s3-07` | 51 | 0 | 0 | 16046 |
| `test:s3-08` | 27 | 0 | 0 | 10398 |
| `test:s3-09` | 42 | 0 | 0 | 10485 |
| `test:s3-10` | 54 | 0 | 0 | 20912 |
| `test:local-demo` | 20 | 0 | 0 | 34715 |
| `test:postgres:startup` | 11 | 0 | 0 | 2043 |
| `test:s4` | 9 US | 0 | 0 | 2039 |
| `test:qa-s3-06` | 73 | 0 | 0 | 14630 |
| `test:qa-s3-batch` | 19 | 0 | 0 | 54022 |

Reported check executions excluding S4 User Story units: **1865**; includes aggregate reruns and is not a unique-case count. No final failure or intentional assertion skip. Optional pg-live scripts are run separately, not silently counted as PASS by the SQLite runner.

## Actual PostgreSQL

PostgreSQL 17.10 ran on a freshly initialized loopback-only cluster with two empty disposable databases and non-superuser `qa_app`. It was stopped and verified after testing. No existing database/service or Neon was used.

| Command in isolated source with guarded test environment | PASS | FAIL | Exit |
|---|---:|---:|---:|
| `node backend/tests/test_s3_remaining_qa_pg_live.js` |6|0|0|
| `node backend/tests/test_qa_s3_06_pg_live.js` |38 (32 core + 6 pg-wire)|0|0|

Migration 001–010 rerun/verification, public schema/search_path/grants, ten independent backend PIDs, reservation competition, eight simultaneous final approvals, approve/reject race, stale version, rollback, legacy/reapproval, backend startup and standard/legacy API bypass were checked on real pg-wire. PGlite results are explicitly separate.

## Pagination measurement

1114 fixture rows (1107 authorized,7 foreign); 56 pages of 20 and final 7. Both page sizes 1 and 100 issue7 prepared statements. Timing includes pagination and accompanying correctness/filter queries and is not a production SLA.

| Provider | Measured ms | page100 JSON bytes | Prepared statements/page |
|---|---:|---:|---:|
| SQLite | 365.67 | 152813 | 7 |
| PGlite | 1750.18 | 154613 | 7 |
| Real PostgreSQL 17 pg-wire | 2216.03 | 154613 | 7 |

## Browser and quality

Actual Chromium browser tests: existing suite 65/65 plus new batch 7/7. New approval actions tested at 390x700; preview tested at 1440x900 and 390x700 with long content. Runtime page errors: none. External font requests fulfilled locally; actual app APIs and DOM were used. Existing API/frontend suites also include simulated DOM; these are not represented as browser E2E. Email mock/simulated only.

- Syntax: 166 JavaScript files checked with `node --check`, exit 0.
- `git diff --check`: exit 0; index empty.
- No new code comments, historical migration edits, SQLite changes, sensitive files or credential patterns in changed files. Existing tests unchanged except adding optional native runner exclusion to the isolated dispatcher. Package lock/dependency versions unchanged.
- Screenshots: [desktop](evidence/QA-S3-remaining-batch/batch-preview-1440.png), [mobile](evidence/QA-S3-remaining-batch/batch-preview-390.png).
- Structured commands, durations, summaries, log SHA256 and protection fingerprints: [JSON evidence](evidence/QA-S3-remaining-batch.json). Full raw logs remain outside Git in the temporary isolated runner locations listed in JSON.

## Proposed one-commit files

- `backend/tests/run_local_tests.js`
- `frontend/css/style.css`
- `frontend/js/components/job-posting-publication.js`
- `frontend/js/components/requisition-approval.js`
- `frontend/js/pages/headcount-budgets.js`
- `package.json`
- `backend/tests/test_s3_remaining_qa.js`
- `backend/tests/test_s3_remaining_qa_pg_live.js`
- `docs/QA-S3-remaining-batch.md`
- `docs/evidence/QA-S3-remaining-batch.json`
- `docs/evidence/QA-S3-remaining-batch/batch-preview-1440.png`
- `docs/evidence/QA-S3-remaining-batch/batch-preview-390.png`

Proposed message: `fix(sprint3): resolve remaining QA findings`. No staging, commit, push or PR action has been taken. Do not include temp databases, modules, logs, protected original modifications or unrelated old evidence.

## Manual recheck

1. Launch a fresh local-demo SQLite test environment with Sprint3 flags ON; never use production config.
2. As HR, edit an approved request whose department quota is fully allocated: available quota for the same request remains reusable; change quantity/department/job/date and confirm fresh warnings.
3. As assigned approver, open Approval Center Reject/Request Supplement, enter mandatory reason, verify audit/history and creator resubmission starts level 1.
4. Preview a long draft posting over Requisition detail; verify mobile scroll, close button, Tab/ShiftTab, Escape/backdrop and return focus without closing parent.
5. Use isolated expired and 1,107 owned requisition fixtures through `npm run test -- test:qa-s3-batch`; check overdue/terminated states and final page.
6. Rerun `npm run test -- --all`. Native scripts require a fresh loopback PostgreSQL test database, guarded environment and exported source without .git/.env; do not aim them at Neon.

## Remaining limitations

No unresolved finding in this batch. Production load/soak, Neon rollout and formal human UAT/brand signoff are NOT RUN/outside this task. Local measurements do not guarantee production performance. All changes remain unstaged/uncommitted in the isolated branch.
