# ATS — bàn giao localhost Windows, 10/10/2026

Branch `feature/s2-bulk-user-import`; HEAD `d962ef3a9da49d42b595dba85ca3daa3404454db`. Không thay branch/HEAD hoặc thực hiện Git ghi.

## Kết luận

| Hạng mục | Kết quả |
|---|---|
| Bản sao sạch của source hiện tại, không .env/database/node_modules ban đầu | PASS |
| npm ci, setup lần đầu/lần hai, npm run start:local | PASS |
| SQLite demo riêng, 26 tài khoản/7 vai trò, foreign keys và migration module | PASS |
| Sprint 1 | 56/56 PASS; coverage 23/23; frontend fixes 18/18 |
| Sprint 2 | 32/32 PASS; coverage 25/25; S2-10 59/59 |
| Sprint 3, S3-01 đến S3-10 | 539/539 PASS |
| Chromium Browser regression | 64/64 PASS |
| Setup sạch và browser trên profile demo | 20/20 PASS |
| node --check | 154/154 PASS |
| git diff --check | PASS |
| Hash bảo vệ | 19/19 không đổi: 4 runtime SQLite và 15 SQL 001–008 |
| Neon | NOT RUN; không kết nối/ghi dữ liệu |
| PostgreSQL live | NOT RUN trong task SQLite local; các suite PGlite parity đã chạy PASS |
| GitHub clone revision bàn giao | BLOCKED tới khi developer đưa source đã review lên GitHub |

48 script có exit code 0; 1.768 lượt kiểm tra PASS, 0 FAIL. Trong đó 56 lượt lặp do aggregate Sprint 1. Không coi tổng này là số Acceptance Criteria hoặc số test case toàn hệ thống độc lập. Command, exit code, thời gian và log trong [JSON evidence](evidence/ATS-localhost-handover.json).

Đã kiểm tra bản sao sạch của working tree, không giả định remote HEAD đã có các file mới. Sau khi developer tự commit/push allowlist, mentor cần clone đúng revision đó. Hai ngoại lệ S2-05-AC2 và S2-06-AC4 giữ nguyên; không triển khai Sprint 6–7. Không ký UAT, real-email acceptance hoặc brand signoff thay người có thẩm quyền.

## Root cause và giải pháp

README cũ dùng clone URL placeholder, mô tả dependency không đúng, Node minimum chưa đủ cho lệnh SQLite không dùng experimental flag, sai email interviewer và thiếu vai trò/flags Sprint 3. Cấu hình mẫu PostgreSQL/SMTP production không phù hợp máy tester. Startup SQLite tạo base schema nhưng chỉ verify migration module, nên clone mới bật flags chưa đủ schema Sprint 3.

Thêm profile local riêng, bỏ qua .env và các biến kết nối/SMTP kế thừa; DB path cố định `.local/ats-demo.db`, email simulated và bind `127.0.0.1`. Không thay hành vi cấu hình của lệnh vận hành thông thường. Server chung chỉ thêm host tùy chọn, mặc định cũ giữ nguyên.

Setup dùng `database.js` làm schema SQLite cơ sở; seed cơ sở chỉ lần đầu trong DB demo có marker sở hữu; áp dụng migration runner hiện hành 002–008 theo thứ tự. Migration 001 là nền PostgreSQL, không chạy SQL PostgreSQL trên SQLite. Không chỉnh sửa SQL lịch sử, không tạo migration mới.

Dữ liệu demo bổ sung dùng service hiện tại trong transaction: cấu hình/phê duyệt, ngân sách, khung năng lực/chức danh/catalog, Requisition, recruiter assignment, candidate/interview và tin được duyệt độc lập/xuất bản. Lần chạy setup thử đầu tiên phát hiện thiếu fixture WORK_LOCATION/WORK_MODE; đã sửa seed demo để tạo qua catalog service. Lượt setup và regression cuối PASS.

Setup từ chối DB không có marker, symlink/file không an toàn và setup đồng thời. Rerun không seed lại hoặc ghi đè dữ liệu tester. Start từ chối khi chưa setup; port conflict báo EADDRINUSE và đóng DB. Runner regression tạo source/DB riêng từng suite, dùng email simulated và không chạm database demo của tester.

## File sửa/tạo trong task này

| File | Mục đích |
|---|---|
| `.env.example` | SQLite/simulated và tám flags, không secret |
| `.gitignore` | Loại .local, test-artifacts và database mới |
| `README.md` | PowerShell, tài khoản, quyền, flags, lỗi và test cách ly |
| `package.json` | Scripts local/demo/startup và Node minimum |
| `package-lock.json` | Đồng bộ Node minimum; dependency giữ nguyên so với đầu task |
| `backend/src/config/config.js` | Bỏ qua .env chỉ trong profile local-demo |
| `backend/src/server.js` | Host listen tùy chọn cho loopback |
| `backend/src/config/local-demo.js` | Cấu hình local an toàn, marker/path validation |
| `backend/src/db/setup-local.js` | Setup, verify, ownership, idempotency và lock |
| `backend/src/db/seed-local-demo.js` | Fixture localhost qua service |
| `backend/src/start-local.js` | Entry point riêng cho localhost |
| `backend/tests/run_local_tests.js` | Source/DB cách ly, log và timeout |
| `backend/tests/test_local_demo.js` | 20 case setup/guard/RBAC/browser/public/mobile |
| `docs/ATS-localhost-handover.md` | Báo cáo này |
| `docs/ATS-localhost-files-to-commit.txt` | Allowlist đề xuất, chưa stage |
| `docs/evidence/ATS-localhost-handover.json` | Kết quả máy đọc và hash bảo vệ |
| `docs/evidence/ATS-localhost-handover/` | Browser result, node check, smoke và 3 screenshot demo |

Các thay đổi Sprint 3 trước task được bảo toàn; không gộp chúng vào danh sách sửa mới này. Không sửa assertion cũ.

## Lệnh tester/mentor

Cài Node >=22.13; lượt kiểm thử thực tế dùng Windows và Node v24.18.0. Sau khi developer đưa source lên nhánh bàn giao:

```powershell
git clone --branch feature/s2-bulk-user-import --single-branch https://github.com/vaithanhhu/TTCS_T926_K3S4_N2.git
Set-Location TTCS_T926_K3S4_N2
npm ci
npm run setup:local
npm run start:local
```

URL: http://localhost:5050/login và http://localhost:5050/careers/jobs. Không cần .env, Neon, Docker, PostgreSQL server hoặc SMTP. Chạy lại start để giữ dữ liệu; không dùng lệnh seed/migrate cũ thay setup:local.

| Vai trò | Email demo | Trạng thái |
|---|---|---|
| ADMIN | admin@company.com | ACTIVE |
| HR_MANAGER | hrmanager@company.com | ACTIVE |
| HIRING_MGR | hiringmgr@company.com | ACTIVE |
| APPROVER | approver@company.com | ACTIVE |
| RECRUITER | recruiter@company.com | ACTIVE |
| INTERVIEWER | interviewer@company.com | ACTIVE |
| CANDIDATE | candidate@example.com | ACTIVE |
| Recruiter hỗ trợ | recruiter.support@demo.example | ACTIVE |

Mật khẩu demo: `Ats@123456`. Đây là dữ liệu local, không phải secret production. Quyền và luồng thao tác theo README; ADMIN vẫn chịu điều kiện trạng thái, validation và cấm tự duyệt. Dải lương chuẩn giữ rule bảo mật S2-05 dành cho HR_MANAGER. Recruiter chỉ truy cập hồ sơ được phân công; Hiring chỉ đọc candidate trong phạm vi.

Trong terminal thứ hai:

```powershell
npx playwright install chromium
npm run test:local -- test:local-demo test:browser-e2e
npm run test:local -- --all
```

Nếu port bị chiếm:

```powershell
$env:ATS_LOCAL_PORT = '5051'
npm run start:local
```

## Tám flags local

Tất cả ON chỉ trong tiến trình demo:

- APPROVAL_CONFIGURATION_ENABLED
- REQUISITION_APPROVAL_ENABLED
- HEADCOUNT_BUDGET_ENABLED
- REQUISITION_OPERATIONS_ENABLED
- REQUISITION_LIFECYCLE_ENABLED
- REQUISITION_TRACKING_ENABLED
- JOB_POSTING_DRAFTS_ENABLED
- JOB_POSTING_PUBLICATION_ENABLED

Production .env/flags không bị sửa. Browser regression đã kiểm tra ON/OFF ở môi trường cách ly.

## Bằng chứng trình duyệt

[ADMIN local](evidence/ATS-localhost-handover/local-home-ADMIN.png), [Requisition mobile 360px](evidence/ATS-localhost-handover/local-requisition-mobile.png), [public detail](evidence/ATS-localhost-handover/local-public-detail.png).

20 case riêng chạy trên source mới không có DB/.env: ownership guard, setup bỏ qua fake PostgreSQL/SMTP kế thừa, foreign keys/states, rerun, lock, startup/port conflict, login đủ bảy vai trò, RBAC API, creator gửi/HR duyệt, phân công recruiter, soạn/gửi duyệt, HR độc lập duyệt/xuất bản, preview=public DOM, mobile và không page error.

64 case Browser regression bao gồm tạo/sửa Requisition, lịch sử, ngân sách, assignment, posting, PAUSED/CLOSED/CANCELLED, flags ON/OFF và visual desktop/mobile. Trace đã khử token/mật khẩu test lưu tại thư mục TEMP ghi trong JSON; không đưa raw trace vào allowlist commit. Đây là technical visual test, không thay brand signoff.

## Kết quả từng suite

| Script | PASS | FAIL | Exit |
|---|---:|---:|---:|
| test:browser-e2e | 64 | 0 | 0 |
| test:user-list-batch | 16 | 0 | 0 |
| test:candidate-stage | 52 | 0 | 0 |
| test:s1-frontend-fixes | 18 | 0 | 0 |
| test:final-rbac-open | 33 | 0 | 0 |
| test:requisition-access | 16 | 0 | 0 |
| test:ats-e2e | 51 | 0 | 0 |
| test:rbac | 47 | 0 | 0 |
| test:s3-02 | 93 | 0 | 0 |
| test:s3-01 | 108 | 0 | 0 |
| test:postgres | 15 | 0 | 0 |
| test:review-updates | 22 | 0 | 0 |
| test:s1-01 | 8 | 0 | 0 |
| test:s1-02 | 5 | 0 | 0 |
| test:s1-03 | 5 | 0 | 0 |
| test:s1-03:email | 49 | 0 | 0 |
| test:s1-04 | 5 | 0 | 0 |
| test:s1-05 | 6 | 0 | 0 |
| test:s1-06 | 3 | 0 | 0 |
| test:s1-07 | 4 | 0 | 0 |
| test:s1-08 | 5 | 0 | 0 |
| test:s1-09 | 7 | 0 | 0 |
| test:s1-10 | 8 | 0 | 0 |
| test:otp | 8 | 0 | 0 |
| test:sprint2 | 32 | 0 | 0 |
| test:s2-10 | 59 | 0 | 0 |
| test:routing | 187 | 0 | 0 |
| test:user-ux | 87 | 0 | 0 |
| test:datetime-dashboard | 28 | 0 | 0 |
| test:avatar | 21 | 0 | 0 |
| test:mobile-shell | 53 | 0 | 0 |
| test:layout | 45 | 0 | 0 |
| test:coverage:sprint1 | 23 | 0 | 0 |
| test:coverage:sprint2 | 25 | 0 | 0 |
| test:career-upload | 24 | 0 | 0 |
| test:user-roles-avatar | 17 | 0 | 0 |
| test:sprint1 | 56 | 0 | 0 |
| test:reapproval | 94 | 0 | 0 |
| test:s3-03 | 29 | 0 | 0 |
| test:s3-04 | 55 | 0 | 0 |
| test:s3-05 | 36 | 0 | 0 |
| test:s3-06 | 46 | 0 | 0 |
| test:s3-07 | 51 | 0 | 0 |
| test:s3-08 | 27 | 0 | 0 |
| test:s3-09 | 41 | 0 | 0 |
| test:s3-10 | 53 | 0 | 0 |
| test:local-demo | 20 | 0 | 0 |
| test:postgres:startup | 11 | 0 | 0 |

Lượt cuối chạy `npm run test:local -- --all` (47 script), sau đó `npm run test:local -- test:postgres:startup` (script mới đăng ký). PostgreSQL startup là mock-adapter test, không phải bằng chứng kết nối PostgreSQL thật. SQLite và embedded PostgreSQL được kiểm tra trong các suite hiện hành; không gọi Neon hoặc live-test endpoint.

## An toàn dữ liệu và Git

19 hash SHA-256 trước/sau khớp. .env không đọc credential/ghi đè. Không kết nối Neon, seed/import production hoặc gửi SMTP thật. Không xoá/ẩn thay đổi có sẵn.

Allowlist chính xác: [ATS-localhost-files-to-commit.txt](ATS-localhost-files-to-commit.txt), gồm 87 file đề xuất. Danh sách chứa source/config/tests/docs cần cho cả Sprint 3 đang chưa commit và profile mới. Nếu chỉ commit local scripts nhưng thiếu module/migration Sprint 3 untracked, clone sẽ thiếu dependency.

Loại trừ: .env, node_modules, .local, bốn SQLite runtime, media người dùng, log và raw trace. Migration 001 đang modified từ trước bị loại khỏi allowlist; không stage/restore nó. SQL 006–008 untracked tồn tại trước task cần được bàn giao nguyên nội dung hiện tại. Không có migration mới.

Scan pending text phát hiện hai URI deliberately-invalid trong test_local_demo.js, phục vụ kiểm tra không kết nối; một URI test loopback ở harness cũ `docs/evidence/ATS-full-audit-2026-10-09-harness.txt` bị loại khỏi allowlist. Không phát hiện production secret mới trong phạm vi scan; vẫn review thủ công staged diff trước commit. Screenshot bàn giao chỉ dùng dữ liệu demo.

Các lệnh dưới đây chỉ là đề xuất để bạn tự chạy sau review; Codex chưa thực hiện:

```powershell
Set-Location A:\Projects\TTCS_T926_K3S4_N2
git status --short
git diff --check
$files = Get-Content docs/ATS-localhost-files-to-commit.txt
git add -- $files
git diff --cached --stat
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: prepare complete Sprint 1-3 localhost handover"
git push origin feature/s2-bulk-user-import
```

Kiểm tra staged name list trước commit: không .env/runtime DB/migration 001/raw trace. .gitignore không tự loại file đã được theo dõi. Không dùng git add . hoặc git add -A. Không merge/rebase hoặc đổi branch cho task này.

## Các điều kiện còn lại

Bàn giao GitHub chờ developer review/commit/push; mentor cần clone revision mới để xác minh máy thứ hai. Lượt thực thi dùng Node 24.18.0, chưa chạy lại với Node minimum 22.13. Chromium/dependency cần tải lần đầu. Email demo simulated không chứng minh real delivery; mentor không cần Neon credentials. Hai AC deferred giữ nguyên. Brand/UAT cần người có thẩm quyền ký; task này chỉ kết luận sẵn sàng kỹ thuật cho localhost.
