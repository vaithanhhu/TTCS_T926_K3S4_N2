# Kiểm toán ATS Sprint 1–4 — 15/10/2026

Cập nhật final hardening: giữ mốc audit Jga2N7 61/61 đã xác minh bên dưới; lượt mới 5ATM75 đạt 62/62 script sau khi thêm Git safety. JSON đồng bộ có `finalHardeningRegression` và checksum log mới. Kết luận commit và giới hạn hiện tại xem `ATS-final-hardening-2026-10-15.md`; không dùng kết quả local để chứng nhận Azure hoặc grants đã COMPLETE.

Kết luận: **PARTIAL**. Đã sửa 12 nhóm finding được tái hiện và chạy hồi quy cách ly. Không kết luận toàn bộ AC đã nghiệm thu vì còn scheduler BLOCKED, delivery email thật, PostgreSQL 16/Azure và nghiệm thu PO chưa xác minh.

## 1. Baseline và phạm vi

- Workspace: `A:\Projects\TTCS_T926_K3S4_N2`.
- Branch: `fix/azure-profile-test-runner`; HEAD: `e25732bd6bafb0b440663d9255670dbe8ba8cf43`. Khởi đầu working tree clean; không dùng HEAD cũ 2b1c8ec.
- Kiểm kê 39 User Story / 120 AC; 7 role; 50 permission catalog codes (48 ma trận lõi + 2 của Sprint 4).
- Đọc 136 nhánh dispatch HTTP trong server/controllers; 194 mẫu method/path tạo 941 request trên SQLite synthetic, gồm alias và cả đường 404. Đây không phải 136 API duy nhất hay chứng nhận 941 luồng nghiệp vụ.
- Backend thực tế: Node HTTP/CommonJS + DB abstraction SQLite/PostgreSQL; frontend vanilla JS. Tài liệu Overview cũ nhắc Vue/TypeScript/JWT/bcrypt không khớp source đã nghiệm thu. Không đổi kiến trúc để chạy theo tài liệu lỗi thời.
- Nguồn chính sách: Product Backlog, Sprint Plan, User Roles, RBAC admin policy và các quyết định QA-S3-06/P1–P6 đã phê duyệt. S2-10 OPEN trực tiếp trong tài liệu cũ bị thay bởi approval-before-OPEN đã chốt.

## 2. Lỗi đã sửa

| Mã | Mức | Story | File: dòng / nguyên nhân | Bản sửa và bằng chứng |
|---|---|---|---|---|
| AUD-01 | P1 | S1-05 | backend/src/server.js:552 — Bốn alias ma trận RBAC trả HTTP 200 không cần đăng nhập. | Thêm authorize(role.read) trước truy vấn; frontend helper gửi Bearer; giữ toàn bộ assertion ma trận và bổ sung 401/403/200 cho bốn alias. test:s1-05; API probes; browser Bearer |
| AUD-02 | P1 | S4-03/S4-09 và consumer liên Sprint | frontend/js/pages/candidates.js:78 — Dữ liệu tên ứng viên/tên vị trí và nhãn động đi thẳng vào innerHTML. Có đường nộp hồ sơ công khai → database → bảng ứng viên. | Escape ở HTML sinks bằng helper hiện có; giữ textContent nguyên văn; serialize/escape ID trong onclick. Mở rộng cùng lớp lỗi sang Interviews, Offers, Dashboard, dropdown. Reports chỉ là hardening sink chưa có producer hiện hành. test:deep-audit-browser: 10 renderer desktop/mobile và 2 full-stack public upload→DB→UI |
| AUD-03 | P1 | Cross-sprint Offer hiện hữu | backend/src/services/requisitionService.js:1660 — Client tự khai roles chọn nhánh permission yếu hơn; Candidate có thể ACCEPTED Offer chưa SENT. | Reload actor DB trước chọn nhánh; ACCEPTED chỉ từ SENT; kiểm tra trong transaction và conditional UPDATE. Giữ chính sách người dùng đã chốt. deep-audit-security: state, forged role, id-only actor, persisted status |
| AUD-04 | P2 | Cross-sprint Interview hiện hữu | backend/src/services/requisitionService.js:1599 — parseInt chấp nhận 9junk; falsy score bỏ mất 0; trạng thái ngoài enum đi tới UPDATE; UI 1–5 không giữ điểm 9 hiện có. | Validate số nguyên an toàn/status hiện có; giữ thang điểm backend; dùng nullish default và option text cho điểm đã lưu. deep-audit-security; deep-audit-browser score 9/0 |
| AUD-05 | P1 | S1-03 | backend/src/services/authService.js:577 — OTP đã verified vẫn mint reset token mới; reset thành công không vô hiệu các link khác; hai token khác nhau có thể cùng đổi mật khẩu. | Claim OTP bằng conditional UPDATE; lọc purpose/verified; khóa user trong PG và recheck token sau khóa; vô hiệu toàn bộ link chưa dùng của user khi reset thành công. deep-audit-security: replay, all-token invalidation, concurrent winner/hash/audit |
| AUD-06 | P1 | S4-03 | backend/src/services/candidatePortalService.js:222 — Public application check trùng/trạng thái trước transaction; đồng thời có thể lưu trùng hoặc nhận sau khi đóng tin; lỗi DB để lại CV rác. | Recheck trạng thái + duplicate trong transaction; PG khóa requisition→email advisory→posting; file wx và cleanup đúng file của request khi rollback. deep-audit-security: duplicate, closed-job race, DB+file rollback |
| AUD-07 | P1 | S4-07 | backend/src/services/candidatePortalService.js:540 — Referral chưa recheck grant/trạng thái/trùng trong mutation transaction; lỗi persistence để lại CV. | Reload actor trong transaction; khóa và recheck requisition; dùng cùng advisory key với public apply; rollback DB và file riêng. Không cấp grant. deep-audit-security; referral-auth regression |
| AUD-08 | P1 | S4-03/S4-05 anti-abuse | backend/src/controllers/candidatePortalController.js:21 — Tin X-Forwarded-For tùy ý để đổi rate identity; count+INSERT không nguyên tử ở PG nhiều request. | Dùng socket peer khi chưa có trust-proxy policy; count/INSERT trong transaction với PG advisory theo action/IP. Không đổi threshold. deep-audit-security: XFF and six concurrent attempts |
| AUD-09 | P2 | S4-03/S4-07 + P5 integration | backend/src/services/candidatePortalService.js:80 — Upload chấp nhận fake DOCX có ZIP prefix hoặc PDF prefix ngắn nhưng download từ chối; tạo hồ sơ thành công với CV không dùng được. | Validate Buffer/filename, %PDF-, cấu trúc ZIP DOCX bằng JSZip đã có qua ExcelJS. Không thêm dependency/parser. deep-audit-security: malformed and valid minimal DOCX; P5 unchanged |
| AUD-10 | P2 | S4 public APIs | backend/src/controllers/candidatePortalController.js:230 — Unexpected error trả err.message và log toàn bộ exception có thể lộ path/SQL/stack. | 5xx trả generic SERVER_ERROR; log code đã giới hạn; URI encoding error trả 400; giữ business 4xx. deep-audit-security: HTTP 500 private sentinel absent |
| AUD-11 | P2 | S4-01 | backend/src/controllers/candidatePortalController.js:46 — parseInt không hợp lệ sinh NaN page/pageSize và pagination metadata null. | Safe integer normalization về 1/10, giữ clamp size 1–50. deep-audit-security: actual HTTP and metadata |
| AUD-12 | P2 | S4-03/S4-06 email | backend/src/services/candidatePortalService.js:289 — Tên ứng viên/tin/phòng ban/lý do rút được nội suy HTML email không escape. | Tái sử dụng escapeEmailHtml hiện có và export helper; escape HTML interpolations; không sửa dữ liệu lưu hoặc gửi mail thật. deep-audit-security: escaped simulated HTML, raw DB name preserved |

Không sửa schema, migration, catalog/grants hoặc vùng logic P1–P6. Reports escape là hardening consumer có sẵn; source report hiện không sản xuất departmentPerformance nên không gọi đó là exploit reachable đã xác minh. Không mở rộng thành chức năng Sprint 6–8.

Bằng chứng trước sửa: `reproduction-before.json` có 22 FAIL; `xss-before.json` có 10 FAIL; các artifact additional/referral-race/reset ghi nhận các failure bổ sung. Các bộ này phát triển dần nên không cộng thành số lỗi duy nhất. Sau sửa: suite mới có 20 ca/provider × 3 = 60 PASS; Chromium mới 16 PASS. Một lần chạy lại browser bằng copy đã có ats_test.db bị guard từ chối; không bỏ guard: chạy lại bằng source copy mới và đạt exit 0. Hai lỗi native harness ban đầu (TLS CA và thiếu connection slots trong cluster test riêng) được sửa trong môi trường disposable, không nới assertion hoặc TLS.

## 3. Kết quả theo từng Sprint / User Story

REVIEWED_AUTOMATED_EVIDENCE nghĩa là đã đọc AC/source và có suite liên quan chạy; không đồng nghĩa từng AC đã được PO ký, staging đã deploy hoặc đo đủ coverage. Chi tiết nguyên văn 120 AC và giới hạn từng AC nằm trong JSON kèm theo.

| Story | AC | Source trọng tâm | Suite thực chạy | Kết quả/phạm vi còn thiếu |
|---|---|---|---|---|
| S1-01 | 3 | authService | test:s1-01, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-02 | 3 | authService | test:s1-02, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-03 | 3 | authService/emailService | test:s1-03, test:coverage:sprint1 | PARTIAL; AUD-05 |
| S1-04 | 3 | authService | test:s1-04, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-05 | 4 | rbacMiddleware/server | test:s1-05, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE; AUD-01 |
| S1-06 | 3 | frontend/routes.json + app.js | test:s1-06, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-07 | 2 | rbacMiddleware + frontend errors | test:s1-07, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-08 | 4 | userService | test:s1-08, test:coverage:sprint1 | PARTIAL |
| S1-09 | 3 | userService/rbacMiddleware | test:s1-09, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S1-10 | 3 | userService/authService | test:s1-10, test:coverage:sprint1 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-01 | 3 | userService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-02 | 3 | userService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-03 | 2 | avatarService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-04 | 3 | departmentService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-05 | 3 | departmentService/requisitionService | test:sprint2, test:coverage:sprint2 | PARTIAL |
| S2-06 | 4 | competencyService | test:sprint2, test:coverage:sprint2 | PARTIAL |
| S2-07 | 3 | questionBankService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-08 | 3 | recruitmentCatalogService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-09 | 2 | careerPageService | test:sprint2, test:coverage:sprint2 | REVIEWED_AUTOMATED_EVIDENCE |
| S2-10 | 4 | requisitionService/requisitionApprovalService | test:s2-10, test:qa-s3-06 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-01 | 4 | approvalConfigurationService | test:s3-01 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-02 | 3 | requisitionApprovalService | test:s3-02 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-03 | 3 | requisitionTrackingService | test:s3-03 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-04 | 3 | headcountBudgetService | test:s3-04 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-05 | 2 | requisitionOperationsService | test:s3-05 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-06 | 3 | requisitionOperationsService | test:s3-06 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-07 | 3 | requisitionLifecycleService | test:s3-07 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-08 | 3 | requisitionTrackingService | test:s3-08 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-09 | 3 | jobPostingService | test:s3-09 | REVIEWED_AUTOMATED_EVIDENCE |
| S3-10 | 3 | jobPostingPublicationService | test:s3-10 | REVIEWED_AUTOMATED_EVIDENCE |
| S4-01 | 4 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE; AUD-11 |
| S4-02 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE |
| S4-03 | 5 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | PARTIAL; AUD-02, AUD-06, AUD-08, AUD-09, AUD-12 |
| S4-04 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE |
| S4-05 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE; AUD-08 |
| S4-06 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | PARTIAL; AUD-12 |
| S4-07 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE; AUD-07, AUD-09 |
| S4-08 | 2 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | PARTIAL |
| S4-09 | 3 | candidatePortalService + controller + portal frontend | test:s4, test:local-demo, test:deep-audit-security, test:p1, test:p2, test:p3, test:p4, test:p5, test:p6 | REVIEWED_AUTOMATED_EVIDENCE; AUD-02 |

Sprint 1: auth/session/account/role flows, RBAC guard và reset race có bằng chứng; email thật chưa chạy. Sprint 2: catalog/import/profile/salary/draft/submit validation có hồi quy; S2-05-AC2 và S2-06-AC4 phụ thuộc Sprint sau vẫn DEFERRED. Sprint 3: 10 suite S3, reapproval, quota/budget, assignment, publication và QA-S3-06 đều exit 0. Sprint 4: public apply/lookup/withdraw/referral/parse/unified và P1–P6 có hồi quy; S4-08 scheduler chưa có, người dùng chốt BLOCKED thiết kế job riêng. Dòng log S4 cũ tự ghi “100% nghiệm thu” chỉ là lời của test script, không được dùng để phủ nhận giới hạn trên.

## 4. Ma trận RBAC và data scope

| Role | Theo chính sách | Backend hiện có + kiểm chứng | Frontend | Kết luận |
|---|---|---|---|---|
| ADMIN | Toàn RBAC; vẫn chịu business guards | ACTIVE/grant resolution đặc quyền; không bỏ assignee/self-approval, stale version, salary validation | Menu/action theo permissions; matrix helper đã gửi Bearer | MATCH trong phạm vi test; grant runtime Azure UNVERIFIED |
| HR_MANAGER | Quản lý tuyển dụng rộng, users/audit chỉ đọc; giữ grant hợp lệ | Candidate broad read/write; cấu hình/budget/publish; không được ghi user/admin role | Menu/read/write gates và 7-role E2E | MATCH trên fixture; không cấp mới grant Azure |
| HIRING_MGR | Requisition sở hữu/quản lý/phòng ban; candidate đọc trong scope | candidate.update không dùng read scope; interview evaluation chỉ role/assignment hợp lệ; grant legacy interview.evaluate không tự biến thành write | DTO/capabilities và read-only actions | MATCH trong targeted tests; legacy physical grant giữ nguyên |
| RECRUITER | Primary/support position scope; không global expiry | P1 unified, P2 parse, P3 write, P4 projection, P5 download, P6 deny; assignment revoke kiểm lại | Menu và từng capability không thay thế backend guard | MATCH trong targeted tests |
| INTERVIEWER | Candidate/CV/Interview của vòng thực sự được phân công, kể cả vòng lịch sử | P5 assigned-round; evaluate cần assignment; không unified/parse/write note-tag chỉ vì đọc | Không mở UI download mới hay endpoint mới | MATCH trong targeted tests |
| APPROVER | Giữ broad candidate read đã phê duyệt; quyết định workflow theo assignee | Không dùng broad read để parse/note-tag; self-approval/assignee guards vẫn hoạt động | Approval controls theo step và permission | MATCH trong targeted tests |
| CANDIDATE | Hồ sơ chính mình; public projection; Offer ACCEPTED chỉ khi SENT | DB actor/email; scope trước total; public status; không internal note/metadata; P5 own document | Candidate tracker/public DTO; không mở documents metadata | MATCH trong targeted tests |

Scope tài khoản đa role là hợp các read scope hợp lệ theo từng row; không dùng role request để nâng quyền. Ghi/parse dùng role nghiệp vụ và assignment hẹp. Note private vẫn cần application read scope và chỉ tác giả/HR/ADMIN đọc. ADMIN implicit catalog permission không bị nhầm với grant vật lý.

Sai lệch xác nhận: AUD-01 = MISSING_CHECK → FIXED (bốn alias role matrix); AUD-03 = giả role chọn permission yếu/state bypass → FIXED. Các IDOR P1–P6 được giữ nguyên và chạy lại. Không tự gán OVER_PERMISSION/UNDER_PERMISSION cho dữ liệu Azure chưa được đọc. 72 grants nguồn và 62 grants đề xuất không bị chạm tới; reconciliation vẫn PENDING.

JSON có ma trận đầy đủ 50 permission × role fixture, 136 nhánh source và 941 observation. Observation 401/403 anonymous là MATCH_AUTH_BOUNDARY; HTTP 200/400/404 khác được giữ UNVERIFIED nếu chưa có test resource-specific. Việc GET trả 200 cho role hợp lệ không tự chứng minh không có BOLA. Không có chứng nhận blanket “tất cả API an toàn”.

## 5. Kiểm thử thực tế

| Lệnh/suite | Môi trường | PASS / FAIL | Exit |
|---|---|---|---|
| npm run test -- --all | Source export riêng từng script, SQLite/PGlite, simulated email | 61/61 script; không cộng thành ca duy nhất | 0 |
| test:deep-audit-security (lượt all) | SQLite + PGlite | 40 / 0 | 0 |
| node backend/tests/test_deep_audit_security.js với test URL loopback | SQLite + PGlite + PostgreSQL native 17.10 | 60 / 0; native riêng 20 | 0 |
| test:deep-audit-browser (chạy lại cuối) | Chromium thật desktop/mobile, có 2 full-stack flows | 16 / 0 | 0 |
| test:browser-e2e | Chromium thật, app synthetic | 65 / 0 | 0 |
| test:ui-interface (chạy lại cuối) | Chromium 1920/1366/1280/768/390 | 196 / 0 | 0 |
| test:rbac / test:ats-e2e / test:reapproval | SQLite/PGlite theo suite | 47 / 0; 52 / 0; 94 / 0 | 0 |
| test:qa-s3-06 | SQLite/PGlite | 73 / 0 | 0 |
| test:p1 / p2 / p3 / p4 / p5 / p6 | SQLite/PGlite | 46; 66; 122; 72; 112; 65 PASS, 0 FAIL | 0 |
| Native opt-in P2 / P3 / P4 / P5 / P6 | Mỗi suite gồm SQLite/PGlite và native PG17 | 100; 202; 108; 171; 95 PASS, 0 FAIL (không phải native-only) | 0 |
| Referral authorization native opt-in | SQLite/PGlite/native PG17, verify-full test CA | 64 / 0 | 0 |
| QA-S3-06 pg-wire | Native PG17, 10 kết nối độc lập, role test không superuser | 6 / 0; wrapper policy 32 / 0 | 0 |
| node --check trên JS sửa/tạo | Không thực thi ứng dụng | 17 / 0 | 0 |
| git diff --check | Repository source | Không whitespace error | 0 |

Tổng số script là 61, không phải 60. Script test:sprint1 lặp các suite S1; tổng assertion của các suite có trùng nên không báo một số unique test giả. Full runner loại các lệnh Azure/live; không gọi PostgreSQL native là PGlite. P1 native không có opt-in nên NOT RUN trên native. Strict harness PostgreSQL 16 vẫn giữ assertion version, không đổi thành 17.

Full run hợp lệ là Jga2N7 sau bản sửa S1-05: 61/61 script exit 0. Đã đối chiếu log và SHA-256, đồng thời kiểm tra source server, test S1-05 và các service bảo mật trong source copy trùng bản được báo cáo (chuẩn hóa CRLF/LF). Riêng candidates.js sau đó sửa hai label textContent để tránh hiển thị entity đã escape; đã có lượt Chromium/UI riêng auNW2E, không tuyên bố file này byte-identical với Jga2N7. Bốn alias RBAC matrix có authentication/role.read guard; fixture positive truyền ADMIN token, regression bổ sung anonymous/invalid token 401, Candidate 403 và ADMIN 200 mà giữ các assertion ma trận cũ. Lượt Nv9poY chỉ là evidence lịch sử, không dùng làm full regression cuối.

Log full: `C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-Jga2N7\results.json`. Log UI bổ sung: `C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-auNW2E\results.json`. Native: `C:\Users\Asus of Kien\Documents\Codex\ATS-deep-audit-20261015-142602\native-final.log`, `native-p2.log`…`native-p6.log`, `native-referral-final.log`, `native-qa-s3-06-retry.log`. Manifest JSON giữ checksum evidence lịch sử và bổ sung checksum của lượt full hợp lệ; không sửa log lịch sử.

## 6. Transaction và giới hạn môi trường

SQLite dùng abstraction transaction hiện có; PGlite pool test tuần tự để mô phỏng pool max 1, không được gọi là multi-connection proof. Native PG17 kiểm tra các backend PID khác nhau; qua test duplicate submit/referral, reset tokens, rate count, rollback và các suite P2–P6/QA-S3-06 đã có. Advisory lock dùng cùng key requisition/email giữa public apply và referral; khóa requisition trước posting để phù hợp luồng lifecycle. Grant reload trong transaction giữ FOR SHARE của actor/role/grant theo abstraction có sẵn. Không giữ lock khi gửi email.

Chỉ dựng cluster PostgreSQL 17.10 mới tại thư mục audit, nghe 127.0.0.1; mọi database test có tên riêng, không dùng DB/service có sẵn. Local test cluster đã dừng sau test; không xóa database. PostgreSQL 16 local không có, Docker daemon không chạy, Azure bị cấm kết nối trong nhiệm vụ này: NOT RUN. Native referral strict TLS dùng CA test riêng; không thay đổi secret/TLS/SSH của dự án. Native minimal security fixture cố ý stub notDraft để cô lập validator cũ; guard OPEN đầy đủ được kiểm tra riêng bằng QA-S3-06 và các suite app thật.

## 7. Files và bảo toàn

| File | Lý do |
|---|---|
| `backend/src/controllers/candidatePortalController.js` | Socket IP, pagination, sanitized HTTP errors |
| `backend/src/server.js` | Guard cả bốn alias RBAC matrix |
| `backend/src/services/authService.js` | OTP claim/reset invalidation + concurrency |
| `backend/src/services/candidatePortalService.js` | Public/referral transaction, rollback CV, formats, email escaping |
| `backend/src/services/emailService.js` | Export helper escape HTML đã có |
| `backend/src/services/requisitionService.js` | Offer actor/state; interview validation/score |
| `backend/tests/test_s1_05_integration.js` | Fixture positive có auth; thêm negative bốn alias; giữ assertions cũ |
| `frontend/js/api.js` | Bearer cho matrix helper |
| `frontend/js/components/interview-dialogs.js` | Escape options; giữ score hiện có |
| `frontend/js/components/offer-dialogs.js` | Escape options |
| `frontend/js/pages/candidates.js` | Escape HTML sinks, serialize ID; textContent giữ nguyên |
| `frontend/js/pages/dashboard.js` | Escape labels |
| `frontend/js/pages/interviews.js` | Escape labels và serialized ID |
| `frontend/js/pages/offers.js` | Escape labels và serialized ID |
| `frontend/js/pages/reports.js` | Hardening HTML sink chưa có producer hiện tại |
| `package.json` | Đưa test mới và P1–P6/referral vào local runner |
| `backend/tests/test_deep_audit_browser.js` | Regression Chromium XSS, score, Bearer và public upload→DB→UI |
| `backend/tests/test_deep_audit_security.js` | Regression mới SQLite/PGlite/native opt-in |
| `docs/ATS-deep-audit-2026-10-15.md` | Báo cáo này |
| `docs/evidence/ATS-deep-audit-2026-10-15.json` | Evidence, AC/permission/API matrices, suite exits, protection hashes |

Baseline 634 file đã băm: 16 file có sẵn thay đổi đúng danh sách source/test/package ở trên, 618 file không đổi, 0 file mất. 213 file thuộc tập protected (runtime/data, migrations, evidence cũ, .env, lockfile, tests P1–P6) có SHA256 trước/sau giống nhau. 10 vùng P1–P6/read predicates được so SHA256 sau chuẩn hóa CRLF→LF, tất cả bằng nhau. Không nhầm khác line ending với thay đổi logic. HEAD và SHA256 .git/index giữ nguyên. Bản hash chi tiết có trong JSON.

Khởi đầu clean; kết thúc riêng đợt audit là 16 modified + 3 untracked (2 test, 1 Markdown) + 1 ignored JSON evidence. Đây là mốc lịch sử trước thay đổi Git safety và final hardening, không phải Git status hiện tại. Không stage/commit/push/merge hay lệnh Git mutation khác. Static secret scan added lines + toàn bộ untracked không tìm private key, URL PostgreSQL chứa password hay token cloud thật; fixture password/token là synthetic. Không đưa DB/log/media/.env/node_modules vào Git diff. Secret scan heuristic không thay thế audit mọi lịch sử Git. Không mở database nghiệp vụ để chạy test, không kết nối Azure/Neon; chỉ xác nhận không có hành động thay đổi từ nhiệm vụ này, không tuyên bố kiểm tra trạng thái remote DB chưa đọc.

## 8. Những phần chưa thể kết luận và bước tiếp theo

1. **BLOCKED có quyết định:** S4-08 scheduler mỗi ngày giữ nguyên để thiết kế trusted job riêng, không tạo actor SYSTEM hay bypass P6.
2. **NOT RUN:** Native PostgreSQL 16.15 và Azure regression/readback; cần môi trường test disposable riêng được phép trước chứng nhận tương thích version/triển khai. Không migration/seed/import Azure trong lượt này.
3. **PENDING:** Reconciliation grants Azure; không cấp 62 grants, không đổi 72 grants nguồn, không biến bảy pha PENDING thành COMPLETE. Ma trận fixture đủ chức năng không chứng minh Azure đã đủ grant.
4. **PARTIAL:** Email reset/kích hoạt/xác nhận/rút hồ sơ mới kiểm simulated; cần SMTP sandbox thật để xác nhận delivery.
5. **DEFERRED:** S2-05-AC2 Offer hạn mức tương lai; S2-06-AC4 phiếu đánh giá Sprint 6. Không xây mới trong audit Sprint 1–4.
6. **UNVERIFIED:** PO/UAT, brand/visual signoff, >=60% branch coverage và mọi tổ hợp payload/resource chưa được targeted test. 941 request không bao phủ mọi body, mọi state và race có thể có.
7. **Vận hành:** Nếu đưa sau reverse proxy, cần trust-proxy allowlist riêng; hiện dùng socket IP nên nhiều client sau cùng proxy có thể chia quota. Không tin XFF tùy ý.
8. **Chưa deploy:** Thay đổi chỉ ở working tree; instance đang chạy có thể còn module cache cũ. Không restart Azure/production hoặc đổi traffic. Source baseline đã có migration 010; không suy đoán môi trường Azure đã áp dụng nếu chưa preflight được phép.

Không còn lỗi P0/P1 đã tái hiện trong danh sách trên mà chưa sửa. Tuy nhiên các mục BLOCKED/UNVERIFIED khiến chưa đủ điều kiện kết luận toàn Sprint 1–4 đã đạt yêu cầu hay sẵn sàng production. Dừng tại báo cáo, chờ người dùng review diff.
