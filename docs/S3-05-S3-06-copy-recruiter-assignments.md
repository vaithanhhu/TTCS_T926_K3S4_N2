# S3-05 / S3-06 — sao chép và phân công recruiter

## Kết quả ngày 09/10/2026

S3-05 36/36 PASS; S3-06 46/46 PASS. Các case backend chạy SQLite cách ly và PostgreSQL PGlite qua adapter dự án; HTTP/frontend runtime dùng server SQLite thật trong bản sao TEMP. Browser E2E NOT RUN: browser runtime không có browser khả dụng. Không gọi DOM runtime là visual verification.

Toàn bộ 38 npm suites có thể chạy cách ly PASS; npm PostgreSQL live cách ly NOT RUN vì chưa có PostgreSQL pg-wire riêng. Kiểm thử startup trực tiếp11/11 PASS. Tổng39 bộ PASS,1419 lượt case;1363 nếu bỏ56 case aggregate Sprint1 chạy trùng. Các con số không phải số acceptance criteria độc lập. Neon service smoke riêng15/15 PASS, luôn rollback fixture, không tạo session hoặc gửi email thật.

## Audit và thiết kế tối thiểu

Trước nhiệm vụ, primary recruiter đã nằm trong requisitions.recruiter_id; handover và editor có thể cập nhật cột này nhưng chưa ghi đầy đủ lịch sử phân công. Candidate, Interview và một số đường ghi dùng quyền module mà chưa kiểm tra assignment đầy đủ. Candidate hiện là một application gắn với một requisition_id; chưa có bảng hồ sơ dùng chung/application riêng hoặc schema/API CV/attachment. Không tạo cấu trúc CV mới trong nhiệm vụ này.

Giữ recruiter_id làm nguồn primary tương thích. Bổ sung bảng supports, version, history và receipt; không xây engine phê duyệt thứ hai. Sao chép dùng createRequisition/validation S2-10/mã hiện có. Lịch sử, ngân sách và quan hệ phát sinh không nằm trong whitelist dữ liệu sao chép.

## S3-05 Acceptance Criteria

| AC | Bằng chứng | Kết quả |
|---|---|---|
| Sao chép toàn bộ JD và yêu cầu ứng viên | Giữ nguyên Unicode, khoảng trắng, newline; legacy và S2-10; không sửa source | PASS |
| Bản sao luôn Nháp | Backend ép DRAFT; từ chối OPEN; ID/code mới; UI chỉ có Lưu bản sao nháp | PASS |
| Không kế thừa lịch sử duyệt | Không tạo workflow/snapshot/submission/step/event cho target | PASS |

Bản sao lấy nội dung main đang có hiệu lực, không lấy nội dung revision chờ duyệt. Không sao chép recruiter, supports, handover, candidates, interviews, offers, participation, reservation hoặc budget exception. Test tạo exception/reservation thật trên source xác minh target không kế thừa và usage không đổi.

HIRING_MGR phải có quyền xem source đúng scope và quyền tạo; HR/ADMIN giữ scope hiện hành. DRAFT creator-only được giữ, không mở quyền đọc nháp của người khác cho HR/ADMIN. Nếu department/job title/catalog của source không còn hợp lệ, cần chọn lại theo validation hiện hành. NeededDate quá hạn bắt buộc nhập ngày mới trước khi lưu bản sao. Draft thiếu dữ liệu vẫn theo quy tắc S2-10 hiện có; trước OPEN phải hoàn tất validation/salary/date/budget.

GET context và POST copy dùng transaction, source version/hash; POST khóa source, dùng receipt theo actor/requestId và mã requisition hiện có. Retry cùng payload trả bản đã tạo; dùng lại requestId cho dữ liệu khác bị409. Request khác tạo copy khác với code riêng. Receipt failure rollback target. UI chống submit lặp, response cũ và mở modal sau khi rời trang.

## S3-06 Acceptance Criteria

| AC | Bằng chứng | Kết quả |
|---|---|---|
| Một primary và nhiều supports | Cột primary hiện có; supports PK(req,user); role/status validation; chống trùng chính/hỗ trợ | PASS |
| Recruiter chỉ thấy ứng viên vị trí được giao | Scope SQL trên list/detail/search/filter/pipeline/Interview/Offer/report; primary và support; thu hồi ngay ở request tiếp theo | PASS |
| Có lịch sử chuyển giao | Actor/time/reason/type/old/new snapshots; version và audit cùng transaction; DB/API bất biến | PASS |

Quyền quản lý mới requisition.assign chỉ HR_MANAGER; ADMIN có toàn quyền RBAC tập trung nhưng vẫn chịu validation/state. HIRING_MGR chỉ đọc assignment trong scope. REC xem vai trò PRIMARY/SUPPORT của mình. DRAFT giữ creator-only; OPEN/IN_PROGRESS cho quản lý; CLOSED không cho phân công lại. Có thể để chưa phân công, tối đa một primary; không tự chọn người thay thế.

New assignment API yêu cầu expectedVersion và requestId. Primary/support phải là tài khoản ACTIVE có role RECRUITER thật, không tin role/capability của client. Duplicate, inactive, missing, malformed hoặc stale bị chặn. Recipient và requisition được khóa trong transaction PostgreSQL; SQLite dùng transaction queue hiện có. Concurrent update cùng version chỉ một thao tác thành công. Retry/no-op không ghi thêm lịch sử giả.

Handover và editor primary cũ đi qua cùng cơ chế audit khi tính năng được bật. Promotion support thành primary qua API cũ chuyển vai trò nguyên tử, giữ các supports khác. Handover cùng primary vẫn giải quyết operational warning nhưng không tạo fake assignment event. Xóa recruiter qua User Management thu hồi primary/support và lưu snapshot removal; failure khi xóa user rollback cả assignment và audit.

Recruiter assignment tách khỏi approval assignee. Không thay trạng thái tuyển dụng, chuỗi duyệt, revision, quyết định cũ hoặc ngân sách. Thay recruiter trong lúc revision chờ duyệt không làm final approval ghi đè primary hiện hành.

## Phạm vi dữ liệu ứng viên

- Backend lấy actor/role/permission hiện hành từ DB. Không tin role/email truyền vào viewer object.
- REC chỉ đọc/ghi application có requisition_id đang được phân công primary hoặc support. Không dùng email để mở quyền tới application cùng người ở vị trí khác.
- Candidate detail đọc lại backend; không mở bằng cache list cũ. ID ngoài scope bị chặn; old response sau khi rời trang không mở lại modal.
- Candidate create/stage, Interview create/update và Offer create/send kiểm tra scope độc lập với permission. Từ chối relink foreign application vào vị trí được giao; dữ liệu legacy lệch link không mở quyền xem/ghi sai.
- HR/ADMIN giữ quyền module; HIRING giữ R*; INTERVIEWER giữ round scope; CANDIDATE giữ own-email scope. Multi-role tổng hợp scope hợp lệ: CANDIDATE+REC có thể tạo/xem application của chính mình nhưng không được đổi stage foreign application chỉ vì role REC.
- Các demo permission endpoints không trả dữ liệu ứng viên. Không có CV/attachment endpoint hiện hành; guessed attachment URLs trả JSON404. Không tuyên bố đã kiểm thử download CV chưa triển khai.

## API

| Endpoint | Quyền và contract |
|---|---|
| GET /api/v1/requisition-operations/:id/copy-context | requisition.create/read, actual ADMIN/HR/HIRING, source scope; document/sourceVersion/date warning |
| POST /api/v1/requisition-operations/:id/copy | requestId, expectedSourceVersion, document whitelist; luôn DRAFT |
| GET /api/v1/requisition-operations/:id/assignments | requisition.read/scope; primary/support/version/capabilities/eligible/history |
| PUT /api/v1/requisition-operations/:id/assignments | requisition.assign và actual HR/ADMIN; requestId/expectedVersion/primaryRecruiterId/supportRecruiterIds/reason |
| GET /api/v1/candidates/:id | candidate.read và DB scope; dữ liệu mới nhất |

Không có API sửa/xóa copy receipts hoặc assignment history. API cũ giữ field/response; scope và quyền phân công được siết theo yêu cầu mới. primary nullable là bỏ phân công; supports phải là mảng không trùng. UI yêu cầu xác nhận khi đổi primary hoặc gỡ hỗ trợ và thông báo quyền sẽ bị thu hồi.

## Migration và kích hoạt

Migration005 mới có SQLite/PostgreSQL riêng, không sửa001–004:

- requisition_recruiter_supports: FK req/user, PK(req,user), index(user,req).
- requisition_assignment_versions: một optimistic version/req.
- requisition_recruiter_events: immutable actor/name/time/reason/changes; UNIQUE(req,version).
- requisition_operation_requests: immutable idempotency receipt; PK(actor,requestId).
- Membership guards ngăn primary/support collision; PostgreSQL lock parent khi thêm support. History/receipts chặn update/delete; PostgreSQL chặn truncate.

REQUISITION_OPERATIONS_ENABLED mặc địnhfalse, không sửa .env hoặc tự bật flag. Startup khi ON chỉ verify005, không chạy migration/seed. Khi OFF, copy/support UI/API chưa hoạt động; primary recruiter scope của Candidate vẫn được kiểm tra, không cấp global read chỉ vì REC.

Lệnh chuẩn bị: `npm run migrate:s3-05-06`, kiểm tra bằng `npm run migrate:s3-05-06 -- --check`. Sau migration, bật REQUISITION_OPERATIONS_ENABLED=true trong tiến trình triển khai rồi restart backend. Không chạy CLI trên SQLite runtime gốc; dùng provider/path của bản sao khi kiểm thử thủ công. NODE_ENV=development và EMAIL_MODE=simulated cho bản sao SQLite; không dùng NODE_ENV=test vì convention chọn ats_test.db thay DB_PATH.

## Neon

Read-only preflight ats_staging/public xác minh001–004. 005 chưa tồn tại, không có partial schema. Sau khi test cách ly PASS đã áp dụng005, verify checksum và trigger; domain counts cũ không đổi.

Neon có grant legacy còn thiếu so với ma trận source, gồm HR candidate.create, REC interview.create/update và một số quyền điều hướng. migrate005 bổ sung dependency grants bằng synchronizeRecruiterPermissions: chỉ thêm các quyền liên quan Requisition/Candidate/Interview/Offer/report đúng ROLE_PERMISSIONS đã chốt, không xóa grant, không cấp Hiring candidate.update/assignment hoặc tự cấp role cho user. Không chạy full sync phá dữ liệu, seed/import hoặc đổi nội dung nghiệp vụ cũ.

Live service smoke15/15 PASS trên project PostgreSQL adapter trong transaction luôn rollback: copy, retry, scope, primary/support, pipeline, Interview, Offer, transfer, stale version và immutable history. Fixture sau rollback0; users/req/candidates/interviews/offers/sessions/email counts không đổi. Smoke không tạo session, không SMTP/OAuth, không phải Browser E2E hoặc stress test pg-wire nhiều client.

## Điều chỉnh test cũ theo chính sách

Không bỏ test hoặc đổi assertion không liên quan. S2-10 test45 nay xác minh Hiring tạo draft kèm recruiter bị403, rồi HR tạo draft hợp lệ để tiếp tục assertion giữ lựa chọn. Fixture final-rbac/reapproval tạo req bởi Hiring nhưng HR phân công sau khi OPEN; các assertion revision/approval/history được giữ.

S1-09 thêm403 trước khi phân công sau khi gán REC role, rồi Admin bàn giao hợp lệ; token cũ vẫn có hiệu lực ngay, assertion200 giữ nguyên. Sprint2 catalog/pipeline fixture gắn req đã giao để kiểm tra CRUD và notes/rejection reason. Legacy Hiring create fixture không tự phân công. PostgreSQL scope tests dùng email/roles thật trong DB thay vì spoof viewer fields; vẫn kiểm tra case-insensitive own email và permission union. Native PG placeholders cho fixture UPDATE email tránh dialect transform của query assignment.

## Kiểm thử thủ công còn cần

1. HR/ADMIN cấu hình primary/support ở Chi tiết OPEN/IP; thử trùng, account inactive, stale version và cancel confirmation. Hiring chỉ thấy danh sách/history.
2. REC chính/hỗ trợ cùng xem đúng ứng viên; gỡ assignment rồi dùng session cũ thử list, ID direct, search, stage, Interview và Offer. Kiểm tra ứng tuyển cùng email ở vị trí khác không bị lộ.
3. Hiring sao chép DRAFT/OPEN/IP/CLOSED thuộc scope; kiểm tra JD multiline, date hết hạn, success/error/retry, copy luôn draft và không có lịch sử/giữ ngân sách.
4. Browser desktop/mobile, keyboard, Console/Network, screenshot và usability: NOT RUN trong Codex. Các test responsive/layout hiện có là automated structural evidence.
5. PGlite dùng một engine và hàng đợi client: kiểm tra SQL/constraints/transaction/concurrent callers, không thay pg-wire stress nhiều connection cách ly. PostgreSQL live cách ly NOT RUN; Neon smoke không được gọi là stress test.

Email thật S1-03/S1-08, các visual acceptance cũ và dependencies Offer/Sprint6 vẫn giữ phân loại external/manual/deferred; nhiệm vụ không triển khai backlog ngoài S3-05/S3-06.

## Regression và file thay đổi

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
| test:routing | PASS | 180/180 |
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
| node backend/tests/test_postgres_startup.js | PASS | 11/11 |

node --check128/128; git diff --check PASS; không thêm comment; hash11file được bảo vệ không đổi.

- `backend/src/controllers/requisitionOperationsController.js`
- `backend/src/db/migrate-requisition-operations.js`
- `backend/src/db/migrations/005_requisition_operations_postgres.sql`
- `backend/src/db/migrations/005_requisition_operations_sqlite.sql`
- `backend/src/services/requisitionOperationsService.js`
- `backend/tests/test_s3_05_06.js`
- `docs/S3-05-S3-06-copy-recruiter-assignments.md`
- `frontend/js/components/requisition-operations.js`
- `backend/src/config/config.js`
- `backend/src/db/sync-permissions.js`
- `backend/src/server.js`
- `backend/src/services/requisitionService.js`
- `backend/src/services/userService.js`
- `backend/tests/test_final_rbac_open.js`
- `backend/tests/test_requisition_access.js`
- `backend/tests/test_requisition_reapproval.js`
- `backend/tests/test_s1_09_integration.js`
- `backend/tests/test_s2_10_integration.js`
- `backend/tests/test_s2_integration.js`
- `docs/ATS-E2E-2026-10-08.md`
- `docs/RBAC-admin-permissions.md`
- `frontend/components/create-req-modal.html`
- `frontend/components/requisition-detail-modal.html`
- `frontend/js/api.js`
- `frontend/js/components/candidate-dialogs.js`
- `frontend/js/components/requisition-detail.js`
- `frontend/js/components/requisition-form.js`
- `frontend/js/pages/requisitions.js`
- `frontend/js/shared/route-lifecycle.js`
- `frontend/routes.json`
- `package.json`
- `docs/ATS-S3-05-S3-06-2026-10-09-evidence.json`
