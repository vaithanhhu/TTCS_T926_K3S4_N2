# INTERNAL RECRUITMENT MANAGEMENT SYSTEM (ATS)
> Hệ thống Quản trị & Tuyển dụng Nội bộ Doanh nghiệp

Hệ thống được phát triển theo kiến trúc chuẩn Doanh nghiệp (Enterprise Clean Architecture), tích hợp cơ chế bảo mật xác thực phiên bảo mật cao, phân quyền vai trò động (Dynamic RBAC), mô hình dữ liệu quan hệ SQLite thuần (sử dụng `node:sqlite` tích hợp sẵn trong Node.js 22+) và giao diện người dùng Light Corporate SaaS chuyên nghiệp.

---

## 📋 1. Yêu cầu môi trường tiên quyết

Trước khi bắt đầu, máy tính của thành viên cần cài đặt:
- **Node.js**: Phiên bản **>= 22.0.0** (bắt buộc, vì hệ thống sử dụng module CSDL chuẩn `node:sqlite` tích hợp sẵn của Node.js 22, không cần cài đặt thêm SQLite bên ngoài hay build C++).
  - Kiểm tra phiên bản Node.js:
    ```bash
    node -v
    # Kết quả phải từ v22.0.0 trở lên (khuyên dùng Node.js 22 LTS)
    ```
- **NPM**: Đi kèm với Node.js.
- **Git** (nếu lấy mã nguồn qua Git repo).

---

## 🚀 2. Các bước cài đặt và khởi chạy cho thành viên nhóm

### Bước 1: Lấy mã nguồn về máy
- **Nếu dùng Git**:
  ```bash
  git clone <URL_CUA_NHOM> mysystem
  cd mysystem
  ```
- **Hoặc copy thư mục `mysystem`** vào máy tính cá nhân và mở terminal tại thư mục gốc của dự án.

---

### Bước 2: Cài đặt thư viện phụ thuộc (Dependencies)
Chạy lệnh sau tại thư mục gốc dự án:
```bash
npm install
```
*(Dự án tối ưu hóa tối đa, chỉ cần cài `nodemailer` cho dịch vụ gửi mail, không có phụ thuộc nặng nề).*

---

### Bước 3: Tạo file cấu hình môi trường (.env)
Sao chép file `.env.example` thành `.env`:
- Trên Windows (PowerShell):
  ```powershell
  Copy-Item .env.example .env
  ```
- Hoặc trên Linux/macOS/Git Bash:
  ```bash
  cp .env.example .env
  ```
*(Mặc định cổng chạy là `5050`. Bạn có thể mở file `.env` để điều chỉnh cấu hình SMTP email nếu muốn gửi email thực tế qua Gmail/Outlook/SES).*

---

### Bước 4: Khởi tạo Cơ sở dữ liệu và Dữ liệu mẫu (Database & Seed)
Chạy lệnh khởi tạo bảng và nạp sẵn dữ liệu thực tế (Phòng ban, 7 vai trò, tài khoản, đợt tuyển dụng, ứng viên, lịch phỏng vấn...):
```bash
npm run migrate
npm run seed
```
> **Lưu ý:** Lệnh `seed` sẽ tự động băm mật khẩu bảo mật (PBKDF2/SHA-256) và nạp đầy đủ 25 nhân sự mẫu của công ty.

---

### Bước 5: Khởi chạy máy chủ (Start Server)
```bash
npm start
```
Màn hình console hiển thị:
```text
[ATS Server] Server listening on http://localhost:5050
```

---

## 🌐 3. Truy cập và trải nghiệm hệ thống

Mở trình duyệt web và truy cập địa chỉ:
👉 **`http://localhost:5050`**

### Danh sách tài khoản thử nghiệm các vai trò:

Tất cả tài khoản mẫu đều dùng mật khẩu chung: **`Ats@123456`**

| Vai trò | Email đăng nhập | Mật khẩu | Quyền hạn tiêu biểu |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin@company.com` | `Ats@123456` | Toàn quyền hệ thống: Quản trị người dùng, phân vai trò, xem nhật ký Audit, khóa/mở khóa tài khoản |
| **Trưởng phòng Nhân sự (HR Manager)** | `hrmanager@company.com` | `Ats@123456` | Duyệt yêu cầu tuyển dụng, phê duyệt mức lương (Offer), điều phối bàn giao vị trí |
| **Chuyên viên Tuyển dụng (Recruiter)** | `recruiter@company.com` | `Ats@123456` | Tạo yêu cầu tuyển dụng, quản lý hồ sơ ứng viên, sắp xếp lịch phỏng vấn, gửi thư mời |
| **Trưởng bộ phận (Hiring Manager)** | `hiringmgr@company.com` | `Ats@123456` | Đề xuất nhu cầu tuyển dụng của phòng ban, đánh giá năng lực ứng viên |
| **Người phỏng vấn (Interviewer)** | `interviewer1@company.com` | `Ats@123456` | Tham gia hội đồng phỏng vấn, chấm điểm kỹ thuật chuyên môn |

---

## 🧪 4. Chạy kiểm thử tự động (Integration Tests)

Dự án có bộ kiểm thử tự động toàn diện kiểm tra đầy đủ mọi quy trình nghiệp vụ và tiêu chí an toàn (Authentication, RBAC Default Deny, Session Timeout, Anti Brute-force, Handover Requisitions...):

```bash
# Chạy toàn bộ 10 kịch bản Sprint 1 (56/56 tests)
npm run test:sprint1
```

Hoặc chạy từng kịch bản riêng lẻ:
```bash
npm run test:s1-01   # Đăng nhập & Xác thực phiên
npm run test:s1-02   # Đăng xuất & Thu hồi phiên
npm run test:s1-03   # Đổi mật khẩu lần đầu
npm run test:s1-04   # Quên mật khẩu & Reset Token
npm run test:s1-05   # Phiên làm việc & Tự động hết hạn
npm run test:s1-06   # Khóa đăng nhập chống Brute-force
npm run test:s1-07   # Xử lý trang lỗi bảo mật & Chặn truy cập trái phép
npm run test:s1-08   # Quản trị tài khoản & Email kích hoạt
npm run test:s1-09   # Gán và thu hồi đa vai trò (Multi-role RBAC)
npm run test:s1-10   # Khóa/Mở khóa tài khoản & Bàn giao vị trí phụ trách
```

---

## 📁 5. Cấu trúc thư mục dự án

```text
mysystem/
├── backend/
│   ├── data/                   # File cơ sở dữ liệu SQLite (ats.db)
│   ├── src/
│   │   ├── config/             # Cấu hình biến môi trường và hệ số bảo mật
│   │   ├── db/                 # Kết nối CSDL, Migrate schema và Seed dữ liệu
│   │   ├── services/           # Nghiệp vụ: Auth, User, Requisition, Email...
│   │   └── server.js           # REST API router & Web server
│   └── tests/                  # Bộ test tự động (test_s1_01 -> test_s1_10)
├── frontend/
│   ├── css/
│   │   └── style.css           # Design system giao diện Light Corporate SaaS
│   ├── js/
│   │   ├── api.js              # Module gọi REST API backend
│   │   └── app.js              # Điều hướng View, quản lý phiên và xử lý UI
│   └── index.html              # Enterprise App Shell (Sidebar, Topbar, Content Views)
├── .env.example                # Mẫu cấu hình môi trường
├── package.json                # Định nghĩa lệnh chạy và dependencies
└── README.md                   # Tài liệu hướng dẫn sử dụng
```

---

## 💡 6. Một số lưu ý khi thành viên chạy dự án

1. **Phiên bản Node.js:** Hãy chắc chắn thành viên trong nhóm đang dùng **Node.js 22 trở lên**. Nếu dùng phiên bản cũ hơn (Node 18, 20), lệnh kết nối CSDL `node:sqlite` sẽ không được nhận diện.
2. **Xung đột cổng `5050`:** Nếu cổng `5050` đang bị ứng dụng khác chiếm dụng, bạn chỉ cần sửa giá trị `PORT=5051` (hoặc cổng bất kỳ) trong file `.env`.
3. **Reset dữ liệu ban đầu:** Bất kỳ lúc nào muốn khôi phục CSDL về trạng thái chuẩn ban đầu, chỉ cần chạy lại:
   ```bash
   npm run seed
   ```
