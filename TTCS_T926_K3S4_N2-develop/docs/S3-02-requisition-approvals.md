# S3-02 — Xử lý phê duyệt requisition

S3-01 phải đã migrate. Migration mới riêng cho PostgreSQL/SQLite, không thay file 001/002:

```
npm run migrate:s3-02
node backend/src/db/migrate-requisition-approvals.js --check
```

Chỉ thực hiện trên database thật sau phê duyệt riêng. Không chạy seed/import. Bật bằng `REQUISITION_APPROVAL_ENABLED=true`; mặc định tắt. Startup chỉ verify schema.

API namespace `/api/v1/requisition-approvals`: GET list/options/detail; POST tạo workflow; POST `/:id/decisions`; POST `/:id/resubmit`. Không có API sửa/xóa event. Quyền submit/resubmit là `requisition.create` và ownership. Quyền quyết định là `requisition.approve` và assignee của bước hiện tại. Viewer phải là creator có `requisition.read` hoặc người trong chuỗi hiện hành có `requisition.approve`; không tự mở quyền Admin/HR xem mọi workflow.

Mỗi thao tác POST yêu cầu requestId. Quyết định yêu cầu expectedVersion/expectedStepId. Retry cùng key và nội dung trả acknowledgement cũ; key dùng cho nội dung khác bị từ chối. Workflow, step, event được thay đổi cùng transaction. PostgreSQL dùng cùng checked-out client, advisory locks và shared row locks cho quyền/tài khoản; SQLite dùng boundary BEGIN IMMEDIATE hiện có.

Snapshot nội dung riêng và immutable. S3-01 lưu snapshot chuỗi; các submission tham chiếu snapshot tương ứng. Mọi quyết định được append với workflow version, actor, UTC time, comment. Cấp cuối duyệt chuyển approval state thành APPROVED; không ghi vào requisitions.status. Thao tác cũ sửa requisition không ghi đè phiên bản đã gửi; quyết định chỉ áp dụng cho phiên bản hồ sơ trong workflow. Không tự đồng bộ revision bổ sung vào bản requisition hiện tại.

Hồ sơ legacy thiếu created_by không thể xác minh ownership và không được tự gán người tạo. Người tạo chủ động gửi yêu cầu từ section mới tại /requisitions; người duyệt xử lý trong section mới tại /approvals. Phần Offer được giữ nguyên. Nội dung đầy đủ được validate qua S2-10, không expose numeric standard salary trong approval API.

Chính sách nghiệp vụ cố định, không phụ thuộc biến môi trường hoặc tham số để cho phép ngoại lệ:

- Gửi lại luôn tạo submission và snapshot mới, resolve cấu hình đang công bố theo phòng ban và proposedSalaryMax của nội dung mới, bắt đầu cấp 1. Không tái sử dụng quyết định cũ, kể cả phòng ban/lương không đổi.
- Người tạo không được có mặt trong chuỗi duyệt được resolve. Submit/resubmit bị từ chối nếu chuỗi chứa creator. Backend kiểm tra lại khi ra quyết định; legacy self-approval bị chặn và không sửa lịch sử.
- Mỗi người xuất hiện tối đa một lần trong chuỗi. Create/newVersion/publish/resolve kiểm tra trùng người; snapshot persistence và decision kiểm tra độc lập. Cấu hình/workflow lịch sử có trùng không được cập nhật hồi tố. Muốn gửi vòng mới cần cấu hình mới hợp lệ.

Không cần migration mới cho ba chính sách; migration 001/002/003 giữ nguyên. Các biến APPROVAL_RESUBMISSION_POLICY, APPROVAL_SELF_APPROVAL, APPROVAL_REPEATED_APPROVER không còn điều khiển hành vi. Marker PRIOR_APPROVED trong schema được giữ để đọc dữ liệu lịch sử, không tạo mới.

Revision cũ và các quyết định trước không UPDATE/DELETE. Các luồng đang chạy có snapshot hợp lệ vẫn giữ người duyệt/cấp/hạn mức cũ khi cấu hình mới công bố. Chỉ vòng gửi lại chọn cấu hình hiện hành.

```
npm run test:s3-02
```

Suite chỉ chạy trên TEMP không .env/.git/runtime DB; email simulated. PostgreSQL embedded kiểm thử SQL/service/trigger; không thay thế kiểm thử concurrency nhiều connection pg-wire hoặc Neon live. Cần kiểm tra browser desktop/mobile thủ công sau deployment được duyệt.
