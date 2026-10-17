# S5-06 — Kho ứng viên tiềm năng

Baseline: `origin/develop` tại `6b30a959d05f46221b0bf9ae3dfd02284de57edc`, gồm PR #18 và PR #20 (S5-03). Nhánh này không chứa hoặc yêu cầu mã S5-05 chưa tích hợp.

## Chính sách được chốt ngày 16/10/2026

- Chỉ HR_MANAGER/ADMIN hợp lệ được đọc kho và xem gợi ý, với quyền `candidate.read` hiện hành. Đưa vào kho yêu cầu `candidate.update` và role HR_MANAGER/ADMIN. ADMIN giữ đặc quyền RBAC hiện hữu, vẫn phải là tài khoản thật, ACTIVE.
- Candidate phải có `stage=REJECTED`. Vì baseline không có final-round marker, HR phải xác nhận thủ công đã trượt vòng cuối (`finalRoundConfirmed: true`) và nhập lý do. Lưu người xác nhận từ DB, thời điểm, lý do, chức danh quan tâm và ID application gốc.
- Không tự đưa tất cả REJECTED vào kho, không đổi stage/history/application, không hợp nhất hồ sơ chỉ vì cùng email. API không cung cấp sửa/xóa confirmation hoặc ghi đè lý do khi request lặp.
- Recruiter/Hiring Manager không được đọc kho/gợi ý, kể cả có `candidate.read` hoặc tự khai báo role ADMIN. Quyền quản lý ứng viên hiện có không đổi.

## Tìm kiếm và gợi ý

- Tìm theo chức danh quan tâm, kỹ năng từ nhãn candidate hoặc `parsed_text` của CV đã bóc tách. Không đọc file CV hay lộ nội dung CV trong response; không đoán kỹ năng từ note riêng tư.
- Tìm kiếm chuẩn hóa Unicode NFC và không phân biệt hoa/thường tiếng Việt trên cả hai provider, không sửa nội dung nguồn.
- Chức danh quan tâm có thể do HR ghi rõ, mặc định theo vị trí ứng tuyển gốc.
- Khi danh sách vị trí có vị trí mới OPEN/IN_PROGRESS, UI HR tự yêu cầu gợi ý; cũng có dropdown đổi vị trí đang mở. Gợi ý chỉ dùng hồ sơ đã được đánh dấu vào kho.
- Khớp cùng `job_title_id` của vị trí nguồn hoặc cùng chức danh quan tâm với title vị trí mới; cộng số kỹ năng bắt buộc khớp từ tiêu chí S5-09 nếu tồn tại. Nếu chưa có bảng/tiêu chí screening, chỉ gợi ý theo chức danh. Tối đa 10 kết quả, có `titleMatch` và `matchedSkills` để HR xem xét; không tự thêm application hoặc quyết định tuyển dụng, không gọi AI/dịch vụ ngoài.
- Kỹ năng dạng keyword trong parsed CV có thể trùng một phần từ; đây là gợi ý cần HR đánh giá, không phải kết luận năng lực. Hồ sơ chưa có CV parsed/tags sẽ không khớp kỹ năng chưa được ghi nhận.

## API bổ sung

Cả ba endpoint có alias không tiền tố `/api/v1`; đều yêu cầu Bearer session và service-boundary authorization lại từ DB.

| Method | Endpoint | Payload/query |
|---|---|---|
| GET | `/api/v1/talent-pool` | `title`, `skill`, `page`, `pageSize`; mặc định 25, tối đa 100 |
| POST | `/api/v1/talent-pool` | `{candidateId, reason, finalRoundConfirmed, interestedTitle?}` |
| GET | `/api/v1/talent-pool/suggestions` | `requisitionId` phải tồn tại và OPEN/IN_PROGRESS |
| GET | `/api/v1/talent-pool/availability` | HR/ADMIN kiểm tra schema/checksum, không tự chạy DDL |

Actor/grant sai 403, thiếu session 401, payload sai 400, hồ sơ không tồn tại 404, stage/position không hợp lệ 409, schema/kết nối chưa sẵn sàng 503. POST đầu tiên 201; request lặp 200 và `alreadyInPool=true`, giữ thông tin xác nhận ban đầu.

UI chỉ bật panel kho/gợi ý sau khi availability xác nhận migration đã sẵn sàng. Vì vậy các môi trường Sprint cũ chưa áp dụng schema mới tiếp tục hoạt động mà không tự migrate hoặc phát sinh request ghi kho. Kết nối database không đổi; không fallback sang database khác.

## Schema và transaction

Migration `013_talent_pool.sql` độc lập với S5-05 (012), chỉ cần schema ứng viên/S4 và users hiện hữu. Tạo bảng `candidate_talent_pool` với candidate UNIQUE, FK candidate/actor, confirmation CHECK và index ngày tạo. Runner riêng `migrate-talent-pool.js` dùng transaction/advisory lock và ledger checksum `ats_talent_pool_migrations`; không sửa migration lịch sử, permission catalog, 72 grants hay ledger rebuild/RBAC PENDING.

Mutation kiểm actor/grant và khóa candidate trong transaction ngắn; PostgreSQL `FOR UPDATE`, SQLite `BEGIN IMMEDIATE` qua abstraction hiện hành. Unique candidate + `ON CONFLICT DO NOTHING` bảo vệ request lặp. Lỗi sau INSERT rollback cả mutation.

Sau khi có phê duyệt triển khai và database đích đã được xác minh/sao lưu, runner là `npm run migrate:s5-06`. Không tự chạy khi startup. **Trong nhiệm vụ này chỉ chạy trên fixture cô lập; không chạy runner với database Azure đang dùng.** Rollback code không xóa pool hoặc lịch sử; schema removal cần phê duyệt riêng.

## Kiểm thử

`npm run test -- test:s5-06` chạy source/dependency export cô lập, fixture giả SQLite/PGlite. Bao phủ manual confirmation, stage/reason, toàn bộ role, actor/grant giả/thu hồi, không sửa lịch sử, request lặp, rollback, tìm kiếm/gợi ý, migration checksum và Chromium desktop/mobile.

`npm run test -- --all` chạy toàn bộ hồi quy trên các export riêng. PostgreSQL thật/concurrency nhiều connection phải được kiểm riêng; không suy diễn từ PGlite. Không sử dụng Azure/Neon hoặc CV/dữ liệu nghiệp vụ thật để test.
