# Kiểm toán chuyên sâu ATS Sprint 1–7

Ngày kiểm tra: 18/10/2026. Nhánh: `fix/sprint7-deep-audit`.

## Baseline, phạm vi và giới hạn kết luận

- Baseline: `bff884c437bf5bc2d049eb174551ba95ecb4c502`, merge PR #46 vào `develop`. Đã fetch và xác minh thêm bằng GitHub API: PR #46 đã merge, SHA khớp.
- Workspace chính ở `develop`, sạch trước khảo sát. Worktree riêng được tạo từ `origin/develop`: `.local/worktrees/sprint7-deep-audit`.
- Kiểm tra tập trung luồng Sprint 7, actor/grants, scope interview/candidate, offer response, onboarding, email, adapter PostgreSQL; chạy hồi quy toàn bộ các script offline mà runner hiện hành lựa chọn cho Sprint 1–7.
- Hồi quy PASS không đồng nghĩa đã chứng minh mọi tổ hợp Acceptance Criteria, mọi race hoặc mọi đường gọi nội bộ của toàn hệ thống đều an toàn. Những hạng mục chưa chạy được ghi riêng, không suy diễn PASS.
- Không thay đổi schema/migration lịch sử, permission catalog, grants vận hành, `.env`, secret hoặc cấu hình SSH/TLS. Không deploy, không merge vào `develop`.

## Phát hiện và bản sửa

Không phát hiện Critical đã được chứng minh trong các probe của lượt này. Có 16 nhóm lỗi được xác minh: 12 High và 4 Medium. Các mục dưới đây đều đã sửa; kết quả tổng hợp cuối nằm tại phần kiểm thử.

| Mã | Mức độ | Vị trí | Bằng chứng và tác động | Khắc phục / regression |
|---|---|---|---|---|
| F01 | High | `onboardingService.js`: create/init/update/template reads | Caller tự khai `HR_MANAGER` có thể vượt service boundary; không reload grants | Reload actor ACTIVE bằng `getAuthorizedActor`, kiểm tra permission và role nghiệp vụ trước thao tác. Probe actor Candidate giả HR không tạo template |
| F02 | High | `hiringDecisionService.js`: summary/decision/consensus | NULL hoặc actor giả có thể đọc tổng hợp; consensus thiếu candidate-specific scope | Reload `interview.evaluation.read`; giữ manager business gate, kiểm tra primary interviewer hoặc phạm vi requisition thực tế của HM/Recruiter |
| F03 | High | `questionBankService.js`, `interviewEvaluationService.js` | Recruiter được coi là privileged trên mọi interview; actor NULL/role caller được tin cậy | Guard dùng chung `interviewScopeService.js`: actor/grant hiện hành, primary/panel assignment, scope của cả interview và candidate requisition. Giữ blind evaluation và phiếu cá nhân |
| F04 | High | `offerService.js`: getOffers | Thiếu viewer vẫn trả danh sách unrestricted; expiry chạy trước authorization | Từ chối thiếu viewer, reload `offer.read` trước expiry/query. Probe xác nhận 403 và trạng thái DB không đổi |
| F05 | High | `offerService.js`: generateOfferLetter/sendOffer | Tên ứng viên/chức danh/nội dung offer có HTML được chèn trực tiếp vào HTML thư | Escape tại HTML output; không thay đổi nội dung text/DTO. Probe img/svg/iframe không còn trở thành markup |
| F06 | High | `offerService.js`: getOfferByToken/respondOffer | Stale read có thể ghi EXPIRED đè ACCEPTED; token cũ hết hạn có thể đổi SUPERSEDED thành EXPIRED | Compare-and-set chỉ khi SENT, reload nếu không cập nhật; chặn terminal state trước expiry. Probe interleaving xác nhận ACCEPTED/SUPERSEDED được giữ |
| F07 | High | `candidateCommunicationService.js`: sendBulk | Hai request REJECTION có thể cùng vượt kiểm tra duplicate trước SMTP | Reservation PENDING trong transaction, khóa candidate, kiểm lại scope và trạng thái; SMTP sau commit. Native test có hai backend PID độc lập nhưng chỉ một message |
| F08 | High | `onboardingService.js`, `hiringDecisionService.js` | Lỗi ghi history bị nuốt; dữ liệu nghiệp vụ có thể commit mà thiếu audit tương ứng | Không nuốt lỗi history trong các mutation đã sửa; authorization/khóa/mutation decision nằm trong transaction. Failure injection xác nhận rollback stage, decision và checklist item |
| F09 | Medium | `hiringDecisionService.js`: score aggregates | `Number(NULL)` thành 0, làm giảm điểm trung bình | Bỏ NULL/undefined trước chuyển số; 4 và NULL có average 4 |
| F10 | Medium | `candidateCommunicationService.js`: renderTextVariables | Dữ liệu có `$&`, `$$`, `$\`` bị String.replace diễn giải thành replacement syntax | Một lượt thay placeholder bằng callback, không diễn giải hoặc thay đệ quy giá trị |
| F11 | Medium | `onboardingService.js`: completion | Retry item đã hoàn tất tạo lại ONBOARD_COMPLETE history | Chỉ tạo chuyển trạng thái khi checklist chưa COMPLETED; giữ audit cập nhật item hợp lệ |
| F12 | High | `db/postgres.js`: postgresSQL | Quy tắc email không phân biệt assignment/predicate: `UPDATE ... SET email=?` thành `SET lower(email)=...`, SQL không hợp lệ | Chỉ case-fold email predicate ở WHERE/AND/OR/ON/WHEN; regression cả SQL translation và UPDATE thực tế trên PGlite/native |
| F13 | High | `onboardingService.js`: detail/list read scope | Candidate ownership có thể mở DTO tác vụ nội bộ, gồm thông tin người phụ trách và notes | Dùng internal-role scope riêng, không dùng Candidate ownership làm internal read scope; vẫn cho assignee truy cập theo phân công |
| F14 | Medium | `server.js`: POST hiring-decision | HTTP đòi candidate.update khiến Hiring Manager bị chặn dù S7-03 giao quyền quyết định và đã có interview.evaluation.read | HTTP dùng interview.evaluation.read; service vẫn bắt buộc ADMIN/HR_MANAGER/HIRING_MGR và scope quản lý. Không thêm grant |
| F15 | High | `hiringDecisionService.js`: interviewId của decision | Có thể gắn quyết định ứng viên A vào interview của ứng viên B | Kiểm tra interview thuộc đúng candidate trước INSERT; 400 và DB không đổi khi không khớp |
| F16 | High | `interviewEvaluationService.js`: saveEvaluation transaction | Bản nháp đọc trước khi người khác submit vẫn ghi đè SUBMITTED vì guard chỉ chặn request submit | Sau row lock, mọi mutation đều bị chặn nếu trạng thái hiện hành SUBMITTED; probe stale draft giữ nguyên SUBMITTED |

Các vị trí được xác định theo tên hàm thay vì số dòng cố định để tránh sai sau những bản sửa kế tiếp. Có thể tìm trực tiếp các mã lỗi `INTERVIEW_CANDIDATE_MISMATCH`, `EVALUATION_ALREADY_SUBMITTED`, `ONBOARDING_FORBIDDEN` và helper `authorizeInterview`.

## Tái hiện và kiểm thử trước/sau

File mới: `backend/tests/test_sprint7_deep_audit.js`; npm script `test:sprint7-deep-audit`.

- Probe ban đầu trên baseline: exit 1, 22 FAIL trên SQLite/PGlite.
- Bộ probe mở rộng chạy với source baseline xuất riêng: exit 1, 32 FAIL. Đây là số case thất bại, không phải 32 lỗ hổng độc lập; một số case downstream phụ thuộc trạng thái của case trước.
- Các lỗi phát hiện sau đó có log RED riêng: Candidate onboarding ownership, SQL email assignment, decision/interview mismatch, stale evaluation draft.
- Probe cuối: 21 case cho mỗi provider SQLite/PGlite; PostgreSQL native chạy cùng 21 case trên database local mới.
- Negative test kiểm tra mã lỗi và trạng thái DB. Failure injection ném lỗi sau mutation để kiểm tra rollback. Không dùng helper coi request thành công là negative PASS.
- Không có email thật: `EMAIL_MODE=simulated`, mock SMTP trong probe gửi trùng/timeout.

Lệnh tái chạy qua runner cô lập hiện hành:

```text
npm run test -- test:sprint7-deep-audit
npm run test -- --all
npm run sprint:check
```

Không chạy script mutation trực tiếp trên database làm việc. Test audit cố ý từ chối chạy nếu root chứa `.git`/`.env` hoặc không ở NODE_ENV=test.

## Kết quả kiểm thử

| Nhóm | Môi trường | Trạng thái | Exit / kết quả |
|---|---|---|---|
| Baseline full regression | Export riêng, SQLite/PGlite, email giả lập | PASS | 88/88 scripts, exit 0 |
| Full regression bản vá cuối | Export riêng của source cuối | PASS | 89/89 scripts, 0 FAIL, exit 0; một lượt nghiệm thu hoàn chỉnh |
| Probe mới | SQLite + PGlite | PASS | 42/42, exit 0, snapshot nghiệm thu cuối |
| Probe native | PostgreSQL 17.10 local, database mới | PASS | 21/21, exit 0 |
| Browser E2E | Chromium Windows, SQLite riêng | PASS | 65/65, exit 0, runner dhsetR |
| Git Safety unit | Mock Git, không push thử | PASS | 98/98, exit 0 |
| ATS E2E sau sửa fixture | Export riêng, SQLite/PGlite | PASS | 53/53, exit 0 |
| UI interface | Chromium, nhiều kích thước desktop/mobile | PASS | 196/196, exit 0 |
| sprint:check | Worktree fix, guard hiện hành | PASS | GIT_SAFETY_OK, exit 0; giữ warning fixture cũ |
| Syntax và diff | Worktree fix | PASS | 17 JS qua node --check; git diff --check exit 0 |
| Secret scan file thay đổi | inspectContent hiện hành | PASS | 0 blocking issue; không in giá trị secret |
| Comment scan | So sánh comment-line mới với HEAD | PASS | Không có comment-line mới |
| npm audit | Lockfile hiện hành, export riêng | FAIL | Exit 1; 2 Moderate, 0 High/Critical |
| Full native PostgreSQL 16.15 mutation regression | Local | NOT RUN | Không có PostgreSQL 16 local đã xác minh; không dùng Azure để chạy mutation |
| Azure production mutation / migration | Azure | NOT RUN | Chủ động không thực hiện |

Các snapshot trung gian được dừng sau khi có bản sửa bổ sung để giảm tải máy; không ghi chúng là lượt full PASS. Baseline 88/88 là lượt hoàn tất riêng trước khi sửa. Không cộng các lượt chạy lại thành một lượt full giả.

## Ma trận kiểm tra Sprint 7

| Story | Nội dung đã đối chiếu | Test / bằng chứng |
|---|---|---|
| S7-01 | Calendar primary/panel, trạng thái evaluation, CV scope và guard download | test:s7-01; P5; browser/API suite; giữ nguyên engine calendar |
| S7-02 | Gợi ý theo framework/criterion, lịch sử theo interview/candidate, assignment và actor hiện hành | test:s7-02; probe F03; toggle serialize bằng transaction và interview lock |
| S7-03 | Chỉ SUBMITTED vào tổng hợp, NULL score, manager decision scope, history và interview ownership | test:s7-03; test:s6-09; F02/F08/F09/F14/F15 |
| S7-04 | Validation offer, salary justification, một offer hiệu lực và HTML letter | test:s7-04; F05; giữ unique constraints hiện hành |
| S7-05 | Approval một/hai cấp, role/scope, trạng thái, history bất biến | test:s7-05; kiểm tra trigger bất biến SQLite/PostgreSQL của migration 022; không đổi policy |
| S7-06 | Token/expiry/replay, gửi offer, expired/accepted concurrency | test:s7-06; F06, CAS; không khẳng định mọi race đã được thử trên PostgreSQL 16 |
| S7-07 | Rejection/revision, token cũ, SUPERSEDED, liên kết offer | test:s7-07; F06; không tự chuyển talent-pool stage |
| S7-08 | Template/snapshot, assignee, progress, completion/retry/rollback và dữ liệu nội bộ | test:s7-08; F01/F08/F11/F13 |
| S7-09 | Preview/render, recipient isolation, duplicate, SMTP ambiguity và scope | test:s7-09; F07/F10; native hai connection |

Sprint 1–6 được kiểm tra hồi quy qua runner thật, gồm authentication/session/OTP/reset, RBAC, requisition, candidate/CV, timeline, search/saved filters, merge, talent pool, scheduling/bulk scheduling và evaluation. Không đổi thuật toán, API hoặc schema của các module này ngoài các lỗi đã nêu.

## Transaction, concurrency và email

- Decision: actor/grant trong transaction; PostgreSQL khóa candidate rồi requisition; ghi decision/stage/history nguyên tử. Invalid interviewId bị chặn trước ghi.
- Onboarding: khóa candidate khi initialize; khóa checklist trước đọc item/progress khi update. Retry hoàn thành không tạo lại transition. Lỗi history phải rollback.
- Rejection email: actor/grants được kiểm lại trong transaction; khóa candidate và requisition, giữ chỗ PENDING trước SMTP. SMTP chạy ngoài transaction.
- Hai request email được kiểm thử trên hai PostgreSQL backend PID độc lập, kiểm tra số lần gọi provider và số bản ghi DELIVERED/SENT_LOCAL.
- SMTP không xác định kết quả giữ PENDING, chặn resend mù. Cần đối soát trạng thái delivery trước retry thủ công. Không tuyên bố exactly-once email delivery.
- Offer stale-read và evaluation stale-draft có deterministic interleaving/failure injection. Không đánh đồng chúng với một bộ fuzz race đầy đủ.

## RBAC và fixture

- Không cấp thêm 62 grants, không xóa grant nguồn hoặc chuyển RBAC PENDING sang COMPLETE.
- Guard không tin role/email/status do caller đưa vào. ADMIN giữ đặc quyền hiện hành của getAuthorizedActor.
- Co-interviewer giữ quyền calendar và phiếu đánh giá cá nhân theo S6-08, không được ghi score/feedback chung chỉ nhờ membership; consensus chung giữ primary/manager gate.
- Fixture S7-02/S7-03 được bổ sung users state/roles/grants thật từ matrix hiện hành. Recruiter positive fixture có assignment thật.
- Fixture S6-07 được gán requisition cho recruiter trước case reopen; assertion không đổi. Fixture PGlite S6-09 bổ sung metadata actor/RBAC để không giả ADMIN bằng object caller.
- S7-08 truyền actor thật khi gọi template list. Không xóa, skip hoặc làm yếu assertion cũ.
- ATS E2E trước sửa fixture: 51/52, do gọi getOffers không truyền viewer. Fixture đã đổi riêng getOffers sang ADMIN thật, giữ các assertion email/count, thêm assertion không actor bị 403; chạy lại đạt 53/53. Không nới service guard để chiều fixture.

## Azure và dữ liệu vận hành

- SSH strict known-host thành công tới VM hiện hành. Không reboot/resize, không thay firewall/NSG.
- PostgreSQL service ACTIVE; TCP PostgreSQL được quan sát chỉ listen `127.0.0.1:5432`.
- Kết nối qua SSH tunnel riêng, CA và hostname verification; PostgreSQL `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`, TLSv1.3, authorized=true.
- Chỉ đọc database staging `ats_migration_validation_7cd908a1` bằng session default_transaction_read_only=on và BEGIN READ ONLY. Không ghi vào `ats_db`.
- Readback: 53 bảng gồm bảng nghiệp vụ/ledger, 59 users, 7 roles, 32 permissions, 72 grants. Ledger split-phase: 9 DDL, 7 RBAC PENDING, 2 NOT_REQUIRED.
- password_encryption = scram-sha-256; cấu hình auth có peer cho local và scram-sha-256 cho kết nối tương ứng. Không đọc password hash hoặc in secret.
- Readback cuối: counts, ledger và digest của toàn bộ 72 cặp role–permission không đổi. SHA256 grants: `78c4987033a1d28380170a939e8c686efb849d9fd77c4827fd0d6bdbd2cddd35`. Tunnel audit riêng đã đóng; PostgreSQL 17 local của probe cũng đã dừng.
- Staging này chưa có các bảng offer approval/onboarding/communication của Sprint 7 trong danh sách đã đọc. Không chạy startup hoặc migration ATS mới trên staging cũ; cần kế hoạch upgrade trên bản sao riêng trước nghiệm thu triển khai.
- Không xác minh Azure production end-to-end hoặc data parity toàn bộ giá trị nguồn trong nhiệm vụ này. Readback counts/ledger không thay thế chứng nhận migration đầy đủ.

## Dependency, secrets và giới hạn còn lại

- npm audit báo Moderate cho `uuid` và đường phụ thuộc `exceljs`. Advisory chính thức: [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
- Advisory ảnh hưởng v3/v5/v6 với external buffer. Source ExcelJS đang dùng uuid v4; chưa chứng minh đường khai thác trong ATS. Không chạy npm audit fix vì đề xuất tự động downgrade ExcelJS major. Cần nâng dependency có kiểm thử tương thích riêng; trạng thái REVIEW, không ghi audit xanh.
- Git Safety có warning literal credential ở các fixture/evidence cũ; không có blocking secret trong file sửa/mới theo scanner hiện hành. Không coi scanner là chứng minh tuyệt đối mọi secret lịch sử đều đã bị xóa.
- Kiểm toán toàn bộ Git history, pentest độc lập, native PostgreSQL 16.15 full regression và migration lên bản sao Azure mới: NOT RUN trong lượt này.
- Kiểm tra đường dẫn bằng git log xác nhận `backend/data/ats.db` từng nằm trong lịch sử. Không đọc dữ liệu cá nhân trong blob cũ, chưa phân loại hết nội dung lịch sử; xóa khỏi HEAD không xóa khỏi history. Cần xử lý lịch sử/credential theo quy trình riêng nếu xác minh có dữ liệu thật, không tự force-push hoặc rewrite.
- Browser 65 case là coverage sẵn có của repository; không chứng nhận mọi giao diện mới Sprint 7 trên mọi kích thước mobile. Native concurrency cho mọi tổ hợp approval/revision/onboarding và kiểm tra đầy đủ deployment headers của Nginx vẫn NOT RUN.
- RBAC reconciliation vận hành vẫn PENDING; không được suy diễn fixture baseline đã có grants mới thành production được cấp quyền.
- S4-08 scheduler vẫn theo quyết định vận hành trước đó: thiết kế job riêng, không tạo trusted caller tùy ý.
- Ổ đĩa local có lúc xuống thấp. Đã dừng các worker test snapshot cũ; không dừng service production. Automatic approval review từ chối cả lệnh dọn batch lẫn lệnh dọn một thư mục test tạm cố định với thông báo `blocked by policy`; không đổi sang cơ chế xóa khác. Log đã được sao lưu, các bản sao test cũ còn nằm ngoài repository để chủ máy xử lý riêng.

## File thay đổi và bảo toàn

Source: `backend/src/db/postgres.js`, `backend/src/server.js`, các service `candidateCommunicationService`, `hiringDecisionService`, `interviewEvaluationService`, `interviewScopeService` (mới), `offerService`, `onboardingService`, `questionBankService`, `requisitionService`.

Tests: `test_sprint7_deep_audit.js` (mới), fixture `test_ats_e2e.js`, `test_s6_07_competency_evaluations.js`, `test_s6_09_candidate_comparison.js`, `test_s7_02_interview_question_suggestions.js`, `test_s7_03_hiring_decisions.js`, `test_s7_08_onboarding.js`. Thêm npm script trong `package.json`; không đổi lockfile.

Report này là file bàn giao duy nhất được đưa vào Git; log, database local, credential test và browser artifacts nằm ngoài repository. Không commit media, database, .env hoặc secret.

Workspace chính, S6-02 và S5-06 được kiểm tra Git status sạch. Có manifest hash readback ngoài repository cho `.env`, lockfile và runtime còn tồn tại; đây là checkpoint trong lượt kiểm tra, không phải snapshot có từ trước nhiệm vụ. Không khẳng định có hash trước nhiệm vụ cho file ignored nếu chưa ghi nhận.

Đối chiếu thêm 66 file được bảo vệ trực tiếp với nội dung Git baseline, gồm migration và các test P1–P6 được chọn: 66/66 SHA256 sau chuẩn hóa CRLF khớp. Checkpoint filesystem bảy file của workspace chính khớp ở readback cuối. Manifest: `protected-source-hashes.json`, `protected-readback-before.json` ngoài repository.

## Evidence và Git bàn giao

Evidence ngoài repository: `C:/Users/Asus of Kien/Documents/Codex/ATS-SPRINT7-AUDIT-20261018`.

- Baseline: export `ats-s603-test-WyN0Cy`, runner `ats-local-regression-ZWqyKe/results.json`.
- RED: `probes/red.log`, `baseline-new-probes-red.log`; các export failure injection được lưu nguyên riêng.
- Native cuối: `native-final.log`, database local mới, 21/21.
- Full cuối: export `ats-s603-test-Z6Vhv9`, runner `ats-local-regression-dhsetR`; digest được ghi bên dưới. Đây là snapshot sau cả bản sửa fixture ATS E2E.
- Azure: `azure-readonly.json`; secret nằm ở profile ngoài repo, không nằm trong evidence được commit.

Digest SHA256 của evidence cuối:

| Evidence | SHA256 |
|---|---|
| Full results.json, 89/89 | d56a936d841e9e759cd3df04bc44224f54041128fc0ff1a77850730f30019eb1 |
| Full stdout log | 9ab26bb8ad1edb331240a731720d1facef0085fb89d5d48b32418ef493efb39a |
| Native cuối, 21/21 | 8a863eb352bb01d9d15214b1b46bfe27d7974ced020181d0c300cbf3a5ebcf29 |
| Azure readback cuối | 6a0cc6307acdd208ef623d6671069c7891add669150a4aa5535d707addf3d9e8 |

Các số case nằm bên trong các script full regression, không cộng trùng thành tổng case độc lập. Bản source ứng dụng và fixture của snapshot nghiệm thu khớp worktree; chỉ báo cáo Markdown được cập nhật sau khi chạy.

Bàn giao Git: nhóm thay đổi này được chuẩn bị trong commit `fix: khắc phục phân quyền và toàn vẹn dữ liệu Sprint 7`, gồm source, regression và báo cáo này. Không nhúng SHA của chính commit vào nội dung của nó. SHA thực tế, remote readback và kết quả push được ghi ở receipt `git-handoff.json` ngoài repository và trong báo cáo bàn giao của phiên làm việc. Đích duy nhất: `origin/fix/sprint7-deep-audit`; không force push, không merge `develop`.

Kết luận: **bản vá đã đạt kiểm thử để bàn giao review; phạm vi nghiệm thu toàn hệ thống vẫn PARTIAL**. Không phải chứng nhận production-ready. Native PostgreSQL 16.15 mutation regression, dependency advisory, Git-history review và RBAC/Azure upgrade còn các giới hạn đã nêu; không tự thay đổi policy hoặc dữ liệu vận hành để làm xanh kết quả.
