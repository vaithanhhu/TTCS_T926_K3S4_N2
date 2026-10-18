CREATE TABLE IF NOT EXISTS communication_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('THANK_YOU', 'REJECTION')),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidate_communications (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  requisition_id TEXT REFERENCES requisitions(id) ON DELETE SET NULL,
  batch_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('THANK_YOU', 'REJECTION')),
  sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'SENT_LOCAL', 'FAILED', 'SKIPPED_DUPLICATE')),
  error_message TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cand_comm_cand_id ON candidate_communications(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cand_comm_batch_id ON candidate_communications(batch_id);
CREATE INDEX IF NOT EXISTS idx_cand_comm_type ON candidate_communications(type);
CREATE INDEX IF NOT EXISTS idx_cand_comm_status ON candidate_communications(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_rejection_sent ON candidate_communications (candidate_id)
WHERE type = 'REJECTION' AND status IN ('DELIVERED', 'SENT_LOCAL');

INSERT OR IGNORE INTO communication_templates (id, type, name, subject, body_html, body_text, is_default, created_at, updated_at)
VALUES
  (
    'tmpl-comm-thank-you-default',
    'THANK_YOU',
    'Thư cảm ơn ứng tuyển mặc định',
    '[ATS] Thư cảm ơn ứng tuyển vị trí {{jobTitle}} - {{candidateName}}',
    '<p>Kính gửi <strong>{{candidateName}}</strong>,</p><p>Cảm ơn bạn đã quan tâm và ứng tuyển vào vị trí <strong>{{jobTitle}}</strong> tại bộ phận <strong>{{department}}</strong>.</p><p>Hồ sơ của bạn đã được ghi nhận vào hệ thống tuyển dụng. Đội ngũ nhân sự đang xem xét kỹ lưỡng và sẽ phản hồi đến bạn các bước tiếp theo trong thời gian sớm nhất.</p><p>Trân trọng,<br>Phòng Tuyển dụng</p>',
    'Kính gửi {{candidateName}},\n\nCảm ơn bạn đã quan tâm và ứng tuyển vào vị trí {{jobTitle}} tại bộ phận {{department}}.\n\nHồ sơ của bạn đã được ghi nhận vào hệ thống tuyển dụng. Đội ngũ nhân sự đang xem xét kỹ lưỡng và sẽ phản hồi đến bạn các bước tiếp theo trong thời gian sớm nhất.\n\nTrân trọng,\nPhòng Tuyển dụng',
    1,
    datetime('now'),
    datetime('now')
  ),
  (
    'tmpl-comm-rejection-default',
    'REJECTION',
    'Thư từ chối ứng tuyển mặc định',
    '[ATS] Thông báo kết quả ứng tuyển vị trí {{jobTitle}} - {{candidateName}}',
    '<p>Kính gửi <strong>{{candidateName}}</strong>,</p><p>Lời đầu tiên, chúng tôi xin chân thành cảm ơn bạn đã dành thời gian và sự quan tâm đối với vị trí <strong>{{jobTitle}}</strong> tại <strong>{{department}}</strong>.</p><p>Sau khi xem xét kỹ lưỡng hồ sơ và quá trình đánh giá, chúng tôi rất tiếc phải thông báo rằng hiện tại chưa thể đồng hành cùng bạn ở vị trí này do tiêu chí tuyển dụng lần này có sự điều chỉnh phù hợp hơn với một ứng viên khác.</p><p>Thông tin hồ sơ của bạn vẫn được lưu giữ an toàn trong mạng lưới nhân tài của chúng tôi để ưu tiên liên hệ cho các cơ hội nghề nghiệp phù hợp hơn trong tương lai.</p><p>Chúc bạn luôn gặt hái nhiều thành công trên con đường sự nghiệp!</p><p>Trân trọng,<br>Phòng Tuyển dụng</p>',
    'Kính gửi {{candidateName}},\n\nLời đầu tiên, chúng tôi xin chân thành cảm ơn bạn đã dành thời gian và sự quan tâm đối với vị trí {{jobTitle}} tại {{department}}.\n\nSau khi xem xét kỹ lưỡng hồ sơ và quá trình đánh giá, chúng tôi rất tiếc phải thông báo rằng hiện tại chưa thể đồng hành cùng bạn ở vị trí này do tiêu chí tuyển dụng lần này có sự điều chỉnh phù hợp hơn với một ứng viên khác.\n\nThông tin hồ sơ của bạn vẫn được lưu giữ an toàn trong mạng lưới nhân tài của chúng tôi để ưu tiên liên hệ cho các cơ hội nghề nghiệp phù hợp hơn trong tương lai.\n\nChúc bạn luôn gặt hái nhiều thành công trên con đường sự nghiệp!\n\nTrân trọng,\nPhòng Tuyển dụng',
    1,
    datetime('now'),
    datetime('now')
  );
