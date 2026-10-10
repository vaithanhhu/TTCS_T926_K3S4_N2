# ATS Sprint 1–3 — Khắc phục N+1 và chuẩn bị nghiệm thu — 09/10/2026

**AUTOMATED REGRESSION + REAL BROWSER E2E PASS.** Không còn failure trong các lượt chạy cuối. Có bằng chứng kỹ thuật để bắt đầu review/nghiệm thu của người dùng; không tự thay thế nghiệm thu chính thức, xác nhận email thật hoặc phê duyệt bật flags production.

Branch: feature/s2-bulk-user-import. HEAD: d962ef3a9da49d42b595dba85ca3daa3404454db. Giữ nguyên trước/sau. Không stage/commit/push/merge/rebase/reset/restore/clean/stash. Sửa trực tiếp source hiện tại, không dùng ZIP/patch bên ngoài để thay source.

[Bằng chứng JSON](evidence/ATS-readiness-2026-10-09.json) · [Diff riêng nhiệm vụ](evidence/ATS-readiness-2026-10-09.diff) · [Kết quả Browser](evidence/ATS-readiness-2026-10-09-browser/results.json).

## File sửa/tạo riêng nhiệm vụ

| File | Lý do |
|---|---|
| backend/src/services/userService.js | Batch roles; giữ DTO/count/filter/order/pagination |
| backend/tests/test_user_list_batch.js | SQL count và contract parity trên ba engine,0/1/20/120 users |
| backend/tests/test_browser_e2e.js | Playwright/Chromium28 ca, UI thật, screenshot/trace, flags ON/OFF |
| backend/tests/run_browser_e2e.js | Chạy từ workspace bằng source/SQLite mới cách ly, loại .env/runtime DB, SMTP simulated |
| package.json | Đăng ký hai test script; Playwright là dev dependency |
| package-lock.json | Lock Playwright1.64.0 và playwright-core; giữ package manager |
| docs/ATS-readiness-2026-10-09.md | Báo cáo này |
| docs/evidence/ATS-readiness-2026-10-09.json và .diff | Kết quả máy đọc được, hash log và diff theo snapshot trước task |
| docs/evidence/ATS-readiness-2026-10-09-browser/ | 16 PNG,8 trace ZIP sanitized,1 results.json |

Không sửa production frontend, RBAC, auth, Candidate, approval, budget hoặc migration. Các file đó vẫn có thay đổi S3 từ trước, không gán chúng cho nhiệm vụ này.

## N+1 trước/sau

Root cause: getUsers lấy count/page rồi Promise.all gọi SELECT roles cho từng user. Promise.all chỉ song song hóa, không loại N+1.

Giữ hai query count/page; truyền ID của page bằng một JSON array parameter. SQLite json_each / PostgreSQL jsonb_array_elements_text lấy roles bằng một SELECT, nhóm theo user_id; role vẫn r.code ASC. JSON parameter tránh tăng bind theo page size/giới hạn placeholder SQLite. Không cache quyền hoặc lấy roles ngoài page.

Đo lại bản code trước/sau trên cùng DB cách ly, so sánh nguyên response JSON:

| Dòng thực trả | SQL trước | SQL sau |
|---|---:|---:|
| 0 | 2 | 2 |
| 1 | 3 | 3 |
| 20 | 22 | 3 |
| 28 | 30 | 3 |

Response giống nhau. Giảm19 SQL cho page20; không quy thành tỷ lệ tăng latency chưa đo.

Test mới **SQLite8/8, PGlite8/8, PostgreSQL thật8/8 =24/24 lượt**:0/1/20/120 users, không role/multi-role; page1/2/last/out-of-range; search + role code/name + status; unknown role, SQL input, normalization; đối chiếu mọi field, roleNames, thứ tự và pagination với reference. Nonempty page luôn3 SQL, empty2 SQL. Avatar/RBAC/session/UX còn kiểm tra qua regression. Không đổi schema/dữ liệu.

## Browser E2E thật

Playwright1.64.0, Chromium156.0.8078.4, headless thật. Browser tích hợp chat không kết nối nhưng framework E2E đã hoạt động, không thay VM/API bằng tên Browser PASS.

Bản sao SQLite mới, không .git/.env/runtime DB, bảy vai trò seed thử; email simulated. Browser chỉ truy cập localhost; external fonts trả rỗng, dùng font fallback, không sửa source CSS. Desktop1440×1000, mobile390×844. Không dùng Neon cho E2E.

**28/28 PASS, exit0** trong full regression cuối. Runner trực tiếp từ workspace cũng28/28; không cộng trùng rerun.

| Ca Browser | Kết quả |
|---|---|
| S1 login/home/navigation ADMIN | PASS |
| S1 login/home/navigation HR_MANAGER | PASS |
| S1 login/home/navigation HIRING_MGR | PASS |
| S1 login/home/navigation APPROVER | PASS |
| S1 login/home/navigation RECRUITER | PASS |
| S1 login/home/navigation INTERVIEWER | PASS |
| S1 login/home/navigation CANDIDATE | PASS |
| S1 users real table and pagination after batching | PASS |
| RBAC Hiring Manager configuration route denied | PASS |
| RBAC real route blocks internal administration CANDIDATE | PASS |
| RBAC real route blocks internal administration INTERVIEWER | PASS |
| Configuration API failure displays user-facing error | PASS |
| S3-01 HR creates and publishes two-level configuration version | PASS |
| S2-10 invalid quantity has visible validation and no write | PASS |
| S2-10 real UI creates OPEN without auto approval | PASS |
| S3-02 two assigned approval levels through real UI | PASS |
| S3-03 owner sees ordered approval history and decisions | PASS |
| S3-06 real UI assigns primary and support recruiter | PASS |
| S3-09/10 UI composes, submits, independently approves and publishes | PASS |
| S3-10 preview and public share exact DOM and hidden salary | PASS |
| Mobile public detail and HR preview render without horizontal overflow | PASS |
| S3-07 CLOSED via UI unpublishes and retains quota | PASS |
| S3-07 PAUSED real UI and public removal | PASS |
| S3-07 CANCELLED real UI and public removal | PASS |
| Feature flags ON agree with backend capabilities and navigation | PASS |
| Eight feature flags OFF enforce API and hide frontend features | PASS |
| S1 logout clears session and protected deep link requires login | PASS |
| Browser console/page runtime and HTTP5xx clean | PASS |

Luồng UI: HIRING_MGR tạo OPEN, chủ động gửi duyệt, HR/ADMIN duyệt đúng hai cấp; HR phân công chính/hỗ trợ; recruiter được giao soạn/lưu/gửi tin; HR độc lập duyệt/xuất bản. Context anonymous kiểm tra public. Preview/public so sánh nguyên outerHTML cùng component và salary không lộ khi ẩn.

CLOSED/PAUSED/CANCELLED thao tác UI, public không còn tin, không nhận application mới, quota PAUSED/CLOSED đúng. Hai HIRED để đóng là fixture phụ trợ, không tuyên bố đã thao tác pipeline UI cho bước fixture đó. Pipeline/rollback/concurrency/IDOR có suite riêng.

Page error/uncaught runtime0; không HTTP5xx bất ngờ. Log giữ403 RBAC,404 tin gỡ và một500 fault injection có nhãn để kiểm tra lỗi frontend. Picker legacy có thể gọi users rồi nhận403 đúng quyền recruiter, UI xử lý và luồng vẫn hoạt động. Không che log hoặc xem mọi HTTP4xx là lỗi hệ thống.

### Lượt FAIL ban đầu

Full run đầu: INTERVIEWER/CANDIDATE login timeout, logout INTERVIEWER sau login thất bại. Network không có POST login: harness click trước bootstrap. Source có html data-app-ready=true.

Chỉ sửa harness chờ marker hiện có, giữ assertion/home/RBAC, không sửa production bootstrap. Log first-full-results/first-browser-e2e giữ trong scratch. Sau sửa:28/28 rồi toàn bộ47 nhóm chạy lại exit0; không lấy lượt FAIL để báo PASS.

### Bằng chứng

- [Public desktop](evidence/ATS-readiness-2026-10-09-browser/public-desktop.png)
- [Public mobile](evidence/ATS-readiness-2026-10-09-browser/public-mobile.png)
- [Preview mobile](evidence/ATS-readiness-2026-10-09-browser/preview-mobile.png)
- [Cấu hình version2](evidence/ATS-readiness-2026-10-09-browser/configuration-version2.png)
- [Lịch sử duyệt](evidence/ATS-readiness-2026-10-09-browser/approval-history.png)
- [PAUSED](evidence/ATS-readiness-2026-10-09-browser/paused-history.png)
- [CANCELLED](evidence/ATS-readiness-2026-10-09-browser/cancelled-history.png)
- [Flags OFF](evidence/ATS-readiness-2026-10-09-browser/flags-off.png)
- [Trace HR](evidence/ATS-readiness-2026-10-09-browser/trace-HR_MANAGER.zip)
- [Trace creator](evidence/ATS-readiness-2026-10-09-browser/trace-HIRING_MGR.zip)

ZIP là trace Playwright, không phải source ZIP thay thế. Test password/token loại khỏi trace; scan không thấy fixture password hoặc raw Bearer. Không chứa credential Neon/SMTP. Ảnh public/mobile đã xem lại; human brand/visual signoff vẫn cần nghiệm thu.

## Feature flags

Không sửa .env hoặc bật production; bật/tắt chỉ trong tiến trình cách ly. Neon config trước/sau đều OFF.

| Flag | Frontend | ON | OFF | Production |
|---|---|---|---|---|
| APPROVAL_CONFIGURATION_ENABLED | S3-01 configuration page/menu | PASS | PASS | OFF → OFF |
| REQUISITION_APPROVAL_ENABLED | S3-02/03 cards/history/revisions | PASS | PASS | OFF → OFF |
| HEADCOUNT_BUDGET_ENABLED | S3-04 budget menu/availability | PASS | PASS | OFF → OFF |
| REQUISITION_OPERATIONS_ENABLED | S3-05/06 copy/assignment | PASS | PASS | OFF → OFF |
| REQUISITION_LIFECYCLE_ENABLED | S3-07 lifecycle/public eligibility | PASS | PASS | OFF → OFF |
| REQUISITION_TRACKING_ENABLED | S3-08 list filters/date columns | PASS | PASS | OFF → OFF |
| JOB_POSTING_DRAFTS_ENABLED | S3-09 draft composer | PASS | PASS | OFF → OFF |
| JOB_POSTING_PUBLICATION_ENABLED | S3-10 queue/preview/publication | PASS | PASS | OFF → OFF |

OFF: tám endpoint404; menu cấu hình/ngân sách và panel S3 ẩn. ON: capabilities/filter/nav/API hoạt động theo role, không tự cấp quyền. Offer approval/trạng thái tuyển dụng cũ giữ nguyên.

## Regression mới chạy — lượt cuối

| Lệnh | Cases | Status | Exit |
|---|---|---|---|
| npm run test:sprint1 | 56/56 | PASS | 0 |
| npm run test:browser-e2e | 28/28 | PASS | 0 |
| npm run test:user-list-batch | 16/16 | PASS | 0 |
| npm run test:candidate-stage | 52/52 | PASS | 0 |
| npm run test:s1-frontend-fixes | 18/18 | PASS | 0 |
| npm run test:final-rbac-open | 33/33 | PASS | 0 |
| npm run test:requisition-access | 16/16 | PASS | 0 |
| npm run test:ats-e2e | 51/51 | PASS | 0 |
| npm run test:rbac | 47/47 | PASS | 0 |
| npm run test:s3-02 | 93/93 | PASS | 0 |
| npm run test:s3-01 | 108/108 | PASS | 0 |
| npm run test:postgres | 15/15 | PASS | 0 |
| npm run test:review-updates | 22/22 | PASS | 0 |
| npm run test:s1-01 | 8/8 | PASS | 0 |
| npm run test:s1-02 | 5/5 | PASS | 0 |
| npm run test:s1-03 | 5/5 | PASS | 0 |
| npm run test:s1-03:email | 49/49 | PASS | 0 |
| npm run test:s1-04 | 5/5 | PASS | 0 |
| npm run test:s1-05 | 6/6 | PASS | 0 |
| npm run test:s1-06 | 3/3 | PASS | 0 |
| npm run test:s1-07 | 4/4 | PASS | 0 |
| npm run test:s1-08 | 5/5 | PASS | 0 |
| npm run test:s1-09 | 7/7 | PASS | 0 |
| npm run test:s1-10 | 8/8 | PASS | 0 |
| npm run test:otp | 8/8 | PASS | 0 |
| npm run test:sprint2 | 32/32 | PASS | 0 |
| npm run test:s2-10 | 59/59 | PASS | 0 |
| npm run test:routing | 187/187 | PASS | 0 |
| npm run test:user-ux | 87/87 | PASS | 0 |
| npm run test:datetime-dashboard | 28/28 | PASS | 0 |
| npm run test:avatar | 21/21 | PASS | 0 |
| npm run test:mobile-shell | 53/53 | PASS | 0 |
| npm run test:layout | 45/45 | PASS | 0 |
| npm run test:coverage:sprint1 | 23/23 | PASS | 0 |
| npm run test:coverage:sprint2 | 25/25 | PASS | 0 |
| npm run test:career-upload | 24/24 | PASS | 0 |
| npm run test:user-roles-avatar | 17/17 | PASS | 0 |
| npm run test:reapproval | 94/94 | PASS | 0 |
| npm run test:s3-03 | 29/29 | PASS | 0 |
| npm run test:s3-04 | 55/55 | PASS | 0 |
| npm run test:s3-05 | 36/36 | PASS | 0 |
| npm run test:s3-06 | 46/46 | PASS | 0 |
| npm run test:s3-07 | 51/51 | PASS | 0 |
| npm run test:s3-08 | 27/27 | PASS | 0 |
| npm run test:s3-09 | 41/41 | PASS | 0 |
| npm run test:s3-10 | 53/53 | PASS | 0 |
| node backend/tests/test_postgres_startup.js | 11/11 | PASS | 0 |

### PostgreSQL thật và xuyên Sprint

| Lệnh | Cases | Status | Exit |
|---|---|---|---|
| node backend/tests/test_user_list_batch.js --postgres-only | 8/8 | PASS | 0 |
| node backend/tests/test_candidate_stage.js --postgres-only | 27/27 | PASS | 0 |
| node backend/tests/test_s3_10_pg_live.js | 32/32 | PASS | 0 |
| node backend/tests/test_postgres_live.js | 3/3 | PASS | 0 |
| node scratch:integration.cjs | 23/23 | PASS | 0 |
| node scratch:pg-concurrency-extra.cjs | 2/2 | PASS | 0 |

Wrapper scratch dùng env sạch, source riêng và localhost test URL. PostgreSQL17.10,127.0.0.1:53477, năm DB mới; cluster đã dừng. Không stress Neon.

Sprint1 individual10/10 suite56/56, aggregate56/56, coverage23/23, frontend fixes18/18. Sprint2 common32/32, coverage25/25, S2-10 59/59. S3-01..10 **539/539**, tái phê duyệt94/94. Candidate SQLite/PGlite52/52 + PG thật27/27.

Xuyên Sprint23/23: tuyển thành công, PAUSED freeze, CANCELLED snapshot/quota, revision effective data/final apply/unpublish, NEEDS_INFO/gửi thay, scope/transfer/IDOR/self-approval, lifecycle race/rollback, query counts. PG6 clients/PIDs độc lập, UTC, không unhandled rejection hoặc leak. S3-10 stress8×10=80 requests; quota/approve-vs-pause8×2=16 requests.

**Local1807 PASS,0 FAIL,0 SKIP,0 NOT RUN — lượt case suite báo cáo.** Có56 trùng Sprint1 aggregate, còn overlap providers/suites; không gọi1807 là case độc lập. Reruns không cộng thêm. Benchmark observations, Neon20 và syntax151 báo riêng.

## Đối chiếu Sprint

Descriptions lấy từ backlog/audit; kết quả suite là lượt mới, không dùng status cũ.

| Story | Số AC | Đối chiếu |
|---|---:|---|
| S1-01 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-02 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-03 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-04 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-05 | 4 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-06 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-07 | 2 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-08 | 4 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-09 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S1-10 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-01 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-02 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-03 | 2 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-04 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-05 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-06 | 4 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-07 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-08 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-09 | 2 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S2-10 | 4 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-01 | 4 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-02 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-03 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-04 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-05 | 2 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-06 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-07 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-08 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-09 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |
| S3-10 | 3 | Suite được chạy lại PASS; manual/external/deferred giữ riêng |

Không tự đổi external/manual/deferred thành PASS: email/activation delivery thật; visual/mobile/brand signoff; S2-05 future Offer; S2-06 Sprint6 sheet. Browser responsive390 đã kiểm chứng, không đồng nghĩa ký tất cả visual360px/email-client/inbox acceptance.

## Neon

Sau regression PASS: migration001–008 checksum verify; schema/FK/grants; read-only repeatable-read fingerprint52 bảng; transaction smoke rollback. Không migration mới, seed/import hoặc overwrite business data.

Smoke **14/14**, gồm sáu user fixture chỉ3 SQL; startup/schema/grants/API **6/6**. Fixtures sau rollback0; counts/fingerprints52/52 giống trước; flags OFF không đổi. Không login production hoặc stress Neon. Fingerprint row data không gồm sequence counters.

pg SSL-mode và npm transitive deprecation warnings ghi nhận, không gây failure; không đổi URI/credential hoặc dependency cũ ngoài task.

## Static và an toàn

node --check **151/151**, git diff --check **PASS**. Không thêm comment source/test. Bảo toàn working tree; bốn SQLite runtime và15 migration SQL không đổi byte.

| File bảo vệ | SHA-256 trước | SHA-256 sau |
|---|---|---|
| backend/src/db/migrations/005_requisition_operations_sqlite.sql | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf |
| backend/data/ats_test.db | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a |
| backend/src/db/migrations/006_requisition_lifecycle_postgres.sql | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b |
| backend/data/ats.db-shm | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a |
| backend/src/db/migrations/003_requisition_approvals_sqlite.sql | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 |
| backend/src/db/migrations/004_headcount_budgets_sqlite.sql | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 |
| backend/src/db/migrations/003_requisition_approvals_postgres.sql | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 |
| backend/src/db/migrations/008_job_publication_sqlite.sql | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 |
| backend/src/db/migrations/008_job_publication_postgres.sql | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 |
| backend/data/ats.db-wal | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 |
| backend/src/db/migrations/004_headcount_budgets_postgres.sql | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 |
| backend/data/ats.db | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc |
| backend/src/db/migrations/002_approval_configurations_postgres.sql | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 |
| backend/src/db/migrations/002_approval_configurations_sqlite.sql | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 |
| backend/src/db/migrations/005_requisition_operations_postgres.sql | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c |
| backend/src/db/migrations/001_postgres.sql | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b |
| backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 |

## Chạy Browser từ workspace

```powershell
npm ci
npx playwright install chromium
npm run test:browser-e2e
```

Runner tạo source/SQLite mới ở TEMP, bỏ .env/runtime DB, install offline từ cache, SMTP simulated; artifacts ở TEMP và in đường dẫn. ATS_E2E_ARTIFACTS cho thư mục bằng chứng riêng. Gỡ DB/SMTP/OAuth inherited, không dùng DATABASE_URL production. Các backend suites khác giữ convention source copy cách ly hiện có.

```powershell
npx playwright show-trace docs/evidence/ATS-readiness-2026-10-09-browser/trace-HR_MANAGER.zip
```

## Điều kiện nghiệm thu

N+1 đã sửa, Browser thật đã chạy, flags ON/OFF và regression đều PASS. Không còn implementation failure thuộc vấn đề audit được giao. Có cơ sở bắt đầu nghiệm thu với người dùng.

Chưa tự kích hoạt flags production, triển khai hoặc ký nghiệm thu thay người dùng. External/manual/deferred kể trên cần xác nhận riêng. Không commit/push.

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
 M frontend/index.html
 M frontend/js/api.js
 M frontend/js/components/requisition-approval.js
 M frontend/js/components/requisition-detail.js
 M frontend/js/components/requisition-form.js
 M frontend/js/pages/dashboard.js
 M frontend/js/pages/requisitions.js
 M frontend/js/shared/route-lifecycle.js
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
?? backend/tests/run_browser_e2e.js
?? backend/tests/test_browser_e2e.js
?? backend/tests/test_candidate_stage.js
?? backend/tests/test_s3_07.js
?? backend/tests/test_s3_08_09.js
?? backend/tests/test_s3_10.js
?? backend/tests/test_s3_10_pg_live.js
?? backend/tests/test_user_list_batch.js
?? docs/ATS-audit-fixes-2026-10-09.md
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

Status gồm thay đổi có sẵn, không chỉ task này. Diff stat tracked toàn working tree:

```text
backend/data/ats.db                                | Bin 880640 -> 1064960 bytes
 backend/data/ats.db-shm                            | Bin 32768 -> 32768 bytes
 backend/data/ats.db-wal                            | Bin 519152 -> 4120032 bytes
 backend/data/ats_test.db                           | Bin 520192 -> 679936 bytes
 backend/src/config/config.js                       |   4 +
 backend/src/db/sync-permissions.js                 |  21 ++-
 backend/src/server.js                              |  11 +-
 backend/src/services/headcountBudgetService.js     |   5 +-
 backend/src/services/recruitmentCatalogService.js  |   5 +-
 backend/src/services/requisitionApprovalService.js |  14 +-
 backend/src/services/requisitionService.js         |  45 ++++--
 backend/src/services/userService.js                |  31 ++--
 backend/tests/test_s1_frontend_fixes.js            |  34 +++-
 docs/ATS-E2E-2026-10-08.md                         | 180 +++++++++++++++++++++
 docs/RBAC-admin-permissions.md                     |  23 +++
 frontend/components/create-req-modal.html          |   2 +
 frontend/components/requisition-detail-modal.html  |   2 +
 frontend/index.html                                |   2 +
 frontend/js/api.js                                 |   8 +-
 frontend/js/components/requisition-approval.js     |   4 +-
 frontend/js/components/requisition-detail.js       |   6 +-
 frontend/js/components/requisition-form.js         |   4 +
 frontend/js/pages/dashboard.js                     |   2 +-
 frontend/js/pages/requisitions.js                  |  46 ++++--
 frontend/js/shared/route-lifecycle.js              |   7 +
 frontend/pages/requisitions.html                   |   9 ++
 frontend/routes.json                               |  13 +-
 package-lock.json                                  |  32 +++-
 package.json                                       |  17 +-
 29 files changed, 457 insertions(+), 70 deletions(-)
```
