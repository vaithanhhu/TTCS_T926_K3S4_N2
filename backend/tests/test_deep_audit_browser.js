const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
assert.equal(fs.existsSync(path.join(root,'.git')),false);
assert.equal(fs.existsSync(path.join(root,'.env')),false);
const results=[];
async function main() {
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><body></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  const helper=fs.readFileSync(path.join(root,'frontend/js/components/candidate-dialogs.js'),'utf8').match(/  function escapeHtml\(str\) \{[\s\S]*?\n  \}/)[0];
  const payload='<img src=x onerror="window.__auditXss=1">';
  const checks=[
    ['candidates','loadCandidates','<table><tbody id="candidates-table-body"></tbody></table><button id="open-referral-modal-btn">Referral</button><div id="referral-modal" class="hidden"><select id="referral-req-select"></select></div>'],
    ['interviews','loadInterviews','<table><tbody id="interviews-table-body"></tbody></table>'],
    ['offers','loadOffers','<table><tbody id="offers-table-body"></tbody></table>'],
    ['dashboard','loadDashboardData','<table><tbody id="dashboard-recent-reqs-body"></tbody></table><div id="dashboard-upcoming-interviews-list"></div><div id="dashboard-dept-breakdown-container"></div>'],
    ['reports','loadReports','<table><tbody id="report-dept-table-body"></tbody></table>']
  ];
  try {
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) for(const [name,method,markup] of checks) {
      const page=await browser.newPage({viewport});
      try {
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.setContent(markup);
        await page.evaluate(({payload})=>{
          sessionStorage.setItem('ats_token','isolated-fixture');window.__auditXss=0;
          window.currentAuthenticatedUser={id:'admin',roles:['ADMIN'],permissions:[]};window.currentCandidatesList=[];window.currentRequisitionsList=[];
          window.STAGE_BADGES={};window.STAGE_LABELS={};window.renderUserAvatar=(el,user,text)=>{el.textContent=text.charAt(0);};
          const candidate={id:'cand-1',fullName:payload,email:payload,phoneNumber:payload,stage:'NEW',requisition:{title:payload},createdAt:'2026-01-01'};
          const requisition={id:'req-1',code:'REQ-1',title:payload,departmentName:payload,status:'OPEN',headcount:1};
          window.currentRequisitionsList=[requisition];
          const interview={id:'int-1',candidate,interviewer:{fullName:payload},requisition,status:'SCHEDULED',locationOrLink:payload,scheduledTime:'2026-01-01'};
          const offer={id:'off-1',candidate,requisition,status:'SENT',salaryMonthly:100};
          const response=data=>({ok:true,data:{success:true,...data}});
          window.ATS_API={getCandidatesApi:async()=>response({candidates:[candidate]}),getInterviewsApi:async()=>response({interviews:[interview]}),getOffersApi:async()=>response({offers:[offer]}),getDashboardStats:async()=>response({stats:{recentRequisitions:[requisition],upcomingInterviews:[{candidate_name:payload,requisition_title:payload,interviewer_name:payload}],departmentBreakdown:[{departmentName:payload}]}}),getRecruitmentReportsApi:async()=>response({report:{departmentPerformance:[{departmentName:payload}]}})};
        },{payload});
        await page.addScriptTag({content:helper});
        await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/js/pages',name+'.js'),'utf8')});
        await page.evaluate(method=>window[method](),method);
        if(name==='candidates') {
          await page.locator('#open-referral-modal-btn').click();
          await page.waitForFunction(()=>document.querySelector('#referral-req-select').options.length>1);
          assert.equal(await page.locator('#referral-req-select option').nth(1).textContent(),'REQ-1 - '+payload);
        }
        await page.waitForTimeout(50);
        assert.equal(await page.locator('img').count(),0,name+' must not create payload elements');
        assert.equal(await page.evaluate(()=>window.__auditXss),0);
        assert.ok((await page.locator('body').innerText()).includes(payload),name+' must retain the literal value');
        results.push({name,viewport,status:'PASS'});
      } catch(error) {results.push({name,viewport,status:'FAIL',message:error.message});}
      finally {await page.close();}
    }
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
      const page=await browser.newPage({viewport});
      try {
        await page.goto('http://127.0.0.1:'+server.address().port);
        await page.setContent('<select id="int-eval-score"><option value="4">4</option><option value="5">5</option></select>');
        await page.evaluate(()=>{window.currentAuthenticatedUser={id:'admin',roles:['ADMIN'],permissions:['interview.evaluate']};window.currentInterviewsList=[];});
        await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/js/components/interview-dialogs.js'),'utf8')});
        for(const score of [9,0]) {
          await page.evaluate(score=>{window.currentInterviewsList=[{id:'score',score}];openInterviewDetails('score');},score);
          assert.equal(await page.locator('#int-eval-score').inputValue(),String(score));
        }
        results.push({name:'existing interview score survives detail rendering',viewport,status:'PASS'});
      } catch(error) {results.push({name:'existing interview score survives detail rendering',viewport,status:'FAIL',message:error.message});}
      finally {await page.close();}
    }
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
      const page=await browser.newPage({viewport});
      try {
        await page.goto('http://127.0.0.1:'+server.address().port);
        let observed;
        await page.route('**/api/v1/rbac/matrix',route=>{observed={url:route.request().url(),headers:route.request().headers()};return route.fulfill({status:200,contentType:'application/json',body:'{"success":true}'});});
        await page.addScriptTag({content:fs.readFileSync(path.join(root,'frontend/js/api.js'),'utf8')});
        assert.equal(await page.evaluate(async()=>(await window.ATS_API.getRolesMatrixApi('audit-bearer-fixture')).ok),true);
        assert.equal(observed.headers.authorization,'Bearer audit-bearer-fixture');
        assert.equal(observed.url.includes('audit-bearer-fixture'),false);
        results.push({name:'role matrix consumer sends authenticated Bearer',viewport,status:'PASS'});
      } catch(error) {results.push({name:'role matrix consumer sends authenticated Bearer',viewport,status:'FAIL',message:error.message});}
      finally {await page.close();}
    }
    process.env.ATS_LOCAL_DEMO='true';
    const flags=['APPROVAL_CONFIGURATION_ENABLED','REQUISITION_APPROVAL_ENABLED','HEADCOUNT_BUDGET_ENABLED','REQUISITION_OPERATIONS_ENABLED','REQUISITION_LIFECYCLE_ENABLED','REQUISITION_TRACKING_ENABLED','JOB_POSTING_DRAFTS_ENABLED','JOB_POSTING_PUBLICATION_ENABLED','CANDIDATE_PORTAL_ENABLED'];
    for(const flag of flags)process.env[flag]='true';
    const app=await require('./helpers/coverageApplication').openApplication(async db=>{
      await db.transaction(()=>require('../src/db/seed').seedDatabase(db));
      for(const migration of ['migrate-approval-configurations','migrate-requisition-approvals','migrate-headcount-budgets','migrate-requisition-operations','migrate-requisition-lifecycle','migrate-requisition-tracking-job-drafts','migrate-job-publication','migrate-candidate-portal','migrate-requisition-open-policy'])await require('../src/db/'+migration).migrate(db);
      const config=require('../src/config/config');for(const flag of flags)config[flag]=true;
      await require('../src/db/seed-local-demo').seedLocalDemo(db);
    });
    try {
      for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
        const page=await browser.newPage({viewport});
        try {
          const posting=(await app.db.prepare("SELECT id FROM job_postings WHERE status='PUBLISHED' ORDER BY id LIMIT 1").get()).id;
          const form=new FormData();
          for(const [key,value] of Object.entries({jobPostingId:posting,fullName:payload,email:'xss-'+viewport.width+'@audit.test',phoneNumber:'0901234567'}))form.append(key,value);
          form.append('cvFile',new Blob([Buffer.from('%PDF-1.4\nIsolated synthetic CV\n%%EOF')],{type:'application/pdf'}),'fixture.pdf');
          const response=await fetch(app.base+'/api/v1/public/applications',{method:'POST',body:form});assert.equal(response.status,201);
          const application=await response.json();
          const stored=await app.db.prepare('SELECT full_name FROM candidates WHERE id=?').get(application.data.candidateId);assert.equal(stored.full_name,payload);
          await page.addInitScript(()=>{window.__auditXss=0;});
          await page.goto(app.base+'/login');
          await page.locator('#email').fill('admin@company.com');await page.locator('#password').fill('Ats@123456');
          await page.locator('#login-form button[type="submit"]').click();await page.waitForURL('**/admin');
          await page.goto(app.base+'/candidates');
          await page.locator('#candidates-table-body').getByText(payload,{exact:true}).first().waitFor();
          assert.equal(await page.locator('#candidates-table-body img[src="x"]').count(),0);
          assert.equal(await page.evaluate(()=>window.__auditXss),0);
          results.push({name:'public CV submission to authenticated candidate table is XSS safe',viewport,status:'PASS'});
        } catch(error) {results.push({name:'public CV submission to authenticated candidate table is XSS safe',viewport,status:'FAIL',message:error.message});}
        finally {await page.close();}
      }
    } finally {await app.close();}
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
  const result={passed:results.filter(x=>x.status==='PASS').length,failed:results.filter(x=>x.status==='FAIL').length,results};
  if(process.env.ATS_DEEP_AUDIT_RESULT)fs.writeFileSync(process.env.ATS_DEEP_AUDIT_RESULT,JSON.stringify(result,null,2));
  console.log('DEEP_BROWSER_RESULT '+JSON.stringify(result));process.exitCode=result.failed?1:0;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
