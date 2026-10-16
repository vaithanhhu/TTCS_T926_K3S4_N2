class TalentPoolController {
  constructor(service,rbac,auth){this.service=service;this.rbac=rbac;this.auth=auth;}
  async handle(req,res,url,parseBody){
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const actor=await this.rbac.authorize(req,res,this.auth,req.method==='POST'?'candidate.update':'candidate.read');
    if(!actor)return;
    try{
      let result;
      if(/\/talent-pool\/availability$/.test(url.pathname)&&req.method==='GET')result=await this.service.availability(actor);
      else if(/\/talent-pool$/.test(url.pathname)&&req.method==='GET')result=await this.service.search(Object.fromEntries(url.searchParams),actor);
      else if(/\/talent-pool$/.test(url.pathname)&&req.method==='POST')result=await this.service.add(await parseBody(req),actor);
      else if(/\/talent-pool\/suggestions$/.test(url.pathname)&&req.method==='GET')result=await this.service.suggest(url.searchParams.get('requisitionId'),actor);
      else return send(405,{success:false,code:'METHOD_NOT_ALLOWED'});
      send(result.statusCode||200,result);
    }catch(error){
      if(error.statusCode)return send(error.statusCode,error);
      if(error.message==='INVALID_JSON')return send(400,{success:false,code:'INVALID_REQUEST'});
      send(503,{success:false,code:'TALENT_POOL_UNAVAILABLE',message:'Kho ứng viên chưa sẵn sàng. Kiểm tra migration S5-06 và thử lại.'});
    }
  }
}
module.exports=TalentPoolController;
