const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const SlaNotificationService = require('../src/services/slaNotificationService');

async function seed() {
  const dbPaths = [
    path.resolve('.local/ats-demo.db'),
    path.resolve('backend/data/ats.db')
  ].filter(p => fs.existsSync(p));

  console.log('Target database paths:', dbPaths);

  for (const dbPath of dbPaths) {
    try {
      const db = new DatabaseSync(dbPath);

      const upsertCandidate = db.prepare(`
        INSERT INTO candidates (
          id, requisition_id, full_name, email, phone_number, stage, experience_years, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
        ON CONFLICT(id) DO UPDATE SET
          requisition_id = excluded.requisition_id,
          full_name = excluded.full_name,
          email = excluded.email,
          phone_number = excluded.phone_number,
          stage = excluded.stage,
          experience_years = excluded.experience_years,
          created_at = excluded.created_at
      `);

      // Candidate 1: 5 days ago (threshold is 3 days -> Overdue by 2 days)
      upsertCandidate.run('cand-sla-demo-1', 'req-001', 'Lê Văn Quá Hạn SLA (5 ngày)', 'quahan.sla1@example.com', '0912345678', 'NEW', 3, '-5 days');

      // Candidate 2: 4 days ago (threshold is 3 days -> Overdue by 1 day)
      upsertCandidate.run('cand-sla-demo-2', 'req-002', 'Trần Thị Trễ Hạn CV (4 ngày)', 'quahan.sla2@example.com', '0987654321', 'NEW', 2, '-4 days');

      console.log(`[SUCCESS] Seeded 2 overdue candidates into ${dbPath}`);

      // Verify candidates
      const rows = db.prepare(`
        SELECT id, full_name, stage, created_at 
        FROM candidates 
        WHERE id IN ('cand-sla-demo-1', 'cand-sla-demo-2')
      `).all();
      console.log('Current rows:', rows);

      // Run daily SLA scan to flag breaches and generate in-app reminder notifications
      const service = new SlaNotificationService(db);
      const cronResult = await service.runDailySlaCheck();
      console.log(`[SLA DAILY CHECK RESULT]:`, cronResult);

      // Query flagged candidates
      const currentUser = { id: 'usr-admin', role: 'ADMIN' };
      const overdueList = await service.getOverdueCandidates(currentUser, { includeAll: false });
      console.log(`[OVERDUE CANDIDATES COUNT]:`, overdueList.data?.totalOverdue);
      console.log(`[OVERDUE LIST]:`, overdueList.data?.candidates?.map(c => ({
        id: c.id,
        name: c.fullName,
        stage: c.stage,
        daysInStage: c.sla?.daysInStage,
        overdueDays: c.sla?.overdueDays,
        flag: c.sla?.flag,
        isOverdue: c.sla?.isOverdue
      })));
    } catch (err) {
      console.error(`[ERROR] Processing ${dbPath}:`, err);
    }
  }
}

seed();
