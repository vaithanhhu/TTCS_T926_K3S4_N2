# S6-03 — Đặt lịch phỏng vấn hàng loạt

## Phạm vi và quyền

Dùng `interview.create` hiện hành, actor ACTIVE được tải lại từ database. Chỉ ADMIN, HR_MANAGER hoặc RECRUITER trong scope mới được thao tác. Từng candidate phải qua `candidateAccess()` như S6-02. Panel gồm người dùng ACTIVE có `interview.evaluate`; không cấp thêm quyền đánh giá cho co-interviewer. Không đổi candidate/CV/private-note read scope.

## API

Các route có alias tương ứng bỏ `/api/v1` và cùng policy:

| Method | Route | Mục đích |
|---|---|---|
| POST | `/api/v1/interviews/bulk-preview` | Tính slot và kiểm tra, không ghi dữ liệu |
| POST | `/api/v1/interviews/bulk-create` | Confirm nguyên tử và dispatch lời mời sau commit |
| GET | `/api/v1/interviews/batches/:id` | Kết quả batch và trạng thái delivery |
| POST | `/api/v1/interviews/batches/:id/retry` | Dispatch PENDING hoặc thử lại lỗi chắc chắn chưa gửi |

Preview nhận `candidateIds`, `requisitionId`, `interviewerIds` (phần tử đầu là primary), `roundName`, `windowStart`, `windowEnd`, `durationMinutes`, `breakMinutes`, `interviewFormat`, `meetingRoom` hoặc `meetingLink`. Tối đa 100 candidate và 100 interviewer mỗi request; duration 15–480 phút theo S6-02, break 0–480 phút. Candidate ID được sắp thứ tự tăng dần, không phụ thuộc thứ tự click. Chỉ các hồ sơ đang hiển thị có requisition nội bộ mới được chọn trên UI.

Ngày giờ không có offset được hiểu là Asia/Ho_Chi_Minh theo parser S6-02; response lưu/trả ISO UTC. `N × duration + (N − 1) × break` phải nằm trong window, lịch tiếp giáp hợp lệ, lịch CANCELLED không chiếm slot. Không khóa phòng họp: quy tắc conflict hiện hành kiểm candidate và interviewer, không tự bổ sung chính sách phòng.

Preview trả `slots`, `errors` theo candidate và `fingerprint` SHA-256 của cấu hình cùng metadata nguồn đã kiểm quyền. Fingerprint là kiểm tra stale, không phải token authorization hay lời giữ chỗ. Confirm phải gửi lại cấu hình, fingerprint và `requestKey` 16–128 ký tự chữ/số/`_`/`-`; bỏ qua slots client. Backend tải lại và xác thực mọi tài nguyên.

Validation trả 400, thiếu authentication HTTP 401, thiếu quyền/scope 403, tài nguyên không tồn tại 404, conflict/stale/idempotency mismatch 409. Lỗi hạ tầng/schema trả 503 không kèm SQL, đường dẫn hoặc stack trace. Preview có lỗi vẫn có thể trả slot đã tính để hiển thị, nhưng không cho confirm.

## Transaction và idempotency

SQLite dùng `BEGIN IMMEDIATE` của adapter. PostgreSQL khóa theo thứ tự: idempotency actor/key, toàn bộ candidate ID tăng dần, advisory lock panel ID tăng dần theo namespace S6-02. Sau khóa kiểm quyền, fingerprint và conflict lại, rồi gọi scheduling engine S6-02 trong transaction ngoài. Không sao chép logic INSERT hoặc update stage. Batch, items, lịch, membership, stage và outbox intent rollback cùng nhau khi lỗi.

Unique `(actor_id, request_key)` và payload hash bảo vệ retry; cùng key/payload trả lại batch đã commit, kể cả sau thời điểm phỏng vấn. Key khác payload trả 409. Actor/scope hiện hành vẫn được kiểm khi đọc lại kết quả. Chủ batch hoặc ADMIN/HR có quyền và candidate scope mới được xem/retry. Không có API đọc toàn bộ batch không scope.

## Migration 015

Chỉ chạy `npm run migrate:s6-03` sau khi người vận hành đã xác minh database đích và phê duyệt migration. Không tự chạy ở startup. Yêu cầu schema 014 đã verify và `email_outbox` của 009 đã có. Không chạy runner cũ để tự đồng bộ grants.

SQL 015 dùng chung SQLite/PostgreSQL, tạo `interview_batches`, `interview_batch_items`, `interview_invitation_deliveries` và index trạng thái. Ledger `ats_bulk_interview_migrations` lưu checksum; DDL và ledger cùng transaction. Verify/retry kiểm cột, null/default/type, PK, FK, unique, CHECK trạng thái và index; schema drift không được ghi nhận là hoàn tất. Không sửa migration lịch sử hoặc backfill lịch cũ. Lỗi trong migration rollback transaction; không cung cấp thao tác drop dữ liệu đã tạo để rollback triển khai.

## Email và xử lý sự cố

Tái sử dụng `email_outbox` và `EmailService`; delivery identity duy nhất theo interview/recipient/type. Worker `InterviewInvitationWorker` được HTTP confirm/retry gọi sau khi transaction tạo batch đã kết thúc. Không có scheduler mới hoặc trusted caller giả. Sau restart, người có quyền dùng GET trạng thái rồi POST retry để xử lý PENDING còn tồn. Không cần giữ request gốc để dispatch batch đã biết ID.

Template mới là `S603_INTERVIEW_INVITATION`. Timeline tải lại actor/grants và lọc từng application bằng read predicate, bỏ Candidate ownership khỏi quyền đọc timeline nội bộ. Log gửi trùng của loại email mới được bỏ; outbox được đọc qua delivery → interview → tập candidate được phép. Hai application cùng email ở hai requisition khác scope không nhận metadata/số lượng lời mời của nhau. Email legacy chỉ có recipient, chưa có application identity: khi cùng email tồn tại application ngoài scope, ẩn các email legacy không thể xác định ownership; HR/ADMIN và actor được đọc toàn bộ các application tương ứng vẫn giữ lịch sử đầy đủ. Không đoán ownership hoặc sửa dữ liệu cũ.

| Delivery state | Xử lý |
|---|---|
| PENDING | Có thể claim và gửi |
| SENDING | Đã claim; tiến trình có thể vẫn gửi hoặc đã chết, không tự resend |
| SENT | SMTP chấp nhận, không chứng minh đến inbox |
| SIMULATED | Chỉ mô phỏng, không gửi email thật |
| FAILED | Lỗi chắc chắn trước gửi hoặc recipient bị từ chối; người có quyền có thể retry |
| UNKNOWN | Kết quả SMTP hoặc cập nhật sau gửi không xác định; không tự resend |

Worker dùng conditional UPDATE để claim; hai worker không gửi cùng delivery. Không giữ DB transaction khi gửi SMTP. Crash sau claim có thể để SENDING; crash sau SMTP nhưng trước khi lưu kết quả cũng không được tự reset về PENDING. Cần đối chiếu nhà cung cấp email theo quy trình vận hành riêng trước quyết định xử lý thủ công. Không bảo đảm exactly-once SMTP delivery. Nếu một delivery UNKNOWN/SENDING, retry batch trả 409 để tránh gửi lại mù.

UI giữ request chưa rõ kết quả trong sessionStorage theo actor, dùng cùng key khi retry; cấu hình bị khóa cho đến khi có kết quả xác định. Không đưa token vào URL hoặc cache payload này. Người dùng không nên xóa sessionStorage khi còn yêu cầu chưa rõ kết quả; có thể tra cứu batch bằng API khi đã biết ID.

## Kiểm thử an toàn

`test:s6-03` chỉ dùng SQLite memory và PGlite, email mock. Native PostgreSQL, HTTP và Browser nằm trong `test_s6_03_postgres.js`, `test_s6_03_http.js`, `test_s6_03_frontend.js`; chạy trong bản sao source cô lập, không `.env`, Git, database hoặc media nghiệp vụ. Native runner yêu cầu config cluster local disposable đã xác minh và tạo database mới riêng; không nhận Azure/Neon URL. Không dùng PGlite để kết luận concurrency native PostgreSQL.

Không chạy migration, seed hoặc test HTTP trên workspace đang sử dụng. Full regression dùng `npm run test -- --all` trong export cô lập. Mọi email test phải là simulated/mock.
