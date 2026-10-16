# Kiểm tra quy trình Git ATS — 15/10/2026

Lưu ý cập nhật final hardening: literal SMTP trong `.env.example` đã đổi thành `CHANGE_ME`; hai URL loopback không thể kết nối trong `test_local_demo.js` đã dùng placeholder rõ ràng. Unit regression bổ sung kiểm tra chính các file này. Đây chỉ là sửa worktree; index cũ không thay đổi nên guard trên index vẫn có thể báo phiên bản cũ. Kết quả cuối và danh sách commit được tổng hợp tại `ATS-final-hardening-2026-10-15.md`; các kết quả bên dưới là mốc nghiệm thu Git safety trước cập nhật này.

## Kết luận

**NOT READY** cho commit/push trong trạng thái repository hiện tại. Cơ chế local đã triển khai và kiểm thử; các database/backup đang tracked và một số nội dung cần phân loại vẫn bị guard chặn. Không tự xóa, untrack, sửa lịch sử hoặc thay credential để vượt kiểm tra. Bảo vệ remote chưa được xác minh hoặc cấu hình.

## Hiện trạng và phạm vi

Workspace `A:\Projects\TTCS_T926_K3S4_N2`, branch `fix/azure-profile-test-runner`, HEAD `e25732bd6bafb0b440663d9255670dbe8ba8cf43`. Ban đầu có 16 modified và 3 untracked entries, cùng các file ignored. Không dùng branch/HEAD dự kiến từ nhiệm vụ cũ làm giả định.

Đã lưu danh sách và SHA-256 của 638 file hiện có ngoài `.git`/`node_modules` trong evidence ngoài repository. Các bản vá kiểm toán Sprint 1–4 được giữ nguyên. Ba file hiện có được sửa trong nhiệm vụ này: `.gitignore`, `package.json` (chỉ thêm sáu script Git), `backend/tests/run_local_tests.js` (copy thêm script/hook templates vào môi trường test). Các script có sẵn, dependency và lockfile không thay đổi bởi nhiệm vụ này.

## Cơ chế trước và sau

Trước nhiệm vụ chưa có bốn lệnh Sprint, hook templates hoặc workflow bảo vệ tương ứng; `core.hooksPath` chưa cấu hình và chỉ có sample hooks. Đã kiểm tra trước khi cài hook mới.

| Hạng mục | Kết quả |
|---|---|
| Bảo vệ branch local | PASS trong mock; từ chối đích main/develop, multi-ref, xóa branch, non-fast-forward, remote sai |
| Bảo vệ branch GitHub | UNVERIFIED; cần quản trị cấu hình require PR, reviews/checks và cấm force/deletion |
| Phát hiện file nhạy cảm | PASS trong test; repository thực tế FAIL vì file tracked cũ |
| Phân chia module | Có hướng dẫn và yêu cầu review/integration; chưa gán CODEOWNERS vì chưa có danh tính chủ module |
| sprint:start | SAFE theo mock: cần tree sạch, fetch thành công rồi mới tạo/chuyển nhánh khi người dùng gọi |
| sprint:sync | SAFE theo mock: kiểm tra sạch, fetch/kiểm ancestry; không tự merge, rebase hoặc stash |
| sprint:check | SAFE, chỉ đọc; kiểm branch, trạng thái Git, toàn bộ index và nội dung nhạy cảm |
| sprint:push | SAFE theo mock: chỉ origin chuẩn và branch hiện hành, không nhận force/refspec bổ sung; hiển thị URL PR develop |

Hook pre-push kiểm stdin ref updates thực tế nên chặn `HEAD:develop` và nhiều ref. Hook không nhận biết riêng cờ `--force` nếu kết quả vẫn fast-forward; script Sprint từ chối mọi đối số force và hook từ chối non-fast-forward. Local hook có thể bị bỏ qua bằng no-verify hoặc thay cấu hình, vì vậy không thay thế Ruleset phía GitHub.

Hook installer từ chối hooksPath tùy chỉnh hoặc hook khác nội dung. Cài hai wrappers và bản guard độc lập vào hooks directory hiện hành, không thay Git config/index/refs. Bản guard độc lập phục vụ cả worktree/branch chưa có script trong source. Cập nhật policy khác phiên bản cần review, không âm thầm ghi đè hook. Ba file này là cài đặt local, không nằm trong danh sách commit.

## Những điểm chặn thực tế

- Database tracked: `.backup_sprint1/ats.db`, `backend/data/ats.db`, `backend/data/ats.db-wal`, `backend/data/ats.db-shm`, `backend/data/ats_test.db`.
- Backup source tracked: `.backup_sprint1/frontend/css/style.css`, `.backup_sprint1/frontend/index.html`, `.backup_sprint1/frontend/js/api.js`, `.backup_sprint1/frontend/js/app.js`.
- `.env.example`: SMTP_PASSWORD chứa literal chưa được nhận diện là placeholder an toàn. Chưa kết luận đó là credential thật; cần review riêng, không xuất giá trị.
- `backend/tests/test_local_demo.js`: hai URL PostgreSQL loopback có literal credential bị chặn. Có thể là fixture; cần phân loại và giải pháp hẹp được review, không whitelist toàn bộ tests.
- JSON nghiệm thu lớn và trace ZIP tracked trong `docs/evidence/ATS-final-acceptance*`, `docs/evidence/ATS-readiness-2026-10-09-browser/` cần kiểm tra dữ liệu trước khi cho phép. Không coi archive là an toàn chỉ dựa extension.
- Gitlink `.Agent/hallmark` cần cơ chế riêng trong repository con.

Lịch sử local có commit chứa database/backup. Có rủi ro lộ dữ liệu cá nhân, hash/token lưu trong DB; không mở dữ liệu để xuất ra báo cáo. Kiểm tra đường dẫn lịch sử không chứng minh lịch sử sạch secrets. Không tự rewrite history hoặc rotate secret.

Ignored inventory phân loại: 1 env, 18 runtime, 1 evidence và 3.100 node_modules entries. Không đưa những file này vào đề xuất commit. Scanner không chứng minh mọi archive, mọi dạng secret hay PII đều được phát hiện; warning literal cần con người phân loại.

## Kiểm thử thực tế

| Lệnh/suite trong source copy cô lập | PASS/FAIL | Exit |
|---|---:|---:|
| `node backend/tests/test_git_safety.js` — bản cuối | 60/0 | 0 |
| `node backend/tests/test_rbac_admin.js` | 47/0 | 0 |
| `node backend/tests/test_frontend_routing.js` | 189/0 | 0 |
| `node backend/tests/test_postgres_startup.js` | 11/0 | 0 |

Tên entry point chính xác của các suite regression và log nằm trong evidence ngoài repository. Git nguy hiểm được MOCK: không add/commit/push/merge/reset thật trên bất kỳ repository test nào. Bao phủ offline, conflict, dirty tree, tracked secret chưa staged, secret trong intermediate commit, UTF-16/private key, renamed SQLite, sample an toàn, installer từ chối ghi đè và cài lại idempotent.

Đã dùng chính hàm copySource/linkDependencies của runner để tạo source copy, xác minh không mang `.git`, `.env` hoặc DB nghiệp vụ sang. Không chạy setup:local, không cài/nâng dependency. Regression là SQLite/PGlite/mock theo suite, không phải PostgreSQL Azure/native. Full Sprint 1–4 và Browser E2E: NOT RUN trong nhiệm vụ Git này; không lấy kết quả cũ làm PASS mới.

Syntax bốn file JavaScript, syntax hai shell wrappers và YAML structural parse đạt. `git diff --check` đạt; Git có cảnh báo LF/CRLF ở một số file dirty cũ, không phải lỗi whitespace mới. Guard kiểm repository thực tế trả exit 1 theo thiết kế vì các điểm chặn trên; đây không phải unit test PASS giả.

Evidence: `C:\Users\Asus of Kien\Documents\Codex\ATS-git-safety-20261015\` gồm `before.json`, `final.json`, `git-safety-final.log`, `regression.json`, `rbac.log`, `routing.log`, `postgres-startup.log`, `check-final.log`, `ignored-inventory.json`. Không chứa nội dung secret hoặc database nguồn.

## File đề xuất cho một thay đổi Git safety

1. `.gitignore`
2. `.gitattributes`
3. `.githooks/pre-commit`
4. `.githooks/pre-push`
5. `.github/workflows/ats-git-safety.yml`
6. `scripts/git-safety.js`
7. `scripts/install-git-hooks.js`
8. `package.json` — chỉ sáu script Git mới, không vô tình gộp hunks kiểm toán cũ
9. `backend/tests/run_local_tests.js`
10. `backend/tests/test_git_safety.js`
11. `docs/ATS-Git-workflow.md`
12. `docs/ATS-Git-safety-review-2026-10-15.md`

Danh sách này là đề xuất, chưa stage. Các file kiểm toán cũ cần review riêng. Evidence ngoài repository, hooks local, `.env`, DB/runtime, node_modules, credentials và artifact chưa kiểm tra không được đưa vào commit.

## Việc quản trị cần làm

Xử lý các file tracked nhạy cảm theo phương án được phê duyệt; nếu xác minh secret thật đã lộ, lập kế hoạch rotation/history riêng. Sau đó cấu hình GitHub Ruleset cho main/develop: require PR, reviewer độc lập, dismiss stale approvals, resolve conversations, required checks sau khi workflow thực sự chạy ổn định, cấm force/deletion và hạn chế bypass kể cả quản trị. Workflow mới chưa chạy trên GitHub và hiện sẽ chặn legacy files. Actions đang dùng tag v4, cần pin SHA theo chính sách supply chain trước khi áp dụng yêu cầu nghiêm ngặt. Không tự gán CODEOWNERS khi chưa có chủ module được xác nhận.

Tham khảo chính thức: [GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection).

Không thực hiện add/commit/push/merge/rebase/reset/restore/stash/clean, không chuyển branch/remote, không thay database, Azure/Neon, credentials hoặc môi trường. Không bảo đảm 100% không conflict; module/shared-file review và integration tests vẫn bắt buộc.
