# ATS — chạy Sprint 1–3 trên localhost

Backend Node.js CommonJS, HTTP/JSON; frontend HTML/CSS/JavaScript. Ứng dụng hỗ trợ PostgreSQL và SQLite. Profile demo bên dưới dùng SQLite riêng, không cần Neon, PostgreSQL server, Docker hay SMTP.

## Yêu cầu Windows

- Node.js **22.13 trở lên**, khuyến nghị Node.js 24 LTS, cùng npm.
- Git và Windows PowerShell.
- Internet khi cài dependency lần đầu và tải Chromium nếu chạy Browser E2E.

```powershell
node --version
npm --version
git --version
```

## Clone, cài đặt, tạo dữ liệu và chạy

```powershell
git clone https://github.com/vaithanhhu/TTCS_T926_K3S4_N2.git
Set-Location TTCS_T926_K3S4_N2
npm ci
npm run setup:local
npm run start:local
```

Nếu mentor được giao nhánh `feature/s2-bulk-user-import`, clone trực tiếp nhánh đó:

```powershell
git clone --branch feature/s2-bulk-user-import --single-branch https://github.com/vaithanhhu/TTCS_T926_K3S4_N2.git
Set-Location TTCS_T926_K3S4_N2
npm ci
npm run setup:local
npm run start:local
```

Phải dùng revision đã chứa `setup:local`, `start:local` và toàn bộ source/migration Sprint 3. Các thay đổi chưa được developer đưa lên GitHub không xuất hiện khi clone. Kiểm tra bằng `npm run` trước khi setup.

Mở **http://localhost:5050/login**. Tin tuyển dụng công khai: **http://localhost:5050/careers/jobs**. Dừng server bằng Ctrl+C. Chạy lại `npm run start:local` để tiếp tục dùng dữ liệu đã tạo.

Profile local tự áp dụng cấu hình an toàn trong tiến trình:

- SQLite tại `.local/ats-demo.db`, marker sở hữu tại `.local/ats-demo.json`.
- Bỏ qua `.env` hiện có và các biến kết nối database/SMTP kế thừa.
- Email mô phỏng; không gửi email ra ngoài.
- Chỉ nghe trên `127.0.0.1`; bật tám flags Sprint 3 cho tiến trình demo.
- Không dùng hoặc sửa `backend/data/ats.db`, WAL/SHM, `ats_test.db` hay Neon.

Không cần tạo `.env`. `.env.example` là cấu hình mẫu không chứa secret dành cho người muốn đọc hoặc cấu hình thủ công. Với demo, tiếp tục dùng hai lệnh local ở trên. Các lệnh `npm start`, `migrate`, `seed`, `migrate:postgres` và `import:postgres` là lệnh vận hành khác; không dùng chúng thay cho setup demo.

`setup:local` tạo schema SQLite hiện hành và áp dụng migration Sprint 3 theo thứ tự 002–008. Migration 001 là nền PostgreSQL, không chạy SQL PostgreSQL lên SQLite. Setup đầu tiên tạo tài khoản/dữ liệu mẫu trong transaction. Chạy setup lần nữa kiểm tra migration và foreign keys, không seed lại hoặc ghi đè dữ liệu tester. Nếu database đã tồn tại nhưng không có marker sở hữu, setup từ chối. Không đổi tên/copy database thật vào `.local`.

## Tài khoản demo

Tất cả tài khoản sau dùng mật khẩu demo **`Ats@123456`**, chỉ cho SQLite localhost, không phải credential production. Mật khẩu lưu dạng scrypt; không cần biết mật khẩu của bất kỳ tài khoản thật nào.

| Vai trò | Email đăng nhập | Trang bắt đầu và quyền chính |
|---|---|---|
| ADMIN | admin@company.com | `/admin`; toàn quyền RBAC, vẫn chịu validation, trạng thái và cấm tự duyệt |
| HR_MANAGER | hrmanager@company.com | `/dashboard`; danh mục, ngân sách, cấu hình duyệt, phân công và duyệt tin |
| HIRING_MGR | hiringmgr@company.com | `/hiring`; Requisition thuộc phạm vi, sửa nháp/OPEN theo chính sách, candidate chỉ đọc trong phạm vi |
| APPROVER | approver@company.com | `/approvals`; quyết định bước được phân công |
| RECRUITER | recruiter@company.com | `/recruitment`; ứng viên và bản nháp tin của Requisition được phân công |
| INTERVIEWER | interviewer@company.com | `/interviews`; vòng phỏng vấn và đánh giá được phân công |
| CANDIDATE | candidate@example.com | `/candidate`; dữ liệu và chức năng ứng viên của mình |
| Recruiter hỗ trợ | recruiter.support@demo.example | Như RECRUITER, được phân công hỗ trợ hồ sơ demo |

ADMIN không vượt quy tắc bảo mật dải lương chuẩn S2-05: HR_MANAGER là vai trò xem/sửa dải lương chuẩn. ADMIN không tự duyệt Requisition của mình hoặc tin mình tạo/sửa nội dung cuối. RECRUITER không được tự duyệt/xuất bản tin.

## Dữ liệu mẫu và cách thử Sprint 3

Setup tạo 26 tài khoản, phòng ban/danh mục cơ sở, khung năng lực/chức danh demo, cấu hình duyệt và ngân sách theo phòng ban. Có năm Requisition mang tiền tố `DEMO`:

- Nháp để chỉnh sửa: dùng kiểm tra DRAFT, form và sao chép.
- Sẵn sàng gửi duyệt: creator chủ động gửi; không tự gửi khi lưu OPEN.
- Chờ duyệt hai cấp: HR_MANAGER rồi APPROVER; kiểm tra approve/reject/request info và lịch sử.
- Đã duyệt để soạn tin: recruiter chính/hỗ trợ đã được phân công.
- Tin tuyển dụng công khai: có tin đã được HR độc lập duyệt, ADMIN xuất bản; một ứng viên đang phỏng vấn để kiểm tra cảnh báo khi đóng.

`neededDate` được tạo sau ngày setup 30 ngày; budget tính theo năm của ngày đó. Tin demo còn hiệu lực khi setup. Sau khi deadline đã qua, tin sẽ bị ẩn đúng chính sách; không chạy seed lại để khôi phục.

Luồng thao tác gợi ý:

1. HIRING_MGR mở **Yêu cầu và vị trí**, chọn hồ sơ sẵn sàng và **Gửi phê duyệt**.
2. HR_MANAGER mở **Phê duyệt**, đọc và duyệt bước được phân công. Với hồ sơ hai cấp, APPROVER duyệt cấp tiếp theo.
3. HR_MANAGER mở Chi tiết hồ sơ đã duyệt, phân công recruiter chính và hỗ trợ.
4. RECRUITER mở hồ sơ được giao, tạo/lưu bản nháp tin, preview và gửi duyệt.
5. HR_MANAGER độc lập xem preview, duyệt rồi xuất bản. Tin xuất hiện tại `/careers/jobs`.
6. Kiểm tra lịch sử, số ngày/bộ lọc, sao chép thành DRAFT, ngân sách và chỉnh sửa OPEN nhóm B. Revision chưa duyệt không có hiệu lực; cấp cuối mới áp dụng.
7. HR_MANAGER thử PAUSED/CLOSED/CANCELLED. Backend chặn đóng/hủy khi còn pipeline hoạt động hoặc workflow pending. Không tự động từ chối ứng viên. PAUSED giữ quota và đóng băng duyệt; tin bị ẩn, không tự đăng lại.

Hai ngoại lệ vẫn giữ nguyên: **S2-05-AC2** tích hợp lương Offer tương lai; **S2-06-AC4** phiếu đánh giá Sprint 6. Demo không triển khai Sprint 6–7.

## Feature flags local

Các flags sau ON trong `setup:local`/`start:local`; không sửa `.env` hoặc flags production:

| Flag | Chức năng |
|---|---|
| APPROVAL_CONFIGURATION_ENABLED | S3-01 cấu hình |
| REQUISITION_APPROVAL_ENABLED | S3-02/03 duyệt và lịch sử |
| HEADCOUNT_BUDGET_ENABLED | S3-04 ngân sách |
| REQUISITION_OPERATIONS_ENABLED | S3-05/06 sao chép, phân công |
| REQUISITION_LIFECYCLE_ENABLED | S3-07 vòng đời |
| REQUISITION_TRACKING_ENABLED | S3-08 danh sách/bộ lọc |
| JOB_POSTING_DRAFTS_ENABLED | S3-09 soạn nháp |
| JOB_POSTING_PUBLICATION_ENABLED | S3-10 duyệt/preview/xuất bản |

## Automated tests và Browser E2E

Cài Chromium cho người dùng Windows hiện tại:

```powershell
npx playwright install chromium
```

Runner `test:local` tạo một bản sao source và SQLite mới **cho từng suite**, bỏ `.env`, runtime DB và media cá nhân; email mô phỏng; không dùng Neon. Dependency cài vào thư mục test tạm, các suite dùng bản sao qua hardlink trên cùng ổ đĩa. Log và `results.json` nằm trong thư mục `%TEMP%` được runner in ra. Test không ghi đè database demo `.local` của tester.

```powershell
npm run test:local
npm run test:local -- test:local-demo test:browser-e2e
npm run test:local -- --all
```

Lệnh mặc định chạy setup/browser demo, Sprint 1 aggregate, Sprint 2, S2-10 và S3-01 đến S3-10. `--all` chạy các suite đăng ký có thể chạy cách ly, gồm coverage, RBAC, routing, PGlite, bảo mật email và browser. Aggregate Sprint 1 lặp các suite S1 riêng: không cộng thành số test case độc lập.

Không chạy riêng các lệnh test cũ trực tiếp trên checkout đang có database. Các bài PostgreSQL live không nằm trong runner này vì cần PostgreSQL test độc lập và cấu hình được xác minh; không trỏ chúng tới Neon. Browser E2E cần Chromium đã cài; thiếu browser là FAIL/NOT RUN, không thay bằng API rồi tuyên bố browser PASS.

## Xử lý lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Không có `setup:local` | Revision clone còn cũ; yêu cầu developer cung cấp nhánh/revision bàn giao đã có source mới |
| Không tìm thấy `node:sqlite` hoặc unsupported engine | Cài Node.js >=22.13, mở PowerShell mới, kiểm tra `Get-Command node` và `node --version` |
| npm ci thất bại | Kiểm tra mạng/proxy, lockfile đúng revision và dung lượng ổ đĩa; không dùng `--omit=dev` nếu chạy tests |
| LOCAL_SETUP_REQUIRED | Chạy `npm run setup:local`, chờ `LOCAL_SETUP_RESULT` thành công |
| LOCAL_DATABASE_NOT_OWNED / LOCAL_FILE_UNSAFE / LOCAL_DATABASE_MISSING | Dừng, kiểm tra `.local` và marker; không ghi đè database khác hoặc xoá database để chữa lỗi |
| Setup lock còn tồn tại sau tiến trình bị ngắt | Xác minh không còn setup chạy; kiểm tra `.local/setup.lock`. Chỉ xóa file lock thuộc demo khi chắc chắn tiến trình đã dừng, không xóa database |
| EADDRINUSE / port 5050 đã dùng | Đổi port theo lệnh dưới, không dừng tiến trình của người khác |
| Playwright executable doesn't exist | Chạy `npx playwright install chromium` rồi chạy lại Browser E2E |
| Tin công khai không thấy | Kiểm tra approved/published, deadline, trạng thái Requisition, nguồn tin còn hiệu lực; không tự republish tin đã gỡ |
| Email không đến inbox | Profile local dùng simulated; kiểm tra luồng/response bằng test. SMTP sandbox thật cần cấu hình và inbox được phê duyệt riêng |

```powershell
$env:ATS_LOCAL_PORT = '5051'
npm run start:local
```

## Dữ liệu và Git

Không đưa `.env`, `.local`, `backend/data/*.db`, WAL/SHM, `node_modules`, media tải lên, log, screenshot chứa dữ liệu cá nhân hoặc trace chưa khử bí mật lên Git. `.gitignore` bảo vệ file mới; file database đã được theo dõi từ trước vẫn cần developer xử lý index riêng. Setup/test local không thực hiện thao tác Git.

Giữ source, package/lockfile, frontend components/routes, tests và toàn bộ SQL/migration runner cần cho Sprint 1–3 trong revision bàn giao. Không dùng SQL Docker cũ thay cho schema runtime. PostgreSQL/Neon vận hành riêng ngoài hướng dẫn localhost này; không chia sẻ URI hoặc credential thật cho tester.
