# HƯỚNG DẪN ĐỒNG BỘ DỮ LIỆU & CHẠY DOCKER CHO NHÓM

Hệ thống cung cấp file cấu hình `docker.yml` giúp toàn bộ thành viên trong nhóm đồng bộ môi trường CSDL, dữ liệu mẫu, công cụ quản trị CSDL trực quan và SMTP Server giả lập để test email mà không cần cài đặt phức tạp.

---

## 1. Các dịch vụ có sẵn trong `docker.yml`

| Dịch vụ | Chức năng | Cổng truy cập (Host) | Thông tin đăng nhập / Sử dụng |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16** | Cơ sở dữ liệu chính của hệ thống ATS | `localhost:5432` | DB: `ats_recruitment`<br>User: `ats_user`<br>Password: `ats_secret123` |
| **Adminer** | Giao diện Web quản lý CSDL trực quan | `http://localhost:8080` | Hệ thống: `PostgreSQL`<br>Máy chủ: `postgres`<br>Người dùng: `ats_user`<br>Mật khẩu: `ats_secret123`<br>CSDL: `ats_recruitment` |
| **Mailpit** | Xem trước email kích hoạt tài khoản & link đặt lại mật khẩu | `http://localhost:8025` (Web UI)<br>`localhost:1025` (SMTP) | Không cần mật khẩu, mở web là thấy toàn bộ email hệ thống gửi ra |
| **Frontend** | Giao diện ATS React + TypeScript | `http://localhost:3000` | Giao diện đã cấu hình tự động kết nối |

---

## 2. Các lệnh thông dụng cho thành viên nhóm

### Khởi động toàn bộ dịch vụ ngầm (Background)
```bash
docker compose -f docker.yml up -d
```
*(Hoặc có thể gõ ngắn gọn: `docker compose up -d`)*

### Kiểm tra trạng thái các container
```bash
docker compose -f docker.yml ps
```

### Xem log các dịch vụ
```bash
docker compose -f docker.yml logs -f
```

### Dừng các dịch vụ
```bash
docker compose -f docker.yml down
```

### Reset dữ liệu về trạng thái ban đầu (Xoá volume và nạp lại seed data mẫu)
```bash
docker compose -f docker.yml down -v
docker compose -f docker.yml up -d
```

---

## 3. Cấu trúc thư mục dữ liệu Docker
```
docker/
└── sql/
    ├── 01_schema.sql  # Định nghĩa bảng users, roles, departments, user_roles, audit_logs...
    └── 02_seed.sql    # Dữ liệu khởi tạo 7 vai trò, phòng ban & tài khoản test mẫu
```
Khi khởi động lần đầu, PostgreSQL trong Docker sẽ tự động chạy 2 file SQL trên theo thứ tự chữ cái để tạo bảng và nạp dữ liệu đầy đủ.
