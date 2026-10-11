const {ApprovalConfigurationError}=require('../services/approvalConfigurationService');
class RequisitionApprovalController {
 constructor(service,rbac,auth){this.service=service;this.rbac=rbac;this.auth=auth;}
 async handle(req,res,url,body){
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const parts=url.pathname.slice('/api/v1/requisition-approvals'.length).split('/').filter(Boolean);
  const permission=req.method==='POST'?(parts[1]==='decisions'?'requisition.approve':'requisition.create'):'requisition.read';
  let user;
  if(req.method==='GET'){
   const header=req.headers.authorization||'';
   if(!header.startsWith('Bearer ')){send(401,{success:false,code:'UNAUTHORIZED',message:'Vui lòng đăng nhập.'});return;}
   const session=await this.auth.validateSession(header.substring(7).trim(),true);
   if(!session.valid){send(session.statusCode||401,{success:false,code:session.code,message:session.message});return;}
   user=session.user;
  }else user=await this.rbac.authorize(req,res,this.auth,permission);
  if(!user)return;
  try{let result,status=200;
   if(req.method==='GET'&&!parts.length)result=await this.service.list(user);
   else if(req.method==='GET'&&parts[0]==='options'&&parts.length===1){await this.service.permission(user,'requisition.create');result=await this.service.db.prepare('SELECT id,code,title FROM requisitions WHERE created_by=? ORDER BY created_at DESC').all(user.id);}
   else if(req.method==='GET'&&parts[0]==='context'&&parts.length===2)result=await this.service.context(parts[1],user);
   else if(req.method==='GET'&&parts[0]==='by-requisition'&&parts.length===2)result=await this.service.tracking(parts[1],user);
   else if(req.method==='GET'&&parts.length===1)result=await this.service.read(parts[0],user);
   else if(req.method==='POST'&&!parts.length){const data=await body(req);result=await this.service.submit(data?.requisitionId,data,user);status=201;}
   else if(req.method==='POST'&&parts.length===2&&parts[1]==='decisions')result=await this.service.decide(parts[0],await body(req),user);
   else if(req.method==='POST'&&parts.length===2&&parts[1]==='resubmit')result=await this.service.resubmit(parts[0],await body(req),user);
   else{send(404,{success:false,code:'APPROVAL_ENDPOINT_NOT_FOUND',message:'Không tìm thấy chức năng phê duyệt.'});return;}
   send(status,{success:true,data:result});
  }catch(error){if(error instanceof ApprovalConfigurationError)send(error.statusCode,{success:false,code:error.code,message:error.message});else if(error.message==='Invalid JSON')send(400,{success:false,code:'BAD_REQUEST',message:'Dữ liệu yêu cầu không hợp lệ.'});else send(500,{success:false,code:'APPROVAL_INTERNAL_ERROR',message:'Không thể xử lý hồ sơ phê duyệt. Vui lòng thử lại.'});}
 }
}
module.exports=RequisitionApprovalController;
