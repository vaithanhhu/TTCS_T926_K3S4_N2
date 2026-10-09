# RBAC — chính sách tái phê duyệt cuối, 08/10/2026

## S3-05 / S3-06 — 09/10/2026

Sao chép dùng requisition.create/read, actual ADMIN/HR_MANAGER/HIRING_MGR và source scope, tạo DRAFT creator mới. Phân công dùng requisition.assign, chỉ HR_MANAGER/ADMIN; Hiring đọc, Recruiter chỉ primary/support được giao. Đọc/ghi Candidate, Interview, Offer và báo cáo dùng DB scope; REC không còn global candidate read. Independent scope của HR/ADMIN/Hiring/Interviewer/Candidate và multi-role được giữ.

Neon migration005 đồng bộ dependency grants additive theo ROLE_PERMISSIONS hiện hành, không xóa grant hoặc tự gán role. HIRING không được candidate.update, interview.create hoặc requisition.assign. Recruiter primary/support không trở thành approver và ADMIN vẫn chịu validation/state/cấm tự duyệt. Xem [bàn giao S3-05/S3-06](S3-05-S3-06-copy-recruiter-assignments.md).

## S3-03 / S3-04

Tracking GET theo requisitionId dùng requisition.read và scope backend hiện hành. ADMIN/HR_MANAGER có scope quản trị; HIRING_MGR chỉ creator/assigned manager/department manager theo cơ chế requisition hiện có. APPROVER vẫn cần quyền đọc và phạm vi hợp lệ; không có API sửa/xóa lịch sử. Quyền đọc không cho phép xử lý bước của người khác.

Budget mới: HR_MANAGER read/manage/override; HIRING_MGR chỉ read department mình quản lý; các vai trò khác không được cấp. ADMIN toàn quyền RBAC nhưng vẫn bị kiểm tra lý do, tài chính, version, trạng thái, cấm tự duyệt và assignee. Ngân sách không mở quyền salary standard của Hiring Manager.

Migration004 đồng bộ additive budget grants và prerequisite requisition.edit/draft.edit theo ma trận hiện hành. Không xóa grant/seed trên Neon. Test SQLite/PGlite chứng minh idempotency, không cấp edit cho APPROVER/INTERVIEWER/CANDIDATE và không cho HM override kể cả có grant thủ công sai. Neon thiếu prerequisite edit ở smoke đầu đã được đồng bộ an toàn, smoke rollback cuối12/12 PASS. Xem [bàn giao S3-03/S3-04](S3-03-S3-04-tracking-headcount.md).

Tái phê duyệt và áp dụng revision đã hoàn thiện; phần BLOCKED ở các audit lịch sử dưới đây đã được thay thế bằng quyết định cuối và implementation hiện tại. Xem ATS-E2E-2026-10-08.md và evidence.openReapprovalFinal.

| Thao tác | Actor | Kiểm tra độc lập |
|---|---|---|
| Sửa note OPEN | HIRING trong scope, Recruiter được giao, HR/ADMIN | requisition.edit, scope, OPEN, optimistic token UI |
| Đề xuất nhóm B | Creator có quyền trong scope; HR/ADMIN gửi thay | requisition.create+requisition.edit, OPEN, expected version/hash, đầy đủ S2-10/config |
| Gửi lại APPROVED/NEEDS_INFO/REJECTED | Creator; HR/ADMIN có lý do | Revision mới và resolve lại/cấp1; giữ creator gốc và lịch sử |
| Xem workflow | Creator, HR/ADMIN, user có requisition.read đúng scope hoặc current assignee có approve | DB actor/role hiện hành; không tin cache |
| Duyệt/Rej/Info | Chỉ assignee của bước PENDING | requisition.approve, expectedStep/version, không creator, không trùng cấp, comment bắt buộc cho Rej/Info |
| Áp dụng nhóm B | Backend ở bước cuối | Khóa row OPEN/hash, validation, cùng transaction step/workflow/event/main |

ADMIN full RBAC không thay thế assignment, cấm self approval, validation, trạng thái và HR-only numeric standard salary. Người gửi thay không tự có quyền duyệt; creator gốc là danh tính dùng cho cấm tự duyệt. HIRING_MGR pipeline chỉ đọc trong scope, không candidate.update hoặc sửa catalog chuẩn. HR quản lý toàn module Requisition theo F hiện hành, không tạo scope mới chưa được chốt.

Ma trận quyền/seed/sync của lượt trước giữ nguyên, có kiểm thử47/47 RBAC và33/33 final matrix. Không chạy sync/seed trên Neon hoặc DB runtime. No new permission/migration trong lượt này; historical001/002/003 không đổi. Offer approval không thay đổi. Flags OFF không cho bypass nhóm B.

Bộ tái phê duyệt94/94 PASS, S3-01108/108, S3-0293/93, S1/S2/S2-10 PASS. Browser E2E và live PostgreSQL NOT RUN. Xem báo cáo đầy đủ để phân biệt API/frontend runtime với browser.

---

## Tài liệu lịch sử trước quyết định cuối

# RBAC hiện hành — FINAL TASK 08/10/2026

ADMIN full RBAC tập trung, không phụ thuộc role_permissions mới. Backend vẫn kiểm tra active account/password restriction/permission/scope/state/allowed fields và cấm self approval/duplicate/assignee của S3. Standard salary vẫn HR_MANAGER-only.

Seed và sync-permissions dùng ROLE_PERMISSIONS chung. Sync chỉ quản lý code của các module đã chốt: bổ sung grant đúng, bỏ grant mặc định trái matrix (như HIRING_MGR interview.evaluate), giữ grant module khác. Idempotent SQLite/PostgreSQL embedded đã kiểm thử. Chưa sync/seed trên database thật.

| Role | Backend permissions sau sync |
|---|---|
| ADMIN | `account.lock`, `account.unlock`, `approval_configuration.manage`, `audit.read`, `candidate.create`, `candidate.read`, `candidate.update`, `career_page.manage`, `career_page.read`, `competency.manage`, `competency.read`, `dashboard.read`, `department.manage`, `department.read`, `interview.create`, `interview.evaluate`, `interview.evaluation.read`, `interview.read`, `interview.update`, `offer.approve`, `offer.create`, `offer.read`, `question_bank.manage`, `question_bank.read`, `recruitment_catalog.manage`, `recruitment_catalog.read`, `report.read`, `requisition.approve`, `requisition.create`, `requisition.draft.edit`, `requisition.edit`, `requisition.read`, `role.assign`, `role.read`, `salary_range.read`, `user.create`, `user.delete`, `user.read`, `user.update` |
| HR_MANAGER | `approval_configuration.manage`, `audit.read`, `candidate.create`, `candidate.read`, `candidate.update`, `career_page.manage`, `career_page.read`, `competency.manage`, `competency.read`, `dashboard.read`, `department.manage`, `department.read`, `interview.create`, `interview.evaluate`, `interview.evaluation.read`, `interview.read`, `interview.update`, `offer.approve`, `offer.create`, `offer.read`, `question_bank.manage`, `question_bank.read`, `recruitment_catalog.manage`, `recruitment_catalog.read`, `report.read`, `requisition.approve`, `requisition.create`, `requisition.draft.edit`, `requisition.edit`, `requisition.read`, `role.read`, `salary_range.read`, `user.read` |
| HIRING_MGR | `candidate.read`, `competency.read`, `dashboard.read`, `department.read`, `interview.evaluation.read`, `interview.read`, `offer.read`, `recruitment_catalog.read`, `report.read`, `requisition.create`, `requisition.draft.edit`, `requisition.edit`, `requisition.read` |
| APPROVER | `candidate.read`, `competency.read`, `dashboard.read`, `department.read`, `interview.evaluation.read`, `offer.approve`, `offer.read`, `recruitment_catalog.read`, `report.read`, `requisition.approve`, `requisition.read` |
| RECRUITER | `candidate.create`, `candidate.read`, `candidate.update`, `competency.read`, `dashboard.read`, `department.read`, `interview.create`, `interview.evaluation.read`, `interview.read`, `interview.update`, `offer.create`, `offer.read`, `recruitment_catalog.read`, `report.read`, `requisition.edit`, `requisition.read` |
| INTERVIEWER | `candidate.read`, `competency.read`, `department.read`, `interview.evaluate`, `interview.evaluation.read`, `interview.read`, `question_bank.read`, `recruitment_catalog.read` |
| CANDIDATE | `candidate.create`, `candidate.read`, `interview.read`, `offer.read` |

Scope dữ liệu được bind ở service/API, không tin viewer/role/ownership từ client. HIRING scope creator/position manager/department manager; Recruiter requisition/Offer theo recruiter_id; Approver requisition/Offer theo assignment; Interviewer candidates/calendar/evaluation theo interview assignment; Candidate theo email của session. Role union là OR các scope hợp lệ, không lấy avatar/current session thay row metadata.

HIRING_MGR candidate pipeline chỉ read, stage403. Catalog metadata read cho internal roles, chỉ HR/ADMIN manage; numeric salary vẫn chỉ HR. Calendar update và evaluation có permission riêng; score/feedback không thể đi qua interview.update. GET interview-evaluations cung cấp kết quả cho role có read evaluation mà không mở calendar cho Approver.

OPEN: handoverNotes direct trong scope. recruiterId/status chỉ HR/ADMIN. Significant content409 REQUISITION_REAPPROVAL_REQUIRED, không ghi đè. DRAFT creator-only giữ S2-10; normal editor IN_PROGRESS/CLOSED readonly. S1-10 handover cho HR/ADMIN trên OPEN/IN_PROGRESS là operational exception, không sửa nội dung tuyển dụng.

**Chưa hoàn thiện:** việc gửi thay đổi từ APPROVED và việc áp dụng revision vào main record sau cấp cuối còn chờ hai quyết định trong báo cáo. Không đánh dấu full task/OPEN reapproval acceptance PASS chỉ vì các suite S3-02 NEEDS_INFO cũ PASS.

Manual chỉ dùng source/db copy; không .env/Neon/runtime. Check provider/path/flags/simulated email. Nếu copy có dữ liệu, dùng sync:permissions để đồng bộ grant, không seed. Các grant đọc catalog mới không cho phép sửa danh mục. Frontend dùng permissions/access/capabilities backend, backend kiểm lại mọi write.

Xem [báo cáo](ATS-E2E-2026-10-08.md), evidence.finalTask cho34scripts:33PASS,1NOT RUN; test final-rbac-open33/33; Node116/116; DB hashes unchanged. Browser E2E NOT RUN.

---

## Tài liệu trước matrix FINAL TASK (lưu để đối chiếu)


# RBAC và quyền ADMIN

ADMIN có quyền RBAC với mọi permission hệ thống, kể cả khi chưa có liên kết trong `role_permissions`. Quyền được xác định từ vai trò hiện tại trong database, không tin vai trò do client gửi. Login, session, API quyền, ma trận vai trò, menu và kiểm tra trong transaction dùng cùng cơ chế.

ADMIN vẫn chịu kiểm tra trạng thái tài khoản, đổi mật khẩu bắt buộc, phạm vi phòng ban, người tạo, người được phân công, phiên bản workflow, cấm tự duyệt và cấm trùng người duyệt. Chỉ HR_MANAGER có quyền nghiệp vụ xem/sửa dải lương chuẩn. `salary_range.read` trong danh sách RBAC của ADMIN không loại bỏ hạn chế nghiệp vụ này.

Seed chỉ bổ sung các liên kết quyền còn thiếu. Quyền hợp lệ do migration hoặc module khác cấp được giữ nguyên. Seed vẫn tạo/cập nhật dữ liệu mẫu như trước, vì vậy không dùng seed để sửa quyền trên database đang sử dụng.

`sync:permissions` bổ sung permission `approval_configuration.manage` cho HR_MANAGER và `interview.create` cho HR_MANAGER/RECRUITER, trong transaction. ADMIN có quyền tập trung, không cần grant riêng. Quyền tạo lịch được xác nhận trong đợt E2E ngày 08/10/2026. Không thay đổi user, requisition, cấu hình, workflow, snapshot hoặc lịch sử. Không gán thêm quyền cấu hình cho RECRUITER, HIRING_MGR, INTERVIEWER, APPROVER hay CANDIDATE. Không tự chạy đồng bộ khi PostgreSQL khởi động.

## Ma trận mặc định sau đồng bộ

| Vai trò | Quyền |
|---|---|
| ADMIN | Toàn bộ permission trong catalog và các kiểm tra permission hệ thống mới; luôn giữ hạn chế nghiệp vụ |
| HR_MANAGER | `user.read`, `role.read`, `requisition.read`, `requisition.create`, `requisition.approve`, `requisition.draft.edit`, `department.read`, `department.manage`, `competency.read`, `competency.manage`, `question_bank.read`, `question_bank.manage`, `recruitment_catalog.read`, `recruitment_catalog.manage`, `career_page.read`, `career_page.manage`, `candidate.read`, `candidate.update`, `interview.read`, `interview.create`, `offer.read`, `offer.create`, `offer.approve`, `salary_range.read`, `approval_configuration.manage` |
| HIRING_MGR | `requisition.read`, `requisition.create`, `requisition.draft.edit`, `recruitment_catalog.read`, `candidate.read`, `interview.read`, `interview.evaluate` |
| APPROVER | `requisition.read`, `requisition.approve`, `offer.read`, `offer.approve` |
| RECRUITER | `requisition.read`, `recruitment_catalog.read`, `candidate.read`, `candidate.create`, `candidate.update`, `interview.read`, `interview.create`, `offer.read`, `offer.create` |
| INTERVIEWER | `interview.read`, `interview.evaluate`, `question_bank.read` |
| CANDIDATE | `candidate.create`, `offer.read` |

Các quyền được cấp riêng và hợp lệ trong database vẫn được giữ. Khi có nhiều vai trò, quyền là hợp của các vai trò. Ma trận thực tế được cung cấp bởi API hiện có, không có ma trận độc lập ở frontend.

## Kiểm thử SQLite thủ công

1. Dừng instance thử nghiệm nếu đang chạy. Sao chép `A:\ATS_SPRINT3_TEST\sprint3_test.db` và cả `-wal`/`-shm` nếu tồn tại sang thư mục thử nghiệm mới. Giữ tên basename tương ứng của ba file. Không mở hoặc sửa bản gốc trong các bước sau.
2. Dùng bản sao source riêng không chứa `.env`, `.git`, database runtime hoặc các credential. Cài dependency bằng `npm ci --offline`. Đặt các biến dưới đây trong PowerShell của bản sao source, thay đường dẫn bằng bản sao database vừa tạo:

```powershell
$env:DB_PROVIDER = 'sqlite'
$env:DB_PATH = 'C:\ATS_RBAC_COPY\sprint3_test.db'
$env:NODE_ENV = 'development'
$env:EMAIL_MODE = 'simulated'
$env:APPROVAL_CONFIGURATION_ENABLED = 'true'
$env:REQUISITION_APPROVAL_ENABLED = 'true'
$env:PORT = '5051'
npm run sync:permissions -- --check
npm run sync:permissions
npm run sync:permissions -- --check
npm start
```

Không đặt `NODE_ENV=test` cho smoke test bản sao dữ liệu này: convention test sẽ chọn `backend/data/ats_test.db` thay vì `DB_PATH`. Không chạy `seed`, importer hoặc migration trên bản gốc. Nếu migration đã có chưa được xác minh, dừng thay vì sửa ledger hoặc chạy lại tự động.

3. Đăng nhập bằng tài khoản của môi trường thử nghiệm. ADMIN và HR_MANAGER phải thấy `/admin/approval-configurations`. Trong Network, cả `/api/v1/approval-configurations` và `/api/v1/approval-configurations/options` phải trả 200. Các vai trò còn lại phải bị chặn và không có menu cấu hình.
4. Tạo/công bố cấu hình trên bản sao. Chọn ADMIN làm người duyệt khác người tạo, gửi một requisition hợp lệ và xử lý bước được phân công. ADMIN không được xử lý bước giao cho người khác, tự duyệt hoặc bỏ qua validation. APPROVER chỉ xử lý bước giao cho mình. Offer approval vẫn sử dụng chức năng cũ.
5. Đổi vai trò trong môi trường thử nghiệm: session heartbeat cập nhật quyền từ backend và làm mới menu/route guard. Reload hoặc đăng nhập lại cũng phải cho kết quả nhất quán. Feature flag tắt phải ẩn và chặn trang cấu hình.

## Regression tự động

`npm run test:rbac` yêu cầu bản sao TEMP không chứa `.git`, `.env` hoặc database runtime. Suite chạy SQLite thật, HTTP API và frontend runtime thật; đồng thời chạy PostgreSQL embedded qua project adapter. Kiểm thử PostgreSQL embedded không thay thế kiểm thử pg-wire/Neon thật. Không cần kết nối Neon để chạy suite này.

## Cập nhật kiểm tra phạm vi Requisition/Pipeline — 08/10/2026

HIRING_MGR chỉ đọc ứng viên và yêu cầu thuộc vị trí/phòng ban mình sở hữu hoặc phụ trách. Backend lấy viewer từ session, dùng bound SQL đối chiếu created_by/hiring_manager_id/department.manager_id; không chấp nhận viewer từ client, không suy đoán phòng ban qua tên hay kế thừa cha. GET foreign Requisition trả403 REQUISITION_OUT_OF_SCOPE và không trảdata. DRAFT creator-only/code cũ được giữ.

Thiếu requisition.edit vẫn bị backend chặn; UI edit feedback dùng chính requiredPermission từ response để hiển thị thông báo cụ thể. Quy tắc sửa OPEN/các trạng thái chưa được xác nhận nên chưa cấp grant hay bật form sửa. Không thay matrix seed/sync hoặc assertion cũ trong đợt này. Matrix hiện tại ở trên chưa phải matrix mục tiêu mới được áp dụng hoàn chỉnh; HIRING_MGR interview.evaluate, quyền catalog và một số legacy list còn đang chờ quyết định compatibility.

`test:requisition-access` đã chạy16/16 trong bản sao TEMP:8luồng HTTP/frontend cơ bản,2điều khiển response chậm,2scope/permission và4PostgreSQL embedded. Browser E2E vẫnNOT RUN. Xem báo cáo ATS-E2E-2026-10-08.md và evidence.followUp để phân biệt testPASS, policyBLOCKED và phần chưa kiểm chứng.


## S3-07 — 2026-10-09

Permission mới requisition.lifecycle.manage: chỉ HR_MANAGER nhận grant chuẩn, ADMIN dùng toàn quyền RBAC tập trung. HIRING_MGR/RECRUITER/APPROVER/INTERVIEWER/CANDIDATE không được đóng/tạm dừng/huỷ dù giả mạo roles trong payload. Chỉ đọc vòng đời khi requisition.read và phạm vi Requisition hợp lệ; giữ nguyên bảo vệ DRAFT của người tạo. Seed/sync idempotent không làm mất grant.

ADMIN không vượt qua lý do bắt buộc, quantity đã duyệt, pipeline chưa kết thúc, workflow/revision PENDING, giới hạn HIRED/quantity, expectedVersion hoặc immutable audit. APPROVER đang được phân công vẫn không quyết định khi main PAUSED/CANCELLED. Không thay đổi Offer approval hoặc quyền pipeline.

Neon grant đã kiểm tra: HR_MANAGER → requisition.lifecycle.manage; không cấp cho các role khác. Migration 006 bổ sung đúng một permission và grant có kiểm soát, không chạy seed. Xem [báo cáo S3-07](S3-07-requisition-lifecycle.md) và [bằng chứng](evidence/S3-07-test-results.json).


## S3-08/S3-09 — 2026-10-09

S3-08 dùng requisition.read và scope hiện có; cả primary/support lọc qua EXISTS, không mở rộng dataset bằng bộ lọc. S3-09 job_posting.read cấp HR_MANAGER/RECRUITER/HIRING_MGR/APPROVER, job_posting.manage cấp HR_MANAGER/RECRUITER; ADMIN toàn quyền RBAC tập trung. Writer Recruiter phải đang được phân công primary/support và còn ACTIVE; cần source requisition.read, không dùng job permission để vượt source-read bị thu hồi. Hiring/Approver chỉ đọc theo scope; Interviewer/Candidate không đọc draft nội bộ, Candidate dùng public API.

ADMIN vẫn phải có source APPROVED thực sự, đúng trạng thái, catalog/date hợp lệ, expectedVersion/hash; không có publish trong S3-09. Không lộ standard salary range qua job salary visibility. Scope/grant đọc trên Neon đúng sáu rows đã chốt, không seed. [Báo cáo](S3-08-S3-09-tracking-job-drafts.md).


## S3-10 — 2026-10-09

job_posting.approve/publish chỉ grant HR_MANAGER; ADMIN qua super RBAC tập trung. Recruiter primary/support giữ job.manage để submit/revise, không approve/publish. Mọi read/preview cần job.read + source requisition.read/scope. Creator/last editor không tự quyết định review kể cả ADMIN; publisher chỉ publish đúng approved content version/hash, actor/time do backend. Source/expiry/state/IDOR checks độc lập với RBAC. Public không trả salary nếu hide và không trả thông tin approval nội bộ. Scope cũ và numeric standard salary HR-only giữ nguyên. [S3-10](S3-10-job-publication.md).

Tin PENDING_APPROVAL đã hết hạn hoặc có Requisition source thay đổi vẫn cho HR_MANAGER/ADMIN độc lập với tác giả từ chối có lý do để phục hồi về nháp. Ngoại lệ này chỉ áp dụng REJECT; không cho duyệt/xuất bản nội dung không còn hợp lệ, không bỏ qua scope hoặc cấm tự duyệt.
