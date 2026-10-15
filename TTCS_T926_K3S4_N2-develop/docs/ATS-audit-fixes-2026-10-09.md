# Khắc phục audit Sprint 1–3 — 09/10/2026

Kết luận: **AUTOMATED REGRESSION PASS — CHƯA HOÀN TẤT NGHIỆM THU E2E**.

Đã xử lý hai vấn đề được cho phép: Candidate stage thiếu validation và fixture S1 frontend trái chính sách ADMIN. Không triển khai Sprint 4, không tối ưu UserService, không chỉnh sửa Candidate có sẵn. Không có FAIL trong các lượt kiểm thử cuối; Browser E2E vẫn NOT RUN.

## Trạng thái và phạm vi

Branch: feature/s2-bulk-user-import. HEAD: d962ef3a9da49d42b595dba85ca3daa3404454db. Hai giá trị giữ nguyên trước/sau. Working tree ban đầu có thay đổi chưa commit S3-07/08/09/10, bốn SQLite runtime và migration nền; không reset, restore, clean, stash hoặc ghi đè chúng.

[Diff riêng lượt này](evidence/ATS-audit-fixes-2026-10-09.patch) đối chiếu với bản sao trước sửa đã xác minh SHA-256, tránh gộp thay đổi S3 có sẵn vào bản sửa audit. [Bằng chứng máy đọc được](evidence/ATS-audit-fixes-2026-10-09.json) lưu tên ca, lệnh, exit code, hash log, kết quả xuyên Sprint, PostgreSQL, Neon và hash bảo vệ.

## Candidate stage

Root cause: createCandidate nhận data.stage hoặc NEW và insert mà không kiểm tra enum; updateCandidateStage có một danh mục riêng. Schema SQLite/PostgreSQL dùng TEXT, không có CHECK enum. Audit trước chứng minh HTTP201 và lưu INVALID_STAGE_AUDIT, khiến S3-07 coi đây là hồ sơ pipeline tồn đọng.

Sửa production duy nhất tại backend/src/services/requisitionService.js: một danh mục đóng băng gồm NEW, APPLIED, SCREENING, INTERVIEW, OFFER, HIRED, REJECTED; helper validateCandidateStage dùng chung cho create/update. Create kiểm tra trước transaction/insert và trước cơ chế self-service chuyển stage thành NEW. Stage không hợp lệ trả HTTP400, INVALID_CANDIDATE_STAGE, “Giai đoạn không hợp lệ.” Update dùng cùng mã/message. Không đổi RBAC, scope, danh mục stage hoặc trạng thái pipeline hợp lệ.

Giữ tương thích mặc định create: thiếu stage/null/chuỗi rỗng/false/0 vẫn NEW theo biểu thức có sẵn. Update không có mặc định: những giá trị đó vẫn bị từ chối. Chuỗi sai casing, khoảng trắng, newline, số khác 0, true, mảng và object bị từ chối; không tự trim/coerce thành stage hợp lệ.

Test mới backend/tests/test_candidate_stage.js: **79/79 lượt**, gồm SQLite27, PGlite25, PostgreSQL thật27. Mỗi nhóm stage hợp lệ kiểm tra create và cập nhật qua đủ bảy stage. Ca invalid kiểm tra HTTP400/code, tổng số bản ghi mọi bảng không đổi, stage/notes không đổi, danh sách outstanding S3-07 không đổi; không phát sinh dữ liệu phụ hoặc audit thành công. Có kiểm tra self-service không thể làm stage sai thành hợp lệ bằng override NEW. SQLite và PostgreSQL thật đều chạy HTTP create/update. Không thêm migration, không sửa/xóa Candidate production. Read-only Neon phát hiện **0** bản ghi ngoài enum; không sửa dữ liệu.

## Fixture RBAC

Audit trước: backend/tests/test_s1_frontend_fixes.js xóa grant user.read của ADMIN rồi kỳ vọng 403:16/17. Chính sách trung tâm cho ADMIN toàn quyền RBAC, nên HTTP200 là đúng. Đây là xung đột fixture, không phải lỗi UI 403.

Chỉ thay ca đó: thêm positive ADMIN mất grant vẫn HTTP200, frontend tải thành công; dùng HR_MANAGER cho negative mất grant HTTP403. Vẫn giữ assertion thông báo tiếng Việt, hết loading, không stale user rows, nút phân trang disabled, không lỗi runtime; khôi phục grant bằng finally. Không sửa các assertion không liên quan. Sau sửa **18/18 PASS**.

Thông báo kiểm tra thực tế: “Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: user.read).”

RBAC47/47, S3-02 và S3-10 tiếp tục kiểm tra ADMIN không vượt qua cấm tự duyệt, phân công bước, role thu hồi, tài khoản khóa/bắt buộc đổi mật khẩu và quy tắc dải lương HR-only. Không thay đổi production RBAC để làm test xanh.

## N+1 User list

Đo lại trên SQLite cách ly: limit1/1 dòng = **3 SQL**; limit20/20 dòng = **22 SQL**, SELECT roles lặp20 lần. Tái xác nhận audit trước. Không sửa/refactor UserService. Đây là số SQL dịch vụ cục bộ, không phải thời gian mạng Neon hoặc Browser. Requisition list vẫn6 SQL cho1 và12 dòng, public list3 SQL, kiểm tra trên SQLite/PostgreSQL thật.

## Môi trường

Suite chạy từ bản sao mới không có .git, .env hoặc database runtime; dependency cài offline. Biến DB/SMTP/OAuth/flag inherited được gỡ; SQLite test, email simulated, flag chỉ bật trong tiến trình kiểm thử. Không gửi email thật.

Ổ A: gần hết dung lượng; lần tạo cluster thử bị “No space left on device”. Cluster thử mới đó đã dừng và giữ lại, không xóa file. Dùng môi trường cách ly trên C: còn đủ dung lượng. PostgreSQL thật17.10, bind127.0.0.1:53476, bốn database thử mới; không dùng Neon cho destructive/regression test. Các cluster thử đã dừng, dữ liệu/bằng chứng được giữ lại. Không tác động dịch vụ PostgreSQL cũ.

Hai lỗi setup test ban đầu cũng lưu trong bằng chứng: helper S3-10 xóa biến URL test nên test mới phải capture trước import; một lần chạy lại SQLite trên bản sao đã có DB bị guard từ chối. Đã sửa setup và chạy trên bản sao mới. Các exit1 này được ghi riêng, không gọi là PASS, không cộng vào số ca nghiệp vụ cuối.

## Regression mới chạy

Mọi hàng là lượt mới, không lấy kết quả audit cũ. Candidate stage dùng lượt cuối thay thế lượt sớm cùng test trong tổng số để tránh cộng trùng rerun.

| Lệnh | Kết quả | Exit code |
|---|---|---|
| npm run test:sprint1 | 56/56 PASS | 0 |
| node backend/tests/test_candidate_stage.js | 52/52 PASS | 0 |
| npm run test:s1-frontend-fixes | 18/18 PASS | 0 |
| npm run test:final-rbac-open | 33/33 PASS | 0 |
| npm run test:requisition-access | 16/16 PASS | 0 |
| npm run test:ats-e2e | 51/51 PASS | 0 |
| npm run test:rbac | 47/47 PASS | 0 |
| npm run test:s3-02 | 93/93 PASS | 0 |
| npm run test:s3-01 | 108/108 PASS | 0 |
| npm run test:postgres | 15/15 PASS | 0 |
| npm run test:review-updates | 22/22 PASS | 0 |
| npm run test:s1-01 | 8/8 PASS | 0 |
| npm run test:s1-02 | 5/5 PASS | 0 |
| npm run test:s1-03 | 5/5 PASS | 0 |
| npm run test:s1-03:email | 49/49 PASS | 0 |
| npm run test:s1-04 | 5/5 PASS | 0 |
| npm run test:s1-05 | 6/6 PASS | 0 |
| npm run test:s1-06 | 3/3 PASS | 0 |
| npm run test:s1-07 | 4/4 PASS | 0 |
| npm run test:s1-08 | 5/5 PASS | 0 |
| npm run test:s1-09 | 7/7 PASS | 0 |
| npm run test:s1-10 | 8/8 PASS | 0 |
| npm run test:otp | 8/8 PASS | 0 |
| npm run test:sprint2 | 32/32 PASS | 0 |
| npm run test:s2-10 | 59/59 PASS | 0 |
| npm run test:routing | 187/187 PASS | 0 |
| npm run test:user-ux | 87/87 PASS | 0 |
| npm run test:datetime-dashboard | 28/28 PASS | 0 |
| npm run test:avatar | 21/21 PASS | 0 |
| npm run test:mobile-shell | 53/53 PASS | 0 |
| npm run test:layout | 45/45 PASS | 0 |
| npm run test:coverage:sprint1 | 23/23 PASS | 0 |
| npm run test:coverage:sprint2 | 25/25 PASS | 0 |
| npm run test:career-upload | 24/24 PASS | 0 |
| npm run test:user-roles-avatar | 17/17 PASS | 0 |
| npm run test:reapproval | 94/94 PASS | 0 |
| npm run test:s3-03 | 29/29 PASS | 0 |
| npm run test:s3-04 | 55/55 PASS | 0 |
| npm run test:s3-05 | 36/36 PASS | 0 |
| npm run test:s3-06 | 46/46 PASS | 0 |
| npm run test:s3-07 | 51/51 PASS | 0 |
| npm run test:s3-08 | 27/27 PASS | 0 |
| npm run test:s3-09 | 41/41 PASS | 0 |
| npm run test:s3-10 | 53/53 PASS | 0 |
| node backend/tests/test_postgres_startup.js | 11/11 PASS | 0 |

### PostgreSQL thật và xuyên Sprint

| Lệnh | Kết quả | Exit code |
|---|---|---|
| node backend/tests/test_postgres_live.js | 3/3 PASS | 0 |
| node backend/tests/test_s3_10_pg_live.js | 32/32 PASS | 0 |
| node backend/tests/test_candidate_stage.js --postgres-only | 27/27 PASS | 0 |
| node scratch:integration.cjs | 23/23 PASS | 0 |
| node scratch:pg-concurrency-extra.cjs | 2/2 PASS | 0 |

Các lệnh scratch dùng wrapper gỡ cấu hình inherited, đường dẫn bản sao riêng và URL localhost thử nghiệm; không đưa credential Neon vào bằng chứng. Lệnh Candidate PostgreSQL kèm --postgres-only. Dữ liệu fixture đều thuộc database mới.

S3-01..10: **539/539**. Sprint1 individual **10/10 suite,56/56**, aggregate56/56, coverage23/23. Sprint2 common32/32, coverage25/25, S2-10 59/59. Tái phê duyệt94/94. Các suite routing187, session/heartbeat, user/avatar, email security, review updates và PostgreSQL embedded đều chạy theo bảng.

Xuyên Sprint **23/23**,12 định nghĩa kịch bản:

- A: Tuyển thành công, nhiều cấp duyệt, quota, phân công, Job Posting, independent HR review, public, hai HIRED và CLOSED giữ quota.
- B: PAUSED ẩn tin, chặn ứng tuyển mới, đóng băng decision/revision và giữ reservation.
- C: Huỷ bị chặn khi workflow/pipeline còn tồn đọng; xử lý hợp lệ rồi snapshot HIRED, giữ phần đã tuyển và giải phóng phần chưa tuyển.
- D: Revision giữ effective main/old public ad; final approve mới apply và unpublish; NEEDS_INFO và HR/ADMIN gửi thay ghi lý do, bắt đầu cấp1.
- E: Candidate/recruiter scope, chuyển giao thu hồi quyền, IDOR và cấm tự duyệt.
- F: Lifecycle race, rollback audit, stage invalid không ghi dữ liệu, query counts ổn định.

Có6 kết nối PostgreSQL với6 backend PID khác nhau, timezone UTC, không unhandled rejection; pool hết checked-out client và đóng về0. PostgreSQL S3-10 parity24/24, stress8/8 (80 requests,10 concurrent/batch). Race ngân sách và final approval/PAUSED2/2 (8 batches,16 requests).

**Tổng local cuối:1755 PASS,0 FAIL /1755 lượt ca thực thi.** Có56 lượt trùng đã biết từ Sprint1 aggregate; bỏ phần đó còn1699 lượt, vẫn **không gọi là1699 test case độc lập**, vì còn giao nhau giữa suite/provider. Rerun mục tiêu không cộng thêm. Neon19 và syntax148 báo riêng. Không suy diễn số case thành phần trăm code coverage.

## Browser E2E

**NOT RUN.** Discovery thực tế: “No browser is available”, danh sách browser rỗng. Dependency bản sao không có Playwright, @playwright/test hoặc Puppeteer. Không có screenshot/browser assertion. API/frontend runtime51/51 và routing187/187 không thay thế Browser E2E.

Cần browser khả dụng để kiểm chứng đăng nhập → Requisition → approval → recruiter assignment → Job Posting → HR độc lập duyệt → publish → public desktop/mobile → đóng/gỡ tin; kiểm tra preview/public, loading/error/validation, console/network trên môi trường cách ly. Chưa nghiệm thu Browser chính thức.

## Neon

Chỉ sau khi local regression PASS, kiểm tra ats_staging bằng cấu hình hiện có, không xuất credential. Migration001–008 checksum verify PASS, không áp dụng migration mới. Read-only repeatable-read kiểm tra52 bảng, FK đã validated và fingerprint trước/sau. Rollback smoke **13/13**, fixtures sau rollback0. Startup/HTTP/schema/grants **6/6**. Không seed/import/login production hoặc cập nhật business rows.

Fingerprint/count **52/52 bảng trước/sau giống nhau**. Production flags đều OFF và giữ nguyên. Timestamp/immutable guards/grants kiểm tra thực tế; private API anonymous401, public missing404, frontend shell200. Startup không lỗi migration/connection. Smoke write trong transaction rollback, không phải load test production. Hash hàng không bao gồm sequence counters PostgreSQL; không có production login tạo audit sequence.

Có cảnh báo SSL mode từ pg trong stderr Neon; không gây failure. Không đổi URI/SSL/credential. Live multi-connection stress chạy local, không chạy Neon.

## Static và bảo vệ dữ liệu

node --check **148/148 PASS**. git diff --check **PASS**. Không thêm comment vào source/test. Mười chín file bảo vệ không đổi byte: bốn DB runtime và15 migration SQL001–008. File001 vốn modified trước task vẫn nguyên trạng, không restore.

| File bảo vệ | SHA-256 trước | SHA-256 sau |
|---|---|---|
| backend/src/db/migrations/004_headcount_budgets_postgres.sql | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 |
| backend/src/db/migrations/001_postgres.sql | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b |
| backend/src/db/migrations/006_requisition_lifecycle_postgres.sql | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a |
| backend/data/ats_test.db | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a |
| backend/src/db/migrations/003_requisition_approvals_postgres.sql | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc |
| backend/src/db/migrations/002_approval_configurations_sqlite.sql | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 |
| backend/src/db/migrations/002_approval_configurations_postgres.sql | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 |
| backend/data/ats.db-shm | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 |
| backend/src/db/migrations/008_job_publication_sqlite.sql | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 |
| backend/src/db/migrations/003_requisition_approvals_sqlite.sql | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 |
| backend/src/db/migrations/005_requisition_operations_postgres.sql | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c |
| backend/src/db/migrations/008_job_publication_postgres.sql | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 |
| backend/data/ats.db-wal | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 |
| backend/data/ats.db | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df |
| backend/src/db/migrations/005_requisition_operations_sqlite.sql | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf |
| backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 |
| backend/src/db/migrations/004_headcount_budgets_sqlite.sql | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 |

## File thay đổi riêng lượt này

- backend/src/services/requisitionService.js: shared enum/validation stage, HTTP400 business code.
- backend/tests/test_s1_frontend_fixes.js: fixture ADMIN/HR_MANAGER,18 cases.
- backend/tests/test_candidate_stage.js: mới, SQLite/PGlite/realPG stage/API/pipeline regression.
- package.json: đăng ký test:candidate-stage và test:s1-frontend-fixes, không thêm dependency.
- docs/ATS-audit-fixes-2026-10-09.md: báo cáo này.
- docs/evidence/ATS-audit-fixes-2026-10-09.json: bằng chứng máy đọc được.
- docs/evidence/ATS-audit-fixes-2026-10-09.patch: diff riêng ba file đã tồn tại và toàn bộ test mới.

Các thay đổi S3 có sẵn được bảo toàn. Báo cáo audit gốc không viết lại để che FAIL trước sửa. Không git add/commit/push/merge/rebase/reset/restore/clean/stash, không đổi branch/HEAD.

## Điều kiện nghiệm thu và kiểm tra thủ công

Hai vấn đề được phép đã sửa và test lại PASS. N+1 giữ ngoài phạm vi. Không phát hiện regression mới từ bản sửa trong các suite/kịch bản đã chạy. Chưa thể kết luận nghiệm thu toàn bộ Sprint1–3 vì Browser E2E chưa chạy; email thật, visual/mobile, S2-05 Offer tương lai và S2-06 Sprint6 còn external/manual/deferred theo backlog.

Trên bản sao SQLite cách ly, email simulated, feature flags chỉ trong tiến trình test: ADMIN mất explicit user.read vẫn mở Users; HR_MANAGER mất grant hiển thị thông báo403 và hết loading. Dùng recruiter được phân công thử create/update stage hợp lệ; gửi stage không hợp lệ bằng API phải400/INVALID_CANDIDATE_STAGE và pipeline không thêm dòng. ADMIN vẫn không được tự duyệt Requisition/tin. Không thử thu hồi grant trên dữ liệu production để chạy manual test.

## Git status cuối

```text
M backend/data/ats.db
 M backend/data/ats.db-shm
 M backend/data/ats.db-wal
 M backend/data/ats_test.db
 M backend/src/config/config.js
 M backend/src/db/migrations/001_postgres.sql
 M backend/src/db/sync-permissions.js
 M backend/src/server.js
 M backend/src/services/headcountBudgetService.js
 M backend/src/services/recruitmentCatalogService.js
 M backend/src/services/requisitionApprovalService.js
 M backend/src/services/requisitionService.js
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
?? backend/tests/test_candidate_stage.js
?? backend/tests/test_s3_07.js
?? backend/tests/test_s3_08_09.js
?? backend/tests/test_s3_10.js
?? backend/tests/test_s3_10_pg_live.js
?? docs/ATS-audit-fixes-2026-10-09.md
?? docs/ATS-full-audit-2026-10-09.md
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

Toàn bộ status chứa thay đổi có sẵn, không chỉ file sửa audit. Diff stat tracked tổng working tree:

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
 package.json                                       |  12 +-
 27 files changed, 401 insertions(+), 58 deletions(-)
```
