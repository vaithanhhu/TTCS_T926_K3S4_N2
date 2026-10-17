# S5-05 — Tìm kiếm ứng viên và bộ lọc cá nhân

Baseline: `origin/develop` tại `6b30a959d05f46221b0bf9ae3dfd02284de57edc`, gồm PR #18 và PR #20 (S5-03). Nhánh này độc lập với S5-06.

## Chính sách

- Tìm tên, email, điện thoại, thư giới thiệu; giữ khả năng tìm công ty đã có.
- Tìm kiếm không phân biệt hoa/thường tiếng Việt và chuẩn hóa Unicode NFC. SQLite dùng hàm deterministic đăng ký trên connection, PostgreSQL dùng `NORMALIZE`/`LOWER`; không thay dữ liệu lưu trữ.
- Kết hợp vị trí theo ID, giai đoạn, nguồn, nhãn, ngày nộp và khoảng điểm.
- Nút “Ứng viên” từ danh sách vị trí truyền Requisition ID vào bộ lọc, không đưa tiêu đề vị trí vào ô tìm tên ứng viên.
- Theo quyết định người dùng ngày 16/10/2026, điểm là trung bình `interviews.score` của phỏng vấn `COMPLETED`, bỏ qua NULL. Giữ thang điểm phỏng vấn hiện hành; không dùng sao mặc định, điểm fit S5-09 hoặc suy diễn thành đánh giá nhanh 1–5 sao S5-04.
- Phép tính chỉ dùng vòng phỏng vấn actor có quyền đọc theo `interview.read` hoặc `interview.evaluation.read` và scope hiện hành của API phỏng vấn. Interviewer chỉ tổng hợp vòng được phân công; quyền Candidate không mở điểm, và APPROVER chỉ có broad score read khi thật sự có grant đọc đánh giá. Không có grant thì không trả điểm; bộ lọc điểm không khớp dữ liệu bị ẩn. Không bổ sung grant để bật tính năng.
- Ngày từ/đến tính trọn ngày UTC, bao gồm hai đầu khoảng. Không có điểm thì không khớp bộ lọc điểm.
- `candidate.read` và actor ACTIVE/grants hiện hành vẫn bắt buộc. Tái sử dụng read scope primary/support, Hiring Manager, Interviewer, Candidate và broad read đã duyệt của APPROVER/HR/ADMIN.
- Với đa role, hồ sơ chỉ thuộc Candidate ownership vẫn dùng public DTO P4. Bộ lọc nội bộ nguồn/nhãn/điểm chỉ khớp internal scope; không dùng chúng để dò metadata của public DTO.
- Lưu tối đa 50 bộ lọc/tài khoản. Chỉ lưu tiêu chí, không lưu danh sách candidate hoặc quyền truy cập. Luôn kiểm quyền và scope lại khi sử dụng. Không chia sẻ bộ lọc với tài khoản khác.
- Xuất CSV giữ toàn bộ kết quả đã lọc, không chỉ trang hiện tại. Mỗi trang xuất vẫn kiểm quyền/scope; nếu tổng số thay đổi hoặc có lỗi thì không xuất file dở dang.

## API bổ sung

Các endpoint hỗ trợ cả tiền tố `/api/v1` và alias không tiền tố; yêu cầu Bearer session.

| Method | Endpoint | Nội dung |
|---|---|---|
| GET | `/api/v1/candidate-search` | `search`, `stage`, `requisitionId`, `sourceId`, `tag`, `submittedFrom`, `submittedTo`, `ratingMin`, `ratingMax`, `page`, `pageSize` |
| GET | `/api/v1/candidate-search-availability` | Kiểm tra schema/checksum đã sẵn sàng, không chạy DDL |
| GET | `/api/v1/candidate-search-options` | Chỉ trả vị trí, nguồn, nhãn của candidate trong internal read scope |
| GET | `/api/v1/candidate-filters` | Danh sách bộ lọc của actor |
| POST | `/api/v1/candidate-filters` | `{name, filters}` |
| DELETE | `/api/v1/candidate-filters/:id` | Xóa theo cả ID và owner; không tồn tại/không thuộc actor là no-op |

Search trả `{success,total,page,pageSize,candidates}`; mặc định 50/trang, tối đa 100. Chỉ luồng tìm kiếm nâng cao bổ sung `interviewAverage` cho internal DTO. API list không bật advanced và detail cũ giữ contract. Chuỗi SQL được parameterize; `%`, `_` trong từ khóa là ký tự thường. Lỗi tham số 400, thiếu session 401, actor/grant không hợp lệ 403, schema/kết nối chưa sẵn sàng 503 không kèm SQL.

Frontend tái sử dụng `/api/v1/candidates?advanced=1` để giữ đúng một request danh sách khi tìm kiếm/điều hướng. Server kiểm tra schema trong cùng request, chuyển tới search service khi đã sẵn sàng và trả `features.candidateSearch`. Khi chưa có migration, chỉ danh sách/tìm kiếm cơ bản cũ hoạt động; UI ẩn điều khiển mới và báo cần migration. Nếu request vẫn có tiêu chí nâng cao khi schema chưa sẵn sàng thì trả 503, không âm thầm bỏ tiêu chí. Không có thay đổi database provider/fallback kết nối.

## Schema và triển khai

Schema S4 `009` phải hiện hữu. Migration mới `012_candidate_search.sql` chỉ tạo bảng bộ lọc và index owner. Runner riêng `migrate-candidate-search.js` dùng transaction, advisory transaction lock PostgreSQL và ledger `ats_candidate_search_migrations` có checksum. Chạy lại không ghi đè; checksum khác thì dừng. Không sửa migration 001–011, không chạy RBAC synchronization, không đổi grants hoặc ledger rebuild.

Migration cũng thêm index phục vụ ngày nộp và điểm phỏng vấn. Search chạy trong transaction ngắn; PostgreSQL dùng snapshot REPEATABLE READ để tổng số, trang kết quả và projection dùng cùng một snapshot quyền/dữ liệu; SQLite dùng abstraction transaction hiện hành. Không đọc file hoặc giữ lock trong thao tác parser.

Sau phê duyệt triển khai, trên database đích đã xác minh/sao lưu: chạy `npm run migrate:s5-05` bằng cấu hình được phê duyệt rồi khởi động ATS. Startup/service không tự chạy migration này. **Trong nhiệm vụ phát triển, chỉ áp dụng trên fixture SQLite/PGlite cô lập; không chạy lệnh này với cấu hình Azure đang sử dụng.**

Rollback code không xóa bảng hoặc bộ lọc; muốn loại bỏ schema phải có phương án/phê duyệt riêng.

## Kiểm thử

`npm run test -- test:s5-05` tạo source/dependency export cô lập trước khi chạy test. Test mới kiểm tra từng điều kiện, kết hợp, validation, phân trang, scope, grant/assignment revocation, public projection, ownership bộ lọc, migration checksum và Chromium desktop/mobile. `npm run test -- --all` chạy hồi quy hiện hữu và test mới trong các export riêng.

Không coi PGlite là chứng cứ concurrency nhiều connection PostgreSQL thật. Không thêm grant nào; các mục RBAC PENDING và scheduler S4-08 ngoài phạm vi vẫn giữ nguyên.
