const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');

async function main(){
  const root=path.resolve(__dirname,'../..');
  const toolbar=fs.readFileSync(path.join(root,'frontend/pages/candidates.html'),'utf8').match(/<div id="bulk-interview-toolbar"[\s\S]*?<\/div>/)[0];
  const table='<table><tbody id="candidates-table-body"><tr data-id="a"><td>A</td></tr><tr data-id="b"><td>B</td></tr><tr data-id="public"><td>Public DTO</td></tr></tbody></table>';
  const html='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="ats-api-base" content="/api/v1"><style>'+fs.readFileSync(path.join(root,'frontend/css/style.css'),'utf8')+'</style><div id="app-shell"><div id="candidates-view">'+toolbar+table+'</div></div>'+fs.readFileSync(path.join(root,'frontend/components/bulk-interview-modal.html'),'utf8');
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await require('playwright').chromium.launch({headless:true});
  let passed=0;
  try{
    for(const [width,height,timezoneId] of [[1366,768,'Asia/Ho_Chi_Minh'],[390,844,'Asia/Ho_Chi_Minh'],[360,800,'Asia/Ho_Chi_Minh'],[1366,768,'UTC']]){
      const page=await browser.newPage({viewport:{width,height},timezoneId}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
      await page.evaluate(()=>{
        window.currentAuthenticatedUser={id:'recruiter',roles:['RECRUITER'],permissions:['interview.create']};sessionStorage.setItem('ats_token','synthetic-test-token');
        window.showToast=(...args)=>window.lastToast=args;
        window.rows=[{id:'a',fullName:'A',requisition:{id:'r'}},{id:'b',fullName:'B',requisition:{id:'r'}},{id:'public',fullName:'Public DTO',status:'RECEIVED'}];
        window.calls=[];window.confirmAttempts=0;window.stale=false;
      });
      await page.addScriptTag({path:path.join(root,'frontend/js/api.js')});
      await page.evaluate(()=>{
        const actual=window.ATS_API.bulkInterviewsApi;
        window.fetch=async(url,options)=>{window.fetchProbe={url,options};return {ok:true,status:200,json:async()=>({success:true})};};
        window.apiProbe=actual('synthetic-test-token','bulk-preview',{test:true});
        window.ATS_API.getInterviewOptionsApi=async()=>({ok:true,data:{interviewers:[{id:'i1',fullName:'Primary'},{id:'i2',fullName:'Panel'}]}});
        window.ATS_API.bulkInterviewsApi=async(token,action,body)=>{
          window.calls.push({token,action,body});
          if(action==='bulk-preview')return {ok:!window.stale,status:window.stale?409:200,data:{success:!window.stale,code:window.stale?'BULK_PREVIEW_STALE':undefined,fingerprint:'a'.repeat(64),errors:[],slots:body.candidateIds.map((id,index)=>({candidateId:id,fullName:id.toUpperCase(),start:index?'2032-06-01T02:40:00Z':'2032-06-01T02:00:00Z',end:index?'2032-06-01T03:10:00Z':'2032-06-01T02:30:00Z',roundName:body.roundName,interviewers:[{fullName:'Primary'},{fullName:'Panel'}],meetingLink:body.meetingLink}))}};
          window.confirmAttempts++;
          if(window.confirmAttempts===1)return {ok:false,status:0,data:{message:'Synthetic network timeout'}};
          await new Promise(resolve=>setTimeout(resolve,50));
          return {ok:true,status:200,data:{success:true,batchId:'batch',interviews:[{id:'1'},{id:'2'}],deliveries:[{state:'SIMULATED'},{state:'SIMULATED'}]}};
        };
      });
      await page.addScriptTag({path:path.join(root,'frontend/js/components/modal-focus.js')});
      await page.addScriptTag({path:path.join(root,'frontend/js/components/bulk-interview-dialog.js')});
      await page.evaluate(()=>window.ATS_BULK_INTERVIEWS.refresh(window.rows));
      assert.equal(await page.locator('.bulk-candidate-select').count(),2);
      await page.locator('#bulk-select-page').check();assert.match(await page.locator('#bulk-selected-count').innerText(),/2/);
      await page.locator('#bulk-open-button').click();await page.waitForFunction(()=>document.querySelector('[name="primaryInterviewer"]').options.length===3);
      assert.equal(await page.locator('[name="meetingLink"]').evaluate(node=>node.required && !node.disabled),true);
      await page.locator('[name="interviewFormat"]').selectOption('IN_PERSON');assert.equal(await page.locator('[name="meetingRoom"]').evaluate(node=>node.required && !node.disabled),true);
      await page.locator('[name="interviewFormat"]').selectOption('ONLINE');
      await page.locator('[name="windowStart"]').fill('2032-06-01T09:00');await page.locator('[name="windowEnd"]').fill('2032-06-01T12:00');
      await page.locator('[name="meetingLink"]').fill('https://example.invalid/room');await page.locator('[name="primaryInterviewer"]').selectOption('i1');await page.locator('#bulk-interview-panel input[value="i2"]').check();
      await page.locator('#bulk-preview-button').click();await page.waitForFunction(()=>window.calls.length===1);
      assert.equal((await page.evaluate(()=>window.calls[0])).action,'bulk-preview');assert.deepEqual((await page.evaluate(()=>window.calls[0].body)).candidateIds,['a','b']);
      assert.match(await page.locator('#bulk-interview-slots').innerText(),/09:00/);assert.equal(await page.locator('#bulk-interview-slots tr').count(),2);
      await page.locator('#bulk-confirm-button').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'bulk-close-button');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'bulk-confirm-button');
      await page.locator('#bulk-confirm-button').click();await page.waitForFunction(()=>window.confirmAttempts===1);
      assert.equal(await page.locator('#bulk-back-button').isDisabled(),true);
      const firstKey=await page.evaluate(()=>window.calls.at(-1).body.requestKey);
      await page.locator('#bulk-confirm-button').click();await page.locator('#bulk-confirm-button').click({force:true}).catch(()=>{});
      await page.waitForFunction(()=>document.getElementById('bulk-interview-preview').hidden);
      assert.equal(await page.evaluate(()=>window.confirmAttempts),2);assert.equal(await page.evaluate(()=>window.calls.at(-1).body.requestKey),firstKey);
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('ats-bulk-pending-recruiter')),null);
      assert.match(await page.locator('#bulk-interview-message').innerText(),/SIMULATED/);
      const dimensions=await page.locator('#bulk-interview-modal .modal-card').boundingBox();assert.ok(dimensions.width<=width);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#bulk-interview-modal').isHidden(),true);
      assert.equal(await page.evaluate(()=>document.activeElement.id),'bulk-open-button');
      await page.locator('#bulk-open-button').click();await page.waitForFunction(()=>document.querySelector('[name="primaryInterviewer"]').options.length===3);
      await page.evaluate(()=>{document.getElementById('candidates-view').classList.add('hidden');});
      await page.waitForFunction(()=>document.getElementById('bulk-interview-modal').classList.contains('hidden'));
      assert.equal(await page.locator('#bulk-interview-slots').innerHTML(),'');assert.equal(await page.locator('#bulk-interview-message').innerText(),'');
      await page.evaluate(()=>document.getElementById('candidates-view').classList.remove('hidden'));
      await page.evaluate(()=>window.ATS_BULK_INTERVIEWS.refresh([]));assert.equal(await page.locator('#bulk-select-page').isChecked(),false);
      const probe=await page.evaluate(async()=>{await window.apiProbe;return window.fetchProbe;});assert.equal(probe.options.headers.Authorization,'Bearer synthetic-test-token');assert.ok(!probe.url.includes('synthetic-test-token'));
      assert.deepEqual(errors,[]);await page.close();passed++;
      console.log('PASS frontend preview/confirm/retry/focus/bearer '+width+' '+timezoneId);
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
  console.log('S603_FRONTEND_RESULT '+JSON.stringify({passed,failed:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
