# 5. Sprint Plan

| KẾ HOẠCH SPRINT TỔNG THỂ |
| Sprint | Chủ đề | Kết quả demo được ở cuối sprint | Story | Point | Luỹ kế | Còn lại |
| 1.0 | Tài khoản & phân quyền | Bảy vai trò đăng nhập được và chỉ thấy đúng phần việc của mình | 10.0 | 42.0 | 42.0 | 308.0 |
| 2.0 | Danh mục tổ chức & vị trí | Sơ đồ tổ chức, khung năng lực và một yêu cầu tuyển dụng đầu tiên | 10.0 | 45.0 | 87.0 | 263.0 |
| 3.0 | Phê duyệt & đăng tin | Một headcount đi trọn luồng duyệt rồi thành tin tuyển dụng công khai | 10.0 | 44.0 | 131.0 | 219.0 |
| 4.0 | Cổng ứng tuyển | Ứng viên ngoài nộp CV trên điện thoại và tra cứu được trạng thái | 9.0 | 45.0 | 176.0 | 174.0 |
| 5.0 | Hồ sơ ứng viên & pipeline | Recruiter điều phối 20 ứng viên trên một bảng kanban | 10.0 | 45.0 | 221.0 | 129.0 |
| 6.0 | Phỏng vấn & đánh giá | Một buổi phỏng vấn được đặt lịch, gửi thư mời và có phiếu đánh giá | 9.0 | 43.0 | 264.0 | 86.0 |
| 7.0 | Offer & onboarding | Một offer được duyệt, gửi đi và ứng viên chấp nhận | 9.0 | 42.0 | 306.0 | 44.0 |
| 8.0 | Thông báo & báo cáo | Dashboard tuyển dụng, báo cáo phễu và time-to-hire | 9.0 | 44.0 | 350.0 | 0.0 |
| TỔNG |  |  | 76 | 350 |
| DEFINITION OF READY / DEFINITION OF DONE |
| # | Definition of Ready — story được đưa vào sprint khi |  |  | Definition of Done — story hoàn thành khi |
| 1.0 | Viết đúng mẫu vai trò – hành động – giá trị |  |  | Toàn bộ tiêu chí chấp nhận được kiểm chứng và đạt |
| 2.0 | Có tiêu chí chấp nhận kiểm chứng được, không mơ hồ |  |  | Code đã qua ít nhất một người review và được merge vào nhánh chính |
| 3.0 | Đã được ước lượng point và cả đội cùng hiểu |  |  | Có unit test cho tầng service, độ phủ nhánh mới ≥ 60% |
| 4.0 | Không còn phụ thuộc chặn nào chưa xử lý |  |  | CI xanh: build, lint, test đều pass |
| 5.0 | Đã có thiết kế giao diện hoặc phác thảo nếu story có UI |  |  | Đã deploy lên staging và chạy được |
| 6.0 | Nhỏ hơn hoặc bằng 8 point; lớn hơn thì phải chẻ nhỏ |  |  | Quyền truy cập được kiểm ở tầng server, không chỉ ẩn ở giao diện |
| 7.0 |  |  |  | Giao diện hoạt động đúng ở khổ 360px |
| 8.0 |  |  |  | Không còn lỗi mức Major trở lên |
| 9.0 |  |  |  | PO đã nghiệm thu trên môi trường staging |
| RỦI RO CHÍNH |
| # | Rủi ro | Cách ứng phó |  | Khả năng | Tác động |
| 1.0 | Công việc kỹ thuật không nằm trong backlog nên bị bỏ quên | Lập một danh sách kỹ thuật riêng ngay ở Sprint 1 và bảo vệ 15% thời lượng mỗi sprint cho nó; nếu không, nợ kỹ thuật sẽ nổ vào Sprint 6–7 |  | Cao | Cao |
| 2.0 | Velocity thực của đội thấp hơn 42 pt ở hai sprint đầu | Hiệu chỉnh lại toàn bộ kế hoạch sau Sprint 2 bằng velocity thật; các story Should và Could là phần cắt trước tiên |  | Cao | Cao |
| 3.0 | Luồng phê duyệt nhiều cấp (S3-01) là state machine phức tạp hơn ước lượng | Làm spike kỹ thuật trong Sprint 2; nếu quá khó thì hạ xuống luồng duyệt hai cấp cố định, cấu hình động để lại sau Sprint 8 |  | Cao | Cao |
| 4.0 | Bóc tách thông tin từ CV (S4-04) cho kết quả kém với CV tiếng Việt định dạng lạ | Đã thiết kế để bóc tách chỉ gợi ý chứ không ghi đè; nếu chất lượng quá thấp thì bỏ story này, mất 5 point |  | Cao | Thấp |
| 5.0 | Sprint 1 tuần khiến story 8 point không kịp đóng trong một sprint | Chẻ mọi story 8 point thành hai phần API và UI ngay ở buổi Sprint Planning |  | Cao | Trung bình |
| 6.0 | Dữ liệu ứng viên bị lộ do phân quyền sót | Ma trận quyền được kiểm ở tầng server ngay từ Sprint 1; S8-05 dành riêng để rà soát lại toàn bộ trước khi bàn giao |  | Trung bình | Cao |
| 7.0 | Không có vị trí tuyển dụng thật để chạy pilot | Chuẩn bị bộ dữ liệu mô phỏng một vị trí đầy đủ từ Sprint 3 để phục vụ demo |  | Thấp | Cao |
