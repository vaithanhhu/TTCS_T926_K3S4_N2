const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (['.git', '.env', 'backend/data/ats.db', 'backend/data/ats.db-shm', 'backend/data/ats.db-wal', 'backend/data/ats_test.db'].some(file => fs.existsSync(path.join(root, file)))) {
  throw new Error('Run datetime/dashboard tests in a fresh isolated TEMP copy without .git, .env or existing databases.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
process.env.TZ = 'Asia/Ho_Chi_Minh'; // Explicit test timezone, never a production display setting.
const helperPath = path.join(root, 'frontend/js/shared/datetime.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), sandbox);
const { parseUtcTimestamp, formatUtcTimestamp } = sandbox.window.ATS_DATETIME;
const { startServer, server } = require('../src/server');
const { getDatabase } = require('../src/db/database');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const results = { datetime: { passed: 0, failed: 0 }, dashboard: { passed: 0, failed: 0 } };
let base, db, admin;
async function test(group, name, action) {
  try { await action(); results[group].passed++; console.log('PASS ' + group + ': ' + name); }
  catch (error) { results[group].failed++; console.error('FAIL ' + group + ': ' + name, error); }
}
async function api(route, token, body) {
  const res = await fetch(base + '/api/v1' + route, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: res.status, data: await res.json() };
}
async function runtime(initialPath = '/admin/audit') {
  return createFrontendRuntime(base, initialPath, [['ats_token', admin.token], ['ats_user', JSON.stringify(admin.user)]]);
}
function inZone(raw, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(parseUtcTimestamp(raw));
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
function childZone(timeZone) {
  const script = "const fs=require('node:fs'),vm=require('node:vm');const c={window:{}};vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);console.log(JSON.stringify({instant:c.window.ATS_DATETIME.parseUtcTimestamp('2026-10-05 14:15:00').toISOString(),display:c.window.ATS_DATETIME.formatUtcTimestamp('2026-10-05 14:15:00'),expected:new Date('2026-10-05T14:15:00Z').toLocaleString('vi-VN')}));";
  const result = spawnSync(process.execPath, ['-e', script, helperPath], { env: { ...process.env, TZ: timeZone }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
async function main() {
  await startServer(0); base = 'http://127.0.0.1:' + server.address().port; db = getDatabase();
  const login = await api('/auth/login', null, { email: 'admin@company.com', password: 'Ats@123456' });
  assert.equal(login.status, 200); admin = login.data.data;
  const records = [
    { id: 'clock-next', time: '2026-10-05 17:30:00' },
    { id: 'clock-normal', time: '2026-10-05 14:15:00' },
    { id: 'clock-midnight', time: '2026-10-04 23:55:00' },
    { id: 'clock-oldest', time: '2026-10-03 08:00:00' }
  ];
  for (const record of records) db.prepare("INSERT INTO login_audit_logs (id,email,status,attempted_at) VALUES (?,?,'SUCCESS',?)").run(record.id, 'clock-fixture@example.invalid', record.time);
  await test('datetime', 'SQLite datetime(now) is UTC and has no timezone suffix', () => {
    const raw = db.prepare("SELECT datetime('now') AS instant").get().instant;
    assert.match(raw, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(Math.abs(parseUtcTimestamp(raw).getTime() - Date.now()) < 2000);
  });
  await test('datetime', 'Legacy SQLite timestamp resolves the exact UTC instant', () => {
    assert.equal(parseUtcTimestamp('2026-10-05 14:15:00').toISOString(), '2026-10-05T14:15:00.000Z');
  });
  await test('datetime', 'Naive ISO timestamp has the same known UTC semantics', () => {
    assert.equal(parseUtcTimestamp('2026-10-05T14:15:00').toISOString(), '2026-10-05T14:15:00.000Z');
  });
  await test('datetime', 'Explicit Z is retained without a second conversion', () => {
    assert.equal(parseUtcTimestamp('2026-10-05T14:15:00Z').getTime(), parseUtcTimestamp('2026-10-05 14:15:00').getTime());
  });
  await test('datetime', 'Explicit positive offset is respected without appending Z', () => {
    assert.equal(parseUtcTimestamp('2026-10-05T21:15:00+07:00').toISOString(), '2026-10-05T14:15:00.000Z');
  });
  await test('datetime', 'Explicit negative offset correctly crosses a UTC day boundary', () => {
    assert.equal(parseUtcTimestamp('2026-10-05T23:30:00-04:00').toISOString(), '2026-10-06T03:30:00.000Z');
  });
  await test('datetime', 'Fractional seconds and surrounding whitespace remain valid', () => {
    assert.equal(parseUtcTimestamp(' 2026-10-05 14:15:00.125 ').toISOString(), '2026-10-05T14:15:00.125Z');
  });
  await test('datetime', 'Vietnam display advances to the next day near midnight', () => {
    assert.equal(inZone('2026-10-05 17:30:00', 'Asia/Ho_Chi_Minh'), '2026-10-06 00:30');
  });
  await test('datetime', 'Negative-offset display correctly moves to the preceding day', () => {
    assert.equal(inZone('2026-10-05 02:30:00', 'America/New_York'), '2026-10-04 22:30');
  });
  await test('datetime', 'Daylight-saving conversion uses Intl rules rather than a fixed offset', () => {
    assert.equal(inZone('2026-03-08 06:30:00', 'America/New_York'), '2026-03-08 01:30');
    assert.equal(inZone('2026-03-08 07:30:00', 'America/New_York'), '2026-03-08 03:30');
  });
  await test('datetime', 'Parsing is deterministic in four explicitly selected process timezones', () => {
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York', 'Europe/London']) assert.equal(childZone(zone).instant, '2026-10-05T14:15:00.000Z');
  });
  await test('datetime', 'Default formatting follows each browser/process timezone', () => {
    const displays = [];
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/New_York']) { const result = childZone(zone); assert.equal(result.display, result.expected); displays.push(result.display); }
    assert.equal(new Set(displays).size, 3);
  });
  await test('datetime', 'Null, wrong type, invalid calendar and invalid time safely display a dash', () => {
    for (const value of [null, undefined, 0, true, {}, '', 'not a date', '2026-10-05', '2026-02-30 12:00:00', '2026-13-01 12:00:00', '2026-10-05 24:00:00', '2026-10-05 12:60:00', '2026-10-05T14:15:00+30:00']) {
      assert.equal(parseUtcTimestamp(value), null); assert.equal(formatUtcTimestamp(value), '—');
    }
  });
  await test('datetime', 'Every currently supported valid timestamp displays without Invalid Date', () => {
    for (const raw of ['2026-10-05 14:15:00', '2026-10-05T14:15:00Z', '2026-10-05T21:15:00+07:00']) assert.doesNotMatch(formatUtcTimestamp(raw), /Invalid Date/);
  });
  await test('datetime', 'Audit API retains raw values and newest-first order across several days', async () => {
    const res = await api('/admin/audit-logs?limit=100', admin.token); assert.equal(res.status, 200);
    const logs = res.data.logs.filter(log => log.email === 'clock-fixture@example.invalid');
    assert.deepEqual(logs.map(log => log.id), records.map(record => record.id));
    assert.deepEqual(logs.map(log => log.attempted_at), records.map(record => record.time));
    const instants = logs.map(log => parseUtcTimestamp(log.attempted_at).getTime());
    assert.ok(instants.every((instant, index) => index === 0 || instant <= instants[index - 1]));
  });
  await test('datetime', 'Actual audit page renders UTC as local and preserves server ordering', async () => {
    const f = await runtime(); const html = f.nodes.get('audit-table-body').innerHTML;
    assert.match(html, /21:15:00 5\/10\/2026/); assert.match(html, /00:30:00 6\/10\/2026/);
    const positions = records.map(record => html.indexOf('data-id="' + record.id + '"'));
    assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
    assert.doesNotMatch(html, /Invalid Date/); assert.deepEqual(f.errors, []);
  });
  await test('datetime', 'Audit detail uses the same formatter and keeps raw JSON timestamp', async () => {
    const f = await runtime(); f.context.fixtureLog = { id: 'clock-normal', attempted_at: '2026-10-05 14:15:00', status: 'SUCCESS' };
    await vm.runInContext("openAuditDetailModal('clock-normal', fixtureLog)", f.context);
    assert.equal(f.nodes.get('audit-modal-time').textContent, '21:15:00 5/10/2026');
    assert.equal(JSON.parse(f.nodes.get('audit-modal-raw-json').textContent).attempted_at, '2026-10-05 14:15:00');
    assert.deepEqual(f.errors, []);
  });
  await test('datetime', 'Detail opened without initial data waits for the actual event timestamp', async () => {
    const f = await runtime(); await vm.runInContext("openAuditDetailModal('clock-normal')", f.context);
    assert.equal(f.nodes.get('audit-modal-time').textContent, '21:15:00 5/10/2026');
  });
  await test('datetime', 'Audit rendering tolerates null/invalid timestamps without Invalid Date', async () => {
    const f = await runtime(); f.window.ATS_API.getAuditLogsApi = async () => ({ ok: true, data: { success: true, logs: [{ id: 'invalid', attempted_at: null }, { id: 'invalid-2', attempted_at: 'wrong' }] } });
    await vm.runInContext('loadAuditLogs()', f.context);
    assert.doesNotMatch(f.nodes.get('audit-table-body').innerHTML, /Invalid Date/);
    assert.equal((f.nodes.get('audit-table-body').innerHTML.match(/>—<\/td>/g) || []).length >= 2, true);
  });
  await test('datetime', 'Audit list/detail keep authentication and audit.read default-deny', async () => {
    const recruiter = await api('/auth/login', null, { email: 'recruiter@company.com', password: 'Ats@123456' });
    assert.equal(recruiter.status, 200);
    for (const route of ['/admin/audit-logs', '/admin/audit-logs/clock-normal']) {
      assert.equal((await api(route)).status, 401); assert.equal((await api(route, recruiter.data.data.token)).status, 403);
    }
  });
  await test('dashboard', 'History heading, container, button and loading state are removed', () => {
    const html = fs.readFileSync(path.join(root, 'frontend/pages/dashboard.html'), 'utf8');
    assert.doesNotMatch(html, /Lịch sử đăng nhập|Lịch sử truy cập|Nhật ký Hoạt động Hệ thống|dashboard-recent-audit|btn-goto-audit|Đang tải nhật ký/);
  });
  await test('dashboard', 'History-specific rendering/listeners are removed without deleting stats API', () => {
    const source = fs.readFileSync(path.join(root, 'frontend/js/pages/dashboard.js'), 'utf8');
    assert.doesNotMatch(source, /recentAudit|dashboard-recent-audit|btnGotoAudit|getAuditLogsApi|getAuditLogDetailApi/);
    assert.match(source, /getDashboardStats\(token\)/);
  });
  await test('dashboard', 'Department panel fills its row without a reserved empty grid cell', () => {
    const html = fs.readFileSync(path.join(root, 'frontend/pages/dashboard.html'), 'utf8');
    assert.equal((html.match(/class="dashboard-grid-2col"/g) || []).length, 1);
    assert.match(html, /Department Distribution[\s\S]*?<div style="margin-bottom: var\(--space-8\);">\s*<div class="panel-card">/);
    assert.doesNotMatch(html.slice(html.indexOf('Department Distribution')), /min-height|height:|grid-template-columns/);
    const css = fs.readFileSync(path.join(root, 'frontend/css/style.css'), 'utf8');
    assert.match(css, /@media \(max-width: 1024px\)\s*\{\s*\.dashboard-grid-2col\s*\{\s*grid-template-columns: 1fr/);
  });
  await test('dashboard', 'Direct navigation, refresh and cache reload retain the frontend shell', async () => {
    const shell = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
    for (const cache of ['default', 'reload', 'no-store']) { const res = await fetch(base + '/dashboard', { headers: { Accept: 'text/html' }, cache }); assert.equal(res.status, 200); assert.equal(await res.text(), shell); }
  });
  await test('dashboard', 'Remaining KPI/funnel/requisition/interview/department widgets still render', async () => {
    const f = await runtime('/dashboard');
    f.window.ATS_API.getDashboardStats = async () => ({ ok: true, data: { success: true, stats: {
      openRequisitions: 7, totalCandidates: 12, upcomingInterviewsCount: 3, handoverAlertsCount: 2, totalHeadcount: 9,
      candidateFunnel: { APPLIED: 6, SCREENING: 2, INTERVIEW: 2, OFFER: 1, HIRED: 1 },
      recentRequisitions: [{ code: 'REQ-CLOCK', title: 'Fixture role', departmentName: 'Fixture department', headcount: 2, status: 'OPEN' }],
      upcomingInterviews: [], departmentBreakdown: [{ departmentName: 'Fixture department', req_count: 1, total_headcount: 2 }],
      recentAudit: [{ email: 'not-rendered@example.invalid', attempted_at: '2026-10-05 14:15:00' }]
    } } });
    await vm.runInContext('loadDashboardData()', f.context);
    for (const [id, value] of Object.entries({ 'kpi-open-reqs': 7, 'kpi-total-candidates': 12, 'kpi-upcoming-interviews': 3, 'kpi-handover-alerts': 2, 'kpi-headcount-display': 9, 'funnel-applied': 6, 'funnel-screening': 2, 'funnel-interview': 2, 'funnel-offer': 1, 'funnel-hired': 1 })) assert.equal(Number(f.nodes.get(id).textContent), value);
    assert.match(f.nodes.get('dashboard-recent-reqs-body').innerHTML, /REQ-CLOCK/);
    assert.match(f.nodes.get('dashboard-upcoming-interviews-list').innerHTML, /Không có lịch phỏng vấn/);
    assert.match(f.nodes.get('dashboard-dept-breakdown-container').innerHTML, /Fixture department/);
    assert.equal(f.nodes.has('dashboard-recent-audit-logs'), false); assert.deepEqual(f.errors, []);
  });
  await test('dashboard', 'Refresh sends one stats request and no audit request or detail request', async () => {
    const f = await runtime('/dashboard'); f.requests.length = 0;
    await f.nodes.get('dashboard-refresh-btn').dispatch('click'); await f.settle();
    assert.equal(f.requests.filter(req => req.path === '/api/v1/dashboard/stats').length, 1);
    assert.equal(f.requests.some(req => req.path.includes('audit-logs')), false);
  });
  await test('dashboard', 'Login tracking, stored history, protected audit API and audit page remain', async () => {
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM login_audit_logs').get().count >= records.length + 2);
    assert.equal((await api('/admin/audit-logs/clock-normal', admin.token)).data.log.attempted_at, '2026-10-05 14:15:00');
    const f = await runtime('/dashboard'); f.window.ATS_ROUTER.navigate('/admin/audit'); await f.settle();
    assert.equal(f.window.location.pathname, '/admin/audit'); assert.match(f.nodes.get('audit-table-body').innerHTML, /clock-normal/);
  });
  await test('dashboard', 'Guest dashboard deep link redirects before fetching protected dashboard data', async () => {
    const f = await createFrontendRuntime(base, '/dashboard'); assert.equal(f.window.location.pathname, '/login');
    assert.equal(f.requests.some(req => req.path === '/api/v1/dashboard/stats'), false); assert.deepEqual(f.errors, []);
  });
  console.log('DATETIME_DASHBOARD_RESULT ' + JSON.stringify(results));
  process.exitCode = Object.values(results).some(group => group.failed) ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
