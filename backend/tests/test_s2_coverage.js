const assert = require('node:assert/strict');
const vm = require('node:vm');
const { openApplication, cases } = require('./helpers/coverageApplication');
const { createFrontendRuntime } = require('./helpers/frontendRuntime');
const { test, finish } = cases('S2_COVERAGE');

async function main() {
  const app = await openApplication();
  const ExcelJS = require('exceljs');
  const sharp = require('sharp');
  try {
    const admin = await app.login('admin@company.com');
    const hr = await app.login('hrmanager@company.com');
    const hiring = await app.login('hiringmgr@company.com');
    async function ok(method, route, body, expected = 200, token = hr.token, type) {
      const response = await app.api(method, route, token, body, type);
      assert.equal(response.status, expected, method + ' ' + route);
      assert.equal(response.data.success, true, method + ' ' + route);
      return response.data;
    }
    async function framework(code, names = ['Technical skill', 'Communication']) {
      return (await ok('POST', '/competency-frameworks', { code, name: code,
        criteria: names.map((name, index) => ({ name, weight: index === 0 ? 60 : 40 })) }, 201)).data;
    }
    async function title(code, frameworkId) {
      return (await ok('POST', '/job-titles', { code, name: code, level: 'Senior',
        minSalary: 15000000, maxSalary: 25000000, ...(frameworkId ? { frameworkId } : {}) }, 201)).data;
    }
    function sameErrors(row, expected) {
      assert.deepEqual(row.errors.map(error => ({ field: error.field, code: error.code })), expected);
    }

    const workbook = new ExcelJS.Workbook();
    const response = await fetch(app.base + '/api/v1/admin/users/import/template', { headers: { Authorization: 'Bearer ' + admin.token } });
    assert.equal(response.status, 200); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const sheet = workbook.getWorksheet('NhanSu'); assert.ok(sheet);
    sheet.getRow(2).values = ['Coverage valid A', 'coverage.import.a@test.example', 'Engineer', 'Internal', '0912345678', 'INTERVIEWER'];
    sheet.getRow(3).values = ['Coverage email error', 'invalid-address', 'Engineer', 'Internal', '', 'INTERVIEWER'];
    sheet.getRow(4).values = ['Coverage role error', 'coverage.import.role@test.example', 'Engineer', 'Internal', '', 'ROLE_NOT_DEFINED'];
    sheet.getRow(5).values = ['Coverage valid B', 'coverage.import.b@test.example', 'Engineer', 'Internal', '', 'RECRUITER'];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await test('S2-01', 'AC1/AC2', 'Excel preview errors map to exact row and distinct field/code; no writes', async () => {
      const before = (await app.db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
      const preview = await ok('POST', '/admin/users/import/preview', buffer, 200, admin.token, 'application/octet-stream');
      assert.deepEqual(preview.data.rows.map(row => row.rowNumber), [2, 3, 4, 5]);
      const [a, emailError, roleError, b] = preview.data.rows;
      assert.equal(a.valid, true); sameErrors(a, []); assert.equal(b.valid, true); sameErrors(b, []);
      assert.equal(emailError.rowNumber, 3); assert.equal(emailError.email, 'invalid-address'); assert.equal(emailError.valid, false);
      sameErrors(emailError, [{ field: 'email', code: 'INVALID_EMAIL' }]);
      assert.equal(roleError.rowNumber, 4); assert.equal(roleError.email, 'coverage.import.role@test.example'); assert.equal(roleError.valid, false);
      sameErrors(roleError, [{ field: 'roleCode', code: 'INVALID_ROLE_CODE' }]);
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS count FROM users').get()).count, before);
    });
    await test('S2-01', 'AC2/AC3', 'Import preserves row/error mapping and only valid rows persist', async () => {
      const imported = await ok('POST', '/admin/users/import', buffer, 200, admin.token, 'application/octet-stream');
      assert.equal(imported.data.summary.importedRows, 2); assert.equal(imported.data.summary.skippedRows, 2);
      assert.deepEqual(imported.data.rows.map(row => [row.rowNumber, row.status]),
        [[2, 'IMPORTED'], [3, 'SKIPPED'], [4, 'SKIPPED'], [5, 'IMPORTED']]);
      sameErrors(imported.data.rows[1], [{ field: 'email', code: 'INVALID_EMAIL' }]);
      sameErrors(imported.data.rows[2], [{ field: 'roleCode', code: 'INVALID_ROLE_CODE' }]);
      for (const email of ['coverage.import.a@test.example', 'coverage.import.b@test.example']) {
        assert.ok((await app.db.prepare('SELECT id FROM users WHERE email=?').get(email)));
      }
      for (const email of ['invalid-address', 'coverage.import.role@test.example']) {
        assert.equal((await app.db.prepare('SELECT id FROM users WHERE email=?').get(email)), undefined);
      }
    });

    await test('S2-02', 'AC1/AC2/AC3', 'Personal update -> independent GET and SQLite readback; protected fields unchanged', async () => {
      const before = (await ok('GET', '/profile', undefined, 200, hiring.token)).data;
      const beforeDepartment = (await app.db.prepare('SELECT department_id FROM users WHERE id=?').get(before.id)).department_id;
      await ok('PUT', '/profile/personal', { fullName: 'Coverage Nguyễn Văn A', jobTitle: 'Coverage Lead',
        phoneNumber: '+84 912 345 678', email: 'forbidden@test.example', departmentName: 'Forbidden',
        departmentId: 'forbidden-dept', roles: ['ADMIN'] }, 200, hiring.token);
      const after = (await ok('GET', '/profile', undefined, 200, hiring.token)).data;
      assert.equal(after.fullName, 'Coverage Nguyễn Văn A'); assert.equal(after.jobTitle, 'Coverage Lead');
      assert.equal(after.phoneNumber, '+84912345678'); assert.equal(after.email, before.email);
      assert.equal(after.departmentName, before.departmentName);
      assert.deepEqual(after.roles, before.roles);
      const row = (await app.db.prepare('SELECT full_name,job_title,phone_number,email,department_id FROM users WHERE id=?').get(after.id));
      assert.equal(row.full_name, after.fullName); assert.equal(row.job_title, after.jobTitle);
      assert.equal(row.phone_number, after.phoneNumber); assert.equal(row.email, before.email);
      assert.equal(row.department_id, beforeDepartment);
      const invalid = await app.api('PUT', '/profile/personal', hiring.token, { fullName: 'Must not persist', phoneNumber: '123' });
      assert.equal(invalid.status, 400);
      assert.equal((await ok('GET', '/profile', undefined, 200, hiring.token)).data.fullName, after.fullName);
    });
    await test('S2-02', 'compatibility', 'Legacy profile update also persists name/title/legacy phone via independent readback', async () => {
      await ok('PUT', '/profile', { fullName: 'Legacy Coverage Name', jobTitle: 'Legacy Coverage Title',
        phoneNumber: 'extension 321' }, 200, hiring.token);
      const after = (await ok('GET', '/profile', undefined, 200, hiring.token)).data;
      assert.equal(after.fullName, 'Legacy Coverage Name'); assert.equal(after.jobTitle, 'Legacy Coverage Title');
      assert.equal(after.phoneNumber, 'extension 321');
    });

    await test('S2-05', 'AC1/AC3; AC2 data contract', 'Standard salary contract persists for future consumers and HR-only reads', async () => {
      const saved = await title('COVERAGE-SALARY');
      const read = (await ok('GET', '/job-titles')).jobTitles.find(item => item.id === saved.id);
      assert.ok(read); assert.equal(read.code, 'COVERAGE-SALARY'); assert.equal(read.name, 'COVERAGE-SALARY');
      assert.equal(read.level, 'Senior'); assert.equal(read.minSalary, 15000000); assert.equal(read.maxSalary, 25000000);
      const row = (await app.db.prepare('SELECT min_salary,max_salary FROM job_titles WHERE id=?').get(saved.id));
      assert.equal(row.min_salary, read.minSalary); assert.equal(row.max_salary, read.maxSalary);
      await ok('PUT', '/job-titles/' + saved.id, { level: 'Lead', minSalary: 18000000, maxSalary: 30000000 });
      const updated = (await ok('GET', '/job-titles')).jobTitles.find(item => item.id === saved.id);
      assert.equal(updated.level, 'Lead'); assert.equal(updated.minSalary, 18000000); assert.equal(updated.maxSalary, 30000000);
      const hidden = (await ok('GET', '/job-titles', undefined, 200, admin.token)).jobTitles.find(item => item.id === saved.id);
      assert.equal('minSalary' in hidden, false); assert.equal('maxSalary' in hidden, false);
      // Actual Offer approval is DEFERRED CROSS-SPRINT ACCEPTANCE, not fabricated here.
    });

    let shared, titleA, titleB;
    await test('S2-06', 'AC1/AC2/AC3', 'Two separately assigned Job Titles read back the same framework and weights', async () => {
      shared = await framework('COVERAGE-SHARED'); titleA = await title('COVERAGE-TITLE-A'); titleB = await title('COVERAGE-TITLE-B');
      for (const item of [titleA, titleB]) await ok('PUT', '/job-titles/' + item.id, { frameworkId: shared.id });
      const titles = (await ok('GET', '/job-titles')).jobTitles;
      const a = titles.find(item => item.id === titleA.id), b = titles.find(item => item.id === titleB.id);
      assert.equal(a.framework.id, shared.id); assert.equal(b.framework.id, shared.id);
      const af = (await ok('GET', '/job-titles/' + titleA.id + '/framework')).data.framework;
      const bf = (await ok('GET', '/job-titles/' + titleB.id + '/framework')).data.framework;
      assert.equal(af.id, shared.id); assert.equal(bf.id, shared.id); assert.deepEqual(af.criteria, bf.criteria);
      assert.deepEqual(af.criteria.map(item => [item.name, item.weight]), [['Technical skill', 60], ['Communication', 40]]);
      assert.equal(af.criteria.reduce((sum, item) => sum + item.weight, 0), 100);
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM job_titles WHERE framework_id=?').get(shared.id)).n, 2);
    });
    await test('S2-06', 'AC1/AC2/AC3', 'Shared framework edits remain identical through both title readbacks', async () => {
      assert.ok(shared && titleA && titleB);
      await ok('PUT', '/competency-frameworks/' + shared.id, { criteria: shared.criteria.map((item, index) => ({
        id: item.id, name: item.name, weight: index === 0 ? 70 : 30 })) });
      const af = (await ok('GET', '/job-titles/' + titleA.id + '/framework')).data.framework;
      const bf = (await ok('GET', '/job-titles/' + titleB.id + '/framework')).data.framework;
      assert.deepEqual(af.criteria, bf.criteria); assert.deepEqual(af.criteria.map(item => item.weight), [70, 30]);
      assert.equal(af.totalWeight, 100);
      // Generation of Sprint 6 evaluation sheets is DEFERRED CROSS-SPRINT ACCEPTANCE.
    });

    let qa, qb, otherTitle;
    await test('S2-07', 'AC1/AC2', 'Questions persist criterion/difficulty/hint and updated values read back', async () => {
      const f = await framework('COVERAGE-QUESTION', ['Programming', 'Finance']);
      otherTitle = await title('COVERAGE-OTHER', f.id);
      qa = (await ok('POST', '/interview-questions', { criterionId: shared.criteria[0].id,
        questionText: 'Explain javascript event loop', difficulty: 'EASY', goodAnswerHint: 'Explain tasks' }, 201)).data;
      qb = (await ok('POST', '/interview-questions', { criterionId: f.criteria[1].id,
        questionText: 'Explain accounting entries', difficulty: 'HARD', goodAnswerHint: 'Explain ledger' }, 201)).data;
      let read = (await ok('GET', '/interview-questions')).questions;
      const a = read.find(item => item.id === qa.id), b = read.find(item => item.id === qb.id);
      assert.equal(a.criterion.id, shared.criteria[0].id); assert.equal(a.difficulty, 'EASY'); assert.equal(a.goodAnswerHint, 'Explain tasks');
      assert.equal(b.criterion.id, f.criteria[1].id); assert.equal(b.difficulty, 'HARD'); assert.equal(b.goodAnswerHint, 'Explain ledger');
      await ok('PUT', '/interview-questions/' + qa.id, { difficulty: 'MEDIUM', goodAnswerHint: 'Persisted microtask explanation' });
      read = (await ok('GET', '/interview-questions')).questions.find(item => item.id === qa.id);
      assert.equal(read.difficulty, 'MEDIUM'); assert.equal(read.goodAnswerHint, 'Persisted microtask explanation');
      const row = (await app.db.prepare('SELECT difficulty,good_answer_hint FROM interview_questions WHERE id=?').get(qa.id));
      assert.equal(row.difficulty, 'MEDIUM'); assert.equal(row.good_answer_hint, read.goodAnswerHint);
    });
    await test('S2-07', 'AC3', 'Keyword search includes javascript question and excludes accounting question', async () => {
      assert.ok(qa && qb);
      const matches = (await ok('GET', '/interview-questions?search=javascript')).questions.map(item => item.id);
      assert.ok(matches.includes(qa.id)); assert.equal(matches.includes(qb.id), false);
      const reverse = (await ok('GET', '/interview-questions?search=accounting')).questions.map(item => item.id);
      assert.ok(reverse.includes(qb.id)); assert.equal(reverse.includes(qa.id), false);
      const absent = await ok('GET', '/interview-questions?search=coverage-no-match-token'); assert.equal(absent.questions.length, 0);
    });
    await test('S2-07', 'AC3', 'Title/criterion/difficulty filters include matching and exclude nonmatching persisted questions', async () => {
      assert.ok(qa && qb && otherTitle);
      for (const query of ['jobTitleId=' + titleA.id, 'criterionId=' + shared.criteria[0].id, 'difficulty=MEDIUM',
        'jobTitleId=' + titleB.id + '&criterionId=' + shared.criteria[0].id + '&difficulty=MEDIUM']) {
        const ids = (await ok('GET', '/interview-questions?' + query)).questions.map(item => item.id);
        assert.ok(ids.includes(qa.id), query); assert.equal(ids.includes(qb.id), false, query);
      }
      const other = (await ok('GET', '/interview-questions?jobTitleId=' + otherTitle.id)).questions.map(item => item.id);
      assert.ok(other.includes(qb.id)); assert.equal(other.includes(qa.id), false);
    });

    const types = ['CANDIDATE_SOURCE', 'REJECTION_REASON', 'WORK_LOCATION', 'WORK_MODE'];
    for (const type of types) {
      await test('S2-08', 'AC1', type + ': real CREATE/READ/UPDATE/DELETE with persistence', async () => {
        const created = (await ok('POST', '/recruitment-catalogs', { type, code: 'COVERAGE-CRUD', name: 'Coverage initial', displayOrder: 4 }, 201)).data;
        let read = (await ok('GET', '/recruitment-catalogs?type=' + type)).items.find(item => item.id === created.id);
        assert.equal(read.name, 'Coverage initial'); assert.equal(read.type, type); assert.equal(read.displayOrder, 4);
        await ok('PUT', '/recruitment-catalogs/' + created.id, { name: 'Coverage updated', displayOrder: 9 });
        read = (await ok('GET', '/recruitment-catalogs?type=' + type)).items.find(item => item.id === created.id);
        assert.equal(read.name, 'Coverage updated'); assert.equal(read.displayOrder, 9);
        assert.equal((await app.db.prepare('SELECT name FROM recruitment_catalog_items WHERE id=?').get(created.id)).name, read.name);
        await ok('DELETE', '/recruitment-catalogs/' + created.id);
        assert.equal((await ok('GET', '/recruitment-catalogs?type=' + type)).items.some(item => item.id === created.id), false);
        assert.equal((await app.db.prepare('SELECT id FROM recruitment_catalog_items WHERE id=?').get(created.id)), undefined);
      });
      await test('S2-08', 'AC3', type + ': reorder C/A/B persists through independent GET and SQLite', async () => {
        const items = [];
        for (const letter of ['A', 'B', 'C']) items.push((await ok('POST', '/recruitment-catalogs', {
          type, code: 'COVERAGE-ORDER-' + letter, name: 'Coverage order ' + letter, displayOrder: items.length + 1
        }, 201)).data);
        const ordered = [items[2].id, items[0].id, items[1].id];
        await ok('PATCH', '/recruitment-catalogs/reorder', { type, orderedIds: ordered });
        const read = (await ok('GET', '/recruitment-catalogs?type=' + type)).items.filter(item => ordered.includes(item.id));
        assert.deepEqual(read.map(item => item.id), ordered); assert.deepEqual(read.map(item => item.displayOrder), [1, 2, 3]);
        for (let i = 0; i < ordered.length; i++) assert.equal(
          (await app.db.prepare('SELECT display_order FROM recruitment_catalog_items WHERE id=?').get(ordered[i])).display_order, i + 1);
      });
      await test('S2-08', 'AC2', type + ': referenced item deletion rejected; reference and item retained', async () => {
        const item = (await ok('POST', '/recruitment-catalogs', { type, code: 'COVERAGE-REF', name: 'Coverage referenced' }, 201)).data;
        const [table, column] = ({ CANDIDATE_SOURCE: ['candidates', 'source_id'], REJECTION_REASON: ['candidates', 'rejection_reason_id'],
          WORK_LOCATION: ['requisitions', 'work_location_id'], WORK_MODE: ['requisitions', 'work_mode_id'] })[type];
        const row = (await app.db.prepare(`SELECT id,${column} AS value FROM ${table} ORDER BY id LIMIT 1`).get()); assert.ok(row);
        // Arrange a real FK reference in the isolated fixture; DELETE still goes through the real API/service.
        (await app.db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(item.id, row.id));
        try {
          const deletion = await app.api('DELETE', '/recruitment-catalogs/' + item.id, hr.token);
          assert.equal(deletion.status, 409); assert.equal(deletion.data.code, 'CATALOG_ITEM_IN_USE');
          assert.ok((await ok('GET', '/recruitment-catalogs?type=' + type)).items.some(value => value.id === item.id));
          assert.equal((await app.db.prepare(`SELECT ${column} AS value FROM ${table} WHERE id=?`).get(row.id)).value, item.id);
          assert.deepEqual((await app.db.prepare('PRAGMA foreign_key_check').all()), []);
        } finally { (await app.db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(row.value, row.id)); }
      });
    }

    const logo = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#234567' } }).png().toBuffer();
    const hero = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#765432' } }).jpeg().toBuffer();
    await test('S2-09', 'AC1', 'Upload logo+hero -> save -> SQLite persistence -> real public API and assets', async () => {
      const logoUrl = (await ok('POST', '/career-page/media?kind=logo', logo, 200, hr.token, 'image/png')).data.url;
      const heroImageUrl = (await ok('POST', '/career-page/media?kind=hero', hero, 200, hr.token, 'image/jpeg')).data.url;
      const introduction = 'Coverage company introduction\nSecond authored line';
      await ok('PUT', '/career-page', { introduction, logoUrl, heroImageUrl });
      const publicResult = await app.api('GET', '/public/career-page'); assert.equal(publicResult.status, 200);
      const data = publicResult.data.data;
      assert.equal(data.introduction, introduction); assert.equal(data.logoUrl, logoUrl); assert.equal(data.heroImageUrl, heroImageUrl);
      assert.ok(data.updatedAt);
      const persisted = (await app.db.prepare('SELECT introduction,logo_url,hero_image_url FROM career_page_settings WHERE id=1').get());
      assert.equal(persisted.introduction, introduction); assert.equal(persisted.logo_url, logoUrl); assert.equal(persisted.hero_image_url, heroImageUrl);
      for (const url of [logoUrl, heroImageUrl]) {
        const asset = await fetch(app.base + url); assert.equal(asset.status, 200);
        const metadata = await sharp(Buffer.from(await asset.arrayBuffer())).metadata(); assert.equal(metadata.format, 'png');
      }
    });
    let f;
    function authoredNodes(container) {
      const result = [];
      function visit(node) { result.push(node); node.children.forEach(visit); }
      container.children.forEach(visit); return result;
    }
    await test('S2-09', 'AC2', 'Real unsaved preview interaction renders authored intro/media without saving settings', async () => {
      f = await createFrontendRuntime(app.base, '/admin/career-page', [['ats_token', hr.token], ['ats_user', JSON.stringify(hr.user)]]);
      const before = (await app.db.prepare('SELECT * FROM career_page_settings WHERE id=1').get());
      f.nodes.get('career-page-introduction-input').value = 'Frontend authored intro\nPersist and render this';
      const logoFile = new Blob([logo], { type: 'image/png' }); logoFile.name = 'coverage-logo.png';
      const heroFile = new Blob([hero], { type: 'image/jpeg' }); heroFile.name = 'coverage-hero.jpg';
      f.nodes.get('career-page-logo-input').files = [logoFile]; f.nodes.get('career-page-hero-input').files = [heroFile];
      await f.nodes.get('career-page-preview-btn').dispatch('click');
      const rendered = authoredNodes(f.nodes.get('career-page-preview-container'));
      assert.ok(rendered.some(node => node.textContent === 'Frontend authored intro\nPersist and render this'));
      assert.equal(rendered.filter(node => typeof node.src === 'string' && node.src.startsWith('blob:')).length, 2);
      assert.deepEqual((await app.db.prepare('SELECT * FROM career_page_settings WHERE id=1').get()), before);
      assert.equal(f.requests.some(row => row.method === 'PUT' && row.path === '/api/v1/career-page'), false);
      assert.deepEqual(f.errors, []);
    });
    await test('S2-09', 'AC1/AC2', 'Real frontend SAVE -> PUBLIC READ -> preview and public login rendering use persisted content/media', async () => {
      assert.ok(f);
      await f.nodes.get('career-page-save-btn').dispatch('click'); await f.settle();
      assert.equal(f.requests.filter(row => row.method === 'POST' && row.path === '/api/v1/career-page/media').length, 2);
      assert.equal(f.requests.filter(row => row.method === 'PUT' && row.path === '/api/v1/career-page').length, 1);
      const published = (await app.api('GET', '/public/career-page')).data.data;
      assert.equal(published.introduction, 'Frontend authored intro\nPersist and render this');
      assert.match(published.logoUrl, /^\/public\/company\/logo-/); assert.match(published.heroImageUrl, /^\/public\/company\/hero-/);
      const preview = authoredNodes(f.nodes.get('career-page-preview-container'));
      assert.ok(preview.some(node => node.textContent === published.introduction));
      assert.ok(preview.some(node => node.src === published.logoUrl)); assert.ok(preview.some(node => node.src === published.heroImageUrl));
      const guest = await createFrontendRuntime(app.base, '/login');
      assert.equal(guest.nodes.get('public-career-page-content').textContent, published.introduction);
      assert.equal(guest.nodes.get('login-company-logo').src, published.logoUrl);
      assert.equal(guest.nodes.get('login-background').src, published.heroImageUrl);
      // Loading hooks represent the browser image-load boundary; the bytes are fetched above via real HTTP.
      guest.nodes.get('login-company-logo').onload(); guest.nodes.get('login-background').onload();
      assert.equal(guest.nodes.get('login-company-logo').classList.contains('hidden'), false);
      assert.equal(guest.nodes.get('login-background').classList.contains('hidden'), false);
      assert.deepEqual(f.errors, []); assert.deepEqual(guest.errors, []);
      vm.runInContext('clearCareerPagePreviewObjectUrls()', f.context);
    });
  } finally { await app.close(); }
  finish();
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
