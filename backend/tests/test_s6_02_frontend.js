const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const assert=require('node:assert/strict');

async function main() {
  const root=path.resolve(__dirname,'../..');
  const html='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fs.readFileSync(path.join(root,'frontend/css/style.css'),'utf8')+'</style><button id="open-create-interview-modal-btn">Open</button>'+['schedule-interview-modal.html','interview-detail-modal.html'].map(file => fs.readFileSync(path.join(root,'frontend/components',file),'utf8')).join('')+'<table><tbody id="interviews-table-body"></tbody></table><span id="interviews-total-badge"></span>';
  const server=http.createServer((req,res) => {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser=await require('playwright').chromium.launch({headless:true});
  const output=process.env.ATS_E2E_ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(),'ats-s602-browser-'));
  fs.mkdirSync(output,{recursive:true});
  let passed=0;
  try {
    for(const [width,height,timezoneId] of [[1366,768,'Asia/Ho_Chi_Minh'],[390,844,'Asia/Ho_Chi_Minh'],[1366,768,'UTC']]) {
      const page=await browser.newPage({viewport:{width,height},timezoneId});
      const errors=[];
      page.on('pageerror',error => errors.push(error.message));
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.evaluate(() => {
        sessionStorage.setItem('ats_token','synthetic-test-token');
        window.currentCandidatesList=[{id:'c',fullName:'Synthetic candidate',requisition:{id:'r',title:'Synthetic position'}}];
        window.currentRequisitionsList=[{id:'r',title:'Synthetic position'}];
        window.currentInterviewsList=[];
        window.currentAuthenticatedUser={id:'recruiter',roles:['RECRUITER'],permissions:['interview.create']};
        window.escapeHtml=value => String(value??'').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        window.escapeDepartmentHtml=window.escapeHtml;
        window.formatCandCode=() => 'TEST';
        window.messages=[];window.showToast=(...args) => window.messages.push(args);
        window.loadCandidates=() => {};window.loadDashboardData=() => {};window.ATS_APP_HELPERS={};window.calls=[];
        window.ATS_API={
          getInterviewOptionsApi:async () => ({ok:true,data:{interviewers:[{id:'i1',fullName:'Primary'},{id:'i2',fullName:'Panel'}]}}),
          createInterviewApi:async (token,payload) => {window.calls.push(payload);return {ok:true,data:{success:true}};},
          getInterviewsApi:async () => ({ok:true,data:{success:true,interviews:[{id:'iv',candidate:{id:'c',fullName:'Synthetic candidate'},interviewer:{id:'i1',fullName:'Primary'},interviewers:[{id:'i1',fullName:'Primary'},{id:'i2',fullName:'Panel'}],scheduledTime:'2030-06-01T02:00:00Z',status:'SCHEDULED'}]}})
        };
      });
      for(const file of ['frontend/js/components/interview-dialogs.js','frontend/js/components/modal-focus.js','frontend/js/pages/interviews.js']) await page.addScriptTag({path:path.join(root,file)});
      const open=async () => {
        await page.locator('#open-create-interview-modal-btn').click();
        await page.waitForFunction(() => document.getElementById('schedule-interviewer-select').options.length===3);
        await page.locator('#schedule-candidate-select').selectOption('c');
        await page.locator('#schedule-interviewer-select').selectOption('i1');
        await page.locator('.schedule-co-interviewer-chk[value="i2"]').check();
        await page.locator('#schedule-time').fill('2030-06-01T09:00');
      };
      await open();
      assert.equal(await page.locator('#schedule-meeting-link').getAttribute('type'),'url');
      assert.equal(await page.locator('#schedule-meeting-link').evaluate(node => node.required),true);
      await page.locator('#submit-schedule-interview-btn').click();
      assert.equal(await page.evaluate(() => window.calls.length),0);
      await page.locator('#schedule-duration-select').selectOption('45');
      await page.locator('#schedule-meeting-link').fill('https://example.invalid/meeting');
      await page.locator('#submit-schedule-interview-btn').click();
      await page.waitForFunction(() => window.calls.length===1 && document.getElementById('schedule-interview-modal').classList.contains('hidden'));
      const first=await page.evaluate(() => window.calls[0]);
      assert.deepEqual(first.interviewerIds,['i1','i2']);assert.equal(first.durationMinutes,45);assert.equal(first.interviewFormat,'ONLINE');
      assert.equal(first.meetingLink,'https://example.invalid/meeting');
      assert.equal(first.scheduledTime,'2030-06-01T09:00');
      assert.match((await page.evaluate(() => window.messages.at(-1))).join(' '),/đã được lưu/);
      assert.doesNotMatch((await page.evaluate(() => window.messages.at(-1))).join(' '),/gửi lời mời/);
      await open();
      await page.locator('#schedule-format-select').selectOption('IN_PERSON');
      assert.equal(await page.locator('#schedule-meeting-room').evaluate(node => node.required&&!node.disabled),true);
      assert.equal(await page.locator('#schedule-meeting-link').isDisabled(),true);
      await page.locator('#submit-schedule-interview-btn').click();
      assert.equal(await page.evaluate(() => window.calls.length),1);
      await page.locator('#schedule-meeting-room').fill('Synthetic room');
      const dimensions=await page.locator('#schedule-interview-modal .modal-card').boundingBox();
      assert.ok(dimensions.width<=width);
      await page.locator('#submit-schedule-interview-btn').focus();await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.getElementById('schedule-interview-modal').contains(document.activeElement)),true);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#schedule-interview-modal').isHidden(),true);
      await open();
      await page.locator('#schedule-format-select').selectOption('IN_PERSON');await page.locator('#schedule-meeting-room').fill('Synthetic room');
      await page.locator('#submit-schedule-interview-btn').click();await page.waitForFunction(() => window.calls.length===2);
      const second=await page.evaluate(() => window.calls[1]);assert.equal(second.meetingRoom,'Synthetic room');assert.equal(second.meetingLink,null);
      await page.evaluate(() => loadInterviews());
      assert.match(await page.locator('#interviews-table-body').innerText(),/09:00/);
      await page.evaluate(() => {window.currentAuthenticatedUser={id:'i2',roles:['INTERVIEWER'],permissions:['interview.read','interview.evaluate']};openInterviewDetails('iv');});
      assert.equal(await page.locator('#int-eval-feedback').isDisabled(),true);assert.equal(await page.locator('#int-eval-score').isDisabled(),true);
      await page.evaluate(() => {window.currentAuthenticatedUser.id='i1';openInterviewDetails('iv');});
      assert.equal(await page.locator('#int-eval-feedback').isDisabled(),false);
      assert.match(await page.locator('#int-detail-time').innerText(),/09:00/);
      assert.deepEqual(errors,[]);
      await page.screenshot({path:path.join(output,'s602-'+width+'-'+timezoneId.replaceAll('/','_')+'.png'),fullPage:true});
      await page.close();passed++;
      console.log('PASS S602 modal, validation, panel, timezone, focus, responsive and evaluation controls '+width+' '+timezoneId);
    }
    console.log(JSON.stringify({frontendContextsPassed:passed,frontendContextsFailed:0,output}));
  } finally {await browser.close();server.closeAllConnections();await new Promise(resolve => server.close(resolve));}
}

main().catch(error => {console.error(error);process.exitCode=1;});
