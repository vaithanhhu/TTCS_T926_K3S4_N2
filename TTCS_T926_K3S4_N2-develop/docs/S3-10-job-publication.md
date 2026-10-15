# S3-10 — Duyệt và xuất bản tin tuyển dụng

Ngày 2026-10-09. Branch feature/s2-bulk-user-import; HEAD d962ef3a9da49d42b595dba85ca3daa3404454db. Không stage/commit/push/merge/rebase/PR. Giữ thay đổi S3-07/S3-08/S3-09 chưa commit.

## Pre-check

Đọc service, controller, SQL 006/007, frontend, public API và backlog thực tế. Source trước S3-10 chỉ có DRAFT/PUBLISHED/PAUSED/UNPUBLISHED; có draft receipt nhưng chưa có quyết định duyệt tin, version nội dung bất biến, public page hoặc preview template. published_at đã có nên tái sử dụng. Baseline cách ly: S3-07 51/51, S3-08 27/27, S3-09 41/41, S3-02 93/93, Routing 182/182. Read-only Neon xác minh đến 007, job_postings trống và fingerprint Requisition cũ giữ nguyên. Không sửa code phụ thuộc trước khi baseline PASS.

## Chính sách người dùng đã chốt

1. Deadline là DATE; ngày deadline còn hiệu lực đến hết ngày Việt Nam. Sau đó public ẩn, backend chặn duyệt/xuất bản. Không có cron hoặc trạng thái EXPIRED giả; không tự ghi audit vì chỉ đọc sau hết hạn.
2. Người tạo hoặc người sửa nội dung cuối không tự xử lý quyết định duyệt tin, kể cả ADMIN. No-op save không thay last editor hoặc tạo content version giả.
3. Req revision PENDING giữ tin đã xuất bản theo nội dung main đã được duyệt. Khi main thực sự thay đổi, tin cũ được UNPUBLISHED trong transaction áp dụng revision; cần cập nhật draft, duyệt lại và publish rõ ràng.
4. Quyền gửi không phải quyền duyệt. Recruiter primary/support ACTIVE được gửi; HR/ADMIN giữ quyền quản lý hiện hành. Duyệt/từ chối và publish/gỡ chỉ HR_MANAGER/ADMIN. Publisher có thể là creator nếu một người đủ quyền khác đã duyệt.

## Workflow và version

DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED. REJECTED bắt buộc lý do; REVISE riêng đưa REJECTED/APPROVED/UNPUBLISHED về DRAFT, không ghi đè lịch sử. PENDING, APPROVED và PUBLISHED không được sửa bằng API draft. Tin PUBLISHED muốn thay nội dung phải gỡ rõ ràng trước, rồi REVISE, chỉnh draft, gửi/duyệt/publish lại; không có republish tự động.

version là optimistic row version cho mọi thao tác. content_version chỉ tăng khi nội dung/source binding thay đổi. Mỗi phiên bản có document public bất biến, content hash và document hash riêng; approved_content_version/hash chỉ định đúng nội dung được duyệt. Snapshot đóng băng JD, requirements, location/mode labels, department, deadline và salary choice. Catalog active/date/source vẫn kiểm tra tại các thao tác; không đổi label trong snapshot đã duyệt một cách âm thầm.

Actor lấy từ session/RBAC thật; timestamp lấy database. Không nhận publishedBy/At/approvedBy/At từ client. Metadata Publisher ghi vào published_by/published_at và PUBLISH event. Lịch sử CREATE/EDIT/SUBMIT/APPROVE/REJECT/REVISE/PUBLISH/UNPUBLISH/LIFECYCLE/SOURCE_CHANGED append-only, có actor ID/name, thời gian, row/content version, before/after và lý do. Không có API sửa/xóa history; database chặn UPDATE/DELETE và PostgreSQL chặn TRUNCATE.

RequestId + fingerprint + expectedVersion chống retry/double-click. Parent Requisition lock trước posting lock; update/audit/receipt cùng client/transaction. Stale/conflict không xử lý phiên bản hoặc cấp sau. Audit failure rollback cả publish hoặc final Req revision kèm auto-unpublish. Không thay trạng thái hoặc nội dung Requisition khi xuất bản tin.

## Public và preview

- /careers/jobs: listing công khai tối thiểu; /careers/jobs?id=posting-id: detail, deep link hoạt động. Không triển khai search/campaign/CV/apply flow Sprint 4 hoặc nền tảng thứ ba.
- Preview: GET /api/v1/job-posting-publication/:id/preview, bắt buộc session + job_posting.read + requisition.read/scope. Payload chỉ có document public, contentVersion/status; không có budget, standard range, approval comments, actor nội bộ.
- Preview và public detail gọi cùng ATS_PUBLIC_JOB_RENDERER, cùng DOM/tag/classes/styles và nội dung snapshot. Publish timestamp là metadata ngoài body renderer. Test runtime thật so cây render và dữ liệu giữa preview chưa publish, detail sau publish; browser visual vẫn NOT RUN.
- Public chỉ PUBLISHED có approved content hash/version, quyết định APPROVE và event PUBLISH đúng row version/actor/time; Req OPEN/IP và main có proof phê duyệt. DRAFT/PENDING/REJECTED/APPROVED/UNPUBLISHED/PAUSED không trả.
- Public dùng proof lịch sử phù hợp main còn hiệu lực khi Req revision PENDING. Main hash khác snapshot source sẽ ẩn; final revision tự gỡ trong transaction. Một cờ PUBLISHED bị sửa trực tiếp hoặc body bị tamper không đủ điều kiện.
- showSalary=false: whitelist bỏ salaryMin/Max. Không có standard salary range. JD/requirements render textContent/pre-wrap để không thực thi HTML từ nội dung.
- Schema 008 đã có thì public reader thực thi proof guard ngay cả khi flag publication OFF; không dùng flag để bỏ kiểm tra approval/version. Trước 008, compatibility nền tảng S3-07/S3-09 vẫn giữ để test/migration độc lập.

## Tích hợp và schema

Migration 008_job_publication_postgres.sql/sqlite.sql tạo job_posting_content_versions và job_posting_publication_events, thêm content/approval/publisher metadata và mở rộng status CHECK. published_at cũ được tái sử dụng. PostgreSQL ALTER additive; SQLite rebuild job_postings trong transaction, copy toàn bộ 20 field cũ, giữ ID/FK/index, không tự backfill actor hoặc approval cho dữ liệu cũ. Test so readback từng field và PRAGMA foreign_key_check. Không chạy trên SQLite runtime.

Tin legacy thiếu tác giả xác thực không được tự gán creator để vượt cấm tự duyệt; cần bản nháp mới có xuất xứ rõ. Không tạo CREATE/APPROVE history giả cho row cũ. Legacy PUBLISHED không có proof duyệt/xuất bản bị ẩn khi schema 008 có hiệu lực.

S3-07 hide ghi publication event cùng transaction; S3-02 final applyRevision tự gỡ published ad khác source hash, actor là người thực hiện final Req decision. Không sửa Offer approval, không đổi ngân sách, candidate stage, recruiter assignment hoặc logic lưu DRAFT/OPEN/IP/CLOSED. S3-08 metrics/filter và S3-09 copy/edit giữ nguyên.

Permission mới job_posting.approve/job_posting.publish: grant HR_MANAGER, ADMIN qua super RBAC tập trung. Các role khác không có. job_posting.manage/read và mọi scope cũ giữ nguyên. Seed/sync idempotent, Neon migration chỉ sync hai quyền mới, không seed/import.

JOB_POSTING_PUBLICATION_ENABLED mặc định OFF; startup verify 008 khi bật, không auto migrate. Không sửa .env hoặc bật production flag. Review/activate cần chạy cùng cấu hình Sprint 3 hiện hành, đặc biệt S3-09 draft và S3-06 support scope. Không tự bật ngân sách chưa cấu hình.

## API

- GET /api/v1/job-posting-publication: queue HR/Admin riêng, không trộn Offer/Req approval.
- GET /:id: status/capabilities/actor/timestamp/history trong scope.
- GET /:id/preview: document whitelist có xác thực.
- POST /:id: action SUBMIT/APPROVE/REJECT/PUBLISH/REVISE/UNPUBLISH + requestId/expectedVersion/reason.
- Public API S3-07 /api/v1/public/job-postings và /:id tái sử dụng, bổ sung proof/expiry/snapshot guard.

401/403/404/400/409/500 giữ HTTP semantics và JSON API; không trả stack/SQL/path/credential. UI có preview, queue, các action theo capability backend, loading/empty/error, reason validation, busy state và bỏ response cũ khi rời trang/logout.

## Acceptance Criteria

| AC | Automated | Bằng chứng |
|---|---|---|
| Tin phải duyệt trước công khai | PASS | Draft/pending/rejected/approved chưa publish private; current-version proof; permission/scope; forged status/tamper denied; explicit publish |
| Preview đúng public UI | PASS | Protected preview không public; chính renderer và full tag/class/style tree/data sau publish; whitelist/no salary leak |
| Actor và thời điểm xuất bản | PASS | Server-controlled metadata + immutable PUBLISH event; client override denied; retry/concurrency một event; rollback |

## Manual acceptance và môi trường

Browser discovery không có instance kết nối: Browser E2E NOT RUN, không screenshot/visual PASS. Cần kiểm tra desktop/mobile, brand spacing/font, modal/public width, navigation và nội dung dài trong browser thật. Không đánh dấu Sprint 3 đã được người dùng nghiệm thu.

PostgreSQL 17 thật: cluster mới chỉ bind 127.0.0.1 trong A:/ATS_SPRINT3_TEST/s310-pg-*, hai database test riêng, không dùng service/database PostgreSQL đang có hoặc Neon cho stress. Parity 22 case và stress 8 batch × 10 concurrent requests; dùng nhiều pool connection thật. Suite PostgreSQL live cũ dùng schema disposable trong DB test khác. Cluster đã stop; thư mục giữ lại phục vụ audit, không xóa dữ liệu developer.

Neon dùng config hiện có, không ghi/in secret; chỉ sau regression và stress PASS mới áp dụng 008. Smoke dùng fixture trong một transaction rollback; không tạo session thật hoặc gửi email. SQL migration cũ và 4 runtime DB được bảo vệ SHA-256 trước/sau.

## Hướng dẫn kiểm thử thủ công

1. Sau review, bật JOB_POSTING_PUBLICATION_ENABLED=true trong tiến trình cần dùng, không tự thay production. Ledger 008 phải verified; giữ các flags liên quan theo cấu hình đã quản lý.
2. Recruiter primary/support mở Req đã APPROVED đang tuyển, soạn ad rồi mở Preview / gửi duyệt. Kiểm tra chỉ gửi, không có Duyệt/Publish.
3. HR khác creator/last editor mở /approvals, panel Duyệt và xuất bản tin tuyển dụng; preview snapshot, reject bắt buộc reason hoặc approve. APPROVED chưa hiện public.
4. HR/Admin publish, kiểm tra metadata và /careers/jobs?id=id. Creator HR cần người khác duyệt; không được tự quyết định.
5. Gỡ tin rồi REVISE, sửa draft, gửi/duyệt lại. Req revision PENDING giữ bản đã public; final main thay đổi gỡ tin. Lifecycle PAUSED/CLOSED/CANCELLED cũng ẩn, không republish tự động.
6. Kiểm tra deadline hôm nay/cũ, showSalary on/off, role bị thu hồi, version cũ, submit trùng và preview anonymous trong DB cách ly. Không sửa dữ liệu nghiệp vụ thật để dựng test.

Kết quả suite/Neon/hash/Git cuối được bổ sung từ log thực thi.


## Kết quả cuối S3-10 — 2026-10-09

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
| test:postgres:live | PASS | 3/3 |
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
| test:routing | PASS | 187/187 |
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
| test:s3-10 | PASS | 53/53 |
| test:s3-10:pg-live | PASS | 32/32 |
| backend/tests/test_postgres_startup.js | PASS | 11/11 |

45 nhóm PASS; 1633 lượt case PASS, 0 FAIL (1577 bỏ aggregate Sprint 1 lặp lại). Không cộng các lần chạy lại. S3-10 53/53 trên SQLite/PGlite/HTTP/runtime; PostgreSQL 17 thật parity 24/24 và stress 8/8 với 80 requests (10 đồng thời/batch); generic live 3/3. Cluster test đã dừng.

Neon ats_staging/public: 008 VERIFIED, checksum cade19fe99bd4254718ccdab62440c3e06e18de663d6b5911be3f987f2ee439a. Smoke rollback 13/13; startup/API/schema/grant 6/6; không fixture còn lại. Count nghiệp vụ cũ giữ nguyên, fingerprint Requisition cũ trước/sau bằng nhau. Không seed/import, không thay data cũ.

node --check 145/145 PASS; git diff --check PASS. SHA-256 của 17 file bảo vệ (4 runtime DB + 001–007) giữ nguyên. Test cũ giữ nguyên. .env không sửa, không stage/commit/push/merge/rebase/PR.

Browser E2E NOT RUN, không có screenshot/visual PASS. PostgreSQL multi-connection stress đã RUN/PASS trên cluster local mới, không chạy stress Neon. Flags đọc từ environment/config hiện tại đều OFF; chỉ bật trong tiến trình test/smoke, không tự kích hoạt production. [Bằng chứng](evidence/S3-10-test-results.json).

## Phục hồi tin chờ duyệt không còn hợp lệ

HR/Admin khác người tạo/người sửa cuối được từ chối tin PENDING_APPROVAL đã hết hạn hoặc có source thay đổi, bắt buộc lý do. Không cho duyệt/xuất bản tin đó. Sau khi từ chối, người được giao đưa về nháp, cập nhật deadline/source phù hợp rồi gửi và duyệt lại. Quyền đọc, phạm vi, cấm tự quyết định, expectedVersion, requestId và audit vẫn áp dụng. Hai ca phục hồi được chạy trên SQLite, PostgreSQL embedded và PostgreSQL local thực.

## File thay đổi trong lượt S3-10

14 file có sẵn được mở rộng và 14 file mới; không tính thay đổi S3-07–09 đã tồn tại là thay đổi của lượt này. Không đổi dependency/package-lock hoặc test cũ.

| File | Loại | Mục đích |
|---|---|---|
| backend/src/services/jobPostingService.js | Mở rộng | Tích hợp version/audit/public guard và no-op save, giữ API draft. |
| backend/src/services/requisitionLifecycleService.js | Mở rộng | Truyền actor/lý do để audit gỡ tin cùng transaction S3-07. |
| frontend/js/components/job-posting-drafts.js | Mở rộng | Thao tác preview/approval khi backend xác nhận flag bật. |
| backend/src/config/config.js | Mở rộng | Flag publication mặc định OFF. |
| backend/src/db/sync-permissions.js | Mở rộng | Hai quyền review/publish HR_MANAGER, sync idempotent. |
| backend/src/server.js | Mở rộng | Verify migration, private publication API, public API tích hợp. |
| backend/src/services/requisitionApprovalService.js | Mở rộng | Gỡ tin trong transaction khi final revision đổi main; actor đúng. |
| docs/ATS-E2E-2026-10-08.md | Mở rộng | Bổ sung kết quả suite và Neon S3-10. |
| docs/RBAC-admin-permissions.md | Mở rộng | RBAC publication và cấm tự review, recovery reject. |
| frontend/index.html | Mở rộng | Fragment public jobs tái sử dụng shell. |
| frontend/js/api.js | Mở rộng | Helper private publication/public listing/detail. |
| frontend/js/shared/route-lifecycle.js | Mở rộng | HR queue, public page, leave/cleanup. |
| frontend/routes.json | Mở rộng | Route công khai /careers/jobs và scripts/components. |
| package.json | Mở rộng | Lệnh migrate/test S3-10 và real PostgreSQL test. |
| backend/src/controllers/jobPostingPublicationController.js | Mới | HTTP/JSON, permission và lỗi publication riêng. |
| backend/src/db/migrate-job-publication.js | Mới | Migration/verification checksum và sync có transaction. |
| backend/src/db/migrations/008_job_publication_postgres.sql | Mới | Schema additive, FK/index/check/version/event immutable. |
| backend/src/db/migrations/008_job_publication_sqlite.sql | Mới | Schema tương thích, bảo toàn full old row khi rebuild. |
| backend/src/services/jobPostingPublicationService.js | Mới | Engine duyệt/xuất bản, pinned snapshot, preview/proof/expiry/scope/concurrency. |
| backend/tests/test_s3_10.js | Mới | SQLite/PGlite/migration/API/frontend runtime 53 ca. |
| backend/tests/test_s3_10_pg_live.js | Mới | 24 ca parity và 8 batch/80 request pool thật trên DB cô lập. |
| docs/S3-10-job-publication.md | Mới | Thiết kế, policy, API, files, kết quả, hướng dẫn. |
| docs/Sprint-3-summary-2026-10-09.md | Mới | Đối chiếu AC toàn Sprint3, flags/migration/manual acceptance. |
| docs/evidence/S3-10-test-results.json | Mới | Số liệu suite, Neon, bảo vệ file, Git và giới hạn test. |
| frontend/js/components/job-posting-public-renderer.js | Mới | Renderer public/preview dùng chung, text an toàn. |
| frontend/js/components/job-posting-publication.js | Mới | Preview, workflow controls, HR queue, conflict/loading/error. |
| frontend/js/pages/public-jobs.js | Mới | Public listing/detail, async stale guard và empty/error. |
| frontend/pages/public-jobs.html | Mới | Public view tối thiểu phù hợp shell hiện có. |

## Git và an toàn dữ liệu

Git status bên dưới bao gồm mọi thay đổi đã có trước, đặc biệt runtime DB và migration 001. SHA-256 trước/sau của chúng bằng nhau; không sửa/restore/stage những file đó. git diff --stat chỉ hiện tracked files so HEAD, chưa tính các file untracked và không đại diện riêng S3-10. Các thay đổi review/S3-07–09 còn nguyên.

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
?? backend/tests/test_s3_07.js
?? backend/tests/test_s3_08_09.js
?? backend/tests/test_s3_10.js
?? backend/tests/test_s3_10_pg_live.js
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
 backend/src/services/requisitionService.js         |  28 +++-
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
 package.json                                       |  10 +-
 26 files changed, 361 insertions(+), 45 deletions(-)
```
