class CandidateSearchController {
  constructor(service,rbac,auth) { this.service=service; this.rbac=rbac; this.auth=auth; }
  async handle(req,res,url,parseBody) {
    const send = (status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    const actor = await this.rbac.authorize(req,res,this.auth,'candidate.read');
    if (!actor) return;
    try {
      let result;
      if (/\/candidate-search-availability$/.test(url.pathname) && req.method === 'GET') result = await this.service.availability(actor);
      else if (/\/candidate-search-options$/.test(url.pathname) && req.method === 'GET') result = await this.service.options(actor);
      else if (/\/candidate-search$/.test(url.pathname) && req.method === 'GET') result = await this.service.search(Object.fromEntries(url.searchParams),actor);
      else if (/\/candidate-filters$/.test(url.pathname) && ['GET','POST'].includes(req.method)) result = await this.service.saved(actor,req.method,req.method === 'POST' ? await parseBody(req) : {});
      else if (/\/candidate-filters\/[^/]+$/.test(url.pathname) && req.method === 'DELETE') result = await this.service.saved(actor,'DELETE',{},decodeURIComponent(url.pathname.split('/').at(-1)));
      else return send(405,{success:false,code:'METHOD_NOT_ALLOWED'});
      send(result.statusCode || 200,result);
    } catch (error) {
      if (error.statusCode) return send(error.statusCode,error);
      if (error instanceof URIError || error.message === 'INVALID_JSON') return send(400,{success:false,code:'INVALID_REQUEST',message:'Yêu cầu không hợp lệ.'});
      send(503,{success:false,code:'CANDIDATE_SEARCH_UNAVAILABLE',message:'Chưa thể tìm kiếm hoặc lưu bộ lọc. Kiểm tra migration S5-05 và thử lại.'});
    }
  }
}
module.exports = CandidateSearchController;
