# QA-S3-06 — Bắt buộc phê duyệt trước khi mở tuyển dụng

Ngày 13/10/2026. Triển khai và regression **PASS trong clone cô lập**. Snapshot trước commit/push được người dùng cho phép; chưa triển khai Neon; không ký nghiệm thu người dùng hoặc production thay người có thẩm quyền.

## A. Baseline, clone và bảo vệ workspace

- Clone triển khai chính thức: `C:\ATS_QA_S3_06_20261013-0c03b4b2`.
- Nhánh: `fix/qa-s3-06-approval-before-open`, HEAD không đổi: `7ddee02bdf6256caa37e18e7a378f6ca78b6d190`, develop đã xác minh từ remote sau PR #6.
- Workspace gốc: `A:\Projects\TTCS_T926_K3S4_N2`, nhánh `fix/s4-job-posting-regressions`, HEAD `2b1c8ec5ee1eca4cde75c608f5d6743c86c9d1bd`. Tree trùng baseline develop; không dùng DB/migration modified của gốc làm nền.
- Baseline 49/49 script exit 0. Lượt cuối 50/50 script exit 0, thêm QA-S3-06.
- Hash của 500 file gốc, branch, HEAD và status đầy đủ untracked giữ nguyên. Bốn DB runtime, migration lịch sử và evidence cũ không đổi. Runtime DB và migration 001–009 trong clone cũng không đổi.
- Test chạy trong C:TEMP với source/DB mới cho từng suite, không dùng DB tracked của clone, không đọc `.env`, không kết nối Neon, không SMTP thật hoặc bật flags production.

## B. Nguyên nhân và thay đổi triển khai

Chính sách cũ S2-10 cho phép tạo/lưu OPEN; workflow độc lập chỉ được tạo khi người dùng gửi riêng. Đây là thay đổi nghiệp vụ đã chốt, không phải lỗi routing. Không dùng hai API tuần tự hoặc chỉ ẩn nút để thực thi chính sách.

Command mới `POST /api/v1/requisition-approvals/save-and-submit` nhận `requestId`, `document`; sửa nháp có `requisitionId`, `expectedDraftVersion`, `expectedWorkflowVersion` nếu đã có vòng kết thúc. Backend tự giữ DRAFT; từ chối payload giả APPROVED/legacy/creator.

Một transaction kiểm tra actor/quyền/sở hữu, hồ sơ S2-10, ngày, salary/giải trình, resolver hạn mức, assignee, cấm tự duyệt/trùng người; lưu DRAFT, submission/snapshot/steps, reservation và event. Lỗi bất kỳ rollback toàn bộ. API chuẩn, legacy và alias không tạo OPEN mới hay đổi DRAFT→OPEN trực tiếp. DRAFT PENDING không được sửa âm thầm.

Cấp cuối kiểm tra lại ngày cần người, snapshot/version/hash và ngân sách; lưu quyết định thật, proof submission/event/hash, chuyển usage và OPEN nguyên tử. Reject/Request Info bắt buộc ý kiến; main vẫn DRAFT và giải phóng reservation ban đầu. Gửi lại tạo submission mới từ cấp 1, giữ toàn bộ vòng cũ.

ADMIN không vượt assignee, cấm tự duyệt hay trạng thái. HR/Admin không được xem/sửa/gửi DRAFT riêng của người khác. Reviewer được đọc snapshot đã gửi trong phạm vi workflow, không đọc nội dung nháp chưa gửi. Guard Candidate/Interview/Offer kiểm tra quyền trước lỗi trạng thái và kiểm tra Requisition cả khi chỉ nhận candidate ID.

## C. File và phạm vi commit đề xuất

| File | Thay đổi / lý do |
|---|---|
| `README.md` | Hướng dẫn local DRAFT → gửi duyệt → OPEN và migration hiện hành. |
| `backend/src/controllers/requisitionApprovalController.js` | Command route mới; options draftVersion; bảo toàn salaryRangeStatus an toàn. |
| `backend/src/db/migrate-requisition-open-policy.js` | Ledger checksum chuẩn LF, transaction, verify, idempotency và CLI riêng. |
| `backend/src/db/migrations/010_requisition_open_policy_postgres.sql` | Migration mới: metadata, cutover active historical, classification bất biến, enroll STRICT và guard/version trigger. |
| `backend/src/db/migrations/010_requisition_open_policy_sqlite.sql` | Migration mới: metadata, cutover active historical, classification bất biến, enroll STRICT và guard/version trigger. |
| `backend/src/db/seed-local-demo.js` | Demo dùng DRAFT và quyết định duyệt thật trước OPEN. |
| `backend/src/db/setup-local.js` | Bổ sung migration 010 cho DB demo riêng. |
| `backend/src/server.js` | Startup migrate SQLite/verify PostgreSQL 010; flag OFF và mapping lỗi nghiệp vụ. |
| `backend/src/services/headcountBudgetService.js` | DRAFT PENDING giữ reservation; final thành usage; legacy baseline; khóa xác nhận ngoại lệ theo thứ tự. |
| `backend/src/services/jobPostingPublicationService.js` | Public fail closed khi thiếu metadata hoặc proof/hash không phù hợp. |
| `backend/src/services/jobPostingService.js` | Xác minh nội dung có hiệu lực trước khi soạn tin. |
| `backend/src/services/requisitionApprovalService.js` | Save-and-submit nguyên tử; snapshot DRAFT; final kích hoạt OPEN/proof; gửi lại, quyền snapshot, khóa và replay. |
| `backend/src/services/requisitionOpenPolicyService.js` | Boundary chính sách; kiểm tra metadata, effective proof/hash, payload giả mạo và version DRAFT. |
| `backend/src/services/requisitionService.js` | Chặn tạo/kích hoạt OPEN trực tiếp, version DRAFT, trạng thái hiển thị; kiểm tra phạm vi trước guard downstream. |
| `backend/tests/helpers/approvalPolicyFixture.js` | Fixture dùng quyết định thật và đúng assignee, không tạo APPROVED giả. |
| `backend/tests/helpers/coverageApplication.js` | Hook tùy chọn dựng fixture lịch sử trước startup/migration để kiểm thử cutover. |
| `backend/tests/test_ats_e2e.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_browser_e2e.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_candidate_stage.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_final_rbac_open.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_postgres_migration.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_postgres_startup.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_qa_s3_06.js` | 73 case SQLite/PGlite/HTTP/migration/bypass/rollback/race và lịch sử. |
| `backend/tests/test_rbac_admin.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_requisition_access.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_requisition_reapproval.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s2_10_integration.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s2_integration.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_01_integration.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_02_integration.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_03_04.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_05_06.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_07.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_08_09.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s3_10.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `backend/tests/test_s4_candidate_portal.js` | Cập nhật fixture/version/assertion xung đột trực tiếp chính sách; giữ validation, RBAC, phạm vi và lịch sử. |
| `docs/QA-S3-06-approval-before-open.md` | Báo cáo hoặc bằng chứng QA-S3-06 mới; không ghi đè evidence cũ. |
| `docs/evidence/QA-S3-06-approval-before-open.json` | Báo cáo hoặc bằng chứng QA-S3-06 mới; không ghi đè evidence cũ. |
| `frontend/components/create-req-modal.html` | Thay hành động chính thành Lưu và Gửi phê duyệt. |
| `frontend/js/components/requisition-approval.js` | Gửi DRAFT theo version; sửa/gửi lại bằng command; giữ OPEN reapproval. |
| `frontend/js/components/requisition-form.js` | Command thống nhất, optimistic version, requestId retry, chống gửi trùng. |
| `frontend/js/pages/requisitions.js` | Hiển thị trạng thái phê duyệt/người đang chờ riêng với trạng thái tuyển dụng. |
| `package.json` | Thêm test:qa-s3-06 và migrate:qa-s3-06; không thêm dependency. |


Sáu screenshot trong `docs/evidence/QA-S3-06-approval-before-open/`: approval-history, flags-off, public-desktop/mobile và preview-desktop/mobile. JSON liệt kê đầy đủ 52 file sửa/tạo. Không đề xuất commit trace lớn, log C:TEMP, `.local`, `.env`, DB runtime, migration lịch sử hoặc evidence cũ.

## D. Ma trận trạng thái

| Tình huống | Requisition | Workflow |
|---|---|---|
| Lưu nháp mới | DRAFT | Chưa có; hiển thị Chưa gửi |
| Lưu và Gửi phê duyệt | DRAFT | PENDING cấp 1 |
| Duyệt cấp chưa cuối | DRAFT | PENDING cấp tiếp theo |
| Duyệt cấp cuối | OPEN | APPROVED |
| Từ chối / bổ sung lần đầu | DRAFT | REJECTED / NEEDS_INFO |
| Sửa và gửi lại | DRAFT | Submission mới PENDING từ cấp 1 |
| Tái phê duyệt OPEN | Giữ main OPEN đang có hiệu lực | PENDING mới |
| Revision bị từ chối / cần bổ sung | Giữ main OPEN cũ | REJECTED / NEEDS_INFO |
| Revision duyệt đủ | OPEN với revision mới | APPROVED |
| Approval flag OFF, hồ sơ mới | Chỉ DRAFT | Không gửi/kích hoạt |
| Legacy OPEN/IN_PROGRESS/PAUSED | Giữ trạng thái/nội dung lịch sử | Không giả lập APPROVED |


Số cấp theo resolver S3-01: dưới/bằng hạn mức không thêm cấp; vượt thì bổ sung cấp tiếp theo. Không ép hai cấp. NOT_SUBMITTED chỉ là nhãn hiển thị, không thêm enum.

## E. Kết quả thực tế và lệnh

`npm run test -- --all`: **exit 0, 50/50 script PASS**. Từng dòng tương đương `npm run test:local -- <script>`. Log, duration và exit code chính xác ở JSON.

| Script qua runner cách ly | Kết quả | Bộ đếm | Exit | Giây |
|---|---|---|---|---|
| `test:browser-e2e` | PASS | 65/65 case | 0 | 94.261 |
| `test:user-list-batch` | PASS | 16/16 case | 0 | 4.198 |
| `test:candidate-stage` | PASS | 52/52 case | 0 | 7.095 |
| `test:s1-frontend-fixes` | PASS | 18/18 case | 0 | 4.287 |
| `test:final-rbac-open` | PASS | 33/33 case | 0 | 9.956 |
| `test:requisition-access` | PASS | 16/16 case | 0 | 6.958 |
| `test:ats-e2e` | PASS | 51/51 case | 0 | 13.762 |
| `test:rbac` | PASS | 47/47 case | 0 | 9.847 |
| `test:s3-02` | PASS | 93/93 case | 0 | 10.707 |
| `test:s3-01` | PASS | 108/108 case | 0 | 6.115 |
| `test:postgres` | PASS | 15/15 case | 0 | 4.966 |
| `test:review-updates` | PASS | 22/22 case | 0 | 6.540 |
| `test:s1-01` | PASS | 8/8 case | 0 | 2.363 |
| `test:s1-02` | PASS | 5/5 case | 0 | 1.633 |
| `test:s1-03` | PASS | 5/5 case | 0 | 2.791 |
| `test:s1-03:email` | PASS | 49/49 case | 0 | 1.813 |
| `test:s1-04` | PASS | 5/5 case | 0 | 3.279 |
| `test:s1-05` | PASS | 6/6 case | 0 | 1.998 |
| `test:s1-06` | PASS | 3/3 case | 0 | 2.424 |
| `test:s1-07` | PASS | 4/4 case | 0 | 3.757 |
| `test:s1-08` | PASS | 5/5 case | 0 | 1.872 |
| `test:s1-09` | PASS | 7/7 case | 0 | 1.734 |
| `test:s1-10` | PASS | 8/8 case | 0 | 1.720 |
| `test:otp` | PASS | Suite không xuất counter | 0 | 2.262 |
| `test:sprint2` | PASS | 32/32 case | 0 | 4.149 |
| `test:s2-10` | PASS | 60/60 case | 0 | 5.874 |
| `test:routing` | PASS | 188/188 case | 0 | 7.164 |
| `test:user-ux` | PASS | 87/87 case | 0 | 8.165 |
| `test:datetime-dashboard` | PASS | 28/28 case | 0 | 3.917 |
| `test:avatar` | PASS | 21/21 case | 0 | 4.480 |
| `test:mobile-shell` | PASS | 53/53 case | 0 | 8.015 |
| `test:layout` | PASS | 45/45 case | 0 | 2.992 |
| `test:coverage:sprint1` | PASS | 23/23 case | 0 | 6.257 |
| `test:coverage:sprint2` | PASS | 25/25 case | 0 | 4.162 |
| `test:career-upload` | PASS | 24/24 case | 0 | 4.112 |
| `test:user-roles-avatar` | PASS | 17/17 case | 0 | 3.565 |
| `test:sprint1` | PASS | 56/56 case (aggregate lặp S1) | 0 | 11.447 |
| `test:reapproval` | PASS | 94/94 case | 0 | 22.381 |
| `test:s3-03` | PASS | 29/29 case | 0 | 10.572 |
| `test:s3-04` | PASS | 55/55 case | 0 | 16.484 |
| `test:s3-05` | PASS | 36/36 case | 0 | 11.316 |
| `test:s3-06` | PASS | 46/46 case | 0 | 11.725 |
| `test:s3-07` | PASS | 51/51 case | 0 | 13.491 |
| `test:s3-08` | PASS | 27/27 case | 0 | 9.731 |
| `test:s3-09` | PASS | 42/42 case | 0 | 11.378 |
| `test:s3-10` | PASS | 54/54 case | 0 | 19.443 |
| `test:local-demo` | PASS | 20/20 case | 0 | 33.647 |
| `test:postgres:startup` | PASS | 11/11 case | 0 | 1.954 |
| `test:s4` | PASS | 9/9 User Story | 0 | 2.155 |
| `test:qa-s3-06` | PASS | 73/73 case | 0 | 11.894 |

Có 1838 lượt case có counter, gồm 56 case S1 chạy lặp qua aggregate; bỏ aggregate còn 1782 lượt có counter. Không gọi đây là số case độc lập. OTP không xuất counter; Sprint 4 báo 9 User Story, không cộng thành case. Lượt cuối không có FAIL hoặc SKIP được báo.

Lượt trước có routing bị ngắt sau khoảng 6,9 giờ wall time, exit 1, không ghi assertion FAIL. Giữ bằng chứng lần ngắt; chạy lại riêng đạt 188/188 exit 0; toàn bộ lượt cuối cũng đạt 188/188 exit 0. Không sửa assertion routing để làm xanh.

## F. Regression và assertion chính sách

Sprint 1 56/56 và coverage 23/23; Sprint 2 common 32/32 và coverage 25/25; S2-10 60/60. S3-01→S3-10 lần lượt 108, 93, 29, 55, 36, 46, 51, 27, 42, 54 case PASS. Reapproval 94/94. Sprint 4 9/9 User Story PASS.

Assertion được đổi: tạo mới/hoàn tất nháp không còn kỳ vọng OPEN trực tiếp; dùng command và kiểm tra DRAFT PENDING, chỉ final OPEN. Flag OFF phải chặn gửi/kích hoạt. Update DRAFT truyền document version. Response legacy giữ trường cũ và thêm draftVersion. Mock frontend/request selector dùng endpoint mới. Validation salary/date/budget được kiểm tra qua command, vẫn giữ assertion dữ liệu an toàn.

Fixture OPEN thông thường dùng quyết định thật đúng assignee. Fixture legacy được dựng trước migration hoặc dùng seed tồn tại trước cutover; không đánh dấu hồ sơ mới là grandfathered. Giữ kiểm tra ownership, retry, rollback, salary confidentiality, IDOR và UI legacy. Không cấp thêm candidate.update cho Hiring Manager; không đổi Offer approval.

## G. Migration, rollback, concurrency và API bypass

Migration mới `010_requisition_open_policy_sqlite.sql` / `_postgres.sql`, runner và ledger riêng; không sửa 001–009. Metadata: policy kind, integer document_version, submission/event có hiệu lực và hash nội dung. Cutover chỉ phân loại OPEN/IN_PROGRESS/PAUSED đang tồn tại; không đổi main/status, không tạo workflow giả; CLOSED/CANCELLED không được mở lại. INSERT mới là STRICT; thiếu metadata fail closed. Trigger bảo vệ phân loại, OPEN/IN_PROGRESS và tăng version nội dung. Service xác minh proof từ event APPROVE cuối thực tế; client không tự ghi metadata.

SQLite dùng transaction tuần tự của adapter. PostgreSQL dùng một checked-out client; nested transaction tái sử dụng outer transaction, không tự tạo savepoint; thứ tự request lock → Requisition row → workflow → cấu hình/ngân sách. Budget keys sắp ổn định; xác nhận ngoại lệ khóa Requisition trước budget để tránh đảo khóa với final approval. Event lưu fingerprint và response cho replay; cùng ID khác payload bị conflict. Workflow version + step ID chặn retry quyết định cũ; document_version chặn stale draft.

QA-S3-06 73/73 kiểm tra SQLite/PGlite, HTTP aliases/authentication, một/nhiều cấp và ngưỡng, flag OFF, quyền/assignee/tự duyệt, stale draft, gửi/duyệt đồng thời, downstream, proof/hash, legacy baseline và reapproval. Inject lỗi workflow/snapshot/reservation/audit/OPEN update đều rollback. Ledger failure rollback DDL; migration rerun không phân loại lại và giữ dữ liệu lịch sử trên cả SQLite/PGlite.

DRAFT chưa gửi không giữ budget. DRAFT PENDING giữ toàn nhu cầu; final thành usage, không cộng trùng. Reapproval giữ main và reservation phần chênh lệch theo S3-04. Legacy vẫn có baseline. Revision chưa duyệt không xuất hiện như main trong list/report/public; tin cũ dùng effective content cho đến khi revision mới duyệt theo S3-10.

## H. Browser và NOT RUN

Chromium/Playwright thật **65/65 PASS**: desktop/mobile, vai trò, gửi nháp → duyệt → recruiter → soạn tin → duyệt/xuất bản → public/preview, lifecycle và tám flags ON/OFF trong test process. Setup demo sạch **20/20 PASS**. Sáu screenshot mới đính kèm; traces redacted ở `C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-dpxPNq\test-browser-e2e-browser`, không đề xuất commit trace.

- PostgreSQL embedded/PGlite: PASS, migration/SQL/adapter/transaction parity và race service.
- PostgreSQL pg-wire thật: **PASS 38/38**, PostgreSQL 17.10 local, role không superuser, public schema và 10 clients/PID độc lập; xem xác minh cuối bên dưới.
- Neon: **NOT RUN theo ràng buộc**, không kết nối/migrate/seed/import.
- SMTP thật: **NOT RUN**, chỉ simulated/stub.
- User/brand signoff: chưa ký thay người dùng.

Không còn nhánh nghiệp vụ BLOCKED của QA-S3-06 sau lượt cuối. Giới hạn triển khai thật: migration 010 chưa áp dụng trên production và pg-wire chưa xác minh.

## I. Chất lượng và dữ liệu

`node --check`: **164/164 file JS PASS**. `git diff --check`: **exit 0**. Staged diff rỗng. Không thêm comment source/test/SQL, dependency hoặc thay lockfile. Diff scan không thấy connection URI Neon/PostgreSQL hay private key mới. Hash before/after trong JSON xác nhận file được bảo vệ không đổi. 39 file code thay đổi ở các bản sao của cả 50 suite khớp source cuối, không có mismatch.

## J. Kiểm thử thủ công và vận hành

Dùng clone và profile DB `.local` riêng: `npm ci`, `npm run setup:local`, `npm run start:local`; không migrate/seed workspace gốc. Tài khoản demo trong README.

1. Hiring Manager lưu nháp: DRAFT, không workflow/reservation. Lưu và Gửi phê duyệt hồ sơ hợp lệ: DRAFT PENDING, chỉ đúng cấp 1 nhận việc.
2. Chuỗi nhiều cấp: sau cấp 1 vẫn DRAFT; final OPEN. Chuỗi một cấp: cấp đó mở OPEN.
3. Reject/Request Info thiếu ý kiến bị chặn; có ý kiến vẫn DRAFT; sửa/gửi lại bắt đầu cấp 1 và giữ vòng cũ.
4. API tạo OPEN, DRAFT→OPEN, giả APPROVED/legacy, wrong role/ID, stale version và gửi trùng phải bị chặn.
5. OPEN đã duyệt: nhóm A trực tiếp; nhóm B giữ main cũ đến final. HR/Admin gửi thay OPEN bắt buộc lý do; không gửi DRAFT riêng của người khác.
6. Tắt approval trong test process: chỉ lưu nháp; lỗi rõ cần bật/cấu hình. Không bật/tắt flags production.

PostgreSQL cần được cho phép triển khai riêng, áp dụng 010 bằng runner rồi verify trước startup; không bypass lỗi migration. Không có thao tác Neon trong task này.

## K. Phạm vi commit/push được ủy quyền; không tạo PR

Commit: `fix(qa-s3-06): require approval before opening recruitment`. PR riêng vào develop: request mới giữ DRAFT đến final; save/submission/snapshot/reservation/audit nguyên tử; grandfathering tại cutover; reapproval giữ main; 50 script, Browser 65, QA 73 PASS.

Danh sách commit đề xuất ở JSON gồm source, frontend, migration mới, test, README và docs/bằng chứng mới. Người dùng đã cho phép một commit và push nhánh QA-S3-06 sau kiểm thử. Không merge/rebase/tạo PR hoặc đổi dữ liệu workspace gốc. Đây là snapshot trước thao tác Git được ủy quyền. Live PostgreSQL, deployment và UAT được ghi riêng, không suy luận đã nghiệm thu production.

## Remediation findings pre-commit — cùng QA-S3-06

Kết luận: **READY WITH DOCUMENTED RISKS**. Không tạo commit/PR khác; mọi thay đổi vẫn chưa stage.

- High XSS: escape toàn bộ statusText và text cùng loại; attribute dùng thêm encode dấu nháy. Không xóa hoặc sanitize dữ liệu tên đầu vào để làm xanh. Test backend lưu tên chứa `<img src=x onerror="window.__qaReviewXss=1">` vào cấu hình/snapshot và đọc đúng qua API; Browser nhận payload và xác nhận text, không img/event attribute, marker không kích hoạt. Kiểm tra thêm title attribute injection/department markup và tên bình thường.
- Medium negative coverage: whitelist fixture bình thường giữ nguyên. Các negative requests dùng raw document; assertion kiểm tra body JSON thực sự serialize gửi đi có standardMin, standardMax, requireJustification. Cả trường hợp dưới/vượt khung đều bị backend từ chối; main/metadata/workflow/snapshot/event counts không đổi. Không sửa validation backend.
- Medium contract: deepEqual exact bảy response keys gồm draftVersion; khôi phục recruiterId sau handover. Sprint 2 common 32/32 và S3-01 108/108 PASS.
- Low tài liệu: nested transaction tái sử dụng outer transaction, không tự tạo savepoint. Không dùng mô tả savepoint để suy luận tính độc lập rollback nested scope.

Test mới: S2-10 case 60 PASS; QA stored-approver-markup trên SQLite/PGlite PASS; Browser XSS case PASS. Tổng cuối: 50/50 script exit 0, S2-10 60/60, QA 73/73, Browser 65/65. Các lượt fixture Browser ban đầu bị FAIL đã được giữ ở JSON: synchronization loading row và alias items/requisitions được sửa; không bỏ hoặc nới assertion. Kết quả cũ trước remediation lưu riêng, không dùng thay lượt chạy cuối.

Chỉ sáu file code/test thay đổi thêm: frontend/js/pages/requisitions.js và các test_s2_10_integration, test_s2_integration, test_s3_01_integration, test_qa_s3_06, test_browser_e2e. Helper whitelist và backend validation/budget/QA-S3-04/QA-S3-05 không đổi trong lượt remediation. Cập nhật Markdown/JSON và thêm qa-s3-06-xss-safe.png; sáu PNG bằng chứng cũ giữ nguyên.

PostgreSQL thật vẫn **NOT RUN**: chưa có server pg-wire cô lập được cấu hình. PGlite không chứng minh stress/deadlock nhiều connection. Trước deployment cần kiểm tra role có quyền DDL, schema/search_path public nhất quán (migration dùng tên không qualified, policy lookup dùng public), rồi kiểm tra migration/transaction/concurrency bằng server test. Không kết nối Neon hoặc production. Đây là rủi ro deployment được ghi nhận, không phải kết quả FAIL được tái hiện.

## Xác minh cuối và commit/push được ủy quyền — 13/10/2026

`npm run test -- --all`: exit 0, 50/50 script PASS. Alias test dùng runner cách ly hiện có; pg-wire test chạy riêng, không tính NOT RUN thành PASS. QA 73/73, Browser 65/65, S2-10 60/60; Sprint 1–4/security/RBAC/reapproval/migration regression PASS; syntax 164 file JS PASS. Không có lỗi Critical/High/Medium đã biết chưa xử lý thuộc QA-S3-06.

Docker daemon không chạy nhưng PostgreSQL local khả dụng. PostgreSQL 17.10 dùng initdb tạo cluster mới trong C:TEMP, bind 127.0.0.1 ở cổng riêng; database test mới, role qa_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE. Schema public/DDL grants và search_path đã kiểm tra. Không kết nối database làm việc, service khác hoặc Neon; email simulated. Cluster đã dừng, pg_ctl status và postmaster.pid xác minh không còn server.

`npm run test:qa-s3-06:pg-live` trong bản sao không .git/.env: exit 0, 32/32 core cases + 6/6 pg-wire checks. Có 10 clients/PID độc lập. Migration 001–010 rerun/verify PASS; concurrent quota chỉ chấp nhận một request, loser rollback; 8 final approvals chỉ một quyết định/kích hoạt. Approve/reject race, stale version, workflow/snapshot/reservation/event/activation rollback, legacy/reapproval/RBAC và API bypass được kiểm tra trên PostgreSQL thật. Backend startup/readiness và HTTP standard/legacy aliases PASS.

Các mục PostgreSQL NOT RUN trong phần remediation trước là trạng thái lịch sử; kết quả cuối hiện PASS. Vẫn không kiểm thử Neon PostgreSQL 18/pooled endpoint, không deploy hoặc bật production flags, không ký UAT/brand thay người dùng. PostgreSQL 17 local không thay thế kiểm thử cấu hình production.

Bổ sung backend/tests/test_qa_s3_06_pg_live.js; runner loại pg-wire test khỏi aggregate thiếu URL; package.json thêm alias test và script riêng. Không thêm dependency, không sửa migration lịch sử. Manifest cuối 52 file trong JSON; không stage DB runtime/.env/log/temp database/node_modules/evidence cũ. Người dùng cho phép đúng một commit theo message đã chốt và push duy nhất nhánh QA-S3-06; không force push/tạo PR. Commit hash và kết quả push được trả sau thao tác trong hội thoại, không nhúng hash vòng tròn vào commit này.
