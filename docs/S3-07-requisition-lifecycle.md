# S3-07 — Vòng đời yêu cầu tuyển dụng

Ngày kiểm thử: 2026-10-09. Branch: feature/s2-bulk-user-import. HEAD trước/sau triển khai: d962ef3a9da49d42b595dba85ca3daa3404454db. Thay đổi chưa commit.

## Chính sách đã xác nhận

| Thao tác | Trạng thái kỹ thuật | Điều kiện | Chỉ tiêu và ngân sách |
|---|---|---|---|
| Đã tuyển đủ | CLOSED | Đã có quantity được phê duyệt; không còn workflow/revision PENDING và ứng viên chưa kết thúc | Giữ chỉ tiêu đã dùng theo S3-04; không giải phóng vì hoàn thành |
| Tạm dừng | PAUSED | OPEN/IN_PROGRESS; lý do bắt buộc | Giữ nguyên quota/reservation; đóng băng mọi quyết định duyệt |
| Huỷ | CANCELLED | Không còn PENDING hoặc pipeline chưa kết thúc; có HIRED thì quantity phải được duyệt | Giữ snapshot phần đã tuyển; giải phóng phần chưa tuyển |

Chỉ HR_MANAGER/ADMIN có quyền quản lý vòng đời. Điều kiện đọc và phạm vi Requisition cũ vẫn được kiểm tra; DRAFT của người khác vẫn chịu quy tắc bảo mật S2-10. Không có thao tác tự khôi phục hoặc tự đăng lại. PAUSED có vòng duyệt PENDING sẽ tiếp tục đóng băng; chính sách khôi phục không thuộc S3-07.

Pipeline thực tế: NEW, APPLIED, SCREENING, INTERVIEW, OFFER chưa kết thúc; HIRED và REJECTED kết thúc. Tên trạng thái được đối chiếu service hiện tại. Không tự sửa ứng viên, lịch phỏng vấn, Offer, phân công recruiter hoặc lịch sử duyệt.

Khi huỷ, snapshot HIRED được chụp trong transaction. HIRED lớn hơn quantity đang có hiệu lực đã duyệt bị chặn. Ngân sách dự kiến giữ lại = HIRED × proposedSalaryMax × (13 − tháng neededDate). Đây không phải chi phí lương thực tế. Thay đổi application sau huỷ không tính lại snapshot. Năm, salary, months, quantity, danh sách application, actor và thời điểm được lưu trong lịch sử. Không dùng revision chưa được duyệt.

## Hiện trạng và thay đổi

Trước S3-07 chỉ có DRAFT/OPEN/IN_PROGRESS/CLOSED; cập nhật CLOSED không có lý do, pipeline guard hay audit vòng đời. Source chưa có bảng/API publish Job Posting; theo xác nhận của người dùng chỉ bổ sung nền tảng tối thiểu để kiểm thử tự gỡ tin, không triển khai UI soạn/xuất bản S3-09/S3-10.

Migration 006 tạo job_postings, requisition_lifecycle_events và requisition_lifecycle_state, cùng ledger riêng. Không sửa 001–005, không chuyển dữ liệu cũ. Events append-only được bảo vệ UPDATE/DELETE ở SQLite và UPDATE/DELETE/TRUNCATE ở PostgreSQL. Phân quyền mới requisition.lifecycle.manage chỉ cấp HR_MANAGER; ADMIN dùng cơ chế toàn quyền RBAC hiện hữu. Seed/sync giữ quyền này.

Backend khoá workflow và Requisition, đọc lại pipeline và ngân sách, ẩn tin đăng, chuyển trạng thái và ghi event trong cùng transaction. ExpectedVersion và requestId chống cập nhật cũ/gửi trùng. Retry cùng payload trả kết quả cũ; payload khác cùng mã bị từ chối; no-op không ghi lịch sử giả. Ứng tuyển mới giữ khoá parent trong transaction để không lọt qua thao tác đóng/huỷ đồng thời.

PAUSED ẩn PUBLISHED thành PAUSED. CLOSED/CANCELLED chuyển PUBLISHED/PAUSED thành UNPUBLISHED. Nội dung tin đăng vẫn tồn tại. Public API kiểm tra cả trạng thái tin và parent OPEN/IN_PROGRESS nên tin đóng/huỷ/tạm dừng không công khai ngay cả khi có dữ liệu publish sai lệch.

Giao diện Chi tiết Requisition, cả legacy và S2-10, có panel vòng đời: loading, lỗi/thử lại, lý do, cảnh báo và danh sách ứng viên tồn đọng, xác nhận, chống submit trùng và lịch sử. Trạng thái PAUSED/CANCELLED được phân biệt ở danh sách/dashboard. Không redesign CSS. API dùng client và xử lý lỗi chung hiện có.

## API và cấu hình

- GET /api/v1/requisition-lifecycles/:id: trạng thái, version, khả năng thao tác, pendingApproval, outstanding, hiredCount, history. Yêu cầu requisition.read và phạm vi.
- POST cùng endpoint: action FULFILLED/PAUSED/CANCELLED, reason, expectedVersion, requestId. Yêu cầu requisition.lifecycle.manage, HR_MANAGER/ADMIN và các điều kiện nghiệp vụ.
- PUT/DELETE lịch sử không tồn tại; trả 404, database cũng bảo vệ lịch sử.
- GET /api/v1/public/job-postings và /:id: chỉ nội dung public của tin PUBLISHED có parent đang tuyển. Không có API soạn/xuất bản mới.
- REQUISITION_LIFECYCLE_ENABLED mặc định false. Startup chỉ verify migration, không tự migrate. Khi bật, không được dùng create/update cũ để trực tiếp đặt CLOSED/PAUSED/CANCELLED, kể cả casing khác. Khi tắt, hành vi legacy được giữ; trạng thái PAUSED/CANCELLED đã lưu vẫn chặn ứng tuyển/duyệt và snapshot huỷ vẫn được tính vào ngân sách.
- Sau khi migration được xác minh, người vận hành có thể bật REQUISITION_LIFECYCLE_ENABLED=true trong tiến trình. Lượt này không sửa .env hoặc tự bật flag môi trường đang chạy.

## Acceptance Criteria

| AC | Automated | Bằng chứng |
|---|---|---|
| 1: Ba trạng thái/lý do phân biệt | PASS | State, reason, actor, time, validation, RBAC, retry/version; UI thao tác và lịch sử |
| 2: Đóng tự gỡ tin đang đăng | PASS | Tin linked bị UNPUBLISHED trong transaction; public list/detail không còn trả tin; tin của requisition khác giữ nguyên; rollback khôi phục toàn bộ |
| 3: Cảnh báo pipeline cần xử lý | PASS | Từng stage chưa kết thúc bị chặn ở backend; UI hiển thị số lượng và danh sách; không tự thay đổi application/interview/Offer |

Browser E2E/kiểm tra visual desktop-mobile: NOT RUN, không có trình duyệt kết nối. DOM runtime có HTTP thật và interaction, không được coi là visual acceptance. Concurrent calls đã kiểm tra optimistic version/idempotency trên SQLite và PGlite; PGlite pool của harness tuần tự hoá transaction. Chưa kiểm tra stress nhiều PostgreSQL connection độc lập.

## Hướng dẫn kiểm thử thủ công

1. Dùng database cách ly đã migrate 002–006; bật các module cần thiết trong tiến trình, email simulated. Không seed database đang có dữ liệu.
2. HR Manager/Admin mở Chi tiết một OPEN, kiểm tra panel, nhập lý do rồi Tạm dừng. Tin public bị ẩn, hồ sơ không nhận ứng tuyển mới, vòng duyệt không xử lý được, quota/reservation không đổi.
3. Mở OPEN đã được APPROVED, không còn pipeline chưa kết thúc/PENDING; chọn Đã tuyển đủ. CLOSED giữ chỉ tiêu đã dùng và gỡ tin.
4. Mở OPEN có HIRED trong quantity đã duyệt và không còn tồn đọng; chọn Huỷ. Kiểm tra snapshot số HIRED và ngân sách dự kiến, giải phóng phần còn lại; lịch sử vòng duyệt/recruiter vẫn nguyên.
5. Thử thiếu lý do, đổi expectedVersion, requestId trùng khác payload, thiếu quyền, dữ liệu ngoài phạm vi và pipeline chưa xử lý. Kiểm tra thông báo rõ ràng, không có ghi một phần.
6. Hiring Manager chỉ thấy thông tin vòng đời/lịch sử trong phạm vi, không có form quản lý. Chưa có chức năng khôi phục PAUSED hoặc UI publish Job Posting trong phạm vi này.

## Kết quả chạy và an toàn dữ liệu

Kết quả cuối cùng và Neon được bổ sung từ log thực thi sau khi hoàn tất. Bốn SQLite runtime cùng migration 001–005 được so SHA-256 trước/sau; mọi DB test nằm trong TEMP source copy, npm ci offline, không .git/.env/runtime DB. Không SMTP/OAuth thật. Không git add/commit/push/merge/rebase/PR/reset/restore/clean/stash.


## Kết quả cuối S3-07 — 2026-10-09

| Suite | Kết quả | Cases |
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
| test:routing | PASS | 181/181 |
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
| backend/tests/test_postgres_startup.js | PASS | 11/11 |

40 nhóm PASS; một live regression NOT RUN vì không có disposable PostgreSQL test URL. 1471 lượt case PASS, 0 FAIL; 1415 nếu bỏ lượt aggregate Sprint 1 lặp lại 56 case. Không cộng các lần chạy lại trong quá trình sửa.

S3-07: 51/51 = SQLite 23, PostgreSQL embedded 23, HTTP/frontend runtime 5. Baseline 39 npm scripts trước sửa đều exit 0; live suite báo NOT RUN. Routing tăng từ 180 lên 181 do module frontend mới được kiểm tra theo manifest; không đổi assertion cũ. Không sửa bất kỳ test cũ nào.

Neon ats_staging/public: migration 006 VERIFIED; checksum 97146d688d92764524d2d1292920bbdb105769049902d445a1603db19f91d3e7. Ba bảng mới trống sau smoke. Smoke rollback 10/10, startup/API/schema/grant read-only 4/4. Không seed/import; không có fixture còn lại; các count nghiệp vụ được kiểm tra không đổi. Chỉ schema/ledger/permission requisition.lifecycle.manage và grant HR_MANAGER được bổ sung theo nhiệm vụ. ADMIN toàn quyền RBAC qua cơ chế tập trung hiện hữu. Không sửa .env. Flag S3-07 vẫn mặc định OFF; chỉ bật trong tiến trình kiểm thử.

node --check 130/130 PASS; git diff --check PASS. Bốn DB runtime và 001–005 có SHA-256 trước/sau bằng nhau (13 file được bảo vệ). Các DB modified và migration 001 có trạng thái modified từ trước; không restore hoặc sửa chúng.

Browser E2E: NOT RUN. Không có screenshot/visual PASS. Stress nhiều connection PostgreSQL độc lập: NOT RUN; concurrent calls, stale version, retry và rollback được kiểm tra trong harness SQLite/PGlite. Không tuyên bố PGlite là live pg-wire regression.

Bằng chứng đầy đủ: [S3-07-test-results.json](evidence/S3-07-test-results.json). Chi tiết thiết kế và hướng dẫn: [S3-07-requisition-lifecycle.md](S3-07-requisition-lifecycle.md). Không git add/commit/push/merge/rebase/PR. HEAD và branch giữ nguyên.


## File thay đổi trong lượt này

- backend/src/config/config.js
- backend/src/controllers/requisitionLifecycleController.js
- backend/src/db/migrate-requisition-lifecycle.js
- backend/src/db/migrations/006_requisition_lifecycle_postgres.sql
- backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql
- backend/src/db/sync-permissions.js
- backend/src/server.js
- backend/src/services/headcountBudgetService.js
- backend/src/services/jobPostingService.js
- backend/src/services/requisitionApprovalService.js
- backend/src/services/requisitionLifecycleService.js
- backend/src/services/requisitionService.js
- backend/tests/test_s3_07.js
- docs/ATS-E2E-2026-10-08.md
- docs/RBAC-admin-permissions.md
- docs/S3-07-requisition-lifecycle.md
- docs/evidence/S3-07-test-results.json
- frontend/components/create-req-modal.html
- frontend/components/requisition-detail-modal.html
- frontend/js/api.js
- frontend/js/components/requisition-approval.js
- frontend/js/components/requisition-detail.js
- frontend/js/components/requisition-form.js
- frontend/js/components/requisition-lifecycle.js
- frontend/js/pages/dashboard.js
- frontend/js/pages/requisitions.js
- frontend/js/shared/route-lifecycle.js
- frontend/routes.json
- package.json

Các file modified có sẵn (4 SQLite runtime và 001_postgres.sql) được giữ nguyên hash. Không thay đổi assertion cũ; chỉ tạo backend/tests/test_s3_07.js. Các runner và script smoke phụ trợ nằm ngoài repository trong workspace audit.


Sau full regression, kiểm tra cuối bổ sung assertion định dạng UTC tại panel audit và HTTP 400/BUDGET_DOCUMENT_INCOMPLETE cho dữ liệu tài chính legacy không hợp lệ. Đã chạy lại S3-07 (51/51), datetime/dashboard (28/28), routing (181/181), mobile shell (53/53), layout (45/45); không có failure. Tổng 1471 là tổng kết quả mới nhất mỗi suite, không cộng các lần chạy lại. Không đổi assertion cũ.


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
 M frontend/routes.json
 M package.json
?? backend/src/controllers/requisitionLifecycleController.js
?? backend/src/db/migrate-requisition-lifecycle.js
?? backend/src/db/migrations/006_requisition_lifecycle_postgres.sql
?? backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql
?? backend/src/services/jobPostingService.js
?? backend/src/services/requisitionLifecycleService.js
?? backend/tests/test_s3_07.js
?? docs/S3-07-requisition-lifecycle.md
?? docs/evidence/
?? frontend/js/components/requisition-lifecycle.js
```

19 file tracked thay đổi trong lượt này; 10 file mới. Diff --stat của tracked source/docs/package: 110 dòng thêm, 17 dòng bỏ trước phần cập nhật báo cáo cuối (không bao gồm file mới); binary runtime diff là pre-existing và hash không đổi. Không stage/commit/push/merge/rebase.
