# Kiểm thử độc lập ATS — Sprint 1, 2, 3 — 2026-10-09

**Kết luận: REGRESSION CHƯA PASS TOÀN BỘ — CHƯA HOÀN TẤT NGHIỆM THU E2E.**

Đã chạy lại source hiện tại, không dùng kết quả lượt S3-10 làm kết quả audit mới. 44 npm test scripts đã chạy; hai script pg-live ban đầu tự NOT RUN khi môi trường tổng không có URL, sau đó đã chạy thật trên PostgreSQL local. Thêm hai test file không được đăng ký trong package.json: PostgreSQL startup và S1 frontend fixes. Không sửa production, test cũ, migration, .env hoặc feature flags production.

## 1. Môi trường và pre-check

- Branch: feature/s2-bulk-user-import. HEAD: d962ef3a9da49d42b595dba85ca3daa3404454db. Không thay branch/HEAD.
- Working tree đã có S3-07/08/09/10 chưa commit, 4 SQLite runtime và 001_postgres.sql modified từ trước. Tất cả nội dung có sẵn giữ nguyên hash trong lượt này.
- Đọc backlog 30 User Stories, 91 AC; vai trò, ma trận quyền, báo cáo Sprint3, code/schema/migration/test hiện tại. Backlog gốc còn ghi Chưa bắt đầu và kiến trúc dự kiến React/NestJS; audit dùng source thực tế Node/CommonJS/node:http và vanilla JS, cùng quyết định nghiệp vụ đã chốt, không dùng metadata cũ để kết luận implementation thiếu.
- Các suite chạy trong từng source copy TEMP riêng, không .git/.env/runtime DB; npm ci --offline --ignore-scripts, dependency phân giải từ bản sao. Supplemental flows dùng A:/ATS_SPRINT3_TEST/full-audit-source-*.
- PostgreSQL 17.10: cluster mới chỉ bind 127.0.0.1:53475, database/schema disposable riêng, không dùng dịch vụ PostgreSQL cũ hay Neon cho stress. Cluster đã stop; giữ thư mục test để audit, không xoá dữ liệu developer.
- SMTP/OAuth bị loại khỏi environment test; EMAIL_MODE=simulated. Không gửi email thật. Không seed/import Neon, không áp dụng migration mới.
- Flags hiện tại đều OFF: APPROVAL_CONFIGURATION_ENABLED, REQUISITION_APPROVAL_ENABLED, HEADCOUNT_BUDGET_ENABLED, REQUISITION_OPERATIONS_ENABLED, REQUISITION_LIFECYCLE_ENABLED, REQUISITION_TRACKING_ENABLED, JOB_POSTING_DRAFTS_ENABLED, JOB_POSTING_PUBLICATION_ENABLED. Chỉ bật trong process test/rollback smoke.
- npm ls --depth=0 exit0, đủ exceljs, nodemailer, sharp, pg, @electric-sql/pglite. node --check 145/145; git diff --check exit0.

## 2. Lỗi và xung đột tìm thấy

### ATS-AUDIT-001 — MEDIUM — Validation stage khi tạo ứng viên

Backend nhận stage không thuộc NEW/APPLIED/SCREENING/INTERVIEW/OFFER/HIRED/REJECTED. Tái hiện trên SQLite service, PostgreSQL local thật và HTTP server SQLite cách ly.

1. Login recruiter test đang được giao một Requisition OPEN.
2. POST /api/v1/candidates với fullName/email test hợp lệ, requisitionId thuộc phạm vi, stage=INVALID_STAGE_AUDIT.
3. Expected HTTP400 và không INSERT. Actual HTTP201, success=true, stage lạ được persist.
4. GET lifecycle bằng HR cho thấy hồ sơ đó trong outstanding. Backend S3-07 coi mọi stage khác HIRED/REJECTED là chưa kết thúc, nên hồ sơ cần xử lý trước khi đóng/huỷ.

Root cause: [createCandidate](../backend/src/services/requisitionService.js) line1421 dùng data.stage trực tiếp; enum validation chỉ ở updateCandidateStage line1455. [server](../backend/src/server.js) line1882 chuyển body vào createCandidate. SQL candidates không tự chặn giá trị này. [lifecycle](../backend/src/services/requisitionLifecycleService.js) line14 xử lý outstanding đúng cơ chế hiện tại, nhưng nhận dữ liệu không hợp lệ từ upstream.

Đây là defect đã tồn tại trong HEAD, không phải lỗi do audit tạo ra. S3-07 guard không bị bypass, nhưng tính toàn vẹn pipeline chưa đủ. Không tự sửa; đề xuất sau khi được duyệt: kiểm tra enum hiện hành ở create boundary trước INSERT, bổ sung API positive/negative và parity. Không cần tự chuyển stage của dữ liệu đang có.

### TEST-POLICY-001 — LOW — Assertion cũ mâu thuẫn ADMIN toàn quyền

node backend/tests/test_s1_frontend_fixes.js: 16/17 PASS, 1 FAIL tại S1-05 AC3, line67–73. Fixture đăng nhập ADMIN, xoá explicit grant user.read rồi kỳ vọng API403/UI thông báo từ chối. Theo quyết định cuối cùng, ADMIN vẫn được RBAC cho phép mà không phụ thuộc grant mới. Thực tế HTTP200 là đúng chính sách.

Đã kiểm tra độc lập: ADMIN mất explicit grant → HTTP200; HR_MANAGER mất grant → HTTP403, UI hiện đúng “Bạn không có quyền thực hiện thao tác này (yêu cầu quyền: user.read).”, loading và stale rows biến mất; 2/2 PASS. S1 coverage genuine403 cũng PASS.

Không coi đây là production S1-05 implementation failure. Vẫn giữ nguyên FAIL của suite cũ, không đổi fixture/assertion trong lượt này. Đề xuất sau phê duyệt: fixture role không phải ADMIN cho negative403, giữ assertion thông báo/loading hiện tại, thêm assertion riêng ADMIN-all.

### PERF-OBS-001 — LOW — N+1 danh sách người dùng

UserService.getUsers: 1 row =3 SQL; 20 rows =22 SQL. SQL truy vấn vai trò được chạy từng user tại userService.js line483–496. Không sửa. Đây là quan sát hiệu năng, không phải test FAIL có SLA. S3-08 list không có tăng query theo số dòng trong mẫu đo.

## 3. Toàn bộ suite đã chạy

| Lệnh | Kết quả | PASS/Total | Exit |
|---|---|---|---|
| npm run test:sprint1 | PASS | 56/56 | 0 |
| npm run test:final-rbac-open | PASS | 33/33 | 0 |
| npm run test:requisition-access | PASS | 16/16 | 0 |
| npm run test:ats-e2e | PASS | 51/51 | 0 |
| npm run test:rbac | PASS | 47/47 | 0 |
| npm run test:s3-02 | PASS | 93/93 | 0 |
| npm run test:s3-01 | PASS | 108/108 | 0 |
| npm run test:postgres | PASS | 15/15 | 0 |
| npm run test:postgres:live | PASS | 3/3 | 0 |
| npm run test:review-updates | PASS | 22/22 | 0 |
| npm run test:s1-01 | PASS | 8/8 | 0 |
| npm run test:s1-02 | PASS | 5/5 | 0 |
| npm run test:s1-03 | PASS | 5/5 | 0 |
| npm run test:s1-03:email | PASS | 49/49 | 0 |
| npm run test:s1-04 | PASS | 5/5 | 0 |
| npm run test:s1-05 | PASS | 6/6 | 0 |
| npm run test:s1-06 | PASS | 3/3 | 0 |
| npm run test:s1-07 | PASS | 4/4 | 0 |
| npm run test:s1-08 | PASS | 5/5 | 0 |
| npm run test:s1-09 | PASS | 7/7 | 0 |
| npm run test:s1-10 | PASS | 8/8 | 0 |
| npm run test:otp | PASS | 8/8 | 0 |
| npm run test:sprint2 | PASS | 32/32 | 0 |
| npm run test:s2-10 | PASS | 59/59 | 0 |
| npm run test:routing | PASS | 187/187 | 0 |
| npm run test:user-ux | PASS | 87/87 | 0 |
| npm run test:datetime-dashboard | PASS | 28/28 | 0 |
| npm run test:avatar | PASS | 21/21 | 0 |
| npm run test:mobile-shell | PASS | 53/53 | 0 |
| npm run test:layout | PASS | 45/45 | 0 |
| npm run test:coverage:sprint1 | PASS | 23/23 | 0 |
| npm run test:coverage:sprint2 | PASS | 25/25 | 0 |
| npm run test:career-upload | PASS | 24/24 | 0 |
| npm run test:user-roles-avatar | PASS | 17/17 | 0 |
| npm run test:reapproval | PASS | 94/94 | 0 |
| npm run test:s3-03 | PASS | 29/29 | 0 |
| npm run test:s3-04 | PASS | 55/55 | 0 |
| npm run test:s3-05 | PASS | 36/36 | 0 |
| npm run test:s3-06 | PASS | 46/46 | 0 |
| npm run test:s3-07 | PASS | 51/51 | 0 |
| npm run test:s3-08 | PASS | 27/27 | 0 |
| npm run test:s3-09 | PASS | 41/41 | 0 |
| npm run test:s3-10 | PASS | 53/53 | 0 |
| npm run test:s3-10:pg-live | PASS | 32/32 | 0 |
| node backend/tests/test_postgres_startup.js | PASS | 11/11 | 0 |
| node backend/tests/test_s1_frontend_fixes.js | FAIL | 16/17 | 1 |

46 nhóm suite hiện có: 45 PASS, 1 FAIL. 1649/1650 lượt case PASS, 1 FAIL. Supplemental cross-Sprint:21/23 PASS,2 FAIL là cùng defect stage trên hai engine; independent policy/UX: 2/2 PASS; PostgreSQL budget/final-approval race bổ sung: 2/2 PASS. Tổng local:1674 PASS, 3 FAIL/1677 lượt thực thi (đã cộng thêm 2 ca race PostgreSQL thực).

Có 56 lượt lặp từ test:sprint1 aggregate và test:s1-01..10. Loại riêng aggregate còn 1621 lượt. **Không gọi đây là số test case độc lập:** các scenario chạy SQLite/PGlite/PostgreSQL và các suite chồng nhau còn trùng logic; repository chưa có registry ID chung để tính unique đáng tin. Supplemental harness có12 định nghĩa scenario, thực thi23 lần theo engine. HTTP repro cùng defect không cộng thêm một lần FAIL. Không cộng lại các lượt rerun hoặc lỗi setup harness đã được sửa. Neon 19 assertion và syntax145 file báo riêng, không trộn vào local case total.

Lệnh supplemental: `node work/ats-full-audit-2026-10-09/integration.cjs` exit1 (21/23); `node work/ats-full-audit-2026-10-09/policy-feedback.cjs` exit0 (2/2); `node work/ats-full-audit-2026-10-09/pg-concurrency-extra.cjs` exit0 (2/2). HTTP defect repro script exit0 nghĩa là đã quan sát được defect, không phải ứng dụng đạt validation.

Script pg-live exit0 khi NOT RUN không được coi PASS: kết quả cuối dùng log actual local PG3/3 và S3-10 parity24/24+stress8/8. Không có suite cuối SKIP/NOT RUN; Browser và các manual/external acceptance vẫn NOT RUN/DEFERRED. Coverage scripts23/23 và25/25 là coverage AC hiện có, không phải số liệu statement/branch coverage100%.

## 4. User Stories và từng Acceptance Criterion

Mọi PASS dưới đây chỉ nói phạm vi automated API/service/DB/DOM đã chạy. Browser/visual và delivery thật còn riêng; không suy ra nghiệm thu chính thức. Ma trận module theo docs/business_specs/2_User_Roles.md và quyết định cuối: ADMIN toàn RBAC nhưng chịu business constraints; salary standard vẫn HR-only; HIRING_MGR read-only candidate trong scope; recruiter theo assignment.

| Story | AC | Nội dung | Automated/evidence | Còn lại/ghi chú |
|---|---|---|---|---|
| S1-01 | 1 | Đăng nhập đúng thì vào được trang chủ tương ứng với vai trò | PASS · test:s1-01 |  |
| S1-01 | 2 | Sai thông tin hiển thị thông báo chung, không tiết lộ email có tồn tại hay không | PASS · test:s1-01 |  |
| S1-01 | 3 | Khoá tạm 15 phút sau 5 lần sai liên tiếp | PASS · test:s1-01 |  |
| S1-02 | 1 | Phiên được gia hạn tự động khi còn hoạt động | PASS · test:s1-02 |  |
| S1-02 | 2 | Đăng xuất làm mất hiệu lực phiên ngay lập tức phía server | PASS · test:s1-02 |  |
| S1-02 | 3 | Phiên hết hạn đưa về trang đăng nhập kèm thông báo rõ ràng | PASS · test:s1-02 |  |
| S1-03 | 1 | Nhập email nhận được liên kết đặt lại có hiệu lực 30 phút | PASS · test:s1-03 | Email client/inbox/real delivery NOT RUN; dispatch simulated PASS |
| S1-03 | 2 | Liên kết chỉ dùng được một lần | PASS · test:s1-03 |  |
| S1-03 | 3 | Email không tồn tại vẫn hiển thị cùng một thông báo | PASS · test:s1-03 |  |
| S1-04 | 1 | Bắt buộc nhập mật khẩu hiện tại | PASS · test:s1-04 |  |
| S1-04 | 2 | Mật khẩu mới tối thiểu 8 ký tự, có chữ và số | PASS · test:s1-04 |  |
| S1-04 | 3 | Đổi xong thu hồi các phiên đăng nhập khác | PASS · test:s1-04 |  |
| S1-05 | 1 | Khai báo được quyền cho từng vai trò trong bảy vai trò nghiệp vụ | PASS · test:s1-05 |  |
| S1-05 | 2 | Mọi chức năng đều kiểm quyền ở tầng server, mặc định là từ chối | PASS · test:s1-05 |  |
| S1-05 | 3 | Truy cập thiếu quyền hiển thị thông báo tiếng Việt rõ ràng | PASS · test:s1-05 | Existing coverage and independent genuine HR403/DOM test PASS; standalone old ADMIN-grant-removal fixture FAIL under new policy (TEST-POLICY-001) |
| S1-05 | 4 | Có kiểm thử tự động cho ít nhất ba vai trò | PASS · test:s1-05 |  |
| S1-06 | 1 | Mục menu không thuộc quyền thì không hiển thị | PASS · test:s1-06 |  |
| S1-06 | 2 | Hiển thị tên và vai trò người đang đăng nhập | PASS · test:s1-06 |  |
| S1-06 | 3 | Dùng được thuận tiện trên màn hình 360px | PASS · test:s1-06 | 360px automated DOM PASS; browser visual/usability NOT RUN |
| S1-07 | 1 | Trang báo lỗi dùng chung giao diện ứng dụng | PASS · test:s1-07 |  |
| S1-07 | 2 | Mỗi trang lỗi có một hành động gợi ý để quay lại luồng làm việc | PASS · test:s1-07 |  |
| S1-08 | 1 | Tạo tài khoản gửi email kích hoạt kèm mật khẩu tạm | PASS · test:s1-08 | Activation dispatch/temporary password simulated PASS; real email delivery NOT RUN |
| S1-08 | 2 | Email trùng bị từ chối kèm thông báo cụ thể | PASS · test:s1-08 |  |
| S1-08 | 3 | Tìm theo tên, email, phòng ban; lọc theo vai trò và trạng thái | PASS · test:s1-08 |  |
| S1-08 | 4 | Danh sách phân trang, mặc định 20 dòng | PASS · test:s1-08 |  |
| S1-09 | 1 | Một người dùng có thể giữ nhiều vai trò cùng lúc | PASS · test:s1-09 |  |
| S1-09 | 2 | Thay đổi vai trò có hiệu lực ngay ở thao tác kế tiếp | PASS · test:s1-09 |  |
| S1-09 | 3 | Không thể tự thu hồi vai trò quản trị của chính mình | PASS · test:s1-09 |  |
| S1-10 | 1 | Tài khoản bị khoá không đăng nhập được và bị thu hồi phiên đang mở | PASS · test:s1-10 |  |
| S1-10 | 2 | Bắt buộc ghi lý do khoá | PASS · test:s1-10 |  |
| S1-10 | 3 | Vị trí tuyển dụng do người đó phụ trách được cảnh báo cần bàn giao | PASS · test:s1-10 |  |
| S2-01 | 1 | Tải được tệp mẫu | PASS · test:sprint2 |  |
| S2-01 | 2 | Xem trước và báo lỗi theo từng dòng trước khi nhập | PASS · test:sprint2 |  |
| S2-01 | 3 | Dòng lỗi bị bỏ qua, dòng hợp lệ vẫn được nhập, có báo cáo tổng kết | PASS · test:sprint2 |  |
| S2-02 | 1 | Sửa được họ tên, số điện thoại, chức danh hiển thị | PASS · test:sprint2 |  |
| S2-02 | 2 | Không tự đổi được email, phòng ban và vai trò | PASS · test:sprint2 |  |
| S2-02 | 3 | Kiểm tra định dạng số điện thoại Việt Nam | PASS · test:sprint2 |  |
| S2-03 | 1 | Chấp nhận JPG/PNG tối đa 2MB | PASS · test:sprint2 |  |
| S2-03 | 2 | Ảnh được cắt vuông và tạo bản thu nhỏ | PASS · test:sprint2 |  |
| S2-04 | 1 | Phòng ban có cấu trúc cây nhiều cấp | PASS · test:sprint2 |  |
| S2-04 | 2 | Mỗi phòng ban có một người phụ trách | PASS · test:sprint2 |  |
| S2-04 | 3 | Phòng ban đang có yêu cầu tuyển dụng mở thì không xoá được, chỉ ngừng áp dụng | PASS · test:sprint2 |  |
| S2-05 | 1 | Mỗi chức danh có mã, tên, cấp bậc, dải lương tối thiểu và tối đa | PASS · test:sprint2 |  |
| S2-05 | 2 | Dải lương dùng làm hạn mức duyệt offer về sau | DEFERRED · test:sprint2 | DEFERRED: future Offer salary-rule integration; stored data contract PASS |
| S2-05 | 3 | Chỉ Trưởng phòng Nhân sự xem được dải lương | PASS · test:sprint2 |  |
| S2-06 | 1 | Mỗi chức danh gắn với một bộ tiêu chí đánh giá, mỗi tiêu chí có trọng số | PASS · test:sprint2 |  |
| S2-06 | 2 | Tổng trọng số của một khung bằng 100% | PASS · test:sprint2 |  |
| S2-06 | 3 | Khung năng lực dùng lại được cho nhiều chức danh | PASS · test:sprint2 |  |
| S2-06 | 4 | Đây chính là bộ tiêu chí sinh ra phiếu đánh giá phỏng vấn ở Sprint 6 | DEFERRED · test:sprint2 | DEFERRED: Sprint6 evaluation-sheet integration |
| S2-07 | 1 | Mỗi câu hỏi gắn với một tiêu chí trong khung năng lực | PASS · test:sprint2 |  |
| S2-07 | 2 | Câu hỏi có mức độ khó và gợi ý câu trả lời tốt | PASS · test:sprint2 |  |
| S2-07 | 3 | Tìm kiếm và lọc câu hỏi theo chức danh và tiêu chí | PASS · test:sprint2 |  |
| S2-08 | 1 | Nguồn ứng viên, lý do loại hồ sơ, địa điểm làm việc, hình thức làm việc | PASS · test:sprint2 |  |
| S2-08 | 2 | Giá trị đang được tham chiếu thì không xoá được | PASS · test:sprint2 |  |
| S2-08 | 3 | Sắp xếp được thứ tự hiển thị | PASS · test:sprint2 |  |
| S2-09 | 1 | Soạn nội dung giới thiệu, tải ảnh và logo | PASS · test:sprint2 |  |
| S2-09 | 2 | Xem trước đúng như giao diện công khai trước khi lưu | PASS · test:sprint2 | Preview/public data/render interaction PASS; browser visual MANUAL |
| S2-10 | 1 | Khai báo chức danh, phòng ban, số lượng, lý do tuyển (thay thế hoặc tăng mới), dải lương đề xuất, ngày cần người | PASS · test:s2-10 |  |
| S2-10 | 2 | Soạn mô tả công việc và yêu cầu ứng viên, lưu nháp được | PASS · test:s2-10 |  |
| S2-10 | 3 | Dải lương đề xuất nằm ngoài dải chuẩn của chức danh thì bắt buộc nhập giải trình | PASS · test:s2-10 |  |
| S2-10 | 4 | Ngày cần người không được ở quá khứ | PASS · test:s2-10 |  |
| S3-01 | 1 | Khai báo chuỗi cấp duyệt theo phòng ban và theo mức lương đề xuất | PASS · test:s3-01 |  |
| S3-01 | 2 | Yêu cầu vượt hạn mức tự động thêm cấp duyệt cao hơn | PASS · test:s3-01 |  |
| S3-01 | 3 | Cấu hình sai (không có cấp duyệt nào khớp) bị chặn lưu | PASS · test:s3-01 |  |
| S3-01 | 4 | Luồng đang chạy không bị ảnh hưởng khi cấu hình thay đổi | PASS · test:s3-01 |  |
| S3-02 | 1 | Ba hành động: Duyệt, Từ chối, Yêu cầu bổ sung — hai hành động sau bắt buộc nhập ý kiến | PASS · test:s3-02 |  |
| S3-02 | 2 | Duyệt xong tự chuyển sang cấp kế tiếp; cấp cuối duyệt thì yêu cầu chuyển sang trạng thái Đã duyệt | PASS · test:s3-02 |  |
| S3-02 | 3 | Yêu cầu bổ sung trả hồ sơ về cho người tạo và giữ nguyên lịch sử | PASS · test:s3-02 |  |
| S3-03 | 1 | Hiển thị chuỗi cấp duyệt, cấp nào đã duyệt, đang chờ ai | PASS · test:s3-03 |  |
| S3-03 | 2 | Mỗi bước ghi người duyệt, thời điểm, ý kiến | PASS · test:s3-03 |  |
| S3-03 | 3 | Lịch sử không sửa và không xoá được | PASS · test:s3-03 |  |
| S3-04 | 1 | Khai báo chỉ tiêu headcount và ngân sách lương theo phòng ban theo năm | PASS · test:s3-04 |  |
| S3-04 | 2 | Yêu cầu tuyển dụng mới hiển thị số headcount còn lại của phòng ban | PASS · test:s3-04 |  |
| S3-04 | 3 | Vượt chỉ tiêu là cảnh báo chặn, cần Trưởng phòng Nhân sự xác nhận ghi đè kèm lý do | PASS · test:s3-04 |  |
| S3-05 | 1 | Sao chép toàn bộ mô tả công việc và yêu cầu ứng viên | PASS · test:s3-05 |  |
| S3-05 | 2 | Bản sao luôn bắt đầu ở trạng thái Nháp, không kế thừa lịch sử duyệt | PASS · test:s3-05 |  |
| S3-06 | 1 | Phân công một recruiter chính và nhiều recruiter hỗ trợ | PASS · test:s3-06 |  |
| S3-06 | 2 | Recruiter chỉ nhìn thấy ứng viên của vị trí được giao | PASS · test:s3-06 |  |
| S3-06 | 3 | Có ghi lịch sử chuyển giao khi đổi người phụ trách | PASS · test:s3-06 |  |
| S3-07 | 1 | Ba trạng thái kết thúc có lý do riêng: Đã tuyển đủ, Tạm dừng, Huỷ | PASS · test:s3-07 |  |
| S3-07 | 2 | Đóng yêu cầu tự động gỡ tin tuyển dụng đang đăng | PASS · test:s3-07 |  |
| S3-07 | 3 | Ứng viên còn đang trong pipeline được cảnh báo cần xử lý trước khi đóng | PASS · test:s3-07 | Lifecycle guard PASS with valid pipeline stages; upstream creation accepts invalid stages (ATS-AUDIT-001) |
| S3-08 | 1 | Lọc theo trạng thái, phòng ban, recruiter phụ trách, khoảng thời gian | PASS · test:s3-08 |  |
| S3-08 | 2 | Mỗi dòng hiển thị số ngày mở và số ngày còn lại tới ngày cần người | PASS · test:s3-08 |  |
| S3-08 | 3 | Yêu cầu quá ngày cần người được đánh dấu nổi bật | PASS · test:s3-08 |  |
| S3-09 | 1 | Nội dung mô tả công việc được kế thừa từ yêu cầu, sửa lại được cho phù hợp ngôn ngữ tuyển dụng | PASS · test:s3-09 |  |
| S3-09 | 2 | Khai báo địa điểm, hình thức làm việc, hạn nhận hồ sơ, có hiển thị mức lương hay không | PASS · test:s3-09 |  |
| S3-09 | 3 | Chỉ yêu cầu ở trạng thái Đã duyệt mới tạo được tin | PASS · test:s3-09 |  |
| S3-10 | 1 | Tin phải qua duyệt trước khi hiển thị công khai | PASS · test:s3-10 |  |
| S3-10 | 2 | Xem trước đúng như giao diện công khai trước khi xuất bản | PASS · test:s3-10 | Shared renderer/DOM/body equivalence PASS; real browser preview/branding NOT RUN |
| S3-10 | 3 | Ghi lại người xuất bản và thời điểm | PASS · test:s3-10 |  |

## 5. Tích hợp xuyên Sprint

Mỗi scenario độc lập chạy cả SQLite và PostgreSQL local thật, bật toàn bộ flag liên quan trong process, không chỉ đổi status bằng SQL để giả lập kết quả duyệt.

| Luồng | Kiểm tra thực tế | Kết quả |
|---|---|---|
| A | Title/catalog; Req owner→2 cấp HR/Admin; quota tính 7 tháng; recruiter chính/hỗ trợ; ad recruiter→HR khác tác giả duyệt →ADMIN xuất bản; nội dung preview/public; xử lý2 ứng viên HIRED/quantity 2; fulfilledCLOSED giữ quota,public ẩn,interview/offer không bị thay đổi | PASS 2/2 |
| B | Ad đã publish, revision PENDING; PAUSED ẩn public,chặn tạo application,đóng băng quyết định,giữ quota và delta reservation | PASS 2/2 |
| C | HIRED1/quantity3 + live pipeline + revision PENDING; cancel bị chặn; REQUEST_INFO giải phóng delta; xử lý live thành REJECTED; cancel snapshot 1 HIRED giữ 2100 VND dự kiến, giải phóng2 headcount/4200 VND; application thay đổi sau đó không đổi snapshot | PASS 2/2 |
| D | OPEN APPROVED→revision nhómB; main/list vẫn effective,cũ vẫnpublic,delta +2; cấp 1 không áp main,cấp 2 áp atomic,gỡ ad; giữ history/submissions; NEEDS_INFO→resubmit từcấp 1; HR/ADMIN gửi thay có lý do và actor/người tạo gốc | PASS 4/4 |
| E | Hiring trong/ngoài scope,cấm đổi stage; recruiter khôngđược phân công/thu hồi sau chuyển giao; thay ID trực tiếp; self Req/ad; người duyệt trùng; candidate/interviewer khôngpreview nội bộ | PASS 4/4 |
| F | Close/cancel cùngexpected version thắng1audit; applicant/close parentserialize; injected auditfailure rollback status/public/budget; native stress publisher10requests/batch, retry/stale/approval/version trong existingS3 suites | PASS 4/4 supplemental + native stress8/8 |

N1 check2/2 PASS, PostgreSQL connection/UTC/release1/1 PASS. Tổng21 positive/consistency PASS; invalid-stage2 FAIL giữ nguyên. Không kiểm thử Offer/evaluation workflow tương lai như chức năng Sprint3 mới; quan hệ đang có được kiểm tra không bị auto-mutate.

## 6. Browser E2E và giới hạn frontend

**Browser E2E: NOT RUN.** Runtime setup thành công nhưng chọn browser trả “No browser is available”; discovery=[]; repository không cài playwright/@playwright/test/puppeteer và không có framework E2E sẵn để chạy. Không dùng DOM runtime hoặc API để tuyên bố browserPASS, không có screenshot.

Frontend runtime hiện có chạy login/menu/role homes, routing, details/edit, lifecycle/budget/assignment/draft/review/public renderer, phản hồi401/403/404/500, mobile shell/layout và stale-response guards. Đây là automated DOM/HTTP, không kiểm chứng pixel/font/click geometry thật hoặc giao diện360px bằng screenshot.

Cách kiểm tra lại: kết nối browser được hỗ trợ trong Settings→Computer use, tạo source copy/database cách ly mới và SMTP simulated, bật flags chỉ process đó, chạy server local, dùng7 tài khoản seed synthetic, thực hiện A–F trên desktop/360px, preview/public và Network/Console, lưu screenshots/log. Không dùng tài khoản/token Neon thật hoặc bật flag production để chạy browser. Nhờ người dùng cấu hình browser hoặc runner E2E phù hợp trước khi nghiệm thu chính thức; không cài/migrate framework trong audit này.

## 7. PostgreSQL local, concurrency và parity

- Existing generic PG live:3/3; S3-10 real PG parity24/24;8stress batches×10requests =80request, mỗi batch đúng1PUBLISH event;9request stale bị từchối.
- Supplemental cross-Sprint PostgreSQL:11/12, lỗi duy nhất invalid-stage đã có tương tự SQLite10/11.
-6checked-out clients có6backend PID riêng, timezoneUTC; release đủ, waiting0; sauclose totalCount0/waiting0. Không có unhandled rejection trong harness.
- Fresh migration001–008 chỉ chạy trong test DB/schema; SQLite/PGlite suites tạo schema cách ly, migration preserve/readback/FK/immutable guards đã chạy. Không coi PGlite như multi-connection pg-wire.
- Không phát hiện SQL dialect, numeric/date/timezone, atomicity hoặc version-parity failure trong các scenario đã chạy. Đây không phải soak/performance test production.

Bổ sung hai ca độc lập PostgreSQL thực: PG-BUDGET-RACE (4 lượt, mỗi lượt 2 Requisition cùng tranh quota2, đúng1 chấp nhận/1 HEADCOUNT_BUDGET_EXCEEDED); PG-FINAL-APPROVAL-PAUSE-RACE (4 lượt, mỗi lượt final decision và PAUSED cùng lúc, quota giữ và không áp quyết định sau khi đã đóng băng). Tổng16 request/8 lượt, 2/2 case PASS. Pool sau close total0/waiting0. Cluster đã dừng lại.

## 8. Neon — chỉ kiểm tra an toàn

- Config hiện có được ứng dụng sử dụng nhưng không xuất URL/password/SMTP credential ra báo cáo.
- ats_staging/public; migration001–008 VERIFIED bằng checksum runner hiện có; FK chưa validate0; schema/publication guards và grants verified.
- Snapshot READ ONLY/REPEATABLE READ trước/sau: số dòng và SQL row fingerprints của52bảng public bằng nhau. Không export row/token/credential. Fingerprint row không bao gồm giá trị current sequence; không chạy login/import/seed để tạo audit identity trên Neon.
- Rollback smoke13/13: user thử nghiệm/catalog/source/assignment/approval/ad/reapproval/lifecycle/audit rồiROLLBACK; readiness startup/private401/public404/schema/grants6/6.
- Không migration mới, không seed/import, không bật flagsproduction; fixture0; dữ liệu nghiệp vụ cũ không đổi. Neon full browser/login E2E với tài khoản thực không chạy để bảo vệ dữ liệu thật.

## 9. Quan sát kỹ thuật

| Phép đo | SQL | Thời gian local service |
|---|---|---|
| UserService.getUsers limit=1 | 3 | 0.68ms |
| UserService.getUsers limit=20 | 22 | 0.41ms |
| HR dashboard service | 11 | 0.87ms |
| AuthService login (known isolated seed) | 6 | 35.81ms |
| AuthService heartbeat/session validate | 4 | 0.84ms |

Các số trên là SQLite warm/cỡ mẫu nhỏ, không phải latencyNeon hay frontend render. Nhiều dòng nhanh hơn một dòng không chứng minh tối ưu; dùng querycount để kết luận N+1. Requisition list với1/12result đều6SQL; public list3SQL. Query/locale timestamps và số đo từng provider trong evidence. Không thấy missing dependency, uncaught runtime failure hoặc connection leak trong phạm vi kiểm tra; các failure đã giữ nguyên và phân loại, không dùng câu này để phủ nhận defect.

## 10. Bảo vệ dữ liệu và Git

19 file protected SHA-256 trước/sau bằng nhau. Các file hiệnmodified từtrước không được restore hoặc ghi lại. Mọi file có sẵn so snapshot trước audit chưa thay nội dung; chỉ thêm tài liệu/evidence audit này.

| File | SHA-256 trước | SHA-256 sau |
|---|---|---|
| backend/data/ats.db | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df | abd32cc663be58a45dec262bca0effb6bef1ce28a76a9d45523e7ca54d4e28df |
| backend/data/ats.db-shm | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 | cecda1c8fa43f56a689bcbb27d85403ebfa92af7b06fdeb292ee671eb2a65b71 |
| backend/data/ats.db-wal | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 | f4a470fe8d70acb02cafaf3d85412ac8c3bc44e2473b5d5f2f915af5207f1228 |
| backend/data/ats_test.db | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a | 67442a892d6f897d396d22a4007b6bddb525202db8c3bc46f072646f56dd722a |
| backend/src/db/migrations/001_postgres.sql | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b | e9c5a6926c196c523d1ac4e8a808d467b37a85e15f17f8732746803c4dacab2b |
| backend/src/db/migrations/002_approval_configurations_postgres.sql | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 | 46f949e9d7d6a06316aa20ea62a9c0f45be29cd8f242c401d3925ff1c3f9b477 |
| backend/src/db/migrations/002_approval_configurations_sqlite.sql | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 | 33318e32b4c4ae377c555312050074377295db94682235a6f2d597ab9b57cee2 |
| backend/src/db/migrations/003_requisition_approvals_postgres.sql | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 | 41c375f22d61439ddd61a18ca9adba1a8d3ceb31297c4c35a49c55d52797d0a7 |
| backend/src/db/migrations/003_requisition_approvals_sqlite.sql | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 | 126d26d938aba06c01627a188b87f49536688d43439c2ac44b0b7963b3860296 |
| backend/src/db/migrations/004_headcount_budgets_postgres.sql | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 | ad3d7325abe16a58705ca4ceac6b55c65dd310ce0d7d17f2aa76d2c821852831 |
| backend/src/db/migrations/004_headcount_budgets_sqlite.sql | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 | d7e157a79ba0d566aeb189316120f24f626781a5442550c0764619cca770c9b3 |
| backend/src/db/migrations/005_requisition_operations_postgres.sql | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c | d09d66b45fb3be952a249c4e12e092d41062d994c25060dc2ff0f0d173f31f1c |
| backend/src/db/migrations/005_requisition_operations_sqlite.sql | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf | 67557fe293740e0ace62f7fba85c265d5fc2b25eac9f3e1f5397c6c0d426cdbf |
| backend/src/db/migrations/006_requisition_lifecycle_postgres.sql | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b | 35dc9759c5b46ed17e1b17988a011e1284815c873449b9c656f90e3686a50f8b |
| backend/src/db/migrations/006_requisition_lifecycle_sqlite.sql | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 | cc392189e186ce33d08f9037b1b7ba019ac830fd1a6352a7ff3d79ced1a67b05 |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_postgres.sql | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a | 9fb2e1bca3777990c11f432358baa4afd2e9ec8da9ad5ce57c55c3ecf57eb20a |
| backend/src/db/migrations/007_requisition_tracking_job_drafts_sqlite.sql | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc | 801febb5e9b6cbe3f3c155b846f895d66682cd5e5707a2aff9f5b071b5e2a5cc |
| backend/src/db/migrations/008_job_publication_postgres.sql | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 | 54ca4091946c4e9046615cb7a3b9d5c54a79de78da96439878e54329bae3df17 |
| backend/src/db/migrations/008_job_publication_sqlite.sql | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 | fef9da38d500099ff8ac1f87d32eb7a365d64809315e6fe0201e277f08de05a0 |

Branch/HEAD không đổi; git diff --check PASS. git status gồm các thay đổi Sprint3 trước đó và các tài liệu audit mới; không phân loại DBmodified cũ là thayđổi do test. Không git add/commit/push/merge/rebase/reset/restore/clean/stash.

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

## 11. Rủi ro và quyết định nghiệm thu

Không được kết luận toàn bộ Sprint1–3PASS: có1suite cũFAIL dofixture trái chính sách và2negative executionsFAIL do1defect dữ liệu trên2DB. Chưa sửa bất kỳ lỗi nào. Chưa có browser/visual, emaildelivery thật; futureOffer/evaluation acceptance vẫnDEFERRED. Không có lỗiCritical hoặc leo thang quyền được phát hiện trong các scenario đã chạy, nhưng điều đó không thay thế penetration test/pilot.

Đề xuất: xem xét và phê duyệt fixATS-AUDIT-001; phê duyệt cập nhật fixtureTEST-POLICY-001 theoADMIN-all, không làm yếuassertion; chạy lại các test liên quan/fullregression; bổ sungbrowserdesktop/mobile vàstagingmanual vớiflags được duyệt. N+1userlist là cải thiện sau, không tự sửa trongaudit. Sprint3 hiện có positive automated AC/kiểm thử chức năng, nhưng **chưa đủ điều kiện nghiệm thu E2E chính thức**.

[Bằng chứng máy đọc](evidence/ATS-full-audit-2026-10-09.json) · [Supplemental harness snapshot](evidence/ATS-full-audit-2026-10-09-harness.txt). Log đầy đủ và các lần setup harness trong work/ats-full-audit-2026-10-09 của workspace Codex; lệnh,exitcode,case names,hashlog đã đính kèm trong JSON. Report không chứa secret.

File mới trong lượt audit: docs/ATS-full-audit-2026-10-09.md, docs/evidence/ATS-full-audit-2026-10-09-harness.txt, docs/evidence/ATS-full-audit-2026-10-09.json. Không có file cũ/source/test/migration/runtime DB đổi nội dung. git diff --stat tracked vẫn chứa thay đổi trước audit; không thể dùng riêng stat này để quy cho test.
