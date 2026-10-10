(function(){
 const labels={NOT_SUBMITTED:'Chưa gửi phê duyệt',PENDING:'Đang chờ',WAITING:'Chưa đến lượt',APPROVED:'Đã duyệt',REJECTED:'Từ chối',NEEDS_INFO:'Yêu cầu bổ sung',PRIOR_APPROVED:'Đã duyệt ở vòng trước'},actions={APPROVE:'Duyệt',REJECT:'Từ chối',REQUEST_INFO:'Yêu cầu bổ sung'},generations=new Map();
 const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
 const time=value=>window.ATS_DATETIME?.formatUtcTimestamp?.(value)||value||'—';
 function clear(id){const panel=document.getElementById(id);generations.set(id,(generations.get(id)||0)+1);if(panel){panel.textContent='';panel.classList.add('hidden');panel.removeAttribute('aria-busy');}}
 function render(panel,data){panel.textContent='';panel.appendChild(element('h4','Theo dõi phê duyệt'));const status=element('p',labels[data.status]||data.status);panel.appendChild(status);
  if(!data.workflowId){panel.appendChild(element('p','Yêu cầu chưa có vòng phê duyệt.'));return;}
  panel.appendChild(element('p',data.waitingFor?'Đang chờ cấp '+data.waitingFor.order+': '+data.waitingFor.name:'Không có cấp đang chờ xử lý.'));
  for(const round of [...data.rounds].reverse()){const details=element('details');details.open=round.isCurrent;details.appendChild(element('summary','Vòng '+round.revision+(round.isCurrent?' — hiện tại':' — lịch sử')+' · cấu hình phiên bản '+round.configurationVersion));details.appendChild(element('p','Gửi lúc '+time(round.submittedAt)+(round.submittedBy?' · '+round.submittedBy.name:'')+(round.reason?' · '+round.reason:'')));
   const wrapper=element('div');wrapper.className='table-wrapper';const table=element('table');table.className='data-table';const head=element('thead'),heading=element('tr');for(const name of ['Cấp','Trạng thái','Người được phân công','Quyết định'])heading.appendChild(element('th',name));head.appendChild(heading);table.appendChild(head);const body=element('tbody');
   for(const step of round.steps){const row=element('tr');row.setAttribute('data-step-id',step.id);row.appendChild(element('td',String(step.order)));row.appendChild(element('td',labels[step.status]||step.status));row.appendChild(element('td',step.assignedApprover.name));const decision=element('td');decision.style.whiteSpace='pre-wrap';decision.style.overflowWrap='anywhere';decision.textContent=step.decisions.length?step.decisions.map(item=>(actions[item.action]||item.action)+' · '+item.actor.name+(item.actor.id!==step.assignedApprover.id?' (khác người được phân công)':'')+'\n'+time(item.at)+(item.comment?'\n'+item.comment:'')).join('\n\n'):'Chưa có quyết định';row.appendChild(decision);body.appendChild(row);}
   table.appendChild(body);wrapper.appendChild(table);details.appendChild(wrapper);panel.appendChild(details);
  }
 }
 async function load(id,requisitionId,isCurrent=()=>true){const panel=document.getElementById(id);if(!panel)return;clear(id);if(!requisitionId)return;const generation=generations.get(id),token=sessionStorage.getItem('ats_token');panel.classList.remove('hidden');panel.setAttribute('aria-busy','true');panel.textContent='Đang tải lịch sử phê duyệt…';
  const result=await window.ATS_REQUISITION_APPROVAL_API.request('/by-requisition/'+encodeURIComponent(requisitionId));
  if(generation!==generations.get(id)||token!==sessionStorage.getItem('ats_token')||!isCurrent())return;panel.removeAttribute('aria-busy');
  if(result.data?.code==='S302_DISABLED'){clear(id);return;}
  if(!result.ok){panel.textContent=result.data?.message||'Không thể tải lịch sử phê duyệt.';panel.setAttribute('role','alert');const retry=element('button','Thử lại');retry.type='button';retry.className='btn btn-outline btn-sm';retry.addEventListener('click',()=>load(id,requisitionId,isCurrent));panel.appendChild(retry);return;}
  panel.removeAttribute('role');render(panel,result.data.data);
 }
 function leave(){clear('s303-legacy');clear('s303-s210');}
 window.ATS_REQUISITION_TRACKING={load,clear,leave};
})();
