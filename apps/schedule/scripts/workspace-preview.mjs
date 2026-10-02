// Local-only, synthetic UI fixtures. Never use this server as an auth proxy or deploy it.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const workspace=path.resolve(import.meta.dirname,'../..');
const snapshots=process.env.WORKSPACE_UI_SNAPSHOTS;
if(!snapshots) throw Error('WORKSPACE_UI_SNAPSHOTS must name the integration-test output directory');
const portal='http://127.0.0.1:19090';
const roots={19090:'company-portal/wwwroot',19092:'schedule/server/wwwroot',19093:'CS/public',19094:'statistics/public',19095:'sheet/dist/client'};
for(const [port,folder] of Object.entries(roots)){
  http.createServer(async(req,res)=>{
    const url=new URL(req.url,portal);
    const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    res.setHeader('Access-Control-Allow-Origin',req.headers.origin||portal);res.setHeader('Access-Control-Allow-Credentials','true');
    if(url.pathname==='/api/workspace/context')return json({authenticated:true,user:{id:1,name:'테스트',email:'preview@example.test',department:'개발',role:'admin',accountType:'employee'},services:[{key:'schedule',name:'팀 일정',href:portal+'/workspace/schedule'},{key:'cs',name:'CS',href:portal+'/workspace/cs'},{key:'statistics',name:'게임 통계',href:portal+'/workspace/statistics'}],isAdmin:true,csrfToken:'preview-only'});
    if(url.pathname==='/api/workspace/notifications')return json({items:[],sources:[],unreadCount:0});
    if(url.pathname.startsWith('/workspace/')){const p={schedule:19092,cs:19093,statistics:19094,sheet:19095}[url.pathname.split('/').pop()];res.writeHead(302,{Location:'http://127.0.0.1:'+p});return res.end();}
    if(url.pathname.startsWith('/api/')){
      if(port==='19092' && snapshots){
        const file={'/api/bootstrap':'schedule-bootstrap.json','/api/tasks':'schedule-tasks.json','/api/milestones':'schedule-milestones.json','/api/absences':'schedule-absences.json'}[url.pathname];
        if(file){res.setHeader('Content-Type','application/json');return res.end(await readFile(path.join(snapshots,file)));}
      }
      res.statusCode=503;return json({error:'로컬 화면 검증: 운영 API는 연결하지 않습니다.'});
    }
    try{
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
      const root=path.join(workspace,folder);
      let file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
      if(port==='19090' && url.pathname==='/')file=path.join(snapshots,'portal.html');
      if(port==='19090' && url.pathname==='/Admin/Users')file=path.join(snapshots,'users.html');
      if(port==='19090' && url.pathname==='/settings/profile')file=path.join(snapshots,'profile.html');
      if(port==='19092' && url.pathname==='/kanban')file=path.join(root,'index.html');
      let bytes=await readFile(file);const ext=path.extname(file);
      const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'}[ext]||'application/octet-stream';
      if(ext==='.html')bytes=Buffer.from(bytes.toString().replaceAll('https://company.example.com',portal));
      res.setHeader('Content-Type',mime);res.end(bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  }).listen(Number(port),'127.0.0.1',()=>console.log('Local synthetic preview: http://127.0.0.1:'+port));
}
