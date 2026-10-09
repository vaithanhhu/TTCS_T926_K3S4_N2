# ATS — Final acceptance and Git push readiness — 09/10/2026

## Ba trạng thái tách biệt

| Trục | Kết luận | Phạm vi |
|---|---|---|
| TECHNICAL READINESS | **BLOCKED** | Runtime/regression/visual kỹ thuật/Neon PASS; real-email mandatory acceptance chưa xác minh vì thiếu inbox/sandbox được phép |
| USER ACCEPTANCE | **PENDING** | Không có chữ ký UAT/brand của người có thẩm quyền; không tự phê duyệt |
| GIT PUSH READINESS | **READY** | Đủ để đề xuất plan selective commit/push; không phải quyền push, không phải release đã nghiệm thu, không commit toàn working tree |

Branch feature/s2-bulk-user-import, HEAD d962ef3a9da49d42b595dba85ca3daa3404454db; giữ nguyên. Không git add/commit/push/merge/rebase/reset/restore/clean/stash hoặc bật production flags.

[Bằng chứng JSON](evidence/ATS-final-acceptance-and-push-readiness.json) · [Browser results](evidence/ATS-final-acceptance-browser/results.json).

## Spec/UAT

Đối chiếu trực tiếp docs/business_specs/4_Product_Backlog.md: đúng30 User Story và91 AC, không lệch số lượng. Checklist đầy đủ ở cuối báo cáo; JSON có function, role, prerequisites, thao tác, expected/actual, references và signoff fields.

**87 AC technical PASS;2 BLOCKED;2 DEFERRED;0 FAIL cuối.** PASS nghĩa kiểm thử kỹ thuật, không phải chữ ký người dùng. Hai BLOCKED là S1-03-AC1 và S1-08-AC1 (email delivery thật). Hai DEFERRED là S2-05-AC2 (Offer tương lai) và S2-06-AC4 (evaluation sheet Sprint6), không triển khai Sprint4+ hoặc gọi deferred là lỗi implementation.

ADMIN super-RBAC vẫn chịu business guards, cấm tự duyệt/assignment; HR-only standard salary không mở cho ADMIN đơn vai trò. HIRING_MGR candidate R* không đổi stage; OPEN groupB revision chưa có hiệu lực trước final approval. Các quyết định hiện hành giữ nguyên.

## Lỗi tái hiện và sửa

- Budget network fallback mất dấu: visual-baseline57/58, actual chuỗi hỏng; sửa duy nhất fallback frontend/js/api.js. Test exact Vietnamese giữ nguyên.
- S2-09 card trắng khác public branding: company-baseline60/61. Người dùng chốt preview **khối giới thiệu công ty**, không form login. career-page.js dùng class/background token public, intro/logo/hero và blob preview giữ nguyên; public gradient có cùng giá trị, không đổi public layout. DB không thay đổi khi preview.
- Mobile clipped controls: clipping-baseline62/63, job-title edit controls nằm ngoài360px dù root scrollWidth không báo overflow. CSS đúng hai trang Competencies/Career: one-column dưới1100px, min-width0, wrap code và giữ nút. Kiểm tra bounds control và preview được bổ sung; không chỉ dựa scrollWidth.
- Early login: boot-baseline bắt credential-query GET bằng dữ liệu dummy trước handler. app.js capture submit khi chưa appReady, login button disabled tới ready. Không đưa URL dummy vào báo cáo, không dùng password thật. Login7 vai trò và session sau ready giữ nguyên.

Các failure/intermediate CSS-token/flex correction giữ trong scratch evidence; không lấy lượt FAIL để báo PASS. Không sửa assertion cũ, migration hoặc dữ liệu để làm xanh. Production sửa: frontend/js/api.js, frontend/js/pages/career-page.js, frontend/css/style.css, frontend/js/app.js, frontend/pages/login.html. Test mở rộng: backend/tests/test_browser_e2e.js, helper visualAcceptance.js.

## Browser/visual/accessibility

**Chromium thật64/64 PASS**, gồm flow Requisition→2 cấp approval→assignment→Job draft→independent review→publish→public→CLOSED/PAUSED/CANCELLED.14 màn hình ở1440×1000 và360×800, kiểm tra control bounds/Vietnamese/loading/error/empty/modal/navigation; keyboard login, desktop nav, mobile drawer/Escape và modal close. Preview/public Job Posting cùng DOM; Company preview theo phạm vi người dùng chốt.

Chỉ seed/fixture giả trong source/SQLite copy cách ly; no .env/runtime DB/Neon. Fonts external trả rỗng, dùng fallback; không tuyên bố đã duyệt font/brand thật.Ảnh mask password/email và salary inputs, không chứa production data; traces loại token/password thử. Console/network có4xx expected và lỗi injected có nhãn; không có unhandled page error hoặc unexpected5xx/network failure.

Technical visual **PASS**; brand signoff **PENDING**.

- [Mobile Chức danh](evidence/ATS-final-acceptance-browser/visual-mobile360-job-titles.png)
- [Company preview](evidence/ATS-final-acceptance-browser/company-block-preview.png)
- [Mobile ngân sách](evidence/ATS-final-acceptance-browser/visual-mobile360-budget.png)
- [Public mobile](evidence/ATS-final-acceptance-browser/public-mobile.png)
- [Trace HR](evidence/ATS-final-acceptance-browser/trace-HR_MANAGER.zip)

## Email

Mock/simulation kiểm thử mới PASS (email security49/49, OTP8/8 và các creation/reset tests). Sandbox SMTP: **BLOCKED — MISSING TEST INBOX/SMTP CONFIG**. SMTP production: **NOT RUN / không được phép dùng**.

Cấu hình hiện có chỉ kiểm tra presence qua config module, không in host/user/password/token. Có host/user/password fields nhưng chưa được xác minh là sandbox, chưa có approved recipient; không authenticate/send production SMTP. Cần địa chỉ test inbox được phép, sandbox config qua môi trường riêng, quyền đọc receipt/message trong sandbox. Không ghi đè .env.

Code gửi1 lần/call, không automatic retry; lỗi SMTP dùng code an toàn và audit, không stack/credentials. DELIVERED là SMTP accepted, không chứng minh inbox nhận; thực-email chưa PASS. Template Unicode/Arial inline/text alternative và reset token/OTP được mock kiểm chứng, không thay credential. Khi được cung cấp sandbox, gửi controlled request duy nhất, verify receipt/subject/HTML/UTF8/link-expiry/single-use, không gửi nhân viên/ứng viên thật.

## Regression cuối

Mọi hàng là lượt mới sau sửa; không lấy số cũ. Dùng source copies/SQLite/PGlite, SMTP simulated. Thời gian suite là khoảng từ install-log close trước spawn tới test-log close sau exit; ghi rõ là measured approximation, không giả định. Extra runners/Neon có start/end UTC trực tiếp.

| Lệnh | Kết quả | Exit | Giây≈ |
|---|---|---|---:|
| npm run test:sprint1 | 56/56 PASS | 0 | 20.81 |
| npm run test:browser-e2e | 64/64 PASS | 0 | 153.53 |
| npm run test:user-list-batch | 16/16 PASS | 0 | 15.22 |
| npm run test:candidate-stage | 52/52 PASS | 0 | 17.77 |
| npm run test:s1-frontend-fixes | 18/18 PASS | 0 | 11.89 |
| npm run test:final-rbac-open | 33/33 PASS | 0 | 14.88 |
| npm run test:requisition-access | 16/16 PASS | 0 | 13.87 |
| npm run test:ats-e2e | 51/51 PASS | 0 | 20.90 |
| npm run test:rbac | 47/47 PASS | 0 | 17.73 |
| npm run test:s3-02 | 93/93 PASS | 0 | 17.85 |
| npm run test:s3-01 | 108/108 PASS | 0 | 14.93 |
| npm run test:postgres | 15/15 PASS | 0 | 10.74 |
| npm run test:review-updates | 22/22 PASS | 0 | 12.00 |
| npm run test:s1-01 | 8/8 PASS | 0 | 8.08 |
| npm run test:s1-02 | 5/5 PASS | 0 | 7.14 |
| npm run test:s1-03 | 5/5 PASS | 0 | 7.32 |
| npm run test:s1-03:email | 49/49 PASS | 0 | 3.06 |
| npm run test:s1-04 | 5/5 PASS | 0 | 7.51 |
| npm run test:s1-05 | 6/6 PASS | 0 | 6.28 |
| npm run test:s1-06 | 3/3 PASS | 0 | 6.58 |
| npm run test:s1-07 | 4/4 PASS | 0 | 6.37 |
| npm run test:s1-08 | 5/5 PASS | 0 | 6.55 |
| npm run test:s1-09 | 7/7 PASS | 0 | 5.83 |
| npm run test:s1-10 | 8/8 PASS | 0 | 6.24 |
| npm run test:otp | 8/8 PASS | 0 | 3.84 |
| npm run test:sprint2 | 32/32 PASS | 0 | 8.95 |
| npm run test:s2-10 | 59/59 PASS | 0 | 9.91 |
| npm run test:routing | 187/187 PASS | 0 | 11.26 |
| npm run test:user-ux | 87/87 PASS | 0 | 13.36 |
| npm run test:datetime-dashboard | 28/28 PASS | 0 | 8.77 |
| npm run test:avatar | 21/21 PASS | 0 | 11.02 |
| npm run test:mobile-shell | 53/53 PASS | 0 | 14.94 |
| npm run test:layout | 45/45 PASS | 0 | 8.46 |
| npm run test:coverage:sprint1 | 23/23 PASS | 0 | 12.69 |
| npm run test:coverage:sprint2 | 25/25 PASS | 0 | 9.75 |
| npm run test:career-upload | 24/24 PASS | 0 | 10.06 |
| npm run test:user-roles-avatar | 17/17 PASS | 0 | 9.22 |
| npm run test:reapproval | 94/94 PASS | 0 | 29.75 |
| npm run test:s3-03 | 29/29 PASS | 0 | 13.62 |
| npm run test:s3-04 | 55/55 PASS | 0 | 20.06 |
| npm run test:s3-05 | 36/36 PASS | 0 | 15.21 |
| npm run test:s3-06 | 46/46 PASS | 0 | 14.22 |
| npm run test:s3-07 | 51/51 PASS | 0 | 17.09 |
| npm run test:s3-08 | 27/27 PASS | 0 | 13.54 |
| npm run test:s3-09 | 41/41 PASS | 0 | 14.35 |
| npm run test:s3-10 | 53/53 PASS | 0 | 17.65 |
| node backend/tests/test_postgres_startup.js | 11/11 PASS | 0 | 5.63 |

| PostgreSQL/cross-Sprint | Kết quả | Exit |
|---|---|---|
| node backend/tests/test_user_list_batch.js --postgres-only | 8/8 PASS | 0 |
| node backend/tests/test_candidate_stage.js --postgres-only | 27/27 PASS | 0 |
| node backend/tests/test_s3_10_pg_live.js | 32/32 PASS | 0 |
| node backend/tests/test_postgres_live.js | 3/3 PASS | 0 |
| node scratch:integration.cjs | 23/23 PASS | 0 |
| node scratch:pg-concurrency-extra.cjs | 2/2 PASS | 0 |

Tổng **1843 lượt local PASS,0 FAIL**, không gọi là case độc lập:56 aggregate duplicates và overlap provider/suite; reruns không cộng. S3-01..10 539/539; Sprint1 56/56 +coverage23/23 +frontend18/18; Sprint2 32/32 +coverage25/25; S2-10 59/59; reapproval94/94. PostgreSQL thật8 user-batch,27 Candidate,24 publication parity,8 stress batches80requests, cross-Sprint23 và race2 batches16requests. Local PostgreSQL riêng, không stress Neon.

node --check 152/152 PASS; git diff --check PASS. N+1 giữ3 SQL nonempty/2 empty; schema/API/RBAC không đổi.

## Neon — kết luận bắt buộc

| Hạng mục | Kết luận |
|---|---|
| Connection | **CONNECTED** |
| Migration | **VERIFIED 001–008** |
| Schema/grants | **VERIFIED** |
| Data | **UNCHANGED** |
| Startup/API | **PASS** |

DNS resolved thực tế, auth query target ats_staging/public, role identifier chỉ hash. TLS1.3 encrypted/authorized; pooled endpoint20/20 concurrent SELECT PASS. Pool max10, connectionTimeout0/statement_timeout0 là default hiện có: quan sát kết nối thành công nhưng timeout chưa được cấu hình hữu hạn; cần ops review khi lên production, không tự đổi config.

Catalog parity với PostgreSQL local:

| Catalog | Local | Neon | Kết quả |
|---|---:|---:|---|
| tables | 52 | 52 | VERIFIED |
| columns | 381 | 381 | VERIFIED |
| constraints | 186 | 186 | VERIFIED |
| indexes | 128 | 128 | VERIFIED |
| triggers | 31 | 31 | VERIFIED |

Verify checksum/history001–008 và DML/schema privileges. Smoke rollback14/14, readiness6/6, no new migration/seed/import hoặc durable test rows. Counts/fingerprints52 bảng giống trước/sau; fixture0 sau rollback, flags unchanged. Fingerprints là row data, không bao gồm sequence counters. SSL-mode library warning không làm fail, không đổi URI.

## Feature flags và rollout đề xuất

| Flag | Production | Test |
|---|---|---|
| APPROVAL_CONFIGURATION_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| HEADCOUNT_BUDGET_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| REQUISITION_TRACKING_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| JOB_POSTING_PUBLICATION_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| JOB_POSTING_DRAFTS_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| REQUISITION_LIFECYCLE_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| REQUISITION_OPERATIONS_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |
| REQUISITION_APPROVAL_ENABLED | OFF | ON/OFF PASS trong SQLite E2E |

Không bật production. Plan sau phê duyệt: deploy code flagsOFF→verify001–008/grants→bật Configuration và chuẩn bị versions→Approval→Operations/Assignment→Budget sau khi đủ department/year/usage và override policy→Lifecycle→Tracking→JobDrafts→JobPublication cuối. Không tự tạo cấu hình/budget/assignment production để vượt kiểm tra.

Dependencies: approval cần chain/published snapshot; budget cần data theo neededDate; drafts cần effective APPROVED và assigned recruiter; publication cần immutable content/version proof; lifecycle/public guard phải có schema006/008. Flags không thay RBAC.

Rollback: hạ các flag theo reverse dependency, không xóa schema/history/reservations. Giữ main/revision đã áp dụng. Public reader vẫn dùng proof dù publication flagOFF; muốn ngừng public cần kiểm soát cả gate Lifecycle/Publication hoặc reverse-proxy theo plan được phê duyệt. Không giả định tắt một flag tự gỡ tin hay tự khôi phục, không reset DB.

## Git trước push

Live origin/develop trùng HEAD hiện tại tại thời điểm ls-remote; cached ref cũng trùng, ancestry0/0. Không fetch/merge/rebase hoặc đổi branch. develop đang gắn với worktree khác, không tự checkout.

Plan3 commits sau khi người dùng cho phép:1) S3 feature/migrations006–008 mới đã verify đúng bytes;2) RBAC/audit/N+1/UAT/browser fixes/tests/lockfile;3) docs và JSON/screenshots chọn lọc. Stage exact allowlist, inspect staged diff/secrets, kiểm tra lại remote; dùng fast-forward nếu vẫn cùng base. Không git add -A/commit -a/force push.

DB runtime đang tracked và modified từ trước: tuyệt đối loại khỏi commit. .gitignore không bỏ tracking WAL/SHM đã có. 001/authController cosmetic/EOL không có semantic diff: giữ nguyên, không stage lịch sử. Trace ZIP lớn dù sanitized ưu tiên artifact storage, không đưa mặc định vào Git; Python/temp/log nằm ngoài repo, không commit. Raw historical evidence cần review riêng.

Secret pattern scan changed/untracked text và trace redaction không phát hiện secret cần chặn; không scan/in .env để làm lộ secret. Scan không phải chứng nhận mọi high-entropy hash là secret. Git READY áp dụng selective plan, không cho toàn working tree.

### NEVER_COMMIT_RUNTIME_OR_SECRET

- backend/data/ats.db
- backend/data/ats.db-shm
- backend/data/ats.db-wal
- backend/data/ats_test.db

### SOURCE

- backend/src/config/config.js
- backend/src/controllers/jobPostingDraftController.js
- backend/src/controllers/jobPostingPublicationController.js
- backend/src/controllers/requisitionLifecycleController.js
- backend/src/db/migrate-job-publication.js
- backend/src/db/migrate-requisition-lifecycle.js
- backend/src/db/migrate-requisition-tracking-job-drafts.js
- backend/src/db/sync-permissions.js
- backend/src/server.js
- backend/src/services/headcountBudgetService.js
- backend/src/services/jobPostingPublicationService.js
- backend/src/services/jobPostingService.js
- backend/src/services/recruitmentCatalogService.js
- backend/src/services/requisitionApprovalService.js
- backend/src/services/requisitionLifecycleService.js
- backend/src/services/requisitionService.js
- backend/src/services/requisitionTrackingService.js
- backend/src/services/userService.js
- frontend/components/create-req-modal.html
- frontend/components/requisition-detail-modal.html
- frontend/css/style.css
- frontend/index.html
- frontend/js/api.js
- frontend/js/app.js
- frontend/js/components/job-posting-drafts.js
- frontend/js/components/job-posting-public-renderer.js
- frontend/js/components/job-posting-publication.js
- frontend/js/components/requisition-approval.js
- frontend/js/components/requisition-detail.js
- frontend/js/components/requisition-form.js
- frontend/js/components/requisition-lifecycle.js
- frontend/js/pages/career-page.js
- frontend/js/pages/dashboard.js
- frontend/js/pages/public-jobs.js
- frontend/js/pages/requisitions.js
- frontend/js/shared/route-lifecycle.js
- frontend/pages/login.html
- frontend/pages/public-jobs.html
- frontend/pages/requisitions.html
- frontend/routes.json
- package-lock.json
- package.json

### NEW_MIGRATION_VERIFIED

- backend/src/db/migrations/006_requisition_lifecycle_postgres.sql
- backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql
- backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql
- backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql
- backend/src/db/migrations/008_job_publication_postgres.sql
- backend/src/db/migrations/008_job_publication_sqlite.sql

### TEST

- backend/tests/helpers/visualAcceptance.js
- backend/tests/run_browser_e2e.js
- backend/tests/test_browser_e2e.js
- backend/tests/test_candidate_stage.js
- backend/tests/test_s1_frontend_fixes.js
- backend/tests/test_s3_07.js
- backend/tests/test_s3_08_09.js
- backend/tests/test_s3_10.js
- backend/tests/test_s3_10_pg_live.js
- backend/tests/test_user_list_batch.js

### DOCUMENTATION

- docs/ATS-E2E-2026-10-08.md
- docs/ATS-audit-fixes-2026-10-09.md
- docs/ATS-final-acceptance-and-push-readiness.md
- docs/ATS-full-audit-2026-10-09.md
- docs/ATS-readiness-2026-10-09.md
- docs/RBAC-admin-permissions.md
- docs/S3-07-requisition-lifecycle.md
- docs/S3-08-S3-09-tracking-job-drafts.md
- docs/S3-10-job-publication.md
- docs/Sprint-3-summary-2026-10-09.md

### SANITIZED_EVIDENCE_REVIEW_OPTIONAL

- docs/evidence/ATS-audit-fixes-2026-10-09.json
- docs/evidence/ATS-final-acceptance-and-push-readiness.json
- docs/evidence/ATS-final-acceptance-browser/approval-history.png
- docs/evidence/ATS-final-acceptance-browser/cancelled-history.png
- docs/evidence/ATS-final-acceptance-browser/company-block-preview.png
- docs/evidence/ATS-final-acceptance-browser/configuration-version2.png
- docs/evidence/ATS-final-acceptance-browser/flags-off.png
- docs/evidence/ATS-final-acceptance-browser/home-ADMIN.png
- docs/evidence/ATS-final-acceptance-browser/home-APPROVER.png
- docs/evidence/ATS-final-acceptance-browser/home-CANDIDATE.png
- docs/evidence/ATS-final-acceptance-browser/home-HIRING_MGR.png
- docs/evidence/ATS-final-acceptance-browser/home-HR_MANAGER.png
- docs/evidence/ATS-final-acceptance-browser/home-INTERVIEWER.png
- docs/evidence/ATS-final-acceptance-browser/home-RECRUITER.png
- docs/evidence/ATS-final-acceptance-browser/paused-history.png
- docs/evidence/ATS-final-acceptance-browser/preview-desktop.png
- docs/evidence/ATS-final-acceptance-browser/preview-mobile.png
- docs/evidence/ATS-final-acceptance-browser/public-desktop.png
- docs/evidence/ATS-final-acceptance-browser/public-mobile.png
- docs/evidence/ATS-final-acceptance-browser/results.json
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-approvals.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-budget.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-candidate-pipeline.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-company-introduction.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-departments.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-job-posting.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-job-titles.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-login.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-preview.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-public-detail.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-public-listing.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-recruiter-assignment.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-requisitions.png
- docs/evidence/ATS-final-acceptance-browser/visual-desktop-users.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-approvals.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-budget.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-candidate-pipeline.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-company-introduction.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-departments.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-job-posting.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-job-titles.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-login.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-preview.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-public-detail.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-public-listing.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-recruiter-assignment.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-requisitions.png
- docs/evidence/ATS-final-acceptance-browser/visual-mobile360-users.png
- docs/evidence/ATS-full-audit-2026-10-09.json
- docs/evidence/ATS-readiness-2026-10-09-browser/approval-history.png
- docs/evidence/ATS-readiness-2026-10-09-browser/cancelled-history.png
- docs/evidence/ATS-readiness-2026-10-09-browser/configuration-version2.png
- docs/evidence/ATS-readiness-2026-10-09-browser/flags-off.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-ADMIN.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-APPROVER.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-CANDIDATE.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-HIRING_MGR.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-HR_MANAGER.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-INTERVIEWER.png
- docs/evidence/ATS-readiness-2026-10-09-browser/home-RECRUITER.png
- docs/evidence/ATS-readiness-2026-10-09-browser/paused-history.png
- docs/evidence/ATS-readiness-2026-10-09-browser/preview-desktop.png
- docs/evidence/ATS-readiness-2026-10-09-browser/preview-mobile.png
- docs/evidence/ATS-readiness-2026-10-09-browser/public-desktop.png
- docs/evidence/ATS-readiness-2026-10-09-browser/public-mobile.png
- docs/evidence/ATS-readiness-2026-10-09-browser/results.json
- docs/evidence/ATS-readiness-2026-10-09.json
- docs/evidence/S3-07-test-results.json
- docs/evidence/S3-08-S3-09-test-results.json
- docs/evidence/S3-10-test-results.json

### OLD_HARNESS_DIFF_LOCAL_REFERENCE_EXCLUDE

- docs/evidence/ATS-audit-fixes-2026-10-09.patch
- docs/evidence/ATS-full-audit-2026-10-09-harness.txt
- docs/evidence/ATS-readiness-2026-10-09.diff

### TRACE_ARTIFACT_DO_NOT_COMMIT_BY_DEFAULT

- docs/evidence/ATS-final-acceptance-browser/trace-ADMIN.zip
- docs/evidence/ATS-final-acceptance-browser/trace-APPROVER.zip
- docs/evidence/ATS-final-acceptance-browser/trace-CANDIDATE.zip
- docs/evidence/ATS-final-acceptance-browser/trace-HIRING_MGR.zip
- docs/evidence/ATS-final-acceptance-browser/trace-HR_MANAGER.zip
- docs/evidence/ATS-final-acceptance-browser/trace-INTERVIEWER.zip
- docs/evidence/ATS-final-acceptance-browser/trace-PUBLIC.zip
- docs/evidence/ATS-final-acceptance-browser/trace-RECRUITER.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-ADMIN.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-APPROVER.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-CANDIDATE.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-HIRING_MGR.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-HR_MANAGER.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-INTERVIEWER.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-PUBLIC.zip
- docs/evidence/ATS-readiness-2026-10-09-browser/trace-RECRUITER.zip

## Hash bảo vệ

Bốn SQLite runtime và15 migration SQL trước/sau không đổi. Không restore/reset các file vốn modified.

| File | Trước | Sau |
|---|---|---|
| backend/src/db/migrations/008_job_publication_sqlite.sql | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 |
| backend/src/db/migrations/001_postgres.sql | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b |
| backend/src/db/migrations/006_requisition_lifecycle_postgres.sql | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b |
| backend/src/db/migrations/002_approval_configurations_postgres.sql | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 |
| backend/src/db/migrations/004_headcount_budgets_sqlite.sql | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a |
| backend/data/ats.db | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc |
| backend/src/db/migrations/005_requisition_operations_postgres.sql | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c |
| backend/src/db/migrations/005_requisition_operations_sqlite.sql | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf |
| backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 |
| backend/src/db/migrations/002_approval_configurations_sqlite.sql | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 |
| backend/src/db/migrations/003_requisition_approvals_sqlite.sql | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 |
| backend/data/ats.db-wal | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 |
| backend/src/db/migrations/003_requisition_approvals_postgres.sql | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 |
| backend/data/ats_test.db | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a |
| backend/src/db/migrations/008_job_publication_postgres.sql | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 |
| backend/src/db/migrations/004_headcount_budgets_postgres.sql | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 |
| backend/data/ats.db-shm | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 |

## Checklist UAT dùng trực tiếp

Mỗi ô ký vẫn trống. PASS là technical automated evidence, không phải approved của người dùng; rows BLOCKED/DEFERRED không được tích hoàn tất. Các testcase names/hash/command/matchingAC nằm trong JSON. Điều kiện chung: chỉ dữ liệu thử cách ly,7 roles active, valid catalogs, không Neon mutation.


### S1-01

#### S1-01-AC1 — PASS

**AC gốc:** Đăng nhập đúng thì vào được trang chủ tương ứng với vai trò

- Chức năng: /login
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đăng nhập lần lượt7 vai trò; đối chiếu role-home backend và route/menu thực tế.
- Thao tác: Mở /login bằng vai trò nhân sự nội bộ. → Đăng nhập lần lượt7 vai trò; đối chiếu role-home backend và route/menu thực tế. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Đăng nhập đúng thì vào được trang chủ tương ứng với vai trò
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-01, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-01-AC2 — PASS

**AC gốc:** Sai thông tin hiển thị thông báo chung, không tiết lộ email có tồn tại hay không

- Chức năng: /login
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Nhập sai email/mật khẩu; so phản hồi email tồn tại/không tồn tại, số lần còn lại.
- Thao tác: Mở /login bằng vai trò nhân sự nội bộ. → Nhập sai email/mật khẩu; so phản hồi email tồn tại/không tồn tại, số lần còn lại. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Sai thông tin hiển thị thông báo chung, không tiết lộ email có tồn tại hay không
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-01, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-01-AC3 — PASS

**AC gốc:** Khoá tạm 15 phút sau 5 lần sai liên tiếp

- Chức năng: /login
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Sai5 lần liên tiếp; kiểm tra khoá15 phút, không login/đọc API; login đúng sau mở khoá.
- Thao tác: Mở /login bằng vai trò nhân sự nội bộ. → Sai5 lần liên tiếp; kiểm tra khoá15 phút, không login/đọc API; login đúng sau mở khoá. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khoá tạm 15 phút sau 5 lần sai liên tiếp
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-01, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-02

#### S1-02-AC1 — PASS

**AC gốc:** Phiên được gia hạn tự động khi còn hoạt động

- Chức năng: /login → /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đăng nhập, thao tác và heartbeat; đối chiếu expires_at gia hạn.
- Thao tác: Mở /login → /profile bằng vai trò nhân sự nội bộ. → Đăng nhập, thao tác và heartbeat; đối chiếu expires_at gia hạn. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Phiên được gia hạn tự động khi còn hoạt động
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-02, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-02-AC2 — PASS

**AC gốc:** Đăng xuất làm mất hiệu lực phiên ngay lập tức phía server

- Chức năng: /login → /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đăng xuất; dùng lại token thử nghiệm cũ gọi API phải401.
- Thao tác: Mở /login → /profile bằng vai trò nhân sự nội bộ. → Đăng xuất; dùng lại token thử nghiệm cũ gọi API phải401. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Đăng xuất làm mất hiệu lực phiên ngay lập tức phía server
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-02, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-02-AC3 — PASS

**AC gốc:** Phiên hết hạn đưa về trang đăng nhập kèm thông báo rõ ràng

- Chức năng: /login → /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Cho phiên thử nghiệm hết hạn; reload/click Users và kiểm tra thông báo, cleanup.
- Thao tác: Mở /login → /profile bằng vai trò nhân sự nội bộ. → Cho phiên thử nghiệm hết hạn; reload/click Users và kiểm tra thông báo, cleanup. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Phiên hết hạn đưa về trang đăng nhập kèm thông báo rõ ràng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-02, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-03

#### S1-03-AC1 — BLOCKED

**AC gốc:** Nhập email nhận được liên kết đặt lại có hiệu lực 30 phút

- Chức năng: /forgot-password → /reset-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Với inbox sandbox được phép, yêu cầu reset và kiểm tra thư nhận/link TTL30 phút.
- Thao tác: Mở /forgot-password → /reset-password bằng vai trò nhân sự nội bộ. → Với inbox sandbox được phép, yêu cầu reset và kiểm tra thư nhận/link TTL30 phút. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Nhập email nhận được liên kết đặt lại có hiệu lực 30 phút
- Actual: Mock/backend flow PASS; real sandbox delivery NOT RUN — no approved inbox/sandbox configuration.
- Evidence: test:s1-03, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-03-AC2 — PASS

**AC gốc:** Liên kết chỉ dùng được một lần

- Chức năng: /forgot-password → /reset-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đổi mật khẩu từ link/token rồi dùng lại; kiểm tra chỉ dùng1 lần và phiên cũ vô hiệu.
- Thao tác: Mở /forgot-password → /reset-password bằng vai trò nhân sự nội bộ. → Đổi mật khẩu từ link/token rồi dùng lại; kiểm tra chỉ dùng1 lần và phiên cũ vô hiệu. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Liên kết chỉ dùng được một lần
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-03, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-03-AC3 — PASS

**AC gốc:** Email không tồn tại vẫn hiển thị cùng một thông báo

- Chức năng: /forgot-password → /reset-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. So response/timing envelope của email không tồn tại và email tồn tại; không enumeration.
- Thao tác: Mở /forgot-password → /reset-password bằng vai trò nhân sự nội bộ. → So response/timing envelope của email không tồn tại và email tồn tại; không enumeration. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Email không tồn tại vẫn hiển thị cùng một thông báo
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-03, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-04

#### S1-04-AC1 — PASS

**AC gốc:** Bắt buộc nhập mật khẩu hiện tại

- Chức năng: /profile /change-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Nhập sai/thiếu mật khẩu hiện tại, rồi nhập đúng để đổi.
- Thao tác: Mở /profile /change-password bằng vai trò nhân sự nội bộ. → Nhập sai/thiếu mật khẩu hiện tại, rồi nhập đúng để đổi. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Bắt buộc nhập mật khẩu hiện tại
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-04, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-04-AC2 — PASS

**AC gốc:** Mật khẩu mới tối thiểu 8 ký tự, có chữ và số

- Chức năng: /profile /change-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thử password dưới8 ký tự/thiếu chữ hoặc số, rồi password hợp lệ.
- Thao tác: Mở /profile /change-password bằng vai trò nhân sự nội bộ. → Thử password dưới8 ký tự/thiếu chữ hoặc số, rồi password hợp lệ. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mật khẩu mới tối thiểu 8 ký tự, có chữ và số
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-04, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-04-AC3 — PASS

**AC gốc:** Đổi xong thu hồi các phiên đăng nhập khác

- Chức năng: /profile /change-password
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo hai phiên thử, đổi mật khẩu; xác nhận phiên khác bị thu hồi.
- Thao tác: Mở /profile /change-password bằng vai trò nhân sự nội bộ. → Tạo hai phiên thử, đổi mật khẩu; xác nhận phiên khác bị thu hồi. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Đổi xong thu hồi các phiên đăng nhập khác
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-04, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-05

#### S1-05-AC1 — PASS

**AC gốc:** Khai báo được quyền cho từng vai trò trong bảy vai trò nghiệp vụ

- Chức năng: /admin/roles
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đối chiếu7 roles và permission catalog; ADMIN super-RBAC độc lập explicit grant.
- Thao tác: Mở /admin/roles bằng vai trò ADMIN. → Đối chiếu7 roles và permission catalog; ADMIN super-RBAC độc lập explicit grant. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khai báo được quyền cho từng vai trò trong bảy vai trò nghiệp vụ
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-05, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-05-AC2 — PASS

**AC gốc:** Mọi chức năng đều kiểm quyền ở tầng server, mặc định là từ chối

- Chức năng: /admin/roles
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Gọi API trực tiếp thiếu quyền/ngoài scope; kiểm tra default deny và business guard ADMIN.
- Thao tác: Mở /admin/roles bằng vai trò ADMIN. → Gọi API trực tiếp thiếu quyền/ngoài scope; kiểm tra default deny và business guard ADMIN. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mọi chức năng đều kiểm quyền ở tầng server, mặc định là từ chối
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-05, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-05-AC3 — PASS

**AC gốc:** Truy cập thiếu quyền hiển thị thông báo tiếng Việt rõ ràng

- Chức năng: /admin/roles
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thu hồi user.read của HR_MANAGER; reload Users, thông báo tiếng Việt, không stale loading.
- Thao tác: Mở /admin/roles bằng vai trò ADMIN. → Thu hồi user.read của HR_MANAGER; reload Users, thông báo tiếng Việt, không stale loading. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Truy cập thiếu quyền hiển thị thông báo tiếng Việt rõ ràng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-05, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-05-AC4 — PASS

**AC gốc:** Có kiểm thử tự động cho ít nhất ba vai trò

- Chức năng: /admin/roles
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Chạy positive/negative ADMIN/HR/HIRING_MGR/APPROVER/RECRUITER/INTERVIEWER/CANDIDATE.
- Thao tác: Mở /admin/roles bằng vai trò ADMIN. → Chạy positive/negative ADMIN/HR/HIRING_MGR/APPROVER/RECRUITER/INTERVIEWER/CANDIDATE. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Có kiểm thử tự động cho ít nhất ba vai trò
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-05, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

### S1-06

#### S1-06-AC1 — PASS

**AC gốc:** Mục menu không thuộc quyền thì không hiển thị

- Chức năng: sidebar/menu
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Login từng role; kiểm tra menu bị ẩn đúng, thử deep-link thiếu quyền.
- Thao tác: Mở sidebar/menu bằng vai trò nhân sự nội bộ. → Login từng role; kiểm tra menu bị ẩn đúng, thử deep-link thiếu quyền. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mục menu không thuộc quyền thì không hiển thị
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-06, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-06-AC2 — PASS

**AC gốc:** Hiển thị tên và vai trò người đang đăng nhập

- Chức năng: sidebar/menu
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đối chiếu tên/role hiển thị với session/backend, kiểm tra union nhiều role.
- Thao tác: Mở sidebar/menu bằng vai trò nhân sự nội bộ. → Đối chiếu tên/role hiển thị với session/backend, kiểm tra union nhiều role. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Hiển thị tên và vai trò người đang đăng nhập
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-06, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-06-AC3 — PASS

**AC gốc:** Dùng được thuận tiện trên màn hình 360px

- Chức năng: sidebar/menu
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Ở360px mở drawer bằng bàn phím, Tab/Enter/Escape, kiểm tra overflow và điều hướng.
- Thao tác: Mở sidebar/menu bằng vai trò nhân sự nội bộ. → Ở360px mở drawer bằng bàn phím, Tab/Enter/Escape, kiểm tra overflow và điều hướng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Dùng được thuận tiện trên màn hình 360px
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-06, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-07

#### S1-07-AC1 — PASS

**AC gốc:** Trang báo lỗi dùng chung giao diện ứng dụng

- Chức năng: error route
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Mở route sai, phiên hết hạn, thiếu quyền; kiểm tra trang lỗi400/401/403/404/500.
- Thao tác: Mở error route bằng vai trò nhân sự nội bộ. → Mở route sai, phiên hết hạn, thiếu quyền; kiểm tra trang lỗi400/401/403/404/500. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Trang báo lỗi dùng chung giao diện ứng dụng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-07, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S1-07-AC2 — PASS

**AC gốc:** Mỗi trang lỗi có một hành động gợi ý để quay lại luồng làm việc

- Chức năng: error route
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Dùng recovery action đúng role-home; chặn target external hoặc route sai.
- Thao tác: Mở error route bằng vai trò nhân sự nội bộ. → Dùng recovery action đúng role-home; chặn target external hoặc route sai. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi trang lỗi có một hành động gợi ý để quay lại luồng làm việc
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-07, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S1-08

#### S1-08-AC1 — BLOCKED

**AC gốc:** Tạo tài khoản gửi email kích hoạt kèm mật khẩu tạm

- Chức năng: /admin/users
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo tài khoản thử; nhận email activation/temp password trong sandbox, bắt buộc đổi mật khẩu.
- Thao tác: Mở /admin/users bằng vai trò ADMIN. → Tạo tài khoản thử; nhận email activation/temp password trong sandbox, bắt buộc đổi mật khẩu. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tạo tài khoản gửi email kích hoạt kèm mật khẩu tạm
- Actual: Mock/backend flow PASS; real sandbox delivery NOT RUN — no approved inbox/sandbox configuration.
- Evidence: test:s1-08, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-08-AC2 — PASS

**AC gốc:** Email trùng bị từ chối kèm thông báo cụ thể

- Chức năng: /admin/users
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo lại email khác casing/whitespace; không thêm user trùng.
- Thao tác: Mở /admin/users bằng vai trò ADMIN. → Tạo lại email khác casing/whitespace; không thêm user trùng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Email trùng bị từ chối kèm thông báo cụ thể
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-08, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-08-AC3 — PASS

**AC gốc:** Tìm theo tên, email, phòng ban; lọc theo vai trò và trạng thái

- Chức năng: /admin/users
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Kết hợp search tên/email/phòng ban, role/status và verify backend result.
- Thao tác: Mở /admin/users bằng vai trò ADMIN. → Kết hợp search tên/email/phòng ban, role/status và verify backend result. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tìm theo tên, email, phòng ban; lọc theo vai trò và trạng thái
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-08, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-08-AC4 — PASS

**AC gốc:** Danh sách phân trang, mặc định 20 dòng

- Chức năng: /admin/users
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. 25 tài khoản: page1 1–20, page2 21–25; thử0/1/20/21 users, không NaN.
- Thao tác: Mở /admin/users bằng vai trò ADMIN. → 25 tài khoản: page1 1–20, page2 21–25; thử0/1/20/21 users, không NaN. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Danh sách phân trang, mặc định 20 dòng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-08, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

### S1-09

#### S1-09-AC1 — PASS

**AC gốc:** Một người dùng có thể giữ nhiều vai trò cùng lúc

- Chức năng: /admin/users → Phân quyền
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Chọn3 role nội bộ, save/readback/reopen; bỏ1 role và kiểm tra persisted2 roles.
- Thao tác: Mở /admin/users → Phân quyền bằng vai trò ADMIN. → Chọn3 role nội bộ, save/readback/reopen; bỏ1 role và kiểm tra persisted2 roles. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Một người dùng có thể giữ nhiều vai trò cùng lúc
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-09, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-09-AC2 — PASS

**AC gốc:** Thay đổi vai trò có hiệu lực ngay ở thao tác kế tiếp

- Chức năng: /admin/users → Phân quyền
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thu hồi role/grant, thao tác kế tiếp/heartbeat/menu/route guard phải cập nhật.
- Thao tác: Mở /admin/users → Phân quyền bằng vai trò ADMIN. → Thu hồi role/grant, thao tác kế tiếp/heartbeat/menu/route guard phải cập nhật. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Thay đổi vai trò có hiệu lực ngay ở thao tác kế tiếp
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-09, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-09-AC3 — PASS

**AC gốc:** Không thể tự thu hồi vai trò quản trị của chính mình

- Chức năng: /admin/users → Phân quyền
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. ADMIN bỏ ADMIN của chính mình; backend từ chối, mapping không đổi.
- Thao tác: Mở /admin/users → Phân quyền bằng vai trò ADMIN. → ADMIN bỏ ADMIN của chính mình; backend từ chối, mapping không đổi. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Không thể tự thu hồi vai trò quản trị của chính mình
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-09, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

### S1-10

#### S1-10-AC1 — PASS

**AC gốc:** Tài khoản bị khoá không đăng nhập được và bị thu hồi phiên đang mở

- Chức năng: /admin/users → Khoá
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Khoá account thử, kiểm tra login và token cũ bị chặn; mở khoá theo quyền.
- Thao tác: Mở /admin/users → Khoá bằng vai trò ADMIN. → Khoá account thử, kiểm tra login và token cũ bị chặn; mở khoá theo quyền. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tài khoản bị khoá không đăng nhập được và bị thu hồi phiên đang mở
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-10, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-10-AC2 — PASS

**AC gốc:** Bắt buộc ghi lý do khoá

- Chức năng: /admin/users → Khoá
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thiếu lý do khoá phải bị từ chối; lý do hợp lệ có audit.
- Thao tác: Mở /admin/users → Khoá bằng vai trò ADMIN. → Thiếu lý do khoá phải bị từ chối; lý do hợp lệ có audit. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Bắt buộc ghi lý do khoá
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-10, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S1-10-AC3 — PASS

**AC gốc:** Vị trí tuyển dụng do người đó phụ trách được cảnh báo cần bàn giao

- Chức năng: /admin/users → Khoá
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Khoá recruiter có assignment; kiểm tra cờ cảnh báo bàn giao.
- Thao tác: Mở /admin/users → Khoá bằng vai trò ADMIN. → Khoá recruiter có assignment; kiểm tra cờ cảnh báo bàn giao. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Vị trí tuyển dụng do người đó phụ trách được cảnh báo cần bàn giao
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s1-10, test:coverage:sprint1, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

### S2-01

#### S2-01-AC1 — PASS

**AC gốc:** Tải được tệp mẫu

- Chức năng: /admin/users → Import Excel
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tải file mẫu; mở bằng ExcelJS, kiểm tra headers/định dạng hiện hành.
- Thao tác: Mở /admin/users → Import Excel bằng vai trò ADMIN. → Tải file mẫu; mở bằng ExcelJS, kiểm tra headers/định dạng hiện hành. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tải được tệp mẫu
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S2-01-AC2 — PASS

**AC gốc:** Xem trước và báo lỗi theo từng dòng trước khi nhập

- Chức năng: /admin/users → Import Excel
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Upload file nhiều lỗi; preview đúng row/field, không import.
- Thao tác: Mở /admin/users → Import Excel bằng vai trò ADMIN. → Upload file nhiều lỗi; preview đúng row/field, không import. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Xem trước và báo lỗi theo từng dòng trước khi nhập
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

#### S2-01-AC3 — PASS

**AC gốc:** Dòng lỗi bị bỏ qua, dòng hợp lệ vẫn được nhập, có báo cáo tổng kết

- Chức năng: /admin/users → Import Excel
- Vai trò: ADMIN
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Import valid+invalid rows; valid commit per row, invalid skip, summary đúng.
- Thao tác: Mở /admin/users → Import Excel bằng vai trò ADMIN. → Import valid+invalid rows; valid commit per row, invalid skip, summary đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Dòng lỗi bị bỏ qua, dòng hợp lệ vẫn được nhập, có báo cáo tổng kết
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer ADMIN; Họ tên ______; ngày ______; chữ ký ______.

### S2-02

#### S2-02-AC1 — PASS

**AC gốc:** Sửa được họ tên, số điện thoại, chức danh hiển thị

- Chức năng: /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Sửa tên/phone/job title của mình; readback đúng.
- Thao tác: Mở /profile bằng vai trò nhân sự nội bộ. → Sửa tên/phone/job title của mình; readback đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Sửa được họ tên, số điện thoại, chức danh hiển thị
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S2-02-AC2 — PASS

**AC gốc:** Không tự đổi được email, phòng ban và vai trò

- Chức năng: /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Gửi email/department/roles trái quyền qua API; các field đó không đổi.
- Thao tác: Mở /profile bằng vai trò nhân sự nội bộ. → Gửi email/department/roles trái quyền qua API; các field đó không đổi. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Không tự đổi được email, phòng ban và vai trò
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S2-02-AC3 — PASS

**AC gốc:** Kiểm tra định dạng số điện thoại Việt Nam

- Chức năng: /profile
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thử phone VN hợp lệ, invalid/empty theo validation hiện hành.
- Thao tác: Mở /profile bằng vai trò nhân sự nội bộ. → Thử phone VN hợp lệ, invalid/empty theo validation hiện hành. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Kiểm tra định dạng số điện thoại Việt Nam
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S2-03

#### S2-03-AC1 — PASS

**AC gốc:** Chấp nhận JPG/PNG tối đa 2MB

- Chức năng: /profile → avatar
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Upload JPG/PNG đúng2MB và quá2MB/type sai; reject không overwrite file cũ.
- Thao tác: Mở /profile → avatar bằng vai trò nhân sự nội bộ. → Upload JPG/PNG đúng2MB và quá2MB/type sai; reject không overwrite file cũ. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Chấp nhận JPG/PNG tối đa 2MB
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

#### S2-03-AC2 — PASS

**AC gốc:** Ảnh được cắt vuông và tạo bản thu nhỏ

- Chức năng: /profile → avatar
- Vai trò: nhân sự nội bộ
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Kiểm tra square+thumb, metadata file-exists, logoutA/loginB list thấy avatarA.
- Thao tác: Mở /profile → avatar bằng vai trò nhân sự nội bộ. → Kiểm tra square+thumb, metadata file-exists, logoutA/loginB list thấy avatarA. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ảnh được cắt vuông và tạo bản thu nhỏ
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer nhân sự nội bộ; Họ tên ______; ngày ______; chữ ký ______.

### S2-04

#### S2-04-AC1 — PASS

**AC gốc:** Phòng ban có cấu trúc cây nhiều cấp

- Chức năng: /admin/departments
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo phòng ban cha/con; thử tạo chu trình và self-parent.
- Thao tác: Mở /admin/departments bằng vai trò Trưởng phòng Nhân sự. → Tạo phòng ban cha/con; thử tạo chu trình và self-parent. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Phòng ban có cấu trúc cây nhiều cấp
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-04-AC2 — PASS

**AC gốc:** Mỗi phòng ban có một người phụ trách

- Chức năng: /admin/departments
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Gán manager active; readback đúng.
- Thao tác: Mở /admin/departments bằng vai trò Trưởng phòng Nhân sự. → Gán manager active; readback đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi phòng ban có một người phụ trách
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-04-AC3 — PASS

**AC gốc:** Phòng ban đang có yêu cầu tuyển dụng mở thì không xoá được, chỉ ngừng áp dụng

- Chức năng: /admin/departments
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Phòng ban có OPEN Req: DELETE bị chặn, deactivate phù hợp.
- Thao tác: Mở /admin/departments bằng vai trò Trưởng phòng Nhân sự. → Phòng ban có OPEN Req: DELETE bị chặn, deactivate phù hợp. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Phòng ban đang có yêu cầu tuyển dụng mở thì không xoá được, chỉ ngừng áp dụng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-05

#### S2-05-AC1 — PASS

**AC gốc:** Mỗi chức danh có mã, tên, cấp bậc, dải lương tối thiểu và tối đa

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR tạo/sửa code/name/level/min/max, min≤max; ADMIN metadata theo business guard.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → HR tạo/sửa code/name/level/min/max, min≤max; ADMIN metadata theo business guard. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi chức danh có mã, tên, cấp bậc, dải lương tối thiểu và tối đa
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-05-AC2 — DEFERRED

**AC gốc:** Dải lương dùng làm hạn mức duyệt offer về sau

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Giữ dependency hạn mức Offer cho integration tương lai, không triển khai Sprint4+.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → Giữ dependency hạn mức Offer cho integration tương lai, không triển khai Sprint4+. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Dải lương dùng làm hạn mức duyệt offer về sau
- Actual: Backlog dependency outside Sprint1–3, no implementation attempted.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-05-AC3 — PASS

**AC gốc:** Chỉ Trưởng phòng Nhân sự xem được dải lương

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR đọc salary; ADMIN đơn vai trò/HIRING_MGR/RECRUITER không nhận standard salary.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → HR đọc salary; ADMIN đơn vai trò/HIRING_MGR/RECRUITER không nhận standard salary. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Chỉ Trưởng phòng Nhân sự xem được dải lương
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-06

#### S2-06-AC1 — PASS

**AC gốc:** Mỗi chức danh gắn với một bộ tiêu chí đánh giá, mỗi tiêu chí có trọng số

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo framework/criteria weights, gán job title.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → Tạo framework/criteria weights, gán job title. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi chức danh gắn với một bộ tiêu chí đánh giá, mỗi tiêu chí có trọng số
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-06-AC2 — PASS

**AC gốc:** Tổng trọng số của một khung bằng 100%

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tổng trọng số khác100 bị chặn atomically;100 được lưu.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → Tổng trọng số khác100 bị chặn atomically;100 được lưu. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tổng trọng số của một khung bằng 100%
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-06-AC3 — PASS

**AC gốc:** Khung năng lực dùng lại được cho nhiều chức danh

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Gán cùng framework cho nhiều job titles; không nhân đôi definitions.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → Gán cùng framework cho nhiều job titles; không nhân đôi definitions. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khung năng lực dùng lại được cho nhiều chức danh
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-06-AC4 — DEFERRED

**AC gốc:** Đây chính là bộ tiêu chí sinh ra phiếu đánh giá phỏng vấn ở Sprint 6

- Chức năng: /admin/competencies
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đợi Sprint6 evaluation sheet integration, không tự tạo backlog mới.
- Thao tác: Mở /admin/competencies bằng vai trò Trưởng phòng Nhân sự. → Đợi Sprint6 evaluation sheet integration, không tự tạo backlog mới. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Đây chính là bộ tiêu chí sinh ra phiếu đánh giá phỏng vấn ở Sprint 6
- Actual: Backlog dependency outside Sprint1–3, no implementation attempted.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-07

#### S2-07-AC1 — PASS

**AC gốc:** Mỗi câu hỏi gắn với một tiêu chí trong khung năng lực

- Chức năng: /question-bank
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo câu hỏi gắn criterion/framework hợp lệ; invalid reference reject.
- Thao tác: Mở /question-bank bằng vai trò Trưởng phòng Nhân sự. → Tạo câu hỏi gắn criterion/framework hợp lệ; invalid reference reject. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi câu hỏi gắn với một tiêu chí trong khung năng lực
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-07-AC2 — PASS

**AC gốc:** Câu hỏi có mức độ khó và gợi ý câu trả lời tốt

- Chức năng: /question-bank
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Điền difficulty/answer hint, đọc lại đúng.
- Thao tác: Mở /question-bank bằng vai trò Trưởng phòng Nhân sự. → Điền difficulty/answer hint, đọc lại đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Câu hỏi có mức độ khó và gợi ý câu trả lời tốt
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-07-AC3 — PASS

**AC gốc:** Tìm kiếm và lọc câu hỏi theo chức danh và tiêu chí

- Chức năng: /question-bank
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Search/filter theo title/criterion kết hợp; đúng RBAC/read-only role.
- Thao tác: Mở /question-bank bằng vai trò Trưởng phòng Nhân sự. → Search/filter theo title/criterion kết hợp; đúng RBAC/read-only role. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tìm kiếm và lọc câu hỏi theo chức danh và tiêu chí
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-08

#### S2-08-AC1 — PASS

**AC gốc:** Nguồn ứng viên, lý do loại hồ sơ, địa điểm làm việc, hình thức làm việc

- Chức năng: /admin/recruitment-catalogs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo4 catalog types hiện có; validate status/type/code.
- Thao tác: Mở /admin/recruitment-catalogs bằng vai trò Trưởng phòng Nhân sự. → Tạo4 catalog types hiện có; validate status/type/code. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Nguồn ứng viên, lý do loại hồ sơ, địa điểm làm việc, hình thức làm việc
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-08-AC2 — PASS

**AC gốc:** Giá trị đang được tham chiếu thì không xoá được

- Chức năng: /admin/recruitment-catalogs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Catalog đang reference không DELETE được; không phá Req/candidate.
- Thao tác: Mở /admin/recruitment-catalogs bằng vai trò Trưởng phòng Nhân sự. → Catalog đang reference không DELETE được; không phá Req/candidate. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Giá trị đang được tham chiếu thì không xoá được
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-08-AC3 — PASS

**AC gốc:** Sắp xếp được thứ tự hiển thị

- Chức năng: /admin/recruitment-catalogs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đổi display_order; list stable, scope/role đúng.
- Thao tác: Mở /admin/recruitment-catalogs bằng vai trò Trưởng phòng Nhân sự. → Đổi display_order; list stable, scope/role đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Sắp xếp được thứ tự hiển thị
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-09

#### S2-09-AC1 — PASS

**AC gốc:** Soạn nội dung giới thiệu, tải ảnh và logo

- Chức năng: /admin/career-page → /login
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Soạn intro Unicode, upload logo/hero JPG/PNG≤5MB; save/readback/public data.
- Thao tác: Mở /admin/career-page → /login bằng vai trò Trưởng phòng Nhân sự. → Soạn intro Unicode, upload logo/hero JPG/PNG≤5MB; save/readback/public data. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Soạn nội dung giới thiệu, tải ảnh và logo
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S2-09-AC2 — PASS

**AC gốc:** Xem trước đúng như giao diện công khai trước khi lưu

- Chức năng: /admin/career-page → /login
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Chưa lưu: preview khối công ty dùng public background/type/style, text/logo/hero đúng, DB không đổi; người có thẩm quyền ký brand.
- Thao tác: Mở /admin/career-page → /login bằng vai trò Trưởng phòng Nhân sự. → Chưa lưu: preview khối công ty dùng public background/type/style, text/logo/hero đúng, DB không đổi; người có thẩm quyền ký brand. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Xem trước đúng như giao diện công khai trước khi lưu
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S2-10

#### S2-10-AC1 — PASS

**AC gốc:** Khai báo chức danh, phòng ban, số lượng, lý do tuyển (thay thế hoặc tăng mới), dải lương đề xuất, ngày cần người

- Chức năng: /requisitions → Tạo
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Chọn catalogs active, quantity integer>0, reason, salary min/max, neededDate.
- Thao tác: Mở /requisitions → Tạo bằng vai trò Trưởng bộ phận. → Chọn catalogs active, quantity integer>0, reason, salary min/max, neededDate. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khai báo chức danh, phòng ban, số lượng, lý do tuyển (thay thế hoặc tăng mới), dải lương đề xuất, ngày cần người
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:s2-10, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S2-10-AC2 — PASS

**AC gốc:** Soạn mô tả công việc và yêu cầu ứng viên, lưu nháp được

- Chức năng: /requisitions → Tạo
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Nhập JD/requirements, lưu partial DRAFT rồi reopen; OPEN validate required.
- Thao tác: Mở /requisitions → Tạo bằng vai trò Trưởng bộ phận. → Nhập JD/requirements, lưu partial DRAFT rồi reopen; OPEN validate required. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Soạn mô tả công việc và yêu cầu ứng viên, lưu nháp được
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:s2-10, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S2-10-AC3 — PASS

**AC gốc:** Dải lương đề xuất nằm ngoài dải chuẩn của chức danh thì bắt buộc nhập giải trình

- Chức năng: /requisitions → Tạo
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Salary ngoài chuẩn phải giải trình, kể cả draft; không leak standard range.
- Thao tác: Mở /requisitions → Tạo bằng vai trò Trưởng bộ phận. → Salary ngoài chuẩn phải giải trình, kể cả draft; không leak standard range. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Dải lương đề xuất nằm ngoài dải chuẩn của chức danh thì bắt buộc nhập giải trình
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:s2-10, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S2-10-AC4 — PASS

**AC gốc:** Ngày cần người không được ở quá khứ

- Chức năng: /requisitions → Tạo
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. NeededDate hôm qua reject, hôm nay/future accept theo Asia/Ho_Chi_Minh.
- Thao tác: Mở /requisitions → Tạo bằng vai trò Trưởng bộ phận. → NeededDate hôm qua reject, hôm nay/future accept theo Asia/Ho_Chi_Minh. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ngày cần người không được ở quá khứ
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:sprint2, test:coverage:sprint2, test:s2-10, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

### S3-01

#### S3-01-AC1 — PASS

**AC gốc:** Khai báo chuỗi cấp duyệt theo phòng ban và theo mức lương đề xuất

- Chức năng: /admin/approval-configurations
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR/Admin tạo chain department, order/limit/single approver, publish version.
- Thao tác: Mở /admin/approval-configurations bằng vai trò Trưởng phòng Nhân sự. → HR/Admin tạo chain department, order/limit/single approver, publish version. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khai báo chuỗi cấp duyệt theo phòng ban và theo mức lương đề xuất
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-01, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-01-AC2 — PASS

**AC gốc:** Yêu cầu vượt hạn mức tự động thêm cấp duyệt cao hơn

- Chức năng: /admin/approval-configurations
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Salary dưới/bằng/vượt limit: resolve từ cấp1, vượt mới thêm cấp, không skip.
- Thao tác: Mở /admin/approval-configurations bằng vai trò Trưởng phòng Nhân sự. → Salary dưới/bằng/vượt limit: resolve từ cấp1, vượt mới thêm cấp, không skip. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Yêu cầu vượt hạn mức tự động thêm cấp duyệt cao hơn
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-01, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-01-AC3 — PASS

**AC gốc:** Cấu hình sai (không có cấp duyệt nào khớp) bị chặn lưu

- Chức năng: /admin/approval-configurations
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Invalid department/order/limit/actor/duplicate/self hoặc không phủ salary: reject atomically.
- Thao tác: Mở /admin/approval-configurations bằng vai trò Trưởng phòng Nhân sự. → Invalid department/order/limit/actor/duplicate/self hoặc không phủ salary: reject atomically. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Cấu hình sai (không có cấp duyệt nào khớp) bị chặn lưu
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-01, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-01-AC4 — PASS

**AC gốc:** Luồng đang chạy không bị ảnh hưởng khi cấu hình thay đổi

- Chức năng: /admin/approval-configurations
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Khởi tạo snapshot, publish config version mới; workflow cũ giữ version/steps.
- Thao tác: Mở /admin/approval-configurations bằng vai trò Trưởng phòng Nhân sự. → Khởi tạo snapshot, publish config version mới; workflow cũ giữ version/steps. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Luồng đang chạy không bị ảnh hưởng khi cấu hình thay đổi
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-01, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S3-02

#### S3-02-AC1 — PASS

**AC gốc:** Ba hành động: Duyệt, Từ chối, Yêu cầu bổ sung — hai hành động sau bắt buộc nhập ý kiến

- Chức năng: /requisitions → /approvals
- Vai trò: Người duyệt
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Assigned approver thử Approve/Reject/Request info; hai hành động sau thiếu ý kiến reject.
- Thao tác: Mở /requisitions → /approvals bằng vai trò Người duyệt. → Assigned approver thử Approve/Reject/Request info; hai hành động sau thiếu ý kiến reject. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ba hành động: Duyệt, Từ chối, Yêu cầu bổ sung — hai hành động sau bắt buộc nhập ý kiến
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-02, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Người duyệt; Họ tên ______; ngày ______; chữ ký ______.

#### S3-02-AC2 — PASS

**AC gốc:** Duyệt xong tự chuyển sang cấp kế tiếp; cấp cuối duyệt thì yêu cầu chuyển sang trạng thái Đã duyệt

- Chức năng: /requisitions → /approvals
- Vai trò: Người duyệt
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Approve từng cấp, final APPROVED riêng; recruitment OPEN không đổi sai trục.
- Thao tác: Mở /requisitions → /approvals bằng vai trò Người duyệt. → Approve từng cấp, final APPROVED riêng; recruitment OPEN không đổi sai trục. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Duyệt xong tự chuyển sang cấp kế tiếp; cấp cuối duyệt thì yêu cầu chuyển sang trạng thái Đã duyệt
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-02, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Người duyệt; Họ tên ______; ngày ______; chữ ký ______.

#### S3-02-AC3 — PASS

**AC gốc:** Yêu cầu bổ sung trả hồ sơ về cho người tạo và giữ nguyên lịch sử

- Chức năng: /requisitions → /approvals
- Vai trò: Người duyệt
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. NEEDS_INFO tạo revision, restart cấp1; APPROVED reapproval groupB giữ main tới final; HR/Admin gửi thay có lý do, history bất biến.
- Thao tác: Mở /requisitions → /approvals bằng vai trò Người duyệt. → NEEDS_INFO tạo revision, restart cấp1; APPROVED reapproval groupB giữ main tới final; HR/Admin gửi thay có lý do, history bất biến. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Yêu cầu bổ sung trả hồ sơ về cho người tạo và giữ nguyên lịch sử
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-02, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Người duyệt; Họ tên ______; ngày ______; chữ ký ______.

### S3-03

#### S3-03-AC1 — PASS

**AC gốc:** Hiển thị chuỗi cấp duyệt, cấp nào đã duyệt, đang chờ ai

- Chức năng: /requisitions → Chi tiết
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Owner/manager mở chi tiết: current chain và waitingFor đúng.
- Thao tác: Mở /requisitions → Chi tiết bằng vai trò Trưởng bộ phận. → Owner/manager mở chi tiết: current chain và waitingFor đúng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Hiển thị chuỗi cấp duyệt, cấp nào đã duyệt, đang chờ ai
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-03, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S3-03-AC2 — PASS

**AC gốc:** Mỗi bước ghi người duyệt, thời điểm, ý kiến

- Chức năng: /requisitions → Chi tiết
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Duyệt các bước, đối chiếu actor/time/comment và nhiều rounds.
- Thao tác: Mở /requisitions → Chi tiết bằng vai trò Trưởng bộ phận. → Duyệt các bước, đối chiếu actor/time/comment và nhiều rounds. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi bước ghi người duyệt, thời điểm, ý kiến
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-03, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S3-03-AC3 — PASS

**AC gốc:** Lịch sử không sửa và không xoá được

- Chức năng: /requisitions → Chi tiết
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Thử PUT/DELETE/history database guard; IDOR người ngoài scope bị chặn.
- Thao tác: Mở /requisitions → Chi tiết bằng vai trò Trưởng bộ phận. → Thử PUT/DELETE/history database guard; IDOR người ngoài scope bị chặn. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Lịch sử không sửa và không xoá được
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-03, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

### S3-04

#### S3-04-AC1 — PASS

**AC gốc:** Khai báo chỉ tiêu headcount và ngân sách lương theo phòng ban theo năm

- Chức năng: /admin/headcount-budgets
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR/Admin công bố budget department/year, version mới, không duplicate.
- Thao tác: Mở /admin/headcount-budgets bằng vai trò Trưởng phòng Nhân sự. → HR/Admin công bố budget department/year, version mới, không duplicate. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khai báo chỉ tiêu headcount và ngân sách lương theo phòng ban theo năm
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-04, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-04-AC2 — PASS

**AC gốc:** Yêu cầu tuyển dụng mới hiển thị số headcount còn lại của phòng ban

- Chức năng: /admin/headcount-budgets
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Tạo Req hiển thị remaining; year từ neededDate, salary×qty×tháng còn lại.
- Thao tác: Mở /admin/headcount-budgets bằng vai trò Trưởng phòng Nhân sự. → Tạo Req hiển thị remaining; year từ neededDate, salary×qty×tháng còn lại. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Yêu cầu tuyển dụng mới hiển thị số headcount còn lại của phòng ban
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-04, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-04-AC3 — PASS

**AC gốc:** Vượt chỉ tiêu là cảnh báo chặn, cần Trưởng phòng Nhân sự xác nhận ghi đè kèm lý do

- Chức năng: /admin/headcount-budgets
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Vượt cap bị chặn; HR/Admin reason-bound override, Hiring không override; race/rollback/revision delta không tính trùng.
- Thao tác: Mở /admin/headcount-budgets bằng vai trò Trưởng phòng Nhân sự. → Vượt cap bị chặn; HR/Admin reason-bound override, Hiring không override; race/rollback/revision delta không tính trùng. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Vượt chỉ tiêu là cảnh báo chặn, cần Trưởng phòng Nhân sự xác nhận ghi đè kèm lý do
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-04, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S3-05

#### S3-05-AC1 — PASS

**AC gốc:** Sao chép toàn bộ mô tả công việc và yêu cầu ứng viên

- Chức năng: /requisitions → Sao chép
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Copy DRAFT/OPEN/IP/CLOSED trong scope; JD/requirements full exact, source không đổi.
- Thao tác: Mở /requisitions → Sao chép bằng vai trò Trưởng bộ phận. → Copy DRAFT/OPEN/IP/CLOSED trong scope; JD/requirements full exact, source không đổi. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Sao chép toàn bộ mô tả công việc và yêu cầu ứng viên
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-05, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

#### S3-05-AC2 — PASS

**AC gốc:** Bản sao luôn bắt đầu ở trạng thái Nháp, không kế thừa lịch sử duyệt

- Chức năng: /requisitions → Sao chép
- Vai trò: Trưởng bộ phận
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Copy luôn DRAFT/new ID/code; không approval/history/assignment/candidate/reservation.
- Thao tác: Mở /requisitions → Sao chép bằng vai trò Trưởng bộ phận. → Copy luôn DRAFT/new ID/code; không approval/history/assignment/candidate/reservation. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Bản sao luôn bắt đầu ở trạng thái Nháp, không kế thừa lịch sử duyệt
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-05, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng bộ phận; Họ tên ______; ngày ______; chữ ký ______.

### S3-06

#### S3-06-AC1 — PASS

**AC gốc:** Phân công một recruiter chính và nhiều recruiter hỗ trợ

- Chức năng: /requisitions → Chi tiết → Recruiter
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR/Admin assign1 primary+n supports active RECRUITER, không trùng; race một version.
- Thao tác: Mở /requisitions → Chi tiết → Recruiter bằng vai trò Trưởng phòng Nhân sự. → HR/Admin assign1 primary+n supports active RECRUITER, không trùng; race một version. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Phân công một recruiter chính và nhiều recruiter hỗ trợ
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-06, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-06-AC2 — PASS

**AC gốc:** Recruiter chỉ nhìn thấy ứng viên của vị trí được giao

- Chức năng: /requisitions → Chi tiết → Recruiter
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Recruiter assigned mới thấy candidate theo Req; remove thu hồi list/detail/search/attachments.
- Thao tác: Mở /requisitions → Chi tiết → Recruiter bằng vai trò Trưởng phòng Nhân sự. → Recruiter assigned mới thấy candidate theo Req; remove thu hồi list/detail/search/attachments. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Recruiter chỉ nhìn thấy ứng viên của vị trí được giao
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-06, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-06-AC3 — PASS

**AC gốc:** Có ghi lịch sử chuyển giao khi đổi người phụ trách

- Chức năng: /requisitions → Chi tiết → Recruiter
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Change primary/add/remove support: actor/time/old/new/type/reason; no-op không audit giả.
- Thao tác: Mở /requisitions → Chi tiết → Recruiter bằng vai trò Trưởng phòng Nhân sự. → Change primary/add/remove support: actor/time/old/new/type/reason; no-op không audit giả. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Có ghi lịch sử chuyển giao khi đổi người phụ trách
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-06, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S3-07

#### S3-07-AC1 — PASS

**AC gốc:** Ba trạng thái kết thúc có lý do riêng: Đã tuyển đủ, Tạm dừng, Huỷ

- Chức năng: /requisitions → Vòng đời
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. HR/Admin reason bắt buộc cho fulfilled/paused/cancel; pending/range/state guards.
- Thao tác: Mở /requisitions → Vòng đời bằng vai trò Trưởng phòng Nhân sự. → HR/Admin reason bắt buộc cho fulfilled/paused/cancel; pending/range/state guards. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ba trạng thái kết thúc có lý do riêng: Đã tuyển đủ, Tạm dừng, Huỷ
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-07, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-07-AC2 — PASS

**AC gốc:** Đóng yêu cầu tự động gỡ tin tuyển dụng đang đăng

- Chức năng: /requisitions → Vòng đời
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đóng/huỷ/paused atomic unpublish; public/API application chặn, không auto republish.
- Thao tác: Mở /requisitions → Vòng đời bằng vai trò Trưởng phòng Nhân sự. → Đóng/huỷ/paused atomic unpublish; public/API application chặn, không auto republish. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Đóng yêu cầu tự động gỡ tin tuyển dụng đang đăng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-07, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-07-AC3 — PASS

**AC gốc:** Ứng viên còn đang trong pipeline được cảnh báo cần xử lý trước khi đóng

- Chức năng: /requisitions → Vòng đời
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Outstanding pipeline cảnh báo và chặn close/cancel; không auto đổi candidate/interview/offer; quota giữ/phóng đúng snapshot HIRED.
- Thao tác: Mở /requisitions → Vòng đời bằng vai trò Trưởng phòng Nhân sự. → Outstanding pipeline cảnh báo và chặn close/cancel; không auto đổi candidate/interview/offer; quota giữ/phóng đúng snapshot HIRED. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ứng viên còn đang trong pipeline được cảnh báo cần xử lý trước khi đóng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-07, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S3-08

#### S3-08-AC1 — PASS

**AC gốc:** Lọc theo trạng thái, phòng ban, recruiter phụ trách, khoảng thời gian

- Chức năng: /requisitions
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Kết hợp state/department/primary-or-support/createdDate range, scope và paging.
- Thao tác: Mở /requisitions bằng vai trò Trưởng phòng Nhân sự. → Kết hợp state/department/primary-or-support/createdDate range, scope và paging. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Lọc theo trạng thái, phòng ban, recruiter phụ trách, khoảng thời gian
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-08, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-08-AC2 — PASS

**AC gốc:** Mỗi dòng hiển thị số ngày mở và số ngày còn lại tới ngày cần người

- Chức năng: /requisitions
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Verify daysOpen từ openedAt/legacy estimate; remaining theo neededDate và ngàyVN.
- Thao tác: Mở /requisitions bằng vai trò Trưởng phòng Nhân sự. → Verify daysOpen từ openedAt/legacy estimate; remaining theo neededDate và ngàyVN. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Mỗi dòng hiển thị số ngày mở và số ngày còn lại tới ngày cần người
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-08, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-08-AC3 — PASS

**AC gốc:** Yêu cầu quá ngày cần người được đánh dấu nổi bật

- Chức năng: /requisitions
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Quá hạn chỉ OPEN/IP nổi bật; today/PAUSED/CLOSED/CANCELLED không đánh dấu sai; leap/day boundary.
- Thao tác: Mở /requisitions bằng vai trò Trưởng phòng Nhân sự. → Quá hạn chỉ OPEN/IP nổi bật; today/PAUSED/CLOSED/CANCELLED không đánh dấu sai; leap/day boundary. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Yêu cầu quá ngày cần người được đánh dấu nổi bật
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-08, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

### S3-09

#### S3-09-AC1 — PASS

**AC gốc:** Nội dung mô tả công việc được kế thừa từ yêu cầu, sửa lại được cho phù hợp ngôn ngữ tuyển dụng

- Chức năng: /requisitions → Soạn tin
- Vai trò: Nhân viên tuyển dụng
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Assigned recruiter tạo draft từ effective approved JD, edit không đổi Req.
- Thao tác: Mở /requisitions → Soạn tin bằng vai trò Nhân viên tuyển dụng. → Assigned recruiter tạo draft từ effective approved JD, edit không đổi Req. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Nội dung mô tả công việc được kế thừa từ yêu cầu, sửa lại được cho phù hợp ngôn ngữ tuyển dụng
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-09, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Nhân viên tuyển dụng; Họ tên ______; ngày ______; chữ ký ______.

#### S3-09-AC2 — PASS

**AC gốc:** Khai báo địa điểm, hình thức làm việc, hạn nhận hồ sơ, có hiển thị mức lương hay không

- Chức năng: /requisitions → Soạn tin
- Vai trò: Nhân viên tuyển dụng
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Catalog location/mode/deadline/showSalary; public payload hidden salary khi false.
- Thao tác: Mở /requisitions → Soạn tin bằng vai trò Nhân viên tuyển dụng. → Catalog location/mode/deadline/showSalary; public payload hidden salary khi false. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Khai báo địa điểm, hình thức làm việc, hạn nhận hồ sơ, có hiển thị mức lương hay không
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-09, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Nhân viên tuyển dụng; Họ tên ______; ngày ______; chữ ký ______.

#### S3-09-AC3 — PASS

**AC gốc:** Chỉ yêu cầu ở trạng thái Đã duyệt mới tạo được tin

- Chức năng: /requisitions → Soạn tin
- Vai trò: Nhân viên tuyển dụng
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Unapproved/paused/closed/cancelled/unassigned reject; PENDING revision không dùng draft data; không auto publish.
- Thao tác: Mở /requisitions → Soạn tin bằng vai trò Nhân viên tuyển dụng. → Unapproved/paused/closed/cancelled/unassigned reject; PENDING revision không dùng draft data; không auto publish. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Chỉ yêu cầu ở trạng thái Đã duyệt mới tạo được tin
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-09, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Nhân viên tuyển dụng; Họ tên ______; ngày ______; chữ ký ______.

### S3-10

#### S3-10-AC1 — PASS

**AC gốc:** Tin phải qua duyệt trước khi hiển thị công khai

- Chức năng: /approvals → Preview/Publish → /careers/jobs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Draft→submit→independent HR/Admin review→explicit publish; chỉ PUBLISHED eligible public.
- Thao tác: Mở /approvals → Preview/Publish → /careers/jobs bằng vai trò Trưởng phòng Nhân sự. → Draft→submit→independent HR/Admin review→explicit publish; chỉ PUBLISHED eligible public. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Tin phải qua duyệt trước khi hiển thị công khai
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-10, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-10-AC2 — PASS

**AC gốc:** Xem trước đúng như giao diện công khai trước khi xuất bản

- Chức năng: /approvals → Preview/Publish → /careers/jobs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Authenticated preview cùng public component/DOM, private draft không listing; expiry inclusive VN date; brand cần ký.
- Thao tác: Mở /approvals → Preview/Publish → /careers/jobs bằng vai trò Trưởng phòng Nhân sự. → Authenticated preview cùng public component/DOM, private draft không listing; expiry inclusive VN date; brand cần ký. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Xem trước đúng như giao diện công khai trước khi xuất bản
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-10, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.

#### S3-10-AC3 — PASS

**AC gốc:** Ghi lại người xuất bản và thời điểm

- Chức năng: /approvals → Preview/Publish → /careers/jobs
- Vai trò: Trưởng phòng Nhân sự
- Điều kiện/đầu vào: Fresh isolated DB; active test accounts; valid catalogs/permissions; approved/configured chain/budget/assignment where required; no production data. Đối chiếu publishedBy/At, immutable version/events; retry/concurrent/rollback và source-change/lifecycle unpublish.
- Thao tác: Mở /approvals → Preview/Publish → /careers/jobs bằng vai trò Trưởng phòng Nhân sự. → Đối chiếu publishedBy/At, immutable version/events; retry/concurrent/rollback và source-change/lifecycle unpublish. → Kiểm tra API/readback, scope, persisted state và bằng chứng; ghi kết quả và ký nếu phù hợp.
- Expected: Ghi lại người xuất bản và thời điểm
- Actual: Fresh suites/API/integration and applicable browser checks PASS; see per-command evidence. User signature not provided.
- Evidence: test:s3-10, test:reapproval, test:rbac, test:browser-e2e; command/exit/hash/matching-case trong JSON.
- Người dùng xác nhận: ☐ PENDING; reviewer Trưởng phòng Nhân sự; Họ tên ______; ngày ______; chữ ký ______.


## Điều kiện bước tiếp theo

Để đóng technical acceptance đầy đủ: cung cấp sandbox/inbox được phép và receipt verification. Để USER ACCEPTANCE APPROVED: reviewer ký91 AC/phạm vi deferred, brand ký ảnh và nội dung công khai. Để push: người dùng phê duyệt allowlist/commit plan, kiểm tra lại live remote và staged secrets; đây chưa phải thao tác đã làm.

Không commit/push hoặc bật production trong task này.

## Git status cuối

```text
M backend/data/ats.db
 M backend/data/ats.db-shm
 M backend/data/ats.db-wal
 M backend/data/ats_test.db
 M backend/src/config/config.js
 M backend/src/controllers/authController.js
 M backend/src/db/migrations/001_postgres.sql
 M backend/src/db/sync-permissions.js
 M backend/src/server.js
 M backend/src/services/headcountBudgetService.js
 M backend/src/services/recruitmentCatalogService.js
 M backend/src/services/requisitionApprovalService.js
 M backend/src/services/requisitionService.js
 M backend/src/services/userService.js
 M backend/tests/test_s1_frontend_fixes.js
 M docs/ATS-E2E-2026-10-08.md
 M docs/RBAC-admin-permissions.md
 M frontend/components/create-req-modal.html
 M frontend/components/requisition-detail-modal.html
 M frontend/css/style.css
 M frontend/index.html
 M frontend/js/api.js
 M frontend/js/app.js
 M frontend/js/components/requisition-approval.js
 M frontend/js/components/requisition-detail.js
 M frontend/js/components/requisition-form.js
 M frontend/js/pages/career-page.js
 M frontend/js/pages/dashboard.js
 M frontend/js/pages/requisitions.js
 M frontend/js/shared/route-lifecycle.js
 M frontend/pages/login.html
 M frontend/pages/requisitions.html
 M frontend/routes.json
 M package-lock.json
 M package.json
?? backend/src/controllers/jobPostingDraftController.js
?? backend/src/controllers/jobPostingPublicationController.js
?? backend/src/controllers/requisitionLifecycleController.js
?? backend/src/db/migrate-job-publication.js
?? backend/src/db/migrate-requisition-lifecycle.js
?? backend/src/db/migrate-requisition-tracking-job-drafts.js
?? backend/src/db/migrations/006_requisition_lifecycle_postgres.sql
?? backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql
?? backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql
?? backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql
?? backend/src/db/migrations/008_job_publication_postgres.sql
?? backend/src/db/migrations/008_job_publication_sqlite.sql
?? backend/src/services/jobPostingPublicationService.js
?? backend/src/services/jobPostingService.js
?? backend/src/services/requisitionLifecycleService.js
?? backend/src/services/requisitionTrackingService.js
?? backend/tests/helpers/visualAcceptance.js
?? backend/tests/run_browser_e2e.js
?? backend/tests/test_browser_e2e.js
?? backend/tests/test_candidate_stage.js
?? backend/tests/test_s3_07.js
?? backend/tests/test_s3_08_09.js
?? backend/tests/test_s3_10.js
?? backend/tests/test_s3_10_pg_live.js
?? backend/tests/test_user_list_batch.js
?? docs/ATS-audit-fixes-2026-10-09.md
?? docs/ATS-final-acceptance-and-push-readiness.md
?? docs/ATS-full-audit-2026-10-09.md
?? docs/ATS-readiness-2026-10-09.md
?? docs/S3-07-requisition-lifecycle.md
?? docs/S3-08-S3-09-tracking-job-drafts.md
?? docs/S3-10-job-publication.md
?? docs/Sprint-3-summary-2026-10-09.md
?? docs/evidence/
?? frontend/js/components/job-posting-drafts.js
?? frontend/js/components/job-posting-public-renderer.js
?? frontend/js/components/job-posting-publication.js
?? frontend/js/components/requisition-lifecycle.js
?? frontend/js/pages/public-jobs.js
?? frontend/pages/public-jobs.html
```

Status chứa thay đổi có sẵn; không chỉ các file sửa trong task.
