# 1. Product Overview

| HỆ THỐNG TUYỂN DỤNG NỘI BỘ |
| Product Backlog · Dự án thực tập · Nhóm 2 · 8 tuần |
| THÔNG SỐ DỰ ÁN |
| Thông số | Giá trị | Ghi chú |
| Thời gian | 8 tuần (2 tháng) | Không có Sprint 0 riêng; công việc setup nằm trong Sprint 1 |
| Số sprint | 8 sprint × 1 tuần | Nhịp ngắn, cần chẻ nhỏ story 8 point thành API + UI |
| Velocity mục tiêu | 42 – 45 point / sprint | Là mục tiêu, không phải dự báo — hiệu chỉnh lại sau Sprint 2 |
| Tổng story point | 350 point | 42 + 45 + 44 + 45 + 45 + 43 + 42 + 44 |
| Số user story | 76 story | Trung bình 9.5 story / sprint |
| Số epic | 9 epic |
| Đội ngũ | 5 người fullstack, full-time | 40 giờ/tuần/người |
| Quy đổi point | 1 point ≈ 4 giờ công | ~170 giờ hữu ích/tuần sau khi trừ họp và code review |
| VẤN ĐỀ NGHIỆP VỤ |
| Bộ phận nhân sự đang tuyển dụng bằng Excel, Gmail và Google Drive. Yêu cầu tuyển dụng được duyệt qua email hoặc chat, CV nằm rải rác trong hộp thư của từng recruiter, lịch phỏng vấn hẹn tay qua điện thoại, và nhận xét sau phỏng vấn thì mỗi người ghi một kiểu. |
| # | Hệ quả trực tiếp |
| 1.0 | Không ai biết một vị trí đang tắc ở đâu. Trưởng bộ phận hỏi 'tuyển tới đâu rồi' thì recruiter phải mở lại hộp thư để dựng lại tiến độ. |
| 2.0 | Yêu cầu tuyển dụng duyệt bằng miệng. Không có bằng chứng ai đã duyệt headcount nào, ở mức lương nào — cuối năm đối chiếu ngân sách thì lệch. |
| 3.0 | CV tốt bị bỏ quên. Ứng viên giỏi nhưng trượt vòng cuối lần trước không ai nhớ tới khi mở vị trí tương tự sáu tháng sau. |
| 4.0 | Nhận xét phỏng vấn không so sánh được. Ba người phỏng vấn viết ba kiểu, quyết định tuyển cuối cùng dựa vào ấn tượng chứ không dựa vào tiêu chí. |
| 5.0 | Ứng viên không biết mình đang ở đâu. Phần lớn hồ sơ trượt không bao giờ nhận được phản hồi, ảnh hưởng trực tiếp tới thương hiệu tuyển dụng. |
| TẦM NHÌN SẢN PHẨM |
| CHO bộ phận nhân sự và các trưởng bộ phận đang tuyển người bằng Excel, Gmail và Drive,<br>ATS LÀ hệ thống quản lý tuyển dụng nội bộ trên nền web<br>GIÚP theo dõi trọn vòng đời tuyển dụng trên một nguồn dữ liệu duy nhất, từ yêu cầu headcount tới ngày nhận việc,<br>KHÁC VỚI cách làm hiện tại ở chỗ mọi quyết định — duyệt headcount, loại ứng viên, chốt offer — đều có dấu vết, có tiêu chí, và có thể truy lại. |
| MỤC TIÊU & THƯỚC ĐO SAU 8 TUẦN |
| Mục tiêu | Thước đo thành công |  | Đo bằng |
| Chạy trọn một vị trí tuyển dụng thật trên hệ thống | 1 vị trí pilot đi hết chu trình: yêu cầu → duyệt → đăng tin → ứng tuyển → phỏng vấn → offer → nhận việc |  | Demo nghiệm thu cuối Sprint 8 |
| Rút ngắn thời gian sàng lọc hồ sơ | Recruiter xử lý 20 CV mới trong ≤ 15 phút nhờ pipeline và nhãn sàng lọc |  | Bấm giờ trên staging |
| Mọi headcount đều có dấu vết phê duyệt | 100% yêu cầu tuyển dụng trong lớp dữ liệu pilot có lịch sử duyệt đầy đủ, không thiếu bước |  | Đối soát nhật ký |
| Quyết định tuyển dựa trên tiêu chí | Mỗi ứng viên vào vòng cuối có tối thiểu 2 phiếu đánh giá theo cùng khung năng lực |  | Kiểm thử nghiệp vụ |
| Đội thực tập giao được sản phẩm chạy được | Deploy staging tự động, ≥ 60% coverage tầng service, 0 lỗi Critical tồn đọng |  | CI report |
| PHẠM VI |
| TRONG PHẠM VI (In-scope) |  | NGOÀI PHẠM VI (Out-of-scope) |
| • Xác thực, phân quyền theo vai trò, quản trị người dùng nội bộ |  | • Bóc tách CV bằng AI / so khớp ngữ nghĩa JD với hồ sơ |
| • Danh mục phòng ban, chức danh, khung năng lực |  | • Đăng tin tự động sang VietnamWorks, TopCV, LinkedIn |
| • Yêu cầu tuyển dụng và luồng phê duyệt nhiều cấp |  | • Đồng bộ hai chiều với Google Calendar / Outlook |
| • Ngân sách headcount theo phòng ban |  | • Phỏng vấn video trong ứng dụng |
| • Soạn và xuất bản tin tuyển dụng |  | • Bài kiểm tra năng lực trực tuyến, chấm tự động |
| • Cổng ứng tuyển công khai, nộp CV, tra cứu trạng thái |  | • Ký số hợp đồng lao động |
| • Giới thiệu ứng viên nội bộ (referral) |  | • Quản lý nhân sự sau nhận việc: chấm công, lương, đánh giá định kỳ |
| • Hồ sơ ứng viên hợp nhất, phát hiện trùng, kho ứng viên tiềm năng |  | • Ứng dụng di động native |
| • Pipeline tuyển dụng dạng kanban theo giai đoạn |
| • Đặt lịch phỏng vấn, phát hiện trùng lịch, thư mời |
| • Phiếu đánh giá theo khung năng lực và bảng so sánh ứng viên |
| • Đề xuất offer, duyệt offer theo hạn mức, checklist onboarding |
| • Email tự động theo giai đoạn và thông báo trong ứng dụng |
| • Dashboard và báo cáo tuyển dụng |
| NỀN TẢNG KỸ THUẬT |
| Tầng | Lựa chọn | Lý do chọn cho đội thực tập |
| Frontend | React + TypeScript | Hệ sinh thái tài liệu tiếng Việt dồi dào, dễ tìm mentor review |
| Backend | Spring Boot (Java) hoặc NestJS | Chọn theo stack mentor mạnh nhất — chốt trước Sprint 1, không đổi giữa chừng |
| Cơ sở dữ liệu | PostgreSQL | Luồng phê duyệt và nhật ký cần ràng buộc toàn vẹn mạnh |
| Xác thực | JWT access + refresh token | Đủ dùng, không kéo theo phụ thuộc hạ tầng ngoài |
| Lưu trữ tệp | Dịch vụ lưu trữ đối tượng | CV và tài liệu ứng viên; trừu tượng hoá qua interface để đổi nhà cung cấp sau |
| Gửi email | SMTP nội bộ + hàng đợi | Thư mời phỏng vấn và phản hồi ứng viên phải gửi bất đồng bộ, có thể gửi lại |
| YÊU CẦU PHI CHỨC NĂNG |
| Nhóm | Yêu cầu |
| Hiệu năng | Danh sách ứng viên trả kết quả < 1,5 giây với 20.000 hồ sơ và 200 vị trí |
| Quy mô | 400 người dùng nội bộ, cổng ứng tuyển công khai chịu được 100 lượt nộp/giờ |
| Bảo vệ dữ liệu cá nhân | Hồ sơ ứng viên là dữ liệu cá nhân: chỉ recruiter phụ trách và hiring manager của vị trí đó xem được; mọi truy cập được ghi nhật ký; có chức năng xoá hồ sơ theo yêu cầu ứng viên |
| Bảo mật | Mật khẩu băm bcrypt; cổng ứng tuyển công khai có chống spam và giới hạn tần suất; mọi endpoint kiểm quyền ở tầng server |
| Giao diện | Responsive từ 360px — ứng viên nộp CV chủ yếu trên điện thoại |
| Ngôn ngữ | Toàn bộ tiếng Việt, múi giờ Asia/Ho_Chi_Minh, tiền lương theo VND |
| Sao lưu | Sao lưu cơ sở dữ liệu và tệp CV hằng ngày, giữ 7 bản gần nhất |
| GIẢ ĐỊNH CẦN PO XÁC NHẬN |
| # | Giả định |  | Ảnh hưởng nếu sai |
| 1.0 | Không đăng tin tự động sang các trang tuyển dụng bên ngoài |  | Nếu cần đẩy tin sang VietnamWorks hoặc TopCV, mỗi tích hợp thêm khoảng 8–13 point và phụ thuộc vào việc họ có mở API hay không |
| 2.0 | Không đồng bộ lịch với Google Calendar hay Outlook |  | Người phỏng vấn phải vào hệ thống để xem lịch. Nếu cần đồng bộ hai chiều, thêm khoảng 13–20 point |
| 3.0 | Luồng duyệt tối đa ba cấp |  | Nếu doanh nghiệp có luồng duyệt song song hoặc duyệt theo ma trận, S3-01 phải thiết kế lại từ đầu |
| 4.0 | Hạn mức duyệt offer dựa trên dải lương của chức danh |  | Nếu hạn mức tính theo tổng chi phí nhân sự hoặc theo ngân sách còn lại của phòng ban thì quy tắc phức tạp hơn |
| 5.0 | Không lưu hợp đồng lao động và không ký số |  | Hệ thống dừng ở thư mời nhận việc. Hợp đồng vẫn ký giấy ngoài hệ thống |
| 6.0 | Ứng viên không có tài khoản đăng nhập |  | Chỉ tra cứu bằng mã. Nếu muốn ứng viên có tài khoản để theo dõi nhiều hồ sơ, thêm khoảng 8 point |
