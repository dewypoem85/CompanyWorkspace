// Local-only synthetic UI preview. No production credentials or API calls.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDemoOverview } from '../lib/demo-data.js';
const root=path.resolve(import.meta.dirname,'../public');
const workspace=path.resolve(root,'../../portal/wwwroot');
const pages=new Set(['/','/results','/builds','/builds/detail','/bosses','/bosses/detail']);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:19104');
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/api/config')return json({storageConfigured:false,publication:{inProgress:false},masterData:{bosses:[]}});
  if(url.pathname==='/api/analytics/overview')return json(createDemoOverview());
  if(url.pathname==='/api/workspace/context')return json({authenticated:true,user:{id:1,name:'UI 테스트',email:'preview@example.test',role:'employee'},services:[{key:'statistics',name:'게임 통계',href:'/'}]});
  if(url.pathname==='/api/workspace/notifications')return json({items:[],sources:[],unreadCount:0});
  if(url.pathname.startsWith('/api/')){res.writeHead(404);return res.end();}
  const base=url.pathname.startsWith('/workspace-assets/')?workspace:root;
  const name=pages.has(url.pathname)?'index.html':url.pathname.replace(/^\/(workspace-assets\/)?/,'');
  const file=path.resolve(base,name);
  if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
  try{
    let content=await readFile(file);
    if(file.endsWith('.html'))content=Buffer.from(content.toString().replaceAll('https://company.example.com/','/workspace-assets/'));
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(content);
  }catch{res.writeHead(404);res.end();}
}).listen(19104,'127.0.0.1',()=>console.log('Synthetic statistics preview: http://127.0.0.1:19104'));
