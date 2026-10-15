# Quy trình Git an toàn cho nhóm ATS

## Phạm vi và trạng thái

Mọi thay đổi đi qua nhánh công việc và Pull Request vào `develop`. `main` nhận release qua Pull Request. Không push trực tiếp, force-push, xóa nhánh được bảo vệ hoặc push nhiều ref qua công cụ Sprint.

Guard local không phải bảo vệ remote. `--no-verify`, sửa hook hoặc dùng máy chưa cài hook có thể bỏ qua lớp local. Người quản trị phải bật GitHub Rulesets/Branch Protection; tài liệu này không khẳng định remote đã được bảo vệ.

Snapshot nguồn trước nhiệm vụ: branch `fix/azure-profile-test-runner`, HEAD `e25732bd6bafb0b440663d9255670dbe8ba8cf43`, các bản vá kiểm toán đang dirty. Không chạy start/sync/push trên trạng thái đó. `sprint:check` chỉ đọc và được phép chạy khi dirty.

## Cài hooks trên từng clone

Chạy `npm run git:hooks`. Installer kiểm tra `core.hooksPath` ở mọi scope và hook đang có; dừng nếu gặp cấu hình hoặc file khác. Không thay Git config, index, refs hoặc remote; không ghi đè hook hiện có. Hai wrapper và bản sao standalone `ats-git-safety.js` được cài vào hooks directory do `git rev-parse --git-path hooks` trả về. Worktree có thể dùng chung hooks với repository chính, vì vậy phải phối hợp trước khi cài. Hook gọi guard đã cài, dùng working directory của thao tác Git, không hardcode đường dẫn Windows và không đòi branch/worktree cũ phải có scripts mới. Chuyển branch không làm mất bản guard đã cài. Nếu policy source thay đổi, installer từ chối ghi đè bản khác; review và cập nhật hooks riêng thay vì xóa hook tùy ý.

Clone mới cần cài lại hooks; không tự cài trong postinstall/prepare. Hook chạy với Node trên PATH. Thiếu Node/Git hoặc lỗi kiểm tra đều phải dừng commit/push. `.gitattributes` giữ LF cho shell wrappers.

## Bốn lệnh Sprint

| Lệnh | Hành vi | Điều kiện từ chối |
|---|---|---|
| `npm run sprint:start -- feature/auth-short-task` | Fetch đúng origin/develop rồi tạo nhánh mới; không setup DB | Dirty/untracked, conflict hoặc Git operation đang dở, branch không hợp lệ, remote sai, index có file bị cấm, fetch lỗi |
| `npm run sprint:sync` | Chỉ fetch develop và kiểm tra quan hệ ancestor | Nếu develop chưa được tích hợp thì exit 1, yêu cầu review tích hợp thủ công; không tự merge/rebase/stash |
| `npm run sprint:check` | Kiểm tra nhánh, toàn bộ index (kể cả tracked không staged), untracked chưa ignore, nội dung nhạy cảm | Main/develop/detached, conflict, file cấm, secret hoặc blob/link cần review |
| `npm run sprint:push` | Chỉ push `origin HEAD:refs/heads/<nhánh-hiện-tại>`; sau thành công in URL tạo PR vào develop | Dirty, trạng thái Git không an toàn, remote không đúng, extra arguments/refspec/force flags, non-FF hoặc remote base chưa có local, file nhạy cảm hiện tại/lịch sử outgoing |

Nhánh hợp lệ: `feature/`, `fix/`, `hotfix/`, `chore/`, `docs/`, `test/`, `refactor/` kèm tên module/task. Start được gọi rõ ràng từ main/develop sạch để tạo nhánh mới; không ghi vào hai nhánh đó. Không chạy đồng thời các lệnh thay đổi Git trên cùng worktree.

Push hook kiểm tra ref đích thật từ stdin, do đó `HEAD:develop`, `feature/x:main`, xóa protected branch và multi-ref đều bị chặn. Hook cũng chặn non-fast-forward; nó không nhìn thấy cờ `--force` nếu cập nhật thực chất vẫn fast-forward. Sprint script từ chối mọi extra argument nên không có đường truyền force flag qua script. Server phải chặn force push phía remote.

Nếu remote không truy cập được, script trả exit khác 0, không đổi sang remote khác và không tự bỏ kiểm tra. Nếu remote head chưa có trong object store local, fetch/review riêng rồi thử lại; không force để vượt qua. Push bị race với remote update sẽ do Git/server từ chối, không tự retry bằng force.

Không có lệnh tự commit, tự add, tự stash, tự merge hoặc tự chạy `setup:local`. Khi sync báo divergence, người thực hiện tự review phương án tích hợp và conflict, bảo vệ mọi thay đổi trước khi quyết định thao tác Git thủ công.

## File, secrets và dữ liệu runtime

`.gitignore` không bỏ tracking các file đã commit. Pre-commit chỉ quét các file thêm/sửa/đổi kiểu và đích đổi tên được stage, đọc toàn bộ blob từ index thay vì worktree hoặc chỉ dòng thêm. File xóa khỏi index không bị quét nội dung cũ; file nhạy cảm được thêm trở lại vẫn bị chặn. Đổi tên được xử lý như xóa nguồn và thêm đích để kiểm tra cả đường dẫn lẫn nội dung đích. Vì vậy có thể commit dọn repository dù còn finding legacy ngoài staged diff. `sprint:check`, CI và pre-push vẫn quét toàn bộ index; kiểm tra outgoing còn quét các commit để phát hiện secret thêm rồi xóa ở commit sau. Cho phép cleanup commit không đồng nghĩa repository hoặc lần push tiếp theo đã đạt security review. Với nhánh mới, outgoing được xác định bảo thủ theo remote refs đang có local; không đảm bảo local remote-tracking refs đã mới. Dừng nếu base không xác minh được hoặc có hơn 200 commit cần review.

Chặn database SQLite kể cả WAL/SHM/journal, backup/dump, runtime data/media, log, credential store, private key và các secret có độ tin cậy cao. SQLite header được kiểm tra để bắt file đổi đuôi. JSON/SQL/public certificate không bị cấm chỉ vì extension. `.env.example`/sample/template được phép nếu nội dung không chứa secret thật; biến TTL không phải mật khẩu. `.env` đang sử dụng bị ignore và không được đọc để in ra console.

Literal credential không đủ căn cứ được cảnh báo bằng mã và tên file, không in giá trị. Cần review cảnh báo trước khi commit. Static scanner không thay secret scanning chuyên dụng và không bảo đảm bắt mọi encoding, archive, PII hoặc secret tùy ý. Blob mới lớn hơn 2 MiB và symlink vẫn yêu cầu review; không tự xóa. Blob lớn được miễn chặn theo kích thước khi chính blob SHA đó nằm trong cây tip hiện tại của nhánh cùng tên trên origin đã xác minh URL: guard truy vấn ls-remote trực tiếp, kiểm tra commit object/tree theo SHA trả về và truy vấn lại để phát hiện tip thay đổi. Không dùng remote-tracking ref cũ hoặc chỉ quan hệ ancestor làm bằng chứng. Vẫn quét toàn bộ nội dung và áp dụng mọi quy tắc đường dẫn, database, credential/private key; byte NUL không miễn content scan. Không có remote branch thì blob được coi là mới; remote không truy cập được, thiếu object/tree local hoặc HEAD detached không xác định được nhánh thì từ chối ngoại lệ, không tự fetch hay cập nhật refs. CI detached cần có thiết kế xác minh nhánh riêng trước khi áp dụng ngoại lệ này; không dùng biến môi trường để tự khai SHA tin cậy. File quá lớn vượt giới hạn đọc 64 MiB của công cụ Git hiện tại cũng không được cho qua âm thầm. Gitlink/submodule chỉ được cảnh báo vì nội dung nằm ở repository khác; phải áp dụng guard và kiểm toán riêng cho submodule.

### Vi phạm legacy đã xác minh

Năm file database vẫn tracked: `.backup_sprint1/ats.db`, `backend/data/ats.db`, `backend/data/ats.db-wal`, `backend/data/ats.db-shm`, `backend/data/ats_test.db`. Ngoài ra có source backup trong `.backup_sprint1/` và artifact JSON/trace ZIP lớn đã tracked. Guard chủ động dừng; đây không phải test lỗi. Không gỡ tracking, xóa hoặc rewrite history tự động. Maintainer phải review từng file, bảo toàn bản ngoài repository rồi phê duyệt phương án xử lý riêng. Không dùng `--no-verify` để tránh blocker.

Guard hiện cũng yêu cầu review trường `SMTP_PASSWORD` trong `.env.example` vì giá trị không thuộc nhóm placeholder được nhận diện; không in giá trị hoặc tự đổi file. Test xác nhận các sample dùng placeholder rõ ràng, TTL và public certificate hợp lệ không bị chặn. Không coi cảnh báo này là bằng chứng một credential thật đã bị lộ nếu chưa kiểm tra riêng.

History có database/backup. Nếu repository từng công khai hoặc người ngoài đã đọc, cần đánh giá lộ dữ liệu, password hash, token và media metadata; không thể thu hồi bằng cách chỉ thêm ignore rule. Không tự rotate credential hay rewrite history. Chỉ báo đường dẫn/commit, không trích xuất nội dung database vào log.

## Phân chia module

| Module | File trọng tâm | Phối hợp bắt buộc |
|---|---|---|
| Authentication/Session | authService, authController, auth pages | RBAC và thay đổi token/session |
| RBAC/User | rbacMiddleware, userService, sync-permissions | Tất cả module dùng permission; không tự cấp grant |
| Departments/Catalog | departmentService, competencyService, recruitmentCatalogService | Salary, department scope và requistion |
| Requisitions/Approval/Budget | requisitionService, approval/configuration/lifecycle/tracking/operations, headcountBudgetService | Lock order, reservation, revision, assignee |
| Candidates/CV | candidatePortalService/controller, candidate-dialogs, portal pages | Read/write scope, document ownership, filesystem |
| Interviews | phần Interview trong requisitionService, interview-dialogs/pages | Assignment, evaluate/read/update tách biệt |
| Offers | phần Offer trong requisitionService, offer-dialogs/pages | Ownership, approval, SENT trước ACCEPTED |
| Job Postings | jobPostingService, publication service/controllers | Requisition lifecycle, public application, P6 |
| Reports/Dashboard | report/dashboard trong requisitionService, frontend pages | Scope và projection dữ liệu |
| Frontend chung | api.js, app.js, routes.json, shared CSS/components | Contract/error/status, desktop/mobile |
| Database/Migrations | db adapter, SQL, runners/executor | SQLite/PostgreSQL, ledger, rollback; không sửa lịch sử tùy tiện |
| Infrastructure/Testing | package.json, scripts, runner, workflows | Isolation, secrets, startup profile; không dùng Azure nghiệp vụ để test |

Không gán người hoặc nhóm GitHub khi chưa có danh sách. Maintainer nên thêm `.github/CODEOWNERS` sau khi xác nhận tài khoản/team và quyền review. CODEOWNERS phải bao phủ router, RBAC, DB/migration, frontend entry points và chính CODEOWNERS/workflows. Nó không tự ngăn push và chỉ có hiệu lực bắt buộc khi ruleset yêu cầu code-owner review.

Một task có module owner và integration reviewer rõ ràng trong PR. Với `server.js`, `requisitionService.js`, `candidatePortalService.js`, RBAC constants, `frontend/js/api.js`, routes, package và schema: thông báo file/vùng hàm dự kiến trước khi sửa; tránh hai PR lớn đồng thời trong cùng vùng; chia commit nhỏ theo mục đích nhưng không tách cấu trúc để tránh conflict. Chia module không bảo đảm không có conflict.

## Kiểm thử trước tích hợp

Đổi API/DTO phải kiểm tra caller frontend/alias và positive/negative authorization. Đổi permission/scope phải chạy RBAC, P1–P6, assignee/ownership và role union; không tự cấp grants staging. Đổi DB/schema phải có kế hoạch ledger/checksum, SQLite/PostgreSQL, rollback/concurrency trên môi trường disposable; không chạy migration trên DB nghiệp vụ. Đổi module chung cần hồi quy Sprint 1–4.

`node backend/tests/test_git_safety.js` dùng mock Git và thư mục tạm; không push/merge/commit thật. `npm run test -- --all` dùng runner source copy, không `.env`/DB nghiệp vụ; runner có copy scripts và hook templates để kiểm tra guard mới. Không chạy riêng các test có mutation trong workspace chính chỉ vì đã có local database.

Workflow `ATS Git Safety` chạy check index và test guard, sau đó isolated regression trên runner GitHub riêng. Khi checkout PR ở detached HEAD, workflow truyền tên nhánh nguồn qua biến môi trường được quote vào `ci --remote-branch`; tên này chỉ chọn ref cần truy vấn trực tiếp trên origin, không phải SHA đáng tin cậy và không bỏ qua content scan. Nếu HEAD đang gắn nhánh khác, ref không hợp lệ, remote không truy cập được hoặc blob không có trong tip đã xác minh, guard vẫn từ chối ngoại lệ. Checkout vẫn kiểm tra merge commit của PR, không đổi sang head-only để né integration. Workflow sẽ FAIL nếu cây PR merge còn file cấm, secrets hoặc blob lớn mới. Workflow chưa được chạy trên GitHub trong nhiệm vụ này. Không dùng pull_request_target cho code không tin cậy; checkout không giữ credential; không cung cấp Azure/Neon secret cho job.

## Việc quản trị GitHub phải làm

Tạo Ruleset/Branch Protection cho `main` và `develop`: yêu cầu Pull Request, ít nhất một reviewer độc lập, dismiss stale approvals, approval cho lần push mới nhất, resolve conversations, status checks bắt buộc `git-safety` và `isolated-regression` sau khi chúng đã chạy ổn định. Không bỏ qua cho admin/maintainer; không cho force push hoặc deletion. Nếu cần bypass khẩn cấp, có quy trình phê duyệt/audit riêng, không bật rộng cho cả nhóm.

Để cấm cả push fast-forward không qua PR, phải bật require pull request; chỉ cấm force push là chưa đủ. Kiểm tra rule áp dụng cho cả hai branch, mọi actor và các đường API/bot. Nếu dùng merge queue, bổ sung trigger merge_group phù hợp trước khi yêu cầu checks trên queue. Chỉ bật yêu cầu signed commits/linear history khi nhóm đã chuẩn bị và thống nhất kiểu merge; không sửa history cũ để đạt yêu cầu.

Bật secret scanning/push protection nếu gói GitHub và loại repository hỗ trợ. Pin action theo full commit SHA theo chính sách supply chain, duy trì cập nhật có review. Không tuyên bố các cài đặt này đã bật: nhiệm vụ không gọi GitHub admin API, không fetch/push để thử quyền và không thay ruleset.
