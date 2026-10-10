# S3-03 / S3-04 — theo dõi phê duyệt và ngân sách headcount

## Kết quả ngày 08/10/2026

S3-03: 29/29 PASS. S3-04: 55/55 PASS. Các suite mới chạy SQLite cách ly và PostgreSQL PGlite qua adapter dự án; các kiểm tra HTTP/frontend runtime dùng SQLite cách ly. Không gọi các test DOM là Browser E2E. Browser E2E: NOT RUN vì browser runtime không có browser khả dụng.

36 suite cách ly PASS, 1 suite PostgreSQL live cách ly NOT RUN vì chưa có PostgreSQL pg-wire riêng. Tổng 1325 lượt case PASS, hoặc 1269 nếu bỏ 56 case aggregate Sprint 1 chạy trùng. Smoke Neon riêng: 12/12 PASS, luôn rollback fixture. Các số trên không phải số acceptance criteria độc lập.

## S3-03

| Acceptance Criteria | Implementation và bằng chứng | Kết quả |
|---|---|---|
| Chuỗi cấp duyệt | Snapshot S3-01; bulk query tất cả step; thứ tự revision rồi level_order | PASS |
| Cấp đã duyệt và đang chờ ai | Status từng step và waitingFor chỉ ở vòng hiện hành PENDING | PASS |
| Người duyệt, thời gian, ý kiến | Assigned approver từ step; actual actor, UTC timestamp, comment từ event bất biến | PASS |
| Lịch sử không sửa/xóa | Không có API mutation; trigger S3-02 chặn update/delete; giữ nguyên nhiều vòng | PASS |

GET `/api/v1/requisition-approvals/by-requisition/:requisitionId` bổ sung DTO tracking riêng; không thay response các API cũ. Backend lấy quyền hiện hành từ DB, kiểm tra requisition.read và phạm vi requisition trước khi trả lịch sử. HIRING_MGR ngoài phạm vi nhận403; ID không tồn tại404; người chưa đăng nhập401. Không trả salary standard hoặc snapshot nội dung đầy đủ qua DTO tracking.

Panel tích hợp trong Chi tiết legacy và form S2-10: loading, empty, error/retry, vòng hiện tại và vòng lịch sử. Text được tạo bằng textContent. Khi đổi ID, tài khoản, trang hoặc đóng modal, response cũ không được gắn vào panel mới. Không sửa CSS chung hoặc Offer approval.

Query count không tăng khi thêm vòng/step: ba bulk query cho submission/snapshot, steps và events; ghép bằng Map. Các query quyền/phạm vi cố định còn lại không phải N+1 theo số cấp duyệt.

## Quy tắc S3-04 đã chốt

- Chỉ tiêu tuyển năm bao gồm tăng mới và thay thế; không phải tổng biên chế công ty.
- Năm của neededDate. Lương dự kiến = headcount × proposedSalaryMax/tháng × số tháng từ tháng neededDate đến tháng12, tính cả tháng cần người. Ví dụ tháng6 =7tháng; tháng12 =1tháng. Tổng làm tròn lên đến một VND để không đánh giá thấp chi phí.
- DRAFT không giữ quota; OPEN/IN_PROGRESS giữ quota. CLOSED chỉ tiếp tục tính nếu đã được phê duyệt và từng giữ quota sau khi tính năng hoạt động.
- OPEN lịch sử có tài chính/ngày hợp lệ được đọc để tính usage, không cập nhật hồi tố bản ghi. CLOSED lịch sử chưa có participation không bị suy đoán là đã giữ. Hồ sơ thiếu ngày không bị đoán năm; hồ sơ có ngày nhưng thiếu tài chính cần xử lý trước khi cấu hình ngân sách năm đó.
- Revision đang chờ duyệt giữ chênh lệch so với main đã phê duyệt trong cùng department/year. Với hồ sơ chưa từng duyệt, reservation thay thế toàn bộ contribution chưa được duyệt để tránh cộng trùng. Đổi department/year giữ quota riêng tại đích, giải phóng nguồn sau khi áp dụng revision.
- REJECT/NEEDS_INFO giải phóng reservation của revision; main từng được duyệt vẫn giữ nguyên. REJECT trước lần duyệt đầu không tính used quota. Không bổ sung trạng thái hủy hoặc UI hủy mới; trạng thái không nằm trong OPEN/IN_PROGRESS/qualified CLOSED không được tính.
- Không giảm quota/payroll dưới phần main và reservation đã giữ. Budget version và exception là append-only.
- Ngoại lệ chỉ actual HR_MANAGER/ADMIN, có quyền override và lý do bắt buộc. Ngoại lệ gắn request, tuple tài chính, budget version và mức vượt cụ thể. Thay đổi tuple/version hoặc usage làm vượt hơn mức đã xác nhận thì phải xác nhận lại.
- Final approval kiểm tra lại ngân sách trước khi áp dụng nhóm B. Không bao giờ đẩy nội dung chưa duyệt vào main/list/report.

## S3-04 Acceptance Criteria

| Acceptance Criteria | Bằng chứng | Kết quả |
|---|---|---|
| Khai báo theo phòng ban/năm | Unique department/year, optimistic version, immutable version history | PASS |
| Yêu cầu mới hiển thị còn lại | API availability, preview dùng số server, tự tính lại theo department/quantity/neededDate/max salary | PASS |
| Vượt quota bị chặn | Backend kiểm tra tạo OPEN, hoàn tất DRAFT, submit/resubmit và final; salary cap độc lập; rollback khi lỗi | PASS |
| HR xác nhận ngoại lệ có lý do | HR/ADMIN override theo chính sách đã xác nhận; reject HM kể cả forged role/manual grant; immutable audit | PASS |

## Schema và transaction

Migration mới004 có PostgreSQL và SQLite riêng, không sửa001/002/003:

- headcount_budgets: một department/year, pointer current_version.
- headcount_budget_versions: quota/payroll, version, actor name/id, reason/time; immutable.
- headcount_budget_participation: theo dõi request đã giữ và đã duyệt.
- headcount_budget_reservations: một reservation hiện hành/request; liên kết submission, hash tài chính, pending delta.
- headcount_budget_exceptions: request/version/hash, quota tại thời điểm xác nhận qua immutable version, mức vượt, confirmer/name/reason/time; immutable.

SQLite dùng transaction queue hiện có; PostgreSQL dùng transaction trên một checked-out client và advisory lock theo department/year theo thứ tự ổn định. Final approval, main, participation, release reservation, step/workflow/event nằm trong cùng transaction. Test chèn lỗi khi ghi event cuối xác minh rollback toàn bộ. Retry/concurrent resubmit giữ một revision/reservation; concurrency create không cùng tiêu quota cuối.

PGlite dùng một embedded engine có hàng đợi connection: kiểm tra PostgreSQL SQL/constraint/transaction và concurrent callers ở adapter, không thay thế stress test nhiều pg-wire client. Smoke Neon dùng một transaction rollback, không đo stress pooling/concurrency hoặc browser.

## API và quyền

| Endpoint | Quyền |
|---|---|
| GET /api/v1/headcount-budgets?year=YYYY | headcount_budget.read và scope |
| GET /api/v1/headcount-budgets/options | headcount_budget.read; department được quản lý |
| GET /api/v1/headcount-budgets/availability | read/scope; departmentId, year; tùy chọn headcount, proposedSalaryMax, neededDate, requisitionId |
| GET /api/v1/headcount-budgets/history | read/scope; immutable versions/exceptions |
| POST /api/v1/headcount-budgets | manage và actual HR/ADMIN; departmentId/year/approvedHeadcount/annualSalaryBudget/expectedVersion/reason |
| POST /api/v1/headcount-budgets/exceptions | override và actual HR/ADMIN; requisitionId/expectedVersion/reason/document tài chính tùy chọn |

HR_MANAGER manage/read/override; HIRING_MGR chỉ read phòng ban có manager_id trùng ID thực; ADMIN toàn quyền RBAC nhưng không bỏ qua validation/quota/reason. Các vai trò khác không được cấp budget permissions. Không cho HM xem dải lương chuẩn qua tính năng này.

HEADCOUNT_BUDGET_ENABLED mặc địnhfalse. OFF giữ flow cũ; API budget trả S304_DISABLED và menu bị ẩn. Không tự bật flag trong .env. Khi ON, startup chỉ verify migration; không tự chạy DDL/seed.

Migrate004 đồng bộ quyền additive/idempotent: budget permissions và requisition.edit/requisition.draft.edit phụ thuộc theo ma trận đã chốt. Chỉ thêm permission/grant còn thiếu; không xóa grant cũ, không gọi full sync/seed. Grant edit vào HR_MANAGER/HIRING_MGR/RECRUITER; draft.edit vào HR_MANAGER/HIRING_MGR. ADMIN dùng cơ chế full RBAC tập trung. Không cấp edit cho APPROVER/INTERVIEWER/CANDIDATE.

## Neon

Read-only preflight: ats_staging/public,001checksum khớp; chưa có bảng/ledger002/003/004. Đã áp dụng lần lượt002,003,004 và verify checksum/schema. Domain table counts trước/sau migration giữ nguyên. Chỉ thêm schema, ledger và các permission/grant phụ thuộc đúng chính sách; không seed/import hoặc sửa nội dung nghiệp vụ cũ.

Smoke đầu tiên rollback vì Neon thiếu grant requisition.edit từ các thay đổi source trước. Đã bổ sung đồng bộ prerequisite additive, test lại SQLite/PGlite/RBAC/S3/reapproval trước khi đồng bộ grant và chạy lại. Smoke cuối12/12 PASS, fixture count saurollback0. Không tạo session, gọi SMTP/OAuth hoặc lưu test users/requisitions sau smoke.

## Kiểm thử thủ công

1. Dùng bản sao database SQLite độc lập đã có002/003; provider=sqlite, DB_PATH trỏ bản sao, NODE_ENV=development, EMAIL_MODE=simulated trong tiến trình. Không chạy seed/import trên bản gốc. Chạy `npm run migrate:s3-04` rồi kiểm tra migration.
2. Bật APPROVAL_CONFIGURATION_ENABLED, REQUISITION_APPROVAL_ENABLED và HEADCOUNT_BUDGET_ENABLED trong tiến trình kiểm thử; không đổi .env thật. Trên Neon schema đã chuẩn bị; việc bật flag trong tiến trình triển khai cần thực hiện chủ động.
3. HR tạo quota theo department/year; HM chỉ thấy department mình quản lý. Đổi giới hạn tạo version mới, lịch sử giữ nguyên.
4. HM tạo DRAFT, xem còn lại và chi phí khi đổi tháng/quantity. Hoàn tất OPEN trong quota, rồi thử vượt quota phải bị chặn. HR xác nhận đúng request/tuple và lý do; bước xác nhận không tự lưu OPEN hoặc gửi duyệt.
5. Gửi duyệt rõ ràng, mở Chi tiết xem từng cấp/người/time/comment; info/resubmit tạo vòng mới từ cấp1. Kiểm tra OPEN nhóm B giữ main cũ, reservation không cộng trùng, final mới áp dụng main.
6. Kiểm tra desktop/mobile, error/retry/loading, modal stale response, lịch sử nhiều vòng, Network/Console và ảnh minh chứng. Các mục này chưa được xác minh bằng browser trong môi trường Codex hiện tại.

Email delivery thật S1-03/S1-08, mobile visual S1-06, Career Page visual S2-09 và dependencies Offer/Sprint6 không bị tuyên bố automated FULL bởi nhiệm vụ này.

## File thay ??i trong nhi?m v?

- `backend/src/controllers/headcountBudgetController.js`
- `backend/src/controllers/requisitionApprovalController.js`
- `backend/src/db/migrate-headcount-budgets.js`
- `backend/src/db/migrations/004_headcount_budgets_postgres.sql`
- `backend/src/db/migrations/004_headcount_budgets_sqlite.sql`
- `backend/src/db/sync-permissions.js`
- `backend/src/services/headcountBudgetService.js`
- `backend/src/services/requisitionApprovalService.js`
- `backend/tests/test_s3_03_04.js`
- `docs/ATS-E2E-2026-10-08-evidence.json`
- `docs/ATS-E2E-2026-10-08.md`
- `docs/RBAC-admin-permissions.md`
- `docs/S3-03-S3-04-tracking-headcount.md`
- `frontend/components/requisition-approval-modal.html`
- `frontend/js/components/requisition-approval.js`
- `frontend/js/components/requisition-tracking.js`
- `frontend/js/pages/headcount-budgets.js`
- `frontend/pages/headcount-budgets.html`
- `backend/src/config/config.js`
- `backend/src/server.js`
- `backend/src/services/requisitionService.js`
- `backend/tests/test_frontend_routing.js`
- `backend/tests/test_shared_layout.js`
- `frontend/components/create-req-modal.html`
- `frontend/components/requisition-detail-modal.html`
- `frontend/index.html`
- `frontend/js/api.js`
- `frontend/js/components/navigation.js`
- `frontend/js/components/requisition-detail.js`
- `frontend/js/components/requisition-form.js`
- `frontend/js/services/session.js`
- `frontend/js/shared/route-lifecycle.js`
- `frontend/js/shared/state.js`
- `frontend/routes.json`
- `package.json`

C?c n?n t?ng S3-01/S3-02/RBAC/t?i ph? duy?t ?? c? trong working tree tr??c nhi?m v? nh?ng ch?a c? trong HEAD; ch?ng c?n ???c gi? trong l?ch s? t?ch h?p ?? commit S3-03/S3-04 ch?y ??c l?p. Database runtime, .env v? n?i dung migration l?ch s?001/002/003 kh?ng ???c ch?nh s?a ho?c ??a database v?o commit.

## Regression sau t?ch h?p develop

T?ch h?p fast-forward t?i source commit5a5af11, b?o to?n origin/develop trong l?ch s?. Ch?y l?i to?n b?37script tr?n b?n sao TEMP c?a worktree develop; kh?ng thay source/data trong worktree. Th?m ki?m th? startup tr?c ti?p11/11.

| Suite | K?t qu? | Cases |
|---|---|---|
| test:sprint1 | PASS | 56/56 |
| test:final-rbac-open | PASS | 33/33 |
| test:requisition-access | PASS | 16/16 |
| test:ats-e2e | PASS | 51/51 |
| test:rbac | PASS | 47/47 |
| test:s3-02 | PASS | 93/93 |
| test:s3-01 | PASS | 108/108 |
| test:postgres | PASS | 15/15 |
| test:postgres:live | NOT RUN | ? |
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
| test:routing | PASS | 179/179 |
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
| node backend/tests/test_postgres_startup.js | PASS | 11/11 |

Static123/123, diff --check PASS. Source prerequisite commit3fee92d; S3-03/S3-04 commit5a5af11. Receipt push/ref cu?i ???c b?o ri?ng sau khi push th?nh c?ng; kh?ng t? ghi tr??c k?t qu? push.
