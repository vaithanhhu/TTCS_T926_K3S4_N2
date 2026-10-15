(function(){
 async function request(path='',method='GET',body){try{const token=sessionStorage.getItem('ats_token'),response=await fetch('/api/v1/requisition-approvals'+path,{method,headers:{Authorization:token?'Bearer '+token:'',...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {ok:response.ok,status:response.status,data:await response.json()};}catch{return {ok:false,status:0,data:{message:'Không thể kết nối để xử lý phê duyệt.'}};}}
 window.ATS_REQUISITION_APPROVAL_API={request};
})();
