(function () {
  const allowed = () => currentAuthenticatedUser?.roles?.some(role => ['ADMIN','HR_MANAGER'].includes(role));
  let poolPage=1,poolRequest=0,suggestionRequest=0,knownOpenRequisitions=new Set();
  const panel=document.createElement('section');
  panel.id='talent-pool-panel';panel.className='hidden';
  panel.innerHTML=`<h3>Kho ứng viên tiềm năng</h3>
    <form id="talent-pool-add" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:12px 0">
      <label>Hồ sơ bị loại<select id="talent-pool-candidate" class="form-input" required></select></label>
      <label>Chức danh quan tâm<input id="talent-pool-title" class="form-input" maxlength="200" placeholder="Mặc định theo vị trí đã ứng tuyển"></label>
      <label>Lý do đưa vào kho<input id="talent-pool-reason" class="form-input" required maxlength="2000"></label>
      <label><input id="talent-pool-confirm" type="checkbox" required> Tôi xác nhận ứng viên đã trượt vòng cuối</label>
      <button class="btn btn-primary btn-sm" type="submit">Đưa vào kho</button>
    </form>
    <form id="talent-pool-search" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
      <label>Tìm chức danh quan tâm<input id="talent-pool-search-title" class="form-input" maxlength="200"></label>
      <label>Tìm kỹ năng (nhãn hoặc CV đã bóc tách)<input id="talent-pool-search-skill" class="form-input" maxlength="200"></label>
      <button class="btn btn-outline btn-sm" type="submit">Tìm trong kho</button>
    </form>
    <p id="talent-pool-message" role="status" aria-live="polite"></p>
    <div id="talent-pool-results"></div>
    <div style="display:flex;gap:8px;margin:12px 0"><button id="talent-pool-prev" type="button" class="btn btn-outline btn-sm">Trang trước</button><span id="talent-pool-page"></span><button id="talent-pool-next" type="button" class="btn btn-outline btn-sm">Trang sau</button></div>`;
  document.getElementById('candidates-view')?.appendChild(panel);
  const suggestions=document.createElement('section');suggestions.id='talent-pool-suggestions';suggestions.className='hidden';
  suggestions.innerHTML='<h3>Gợi ý từ kho ứng viên tiềm năng</h3><label>Vị trí đang mở<select id="talent-pool-requisition" class="form-input"></select></label><p id="talent-pool-suggestion-message" role="status" aria-live="polite"></p><div id="talent-pool-suggestion-results"></div>';
  document.getElementById('requisitions-view')?.appendChild(suggestions);
  const el=id=>document.getElementById(id);
  const render=(node,rows,details)=>{
    node.replaceChildren();
    if(!rows.length){node.textContent='Không có ứng viên phù hợp.';return;}
    for(const row of rows){
      const item=document.createElement('div');item.style.cssText='padding:12px;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere';
      const heading=document.createElement('strong');heading.textContent=row.fullName+' — '+row.interestedTitle;item.appendChild(heading);
      const reason=document.createElement('p');reason.textContent='Lý do: '+row.reason;item.appendChild(reason);
      if(details){const match=document.createElement('p');match.textContent=[row.titleMatch?'Cùng chức danh':'',...(row.matchedSkills || []).map(skill=>'Kỹ năng: '+skill)].filter(Boolean).join('; ');item.appendChild(match);}
      const button=document.createElement('button');button.type='button';button.className='btn btn-outline btn-sm';button.textContent='Xem hồ sơ';button.addEventListener('click',()=>window.ATS_APP_HELPERS.viewCandidateDetails(row.candidateId));item.appendChild(button);node.appendChild(item);
    }
  };
  async function search(){
    if(!allowed())return;
    const request=++poolRequest,token=sessionStorage.getItem('ats_token');
    const query=new URLSearchParams({title:el('talent-pool-search-title').value,skill:el('talent-pool-search-skill').value,page:poolPage});
    el('talent-pool-message').textContent='Đang tải kho ứng viên...';el('talent-pool-results').replaceChildren();
    const response=await window.ATS_API.talentPoolApi(token,'?'+query);
    if(request!==poolRequest||token!==sessionStorage.getItem('ats_token')||!allowed())return;
    if(!response.ok){el('talent-pool-message').textContent=response.data?.message || 'Không thể tải kho.';return;}
    el('talent-pool-message').textContent=response.data.total+' hồ sơ trong kho';el('talent-pool-page').textContent='Trang '+poolPage;
    el('talent-pool-prev').disabled=poolPage===1;el('talent-pool-next').disabled=poolPage*25>=response.data.total;
    render(el('talent-pool-results'),response.data.candidates || [],false);
  }
  async function suggest(){
    if(!allowed())return;
    const request=++suggestionRequest,token=sessionStorage.getItem('ats_token'),id=el('talent-pool-requisition').value;
    el('talent-pool-suggestion-results').replaceChildren();el('talent-pool-suggestion-message').textContent=id?'Đang tìm gợi ý...':'Chưa có vị trí đang mở.';
    if(!id)return;
    const response=await window.ATS_API.talentPoolApi(token,'/suggestions?'+new URLSearchParams({requisitionId:id}));
    if(request!==suggestionRequest||token!==sessionStorage.getItem('ats_token')||!allowed())return;
    el('talent-pool-suggestion-message').textContent=response.ok?'Gợi ý theo chức danh và kỹ năng hiện có; HR cần xem xét lại.':response.data?.message || 'Không thể tải gợi ý.';
    if(response.ok)render(el('talent-pool-suggestion-results'),response.data.candidates || [],true);
  }
  el('talent-pool-add')?.addEventListener('submit',async event=>{
    event.preventDefault();if(!allowed())return;const button=event.target.querySelector('button'),token=sessionStorage.getItem('ats_token');button.disabled=true;
    try{
      const response=await window.ATS_API.talentPoolApi(token,'','POST',{candidateId:el('talent-pool-candidate').value,interestedTitle:el('talent-pool-title').value,reason:el('talent-pool-reason').value,finalRoundConfirmed:el('talent-pool-confirm').checked});
      if(token!==sessionStorage.getItem('ats_token'))return;
      if(!response.ok){el('talent-pool-message').textContent=response.data?.message || 'Không thể đưa vào kho.';return;}
      event.target.reset();poolPage=1;await search();
    }finally{button.disabled=false;}
  });
  el('talent-pool-search')?.addEventListener('submit',event=>{event.preventDefault();poolPage=1;search();});
  el('talent-pool-prev')?.addEventListener('click',()=>{poolPage=Math.max(1,poolPage-1);search();});
  el('talent-pool-next')?.addEventListener('click',()=>{poolPage++;search();});
  el('talent-pool-requisition')?.addEventListener('change',suggest);
  window.ATS_TALENT_POOL={
    async refreshCandidates(rows){
      const request=++poolRequest,token=sessionStorage.getItem('ats_token');
      panel.classList.add('hidden');
      if(!allowed()||!window.ATS_API.talentPoolApi){el('talent-pool-results')?.replaceChildren();return;}
      const ready=await window.ATS_API.talentPoolApi(token,'/availability');
      if(request!==poolRequest||token!==sessionStorage.getItem('ats_token')||!allowed()||!ready.ok||!ready.data.enabled)return;
      panel.classList.remove('hidden');
      el('talent-pool-candidate').innerHTML='<option value="">Chọn hồ sơ bị loại</option>'+rows.filter(row=>row.stage==='REJECTED').map(row=>'<option value="'+escapeHtml(row.id)+'">'+escapeHtml(row.fullName)+'</option>').join('');search();
    },
    async refreshRequisitions(rows){
      const request=++suggestionRequest,token=sessionStorage.getItem('ats_token');
      suggestions.classList.add('hidden');
      if(!allowed()||!window.ATS_API.talentPoolApi){el('talent-pool-suggestion-results')?.replaceChildren();return;}
      const ready=await window.ATS_API.talentPoolApi(token,'/availability');
      if(request!==suggestionRequest||token!==sessionStorage.getItem('ats_token')||!allowed()||!ready.ok||!ready.data.enabled)return;
      suggestions.classList.remove('hidden');
      const select=el('talent-pool-requisition'),value=select.value;
      const open=rows.filter(row=>['OPEN','IN_PROGRESS'].includes(row.status)),newlyOpened=open.find(row=>!knownOpenRequisitions.has(row.id));
      knownOpenRequisitions=new Set(open.map(row=>row.id));
      select.innerHTML=open.map(row=>'<option value="'+escapeHtml(row.id)+'">'+escapeHtml(row.title)+'</option>').join('');
      if(newlyOpened)select.value=newlyOpened.id;
      else if([...select.options].some(option=>option.value===value))select.value=value;
      suggest();
    }
  };
})();
