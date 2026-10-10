const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
if (fs.existsSync(path.join(root, '.git')) || fs.existsSync(path.join(root, '.env')) || fs.existsSync(path.join(root, 'backend/data/ats.db'))) {
  throw new Error('Run routing tests in an isolated TEMP copy without .git, .env or runtime database.');
}
process.env.NODE_ENV = 'test';
process.env.EMAIL_MODE = 'simulated';
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend/routes.json'), 'utf8'));
const { startServer, server } = require('../src/server');
let passed = 0, failed = 0;
async function test(name, action) {
  try { await action(); passed++; console.log('PASS ' + name); }
  catch(error) { failed++; console.error('FAIL ' + name, error); }
}
async function main() {
  await startServer(0);
  await require('../src/db/migrate-approval-configurations').migrate(require('../src/db/database').getDatabase());
  require('../src/config/config').APPROVAL_CONFIGURATION_ENABLED = true;
  await require('../src/db/migrate-requisition-approvals').migrate(require('../src/db/database').getDatabase());
  await require('../src/db/migrate-headcount-budgets').migrate(require('../src/db/database').getDatabase());
  require('../src/config/config').HEADCOUNT_BUDGET_ENABLED = true;
  const base = 'http://127.0.0.1:' + server.address().port;
  const shell = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  for (const route of manifest.routes) {
    await test('Direct open + refresh ' + route.path, async () => {
      for (const cache of ['default', 'reload']) {
        const res = await fetch(base + route.path, { headers: { Accept: 'text/html' }, cache });
        assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /^text\/html/);
        assert.equal(await res.text(), shell); assert.equal(res.headers.get('vary'), 'Accept');
      }
    });
  }
  await test('Trailing slash deep link', async () => {
    assert.equal((await fetch(base + '/admin/users/', {headers:{Accept:'text/html'}})).status, 200);
  });
  for (const file of ['/js/app.js', '/js/api.js', '/js/router.js', '/css/style.css', '/routes.json', ...manifest.scripts, ...manifest.fragments]) {
    await test('Static asset ' + file, async () => {
      const res = await fetch(base + file);
      assert.equal(res.status, 200); assert.equal(await res.text(), fs.readFileSync(path.join(root, 'frontend', file), 'utf8'));
    });
  }
  for (const url of ['/api', '/api/v1/no-such-route', '/api/unknown', '/js/no-such.js', '/css/no-such.css', '/pages/missing.html', '/no-such-page']) {
    await test('Real 404, no HTML fallback ' + url, async () => {
      const res = await fetch(base + url, {headers:{Accept:'text/html'}});
      assert.equal(res.status, 404); assert.match(res.headers.get('content-type'), /^application\/json/);
      assert.equal((await res.json()).code, 'NOT_FOUND');
    });
  }
  await test('API health stays JSON even with HTML Accept', async () => {
    const res = await fetch(base + '/api/v1/health', {headers:{Accept:'text/html'}});
    assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /^application\/json/);
  });
  for (const alias of ['/profile','/requisitions','/candidates','/interviews','/offers','/admin/users']) {
    await test('Legacy REST alias keeps JSON/default-deny ' + alias, async () => {
      const res = await fetch(base + alias, {headers:{Accept:'application/json'}});
      assert.equal(res.status, 401); assert.match(res.headers.get('content-type'), /^application\/json/);
      assert.equal(res.headers.get('vary'), 'Accept');
    });
  }
  await test('Fragments preserve unique IDs and every view/modal/form', async () => {
    const html = require('./helpers/frontendFixture').html();
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'Duplicate DOM id');
    for (const name of ['login','dashboard','requisitions','candidates','interviews','question-bank','offers','approvals','reports','departments','recruitment-catalogs','career-page','competencies','users','roles','audit','profile','candidate-portal','error']) assert.ok(ids.includes(name+'-view'));
    for (const form of ['login-form','forgot-form','otp-form','reset-form','create-user-form','create-req-form','department-form','job-title-form','competency-framework-form','question-bank-form']) assert.ok(ids.includes(form));
    assert.ok(!shell.includes('id="users-view"')); assert.ok(!shell.includes('id="login-form"'));
  });
  const sandbox = { URL, URLSearchParams };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/js/router.js'), 'utf8'), sandbox);
  function client(initial = '/login') {
    let user = false, access = true, index = 0;
    const entries = [initial], renders = [], errors = [], handlers = new Map();
    const location = {origin:'http://localhost',pathname:initial,search:''};
    function set(url) { const parsed = new URL(url, location.origin); location.pathname = parsed.pathname; location.search = parsed.search; }
    const router = sandbox.ATS_ROUTING.createRouter({routes:manifest.routes,location,
      history:{pushState(_,__,url){entries.splice(++index);entries[index]=url;set(url);},replaceState(_,__,url){entries[index]=url;set(url);}},
      events:{addEventListener(name,fn){handlers.set(name,fn);},removeEventListener(name){handlers.delete(name);}},
      authenticated:()=>user,allowed:()=>access,home:()=>'/dashboard',render:route=>renders.push(route.view),denied:(code)=>errors.push(code)});
    return {router,location,renders,errors,handlers,entries,login(){user=true;router.refresh();},deny(){access=false;},
      back(){if(index>0){set(entries[--index]);handlers.get('popstate')();}},forward(){if(index+1<entries.length){set(entries[++index]);handlers.get('popstate')();}}};
  }
  await test('Guest protected deep link never renders protected page; login recovers destination', async () => {
    const c=client('/admin/users');c.router.start();assert.equal(c.location.pathname,'/login');assert.deepEqual(c.renders,['login']);
    (await c.login());assert.equal(c.location.pathname,'/admin/users');assert.equal(c.renders.at(-1),'users');
  });
  await test('Root resolves login or authenticated home', async () => {
    const c=client('/');c.router.start();assert.equal(c.location.pathname,'/login');(await c.login());assert.equal(c.location.pathname,'/dashboard');
  });
  await test('Reset-token legacy link resolves reset route', () => {
    const c=client('/');c.location.search='?reset_token=test-only';c.router.start();assert.equal(c.location.pathname,'/reset-password');assert.equal(c.location.search,'?reset_token=test-only');
  });
  await test('Navigation changes URL without reload; Back/Forward restores page', async () => {
    const c=client();c.router.start();(await c.login());c.router.navigate('/admin/users');c.router.navigate('/requisitions');
    c.back();assert.equal(c.location.pathname,'/admin/users');assert.equal(c.renders.at(-1),'users');
    c.forward();assert.equal(c.location.pathname,'/requisitions');assert.equal(c.renders.at(-1),'requisitions');
  });
  await test('Default-deny blocks page render', async () => {
    const c=client();c.router.start();(await c.login());c.deny();const count=c.renders.length;c.router.navigate('/admin/users');
    assert.equal(c.renders.length,count);assert.deepEqual(c.errors,[403]);
  });
  await test('Unknown route 404; external navigation rejected', () => {
    const c=client('/missing');c.router.start();assert.deepEqual(c.errors,[404]);
    assert.equal(c.router.navigate('https://example.com/login'),false);assert.equal(c.router.navigate('/missing'),false);
  });
  await test('Router start is idempotent; stop removes listener', () => {
    const c=client();c.router.start();c.router.start();assert.equal(c.renders.length,1);assert.equal(c.handlers.size,1);c.router.stop();assert.equal(c.handlers.size,0);
  });
  const {createFrontendRuntime}=require('./helpers/frontendRuntime');
  let runtime;
  await test('Real bootstrap mounts fragments and loads all scripts without runtime errors', async () => {
    runtime=await createFrontendRuntime(base,'/dashboard');
    assert.equal(runtime.document.documentElement.dataset.appReady,'true');
    assert.deepEqual(runtime.errors,[]);assert.equal(runtime.window.location.pathname,'/login');
    assert.equal(runtime.requests.filter(req=>req.path==='/api/v1/dashboard/stats').length,0);
  });
  await test('Real login form recovers protected deep link and loads dashboard once', async () => {
    runtime.nodes.get('email').value='hrmanager@company.com';runtime.nodes.get('password').value='Ats@123456';
    await runtime.nodes.get('login-form').dispatch('submit');await runtime.settle();
    assert.equal(runtime.window.location.pathname,'/dashboard');assert.deepEqual(runtime.errors,[]);
    assert.equal(runtime.requests.filter(req=>req.path==='/api/v1/dashboard/stats').length,1);
  });
  for(const route of manifest.routes.filter(item=>item.auth&&item.view!=='candidatePortal')) {
    await test('Real page activation + API/render '+route.path, async()=>{
      if (route.view === 'audit') {
        // audit.read belongs to Admin; do not weaken the HR route guard for this test.
        await runtime.nodes.get('logout-btn').dispatch('click');
        runtime.nodes.get('email').value='admin@company.com';runtime.nodes.get('password').value='Ats@123456';
        await runtime.nodes.get('login-form').dispatch('submit');await runtime.settle();
      }
      runtime.window.ATS_ROUTER.navigate(route.path);await runtime.settle();
      assert.equal(runtime.window.location.pathname,route.path);
      const id=({questionBank:'question-bank',recruitmentCatalogs:'recruitment-catalogs',careerPage:'career-page'})[route.view]||route.view;
      assert.equal(runtime.nodes.get(id+'-view').classList.contains('hidden'),false);assert.deepEqual(runtime.errors,[]);
    });
  }
  await test('Repeat Dashboard/Users navigation keeps one listener and one request per activation',async()=>{
    const count=runtime.nodes.get('create-user-form').listeners.get('submit').length;
    runtime.requests.length=0;
    for(let i=0;i<3;i++){runtime.window.ATS_ROUTER.navigate('/dashboard');await runtime.settle();runtime.window.ATS_ROUTER.navigate('/admin/users');await runtime.settle();}
    assert.equal(runtime.nodes.get('create-user-form').listeners.get('submit').length,count);assert.equal(count,1);
    assert.equal(runtime.requests.filter(req=>req.path==='/api/v1/dashboard/stats').length,3);
    assert.equal(runtime.requests.filter(req=>req.path==='/api/v1/admin/users').length,3);
    assert.deepEqual(runtime.errors,[]);
  });
  await test('Real shell menu navigation, Back/Forward and modal cleanup',async()=>{
    await runtime.nodes.get('nav-item-requisitions').dispatch('click');await runtime.settle();
    assert.equal(runtime.window.location.pathname,'/requisitions');
    await runtime.back();assert.equal(runtime.window.location.pathname,'/admin/users');
    await runtime.forward();assert.equal(runtime.window.location.pathname,'/requisitions');
    runtime.nodes.get('create-user-modal').classList.remove('hidden');runtime.window.ATS_ROUTER.navigate('/profile');await runtime.settle();
    assert.ok(runtime.nodes.get('create-user-modal').classList.contains('hidden'));assert.deepEqual(runtime.errors,[]);
  });
  await test('Authenticated refresh/deep link retains session; logout clears protected UI',async()=>{
    const refreshed=await createFrontendRuntime(base,'/admin/users',[...runtime.storage]);
    assert.equal(refreshed.window.location.pathname,'/admin/users');
    assert.equal(refreshed.requests.filter(req=>req.path==='/api/v1/admin/users').length,1);
    await refreshed.nodes.get('logout-btn').dispatch('click');await refreshed.settle();
    assert.equal(refreshed.window.location.pathname,'/login');assert.ok(refreshed.nodes.get('app-shell').classList.contains('hidden'));
    assert.equal(refreshed.storage.get('ats_token'),undefined);assert.equal(refreshed.intervals.size,0);assert.deepEqual(refreshed.errors,[]);
  });
  await test('Hiring Manager default-deny on user page; candidate portal role uses existing menu',async()=>{
    const hiring=await createFrontendRuntime(base,'/admin/users');
    hiring.nodes.get('email').value='hiringmgr@company.com';hiring.nodes.get('password').value='Ats@123456';
    await hiring.nodes.get('login-form').dispatch('submit');await hiring.settle();
    assert.ok(!hiring.nodes.get('error-view').classList.contains('hidden'));assert.equal(hiring.nodes.get('error-code-display').textContent,403);
    assert.equal(hiring.requests.filter(req=>req.path==='/api/v1/admin/users').length,0);
    const candidate=await createFrontendRuntime(base);
    candidate.nodes.get('email').value='candidate@example.com';candidate.nodes.get('password').value='Ats@123456';
    await candidate.nodes.get('login-form').dispatch('submit');await candidate.settle();
    assert.equal(candidate.window.location.pathname,'/candidate');assert.ok(!candidate.nodes.get('candidate-portal-view').classList.contains('hidden'));assert.deepEqual(candidate.errors,[]);
  });
  await test('Forgot/OTP/Reset forms retain handlers and navigate correctly using mocks only',async()=>{
    const auth=await createFrontendRuntime(base);
    let requested,verified,reset;
    auth.window.ATS_API.requestPasswordResetApi=async email=>{requested=email;return{ok:true,data:{success:true,message:'Thông báo chung'}};};
    auth.window.ATS_API.verifyOtpApi=async(email,otp)=>{verified={email,otp};return{ok:true,data:{success:true,resetToken:'routing-test-token'}};};
    auth.window.ATS_API.confirmPasswordResetApi=async(token,password)=>{reset={token,password};return{ok:true,data:{success:true}};};
    await auth.nodes.get('open-forgot-pwd-btn').dispatch('click');assert.equal(auth.window.location.pathname,'/forgot-password');
    auth.nodes.get('forgot-email').value='registered@test.example';await auth.nodes.get('forgot-form').dispatch('submit');
    assert.equal(requested,'registered@test.example');assert.ok(!auth.nodes.get('otp-form').classList.contains('hidden'));
    assert.match(auth.nodes.get('otp-notice').textContent,/5 phút/);assert.equal(auth.intervals.size,1);
    auth.nodes.get('forgot-otp-input').value='123456';await auth.nodes.get('otp-form').dispatch('submit');
    assert.deepEqual(verified,{email:'registered@test.example',otp:'123456'});assert.equal(auth.window.location.pathname,'/reset-password');
    assert.equal(auth.nodes.get('reset-token-input').value,'routing-test-token');assert.equal(auth.window.location.search,'');assert.equal(auth.intervals.size,0);
    auth.nodes.get('reset-new-password').value='Routing123!';auth.nodes.get('reset-confirm-password').value='Routing123!';
    await auth.nodes.get('reset-form').dispatch('submit');assert.deepEqual(reset,{token:'routing-test-token',password:'Routing123!'});
    assert.equal(auth.window.location.pathname,'/login');assert.deepEqual(auth.errors,[]);
    assert.equal(auth.requests.filter(req=>/^\/api\/v1\/auth\/(forgot-password|verify-otp|reset-password)/.test(req.path)).length,0);
  });
  await test('Page leave cancels audit debounce without stopping session heartbeat',async()=>{
    const admin=await createFrontendRuntime(base,'/admin/audit');
    admin.nodes.get('email').value='admin@company.com';admin.nodes.get('password').value='Ats@123456';
    await admin.nodes.get('login-form').dispatch('submit');await admin.settle();
    await admin.nodes.get('audit-search-input').dispatch('input');
    const timer=vm.runInContext('auditDebounceTimer',admin.context);assert.ok(admin.timeouts.has(timer));
    admin.window.ATS_ROUTER.navigate('/dashboard');await admin.settle();
    assert.ok(!admin.timeouts.has(timer));assert.equal(admin.intervals.size,1);assert.deepEqual(admin.errors,[]);
  });
  await test('Every extracted form binds once, including Sprint 2 department/framework/catalog forms',()=>{
    for(const id of ['login-form','forgot-form','otp-form','reset-form','change-pwd-form','create-user-form','edit-user-form','assign-roles-form','lock-user-form','create-req-form','reassign-handover-form','department-form','competency-framework-form','job-title-form','question-bank-form','recruitment-catalog-form','edit-profile-form','create-candidate-form','schedule-interview-form','create-offer-form','req-detail-form']) {
      assert.equal(runtime.nodes.get(id)?.listeners.get('submit')?.length,1,id+' submit must bind once');
    }
  });
  await test('Invalid session deep link redirects without protected page data',async()=>{
    const invalid=await createFrontendRuntime(base,'/admin/users',[['ats_token','invalid-test-token']]);
    assert.equal(invalid.window.location.pathname,'/login');assert.equal(invalid.storage.size,0);
    assert.equal(invalid.requests.filter(req=>req.path==='/api/v1/admin/users').length,0);assert.deepEqual(invalid.errors,[]);
  });
  await test('Forgot page leave/back resumes original cooldown without a background interval',async()=>{
    const auth=await createFrontendRuntime(base,'/forgot-password');
    auth.nodes.get('otp-form').classList.remove('hidden');
    vm.runInContext('startResendCooldown(30)',auth.context);assert.equal(auth.intervals.size,1);
    auth.window.ATS_ROUTER.navigate('/login');assert.equal(auth.intervals.size,0);
    auth.window.ATS_ROUTER.navigate('/forgot-password');assert.equal(auth.intervals.size,1);
    assert.match(auth.nodes.get('resend-otp-btn').textContent,/\((29|30)s\)/);
    auth.window.ATS_ROUTER.navigate('/login');assert.equal(auth.intervals.size,0);assert.deepEqual(auth.errors,[]);
  });
  await test('Global search sets filter before guarded navigation and issues one candidate request',async()=>{
    runtime.window.ATS_ROUTER.navigate('/profile');await runtime.settle();runtime.requests.length=0;
    runtime.nodes.get('global-search-input').value='RoutingSearch';
    await runtime.nodes.get('global-search-input').dispatch('keydown',{key:'Enter'});await runtime.settle();
    assert.equal(runtime.window.location.pathname,'/candidates');
    const calls=runtime.requests.filter(req=>req.path==='/api/v1/candidates');assert.equal(calls.length,1);
    // Existing candidate search normalizes the query to lowercase.
    assert.equal(new URLSearchParams(calls[0].search).get('search'),'routingsearch');assert.deepEqual(runtime.errors,[]);
  });
  console.log('ROUTING_RESULT ' + JSON.stringify({passed,failed,total:passed+failed}));
  process.exitCode = failed ? 1 : 0;
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
