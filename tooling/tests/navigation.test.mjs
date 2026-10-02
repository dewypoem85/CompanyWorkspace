import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { root } from '../build-ui.mjs';
const read=file=>readFileSync(resolve(root,file),'utf8');
const catalog={...JSON.parse(read('packages/contracts/services.json')),...JSON.parse(read('packages/contracts/pages.json'))};
const navigation=read('packages/workspace-ui/src/navigation.js');
const readSession=read('packages/workspace-ui/src/read-session.js');
const authorized={authenticated:true,user:{id:1,name:'테스트 직원',role:'employee'},services:[{key:'cs',name:'CS',href:'/workspace/cs'}]};
function cleanup(t,dom) {
  const observers=[], Native=dom.window.MutationObserver;
  dom.window.MutationObserver=class extends Native { constructor(callback){ super(callback); observers.push(this); } };
  t.after(()=>{ for(const observer of observers)observer.disconnect(); dom.window.close(); });
}
function fixture(t,path='/players'){
  const dom=new JSDOM('<!doctype html><body><aside data-workspace-navigation="cs"></aside></body>',{url:'https://cs.example.test'+path,runScripts:'outside-only'});
  cleanup(t,dom);
  dom.window.CompanyPageCatalog=structuredClone(catalog); dom.window.eval(read('packages/workspace-ui/src/states.js')); dom.window.eval(readSession); dom.window.eval(navigation);
  const node=dom.window.document.querySelector('aside');
  return {dom,node,render:context=>dom.window.CompanyNavigation.render(node,context,path)};
}
test('no menu is exposed to anonymous, denied or incomplete context',t=>{
  const f=fixture(t);
  for(const context of [undefined,{authenticated:false},{authenticated:true,services:[]},{...authorized,services:[{key:'sheet'}]}]){
    f.render(context); assert.equal(f.node.hidden,true); assert.equal(f.node.querySelectorAll('a').length,0);
  }
});
test('authorized employees see the same four centrally defined pages with one active link',t=>{
  const f=fixture(t); f.render(authorized);
  assert.equal(f.node.hidden,false); assert.equal(f.node.querySelectorAll('a').length,4);
  assert.equal(f.node.querySelector('[aria-current="page"]').dataset.workspacePage,'cs.players');
  const link=f.node.querySelector('a'); f.render(authorized); assert.equal(f.node.querySelector('a'),link,'unchanged context must not rebuild DOM');
});
test('legacy URLs retain the same active page and permission revocation removes links',t=>{
  const f=fixture(t,'/player-data.html'); f.render(authorized);
  assert.equal(f.node.querySelector('[aria-current="page"]').dataset.workspacePage,'cs.players');
  f.render({...authorized,services:[]}); assert.equal(f.node.querySelectorAll('a').length,0); assert.equal(f.node.hidden,true);
});
test('automatic filter navigation submits only an eligible GET form through native validation',t=>{
  const f=fixture(t),doc=f.dom.window.document;
  f.node.insertAdjacentHTML('afterend','<form method="get"><select name="EmployeeId" data-cw-auto-submit><option value="11">직원</option></select></form><form method="post"><select data-cw-auto-submit><option>쓰기</option></select></form>');
  const [read,write]=doc.querySelectorAll('form'),control=read.querySelector('select');let submissions=0;
  read.requestSubmit=()=>submissions++;write.requestSubmit=()=>assert.fail('POST forms must never be automatically submitted');
  const change=()=>control.dispatchEvent(new f.dom.window.Event('change',{bubbles:true,cancelable:true}));
  change();assert.equal(submissions,1);
  control.disabled=true;change();assert.equal(submissions,1);control.disabled=false;
  read.setAttribute('aria-busy','true');change();assert.equal(submissions,1);read.removeAttribute('aria-busy');
  control.addEventListener('change',event=>event.preventDefault(),{once:true});change();assert.equal(submissions,1);
  write.querySelector('select').dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));assert.equal(submissions,1);
});
test('navigation escapes page titles rather than inserting HTML',t=>{
  const f=fixture(t); f.dom.window.CompanyPageCatalog.pages.find(p=>p.service==='cs').title='<img src=x onerror=alert(1)>';
  f.render(authorized); assert.equal(f.node.querySelector('img'),null); assert.ok(f.node.textContent.includes('<img'));
});

test('SPA detail routes highlight their parent and context changes remove navigation',t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='statistics';
  const ctx={...authorized,services:[{key:'statistics'}]};
  const render=path=>f.dom.window.CompanyNavigation.render(f.node,ctx,path);
  render('/builds/detail');
  assert.equal(f.node.querySelector('[aria-current]').dataset.workspacePage,'statistics.builds');
  assert.equal(f.node.querySelectorAll('[data-route-link]').length,catalog.pages.filter(page=>page.service==='statistics'&&page.nav!==false).length);
  assert.equal(f.node.querySelector('[data-workspace-page="statistics.build.detail"]'),null);
  render('/index.html');assert.equal(f.node.querySelector('[aria-current]').dataset.workspacePage,'statistics.dashboard');
  f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('company-context',{detail:ctx}));
  f.dom.window.history.pushState({},'','/bosses/detail');
  f.dom.window.document.dispatchEvent(new f.dom.window.Event('company-route-change'));
  assert.equal(f.node.querySelector('[aria-current]').dataset.workspacePage,'statistics.bosses');
  f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('company-context',{detail:{...ctx,services:[]}}));
  assert.equal(f.node.hidden,true);assert.equal(f.node.querySelectorAll('a').length,0);
});
test('schedule capabilities fail closed, update after bootstrap and retain task parent navigation',async t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='schedule';
  const ctx={...authorized,services:[{key:'schedule'}]};
  f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('company-context',{detail:ctx}));
  const management=()=>f.node.querySelector('[data-workspace-page="schedule.settings"]');
  assert.equal(management(),null);
  f.node.dataset.workspaceCapabilities=JSON.stringify(['schedule.manage']);
  await new Promise(resolve=>f.dom.window.setTimeout(resolve,0));
  assert.ok(management(),'Server bootstrap capability must update the existing sidebar');
  f.dom.window.CompanyNavigation.render(f.node,ctx,'/tasks/101');
  assert.equal(f.node.querySelector('[aria-current]').dataset.workspacePage,'schedule.week');
  for(const path of ['/tasks/nope','/tasks/0','/tasks/-1','/tasks/101/extra']){
    f.dom.window.CompanyNavigation.render(f.node,ctx,path);
    assert.equal(f.node.querySelector('[aria-current]'),null,path);
  }
  f.node.dataset.workspaceCapabilities='not-json';
  await new Promise(resolve=>f.dom.window.setTimeout(resolve,0));
  assert.equal(management(),null,'Malformed or revoked capabilities must remove management links');
});

test('schedule test pages are grouped at the bottom of the sidebar',t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='schedule';f.node.dataset.workspaceCapabilities=JSON.stringify(['schedule.manage']);
  const ctx={...authorized,services:[{key:'schedule'}]};
  f.dom.window.CompanyNavigation.render(f.node,ctx,'/');
  const ids=[...f.node.querySelectorAll('[data-workspace-page]')].map(link=>link.dataset.workspacePage);
  assert.deepEqual(ids,['schedule.week','schedule.mine','schedule.todos','schedule.releases','schedule.settings','schedule.kanban','schedule.feedback']);
  const section=f.node.querySelector('[data-navigation-section="테스트"]');
  assert.ok(section);assert.equal(section.querySelector('.cw-page-section-label').textContent,'테스트');
  assert.deepEqual([...section.querySelectorAll('[data-workspace-page]')].map(link=>link.dataset.workspacePage),['schedule.kanban','schedule.feedback']);
  assert.equal(f.node.querySelector('[data-workspace-page="schedule.releases"] strong').textContent,'업데이트 버전');
});

test('Razor navigation uses server-authorized IDs, query variants and fail-closed refresh',async t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='home';
  const ctx={...authorized,services:[],isAdmin:true};
  let allowed=['home.dashboard','home.profile','home.users','home.departments','home.projects'],failed=false;
  f.dom.window.fetch=async path=>{assert.equal(path,'/api/workspace/navigation');return {ok:!failed,json:async()=>({pages:allowed})};};
  const update=async()=>{
    f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('company-context',{detail:ctx}));
    await new Promise(resolve=>f.dom.window.setTimeout(resolve,0));
  };
  f.render(ctx);assert.equal(f.node.querySelectorAll('a').length,0,'No client-side role guess can grant a Razor menu');
  await update();assert.equal(f.node.querySelectorAll('a').length,5);
  for(const [path,id] of [['/Admin/Organization?tab=projects&id=10','home.projects'],['/Admin/Organization?TAB=projects','home.projects'],['/Admin/Organization?tab=departments','home.departments'],['/Admin/Organization','home.departments']]){
    f.dom.window.CompanyNavigation.render(f.node,ctx,path);
    assert.equal(f.node.querySelector('[aria-current]').dataset.workspacePage,id);
  }
  assert.equal(f.node.querySelector('[data-workspace-page="home.projects"]').getAttribute('href'),'/Admin/Organization?tab=projects');
  allowed=['home.dashboard','home.profile'];await update();assert.equal(f.node.querySelectorAll('a').length,2);
  failed=true;await update();assert.equal(f.node.hidden,false);assert.equal(f.node.querySelector('[data-state-kind]').dataset.stateKind,'error');assert.equal(f.node.querySelectorAll('a').length,0);
  failed=false;await update();assert.equal(f.node.hidden,false);
});
test('simultaneous context and validation events share one permission check',async t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='home';
  const ctx={...authorized,services:[],isAdmin:true};
  let requests=0,release;
  f.dom.window.fetch=()=>{requests++;return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({pages:['home.dashboard']})});});};
  f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('company-context',{detail:ctx}));
  f.dom.window.document.dispatchEvent(new f.dom.window.Event('company-context-validated'));
  await new Promise(resolve=>f.dom.window.setTimeout(resolve,0));
  assert.equal(requests,1,'duplicate events must not cancel and restart the same permission request');
  release();
  await new Promise(resolve=>f.dom.window.setTimeout(resolve,0));
  assert.equal(f.node.querySelector('[aria-current="page"]')?.dataset.workspacePage,undefined);
  assert.equal(f.node.querySelector('[data-workspace-page="home.dashboard"]')?.getAttribute('href'),'/');
});

test('Razor badges are numeric, permission-scoped and update without losing focused navigation',async t=>{
  const f=fixture(t);f.node.dataset.workspaceNavigation='leave';
  const ctx={...authorized,services:[{key:'leave'}]},window=f.dom.window;
  let allowed=['leave.dashboard','leave.approvals'];
  window.fetch=async()=>({ok:true,json:async()=>({pages:allowed,badges:{'leave.approvals':2,'home.users':500}})});
  async function update(){window.document.dispatchEvent(new window.CustomEvent('company-context',{detail:ctx}));await new Promise(resolve=>window.setTimeout(resolve,0));}
  await update();
  const badge=()=>f.node.querySelector('[data-workspace-badge="leave.approvals"]');
  assert.equal(badge().textContent,'2');assert.equal(f.node.querySelectorAll('[data-workspace-badge]').length,1);
  f.node.querySelector('[data-workspace-page="leave.approvals"]').focus();
  window.CompanyNavigation.setBadge('leave','leave.approvals',120);
  assert.equal(badge().textContent,'99+');assert.equal(badge().getAttribute('aria-label'),'대기 120건');
  assert.equal(window.document.activeElement.dataset.workspacePage,'leave.approvals');
  for(const invalid of [-1,NaN,'<script>',1.5])window.CompanyNavigation.setBadge('leave','leave.approvals',invalid);
  assert.equal(badge().textContent,'99+');
  window.CompanyNavigation.setBadge('leave','leave.approvals',0);assert.equal(badge().hidden,true);
  allowed=['leave.dashboard'];await update();assert.equal(badge(),null);
});

test('a navigation snapshot cannot overwrite a newer live badge update',async t=>{
  const f=await serverFixture(t),{w,node}=f;
  node.dataset.workspaceNavigation='leave';
  const ctx={...authorized,services:[{key:'leave'}]};
  f.update(ctx);await f.tick();
  w.CompanyNavigation.setBadge('leave','leave.approvals',120);
  await f.respond(0,200,['leave.dashboard','leave.approvals'],{'leave.approvals':2});
  const badge=()=>node.querySelector('[data-workspace-badge="leave.approvals"]');
  assert.equal(badge().textContent,'99+');
  assert.equal(badge().getAttribute('aria-label'),'대기 120건');
  const refresh=w.CompanyNavigation.refreshPermissions();
  await f.respond(1,200,['leave.dashboard','leave.approvals'],{'leave.approvals':3});await refresh;
  assert.equal(badge().textContent,'3','A snapshot started after the live update may replace it with newer server state');
});

async function serverFixture(t){
  const f=fixture(t),w=f.dom.window;
  await new Promise(resolve=>w.setTimeout(resolve,0));
  f.node.dataset.workspaceNavigation='home';w.history.replaceState({},'','/settings/profile');
  const requests=[];
  w.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
  const update=ctx=>w.document.dispatchEvent(new w.CustomEvent('company-context',{detail:ctx}));
  const tick=()=>new Promise(resolve=>w.setTimeout(resolve,0));
  const respond=async(index,status=200,pages=['home.dashboard','home.profile'],badges=undefined)=>{
    while(!requests[index])await tick();
    requests[index].resolve({ok:status===200,status,json:async()=>({pages,...(badges===undefined?{}:{badges})})});await tick();
  };
  return {...f,w,requests,update,tick,respond};
}

test('navigation retry shows loading, preserves draft and focuses the current page after recovery',async t=>{
  const f=await serverFixture(t),{w,node}=f;
  const draft=w.document.createElement('input');w.document.body.append(draft);draft.value='미저장';draft.focus();
  f.update(authorized);assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'loading');
  assert.equal(w.document.activeElement,draft);assert.equal(node.querySelectorAll('a').length,0);
  await f.respond(0,503);assert.equal(node.hidden,false);assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'error');
  const retry=node.querySelector('button');retry.focus();retry.click();
  await f.tick();
  assert.equal(f.requests.length,2);assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'loading');
  assert.equal(w.document.activeElement,node.querySelector('.cw-feedback'));
  assert.equal(node.querySelector('button'),null,'There is no duplicate retry while a request is pending');
  await f.respond(1);
  assert.equal(node.querySelectorAll('a').length,2);assert.equal(w.document.activeElement.dataset.workspacePage,'home.profile');
  assert.equal(draft.value,'미저장');
  for(const {url,options} of f.requests){assert.equal(url,'/api/workspace/navigation');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');}
});

test('navigation separates expired login, denied access, empty result and invalid server IDs',async t=>{
  const f=await serverFixture(t),{w,node}=f;let loginPrompts=0;
  w.CompanyWorkspace={sessionExpired:()=>loginPrompts++};f.update(authorized);
  await f.respond(0,401);assert.match(node.textContent,/로그인 확인/);assert.equal(loginPrompts,0);
  node.querySelector('button').click();assert.equal(loginPrompts,1);assert.equal(f.requests.length,1,'Login guidance does not retry or redirect automatically');
  const denied=w.CompanyNavigation.refreshPermissions();await f.respond(1,403);await denied;
  assert.match(node.textContent,/이용 권한/);node.querySelector('button').click();await f.respond(2,200,[]);
  assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'empty');node.querySelector('button').click();
  assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'loading');await f.respond(3,200,['cs.players']);
  assert.equal(node.querySelectorAll('a').length,0);assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'error');
});

test('navigation rejects a malformed badge envelope before applying any page',async t=>{
  const f=await serverFixture(t),{node}=f;f.update(authorized);
  await f.respond(0,200,['home.dashboard','home.profile'],[]);
  assert.equal(node.querySelectorAll('a').length,0);
  assert.equal(node.querySelector('[data-state-kind]').dataset.stateKind,'error');
  node.querySelector('button').click();
  await f.respond(1,200,['home.dashboard','home.profile'],{'home.profile':'3'});
  assert.equal(node.querySelectorAll('a').length,2);
  assert.equal(node.querySelectorAll('[data-workspace-badge]').length,0);
});

test('account, role and service changes discard cached grants and stale responses',async t=>{
  const f=await serverFixture(t),{node}=f;
  f.update(authorized);await f.tick();f.update({...authorized,user:{...authorized.user,id:2}});await f.tick();
  assert.equal(f.requests[0].options.signal.aborted,true,'A replaced account request must be aborted before its late response');
  await f.respond(1,200,['home.profile']);await f.respond(0,200,['home.users']);
  assert.deepEqual([...node.querySelectorAll('a')].map(n=>n.dataset.workspacePage),['home.profile']);
  const next={...authorized,user:{...authorized.user,id:2,role:'admin'}};f.update(next);
  assert.equal(node.querySelectorAll('a').length,0);await f.respond(2,200,['home.users']);
  f.update({...next,services:[]});await f.tick();assert.equal(node.querySelectorAll('a').length,0);
  f.update({authenticated:false});await f.respond(3,200,['home.users']);
  assert.equal(f.requests[3].options.signal.aborted,true,'An anonymous scope must abort the pending private menu read');
  assert.equal(node.querySelectorAll('a').length,0);assert.equal(node.hidden,true);
  node.dataset.workspaceNavigation='leave';f.update({...authorized,services:[]});
  assert.equal(f.requests.length,4,'An ineligible service must not fetch its menu');assert.equal(node.hidden,true);
});

for(const mobile of [false,true]) for(const dark of [false,true])test(`actual CS document and full shell initialize (${mobile?'mobile':'desktop'}, ${dark?'dark':'light'})`,async t=>{
  const html=read('apps/cs/public/player-data.html');
  const dom=new JSDOM(html,{url:'https://cs.example.test/players',runScripts:'outside-only',pretendToBeVisual:true});
  cleanup(t,dom);
  const w=dom.window;
  w.AbortSignal.timeout=()=>new w.AbortController().signal;
  const errors=[]; w.addEventListener('error',e=>errors.push(e.message));
  w.ResizeObserver=class { observe(){} disconnect(){} };
  w.matchMedia=query=>({matches:query.includes('prefers-color-scheme')?dark:query.includes('max-width')?mobile:false,addEventListener(){},removeEventListener(){}});
  w.fetch=async url=>({ok:true,status:200,json:async()=>String(url).includes('/context')?{...authorized,profiles:{},csrfToken:'test-csrf'}:{items:[],sources:[],unreadCount:0}});
  w.eval(read('apps/portal/wwwroot/js/company-workspace.js'));
  await new Promise(resolve=>w.setTimeout(resolve,80));
  assert.deepEqual(errors,[]);
  assert.equal(w.document.querySelectorAll('.cw-header').length,1);
  assert.equal(w.document.querySelector('.cw-current-page').textContent,'플레이어 데이터');
  assert.equal(w.document.querySelectorAll('.cw-sidebar').length,1);
  assert.equal(w.document.querySelectorAll('.cw-page-link').length,4);
  assert.equal(w.document.querySelectorAll('[data-cw-sidebar-close]').length,1);
  assert.equal(w.document.documentElement.dataset.theme,dark?'dark':'light');
  const sidebar=w.document.querySelector('.cw-sidebar');
  assert.equal(sidebar.getAttribute('aria-hidden'),String(mobile));
  w.document.querySelector('[data-cw-nav]').click();
  assert.equal(sidebar.getAttribute('aria-hidden'),String(!mobile));
  w.history.pushState({},'', '/refunds');
  w.document.dispatchEvent(new w.CustomEvent('company-route-change'));
  assert.equal(w.document.querySelector('.cw-current-page').textContent,'Steam 환불');
});
