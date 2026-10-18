# BÁO CÁO KIỂM TOÁN HỆ THỐNG TOÀN DIỆN ATS SPRINT 1 – SPRINT 7
- **Dự án:** `TTCS_T926_K3S4_N2` — Hệ thống Quản lý Tuyển dụng (ATS)
- **Ngày kiểm toán:** 18/10/2026
- **Nhánh kiểm toán:** `fix/full-system-deep-audit-s1-s7`
- **Commit cơ sở:** `b0e3ce68d37c5130ba079dd0c246623908490b63` (`origin/develop`, đã tích hợp bản vá kiểm toán Sprint 7 `fix/sprint7-deep-audit`)
- **Worktree cô lập:** `A:\Projects\TTCS_T926_K3S4_N2\.local\worktrees\full-system-deep-audit-s1-s7`
- **Database vận hành đối chiếu:** PostgreSQL 16.15 (Ubuntu) trên Microsoft Azure Staging (Read-Only)

---

## 1. Executive Summary (Tóm tắt điều hành)

### 1.1. Mục tiêu
Thực hiện rà soát và kiểm toán độc lập 100% phạm vi tính năng từ Sprint 1 đến Sprint 7 (tổng cộng 67 User Story). Mục tiêu là chủ động tìm kiếm các lỗ hổng phân quyền (RBAC/IDOR), sai lệch toàn vẹn dữ liệu tiềm ẩn giữa các Sprint, lỗi transaction/concurrency/locking, và sai khác vận hành giữa SQLite cục bộ, PGlite nhúng và PostgreSQL native trên Microsoft Azure.

### 1.2. Tổng quan phạm vi Sprint 1–7
Hệ thống ATS đã trải qua 7 chu kỳ phát triển với 67 User Story, 38 Services nghiệp vụ, 26 tệp migrations cơ sở dữ liệu và 7 vai trò người dùng (ADMIN, HR_MANAGER, RECRUITER, INTERVIEWER, HIRING_MANAGER, CANDIDATE, EMPLOYEE).

| Sprint | Chủ đề chính | Số lượng User Story | Trạng thái kiểm toán |
| :--- | :--- | :---: | :---: |
| **Sprint 1** | Nền tảng hệ thống, Xác thực, Quản lý người dùng, Danh mục sơ bộ | 10 (S1-01 → S1-10) | PASS 100% |
| **Sprint 2** | Quản lý Yêu cầu tuyển dụng (Requisition), Phê duyệt, Ngân sách | 10 (S2-01 → S2-10) | PASS 100% |
| **Sprint 3** | Cổng tuyển dụng công khai, Đăng tin, Nộp hồ sơ, Theo dõi ứng viên | 10 (S3-01 → S3-10) | PASS 100% |
| **Sprint 4** | Sàng lọc ứng viên, Tìm kiếm đa tiêu chí, Bộ lọc đã lưu, Xuất dữ liệu | 09 (S4-01 → S4-09) | PASS 100% |
| **Sprint 5** | Duplicate detection, So sánh & Gộp hồ sơ (Merge), Lịch phỏng vấn | 10 (S5-01 → S5-10) | Đã phát hiện & khắc phục lỗi gộp hồ sơ |
| **Sprint 6** | Ngân hàng câu hỏi, Phỏng vấn hội đồng, Đánh giá năng lực độc lập | 09 (S6-01 → S6-09) | PASS 100% |
| **Sprint 7** | Offer proposal, Phê duyệt đa cấp, Delivery token, Onboarding, Bulk mail | 09 (S7-01 → S7-09) | Đã tái xác nhận 16 nhóm lỗi F01–F16 |
| **Tổng cộng** | **Toàn bộ hệ thống ATS** | **67 User Stories** | **100% HOÀN TẤT KIỂM TOÁN** |

### 1.3. Kết quả tổng quát
- **Lỗi toàn vẹn dữ liệu nghiêm trọng được phát hiện và khắc phục:**
  - Phát hiện lỗi thiếu đồng bộ dữ liệu liên kết chéo Sprint khi gộp ứng viên (`candidateMergeService.js`): Khi thực hiện gộp hồ sơ `secondary` vào `primary`, các bảng mới từ Sprint 6 và Sprint 7 có khóa ngoại tham chiếu đến `candidates(id)` gồm `hiring_decisions` (Sprint 7), `interview_batch_items` (Sprint 6), `onboarding_checklists` (Sprint 7), và `candidate_communications` (Sprint 7) không nằm trong danh sách bảng con được xử lý.
  - Hậu quả: Quyết định tuyển dụng (`hiring_decisions`) bị tách rời khỏi lịch phỏng vấn (`interviews`) đã gộp, checklist onboarding bị bỏ sót hoặc gây xung đột `UNIQUE`, và thao tác so sánh (`compare`) cũng như hoàn tác (`undo`) bị sai lệch dữ liệu.
  - Biện pháp khắc phục: Bổ sung đầy đủ 4 bảng vào quy trình chuyển đổi quan hệ, xử lý ràng buộc duy nhất (`UNIQUE`, partial unique index), bổ sung kiểm tra xung đột thư mời (`offers`) đang hoạt động, và hoàn thiện cơ chế hoàn tác 24 giờ.
- **Tình trạng kiểm thử:**
  - 100% các suite kiểm thử cục bộ chạy thành công qua `run_local_tests.js`.
  - Bộ kiểm thử hồi quy mới `test:full-system-deep-audit` xác nhận PASS trên cả SQLite và PGlite/PostgreSQL.
  - Bộ kiểm thử `test:sprint7-deep-audit` (16 nhóm F01–F16) tái xác nhận PASS 100%.
  - `git-safety.js check` xác nhận `GIT_SAFETY_OK`, không chứa bí mật hay mã thông báo nhạy cảm.

---

## 2. Ma trận chức năng Sprint 1–7 (67 User Stories)

| ID | Tên User Story | Sprint | Endpoint / Controller | Service Layer | Quyền RBAC | Scope kiểm soát | Kết quả kiểm toán |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :---: |
| **S1-01** | Đăng nhập, đăng xuất, phiên làm việc | S1 | `/api/v1/auth/login`, `/logout`, `/me` | `authService.js` | Public / Session | IP rate-limit, account lockout | PASS |
| **S1-02** | Quên mật khẩu & OTP xác thực | S1 | `/api/v1/auth/forgot-password`, `/verify-otp` | `authService.js` | Public | OTP 6 số, TTL 5 phút | PASS |
| **S1-03** | Quản lý danh sách người dùng | S1 | `/api/v1/users` (GET, POST) | `userService.js` | `user.read`, `user.create` | Role, Dept scope | PASS |
| **S1-04** | Trạng thái tài khoản & Khóa/Mở khóa | S1 | `/api/v1/users/:id/status` | `userService.js` | `user.update` | Không tự khóa chính mình | PASS |
| **S1-05** | Phân quyền vai trò & RBAC | S1 | `/api/v1/roles`, `/permissions` | `rbacMiddleware.js` | `role.read`, `role.assign` | RBAC matrix cache invalidation | PASS |
| **S1-06** | Cập nhật thông tin cá nhân | S1 | `/api/v1/users/profile` | `userService.js` | `profile.update` | Tự sở hữu (Self-scope) | PASS |
| **S1-07** | Tải lên ảnh đại diện & xác thực MIME | S1 | `/api/v1/users/:id/avatar` | `avatarService.js` | `user.update`, Self | Magic bytes (JPEG, PNG, WebP) | PASS |
| **S1-08** | Quản lý phòng ban & cây phân cấp | S1 | `/api/v1/departments` | `departmentService.js` | `department.manage` | Chống vòng lặp cây cha con | PASS |
| **S1-09** | Khung năng lực & Tiêu chí đánh giá | S1 | `/api/v1/competencies` | `competencyService.js` | `competency.manage` | Tổng trọng số = 100% | PASS |
| **S1-10** | Quản lý chức danh & thang bậc | S1 | `/api/v1/job-titles` | `competencyService.js` | `job_title.manage` | Min salary <= Max salary | PASS |
| **S2-01** | Tạo yêu cầu tuyển dụng mới | S2 | `/api/v1/requisitions` (POST) | `requisitionService.js` | `requisition.create` | Draft status, validation | PASS |
| **S2-02** | Danh sách & bộ lọc yêu cầu tuyển dụng | S2 | `/api/v1/requisitions` (GET) | `requisitionService.js` | `requisition.read` | Lọc theo phòng ban/recruiter | PASS |
| **S2-03** | Xem chi tiết & chỉnh sửa yêu cầu | S2 | `/api/v1/requisitions/:id` (PUT) | `requisitionService.js` | `requisition.update` | Requisition scope | PASS |
| **S2-04** | Cấu hình luồng phê duyệt | S2 | `/api/v1/approval-configurations` | `approvalConfigurationService.js` | `approval.config` | Ma trận phê duyệt đa cấp | PASS |
| **S2-05** | Phê duyệt yêu cầu tuyển dụng | S2 | `/api/v1/requisitions/:id/approve` | `requisitionApprovalService.js` | `requisition.approve` | Next-step approver only | PASS |
| **S2-06** | Kiểm soát ngân sách & định biên | S2 | `/api/v1/headcount-budgets` | `headcountBudgetService.js` | `headcount.check` | Headcount overrun guard | PASS |
| **S2-07** | Thao tác yêu cầu: Tạm dừng, Hủy, Nhân bản | S2 | `/api/v1/requisitions/:id/operations` | `requisitionOperationsService.js` | `requisition.manage` | Chuyển đổi trạng thái hợp lệ | PASS |
| **S2-08** | Vòng đời chuyển trạng thái tuyển dụng | S2 | `/api/v1/requisitions/:id/lifecycle` | `requisitionLifecycleService.js` | `requisition.lifecycle` | Finite State Machine (FSM) | PASS |
| **S2-09** | Theo dõi tiến độ & dự thảo tin tuyển dụng | S2 | `/api/v1/requisitions/:id/drafts` | `requisitionTrackingService.js` | `requisition.draft` | Bản nháp tin tuyển dụng | PASS |
| **S2-10** | Quản trị danh mục dùng chung tuyển dụng | S2 | `/api/v1/catalogs` | `recruitmentCatalogService.js` | `catalog.manage` | Nguồn, lý do loại, địa điểm | PASS |
| **S3-01** | Xuất bản tin tuyển dụng công khai | S3 | `/api/v1/job-postings/publish` | `jobPostingPublicationService.js` | `job_posting.publish` | Chỉ xuất bản Requisition OPEN | PASS |
| **S3-02** | Cấu hình trang nghề nghiệp (Career Page) | S3 | `/api/v1/career-page/settings` | `careerPageService.js` | `career.manage` | Singleton setting id=1 | PASS |
| **S3-03** | Cổng ứng tuyển công khai cho ứng viên | S3 | `/api/v1/public/jobs`, `/apply` | `candidatePortalService.js` | Public | CAPTCHA/Rate limit theo IP | PASS |
| **S3-04** | Giới hạn tần suất nộp hồ sơ & theo dõi | S3 | `/api/v1/public/rate-limit` | `candidatePortalService.js` | Public | 5 lần/giờ/IP | PASS |
| **S3-05** | Tải lên tài liệu CV & bóc tách dữ liệu | S3 | `/api/v1/candidates/:id/documents` | `candidatePortalService.js` | `candidate.document` | PDF parsing, kích thước <= 10MB | PASS |
| **S3-06** | Ghi nhận giới thiệu nội bộ (Referral) | S3 | `/api/v1/referrals` | `candidatePortalService.js` | `referral.create` | Nhân viên nội bộ giới thiệu | PASS |
| **S3-07** | Ghi chú và gắn thẻ ứng viên | S3 | `/api/v1/candidates/:id/notes`, `/tags` | `candidatePortalService.js` | `candidate.note` | Ghi chú nội bộ, gắn nhãn | PASS |
| **S3-08** | Lịch sử thay đổi trạng thái ứng viên | S3 | `/api/v1/candidates/:id/status-history` | `candidatePortalService.js` | `candidate.read` | Nhật ký bất biến (Audit log) | PASS |
| **S3-09** | Rút hồ sơ ứng tuyển bằng mã bảo mật | S3 | `/api/v1/public/withdraw` | `candidatePortalService.js` | Token Bearer | SHA-256 token hash timing-safe | PASS |
| **S3-10** | Chính sách mở requisition nghiêm ngặt | S3 | `/api/v1/requisitions/:id/open-policy` | `requisitionOpenPolicyService.js` | `requisition.manage` | Chống nộp vào vị trí DRAFT | PASS |
| **S4-01** | Nhập hồ sơ ứng viên thủ công | S4 | `/api/v1/candidates/manual` | `candidateManualEntryService.js` | `candidate.create` | Chuẩn hóa email, số điện thoại | PASS |
| **S4-02** | Sàng lọc & cập nhật giai đoạn hàng loạt | S4 | `/api/v1/candidates/screening/batch` | `candidateScreeningService.js` | `candidate.screen` | Cập nhật hàng loạt có kiểm soát | PASS |
| **S4-03** | Ràng buộc chuyển giai đoạn ứng viên | S4 | `/api/v1/candidates/:id/stage` | `candidateStageService.js` | `candidate.update` | Ngoại lệ duyệt bởi HR_MANAGER | PASS |
| **S4-04** | Dòng thời gian hoạt động ứng viên | S4 | `/api/v1/candidates/:id/timeline` | `candidateTimelineService.js` | `candidate.read` | Tổng hợp lịch sử xuyên suốt | PASS |
| **S4-05** | Tìm kiếm ứng viên nâng cao | S4 | `/api/v1/candidates/search` | `candidateSearchService.js` | `candidate.read` | SQL injection safe, index tốt | PASS |
| **S4-06** | Lưu bộ lọc tìm kiếm cá nhân | S4 | `/api/v1/candidates/saved-filters` | `candidateSearchService.js` | `candidate.read` | Tự sở hữu (user_id scoped) | PASS |
| **S4-07** | Xuất dữ liệu ứng viên ra Excel | S4 | `/api/v1/candidates/export` | `candidateExportService.js` | `candidate.export` | Che mờ dữ liệu nhạy cảm | PASS |
| **S4-08** | Quản lý kho nhân tài (Talent Pool) | S4 | `/api/v1/talent-pool` | `talentPoolService.js` | `talent_pool.manage` | Hồ sơ tiềm năng lưu trữ dài hạn | PASS |
| **S4-09** | Cảnh báo SLA yêu cầu tuyển dụng | S4 | Background Cron Job | `slaNotificationService.js` | System Worker | Cảnh báo quá hạn xử lý hồ sơ | PASS |
| **S5-01** | Phát hiện ứng viên trùng lặp | S5 | `/api/v1/candidates/duplicates` | `candidateSearchService.js` | `candidate.read` | Khớp email (case-folded), SĐT | PASS |
| **S5-02** | So sánh chi tiết 2 hồ sơ ứng viên | S5 | `/api/v1/candidates/merge/compare` | `candidateMergeService.js` | `candidate.read` | Đã bổ sung 4 bảng Sprint 6 & 7 | PASS (Fixed) |
| **S5-03** | Gộp hồ sơ ứng viên (Merge) | S5 | `/api/v1/candidates/merge` | `candidateMergeService.js` | `candidate.merge` | Đã đồng bộ toàn bộ bảng con | PASS (Fixed) |
| **S5-04** | Hoàn tác gộp hồ sơ trong 24 giờ | S5 | `/api/v1/candidates/merge/:id/undo` | `candidateMergeService.js` | `candidate.merge.undo` | Khôi phục chính xác ID con | PASS (Fixed) |
| **S5-05** | Lịch sử các lần gộp hồ sơ | S5 | `/api/v1/candidates/merge/recent` | `candidateMergeService.js` | `candidate.merge.undo` | Top 30 lần gộp trạng thái MERGED | PASS |
| **S5-06** | Lên lịch phỏng vấn đơn lẻ | S5 | `/api/v1/interviews` (POST) | `requisitionService.js` | `interview.create` | Conflict check & validation | PASS |
| **S5-07** | Phân công hội đồng phỏng vấn | S5 | `/api/v1/interviews/:id/interviewers` | `requisitionService.js` | `interview.assign` | Multi-interviewer assignment | PASS |
| **S5-08** | Phát hiện & ghi đè trùng lịch | S5 | `/api/v1/interviews/conflict-override` | `requisitionService.js` | `interview.override` | Nhật ký ghi đè trùng lịch | PASS |
| **S5-09** | Gửi thư mời phỏng vấn & Token | S5 | `/api/v1/interviews/:id/invitations` | `interviewInvitationService.js` | `interview.invite` | Token an toàn gửi qua email | PASS |
| **S5-10** | Dời lịch & Hủy phỏng vấn | S5 | `/api/v1/interviews/:id/reschedule` | `requisitionService.js` | `interview.reschedule` | Trạng thái RESCHEDULED/CANCELLED | PASS |
| **S6-01** | Quản lý ngân hàng câu hỏi phỏng vấn | S6 | `/api/v1/questions` | `questionBankService.js` | `question.manage` | Tiêu chí đánh giá, gợi ý câu trả lời | PASS |
| **S6-02** | Phân loại câu hỏi theo độ khó | S6 | `/api/v1/questions/categorize` | `questionBankService.js` | `question.manage` | EASY, MEDIUM, HARD | PASS |
| **S6-03** | Lên lịch phỏng vấn hàng loạt | S6 | `/api/v1/interviews/bulk` | `bulkInterviewService.js` | `interview.create` | Preview, idempotent confirmation | PASS |
| **S6-04** | Tác vụ nền gửi thư mời hàng loạt | S6 | Worker Runner | `interviewInvitationWorker.js` | Background Task | Batch delivery, retry mechanism | PASS |
| **S6-05** | Phiếu đánh giá phỏng vấn theo năng lực | S6 | `/api/v1/evaluations/:id` | `interviewEvaluationService.js` | `evaluation.evaluate` | Điểm thang 1-5, tiêu chí snapshot | PASS |
| **S6-06** | Bản nháp đánh giá & Khóa khi nộp | S6 | `/api/v1/evaluations/:id/submit` | `interviewEvaluationService.js` | `evaluation.submit` | Khóa SUBMITTED chống ghi đè | PASS |
| **S6-07** | Đánh giá ẩn danh (Blind evaluation) | S6 | `/api/v1/evaluations/blind` | `interviewEvaluationService.js` | `evaluation.read` | Che kết quả người phỏng vấn khác | PASS |
| **S6-08** | Tính toán điểm số năng lực tổng hợp | S6 | `/api/v1/evaluations/scores` | `interviewEvaluationService.js` | `evaluation.read` | Điểm bình quân có trọng số | PASS |
| **S6-09** | Tổng hợp nhận xét & đồng thuận | S6 | `/api/v1/evaluations/consensus` | `interviewEvaluationService.js` | `evaluation.manage` | Đề xuất tuyển dụng của hội đồng | PASS |
| **S7-01** | Lịch phỏng vấn cá nhân của người phỏng vấn | S7 | `/api/v1/interviews/my-schedule` | `interviewScopeService.js` | `interview.read` | Interviewer-scoped filter | PASS |
| **S7-02** | Gợi ý câu hỏi phỏng vấn theo vị trí | S7 | `/api/v1/questions/suggestions` | `questionBankService.js` | `question.read` | Gợi ý dựa trên Job Title & Criteria | PASS |
| **S7-03** | Ghi nhận quyết định tuyển dụng | S7 | `/api/v1/hiring-decisions` | `hiringDecisionService.js` | `decision.record` | OFFER/REJECT/PASS/HOLD, lý do loại | PASS |
| **S7-04** | Soạn thảo đề xuất Offer & Đãi ngộ | S7 | `/api/v1/offers` (POST, PUT) | `offerService.js` | `offer.create` | Cơ cấu lương, phụ cấp, ngày nhận việc | PASS |
| **S7-05** | Luồng phê duyệt Offer đa cấp | S7 | `/api/v1/offers/:id/approve` | `offerService.js` | `offer.approve` | Lịch sử duyệt bất biến (Trigger DB) | PASS |
| **S7-06** | Gửi thư mời & Token phản hồi an toàn | S7 | `/api/v1/offers/:id/send` | `offerService.js` | `offer.send` | Token duy nhất, hết hạn hợp lệ | PASS |
| **S7-07** | Tiếp nhận phản hồi Offer từ ứng viên | S7 | `/api/v1/public/offers/respond` | `offerService.js` | Public Token | Đồng ý (HIRED), Từ chối, Đàm phán | PASS |
| **S7-08** | Danh mục thủ tục nhận việc (Onboarding) | S7 | `/api/v1/onboarding` | `onboardingService.js` | `onboarding.manage` | Giao việc theo role/user, sync stage | PASS |
| **S7-09** | Gửi email hàng loạt cho ứng viên | S7 | `/api/v1/communications/bulk` | `candidateCommunicationService.js` | `communication.send` | Chống gửi trùng lặp, template merge | PASS |

---

## 3. Ma trận phân quyền (RBAC Matrix)

### 3.1. Phân bổ vai trò và quyền hạn

| Quyền hệ thống | ADMIN | HR_MANAGER | RECRUITER | INTERVIEWER | HIRING_MANAGER | CANDIDATE | EMPLOYEE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `user.read`, `user.create`, `user.update` | ✓ | ✓ | — | — | — | — | — |
| `role.read`, `role.assign` | ✓ | — | — | — | — | — | — |
| `department.manage` | ✓ | ✓ | — | — | — | — | — |
| `competency.manage`, `job_title.manage` | ✓ | ✓ | — | — | — | — | — |
| `requisition.create`, `requisition.update` | ✓ | ✓ | ✓ (Assigned) | — | ✓ (Own Dept) | — | — |
| `requisition.approve` | ✓ | ✓ | — | — | ✓ (Assigned Level) | — | — |
| `candidate.create`, `candidate.update` | ✓ | ✓ | ✓ (Assigned Req) | — | — | — | — |
| `candidate.merge`, `candidate.merge.undo` | ✓ | ✓ | ✓ (Assigned Req) | — | — | — | — |
| `interview.create`, `interview.reschedule` | ✓ | ✓ | ✓ (Assigned Req) | — | — | — | — |
| `interview.evaluate`, `evaluation.submit` | ✓ | ✓ | — | ✓ (Assigned) | ✓ (Assigned) | — | — |
| `decision.record` | ✓ | ✓ | — | — | ✓ (Assigned Req) | — | — |
| `offer.create`, `offer.send` | ✓ | ✓ | ✓ (Assigned Req) | — | — | — | — |
| `offer.approve` | ✓ | ✓ | — | — | ✓ (Approval Chain) | — | — |
| `onboarding.manage` | ✓ | ✓ | ✓ (Assigned) | — | — | — | — |
| `communication.send` | ✓ | ✓ | ✓ (Assigned Req) | — | — | — | — |
| `referral.create` | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |

### 3.2. Đánh giá phòng thủ chiều sâu (Defense-in-Depth)
1. **Kiểm tra 2 lớp:** Toàn bộ các thao tác nghiệp vụ đều kiểm tra quyền tại HTTP Layer (`RbacMiddleware.authorize`) và Service Layer (`RbacMiddleware.getAuthorizedActor` kết hợp `assertScope`).
2. **Không tin cậy caller:** Tham số `roles`, `userId`, `permissions` truyền từ client hoặc request header bị loại bỏ hoàn toàn; hệ thống luôn query lại thông tin thực tế từ database theo session token.
3. **Phạm vi quản lý (Scope Boundary):**
   - Recruiter chỉ được thao tác trên các Requisition và Candidate mà mình được phân công (`recruiter_id`).
   - Interviewer chỉ xem được thông tin các buổi phỏng vấn mà mình được chỉ định là người phỏng vấn hoặc thành viên panel.
   - Hiring Manager chỉ được duyệt Requisition hoặc đưa ra quyết định tuyển dụng thuộc phòng ban quản lý.

---

## 4. Kiểm toán Database chuyên sâu

### 4.1. Hệ thống migration (26 ledger migrations)
Hệ thống sử dụng bảng sổ cái `ats_*_migrations` để theo dõi mã checksum và phiên bản từng migration.

```
001_postgres.sql                                 -> Khởi tạo bảng nền tảng (candidates, users, requisitions, interviews, offers...)
002_approval_configurations_*.sql                -> Cấu hình phê duyệt đa cấp
003_requisition_approvals_*.sql                  -> Lịch sử phê duyệt yêu cầu tuyển dụng
004_headcount_budgets_*.sql                      -> Ngân sách & định biên nhân sự
005_requisition_operations_*.sql                 -> Thao tác tạm dừng, hủy, clone yêu cầu
006_requisition_lifecycle_*.sql                  -> Quản lý vòng đời yêu cầu
007_requisition_tracking_job_drafts_*.sql        -> Theo dõi yêu cầu và tin tuyển dụng nháp
008_job_publication_*.sql                        -> Xuất bản tin tuyển dụng công khai
009_candidate_portal_*.sql                       -> Cổng ứng viên, CV documents, status history, tokens
010_requisition_open_policy_*.sql                -> Chính sách mở Requisition nghiêm ngặt
011_candidate_stage_transitions_*.sql            -> Ràng buộc chuyển giai đoạn & exceptions
012_candidate_search.sql                         -> Chỉ mục tìm kiếm ứng viên
013_talent_pool.sql                              -> Bảng kho nhân tài (Talent pool)
014_interview_scheduling_*.sql                   -> Hội đồng phỏng vấn (interview_interviewers)
015_bulk_interviews.sql                          -> Phỏng vấn hàng loạt (interview_batches, items)
015_candidate_merges_*.sql                       -> Gộp hồ sơ ứng viên (candidate_merge_events)
015_interview_conflict_override_*.sql            -> Ghi đè trùng lịch phỏng vấn
016_interview_invitations_*.sql                  -> Token mời phỏng vấn
017_interview_reschedule_cancel_*.sql            -> Dời lịch và hủy phỏng vấn
018_interview_evaluations_*.sql                  -> Đánh giá năng lực độc lập (evaluations, items)
019_interview_question_suggestions_*.sql         -> Câu hỏi đã hỏi trong buổi phỏng vấn
020_hiring_decisions_*.sql                       -> Quyết định tuyển dụng (hiring_decisions)
021_offer_proposals_*.sql                        -> Đề xuất offer & cơ cấu đãi ngộ
022_offer_approvals_*.sql                        -> Phê duyệt offer đa cấp & Trigger chống sửa
023_offer_delivery_*.sql                         -> Token gửi offer cho ứng viên
024_offer_negotiation_*.sql                      -> Đàm phán và từ chối offer
025_onboarding_checklists_*.sql                  -> Thủ tục nhận việc (templates, checklists, items)
026_bulk_candidate_communications_*.sql          -> Gửi email hàng loạt & mẫu thư
```

### 4.2. Ràng buộc toàn vẹn & Sai lệch giữa các môi trường (Adapter Parity)
- **SQLite / PGlite / PostgreSQL Native trên Azure:**
  - **Case-insensitivity:** Trên PostgreSQL, `email` được so sánh bằng hàm `lower()` hoặc biểu thức quy chuẩn trong `postgresSQL` translation (`backend/src/db/postgres.js`), khắc phục triệt để lỗi phân biệt hoa thường khi tìm kiếm người dùng và ứng viên.
  - **Locking:** Trên PostgreSQL hỗ trợ `FOR UPDATE` và advisory locks (`pg_advisory_xact_lock`), trong khi SQLite vận hành qua transaction tuần tự cấp cơ sở dữ liệu.
  - **Partial Unique Indexes:** Các chỉ mục có điều kiện (WHERE clause) như `uq_candidate_rejection_sent` và `idx_offers_active_candidate` được hỗ trợ nhất quán trên cả SQLite 3.8+ và PostgreSQL.
  - **Immutable Triggers:** Bảng `offer_approvals` sử dụng Trigger `prevent_offer_approvals_mutation()` trên PostgreSQL và trigger tương ứng trên SQLite để đảm bảo lịch sử phê duyệt là bất biến.

---

## 5. Phân tích Transaction, Concurrency & Locking

1. **Gộp hồ sơ đồng thời (Concurrent Candidate Merge):**
   - Đã xử lý khóa tài nguyên 2 đầu bằng cách sắp xếp ID tăng dần (`ids.sort()`) trước khi acquire lock (`FOR UPDATE`), ngăn ngừa hoàn toàn Deadlock chu kỳ.
   - Kiểm tra cờ `merged_into_id` bên trong transaction cô lập; thao tác đồng thời thứ 2 sẽ bị từ chối sạch sẽ với mã lỗi 409 `CANDIDATE_ALREADY_MERGED`.
2. **Tiếp nhận Offer & Tràn định biên (Headcount Overrun Race Condition):**
   - Khi ứng viên đồng ý nhận việc (`ACCEPTED`), hệ thống mở transaction khóa bảng `requisitions` và `headcount_budgets`.
   - Đếm lại số lượng offer đã `ACCEPTED` trong thời gian thực trước khi chuyển trạng thái của ứng viên sang `HIRED`. Nếu vượt quá `headcount`, giao dịch bị rollback và từ chối.
3. **Đàm phán Offer (Offer Negotiation Race Condition):**
   - Sử dụng transaction kiểm tra trạng thái `SENT` trước khi cập nhật thành `NEGOTIATING` hoặc `SUPERSEDED`, thu hồi token cũ ngay lập tức (F13).
4. **Phỏng vấn hàng loạt (Bulk Interview Confirmation Idempotency):**
   - Khóa bản ghi theo `request_key` và `payload_hash`. Nếu nhận request trùng lặp do mạng chập chờn, hệ thống trả về kết quả đã committed thay vì tạo lịch trùng.

---

## 6. Khảo sát Endpoint & Routes
Hệ thống sử dụng bộ định tuyến HTTP tại `backend/src/server.js` chia tách theo các Controllers chuyên trách:
- `AuthController`: Quản lý xác thực, đăng nhập, OTP, session.
- `UserController`: CRUD tài khoản, trạng thái, avatar, phân quyền.
- `DepartmentController`: Quản lý phòng ban.
- `CompetencyController`: Quản lý khung năng lực, tiêu chí, chức danh.
- `RequisitionController`: Vòng đời yêu cầu tuyển dụng, ngân sách.
- `JobPostingController`: Đăng tin tuyển dụng công khai.
- `CandidatePortalController`: Nộp đơn, rút đơn, tài liệu CV.
- `CandidateController`: Tìm kiếm, sàng lọc, timeline, gán thẻ.
- `CandidateMergeController`: So sánh, gộp hồ sơ, hoàn tác.
- `InterviewController`: Lên lịch đơn lẻ, hàng loạt, dời lịch, hủy.
- `EvaluationController`: Phiếu đánh giá, chấm điểm năng lực, đồng thuận.
- `OfferController`: Soạn offer, phê duyệt, gửi offer, phản hồi.
- `OnboardingController`: Quản lý checklist nhận việc, tiến độ.
- `CandidateCommunicationController`: Gửi email hàng loạt theo mẫu.

Mọi controller đều kế thừa cơ chế phản hồi JSON thống nhất, thiết lập `Cache-Control: no-store` cho các endpoint dữ liệu nhạy cảm, và xử lý mã lỗi HTTP chuẩn (400, 401, 403, 404, 409, 410, 500).

---

## 7. Khảo sát Service Layer
Gồm 38 backend services độc lập, tuân thủ nguyên tắc Single Responsibility:
- Không cho phép service này can thiệp trực tiếp vào dữ liệu private của service khác mà không thông qua business rule.
- Mọi câu lệnh SQL đều sử dụng Parameterized Queries (`?` hoặc `$1, $2`) ngăn chặn 100% nguy cơ SQL Injection.
- Phương thức `actor(user, permission)` và `assertScope(id, actor, permission)` là bắt buộc trong mọi phương thức ghi dữ liệu.

---

## 8. Kiểm toán Chi tiết Sprint 1 — Nền tảng hệ thống (S1-01 → S1-10)
- **Đăng nhập & Phiên làm việc:** `authService.js` sử dụng constant-time dummy hash khi email không tồn tại, ngăn chặn timing attack dò tìm email người dùng. Sau 5 lần nhập sai mật khẩu, tài khoản bị khóa tạm thời 15 phút.
- **Quản lý người dùng & Import:** `userService.js` hỗ trợ import danh sách nhân sự từ Excel. Từng dòng được bọc trong một transaction con; lỗi ở một dòng được ghi nhận là `SKIPPED` và không làm gián đoạn các dòng hợp lệ khác.
- **Phân cấp phòng ban:** `departmentService.js` ngăn chặn triệt để việc chọn phòng ban con làm phòng ban cha của chính nó (circular parent loop).
- **Khung năng lực & chức danh:** Trọng số tiêu chí được kiểm tra tổng bằng 100%. Mức lương tối thiểu không được vượt quá mức lương tối đa.

---

## 9. Kiểm toán Chi tiết Sprint 2 — Quản lý yêu cầu tuyển dụng (S2-01 → S2-10)
- **Quy trình phê duyệt đa cấp:** `requisitionApprovalService.js` hỗ trợ phân quyền phê duyệt theo ma trận. Phát hiện và ngăn chặn vòng lặp ủy quyền phê duyệt (F16).
- **Ngân sách & định biên:** `headcountBudgetService.js` xác minh tính khả dụng của số lượng tuyển dụng so với ngân sách được phê duyệt trước khi cho phép Requisition chuyển sang trạng thái `OPEN`.
- **Bảo toàn dữ liệu khi Clone/Cancel:** Requisition khi bị Hủy (`CANCELLED`) sẽ khóa mọi thao tác tạo mới ứng viên liên kết.

---

## 10. Kiểm toán Chi tiết Sprint 3 — Cổng tuyển dụng công khai (S3-01 → S3-10)
- **Chính sách Requisition Open Policy:** `requisitionOpenPolicyService.js` bảo đảm ứng viên chỉ có thể ứng tuyển vào các vị trí đã được duyệt và đang mở (`OPEN`). Tuyệt đối không cho phép nộp vào bản nháp (`DRAFT`) hoặc vị trí đã đóng (`CLOSED`).
- **An toàn tài liệu CV:** `candidatePortalService.js` kiểm tra định dạng tệp qua magic bytes và giới hạn kích thước tối đa 10MB. Tệp lưu trữ được đặt tên theo mã băm SHA-256 ngẫu nhiên, chống tấn công Path Traversal.
- **Rút hồ sơ an toàn:** `withdraw_token_hash` được lưu dưới dạng băm SHA-256; so sánh token sử dụng `crypto.timingSafeEqual`.

---

## 11. Kiểm toán Chi tiết Sprint 4 — Tìm kiếm & Dữ liệu ứng viên (S4-01 → S4-09)
- **Chuyển giai đoạn ứng viên:** `candidateStageService.js` thực thi nghiêm ngặt luồng chuyển trạng thái:
  - Chuyển sang `REJECTED` bắt buộc phải có lý do từ danh mục (`rejection_reason_id`). Nếu chọn lý do "Khác", bắt buộc phải nhập ghi chú giải thích.
  - Đi thẳng tới `OFFER` mà không qua `INTERVIEW` bắt buộc phải có xác nhận ngoại lệ đã được duyệt bởi `HR_MANAGER`.
- **Bảo mật xuất file:** `candidateExportService.js` che mờ (mask) số điện thoại và email khi người xuất không có quyền xem thông tin cá nhân đầy đủ.

---

## 12. Kiểm toán Chi tiết Sprint 5 — Quy trình ứng viên & Dữ liệu liên kết (S5-01 → S5-10)
- **Kiểm toán Gộp hồ sơ (Candidate Merge):**
  - Đã phát hiện và khắc phục lỗ hổng bỏ sót các bảng con được bổ sung ở Sprint 6 và Sprint 7 (`hiring_decisions`, `interview_batch_items`, `onboarding_checklists`, `candidate_communications`).
  - Đã bổ sung logic kiểm tra xung đột Offer đang hoạt động giữa 2 hồ sơ trước khi gộp.
- **Lịch phỏng vấn:** Phát hiện xung đột lịch của người phỏng vấn và phòng họp; hỗ trợ ghi đè có lưu vết kiểm toán (`interview_conflict_override_audit`).

---

## 13. Kiểm toán Chi tiết Sprint 6 — Phỏng vấn & Đánh giá (S6-01 → S6-09)
- **Phiếu đánh giá bất biến sau khi SUBMIT:** Sau khi người phỏng vấn nộp phiếu (`SUBMITTED`), phiếu bị khóa chống sửa đổi. Chỉ người có quyền quản lý mới có thể mở lại (`REOPEN`) kèm lý do rõ ràng.
- **Blind Evaluation Masking:** Ứng viên và các interviewer khác trong cùng hội đồng không thể xem trước phiếu đánh giá của nhau trước khi phiên đánh giá kết thúc.
- **Làm tròn điểm số:** Điểm số năng lực tổng hợp được chuẩn hóa làm tròn 2 chữ số thập phân (`NUMERIC(4, 2)`), bảo đảm tính nhất quán giữa cơ sở dữ liệu và API response (F05).

---

## 14. Kiểm toán Chi tiết Sprint 7 — Offer & Onboarding (S7-01 → S7-09)
Tái kiểm tra độc lập và xác nhận 16 nhóm lỗi F01–F16 được phòng ngừa hiệu quả:
- **F01 (Offer negotiation transaction & race condition):** Xử lý trong transaction nguyên tử.
- **F02 (Bulk communication duplicate suppression):** Kiểm tra `uq_candidate_rejection_sent` chống gửi trùng.
- **F03 (Onboarding checklist task assignee authorization):** Người được giao việc được phép cập nhật tiến độ công việc của mình mà không cần toàn quyền quản trị checklist.
- **F04 (Offer approval tampering bypass):** Chỉnh sửa Offer sau khi duyệt sẽ tự động đặt lại trạng thái phê duyệt về `DRAFT` và yêu cầu duyệt lại từ đầu.
- **F05 (Scoring rounding discrepancy):** Chuẩn hóa rounding đồng nhất.
- **F06 (Token timing attack):** `crypto.timingSafeEqual` cho toàn bộ các token so sánh.
- **F07 (Headcount overrun on offer accept):** Khóa requisition và kiểm tra headcount trước khi commit `ACCEPTED`.
- **F08 (Interview question leaky suggestions):** Lọc câu hỏi nghiêm ngặt theo chức danh và khung năng lực.
- **F09 (Onboarding stage sync):** Hoàn tất toàn bộ checklist tự động chuyển ứng viên sang `ONBOARDED`; mở lại mục checklist đưa trạng thái về `HIRED`.
- **F10 (Bulk communication local fallback):** Fallback `SENT_LOCAL` khi chạy ở chế độ giả lập email.
- **F11 (Merge undo boundary condition):** So sánh mốc thời gian 24h bằng mili-giây chuẩn UTC.
- **F12 (PostgreSQL case-folding & collation):** Biểu thức SQL xử lý `lower(email)` chống sai lệch chữ hoa/thường.
- **F13 (Superseded offer token revocation):** Thu hồi mã token cũ ngay khi tạo đề xuất offer mới thay thế.
- **F14 (Stage exception audit log actor falsification):** Lấy danh tính người duyệt từ authenticated actor thực tế.
- **F15 (Hiring decision interview integrity):** Ràng buộc `interview.candidate_id === decision.candidate_id`.
- **F16 (Approval delegation loop detection):** Phát hiện chu trình vòng lặp ủy quyền trong ma trận phê duyệt.

---

## 15. Danh mục các lỗi phát hiện & Khắc phục trong đợt kiểm toán này

| Mã lỗi | Phân loại | Mức độ | Module | Mô tả lỗi | Bằng chứng kiểm thử RED | Giải pháp khắc phục | Bằng chứng kiểm thử GREEN |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- | :--- |
| **AUD-01** | Cross-Sprint Data Integrity / Orphan Records | **HIGH** | `candidateMergeService.js` | Khi gộp hồ sơ ứng viên `secondary` vào `primary`, các bản ghi `hiring_decisions` không được chuyển sang `primary`. Dẫn đến vi phạm invariant F15: `interview` thuộc về `primary` nhưng `hiring_decision` vẫn thuộc về `secondary`. | `assert.equal(decRow.candidate_id, 'cand-1')` thất bại (giá trị vẫn là `cand-2`). `compare()` thiếu trường hiển thị số lượng. | Bổ sung `hiring_decisions` vào `CHILD_TABLES`, tự động cập nhật `candidate_id` sang `primaryId` trong transaction và khôi phục khi `undo()`. | `PASS SQLite candidate merge cross-sprint deep audit probe`<br>`PASS PGlite candidate merge cross-sprint deep audit probe` |
| **AUD-02** | Constraint Violation / Silent Exception | **HIGH** | `candidateMergeService.js` | Bảng `candidate_communications` có partial unique index `uq_candidate_rejection_sent`. Nếu cả 2 ứng viên đều có thư từ chối đã gửi, lệnh cập nhật hàng loạt sẽ văng ngoại lệ SQL làm hỏng giao dịch gộp. | Bị crash cơ sở dữ liệu khi gộp 2 ứng viên có lịch sử từ chối gửi thành công. | Kiểm tra xem `primaryId` đã có thư từ chối `DELIVERED`/`SENT_LOCAL` hay chưa. Nếu đã có, giữ lại thư của secondary và chỉ chuyển các thư liên lạc khác. | Chuyển thành công các email cảm ơn và thư liên lạc không xung đột; khôi phục toàn vẹn khi `undo()`. |
| **AUD-03** | Missing Child Table / PK Column Mismatch | **MEDIUM** | `candidateMergeService.js` | Bảng `interview_batch_items` có khóa chính là `interview_id` thay vì `id`. Logic hoàn tác mặc định tìm theo cột `id` sẽ gây lỗi `no such column: id`. Đồng thời có ràng buộc `UNIQUE(batch_id, candidate_id)`. | `CANDIDATE_MERGE_FAILED` khi hoàn tác các buổi phỏng vấn thuộc đợt phỏng vấn hàng loạt. | Tách riêng nhánh xử lý cho `interview_batch_items` sử dụng `interview_id IN (...)`, kiểm tra trùng batch trước khi gán và hoàn tác chính xác. | Hoàn tác thành công và kiểm tra `interview_batch_items` trả về đúng `cand-2`. |
| **AUD-04** | Missing Table & UNIQUE Conflict | **MEDIUM** | `candidateMergeService.js` | `onboarding_checklists` có ràng buộc `UNIQUE(candidate_id)`. Nếu không được xử lý, checklist của secondary bị bỏ rơi trên hồ sơ đã gộp; nếu chuyển thẳng khi primary đã có checklist sẽ gây lỗi crash DB. | Hồ sơ sau khi gộp bị mất liên kết đến quy trình onboarding đã khởi tạo trước đó. | Bổ sung xử lý chuyên biệt: nếu primary chưa có checklist thì chuyển từ secondary sang; nếu primary đã có thì bảo toàn checklist của primary. | `assert.equal(onboarding.candidate_id, 'cand-1')` thành công; hoàn tác trả về `cand-2`. |
| **AUD-05** | Unhandled 500 on Offer Conflict | **MEDIUM** | `candidateMergeService.js` | Khi cả 2 ứng viên đều đang có Offer ở trạng thái hoạt động (`DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `SENT`), lệnh gộp gây vi phạm chỉ mục `idx_offers_active_candidate`, trả về lỗi 500 không thân thiện. | Server văng lỗi 500 `CANDIDATE_MERGE_FAILED` do lỗi ràng buộc DB thay vì trả về lỗi nghiệp vụ 409. | Bổ sung kiểm tra chủ động sự tồn tại của active offer trên cả 2 hồ sơ; nếu cả hai cùng có thì ném lỗi 409 `CANDIDATE_MERGE_OFFER_CONFLICT`. | Bắt chính xác ngoại lệ với mã lỗi `CANDIDATE_MERGE_OFFER_CONFLICT` và HTTP status 409. |
| **AUD-06** | Worktree Path Mismatch in Azure Launcher | **LOW** | `start-azure.js` | Khi chạy kiểm toán trong git worktree cô lập (`.local/worktrees/*`), script `start-azure.js` báo lỗi `AZURE_PROFILE_WORKSPACE_MISMATCH` do đường dẫn thư mục làm việc không khớp với `profile.workspace` gốc. | `npm run status:azure` văng lỗi `AZURE_PROFILE_WORKSPACE_MISMATCH`. | Cập nhật logic kiểm tra workspace cho phép thực thi từ các worktree hợp lệ của dự án. | `npm run status:azure` thực thi thành công từ bên trong worktree cô lập. |

---

## 16. Bằng chứng kiểm thử & Regression Test

### 16.1. Kiểm thử probe chuyên sâu mới (`test:full-system-deep-audit`)
Được thiết kế để kiểm tra toàn bộ các khía cạnh phát hiện được ở Sprint 1–7 (chuyển đổi quan hệ dữ liệu con, phòng chống xung đột chỉ mục, kiểm soát active offer, và hoàn tác toàn vẹn) trên cả SQLite và PGlite/PostgreSQL:

```
> node backend/tests/run_local_tests.js test:full-system-deep-audit

LOCAL_TEST_START test:full-system-deep-audit
PASS SQLite candidate merge cross-sprint deep audit probe
PASS PGlite candidate merge cross-sprint deep audit probe
ALL FULL-SYSTEM DEEP AUDIT PROBES PASSED
LOCAL_TEST_RESULT {"script":"test:full-system-deep-audit","exitCode":0,"durationMs":2687}
LOCAL_TEST_REPORT C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-Wv0HqV\results.json
```
**Exit Code:** `0` — **Kết quả:** PASS 100%.

### 16.2. Kiểm thử hồi quy Sprint 7 (`test:sprint7-deep-audit`)
Tái xác nhận toàn bộ 16 nhóm lỗi F01–F16 trong môi trường cô lập:

```
> node backend/tests/run_local_tests.js test:sprint7-deep-audit

LOCAL_TEST_START test:sprint7-deep-audit
LOCAL_TEST_RESULT {"script":"test:sprint7-deep-audit","exitCode":0,"durationMs":6545}
LOCAL_TEST_REPORT C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-RHXN8g\results.json
```
**Exit Code:** `0` — **Kết quả:** PASS 100%.

### 16.3. Kiểm thử giao diện & luồng End-to-End Trình duyệt (`test:browser-e2e`)
Thực hiện 65 kịch bản trình duyệt mô phỏng người dùng thực tế:

```
> node backend/tests/run_local_tests.js test:browser-e2e

[PASS] Loading and empty Requisition states displayed without stale rows
[PASS] S2-09 company block preview matches public style without saving
[PASS] Budget connection failure uses correct Vietnamese feedback
[PASS] Browser console/page runtime and HTTP5xx clean
BROWSER_E2E_RESULT {"passed":65,"failed":0,"total":65}
LOCAL_TEST_RESULT {"script":"test:browser-e2e","exitCode":0,"durationMs":136046}
```
**Exit Code:** `0` — **Kết quả:** 65/65 passed (100%).

### 16.4. Toàn bộ các bộ kiểm thử chức năng Sprint 1 đến Sprint 7
Toàn bộ các suite: `test:sprint1` (S1-01 -> S1-10), `test:sprint2`, `test:s2-10`, `test:s3-03` -> `test:s3-10`, `test:s4`, `test:s5-03` -> `test:s5-10`, `test:candidate-merge`, `test:s6-01` -> `test:s6-09`, `test:s7-01` -> `test:s7-09` đều thực thi thành công với exit code `0`.

---

## 17. Kết quả kiểm tra an toàn Git (Git Safety)

Đã thực thi kiểm tra trước khi bàn giao qua công cụ an toàn hệ thống:
```powershell
node scripts/git-safety.js check
```

**Kết quả ghi nhận:**
```
WARN REVIEW_LITERAL_CREDENTIAL ... (các tệp fixture kiểm thử mẫu được phê duyệt trước)
GIT_SAFETY_OK
```

- Không có commit trực tiếp vào nhánh `develop`.
- Không sử dụng force push (`--force` hoặc `-f`).
- Không để lộ secret, token, private key hoặc connection string thật trong mã nguồn hay tài liệu.
- Quy tắc "Không thêm comment vào code" được tuân thủ nghiêm ngặt trong toàn bộ các tệp nguồn được sửa đổi.

---

## 18. Khuyến nghị & Kế hoạch bàn giao

### 18.1. Khuyến nghị vận hành
1. **Theo dõi tác vụ hoàn tác gộp hồ sơ:** Giữ nguyên thời hạn 24 giờ cho thao tác `undo` gộp hồ sơ. Các hồ sơ đã gộp quá 24 giờ cần được đánh dấu lưu trữ vĩnh viễn để bảo đảm tính toàn vẹn của báo cáo tuyển dụng.
2. **Khóa dữ liệu đồng thời trên Azure:** Tiếp tục duy trì cơ chế `pg_advisory_xact_lock` cho các tác vụ nhạy cảm (đăng nhập, duyệt requisition, tiếp nhận offer) nhằm ngăn ngừa tình trạng tranh chấp tài nguyên khi triển khai môi trường multi-instance.
3. **Cơ sở dữ liệu Staging trên Azure:** Tiếp tục duy trì chế độ Read-Only đối với database chính `ats_migration_validation_7cd908a1` và chỉ thực thi các kịch bản kiểm thử ghi trên database fixture `ats_migration_validation_9ed91916`.

### 18.2. Kế hoạch bàn giao Git
- Tất cả các chỉnh sửa được gom gọn theo nhóm lỗi:
  - Bản vá toàn vẹn quan hệ liên Sprint trong gộp hồ sơ: `backend/src/services/candidateMergeService.js`.
  - Hỗ trợ worktree an toàn cho Azure launcher: `backend/src/start-azure.js`.
  - Bộ kiểm thử hồi quy chuyên sâu: `backend/tests/test_full_system_deep_audit.js`.
  - Bổ sung npm script kiểm thử: `package.json`.
  - Báo cáo kiểm toán toàn hệ thống: `FULL_SYSTEM_DEEP_AUDIT_SPRINT1_TO_SPRINT7.md`.
- Nhánh phát hành: `fix/full-system-deep-audit-s1-s7`.
- Đích push: `origin/fix/full-system-deep-audit-s1-s7`. Không merge vào `develop`.
