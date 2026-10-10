# Tổng kết triển khai Sprint 3 — 2026-10-09

Branch feature/s2-bulk-user-import; HEAD d962ef3a9da49d42b595dba85ca3daa3404454db. Toàn bộ S3-07 đến S3-10 còn trong working tree chưa commit. Không stage/push/merge/rebase/PR. Báo cáo này xác nhận implementation và automated execution, không thay thế nghiệm thu người dùng.

## Bảng story

| Story | User Story / AC đã đối chiếu | Suite hiện tại | Automated | Acceptance còn lại |
|---|---|---|---|---|
| S3-01 | Cấu hình department/salary chain, escalation, invalid config block, pinned version/snapshot | 108/108 | PASS | Browser cấu hình/visual |
| S3-02 | Approve/Reject/Info với comment, chuyển cấp/final APPROVED riêng, bổ sung revision giữ history | 93/93 + reapproval 94/94 | PASS | Browser flow dài/nhiều role |
| S3-03 | Full chain/current approver, actor/time/comment, history immutable và scope | 29/29 | PASS | Visual timeline |
| S3-04 | Department/year budget, remaining quota, blocking overage + HR/Admin reason exception | 55/55 | PASS | Dữ liệu/chỉ tiêu công ty thực tế cần cấu hình/duyệt |
| S3-05 | Copy exact JD/requirements, always DRAFT, no inherited approval/relations/budget | 36/36 | PASS | Browser thao tác sao chép |
| S3-06 | Primary+supports, scoped candidate endpoints, immutable handover | 46/46 | PASS | Browser chuyển giao/phạm vi |
| S3-07 | Fulfilled/pause/cancel reasons, atomic public hide, unresolved pipeline block | 51/51 | PASS | Browser lifecycle/warnings |
| S3-08 | Combined filters, calendar days and deadline warning, scoped/no N+1, pagination | 27/27 | PASS | Desktop/mobile bảng dài |
| S3-09 | Exact source JD/edit, catalogs/deadline/salary visibility, approved-source/RBAC only | 41/41 | PASS | Browser soạn và source đổi |
| S3-10 | Approval before public, exact shared preview/public renderer, publisher actor/time | 53/53 + real PG parity 24/24 + stress 8/8 | PASS | Browser preview/public/branding |

## Đối chiếu AC chi tiết

- S3-01 AC1: department + monthly VND salary tiers; AC2: min→max ascending, equality no escalation, exceeded includes mandatory preceding levels; AC3: invalid dept/user/permission/order/limit/no match blocked; AC4: published immutable version and running snapshot unchanged. AUTOMATED VERIFIED.
- S3-02 AC1: three actions, reject/info nonempty backend reason; AC2: actual assigned/current permission, next step without skipping, last APPROVED separate from recruitment status; AC3: NEEDS_INFO returns revision, restarts level1, history append-only. Creator/on-behalf reason, self/repeated approver, concurrent/stale/rollback covered. AUTOMATED VERIFIED.
- S3-03 AC1: chain/approved/current waiting; AC2: assigned and actual actor/time/comment across rounds; AC3: API/DB immutable, read scope/IDOR. AUTOMATED VERIFIED.
- S3-04 AC1: immutable budget versions department/year; AC2: remaining headcount and expected payroll; AC3: overage rejects unless HR/Admin scoped exception with reason. Inclusive months from neededDate; pending delta avoids duplicate main/revision; CLOSED grandfathering and S3-07 cancellation snapshots respected. AUTOMATED VERIFIED.
- S3-05 AC1: authored text preserved exact; AC2: new ID/code DRAFT, no history/assignments/applications/held quota copied. AUTOMATED VERIFIED.
- S3-06 AC1: one primary, distinct supports/active recruiter; AC2: list/detail/search/pipeline/interview/offer scopes and revocation; AC3: actor/time/change/reason history atomic/immutable. AUTOMATED VERIFIED.
- S3-07 AC1: technical and business ending reason distinguished; AC2: published/paused posts hidden atomically and public excludes; AC3: outstanding stages counted/listed, close/cancel block backend, no auto mutation applicant/interview/offer. AUTOMATED VERIFIED.
- S3-08 AC1: state/dept/primary-or-support/created-date AND filters; AC2: first-open capture, legacy estimated, Vietnam calendar/leap/boundary; AC3: only active overdue highlights, no status change, proper paused/closed/cancelled. AUTOMATED VERIFIED.
- S3-09 AC1: independent draft copying/editing text; AC2: persisted active catalog, valid deadline, default hidden salary/public whitelist; AC3: actual final Req approval/current document + assigned writer only, pending/ending denied. AUTOMATED VERIFIED.
- S3-10 AC1: proof-based pinned content version, explicit publish only, state/RBAC/author separation; AC2: authenticated preview uses same exact renderer/tag/class/style/body as public; AC3: publisher/time DB-controlled + immutable PUBLISH event, duplicate/stale/concurrent/rollback safeguards. AUTOMATED VERIFIED; visual matching in real browser still pending.

Các suite có assertion static/DOM được ghi đúng phạm vi; browser screenshot/pixel/usability không được suy ra từ DOM. PGlite không được coi là multi-connection pg-wire. Lượt S3-10 đã tìm thấy PostgreSQL 17 cục bộ và chạy stress thật, không dùng Neon để stress.

## Regression và Neon

Sprint 1 aggregate/individual 56/56, coverage 23/23; Sprint 2 32/32, coverage 25/25; S2-10 59/59; RBAC 47/47; API/frontend 51/51; routing 187/187. Các suite bổ trợ đều chạy, số chính xác trong [bằng chứng S3-10](evidence/S3-10-test-results.json).

Neon ats_staging/public: 001–008 verified. 008 áp dụng sau regression + real PostgreSQL parity/stress PASS, không seed/import. Smoke rollback 13/13; startup/public/private API/schema/grants 6/6. Fixture count 0. Fingerprint toàn bộ cột Req cũ trước/sau bằng nhau; count dữ liệu nghiệp vụ không đổi.

| Migration | Ledger | Trạng thái |
|---|---|---|
| 001 PostgreSQL base | ats_schema_migrations | VERIFIED, không sửa |
| 002 Approval configuration | ats_approval_configuration_migrations | VERIFIED, không sửa |
| 003 Req approval/revisions | ats_requisition_approval_migrations | VERIFIED, không sửa |
| 004 Headcount | ats_headcount_budget_migrations | VERIFIED, không sửa |
| 005 Copy/assignment | ats_requisition_operation_migrations | VERIFIED, không sửa |
| 006 Lifecycle/public foundation | ats_requisition_lifecycle_migrations | VERIFIED, không sửa |
| 007 Tracking/job draft | ats_requisition_tracking_job_migrations | VERIFIED, không sửa |
| 008 Job publication | ats_job_publication_migrations | APPLIED + VERIFIED trong lượt này |

Tất cả file SQL 001–007 và 4 SQLite runtime có SHA-256 không đổi trong lượt này. SQLite 008 chỉ chạy trong DB cách ly, không chạy runtime.

## Feature flags

Đọc configuration hiện có tại thời điểm bàn giao: các flag dưới đây đều OFF; không thay .env hoặc bật production.

- APPROVAL_CONFIGURATION_ENABLED
- REQUISITION_APPROVAL_ENABLED
- HEADCOUNT_BUDGET_ENABLED
- REQUISITION_OPERATIONS_ENABLED
- REQUISITION_LIFECYCLE_ENABLED
- REQUISITION_TRACKING_ENABLED
- JOB_POSTING_DRAFTS_ENABLED
- JOB_POSTING_PUBLICATION_ENABLED

Test/smoke bật các flag chỉ trong tiến trình. Trước rollout thực tế cần review source, cấu hình chain/users/budgets phù hợp và xác nhận flags cho từng môi trường; không bật budget guard khi chưa khai báo quota. Không suy ra server production đang phục vụ Sprint3 chỉ từ việc migration đã applied.

## Nghiệm thu

**SPRINT 3: IMPLEMENTATION + AUTOMATED PASS; CHƯA NGHIỆM THU CHÍNH THỨC.**

Còn NOT RUN: Browser E2E/visual desktop-mobile/branding vì browser runtime không có instance kết nối. Cần người dùng kiểm tra trải nghiệm, dài-ngắn nội dung, spacing và preview thực tế ở 360px/desktop. Không có BLOCKED implementation chưa chốt chính sách trong phạm vi S3-10; các quyết định đã nhận gồm expiry, self review và source revision visibility. Không triển khai Sprint 4, auto daily expiry job, third-party publishing, CV/apply/search portal hoặc automatic authorization.

Các manual/external/deferred của Sprint 1/2 (delivery email, visual usability, future Offer/evaluation integration) không được biến thành implementation FAIL hoặc tuyên bố 100% nghiệm thu bởi lượt này.

Hướng dẫn reviewer và chi tiết: [S3-10](S3-10-job-publication.md), [S3-08/S3-09](S3-08-S3-09-tracking-job-drafts.md), [RBAC](RBAC-admin-permissions.md).
