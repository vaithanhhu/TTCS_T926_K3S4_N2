# S3-08 / S3-09 — Theo dõi Requisition và soạn bản nháp tin tuyển dụng

Ngày: 2026-10-09. Branch: feature/s2-bulk-user-import. HEAD: d962ef3a9da49d42b595dba85ca3daa3404454db. Không stage/commit/push/merge/rebase/PR.

## Pre-check và bảo toàn S3-07

Working tree đầu lượt còn toàn bộ thay đổi S3-07 chưa commit, bốn SQLite runtime modified và migration 001 modified từ trước. Đã snapshot source, status và SHA-256; baseline chạy trên frozen TEMP source copy, không .git/.env/runtime DB, npm ci offline, EMAIL_MODE=simulated.

Baseline thực tế: Sprint 1 aggregate 56/56, Sprint 2 common 32/32, S2-10 59/59, S3-05 36/36, S3-06 46/46, S3-07 51/51. Không có sai khác nghiêm trọng giữa báo cáo S3-07 và source. Không sửa test cũ hoặc SQL 001–006. Không thay thế engine approval/revision/assignment/budget.

## Quyết định S3-08

- Phòng ban theo departmentId; recruiter lọc cả primary và supports S3-06, không cộng trùng một yêu cầu. Các điều kiện kết hợp AND với search, trạng thái và handover hiện có; luôn áp dụng scope backend.
- Khoảng thời gian là **ngày tạo** (createdAt); giao diện ghi rõ Ngày tạo từ/đến. Hai đầu inclusive theo ngày Việt Nam, UTC+7; SQL dùng bound timestamp với offset +07:00 và một ngày 24 giờ. Không lấy neededDate làm trường lọc này.
- Số ngày mở là số ngày lịch từ lần đầu OPEN đến ngày nghiệp vụ hiện tại. Không tính giờ lẻ hoặc làm tròn 24 giờ đã trôi qua. Timezone Asia/Ho_Chi_Minh, một timestamp tính toán cho toàn response.
- opened_at được chụp khi insert OPEN hoặc chuyển DRAFT sang OPEN; cập nhật ghi chú/assignment không đặt lại ngày mở. Migration không backfill hồ sơ cũ.
- Legacy không có opened_at dùng ngày tạo làm proxy, trả daysOpenEstimated=true và UI có dấu ~. CLOSED/CANCELLED dùng event kết thúc S3-07 để đóng băng số ngày; nếu thiếu event legacy thì dùng updatedAt và đánh dấu ước tính. Không gọi proxy là thời gian mở chính xác.
- DRAFT hiển thị Chưa mở. PAUSED vẫn hiển thị ngày lịch đã trôi qua nhưng không có badge trễ hạn đang tuyển. CLOSED/CANCELLED không được tô trễ hạn. Chỉ OPEN/IN_PROGRESS có neededDate trước hôm nay được đánh dấu; hôm nay còn 0 ngày và không trễ. Không thay đổi trạng thái vì trễ hạn.
- API cũ vốn không có pagination. Không có page/limit vẫn trả toàn bộ kết quả, tên fields và thứ tự handover DESC/createdAt DESC giữ nguyên. Khi bật tracking, pagination là tùy chọn (limit 1–100); UI dùng 20/trang, reset trang khi đổi bộ lọc, clamp khi dữ liệu giảm. Tie ổn định theo ID.
- Xuất CSV vẫn xuất toàn bộ kết quả của bộ lọc hiện hành, không chỉ trang đang xem. Test chạy formatter CSV thật, kiểm tra 21 records + header và UTF-8 BOM; chỉ intercept browser Blob/download boundary.
- SQL join recruiter/manager/lifecycle, một bulk query supports cho toàn page. Không truy vấn recruiter/phòng ban theo từng dòng. Test so số lần prepare giữa ít/nhiều dòng, không dùng assertion source string làm bằng chứng N+1.

## Quyết định S3-09

Dùng job_postings/service public/hide từ S3-07; không tạo bảng posting thứ hai. Tạo và sửa chỉ DRAFT, không tự publish hoặc mở lại UNPUBLISHED/PAUSED.

Điều kiện nguồn: Req OPEN/IN_PROGRESS; workflow hiện tại APPROVED; có quyết định cuối APPROVE của current submission; document đã duyệt phải khớp nội dung đang có hiệu lực, gồm appliedRevision hash khi có. Một cờ APPROVED bị sửa trực tiếp mà không có quyết định không đủ điều kiện. Không thêm APPROVED vào requisitions.status.

Theo AC chỉ APPROVED, khi có revision PENDING sẽ chặn tạo/lưu draft cho đến khi xử lý xong; không lấy revision chưa duyệt. Bản nháp đã có vẫn lưu nguyên dữ liệu. Sau khi revision được duyệt, UI cho biết source đã đổi; save yêu cầu currentSourceHash mới. Nội dung tin độc lập, không tự ghi đè JD đang biên tập bằng JD source mới; price chỉ lấy proposedSalaryMin/Max đang có hiệu lực đã duyệt.

JD và candidateRequirements kế thừa nguyên nội dung (Unicode, khoảng trắng, newline), sau đó chỉnh sửa độc lập. Không sao chép approval events/steps/history, recruiter assignments, candidate, budget hoặc dữ liệu nhạy cảm. source_submission_id/hash chỉ là reference xuất xứ, không tạo vòng duyệt cho tin.

Các trường: title, JD, candidateRequirements, workLocationId, workModeId, applicationDeadline, showSalary. Địa điểm/hình thức dùng catalog WORK_LOCATION/WORK_MODE đang ACTIVE; không tạo enum công việc khác. Các trường bắt buộc phải hợp lệ khi lưu nháp; deadline không quá khứ theo ngày Việt Nam. Trường catalog của bản tin được tính vào protection xóa danh mục S2-08.

showSalary mặc định false. Khi bật chỉ chụp proposedSalaryMin/Max của main đã duyệt (VND/người/tháng), không lấy standard salary range. Khi tắt, hai salary snapshot được đặt NULL và DTO public không có salaryMin/Max. Public payload whitelist cũng không có standard range, creator, approval document hoặc nội dung nội bộ. Public read chỉ mở theo nền tảng S3-07; không có API/UI publish S3-10.

Source và posting ID đều kiểm tra backend, cần requisition.read ngoài quyền module. HR_MANAGER/ADMIN được quản lý theo quyền hiện hành; RECRUITER chỉ primary/support đang được phân công. HIRING_MGR/APPROVER đọc theo scope, không soạn; INTERVIEWER/CANDIDATE không đọc draft nội bộ. CANDIDATE vẫn đọc tin công khai theo API public. Thu hồi role, source-read hoặc assignment có hiệu lực ở request tiếp theo.

Mọi create/update dùng transaction, parent lock, posting lock khi sửa, expectedVersion, expectedSourceHash, requestId và receipt append-only. Cùng requestId/payload trả kết quả cũ; payload khác bị từ chối; race update chỉ một version thắng. Receipt failure rollback insert/update. Không cập nhật Req/approval/budget khi lưu tin. UI có validation/loading/error/empty, chống submit lặp và response cũ sau navigation/logout.

## Acceptance Criteria

| Story / AC | Automated | Bằng chứng |
|---|---|---|
| S3-08 AC1: bộ lọc | PASS | Từng tiêu chí, AND, primary/support, range inclusive, scope nhiều role, paging/sort |
| S3-08 AC2: ngày mở/còn lại | PASS | Clock insert/promotion, legacy không bị ghi hồi tố, ngày nhuận/UTC boundary, today, closed/pause |
| S3-08 AC3: nổi bật trễ hạn | PASS | Chỉ OPEN/IP quá neededDate, không mutate state, runtime render badge/ngày và bộ lọc |
| S3-09 AC1: kế thừa/sửa JD | PASS | Copy exact, readback độc lập, source/history/budget giữ nguyên, runtime form-save |
| S3-09 AC2: location/mode/deadline/salary choice | PASS | Persisted fields, catalog/date/type validation, hidden public salary, UTF-8 UI |
| S3-09 AC3: chỉ nguồn đã duyệt | PASS | Final decision/document proof, pending/paused/closed/cancelled denial, scope/permission/assignment |

Manual visual/desktop/mobile acceptance: chưa xác minh bằng browser thật. Browser E2E NOT RUN vì discovery không có browser kết nối. DOM runtime dùng HTTP/backend và data thật trong DB cách ly; không coi đây là screenshot/visual PASS. PostgreSQL embedded dùng PGlite; pool harness tuần tự hóa transaction, chưa chạy stress nhiều connection độc lập.

## Migration và API

Migration 007_requisition_tracking_job_drafts_sqlite.sql/postgres.sql bổ sung opened_at, các cột Job Posting, job_posting_draft_requests, FK/index/clock trigger/receipt guards. application_deadline DATE; opened_at TIMESTAMPTZ trên PostgreSQL; show_salary BOOLEAN; salary NUMERIC. SQLite dùng TEXT/INTEGER/REAL tương thích. Không sửa 001–006, không seed/import staging, không DML backfill Requisition cũ.

- GET /api/v1/requisitions: thêm departmentId, recruiterId, createdFrom, createdTo, page, limit khi tracking bật; field cũ giữ nguyên, bổ sung metrics/supportRecruiters/pagination.
- GET /api/v1/requisition-tracking/options: lựa chọn chỉ từ dataset trong scope, scope recruiter PRIMARY_OR_SUPPORT, timeField createdAt.
- GET /api/v1/job-posting-drafts/requisitions/:reqId: source/capabilities/catalog/list draft.
- POST cùng path: tạo DRAFT, requestId + expectedSourceHash, nội dung form.
- GET /api/v1/job-posting-drafts/:postId: đọc theo scope, currentSourceHash/canEdit.
- PUT cùng path: sửa DRAFT, expectedVersion + requestId + expectedSourceHash.
- Không có DELETE/history edit/publish endpoint mới. Sai quyền 401/403, không tồn tại 404, validation 400, stale/business-state 409; không trả SQL/stack/secret.

Permission mới job_posting.read: HR_MANAGER, RECRUITER, HIRING_MGR, APPROVER. job_posting.manage: HR_MANAGER, RECRUITER. ADMIN toàn quyền RBAC tập trung nhưng chịu mọi điều kiện nghiệp vụ. Seed/sync thêm idempotent grant; migration chỉ sync quyền module mới, không chạy seed dữ liệu.

Flags REQUISITION_TRACKING_ENABLED và JOB_POSTING_DRAFTS_ENABLED mặc định OFF, .env không sửa. Startup chỉ verify migration 007 khi bật, không tự migrate. Để dùng đủ model primary/support và public lifecycle, chạy cùng các flags Sprint 3 đã triển khai và migration 002–007. Lượt này chỉ bật flags trong tiến trình test/smoke, không tự thay cấu hình server developer đang chạy.

## Lỗi phát hiện trong lượt triển khai

- Assertion static asset Routing phát hiện file job-posting-drafts.js có BOM UTF-8 do ghi file trên Windows. Đã bỏ BOM trong file source mới, không đổi assertion. Tôi đã thông báo tổng regression PASS quá sớm trước khi đối chiếu failure này; migration 007 đã được áp dụng trong lượt đó và smoke/schema đều hợp lệ. Đã chạy lại regression đầy đủ để có kết luận cuối. Không rollback/drop schema vì không có lỗi schema/data.
- Test mới ban đầu dùng sai create configuration thay vì newVersion, selector không tương thích DOM harness và kiểm tra query ở path thay vì search. Đã sửa setup/adapter trong test mới, không sửa test cũ hoặc expected nghiệp vụ. Bổ sung serialization textContent và removeChild đúng DOM tại harness cục bộ của suite mới; không mock API, service hoặc DB readback.

## Hướng dẫn kiểm thử thủ công

1. Sau review source, restart tiến trình với REQUISITION_TRACKING_ENABLED=true, JOB_POSTING_DRAFTS_ENABLED=true và các flags S3-01/S3-02/S3-04/S3-05-06/S3-07 phù hợp. Migration 007 đã chuẩn bị và verified; không seed/import database có dữ liệu.
2. HR Manager vào Yêu cầu & Vị trí: thử AND trạng thái/phòng ban/recruiter chính-hoặc-hỗ-trợ/ngày tạo, search, trang 1/2, empty/error. Kiểm tra today 0 ngày, past badge, PAUSED/CLOSED/CANCELLED không bị đánh dấu như đang tuyển trễ. Hồ sơ legacy có ~.
3. Mở Chi tiết Req đã APPROVED và đang tuyển: Soạn tin mới, kiểm tra JD, chọn catalog/deadline và showSalary, lưu nháp; sửa JD. Req gốc phải giữ nguyên và tin không công khai.
4. Recruiter main/support làm được; người bị gỡ assignment, Hiring hoặc source không đủ điều kiện nhận lỗi. Kiểm tra trực tiếp API với ID ngoài scope trong DB test.
5. Tạo revision PENDING: chặn soạn/lưu ad, không lấy JD/lương pending. Sau final approve, refresh source, kiểm tra warning/hash mới khi lưu draft.
6. Không có nút publish trong S3-09. Kiểm tra gỡ tin/hidden salary bằng fixture public của môi trường test; không sửa dữ liệu nghiệp vụ thật để thử publish. Kiểm tra visual desktop/mobile thật vẫn cần làm thủ công.

## Kết quả thực thi

Bảng suite, Neon, protected hashes và Git status cuối được bổ sung từ log, không từ baseline tham chiếu.


## Kết quả cuối S3-08/S3-09 — 2026-10-09

| Suite | Status | Cases |
|---|---|---|
| test:sprint1 | PASS | 56/56 |
| test:final-rbac-open | PASS | 33/33 |
| test:requisition-access | PASS | 16/16 |
| test:ats-e2e | PASS | 51/51 |
| test:rbac | PASS | 47/47 |
| test:s3-02 | PASS | 93/93 |
| test:s3-01 | PASS | 108/108 |
| test:postgres | PASS | 15/15 |
| test:postgres:live | NOT RUN | — |
| test:review-updates | PASS | 22/22 |
| test:s1-01 | PASS | 8/8 |
| test:s1-02 | PASS | 5/5 |
| test:s1-03 | PASS | 5/5 |
| test:s1-03:email | PASS | 49/49 |
| test:s1-04 | PASS | 5/5 |
| test:s1-05 | PASS | 6/6 |
| test:s1-06 | PASS | 3/3 |
| test:s1-07 | PASS | 4/4 |
| test:s1-08 | PASS | 5/5 |
| test:s1-09 | PASS | 7/7 |
| test:s1-10 | PASS | 8/8 |
| test:otp | PASS | 8/8 |
| test:sprint2 | PASS | 32/32 |
| test:s2-10 | PASS | 59/59 |
| test:routing | PASS | 182/182 |
| test:user-ux | PASS | 87/87 |
| test:datetime-dashboard | PASS | 28/28 |
| test:avatar | PASS | 21/21 |
| test:mobile-shell | PASS | 53/53 |
| test:layout | PASS | 45/45 |
| test:coverage:sprint1 | PASS | 23/23 |
| test:coverage:sprint2 | PASS | 25/25 |
| test:career-upload | PASS | 24/24 |
| test:user-roles-avatar | PASS | 17/17 |
| test:reapproval | PASS | 94/94 |
| test:s3-03 | PASS | 29/29 |
| test:s3-04 | PASS | 55/55 |
| test:s3-05 | PASS | 36/36 |
| test:s3-06 | PASS | 46/46 |
| test:s3-07 | PASS | 51/51 |
| test:s3-08 | PASS | 27/27 |
| test:s3-09 | PASS | 41/41 |
| backend/tests/test_postgres_startup.js | PASS | 11/11 |

42 nhóm PASS, 1 live suite NOT RUN. 1540 lượt case PASS, 0 FAIL; 1484 nếu bỏ aggregate Sprint 1 lặp lại 56 case. Không cộng các lượt chạy lại. S3-08 27/27 (SQLite 12, PostgreSQL embedded 12, HTTP/frontend 3); S3-09 41/41 (19 + 19 + 3). S3-07 vẫn 51/51; không đổi test cũ. Routing 182/182 sau khi bỏ BOM ở file mới.

Neon ats_staging/public: migration 007 VERIFIED, checksum e8d022f82237153295733ceb27b57ada016cbbca0b3f6aea5d6ef67a5213b614. Smoke rollback 10/10; readiness startup/API/schema/grants 5/5. Không seed/import, không có fixture còn lại. Fingerprint SQL MD5 của toàn bộ cột Requisition cũ trước/sau bằng nhau: 9519375474a1a282bd3a947df9442435. Không backfill opened_at; không thay đổi count nghiệp vụ cũ. Chỉ bổ sung schema/ledger, hai permission job_posting.read/manage và sáu grant được chốt.

node --check 135/135 PASS; git diff --check PASS. 15 file được bảo vệ (4 runtime DB và migration 001–006) có SHA-256 trước/sau bằng nhau. Source/test S3-07 được bảo toàn về hành vi, public Job Posting service được mở rộng có flag và hide giữ nguyên. Không sửa assertion cũ.

Browser E2E: NOT RUN. Stress nhiều connection PostgreSQL độc lập: NOT RUN. Không coi DOM runtime/PGlite là visual/browser/live pg-wire PASS. PostgreSQL live regression cần disposable test URL và không dùng Neon staging; smoke Neon là nhóm riêng đã thực hiện theo nhiệm vụ. Các flags mới mặc định OFF, .env không sửa.

[Báo cáo thiết kế và hướng dẫn](S3-08-S3-09-tracking-job-drafts.md) · [Bằng chứng](evidence/S3-08-S3-09-test-results.json). Giữ nguyên branch và HEAD; không stage/commit/push/merge/rebase/PR.


## File thay đổi trong lượt S3-08/S3-09

- backend/src/config/config.js
- backend/src/controllers/jobPostingDraftController.js
- backend/src/db/migrate-requisition-tracking-job-drafts.js
- backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql
- backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql
- backend/src/db/sync-permissions.js
- backend/src/server.js
- backend/src/services/jobPostingService.js
- backend/src/services/recruitmentCatalogService.js
- backend/src/services/requisitionService.js
- backend/src/services/requisitionTrackingService.js
- backend/tests/test_s3_08_09.js
- docs/ATS-E2E-2026-10-08.md
- docs/RBAC-admin-permissions.md
- docs/S3-08-S3-09-tracking-job-drafts.md
- docs/evidence/S3-08-S3-09-test-results.json
- frontend/components/create-req-modal.html
- frontend/components/requisition-detail-modal.html
- frontend/js/api.js
- frontend/js/components/job-posting-drafts.js
- frontend/js/components/requisition-detail.js
- frontend/js/components/requisition-form.js
- frontend/js/pages/requisitions.js
- frontend/js/shared/route-lifecycle.js
- frontend/pages/requisitions.html
- frontend/routes.json
- package.json

S3-07 tồn tại từ trước: các service/controller/migrator lifecycle riêng, test_s3_07.js, SQL 006 và báo cáo S3-07 giữ nguyên byte. Những điểm tích hợp dùng chung (Job Posting public/hide, Req service/UI/config/permission sync) được mở rộng, không thay thế chức năng cũ. Bốn DB runtime và SQL 001 modified là pre-existing, hash không đổi.

## Git status bàn giao

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
 M docs/ATS-E2E-2026-10-08.md
 M docs/RBAC-admin-permissions.md
 M frontend/components/create-req-modal.html
 M frontend/components/requisition-detail-modal.html
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
?? backend/src/controllers/requisitionLifecycleController.js
?? backend/src/db/migrate-requisition-lifecycle.js
?? backend/src/db/migrate-requisition-tracking-job-drafts.js
?? backend/src/db/migrations/006_requisition_lifecycle_postgres.sql
?? backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql
?? backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql
?? backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql
?? backend/src/services/jobPostingService.js
?? backend/src/services/requisitionLifecycleService.js
?? backend/src/services/requisitionTrackingService.js
?? backend/tests/test_s3_07.js
?? backend/tests/test_s3_08_09.js
?? docs/S3-07-requisition-lifecycle.md
?? docs/S3-08-S3-09-tracking-job-drafts.md
?? docs/evidence/
?? frontend/js/components/job-posting-drafts.js
?? frontend/js/components/requisition-lifecycle.js
```

Branch feature/s2-bulk-user-import; HEAD d962ef3a9da49d42b595dba85ca3daa3404454db. Không stage/commit/push/merge/rebase/PR/reset/restore/clean/stash.
