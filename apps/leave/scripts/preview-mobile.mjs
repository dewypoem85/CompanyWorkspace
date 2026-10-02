// Read-only synthetic Leave layout preview; never connects to production APIs.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const root=path.resolve(import.meta.dirname,'../wwwroot');
const shared=path.resolve(root,'../../company-portal/wwwroot');
const columns=['requested','use-date','reason','work-plan','days','status','action'];
const headings=['신청일','사용일','신청 사유','업무 일정','일수','상태',''];
const row='<tr><td>2026-09-01 09:00</td><td>2026-09-08 오전반차</td><td><div class="work-plan-preview">개인 일정으로 연차 신청합니다</div></td><td><div class="work-plan-preview">긴 업무 인수인계 내용 '+ 'LongWorkPlan'.repeat(15)+'</div></td><td class="request-days-cell">0.5</td><td class="request-status-cell"><div class="request-status-line"><span class="cw-state-pill" data-tone="success">승인</span><span class="request-complete-label cw-state-pill" data-tone="neutral">사용 완료</span></div></td><td></td></tr>';
const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><script src="/workspace/js/company-workspace.js"></script><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/mobile.css"><link rel="stylesheet" href="/workspace/css/company-workspace.css"></head><body><div data-company-workspace data-company-service="leave"></div><aside class="cw-sidebar"><div class="cw-sidebar-title">연차관리</div><nav><a href="/">내 연차</a></nav></aside><main class="cw-main"><h1>테스트님의 연차</h1><section class="panel"><h2>내 신청 내역</h2><div class="table-wrap"><table class="data-table leave-request-table"><colgroup>${columns.map(c=>'<col class="request-col-'+c+'">').join('')}</colgroup><thead><tr>${headings.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${row.repeat(3)}</tbody></table></div></section></main><script src="/js/mobile-tables.js"></script></body></html>`;
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:19108');
  const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(req.method!=='GET'){res.writeHead(405);return res.end();}
  if(url.pathname==='/api/workspace/context')return json({authenticated:true,user:{id:1,name:'테스트',role:'admin'},services:['schedule','leave','cs','statistics','sheet'].map((key,i)=>({key,name:['팀 일정','연차관리','CS','게임 통계','시트 관리'][i],href:'/'}))});
  if(url.pathname==='/api/workspace/notifications')return json({items:[],sources:[],unreadCount:0});
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
  const base=url.pathname.startsWith('/workspace/')?shared:root;
  const file=path.resolve(base,url.pathname.replace(/^\/(workspace\/)?/,''));
  if(!file.startsWith(base+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
}).listen(19108,'127.0.0.1',()=>console.log('Synthetic Leave preview: http://127.0.0.1:19108'));
