const http = require('http');

function req(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5050,
      path,
      method,
      headers: { ...headers }
    };
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function test() {
  console.log('1. Login dev1 with Ats@123456...');
  const l1 = await req('POST', '/api/v1/auth/login', {}, { email: 'dev1@company.com', password: 'Ats@123456' });
  console.log('L1 status:', l1.status, l1.body.success, l1.body.data?.token?.substring(0, 10));

  const token = l1.body.data?.token;

  console.log('2. Change password to NewPassword@2026...');
  const cp = await req('POST', '/api/v1/auth/change-password', { Authorization: `Bearer ${token}` }, {
    currentPassword: 'Ats@123456',
    newPassword: 'NewPassword@2026'
  });
  console.log('CP status:', cp.status, cp.body);

  console.log('3. Logout...');
  const lo = await req('POST', '/api/v1/auth/logout', { Authorization: `Bearer ${token}` });
  console.log('LO status:', lo.status, lo.body);

  console.log('4. Try login with Old password Ats@123456...');
  const lOld = await req('POST', '/api/v1/auth/login', {}, { email: 'dev1@company.com', password: 'Ats@123456' });
  console.log('Login with Old password status:', lOld.status, lOld.body);

  console.log('5. Try login with New password NewPassword@2026...');
  const lNew = await req('POST', '/api/v1/auth/login', {}, { email: 'dev1@company.com', password: 'NewPassword@2026' });
  console.log('Login with New password status:', lNew.status, lNew.body);
}

test().catch(console.error);
