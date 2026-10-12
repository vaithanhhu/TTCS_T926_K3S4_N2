# Khắc phục hồi quy sau Sprint 4 — 12/10/2026

Branch `feature/s2-bulk-user-import`, HEAD `5114796b130a30d354a0e279ed4ef8960a495a32`; giữ nguyên branch/HEAD. So sánh source `f440a6c..5114796` và tái hiện trước khi sửa.

## Kết luận

Ba suite từng FAIL đã PASS; 49 script regression có exit code 0. Không còn lỗi trong các suite có thể chạy cách ly. Không tuyên bố UAT hoặc brand signoff thay người dùng.

## Nguyên nhân và bản sửa

**A/B — lỗi ứng dụng, không phải thiếu grant hoặc selector sai.** Sprint 4 đổi helper từ `(token,path,method,body)` thành `(token,requisitionId,id,method,body)` trong khi component S3-09 và backend không đổi contract. GET context tạo URL chứa `requisitions%2F...`, controller hiểu cả chuỗi đó là posting ID rồi trả 404. Form vì vậy không render nút tạo. POST/PUT cũng lệch tham số: verb bị xem là ID, body bị xem là method và payload không còn đúng. Khôi phục helper theo call sites/backend hiện hành; giữ token, cache, error response và quyền.

**A/public — lỗi dây chuyền và một lỗi độc lập.** Không tạo được bản nháp nên `postingId` chưa có giá trị, request chi tiết không hợp lệ và bài public timeout. Ngoài ra template chi tiết Sprint 4 không có article `data-public-job` dùng chung với preview; chỉ sửa API chưa đủ.

**C — phân biệt môi trường test và hồi quy ứng dụng.** DOM mô phỏng có `children`/`appendChild` nhưng không có getter `lastElementChild`, nên phát sinh TypeError dòng 294. Native Chromium có getter này; không kết luận đây là native-browser TypeError. Tuy nhiên template public riêng của Sprint 4 thực sự phá yêu cầu S3-10 preview=public và bỏ marker article. Dùng lại `ATS_PUBLIC_JOB_RENDERER.render`, không tạo renderer mới hoặc catch để che lỗi. Các nút ứng tuyển, modal, quay lại, tìm kiếm/lọc và phân trang Sprint 4 được giữ. CTA đầu trang nằm ngoài article dùng chung và giữ vị trí bằng flex order; CTA dưới bài vẫn hoạt động.

Khôi phục marker của nút chi tiết listing để Browser E2E cũ vẫn nhận diện đúng tin. Đổi clear node rỗng sang `textContent` (cùng tác dụng trên native DOM, có hỗ trợ ở harness) để tin bị gỡ không còn node cũ. Empty icon giữ tham chiếu trực tiếp; không phụ thuộc firstElementChild. Không sửa mock DOM hoặc làm yếu assertion.

## File và vị trí

- `frontend/js/api.js:1572`: khôi phục chữ ký/path/method/body helper.
- `frontend/js/pages/public-jobs.js:93,122,141,218,249`: clear/empty state, marker listing, renderer chung và application controls.
- `backend/tests/test_s3_08_09.js:54`: thêm case GET context/detail và PUT draft, bảo toàn source Requisition.
- `backend/tests/test_s3_10.js:41`: thêm case application buttons/modal/validation nằm ngoài article preview, invalid form không submit.
- `backend/tests/test_local_demo.js:177`: bổ sung native-browser kiểm tra modal, job ID, 4 lỗi validation và đóng modal.
- Báo cáo Markdown này và JSON evidence mới; toàn bộ evidence cũ giữ nguyên.

Không sửa backend, service, permission, API endpoint, schema, migration, dependency hoặc feature flags. Không thay policy/state/approval/budget/candidate logic. Các assertion cũ giữ nguyên; chỉ thêm test mạnh hơn. S3-09 tăng 41 lên 42 case; S3-10 tăng 53 lên 54 case.

## Kết quả trước/sau

| Suite | Trước | Sau | Exit sau |
|---|---|---|---:|
| test:local-demo | 17 PASS / 3 FAIL | 20/20 PASS | 0 |
| test:s3-09 | 40 PASS / 1 FAIL | 42/42 PASS | 0 |
| test:s3-10 | Runtime fatal, exit 1; chưa hoàn tất | 54/54 PASS | 0 |

Lượt thử vá đầu tiên khôi phục parity nhưng còn case anonymous/stale-content fail do mock innerHTML không clear children; đã chuyển clear node sang textContent và chạy lại. Không che thất bại trung gian. Log baseline và final được ghi trong JSON.

## Toàn bộ regression

Lệnh cuối: `npm run test:local -- --all`. Runner tạo source/DB riêng từng script, loại .env và runtime DB; email simulated. `test:s4` có thao tác xóa SQLite test DB nhưng chỉ chạy trong bản sao TEMP.

| Script | PASS | FAIL | Đơn vị | Exit |
|---|---:|---:|---|---:|
| `test:browser-e2e` | 64 | 0 | checks | 0 |
| `test:user-list-batch` | 16 | 0 | checks | 0 |
| `test:candidate-stage` | 52 | 0 | checks | 0 |
| `test:s1-frontend-fixes` | 18 | 0 | checks | 0 |
| `test:final-rbac-open` | 33 | 0 | checks | 0 |
| `test:requisition-access` | 16 | 0 | checks | 0 |
| `test:ats-e2e` | 51 | 0 | checks | 0 |
| `test:rbac` | 47 | 0 | checks | 0 |
| `test:s3-02` | 93 | 0 | checks | 0 |
| `test:s3-01` | 108 | 0 | checks | 0 |
| `test:postgres` | 15 | 0 | checks | 0 |
| `test:review-updates` | 22 | 0 | checks | 0 |
| `test:s1-01` | 8 | 0 | checks | 0 |
| `test:s1-02` | 5 | 0 | checks | 0 |
| `test:s1-03` | 5 | 0 | checks | 0 |
| `test:s1-03:email` | 49 | 0 | checks | 0 |
| `test:s1-04` | 5 | 0 | checks | 0 |
| `test:s1-05` | 6 | 0 | checks | 0 |
| `test:s1-06` | 3 | 0 | checks | 0 |
| `test:s1-07` | 4 | 0 | checks | 0 |
| `test:s1-08` | 5 | 0 | checks | 0 |
| `test:s1-09` | 7 | 0 | checks | 0 |
| `test:s1-10` | 8 | 0 | checks | 0 |
| `test:otp` | 8 | 0 | checks | 0 |
| `test:sprint2` | 32 | 0 | checks | 0 |
| `test:s2-10` | 59 | 0 | checks | 0 |
| `test:routing` | 188 | 0 | checks | 0 |
| `test:user-ux` | 87 | 0 | checks | 0 |
| `test:datetime-dashboard` | 28 | 0 | checks | 0 |
| `test:avatar` | 21 | 0 | checks | 0 |
| `test:mobile-shell` | 53 | 0 | checks | 0 |
| `test:layout` | 45 | 0 | checks | 0 |
| `test:coverage:sprint1` | 23 | 0 | checks | 0 |
| `test:coverage:sprint2` | 25 | 0 | checks | 0 |
| `test:career-upload` | 24 | 0 | checks | 0 |
| `test:user-roles-avatar` | 17 | 0 | checks | 0 |
| `test:sprint1` | 56 | 0 | checks | 0 |
| `test:reapproval` | 94 | 0 | checks | 0 |
| `test:s3-03` | 29 | 0 | checks | 0 |
| `test:s3-04` | 55 | 0 | checks | 0 |
| `test:s3-05` | 36 | 0 | checks | 0 |
| `test:s3-06` | 46 | 0 | checks | 0 |
| `test:s3-07` | 51 | 0 | checks | 0 |
| `test:s3-08` | 27 | 0 | checks | 0 |
| `test:s3-09` | 42 | 0 | checks | 0 |
| `test:s3-10` | 54 | 0 | checks | 0 |
| `test:local-demo` | 20 | 0 | checks | 0 |
| `test:postgres:startup` | 11 | 0 | checks | 0 |
| `test:s4` | 9 | 0 | User Story | 0 |

Tổng 1771 lượt check PASS, 0 FAIL; riêng Sprint 4 báo 9/9 User Story (suite không xuất bộ đếm assertion). Có 56 lượt Sprint 1 lặp từ aggregate; không gọi tổng này là số case/AC độc lập.

Browser Chromium thực: 64/64 PASS, desktop/mobile, preview/public, lifecycle, flags và runtime errors; local demo 20/20 gồm bổ sung modal ứng tuyển Sprint 4. Screenshot/trace sanitized nằm trong thư mục TEMP của lượt chạy, không ghi đè ảnh/evidence cũ.

node --check: 159/159 PASS; git diff --check PASS. SQLite/PGlite parity chạy trong các suite. PostgreSQL live và Neon NOT RUN: không thuộc kiểm thử cách ly được phép trong task này.

## An toàn dữ liệu và Git

117/117 file bảo vệ không đổi SHA-256: bốn SQLite runtime, 17 SQL migrations 001–009 và 96 file evidence đã có trước task. Dữ liệu gốc không reset/restore/delete; không kết nối, seed, migrate hoặc đồng bộ Neon. .env không sửa; không gửi SMTP thật. Chỉ năm file code/test trên thay đổi so với snapshot đầu task, cộng hai báo cáo mới.

Git status đầy đủ và hash trước/sau trong [JSON](evidence/ATS-Sprint4-regression-fixes-2026-10-12.json). Các DB và migration 001 vẫn modified từ trước; không đưa chúng vào bản sửa này. Không stage, commit, push, merge, switch branch hoặc tạo PR.

## Đề xuất Git/PR để người dùng thực hiện

Branch đề xuất: `fix/s4-job-posting-regressions`. Commit message: `fix: restore Sprint 3 job posting flows after Sprint 4`.

PR title: **Restore job draft API compatibility and shared public preview after Sprint 4**.

PR body đề xuất:

Sprint 4 thay chữ ký frontend draft helper nhưng không cập nhật call sites/controller, làm context 404 và form tạo tin không xuất hiện. Bản sửa khôi phục GET/POST/PUT contract hiện hành. Public detail dùng lại renderer chung với preview; các thao tác ứng tuyển Sprint 4 giữ riêng và được kiểm tra bằng VM/native Chromium.

Validation: local-demo 20/20, S3-09 42/42, S3-10 54/54, Sprint 4 9/9 stories; toàn bộ 49 script regression exit 0, Browser E2E 64/64, node syntax và diff check PASS. Không thay RBAC/schema/production data; hash runtime/migration/evidence cũ không đổi. Giữ toàn bộ assertion cũ và bổ sung test API PUT cùng application-form validation.

## Rủi ro còn lại

Không có FAIL trong lượt final. Sửa cách dùng renderer khôi phục bố cục nội dung chung preview/public; không cam kết giữ pixel của template public tách riêng đã gây hồi quy. Technical responsive được Chromium kiểm chứng; brand/UAT cần người có thẩm quyền. PostgreSQL live/Neon không chạy, không suy diễn từ PGlite. Không sửa bất kỳ vấn đề nghiệp vụ ngoài ba lỗi và tích hợp bắt buộc của chúng.
