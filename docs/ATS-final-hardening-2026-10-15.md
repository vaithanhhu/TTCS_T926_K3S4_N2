# ATS Sprint 1–4 — Final hardening, 15/10/2026

## Phạm vi và kết luận

Báo cáo này bổ sung cho `ATS-deep-audit-2026-10-15.md` và `ATS-Git-safety-review-2026-10-15.md`. Không phải nghiệm thu production. HEAD giữ `e25732bd6bafb0b440663d9255670dbe8ba8cf43`, branch `fix/azure-profile-test-runner`.

**NOT READY FOR COMMIT trong trạng thái repository hiện tại.** Full regression đạt 62/62 script và Git safety cuối đạt 62/62 case, nhưng guard vẫn chặn index có chín database/backup, 16 ZIP evidence, hai literal ở phiên bản index cũ và một JSON lớn. Cần người dùng review/phê duyệt việc ngừng theo dõi và phân loại artifact trước khi hook có thể cho phép commit. Không dùng scheduler S4-08 hoặc grants PENDING làm lý do bắt buộc xây thêm tính năng. File evidence máy đọc ở ngoài repository: `C:\Users\Asus of Kien\Documents\Codex\ATS-final-hardening-20261015\final.json`.

## Kiểm thử cuối đã chạy

`npm.cmd run test -- --all`, source copy riêng mỗi script, môi trường SQLite/PGlite, email simulated: **62 script PASS, 0 FAIL, exit 0**. Log/results: `C:\Users\ASUSOF~1\AppData\Local\Temp\ats-local-regression-5ATM75\results.json`. Lệnh npm qua PowerShell alias ban đầu bị ExecutionPolicy chặn, chưa chạy test; dùng npm.cmd mà không đổi policy hệ thống.

| Suite | PASS / FAIL | Exit |
|---|---:|---:|
| Full Sprint 1–4 và tích hợp, 62 script | 62 / 0 script | 0 |
| Browser E2E | 65 / 0 | 0 |
| UI interface, năm viewport | 196 / 0 | 0 |
| Deep security, SQLite/PGlite | 40 / 0 | 0 |
| Deep security Chromium | 16 / 0 | 0 |
| RBAC | 47 / 0 | 0 |
| PostgreSQL startup harness | 11 / 0 | 0 |
| QA-S3-06 | 73 / 0 | 0 |
| P1 / P2 / P3 | 46 / 66 / 122 PASS, 0 FAIL | 0 từng suite |
| P4 / P5 / P6 | 72 / 112 / 65 PASS, 0 FAIL | 0 từng suite |
| Referral authorization | 43 / 0 | 0 |
| Git safety bản cuối, source copy độc lập | 62 / 0 | 0 |
| JavaScript syntax | 22 file, 0 lỗi | 0 |
| Shell syntax | 2 wrapper, 0 lỗi | 0 |
| Workflow YAML structure | PASS, chưa chạy trên GitHub | 0 |
| git diff --check | PASS | 0 |
| Guard trên index thật | Từ chối đúng thiết kế, 28 block | 1 |

Không cộng script tổng hợp `test:sprint1` với suite lẻ để tạo số unique test. Full runner lấy snapshot Git unit trước cập nhật archive guard; đã chạy lại **toàn bộ** Git unit trên bản cuối (62 case), không chỉ hai case mới. Fixture local-demo được xác minh trùng bản cuối trong source copy của full run. Không có business code thay đổi sau khi runner bắt đầu.

Manifest JSON audit hiện có 217 entry; đã đối chiếu checksum/path. Bổ sung `finalHardeningRegression` riêng, giữ kết quả lịch sử Jga2N7 61/61 thay vì trộn hai lượt thành một bằng chứng. Evidence kiểm tra secret, archive, source provenance và protected hashes nằm ngoài repository trong thư mục final-hardening nêu trên.

Baseline lượt này gồm 647 file hiện có ngoài `.git`/`node_modules`. Chỉ bảy file hiện có được chỉnh đúng phạm vi (hai sample/fixture, guard/unit, hai Markdown và ignored JSON audit); tạo thêm Markdown này. Không file cũ nào mất. Hash database/WAL/SHM, `.env`, migration, các file chứa P1–P6 và sáu test P1–P6 không đổi; HEAD, index và config không đổi. Đã cập nhật có kiểm tra hash duy nhất local hook guard do nhiệm vụ trước tạo. Không cài dependency vào workspace hoặc thay package/lockfile trong lượt hardening này.

## Sai lệch đã xử lý

1. Evidence full regression cũ dùng Nv9poY được thay bằng Jga2N7: 61 script, mọi exit code 0, mọi log tồn tại. Đã kiểm tra checksum toàn bộ manifest lịch sử; không sửa log. Bổ sung 62 checksum của results/log lượt hợp lệ. Giữ Nv9poY trong manifest như evidence lịch sử, không còn dùng làm kết quả cuối.
2. S1-05: xác minh server guard `role.read` trên cả bốn alias; fixture ADMIN có Bearer và negative tests 401/403, giữ assertions ma trận cũ. Server, test S1-05 và service bảo mật trùng source copy Jga2N7. Kiểm tra 14 file có sẵn trong đợt audit: 13 trùng sau chuẩn hóa line ending; riêng candidates.js khác hai label textContent đã được giải thích và có lượt Chromium/UI sau đó. Full runner mới kiểm tra source hiện tại.
3. Sửa mốc lịch sử audit thành `16 modified + 3 untracked + 1 ignored JSON`, không gán trạng thái đó cho workspace hiện tại. Backlog có 76 story tổng, 39 thuộc Sprint 1–4 và 37 story tương lai; sửa JSON từ 76 thành 37 future stories.
4. `.env.example`: đổi riêng SMTP_PASSWORD thành `CHANGE_ME`. Không khẳng định literal cũ là mật khẩu thật, không sửa `.env`, SMTP hoặc credential vận hành.
5. `test_local_demo.js`: hai URL cố ý trỏ loopback port 1 được đổi password fixture sang `CHANGE_ME`; giữ host/port/path, invalid DB provider và toàn bộ assertions. Không thử kết nối ngoài. Guard trước sửa nhận `CONNECTION_SECRET`, sau sửa không có issue.
6. Guard Git chặn ZIP trong `docs/evidence/` để yêu cầu review, kể cả blob nhỏ; không blanket-ban `.zip`, `.json`, `.sql` hoặc public certificates ở nơi khác. Bổ sung regression cho sample/fixture thực tế và archive nhỏ. Unit cuối 62/62, exit 0. Đồng bộ duy nhất bản standalone guard local đã được nhiệm vụ trước tạo, sau khi xác minh hash; không đổi wrapper, Git config/index/refs.

Không phát hiện bằng chứng lỗi nghiệp vụ mới buộc phải thay đổi các bản vá bảo mật đã có. Không sửa P1–P6, schema/migration, role/grant hoặc hành vi hợp lệ chỉ để đạt PASS. Không thêm comment vào code chỉnh sửa.

## Chín file tracked cần ngừng theo dõi

| File | Loại và dependency | Đánh giá |
|---|---|---|
| `.backup_sprint1/ats.db` | SQLite backup, không phải input nguồn được duyệt cho import | Không nên tracked; có nguy cơ chứa dữ liệu/authentication lịch sử |
| `backend/data/ats.db` | Database SQLite nghiệp vụ tại đường dẫn config hỗ trợ | Giữ nguyên file vật lý; ngừng theo dõi không có nghĩa xóa hoặc ngừng hỗ trợ SQLite |
| `backend/data/ats.db-wal` | WAL runtime, liên quan database đang sử dụng | Không commit riêng lẻ; không đụng/xóa/checkpoint trong nhiệm vụ này |
| `backend/data/ats.db-shm` | Shared-memory runtime | Không commit; không đụng file đang sử dụng |
| `backend/data/ats_test.db` | Database test runtime tại đường dẫn test config | Mỗi suite cô lập tự tạo dữ liệu; không dùng DB này làm fixture |
| `.backup_sprint1/frontend/css/style.css` | Source backup, không tự coi là secret | Trùng lịch sử source, dễ drift; không phải đường frontend chạy hiện hành |
| `.backup_sprint1/frontend/index.html` | Source backup | Không dependency runtime hiện hành được tìm thấy |
| `.backup_sprint1/frontend/js/api.js` | Source backup | Cần tránh code API cũ/credential mẫu bị tái dùng; giữ bản vật lý để chủ dự án review |
| `.backup_sprint1/frontend/js/app.js` | Source backup | Không cần phân phối trong clone mới; lịch sử source chính vẫn còn |

Config vẫn có thể dùng SQLite khi được chọn rõ; quy trình dev mặc định Azure không cần commit SQLite data. Runner loại data và tạo source copy mới. Không thấy production code tham chiếu `.backup_sprint1`. `.gitignore` đã phủ cả chín đường dẫn, nhưng ignore không gỡ file đã tracked.

**Chỉ đề xuất để người dùng duyệt và tự thực hiện, chưa chạy:**

```powershell
git rm --cached -- '.backup_sprint1/ats.db'
git rm --cached -- 'backend/data/ats.db'
git rm --cached -- 'backend/data/ats.db-wal'
git rm --cached -- 'backend/data/ats.db-shm'
git rm --cached -- 'backend/data/ats_test.db'
git rm --cached -- '.backup_sprint1/frontend/css/style.css'
git rm --cached -- '.backup_sprint1/frontend/index.html'
git rm --cached -- '.backup_sprint1/frontend/js/api.js'
git rm --cached -- '.backup_sprint1/frontend/js/app.js'
```

Cần review index hiện tại trước thao tác riêng này. Không thêm `-f`, không xóa file vật lý, không rewrite history. Nếu Git từ chối vì nội dung index/worktree khác nhau, dừng để phân tích thay vì ép lệnh. Dừng tracking không xóa dữ liệu đã nằm trong history; xử lý history/rotation cần nhiệm vụ và phê duyệt riêng.

## Secrets và artifacts

- Không có file staged. `.env`, private key và credential profile không nằm trong danh sách commit. Không đọc hoặc in giá trị secret.
- Kiểm tra 16 ZIP evidence tracked bằng đọc archive, không extract/chạy nội dung: 1.231 marker nhạy cảm (Authorization/Bearer/password/token), không tìm marker private key, không bỏ qua entry vì quá lớn trong lượt scan này. Đây là marker heuristic, không phải 1.231 credential độc lập hay bằng chứng credential production. Không thể công bố artifact an toàn; toàn bộ bị loại khỏi đề xuất commit và guard yêu cầu review.
- JSON evidence ignored được sửa metadata theo yêu cầu để đồng bộ Markdown; không tự force-add. JSON/ZIP tracked từ trước, bao gồm blob lớn, vẫn cần phân loại và kế hoạch ngừng theo dõi riêng nếu chứa dữ liệu không phù hợp. Không xóa/sửa chúng để guard PASS.
- Scan toàn bộ file modified/untracked đề xuất bằng path/content guard không thấy high-confidence secret. Warning ở test S1-05 là literal synthetic của fixture, không đổi assertion để che warning. Scan heuristic không chứng minh không còn mọi PII hoặc secret trong toàn lịch sử.
- Profile `%LOCALAPPDATA%\ATS\AzureStaging` ở ngoài repository nhưng không đọc được do access denied trong môi trường hiện tại: BLOCKED cho kiểm tra nội dung/ACL. Không diễn giải lỗi thành profile rỗng. Private key ngoài repository tồn tại; không mở/copy. Không thay quyền để đọc hoặc chỉnh profile.

## Bảo mật và RBAC

Đã đọc lại diff authentication/authorization, OTP purpose/atomic claim, reset-token recheck sau khóa, vô hiệu toàn bộ reset links và sessions, Offer ACCEPTED chỉ từ SENT, duplicate application/referral, rollback CV, rate-limit socket peer và transaction, upload format, public HTTP errors và HTML sinks. Bằng chứng hồi quy nằm ở suite mới và các suite P1–P6/Sprint 1–4.

50 permission codes đã có trong ma trận audit. Đây là catalog/source matrix và fixture verification, không phải chứng nhận 50 permission đều có mọi grant/scope đúng trên Azure. Các test ADMIN/RBAC, role matrix aliases, resource scope và P1–P6 chứng minh các trường hợp đã chạy; route observations không có resource assertion vẫn UNVERIFIED. Không nâng trạng thái generic matrix thành MATCH toàn bộ role–resource–state.

Giữ nguyên 72 grants nguồn, `HIRING_MGR → interview.evaluate`, 62 grant đề xuất chưa duyệt và 7 mục reconciliation PENDING theo chính sách. Không kết nối Azure nên trạng thái grants thực tế trên server là UNVERIFIED trong lượt này. Scheduler S4-08 vẫn BLOCKED theo quyết định riêng; không phải điều kiện buộc phải triển khai để commit các bản vá hiện tại.

## Git và GitHub

Bốn lệnh Sprint giữ fail-closed: start/sync/push cần tree sạch; không stash/merge/rebase tự động; push khóa remote origin và branch hiện hành, từ chối force/refspec bổ sung; hook kiểm actual destination, nhiều ref và non-fast-forward. Các test nguy hiểm chỉ dùng mock Git/thư mục tạm, không push hoặc merge thật.

Không thể phát hiện riêng cờ force trong hook nếu actual update vẫn fast-forward; không nói local hook ngăn được `--no-verify`. Script từ chối force arguments; bảo vệ remote vẫn bắt buộc. Hook installer không ghi đè hook ngoại lai/core.hooksPath. Local standalone guard bằng source hardening cuối; index/config/HEAD/refs không thay đổi.

GitHub CLI không có trong PATH; public API rulesets/protection không truy cập được qua công cụ hiện tại. Remote protection **UNVERIFIED**, không kết luận repository đang không được bảo vệ. Không sửa GitHub settings.

Quản trị cần vào Settings → Rules → Rulesets → branch ruleset, chọn main/develop, Active; require PR và ít nhất một review độc lập, dismiss stale reviews, resolve conversations, require status checks `git-safety`/`isolated-regression` sau khi workflow thực sự chạy ổn định, restrict deletions, block force pushes, giới hạn bypass. Có thể dùng Branch Protection tương đương và áp dụng cả administrators. Không bật Restrict updates cho mọi người nếu chưa thiết kế actor bypass vì có thể chặn cả tích hợp hợp lệ. [Nguồn GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

Workflow mới chưa chạy trên GitHub; vẫn sẽ FAIL vì legacy tracked files. Actions dùng tag v4, cần pin SHA theo policy supply chain nếu nhóm yêu cầu. Chưa có danh tính chủ module để gán CODEOWNERS.

## Danh sách đề xuất commit theo phạm vi

### Security audit — 19 file, review riêng hunks package.json

```text
backend/src/controllers/candidatePortalController.js
backend/src/server.js
backend/src/services/authService.js
backend/src/services/candidatePortalService.js
backend/src/services/emailService.js
backend/src/services/requisitionService.js
backend/tests/test_s1_05_integration.js
backend/tests/test_deep_audit_security.js
backend/tests/test_deep_audit_browser.js
frontend/js/api.js
frontend/js/components/interview-dialogs.js
frontend/js/components/offer-dialogs.js
frontend/js/pages/candidates.js
frontend/js/pages/dashboard.js
frontend/js/pages/interviews.js
frontend/js/pages/offers.js
frontend/js/pages/reports.js
package.json
docs/ATS-deep-audit-2026-10-15.md
```

### Git safety/hardening — 15 file, có chung package.json

```text
.env.example
.gitignore
.gitattributes
.githooks/pre-commit
.githooks/pre-push
.github/workflows/ats-git-safety.yml
scripts/git-safety.js
scripts/install-git-hooks.js
backend/tests/run_local_tests.js
backend/tests/test_git_safety.js
backend/tests/test_local_demo.js
package.json
docs/ATS-Git-workflow.md
docs/ATS-Git-safety-review-2026-10-15.md
docs/ATS-final-hardening-2026-10-15.md
```

Tổng 33 đường dẫn duy nhất. Đây là allowlist đề xuất sau review, không tự stage. Chia package.json theo hunks đã kiểm tra; không rollback hoặc ghi đè thay đổi của nhóm. Gợi ý commit: `fix(security): harden ATS Sprint 1-4 authorization and workflows`, sau đó `chore(git): enforce safe collaboration and sensitive-file checks`.

Không đưa `.env`, DB/WAL/SHM, ZIP/JSON artifact chưa duyệt, private key/profile, node_modules, logs/temp, local hooks trong `.git` hoặc history changes vào hai commit. JSON audit ignored giữ ngoài commit, evidence redacted ngoài repository. Việc gỡ chín tracked files và artifact cần phê duyệt riêng trước khi hook cho phép commit; không tự thực hiện trong lượt này.

## Giới hạn nghiệm thu

Native PostgreSQL 16/Azure và SMTP delivery thật: NOT RUN trong lượt này, không kết nối DB thật. PO/UAT, visual signoff, instrumented branch coverage và mọi tổ hợp RBAC/resource: UNVERIFIED. Không gọi PGlite là multi-connection PostgreSQL proof. Các giới hạn này không được che bằng kết quả regression local.

## Archive paths requiring separate review

- `docs/evidence/ATS-final-acceptance-browser/trace-ADMIN.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-APPROVER.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-CANDIDATE.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-HIRING_MGR.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-HR_MANAGER.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-INTERVIEWER.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-PUBLIC.zip`
- `docs/evidence/ATS-final-acceptance-browser/trace-RECRUITER.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-ADMIN.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-APPROVER.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-CANDIDATE.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-HIRING_MGR.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-HR_MANAGER.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-INTERVIEWER.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-PUBLIC.zip`
- `docs/evidence/ATS-readiness-2026-10-09-browser/trace-RECRUITER.zip`
