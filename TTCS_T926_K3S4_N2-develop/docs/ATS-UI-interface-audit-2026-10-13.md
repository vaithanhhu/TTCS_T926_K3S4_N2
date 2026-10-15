# ATS UI/UX audit — 2026-10-13

**READY FOR REVIEW.** Technical checks pass; visual/brand approval remains with the user. No staging, commit, push or PR.

## Isolated baseline

Clone: `C:\ATS_UI_AUDIT_20261013-85261203`. Branch: `fix/ats-ui-modal-audit`. HEAD: `ee17eaa170ff5a2b6a3a28a0b742e2954ee3c0ec`, verified remote develop after PR#8, containing QA-S3-06 and remaining QA batch.

Original workspace and tested clone protected using 499 and 431 file hashes, branch/HEAD/status snapshots. The new clone: 23 runtime/migration hashes remain unchanged. No .env, production flags, Neon connection or real SMTP changes.

## Root causes and changes

- Shared modal-card max-width of 520px forced most Requisition fields into a narrow vertical stack. Action buttons were inside the scrolling form and unavailable initially.
- Expanded only Requisition modal to 92vw, capped at 1680px, with three columns from 1100px, two below 1100px and one below 600px. Five semantic fieldset groups preserve all 17 field bindings and validation attributes.
- Existing footer actions moved outside scroll body, with explicit native form association for submit. Header/description/footer do not shrink; body alone scrolls. Mobile footer wraps into two rows without hiding actions.
- All existing labels, fields and workflows remain; quantity label now has the required marker matching existing submit validation. Description explains partial DRAFT versus complete submission. Empty hint space removed; textarea visual rows/padding reduced without truncating values.
- Added modal close/backdrop/Escape handling, focus trap/restoration, error focus/scroll and route-leave body scroll cleanup for Requisition. Nested publication preview retains its independent behavior.
- Audit confirmed focus escape in six other dialogs: create user, bulk import, create candidate, schedule interview, create Offer, question bank. A small shared frontend helper traps Tab, initially focuses close and uses each existing close handler for Escape. It does not touch forced authentication dialogs, approval/preview rules or backend operations.

## Before/after measurement

Settled Chromium layout, empty creation form. Filled content, budget warnings, history and manual textarea expansion can add scroll. Mobile prioritizes full readable fields rather than packing narrow controls.

| Viewport | Width before → after | Columns after | Scroll before → after | Footer initially visible after |
|---|---:|---:|---:|---|
| 1920x1080 | 520 → 1680px | 3 | 190 → 0px | Yes |
| 1366x768 | 520 → 1256.7px | 3 | 471 → 200px | Yes |
| 1280x720 | 520 → 1177.6px | 3 | 514 → 245px | Yes |
| 768x1024 | 520 → 706.5px | 2 | 241 → 181px | Yes |
| 390x844 | 358 → 374px | 1 | 600 → 780px | Yes |

The phone form requires more internal scroll because all field labels/controls now use one column; every field was hit-tested after scrolling and the footer stays visible. This is an explicit tradeoff, not a claim that all scrolling was eliminated.

| Viewport | Before | After |
|---|---|---|
| 1920x1080 | [image](evidence/ATS-UI-interface-audit-2026-10-13/before-requisition-1920.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisition-1920.png) |
| 1366x768 | [image](evidence/ATS-UI-interface-audit-2026-10-13/before-requisition-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisition-1366.png) |
| 1280x720 | [image](evidence/ATS-UI-interface-audit-2026-10-13/before-requisition-1280.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisition-1280.png) |
| 768x1024 | [image](evidence/ATS-UI-interface-audit-2026-10-13/before-requisition-768.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisition-768.png) |
| 390x844 | [image](evidence/ATS-UI-interface-audit-2026-10-13/before-requisition-390.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisition-390.png) |

## Full interface audit

Actual Chromium checked 22 screens at all five viewports: dashboard, profile, Requisition, Candidates, Interviews, question bank, Offers, Approval Center, reports, departments, recruitment catalogs, company branding, job titles/competencies, users, roles, audit, budgets, approval configurations, login, public listing, populated public detail and candidate portal.

Six create/import dialogs checked for geometry and keyboard at all five viewports. Publication preview checked at all five, with long content and public detail from an independently approved/published fixture. Existing 65-case browser E2E additionally checks all seven roles, feature flags, errors, lifecycle, public/preview and keyboard navigation.

No root horizontal overflow or horizontally clipped controls outside intentional table scroll wrappers in the audited screens. Existing table wrappers, pagination, typography, business navigation, API error behavior and RBAC retained. Existing data table horizontal scrolling on mobile is intentional.

Baseline red audit: 141 PASS / 40 FAIL demonstrates layout/focus defects. Final audit: 196/196 PASS:110 screen checks, 30 dialog geometry, 30 dialog keyboard, 15 Requisition geometry/field/focus, 5 preview and 5 business/error/navigation checks plus 1 runtime-error check. Added 15 checks after baseline; old assertions not relaxed. An exploratory width failure was an animation measurement race; waiting for animation.finished resolved it without changing acceptance thresholds.

## Regression

Command: `npm run test -- --all`. **52/52 scripts PASS**, exit 0. No old test assertions changed, removed or skipped. Counts represent executions, not unique cases; aggregate Sprint1 repeats individual suites. S4 separately reports 9 User Stories.

| Script | PASS | FAIL | Exit | Time ms |
|---|---:|---:|---:|---:|
| `test:browser-e2e` | 65 | 0 | 0 | 125243 |
| `test:user-list-batch` | 16 | 0 | 0 | 3830 |
| `test:candidate-stage` | 52 | 0 | 0 | 5504 |
| `test:s1-frontend-fixes` | 18 | 0 | 0 | 4089 |
| `test:final-rbac-open` | 33 | 0 | 0 | 5197 |
| `test:requisition-access` | 16 | 0 | 0 | 4859 |
| `test:ats-e2e` | 51 | 0 | 0 | 10295 |
| `test:rbac` | 47 | 0 | 0 | 7227 |
| `test:s3-02` | 93 | 0 | 0 | 8336 |
| `test:s3-01` | 108 | 0 | 0 | 5180 |
| `test:postgres` | 15 | 0 | 0 | 3734 |
| `test:review-updates` | 22 | 0 | 0 | 5231 |
| `test:s1-01` | 8 | 0 | 0 | 1788 |
| `test:s1-02` | 5 | 0 | 0 | 1225 |
| `test:s1-03` | 5 | 0 | 0 | 1416 |
| `test:s1-03:email` | 49 | 0 | 0 | 1212 |
| `test:s1-04` | 5 | 0 | 0 | 1751 |
| `test:s1-05` | 6 | 0 | 0 | 1374 |
| `test:s1-06` | 3 | 0 | 0 | 1506 |
| `test:s1-07` | 4 | 0 | 0 | 1822 |
| `test:s1-08` | 5 | 0 | 0 | 1464 |
| `test:s1-09` | 7 | 0 | 0 | 1562 |
| `test:s1-10` | 8 | 0 | 0 | 1727 |
| `test:otp` | 8 | 0 | 0 | 2060 |
| `test:sprint2` | 32 | 0 | 0 | 4031 |
| `test:s2-10` | 60 | 0 | 0 | 5721 |
| `test:routing` | 189 | 0 | 0 | 5708 |
| `test:user-ux` | 87 | 0 | 0 | 6943 |
| `test:datetime-dashboard` | 28 | 0 | 0 | 3079 |
| `test:avatar` | 21 | 0 | 0 | 3700 |
| `test:mobile-shell` | 53 | 0 | 0 | 7021 |
| `test:layout` | 45 | 0 | 0 | 3294 |
| `test:coverage:sprint1` | 23 | 0 | 0 | 5752 |
| `test:coverage:sprint2` | 25 | 0 | 0 | 4121 |
| `test:career-upload` | 24 | 0 | 0 | 3707 |
| `test:user-roles-avatar` | 17 | 0 | 0 | 3113 |
| `test:sprint1` | 56 | 0 | 0 | 10250 |
| `test:reapproval` | 94 | 0 | 0 | 17948 |
| `test:s3-03` | 29 | 0 | 0 | 7363 |
| `test:s3-04` | 55 | 0 | 0 | 10916 |
| `test:s3-05` | 36 | 0 | 0 | 7837 |
| `test:s3-06` | 46 | 0 | 0 | 7008 |
| `test:s3-07` | 51 | 0 | 0 | 10082 |
| `test:s3-08` | 27 | 0 | 0 | 7253 |
| `test:s3-09` | 42 | 0 | 0 | 8216 |
| `test:s3-10` | 54 | 0 | 0 | 14523 |
| `test:local-demo` | 20 | 0 | 0 | 26894 |
| `test:postgres:startup` | 11 | 0 | 0 | 1174 |
| `test:s4` | 9 US | 0 | 0 | 1428 |
| `test:qa-s3-06` | 73 | 0 | 0 | 9377 |
| `test:qa-s3-batch` | 19 | 0 | 0 | 40972 |
| `test:ui-interface` | 196 | 0 | 0 | 192539 |

Syntax: 168 JavaScript files, `node --check` exit 0. SQLite and PGlite regression executed. Live PostgreSQL is NOT RUN in this UI-only task; no backend/schema change. Neon and production explicitly prohibited. Email simulated/mock only. Existing Browser E2E checks console errors; the new audit records runtime errors and the intentionally injected API409 separately.

## Final screenshot follow-up

After inspecting screenshots, some generic dialog images were captured during fade-in. Strengthened the new test to wait for finite browser animations and assert settled opacity. Re-ran `npm run test -- test:ui-interface`: **196/196 PASS**, exit 0. Application code is identical to the full 52-script regression; only screenshot test synchronization/assertion was strengthened. All after images in this report were replaced with the settled captures. No old test assertions were weakened. Log hash and exact command are in JSON evidence.

## Exact source changes

| File | Purpose |
|---|---|
| `frontend/components/create-req-modal.html` | Semantic groups, footer outside scroll area, explicit submit form association, clear draft instructions and error focus target |
| `frontend/css/style.css` | Scoped modal dimensions, grid, compact spacing, fixed actions and responsive/focus styles |
| `frontend/js/components/requisition-form.js` | Modal focus/close/scroll and visible errors; saving/validation/API logic retained |
| `frontend/js/shared/route-lifecycle.js` | Restore scroll and modal focus on navigation |
| `frontend/js/components/modal-focus.js` | Keyboard support for six audited dialogs via existing close handlers |
| `frontend/routes.json` | Load shared modal helper; route/RBAC definitions unchanged |
| `backend/tests/test_ui_interface_audit.js` | Isolated real-browser audit, regression and screenshots |
| `package.json` | Add test:ui-interface, no dependency changes |

New documentation: this Markdown report and `docs/evidence/ATS-UI-interface-audit-2026-10-13.json`. New screenshot files: 71 under `docs/evidence/ATS-UI-interface-audit-2026-10-13/`; every filename listed in JSON evidence. Full original screenshots/logs remain in temporary runner folders, with log SHA256 recorded. No existing evidence overwritten.

## Screenshot gallery

Desktop1366 and mobile390 proof for each audited screen; full5-size results in JSON.

| Screen | Desktop | Mobile |
|---|---|---|
| dashboard | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-dashboard-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-dashboard-390.png) |
| profile | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-profile-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-profile-390.png) |
| requisitions | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisitions-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-requisitions-390.png) |
| candidates | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-candidates-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-candidates-390.png) |
| interviews | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-interviews-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-interviews-390.png) |
| question-bank | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-question-bank-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-question-bank-390.png) |
| offers | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-offers-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-offers-390.png) |
| approvals | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-approvals-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-approvals-390.png) |
| reports | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-reports-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-reports-390.png) |
| departments | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-departments-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-departments-390.png) |
| recruitment-catalogs | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-recruitment-catalogs-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-recruitment-catalogs-390.png) |
| career-page | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-career-page-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-career-page-390.png) |
| competencies | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-competencies-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-competencies-390.png) |
| users | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-users-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-users-390.png) |
| roles | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-roles-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-roles-390.png) |
| audit | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-audit-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-audit-390.png) |
| headcount-budgets | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-headcount-budgets-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-headcount-budgets-390.png) |
| approval-configurations | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-approval-configurations-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-approval-configurations-390.png) |
| login | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-login-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-login-390.png) |
| public-jobs | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-public-jobs-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-public-jobs-390.png) |
| public-detail | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-public-detail-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-public-detail-390.png) |
| candidate-portal | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-candidate-portal-1366.png) | [image](evidence/ATS-UI-interface-audit-2026-10-13/after-candidate-portal-390.png) |

## Remaining review items

- Mobile internal scroll remains 780px; short desktop/tablet screens still scroll 200–245/181px. Sticky actions and reachable fields are verified; no hidden fields or weakened validation.
- Full WCAG/screen-reader certification, brand signoff, native OS calendar popup painting, non-Chromium browsers and every secondary edit/detail dialog variant are not claimed PASS. Six audited creation/import dialogs get keyboard fixes; other variants preserve existing behavior.
- Formal human UI/UAT approval remains pending. No known failing final regression or audited major-screen clipping defect.

## Re-run

Use `npm run test -- test:ui-interface` for isolated UI 196 checks, or `npm run test -- --all` for all 52 scripts. The runner copies source, excludes working/runtime databases and credentials, enables flags only in test setup and uses simulated email. Do not run the raw browser test against a working database.

Structured evidence: [JSON](evidence/ATS-UI-interface-audit-2026-10-13.json). All changes remain unstaged/uncommitted in the isolated clone for review.
