import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
const tick=()=>new Promise(r=>setTimeout(r,0));
async function fixture(t, options={}) {
  const dom=new JSDOM('<form method="post" action="/save"><input name="Name" value="원본"><input name="Private" type="checkbox" value="true" checked><input name="Projects" value="1"><input name="Projects" value="2"><input name="__RequestVerificationToken" value="csrf"><input name="locked" value="no" disabled><button type="submit">저장</button></form><div id="state" hidden></div>',{url:'https://company.workspace.test',runScripts:'outside-only'});
  const w=dom.window,form=w.document.querySelector('form'),node=w.document.querySelector('#state');
  for(const file of ['states','forms'])w.eval(readFileSync(resolve(root,`packages/workspace-ui/src/${file}.js`),'utf8'));
  let calls=[],saved=0,settled=0,answer;
  w.fetch=(url,init)=>{calls.push({url,init});return new Promise(r=>{answer=r;});};
  const controller=w.CompanyForm.attach(form,{state:node,onSaved:()=>saved++,onSettled:()=>settled++,...options});
  form.elements.Name.value='수정 초안';
  t.after(()=>w.close());await tick();
  return {w,form,node,controller,calls,get saved(){return saved;},get settled(){return settled;},
    submit:()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})),
    reply:async(status,result,contentType=w.CompanyForm.mediaType)=>{answer({status,ok:status>=200&&status<300,headers:new Map([['content-type',contentType]]),json:async()=>result});await tick();}};
}
test('shared transport preserves native values, locks once, includes CSRF and reconciles only explicit acknowledgement',async t=>{
  const f=await fixture(t);f.submit();f.submit();
  assert.equal(f.calls.length,1);assert.equal(f.controller.busy,true);assert.equal(f.node.dataset.stateKind,'loading');
  const request=f.calls[0].init;
  assert.deepEqual(request.body.getAll('Projects'),['1','2']);assert.equal(request.body.get('Name'),'수정 초안');
  assert.equal(request.body.get('Private'),'true');assert.equal(request.body.get('locked'),null);assert.equal(request.body.get('__RequestVerificationToken'),'csrf');
  assert.equal(request.redirect,'manual');assert.equal(request.credentials,'same-origin');
  assert.equal(f.form.elements.Name.disabled,true);
  await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'반영 완료',data:{}});
  assert.equal(f.saved,1);assert.equal(f.settled,1);assert.equal(f.node.dataset.stateKind,'success');
  assert.equal(f.form.elements.Name.disabled,false);assert.equal(f.form.elements.locked.disabled,true);assert.equal(f.controller.busy,false);
});
test('validation, conflict, auth, HTML, invalid acknowledgements and server failures preserve drafts without retries',async t=>{
  const f=await fixture(t);
  for(const status of [422,409,401,403,500,200,302]) {
    f.submit();await f.reply(status,{protocol:'workspace-form-v1',outcome:status===409?'conflict':'invalid',message:'확인 필요'},status===302?'text/html':undefined);
    assert.equal(f.saved,0);assert.equal(f.form.elements.Name.value,'수정 초안');assert.equal(f.form.elements.Name.defaultValue,'원본');
    assert.equal(f.form.elements.Name.disabled,false);assert.equal(f.form.elements.Private.checked,true);
    assert.equal(f.node.dataset.stateKind,[401,403].includes(status)?'denied':'error');
  }
  await tick();assert.equal(f.calls.length,7);
  f.w.fetch=async()=>{throw Error('network');};f.submit();await tick();
  assert.match(f.node.textContent,/반영되었을 수도/);assert.equal(f.saved,0);assert.equal(f.settled,8);
});
test('timeouts are unconfirmed writes and never discard or retry a draft',async t=>{
  const f=await fixture(t,{timeoutMs:5});let calls=0;
  f.w.fetch=(_,init)=>new Promise((_,reject)=>{calls++;init.signal.addEventListener('abort',()=>reject(Error('timeout')));});
  f.submit();await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);assert.equal(f.controller.busy,false);
  assert.equal(f.form.elements.Name.value,'수정 초안');assert.match(f.node.textContent,/자동으로 다시 전송하지 않습니다/);
});

test('conflict review is an explicit action, not an automatic read or repeated write',async t=>{
  let reviewed=0;const f=await fixture(t,{onConflict:()=>reviewed++});
  f.submit();await f.reply(409,{protocol:'workspace-form-v1',outcome:'conflict',message:'다른 변경 있음'});
  assert.equal(reviewed,0);assert.equal(f.calls.length,1);
  f.node.querySelector('button').click();assert.equal(reviewed,1);assert.equal(f.calls.length,1);
  f.submit();await f.reply(422,{protocol:'workspace-form-v1',outcome:'invalid',message:'입력 확인'});
  assert.equal(f.node.querySelector('button'),null);assert.equal(reviewed,1);
});
test('cross-origin and invalid forms cannot send; consumer reconciliation failures cannot claim success',async t=>{
  const f=await fixture(t,{onSaved:()=>{throw Error('incomplete');}});
  f.form.action='https://other.test/save';f.submit();assert.equal(f.calls.length,0);
  f.form.action='/save';f.form.elements.Name.required=true;f.form.elements.Name.value='';f.submit();assert.equal(f.calls.length,0);
  f.form.elements.Name.value='초안';f.submit();await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'완료'});
  assert.equal(f.node.dataset.stateKind,'error');assert.equal(f.form.elements.Name.value,'초안');assert.equal(f.controller.busy,false);
});

test('scope change releases a pending write once, preserves drafts and ignores even non-abortable late replies',async t=>{
  const outcomes=[];const f=await fixture(t,{onSettled:(saved,reason)=>outcomes.push([saved,reason])});
  f.submit();const request=f.calls[0].init;
  f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  assert.equal(request.signal.aborted,true);assert.equal(f.controller.busy,false);
  assert.deepEqual(outcomes,[[false,'scope-changed']]);assert.equal(f.form.elements.Name.disabled,false);
  assert.equal(f.form.elements.locked.disabled,true);assert.equal(f.form.elements.Name.value,'수정 초안');
  assert.match(f.node.textContent,/서버에는 반영되었을 수/);
  await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'늦은 성공',data:{}});
  assert.equal(f.saved,0);assert.equal(f.node.dataset.stateKind,'denied');assert.equal(outcomes.length,1);
  assert.equal(f.calls.length,1);
});

test('scope changes during response parsing and consumer awaits invalidate acknowledgement context',async t=>{
  for(const phase of ['json','consumer']) {
    let release,applied=0,context;
    const f=await fixture(t,{onSaved:async(_result,_data,scope)=>{
      context=scope;await new Promise(r=>{release=r;});if(scope.isCurrent())applied++;
    }});
    if(phase==='json')f.w.fetch=async()=>({status:200,ok:true,headers:new Map([['content-type',f.w.CompanyForm.mediaType]]),json:()=>new Promise(r=>{release=r;})});
    f.submit();if(phase==='consumer')await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{}});
    await tick();f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
    release({protocol:'workspace-form-v1',outcome:'saved',message:'늦은 성공',data:{}});await tick();
    assert.equal(applied,0);assert.equal(f.settled,1);assert.equal(f.node.dataset.stateKind,'denied');
    if(context){assert.equal(context.isCurrent(),false);assert.equal(context.signal.aborted,true);}
  }
});

test('dispose immediately restores detached controls, removes scope listener and suppresses late callbacks',async t=>{
  const f=await fixture(t);f.form.setAttribute('aria-busy','false');f.submit();f.form.remove();
  f.controller.dispose();f.controller.dispose();
  assert.equal(f.controller.busy,false);assert.equal(f.calls[0].init.signal.aborted,true);
  assert.equal(f.form.elements.Name.disabled,false);assert.equal(f.form.elements.locked.disabled,true);
  assert.equal(f.form.getAttribute('aria-busy'),'false');const html=f.node.innerHTML;
  f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'늦은 성공',data:{}});
  assert.equal(f.saved,0);assert.equal(f.settled,0);assert.equal(f.node.innerHTML,html);
  f.w.document.body.append(f.form);f.submit();assert.equal(f.calls.length,1);
});

test('a detached form cannot reconcile a late write even if the consumer omitted disposal',async t=>{
  const f=await fixture(t);f.submit();f.form.remove();const html=f.node.innerHTML;
  await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{}});
  assert.equal(f.saved,0);assert.equal(f.settled,0);assert.equal(f.controller.busy,false);
  assert.equal(f.form.elements.Name.disabled,false);assert.equal(f.node.innerHTML,html);
});

test('timeout releases non-abortable requests; stale finalization cannot unlock a newer explicit submission',async t=>{
  const outcomes=[];const f=await fixture(t,{timeoutMs:25,onSettled:(saved,reason)=>outcomes.push([saved,reason])});
  const replies=[];f.w.fetch=(_,init)=>new Promise(r=>replies.push({resolve:r,init}));
  const ack={status:200,ok:true,headers:new Map([['content-type',f.w.CompanyForm.mediaType]]),json:async()=>({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{}})};
  f.submit();await new Promise(r=>setTimeout(r,40));
  assert.equal(replies[0].init.signal.aborted,true);assert.equal(f.controller.busy,false);assert.equal(replies.length,1);
  assert.deepEqual(outcomes,[[false,'unknown']]);f.submit();
  replies[0].resolve(ack);await tick();assert.equal(f.controller.busy,true);assert.equal(f.form.elements.Name.disabled,true);assert.equal(f.saved,0);
  replies[1].resolve(ack);await tick();assert.equal(f.saved,1);assert.equal(f.controller.busy,false);
  assert.deepEqual(outcomes,[[false,'unknown'],[true,'saved']]);
});

test('settlement reasons distinguish invalid, conflict, denied and unknown without clearing values',async t=>{
  const outcomes=[];const f=await fixture(t,{onSettled:(saved,reason)=>outcomes.push([saved,reason])});
  for(const [status,outcome] of [[422,'invalid'],[409,'conflict'],[403,'denied'],[500,'unknown']]){
    f.submit();await f.reply(status,{protocol:'workspace-form-v1',outcome,message:'확인'});
  }
  assert.deepEqual(outcomes,[[false,'invalid'],[false,'conflict'],[false,'denied'],[false,'unknown']]);
  assert.equal(f.form.elements.Name.value,'수정 초안');
});

test('abort listeners can dispose the same form reentrantly without stale finalization or a thrown error',async t=>{
  const f=await fixture(t);f.submit();
  f.calls[0].init.signal.addEventListener('abort',()=>f.controller.dispose());
  assert.doesNotThrow(()=>f.controller.dispose());
  assert.equal(f.controller.busy,false);assert.equal(f.form.elements.Name.disabled,false);
  await f.reply(200,{protocol:'workspace-form-v1',outcome:'saved',message:'늦은 성공',data:{}});
  assert.equal(f.saved,0);assert.equal(f.settled,0);
});
