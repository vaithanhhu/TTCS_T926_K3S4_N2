# S3-01 — Cấu hình phê duyệt

Tính năng được bật bằng `APPROVAL_CONFIGURATION_ENABLED=true`. Mặc định tắt để không yêu cầu schema mới trên deployment Sprint 1/2.

Migration bổ sung:

```
npm run migrate:s3-01
node backend/src/db/migrate-approval-configurations.js --check
```

Chỉ chạy migration sau khi người quản trị phê duyệt trên database đích. Không chạy seed/import. PostgreSQL cần migration nền đã hoàn tất; không chỉnh sửa `001_postgres.sql`. CLI sử dụng cấu hình kết nối hiện có, không nhận hoặc in credential.

Migration thêm bốn bảng và ledger riêng. Nó thêm permission `approval_configuration.manage` cho role HR_MANAGER, không thay permission hoặc user-role cũ. Không có thao tác phân quyền tự động theo phòng ban.

Giao diện: `/admin/approval-configurations`. Menu chỉ xuất hiện khi tính năng bật và session có permission. API namespace: `/api/v1/approval-configurations`; các thao tác list, options, detail, create, versions, publish và resolve đều kiểm tra permission ở backend. Direct URL của người thiếu quyền chỉ nhận lỗi API; không có quyền đọc cấu hình.

Cấp có thứ tự liên tục từ 1, hạn mức số VND không âm tăng dần, và một user ACTIVE có quyền `requisition.approve`. Quyền được lấy từ union các role. Hạn mức theo `proposedSalaryMax` mỗi người/tháng, không nhân headcount. Resolver lấy chuỗi từ cấp đầu đến cấp đầu tiên đủ hạn mức. Bằng hạn mức không lên cấp. Không đủ hạn mức hoặc thiếu cấu hình trả 409, không tự tạo người/cấp hay kế thừa cấu hình cha.

Lưu thay đổi tạo version mới; công bố kiểm tra lại department và approver. Published version và các cấp được bảo vệ bằng trigger. Các tham chiếu đến user/department được xác thực bởi service, không thêm FK làm thay đổi hành vi xóa user/department của module cũ. Các quan hệ configuration/version/snapshot có FK, và publication chỉ tham chiếu version thuộc cùng configuration.

`ApprovalConfigurationService.bindSnapshot(workflowId, requisitionId)` là nền tảng nội bộ cho khởi tạo workflow sau này. Nó lưu version, salary basis, currency và toàn bộ chuỗi đã resolve trong transaction. Cùng workflow ID trả lại snapshot đã lưu, không resolve lại. ID không được chuyển sang requisition khác. Snapshot có trigger chống UPDATE/DELETE; PostgreSQL cũng chặn TRUNCATE cho snapshot/version/levels. Quyền owner có thể tháo trigger, vì vậy runtime database role phải được quản trị riêng.

S3-01 không thêm API/nút gửi workflow, không ra quyết định duyệt/từ chối/bổ sung, không thay trạng thái requisition, và không chặn tuyển dụng. Lưu DRAFT/OPEN không tạo snapshot. Tự duyệt và người trùng giữa cấp chưa được xét bởi cơ chế cấu hình/resolver; phải chốt trước khi triển khai hành động S3-02. Người không còn đủ điều kiện không được dùng để tạo snapshot mới; snapshot cũ vẫn bất biến. Không có cơ chế thay người tự động.

Kiểm thử:

```
npm run test:s3-01
```

Suite phải chạy trong bản sao TEMP không có `.git`, `.env` hoặc runtime DB, có dependency riêng và EMAIL_MODE simulated. SQLite API/frontend integration và PostgreSQL embedded SQL/service/trigger được kiểm thử. Embedded engine không thay thế kiểm thử live Neon hoặc concurrency nhiều connection qua pg-wire.

Để kiểm tra UI thủ công sau deployment được duyệt: đăng nhập HR Manager, chọn phòng ban, thêm/xóa cấp, lưu version, công bố và xem version trước. Kiểm tra desktop/mobile và thông báo khi user/phòng ban không còn hoạt động. Không cần gửi email.
