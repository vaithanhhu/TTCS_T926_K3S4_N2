(function(){
  let rows=[],selected=new Set(),preview=null,pending=null,busy=false,generation=0;
  const element=id=>document.getElementById(id);
  const hide=(node,value)=>{node.hidden=value;node.classList.toggle('hidden',value);};
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const identity=()=>typeof currentAuthenticatedUser==='undefined'?null:currentAuthenticatedUser;
  const allowed=()=>{const user=identity();return user?.roles?.some(role=>['ADMIN','HR_MANAGER','RECRUITER'].includes(role)) && (user.roles.includes('ADMIN') || user.permissions?.includes('interview.create'));};
  const requisition=row=>row.requisition?.id || row.requisition_id;
  const time=value=>new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false});
  const modal=element('bulk-interview-modal');
  const form=element('bulk-interview-form'),field=name=>element('bulk-'+name),message=text=>element('bulk-interview-message').textContent=text;
  const storageKey=()=> 'ats-bulk-pending-'+identity()?.id;
  const clearPending=()=>{sessionStorage.removeItem(storageKey());pending=null;};
  const controls=()=>{
    element('bulk-interview-config').disabled=busy || !!preview || !!pending;
    hide(element('bulk-preview-button'),!!preview || !!pending);
    element('bulk-preview-button').disabled=busy;
    element('bulk-back-button').disabled=busy || !!pending;
    element('bulk-confirm-button').disabled=busy || (!pending && (!preview || preview.errors?.length>0));
    element('bulk-confirm-button').textContent=pending?'Kiểm tra / thử lại yêu cầu':'Xác nhận tạo lịch';
    element('bulk-close-button').disabled=busy;
  };
  const renderSlots=slots=>{element('bulk-interview-slots').innerHTML=slots.map((slot,index)=>`<tr><td>${index+1}</td><td>${escape(slot.fullName)}</td><td>${escape(slot.roundName)}</td><td>${escape(time(slot.start))}</td><td>${escape(time(slot.end))}</td><td>${escape((slot.interviewers || []).map(row=>row.fullName).join(', '))}</td><td>${escape(slot.meetingRoom || slot.meetingLink)}</td></tr>`).join('');hide(element('bulk-interview-preview'),false);};
  function refresh(list){
    rows=list;selected=new Set();
    const toolbar=element('bulk-interview-toolbar');
    hide(toolbar,!allowed());
    if(allowed())for(const row of rows.filter(row=>requisition(row))){const tr=[...document.querySelectorAll('#candidates-table-body tr')].find(node=>node.dataset.id===row.id);if(!tr)continue;const box=document.createElement('input');box.type='checkbox';box.className='bulk-candidate-select';box.setAttribute('aria-label','Chọn '+(row.fullName || row.full_name));box.onchange=()=>{box.checked?selected.add(row.id):selected.delete(row.id);element('bulk-selected-count').textContent=selected.size+' đã chọn';};tr.cells[0].prepend(box);}
    element('bulk-selected-count').textContent='0 đã chọn';element('bulk-select-page').checked=false;
  }
  async function open(){
    if(!allowed())return;
    pending=null;preview=null;form.reset();generation++;
    try{const cached=JSON.parse(sessionStorage.getItem(storageKey()) || 'null');if(cached?.requestKey)pending=cached;}catch{}
    const chosen=rows.filter(row=>selected.has(row.id));
    if(!pending && (!chosen.length || new Set(chosen.map(requisition)).size!==1)){showToast('warning','Đặt lịch hàng loạt','Chọn các ứng viên thuộc cùng một vị trí tuyển dụng.');return;}
    hide(element('bulk-interview-preview'),!pending);element('bulk-interview-slots').innerHTML='';hide(element('bulk-retry-email'),true);
    modal.classList.remove('hidden');message(pending?'Có yêu cầu chưa xác định kết quả. Kiểm tra lại bằng cùng request key.':'Đang tải hội đồng phỏng vấn...');
    if(pending){controls();return;}
    const token=sessionStorage.getItem('ats_token'),version=generation;busy=true;controls();
    try{
      const result=await window.ATS_API.getInterviewOptionsApi(token);
      if(token!==sessionStorage.getItem('ats_token') || version!==generation)return;
      if(!result.ok)throw Error(result.data?.message || 'Không thể tải người phỏng vấn.');
      const panel=result.data.interviewers || [];
      field('primaryInterviewer').innerHTML='<option value="">Chọn người phỏng vấn chính</option>'+panel.map(row=>`<option value="${escape(row.id)}">${escape(row.fullName)}</option>`).join('');
      element('bulk-interview-panel').innerHTML=panel.map(row=>`<label style="display:block"><input type="checkbox" value="${escape(row.id)}"> ${escape(row.fullName)}</label>`).join('');
      field('primaryInterviewer').onchange=()=>{for(const box of element('bulk-interview-panel').querySelectorAll('input')){box.disabled=box.value===field('primaryInterviewer').value;if(box.disabled)box.checked=false;}};
      const tomorrow=new Date(Date.now()+86400000),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(tomorrow);
      field('windowStart').value=parts+'T09:00';field('windowEnd').value=parts+'T12:00';message(chosen.length+' ứng viên đã chọn. Xem trước trước khi xác nhận.');
    }catch(error){if(version===generation)message(error.message);}finally{if(version===generation){busy=false;controls();}}
    field('interviewFormat').dispatchEvent(new Event('change'));
  }
  field('interviewFormat').onchange=()=>{const online=field('interviewFormat').value==='ONLINE';hide(element('bulk-link-label'),!online);hide(element('bulk-room-label'),online);field('meetingLink').required=online;field('meetingLink').disabled=!online;field('meetingRoom').required=!online;field('meetingRoom').disabled=online;};
  form.onsubmit=async event=>{
    event.preventDefault();if(busy || pending)return;
    const chosen=rows.filter(row=>selected.has(row.id)),config=Object.fromEntries(new FormData(form));
    config.candidateIds=chosen.map(row=>row.id);config.requisitionId=requisition(chosen[0] || {});config.interviewerIds=[field('primaryInterviewer').value,...[...element('bulk-interview-panel').querySelectorAll('input:checked')].map(box=>box.value)];delete config.primaryInterviewer;
    busy=true;controls();const token=sessionStorage.getItem('ats_token'),version=generation;
    try{const result=await window.ATS_API.bulkInterviewsApi(token,'bulk-preview',config);if(token!==sessionStorage.getItem('ats_token') || version!==generation)return;if(result.data.slots){preview={...result.data,config};renderSlots(preview.slots);}message(result.ok?'Kiểm tra các khe giờ rồi xác nhận.':(result.data.errors || []).map(error=>error.candidateId+': '+error.code).join('; ') || result.data.message || result.data.code);}
    finally{if(version===generation){busy=false;controls();}}
  };
  element('bulk-back-button').onclick=()=>{if(pending || busy)return;preview=null;hide(element('bulk-interview-preview'),true);controls();};
  element('bulk-confirm-button').onclick=async()=>{
    if(busy || (!pending && !preview?.success))return;
    if(!pending){pending={...preview.config,fingerprint:preview.fingerprint,requestKey:crypto.randomUUID()};sessionStorage.setItem(storageKey(),JSON.stringify(pending));}
    const token=sessionStorage.getItem('ats_token'),version=generation;busy=true;controls();
    try{
      const result=await window.ATS_API.bulkInterviewsApi(token,'bulk-create',pending);
      if(token!==sessionStorage.getItem('ats_token') || version!==generation)return;
      if(result.ok){clearPending();preview=null;hide(element('bulk-interview-preview'),true);message('Đã lưu '+result.data.interviews.length+' lịch. Email: '+(result.data.deliveries || []).map(row=>row.state).join(', ')+'. SIMULATED là mô phỏng; SENDING/UNKNOWN cần kiểm tra thủ công, không gửi lại mù.');hide(element('bulk-preview-button'),true);hide(element('bulk-retry-email'),!(result.data.deliveries || []).some(row=>['FAILED','PENDING'].includes(row.state)));element('bulk-retry-email').dataset.batch=result.data.batchId;}
      else if(result.status>=400 && result.status<500){clearPending();preview=null;hide(element('bulk-interview-preview'),true);message(result.data.code || result.data.message);}
      else message(result.data.message || 'Chưa xác định kết quả. Thử lại cùng request key.');
    }finally{if(version===generation){busy=false;controls();}}
  };
  element('bulk-retry-email').onclick=async()=>{if(busy)return;busy=true;element('bulk-retry-email').disabled=true;const token=sessionStorage.getItem('ats_token'),version=generation;try{const result=await window.ATS_API.bulkInterviewsApi(token,'batches/'+encodeURIComponent(element('bulk-retry-email').dataset.batch)+'/retry',{});if(token!==sessionStorage.getItem('ats_token') || version!==generation)return;message(result.ok?(result.data.deliveries || []).map(row=>row.state).join(', '):result.data.code || result.data.message);}finally{if(version===generation){busy=false;element('bulk-retry-email').disabled=false;}}};
  element('bulk-close-button').onclick=()=>{if(!busy){modal.classList.add('hidden');generation++;}};
  element('bulk-select-page').onchange=event=>{for(const box of document.querySelectorAll('.bulk-candidate-select')){box.checked=event.target.checked;box.dispatchEvent(new Event('change'));}};
  element('bulk-open-button').onclick=open;
  const view=element('candidates-view'),shell=element('app-shell');
  const observer=new MutationObserver(()=>{
    if(modal.classList.contains('hidden'))return;
    if(!allowed() || !sessionStorage.getItem('ats_token') || view?.classList.contains('hidden') || shell?.classList.contains('hidden')){
      generation++;busy=false;preview=null;pending=null;rows=[];selected.clear();
      modal.classList.add('hidden');element('bulk-interview-slots').innerHTML='';hide(element('bulk-retry-email'),true);message('');form.reset();controls();
    }
  });
  for(const node of [view,shell].filter(Boolean))observer.observe(node,{attributes:true,attributeFilter:['class']});
  window.ATS_BULK_INTERVIEWS={refresh};
})();
