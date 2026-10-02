import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t,options={}){
  const dom=new JSDOM('',{url:'https://schedule.workspace.test',runScripts:'outside-only'}),w=dom.window;
  w.eval(readFileSync(new URL('../../packages/workspace-ui/src/forms.js',import.meta.url),'utf8'));
  const states=[],calls=[],applied=[],settled=[];
  w.fetch=(url,init)=>new Promise(resolve=>calls.push({url,init,resolve}));
  const controller=w.CompanyForm.createTransport({onState:s=>states.push(s),onSaved:(data,sent)=>applied.push({data,sent}),onSettled:(...args)=>settled.push(args),...options});
  const response=(status=200,outcome='saved',extra={})=>({status,ok:status>=200&&status<300,headers:new Map([['content-type',w.CompanyForm.mediaType]]),json:async()=>({protocol:'workspace-form-v1',message:'확인',outcome,data:{id:1}}),...extra});
  t.after(()=>{controller.dispose();w.close();});
  return {w,controller,states,calls,applied,settled,response};
}
for(const method of ['POST','PUT','PATCH','DELETE'])test(`shared JSON ${method} snapshots exact payload and preserves authenticated same-origin boundaries`,async t=>{
  const f=fixture(t),payload={body:'9223372036854775807',values:[1,2]},pending=f.controller.send({url:'/api/tasks/1',method,json:payload,headers:{'X-CSRF-TOKEN':'synthetic',Accept:'text/html'}});
  payload.body='later';payload.values.push(3);
  assert.equal(f.calls.length,1);const request=f.calls[0];
  assert.equal(request.init.method,method);assert.equal(request.url,'https://schedule.workspace.test/api/tasks/1');
  assert.equal(request.init.body,'{"body":"9223372036854775807","values":[1,2]}');
  assert.equal(request.init.headers.get('Accept'),f.w.CompanyForm.mediaType);assert.equal(request.init.headers.get('X-CSRF-TOKEN'),'synthetic');
  assert.equal(request.init.headers.get('content-type'),'application/json');assert.equal(request.init.credentials,'same-origin');assert.equal(request.init.redirect,'manual');
  request.resolve(f.response());assert.equal((await pending).saved,true);assert.equal(f.applied[0].sent.body,'9223372036854775807');
  assert.equal(f.states.at(-1).kind,'success');assert.equal(f.controller.busy,false);
});
test('JSON invalid destinations, bodies and missing acknowledgement validators never send',async t=>{
  const f=fixture(t);
  for(const input of [{url:'https://other.test/x',json:{}},{url:'https://user:password@schedule.workspace.test/x',json:{}},
    {url:'/api/tasks',method:'GET',json:{}},{url:'/api/tasks',json:undefined},{url:'/api/tasks',json:{number:1n}},
    {url:'/api/tasks',json:{},formData:new f.w.FormData()}]){
    assert.equal((await f.controller.send(input)).outcome,'not-sent');
  }
  const missing=f.w.CompanyForm.createTransport({onState:()=>{}});
  assert.equal((await missing.send({url:'/api/tasks',json:{}})).outcome,'not-sent');missing.dispose();
  assert.equal(f.calls.length,0);
});
test('JSON status/outcome and content type must match exactly; uncertain writes are not retried',async t=>{
  const f=fixture(t);
  for(const [status,outcome,type] of [[409,'invalid'],[422,'conflict'],[500,'saved'],[200,'unknown'],[200,'saved',f.w.CompanyForm.mediaType+'-fake'],[302,'saved']]){
    const pending=f.controller.send({url:'/api/tasks',json:{body:'초안'}});
    f.calls.at(-1).resolve(f.response(status,outcome,type?{headers:new Map([['content-type',type]])}:{}));
    assert.equal((await pending).outcome,'unknown');assert.equal(f.states.at(-1).kind,'error');
  }
  assert.equal(f.applied.length,0);assert.equal(f.calls.length,6);
});
for(const phase of ['fetch','json','consumer'])test(`JSON timeout settles a non-abortable ${phase} and ignores late application`,async t=>{
  let release,applied=0;
  const f=fixture(t,{timeoutMs:10,onSaved:async(_data,_sent,context)=>{if(phase==='consumer')await new Promise(r=>release=r);if(context.isCurrent())applied++;}});
  const pending=f.controller.send({url:'/api/tasks',json:{}});
  if(phase!=='fetch')f.calls[0].resolve(f.response(200,'saved',phase==='json'?{json:()=>new Promise(r=>release=r)}:{}));
  const result=await pending;assert.equal(result.outcome,'unknown');assert.equal(f.controller.busy,false);assert.equal(f.calls[0].init.signal.aborted,true);
  if(phase==='fetch')f.calls[0].resolve(f.response());else release({protocol:'workspace-form-v1',outcome:'saved',message:'late',data:{}});
  await tick();assert.equal(applied,0);assert.equal(f.settled.length,1);assert.equal(f.states.at(-1).kind,'error');
});
for(const interruption of ['scope','signal','pagehide'])test(`JSON ${interruption} promptly settles and rejects late responses`,async t=>{
  const f=fixture(t),abort=new f.w.AbortController();
  const pending=f.controller.send({url:'/api/tasks',json:{},signal:abort.signal});
  if(interruption==='scope')f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  if(interruption==='signal')abort.abort();
  if(interruption==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
  assert.equal((await pending).saved,false);assert.equal(f.controller.busy,false);
  f.calls[0].resolve(f.response());await tick();assert.equal(f.applied.length,0);
  assert.equal(f.settled.length,interruption==='pagehide'?0:1);
});
test('document sessions retain unknown locks across editor remounts and release only verified conflict baselines',t=>{
  const f=fixture(t),session=f.w.CompanyForm.documentSession('tasks');
  const remove=session.track('one',()=>true),lease=session.begin('one',['task:1:old']);
  lease.finish('conflict');assert.equal(session.invalid,false);assert.equal(session.begin('one',['task:1:old']),null);
  const next=session.begin('one',['task:1:new']);next.finish('unknown');remove();
  const reopened=f.w.CompanyForm.documentSession('tasks');reopened.track('two');assert.equal(reopened,session);assert.equal(reopened.begin('two',['task:1:latest']),null);
  const active=f.w.CompanyForm.documentSession('another'),untrack=active.track('open');active.begin('open',['r']);untrack();assert.equal(active.invalid,true);
});

test('explicit idle scope recovery retains consumed baselines and invalidates old leases',t=>{
  const f=fixture(t),session=f.w.CompanyForm.documentSession('tasks');session.track('editor');
  const used=session.begin('editor',['old']);used.markSent();used.finish('saved');
  const pending=session.begin('editor',['new']);const before=session.revision;
  f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  assert.equal(pending.signal.aborted,true);assert.equal(pending.current,false);
  assert.equal(session.recoverScope(),true);assert.ok(session.revision>before);
  assert.equal(pending.markSent(),false);assert.equal(pending.finish('saved'),false);
  assert.equal(session.begin('editor',['old']),null);
  const next=session.begin('editor',['new']);assert.ok(next);next.finish('cancelled');
});

for(const interruption of ['scope','untrack','unknown','pagehide'])test(`sent ${interruption} cannot be unlocked by an explicit scope recovery`,t=>{
  const f=fixture(t),session=f.w.CompanyForm.documentSession('tasks'),untrack=session.track('editor');
  const lease=session.begin('editor',['r']);assert.equal(lease.markSent(),true);
  if(interruption==='scope')f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  if(interruption==='untrack')untrack();
  if(interruption==='unknown')lease.finish('unknown');
  if(interruption==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
  assert.equal(session.recoverScope(),false);assert.equal(lease.current,false);
  assert.equal(session.begin('editor',['different']),null);
});
