# Báo cáo Khảo sát & Kế hoạch triển khai Sprint 4: Cổng ứng tuyển & Hồ sơ ứng viên

## 1. Kết quả khảo sát kiến trúc hiện tại

### 1.1. Công nghệ & Hạ tầng
- **Backend**: Node.js CommonJS thuần, máy chủ HTTP native `node:http` (không dùng Express), xử lý routing thủ công tại `backend/src/server.js`, `parseBody(req)` xử lý stream JSON và nhị phân.
- **Frontend**: Vanilla HTML5, CSS3, JavaScript ES6+, Single Page Application (SPA) điều hướng qua `frontend/routes.json` và `frontend/js/router.js`, quản lý vòng đời view qua `route-lifecycle.js`, gọi API qua `window.ATS_API` trong `frontend/js/api.js`.
- **Database**: Hỗ trợ đồng thời 2 provider:
  - SQLite (sử dụng `node:sqlite` DatabaseSync) tại `.local/ats-demo.db` cho môi trường local demo / test.
  - PostgreSQL qua thư viện `pg` (và `@electric-sql/pglite` trong test).
- **Authentication & RBAC**: Cơ chế Session token (Bearer token), scrypt password hashing, Default-Deny RBAC Middleware (`backend/src/middlewares/rbacMiddleware.js`).
- **Email**: `backend/src/services/emailService.js` hỗ trợ chế độ `simulated` (ghi vào `email_logs`) và `smtp` thực tế (Nodemailer qua mật khẩu hoặc OAuth2).
- **Baseline Test**: Đã kiểm tra hồi quy các suite Sprint 1–3 (`test:candidate-stage`, `test:s3-10`, `test:s3-01`), 100% PASS.

---

## 2. Bảng đối chiếu 9 User Story (Sprint 4)

| Mã Story | Tên chức năng | Điểm | Thành phần đã có | Thành phần còn thiếu | Phương án triển khai |
|---|---|---|---|---|---|
| **S4-01** | Danh sách việc làm công khai | 5.0 | Route `/careers/jobs`, view `public-jobs.html`, API `GET /api/v1/public/job-postings` | Tìm kiếm từ khóa, lọc đa điều kiện (phòng ban, địa điểm, hình thức), nút ứng tuyển trên card, responsive UI | Mở rộng query parameter cho `jobPostingService.publicList()`; bổ sung search/filter bar và card UX trên frontend. |
| **S4-02** | Chi tiết tin tuyển dụng | 5.0 | Route `/careers/jobs?id=...`, renderer `job-posting-public-renderer.js` | Hiển thị quyền lợi, nút "Ứng tuyển ngay" nổi bật mở modal nộp CV, chặn backend nếu tin đã hết hạn/gỡ | Thêm modal nộp CV trên mobile/desktop; kiểm tra hạn nộp `application_deadline >= today` và status `PUBLISHED` ở backend. |
| **S4-03** | Nộp hồ sơ ứng tuyển kèm CV | 8.0 | Bảng `candidates` cơ bản, API upload binary | Biểu mẫu ứng tuyển, xác thực CV (PDF/DOCX max 10MB, mime, magic byte), chống spam (IP rate-limit, honeypot), mã tra cứu độc nhất, token rút hồ sơ, email xác nhận | Tạo endpoint `POST /api/v1/public/applications`; lưu CV an toàn vào `uploads/cv/`; sinh mã tra cứu `TRK-...` & token hash rút hồ sơ; gửi email xác nhận. |
| **S4-04** | Bóc tách thông tin từ CV PDF | 5.0 | Đã cài `pdf-parse` | Module đọc stream text PDF, regex trích xuất họ tên, email, SĐT, UI cho recruiter xác nhận/chỉnh sửa | Xây dựng `cvParsingService.js`, API bóc tách theo yêu cầu của recruiter, không tự động ghi đè. |
| **S4-05** | Tra cứu trạng thái hồ sơ | 5.0 | Chưa có | Giao diện tra cứu công khai bằng mã + email, module ánh xạ 4 trạng thái tổng quát, chống dò mã | Endpoint `POST /api/v1/public/applications/status`; ánh xạ sang `Đã nhận / Đang xem xét / Mời phỏng vấn / Kết thúc`; không lộ nhận xét nội bộ. |
| **S4-06** | Ứng viên rút hồ sơ | 2.0 | Chưa có | Endpoint & trang xác nhận rút hồ sơ qua token hash bí mật, cập nhật trạng thái `WITHDRAWN`, báo recruiter | Endpoint `POST /api/v1/public/applications/withdraw`; kiểm tra token hash; chuyển stage thành `WITHDRAWN`; gửi thông báo cho recruiter phụ trách. |
| **S4-07** | Giới thiệu ứng viên nội bộ | 5.0 | Hệ thống auth nhân viên, catalog `CANDIDATE_SOURCE` | Giao diện giới thiệu, tự động gắn `Giới thiệu nội bộ`, lưu `referrer_id` & `referrer_name` từ session, xem trạng thái tổng quát | Màn hình `pages/referrals.html`; API `POST /api/v1/candidates/refer`; phân quyền `candidate.refer` cho nhân sự nội bộ. |
| **S4-08** | Gỡ tin & tự động ẩn tin hết hạn | 2.0 | Chức năng `UNPUBLISH` thủ công ở S3-10 | Tác vụ định kỳ hằng ngày quét tin hết hạn, tự động cập nhật status mà không xóa lịch sử ứng tuyển | Endpoint & cron job tự động quét `application_deadline < today`; kiểm tra `job_posting.publish` khi gỡ tin thủ công; ghi log sự kiện. |
| **S4-09** | Hồ sơ ứng viên hợp nhất | 8.0 | View `candidates.html`, API get candidate đơn lẻ | Hợp nhất đa hồ sơ theo email chuẩn hóa, xem CV trực tiếp, lịch sử ứng tuyển đa vị trí, nhãn & ghi chú, phân quyền IDOR | View `candidate-detail.html` nâng cao; API `GET /api/v1/candidates/unified/:id`; kiểm soát quyền chặt chẽ theo recruiter assignment và hiring manager. |

---

## 3. Kế hoạch Database Migration 009

### Bảng & Cột mới:
1. **`candidate_documents`**: Lưu trữ metadata CV (`id`, `candidate_id`, `file_name`, `storage_path`, `mime_type`, `file_size`, `file_hash`, `parsed_text`, `parsed_data_json`, `created_at`).
2. **`candidate_status_history`**: Audit trail thay đổi trạng thái (`candidate_id`, `before_stage`, `after_stage`, `actor_id`, `actor_name`, `action`, `reason`, `notes`, `created_at`).
3. **`candidate_tags`**: Nhãn ứng viên (`candidate_id`, `tag_name`, `created_by`, `created_at`).
4. **`candidate_notes`**: Ghi chú nội bộ (`candidate_id`, `author_id`, `author_name`, `note_text`, `is_private`, `created_at`).
5. **`application_rate_limits`**: Theo dõi tần suất nộp hồ sơ theo IP address (`ip_address`, `action`, `attempt_time`).
6. **`email_outbox`**: Đảm bảo gửi email tin cậy, retry khi lỗi mạng (`recipient`, `subject`, `body_html`, `status`, `retry_count`, `error_message`, `sent_at`).
7. **Mở rộng bảng `candidates`**:
   - `job_posting_id`: Khóa ngoại trỏ đến tin tuyển dụng đã xuất bản.
   - `cover_letter`: Thư giới thiệu của ứng viên.
   - `tracking_code`: Mã tra cứu công khai độc nhất (VD: `TRK-2026-AB12CD`).
   - `withdraw_token_hash`: Hash SHA-256 của token bí mật dùng để rút hồ sơ qua liên kết email.
   - `withdrawn_at`, `withdrawn_reason`: Thời điểm và lý do rút hồ sơ.
   - `referrer_id`, `referrer_name`, `referral_notes`, `is_internal_referral`: Thông tin người giới thiệu nội bộ.
