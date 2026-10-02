import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
function fixture(t) {
  const dom = new JSDOM('<button>실행</button>', {runScripts:'outside-only'}), w = dom.window;
  const observers=[], NativeObserver=w.MutationObserver;
  w.MutationObserver=class extends NativeObserver { constructor(callback){super(callback);observers.push(this);} };
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new w.Event('close')); };
  for (const name of ['dialogs','review']) w.eval(readFileSync(resolve(root,`packages/workspace-ui/src/${name}.js`),'utf8'));
  t.after(() => {observers.forEach(observer=>observer.disconnect());w.close();}); return w;
}

test('owned modal keeps React nodes/drafts, reads fresh close guards and isolates nested Escape',async t=>{
  const w=fixture(t),d=w.document, parent=d.createElement('dialog'), child=d.createElement('dialog');
  parent.innerHTML='<input value="unsaved"><button>child</button>';parent.append(child);d.body.append(parent);
  let allow=false,closed=0,bubbled=0;
  const p=w.CompanyDialog.attach(parent,{scope:'retain',canClose:()=>allow,onClose:()=>closed++});
  parent.addEventListener('cancel',()=>bubbled++);
  const c=w.CompanyDialog.attach(child,{scope:'dismiss'});
  child.dispatchEvent(new w.Event('cancel',{cancelable:true,bubbles:true}));
  assert.equal(await c.closed,null);assert.equal(child.isConnected,true);assert.equal(parent.open,true);assert.equal(bubbled,0);
  assert.equal(p.requestClose(),false);parent.close();assert.equal(parent.open,true);assert.equal(closed,0);
  allow=true;assert.equal(p.requestClose(),true);await p.closed;
  assert.equal(closed,1);assert.equal(parent.isConnected,true);assert.equal(parent.querySelector('input').value,'unsaved');
  p.dispose();assert.equal(closed,1);
});

test('owned asynchronous close waits for shared confirmation and blocks direct/duplicate bypass',async t=>{
  const w=fixture(t),d=w.document,parent=d.createElement('dialog');parent.innerHTML='<input value="unsaved">';d.body.append(parent);
  let closed=0,calls=0;
  const p=w.CompanyDialog.attach(parent,{scope:'retain',onClose:()=>closed++,beforeCloseRequest:async({signal})=>{
    calls++;const intent=await w.CompanyDialog.confirm({title:'초안 버리기',signal});return intent?()=>parent.querySelector('input').value==='unsaved':null;
  }});
  let pending=p.requestCloseAsync();assert.equal(parent.open,true);assert.equal(p.requestClose(),false);assert.equal(await p.requestCloseAsync(),false);
  d.querySelector('[data-confirm-cancel]').click();assert.equal(await pending,false);assert.equal(closed,0);assert.equal(parent.open,true);
  pending=p.requestCloseAsync();d.querySelector('[data-confirm-apply]').click();assert.equal(await pending,true);
  assert.equal(calls,2);assert.equal(closed,1);assert.equal(parent.open,false);assert.equal(parent.querySelector('input').value,'unsaved');
});

for(const reason of ['cancel','close'])test(`owned asynchronous ${reason} retains its native node until a checked approval`,async t=>{
  const w=fixture(t),d=w.document,parent=d.createElement('dialog');d.body.append(parent);let approve,closed;
  const p=w.CompanyDialog.attach(parent,{scope:'retain',onClose:value=>closed=value,beforeCloseRequest:()=>new Promise(resolve=>approve=resolve)});
  if(reason==='close')parent.close();else parent.dispatchEvent(new w.Event('cancel',{cancelable:true,bubbles:true}));
  assert.equal(parent.open,true);assert.equal(closed,undefined);approve(()=>true);await new Promise(resolve=>w.setTimeout(resolve,0));
  await p.closed;assert.equal(closed,reason);assert.equal(parent.open,false);
});

for(const action of ['scope','dispose','abort','detach','draft','guard','child'])test(`owned asynchronous close rejects stale ${action} approval`,async t=>{
  const w=fixture(t),d=w.document,parent=d.createElement('dialog'),outer=new w.AbortController();d.body.append(parent);
  let settle,signal,valid=true,allowed=true,closed=0;
  const p=w.CompanyDialog.attach(parent,{scope:'retain',signal:outer.signal,canClose:()=>allowed,onClose:()=>closed++,
    beforeCloseRequest:context=>{signal=context.signal;return new Promise(resolve=>settle=resolve);}});
  const pending=p.requestCloseAsync();
  if(action==='scope')d.dispatchEvent(new w.Event('workspace-entity-scope-change'));
  if(action==='dispose')p.dispose();if(action==='abort')outer.abort();if(action==='detach')parent.remove();
  if(action==='draft')valid=false;if(action==='guard')allowed=false;
  let child;if(action==='child'){const node=d.createElement('dialog');d.body.append(node);child=w.CompanyDialog.attach(node,{scope:'dismiss'});}
  if(['scope','dispose','abort'].includes(action)){assert.equal(signal.aborted,true);assert.equal(await pending,false,'abort-ignoring callback must not hold the request');}
  settle(()=>valid);assert.equal(await pending,false);assert.equal(closed,action==='abort'?1:0);
  if(!['dispose','abort','detach'].includes(action))assert.equal(parent.open,true);
  child?.dispose();p.dispose();
});

test('asynchronous close rejects truthy values, exceptions and final permission exceptions',async t=>{
  const w=fixture(t),d=w.document;
  for(const request of [()=>true,()=>Promise.resolve(true),()=>{throw Error('hook');},()=>()=>{throw Error('permission');}]){
    const node=d.createElement('dialog');d.body.append(node);const p=w.CompanyDialog.attach(node,{scope:'retain',beforeCloseRequest:request});
    assert.equal(await p.requestCloseAsync(),false);assert.equal(node.open,true);p.dispose();node.remove();
  }
});

test('owned draft survives scope change but child and transient intent close',async t=>{
  const w=fixture(t),d=w.document,parent=d.createElement('dialog'),child=d.createElement('dialog');d.body.append(parent,child);
  const p=w.CompanyDialog.attach(parent,{scope:'retain'}), c=w.CompanyDialog.attach(child,{scope:'dismiss'});
  const confirmation=w.CompanyDialog.confirm({title:'실행'});
  d.dispatchEvent(new w.Event('workspace-entity-scope-change'));
  assert.equal(await confirmation,null);await c.closed;
  assert.equal(parent.open,true);assert.equal(child.open,false);
  p.dispose();assert.equal(parent.open,false);assert.equal(parent.isConnected,true);
});

test('parent disposal closes portal children and confirmation, without invoking parent state setters',async t=>{
  const w=fixture(t),d=w.document,parent=d.createElement('dialog'),child=d.createElement('dialog');d.body.append(parent,child);
  let parentClosed=0,childReason;
  const p=w.CompanyDialog.attach(parent,{scope:'retain',onClose:()=>parentClosed++});
  const c=w.CompanyDialog.attach(child,{scope:'dismiss',onClose:reason=>childReason=reason});
  const intent=w.CompanyDialog.confirm({title:'실행'});p.dispose();
  assert.equal(await intent,null);await c.closed;
  assert.equal(parentClosed,0);assert.equal(childReason,'parent');assert.equal(child.open,false);assert.equal(parent.open,false);
  assert.equal(child.isConnected,true);
  const next=w.CompanyDialog.confirm({title:'다음'});d.querySelector('[data-confirm-cancel]').click();await next;
});

test('owned cleanup/remount ignores queued close and recovers from failed native opening',async t=>{
  const w=fixture(t),d=w.document,dialog=d.createElement('dialog');d.body.append(dialog);
  assert.throws(()=>w.CompanyDialog.attach(dialog,{}),/scope policy/);
  const open=w.HTMLDialogElement.prototype.showModal;
  w.HTMLDialogElement.prototype.showModal=()=>{throw Error('failed');};
  assert.throws(()=>w.CompanyDialog.attach(dialog,{scope:'retain'}),/failed/);
  assert.equal(dialog.isConnected,true);w.HTMLDialogElement.prototype.showModal=open;
  let changed=0;
  const first=w.CompanyDialog.attach(dialog,{scope:'retain',onClose:()=>changed++});
  assert.throws(()=>w.CompanyDialog.attach(dialog,{scope:'retain'}),/already attached/);
  first.dispose();assert.equal(changed,0);
  const second=w.CompanyDialog.attach(dialog,{scope:'retain'});
  dialog.dispatchEvent(new w.Event('close'));assert.equal(dialog.open,true);
  second.dispose();d.dispatchEvent(new w.Event('workspace-entity-scope-change'));
  assert.equal(changed,0);assert.equal(dialog.open,false);
});

test('abort and throwing child callbacks still release all nested lifetimes',async t=>{
  const w=fixture(t),d=w.document,p=d.createElement('dialog'),c=d.createElement('dialog'),signal=new w.AbortController();d.body.append(p,c);
  const reported=[];w.reportError=error=>reported.push(error.message);
  const parent=w.CompanyDialog.attach(p,{scope:'retain',signal:signal.signal,canClose:()=>false});
  const child=w.CompanyDialog.attach(c,{scope:'dismiss',onClose:()=>{throw Error('child failed');}});
  const intent=w.CompanyDialog.confirm({title:'확인'});signal.abort();
  await parent.closed;await child.closed;assert.equal(await intent,null);
  assert.equal(p.open,false);assert.equal(c.open,false);assert.deepEqual(reported,['child failed']);
  const reopened=w.CompanyDialog.attach(p,{scope:'retain'});reopened.dispose();
});
test('pending form Escape is held but scope invalidation still releases reusable dialog nodes', async t => {
  const w=fixture(t),dialog=w.document.createElement('dialog');let pending=true;
  let lifetime=w.CompanyDialog.present(dialog,{canCancel:()=>!pending});
  dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,true);
  w.document.dispatchEvent(new w.Event('workspace-entity-scope-change'));assert.equal(await lifetime.closed,null);
  assert.equal(dialog.isConnected,false);
  pending=false;lifetime=w.CompanyDialog.present(dialog,{canCancel:()=>!pending});
  dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(await lifetime.closed,null);
  lifetime=w.CompanyDialog.present(dialog,{canCancel:()=>{throw Error('invalid');}});
  dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,true);
  dialog.close();assert.equal(await lifetime.closed,null);
});

test('confirmation escapes content and requires an exact phrase before returning intent', async t => {
  const w=fixture(t),opener=w.document.querySelector('button');opener.focus();
  const pending=w.CompanyDialog.confirm({title:'<img src=x>',message:'<script>bad()</script>',confirmationText:'수식 제거',details:[{label:'대상',value:'9007199254740993'}]});
  const dialog=w.document.querySelector('dialog'),input=dialog.querySelector('input'),apply=dialog.querySelector('[data-confirm-apply]');
  assert.equal(dialog.querySelector('img,script'),null);assert.match(dialog.textContent,/9007199254740993/);
  for(const value of ['','수식','수식 제거 ']){input.value=value;input.dispatchEvent(new w.Event('input'));assert.equal(apply.disabled,true);}
  input.value='수식 제거';input.dispatchEvent(new w.Event('input'));apply.click();
  assert.equal((await pending).confirmation,'수식 제거');assert.equal(w.document.activeElement,opener);assert.equal(dialog.isConnected,false);
});

test('confirmation optional entities reuse exact-ID profile/project rendering and safe fallback labels',async t=>{
  const w=fixture(t);w.CompanyWorkspace={profileUrl:id=>'/profiles/'+id,projectUrl:id=>'/projects/'+id};
  w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/entity-display.js'),'utf8'));
  for(const kind of ['employee','project']){
    const pending=w.CompanyDialog.confirm({title:'확인',details:[{label:'대상',value:'<script>bad()</script>',entity:{kind,id:'9007199254740993',name:'직원'}}]});
    const dialog=w.document.querySelector('dialog'),image=dialog.querySelector('.cw-entity-avatar img');
    assert.equal(image.getAttribute('src'),(kind==='employee'?'/profiles/':'/projects/')+'9007199254740993');assert.equal(dialog.querySelector('script'),null);
    dialog.querySelector('[data-confirm-cancel]').click();await pending;
  }
  const pending=w.CompanyDialog.confirm({title:'확인',details:[{label:'직원',value:'연결 전 직원',entity:{kind:'employee',id:null,name:'연결 전 직원'}}]});
  assert.equal(w.document.querySelector('.cw-entity-avatar').textContent,'연');assert.equal(w.document.querySelector('.cw-entity-avatar img'),null);
  w.document.querySelector('[data-confirm-cancel]').click();await pending;
});
test('cancel, Escape, native close, scope change and abort all discard intent and release the singleton', async t => {
  const w=fixture(t);
  for(const action of ['cancel','escape','close','scope','abort']){
    const controller=new w.AbortController(),pending=w.CompanyDialog.confirm({title:'실행',message:'확인',signal:controller.signal});
    const dialog=w.document.querySelector('dialog');
    if(action==='cancel')dialog.querySelector('[data-confirm-cancel]').click();
    if(action==='escape')dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));
    if(action==='close')dialog.close();
    if(action==='scope')w.document.dispatchEvent(new w.Event('workspace-entity-scope-change'));
    if(action==='abort')controller.abort();
    assert.equal(await pending,null);assert.equal(dialog.isConnected,false);
  }
  const controller=new w.AbortController();controller.abort();
  assert.equal(await w.CompanyDialog.confirm({signal:controller.signal}),null);
  const review=w.CompanyReview.open({items:[]});
  assert.throws(()=>w.CompanyDialog.confirm({title:'test'}),/already open/);
  w.document.querySelector('[data-review-cancel]').click();await review;
});
test('failed native open and focus restore never leave a locked or unresolved dialog', async t => {
  const w=fixture(t),original=w.HTMLDialogElement.prototype.showModal;
  w.HTMLDialogElement.prototype.showModal=function(){throw Error('unsupported');};
  assert.throws(()=>w.CompanyDialog.confirm({title:'실행'}),/unsupported/);
  assert.equal(w.document.querySelector('dialog'),null);w.HTMLDialogElement.prototype.showModal=original;
  const opener=w.document.querySelector('button');opener.focus=()=>{throw Error('removed owner');};
  const pending=w.CompanyDialog.confirm({title:'다시 실행',returnFocus:opener});
  w.document.querySelector('[data-confirm-cancel]').click();assert.equal(await pending,null);
  const review=w.CompanyReview.open({items:[]});w.document.querySelector('[data-review-cancel]').click();assert.equal(await review,null);
});
test('focus restoration waits for a React trigger to unlock without stealing a newer modal focus', async t => {
  const w=fixture(t),opener=w.document.querySelector('button');let frame;
  w.requestAnimationFrame=callback=>{frame=callback;};
  const focus=opener.focus.bind(opener);let locked=true;opener.focus=()=>{if(!locked)focus();};
  let pending=w.CompanyDialog.confirm({title:'확인',returnFocus:opener});w.document.querySelector('[data-confirm-cancel]').click();await pending;
  assert.equal(w.document.activeElement,w.document.body);locked=false;frame();assert.equal(w.document.activeElement,opener);
  locked=true;pending=w.CompanyDialog.confirm({title:'이전',returnFocus:opener});w.document.querySelector('[data-confirm-cancel]').click();await pending;
  const next=w.CompanyDialog.confirm({title:'새 확인'});const heading=w.document.querySelector('h2');locked=false;frame();assert.equal(w.document.activeElement,heading);
  w.document.querySelector('[data-confirm-cancel]').click();await next;
});

test('disabled and stale context validations cannot confirm, including validation exceptions', async t => {
  const w=fixture(t);let pending=w.CompanyDialog.confirm({title:'실행',disabledReason:'쓰기 권한이 없습니다.'});
  let dialog=w.document.querySelector('dialog');assert.equal(dialog.querySelector('[data-confirm-apply]').disabled,true);
  assert.match(dialog.textContent,/쓰기 권한/);dialog.querySelector('[data-confirm-cancel]').click();assert.equal(await pending,null);
  let valid=false;
  pending=w.CompanyDialog.confirm({title:'실행',validate:()=>{if(!valid)throw Error('private implementation');return null;}});
  dialog=w.document.querySelector('dialog');dialog.querySelector('[data-confirm-apply]').click();
  assert.equal(dialog.open,true);assert.match(dialog.querySelector('[role=alert]').textContent,/실행 조건/);assert.doesNotMatch(dialog.textContent,/private implementation/);
  valid=true;dialog.querySelector('[data-confirm-apply]').click();assert.equal((await pending).confirmation,'');
});
