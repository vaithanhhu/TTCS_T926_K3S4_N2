const assert = require('node:assert/strict');
const { openApplication } = require('./helpers/coverageApplication');
const Service = require('../src/services/slaNotificationService');
const Reference = require('./fixtures/slaReference20261022');

async function main() {
  const app = await openApplication();
  const methods = ['calculateCandidateSla', 'getOverdueCandidates', 'prepareCandidateSlaBatch'];
  const optimized = Object.fromEntries(methods.map(k => [k, Service.prototype[k]]));
  assert.equal(typeof optimized.prepareCandidateSlaBatch, 'function');
  const tokens = {};
  let pairs = 0;
  const NativeDate = Date;
  const instant = NativeDate.now();
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
    static [Symbol.hasInstance](value) { return value instanceof NativeDate; }
  };
  async function compare(route, token) {
    const session = token ? await app.db.prepare('SELECT * FROM sessions WHERE token=?').get(token) : null;
    let before;
    try {
      Service.prototype.calculateCandidateSla = Reference.prototype.calculateCandidateSla;
      Service.prototype.getOverdueCandidates = Reference.prototype.getOverdueCandidates;
      Service.prototype.prepareCandidateSlaBatch = async () => null;
      before = await app.api('GET', route, token);
    } finally { Object.assign(Service.prototype, optimized); }
    // Expiry validation deletes a session. Give each implementation the same
    // isolated starting row rather than comparing expired vs already-deleted.
    if (session && !await app.db.prepare('SELECT token FROM sessions WHERE token=?').get(token)) {
      const columns = Object.keys(session);
      await app.db.prepare(`INSERT INTO sessions(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(session));
    }
    const after = await app.api('GET', route, token);
    assert.deepStrictEqual(after, before, route);
    pairs++;
    return after;
  }
  try {
    for (const email of ['hrmanager@company.com', 'recruiter@company.com', 'recruiter2@company.com', 'interviewer@company.com', 'candidate@example.com']) {
      tokens[email] = (await app.login(email)).token;
    }
    const routes = ['/sla/overdue-candidates?includeAll=true', '/sla/overdue-candidates',
      '/sla/overdue-candidates?includeAll=true&stage=NEW', '/sla/overdue-candidates?search=zz-no-result',
      '/candidates?advanced=1&page=1&pageSize=1', '/candidates?advanced=1&page=2&pageSize=1',
      '/candidates?advanced=1&pageSize=50&stage=NEW', '/candidates?advanced=1&search=zz-no-result',
      '/candidates?advanced=1&stage=BAD', '/candidates'];
    for (const route of routes) {
      assert.equal((await compare(route)).status, 401);
      for (const token of Object.values(tokens)) await compare(route, token);
    }
    const token = tokens['hrmanager@company.com'];
    await app.db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').run('2000-01-01T00:00:00Z', token);
    assert.equal((await compare(routes[0], token)).status, 401);
    assert.equal((await compare(routes[4], token)).status, 401);
    console.log('SLA_HTTP_REFERENCE_PARITY_PASS response pairs=' + pairs);
  } finally {
    global.Date = NativeDate;
    Object.assign(Service.prototype, optimized);
    await app.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
