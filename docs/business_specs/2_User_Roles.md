# 2. User Roles

| USER ROLES — 7 VAI TRÒ |
| # | Vai trò | Mã | Là ai trong doanh nghiệp | Mục tiêu chính khi dùng hệ thống |
| 1.0 | Ứng viên | Candidate | Người nộp hồ sơ từ bên ngoài, không có tài khoản nội bộ | Nộp CV, theo dõi trạng thái hồ sơ, xác nhận lịch phỏng vấn và phản hồi offer |
| 2.0 | Nhân viên tuyển dụng | Recruiter | Người vận hành tuyển dụng hằng ngày | Sàng lọc CV, điều phối pipeline, đặt lịch phỏng vấn, soạn offer |
| 3.0 | Trưởng bộ phận | Hiring Manager | Người cần người, sở hữu vị trí tuyển dụng | Tạo yêu cầu tuyển dụng, xem ứng viên của vị trí mình, quyết định tuyển |
| 4.0 | Người phỏng vấn | Interviewer | Nhân sự được mời tham gia một vòng phỏng vấn | Xem lịch, đọc CV, nộp phiếu đánh giá theo khung năng lực |
| 5.0 | Trưởng phòng Nhân sự | HR Manager | Chủ sở hữu toàn bộ hoạt động tuyển dụng | Giám sát tất cả vị trí, phân công recruiter, theo dõi ngân sách headcount và báo cáo |
| 6.0 | Người duyệt | Approver | Ban giám đốc hoặc cấp duyệt theo hạn mức | Phê duyệt yêu cầu tuyển dụng và offer vượt hạn mức lương |
| 7.0 | Quản trị hệ thống | Admin | Người vận hành ứng dụng | Quản lý tài khoản, vai trò, danh mục dùng chung, xem nhật ký hệ thống |
| MA TRẬN PHÂN QUYỀN THEO MODULE |
| F = toàn quyền  |  W = ghi trong phạm vi được giao  |  R = chỉ xem  |  – = không truy cập  |  * Chỉ trên dữ liệu của chính mình, của vị trí mình sở hữu hoặc vòng phỏng vấn mình tham gia. Với hồ sơ ứng viên đây là ràng buộc bảo vệ dữ liệu cá nhân, bắt buộc kiểm ở tầng server. Admin có toàn quyền trên mọi module. |
| Module |  | Candidate | Interviewer | Hiring Mgr | Recruiter | Approver | HR Manager |
| Danh mục tổ chức & vị trí |  | – | R | R | R | R | F |
| Yêu cầu tuyển dụng |  | – | – | W* | W | W* | F |
| Tin tuyển dụng |  | R | – | R | W | R | F |
| Hồ sơ ứng viên & pipeline |  | R* | R* | R* | F | R | F |
| Lịch phỏng vấn |  | R* | R* | R* | F | – | F |
| Phiếu đánh giá |  | – | W* | R* | R | R | F |
| Offer & onboarding |  | R* | – | R* | W | W* | F |
| Email & thông báo |  | R* | R* | R* | F | – | F |
| Báo cáo & dashboard |  | – | – | R* | R* | R | F |
| Người dùng & nhật ký |  | – | – | – | – | – | R |
