import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { root } from '../build-ui.mjs';
const source=readFileSync(resolve(root,'packages/workspace-ui/src/states.js'),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(t,html='<div id="state"></div>'){
  const dom=new JSDOM('<!doctype html><body>'+html,{runScripts:'outside-only'}),w=dom.window,observers=[],Native=w.MutationObserver;
  w.MutationObserver=class extends Native{constructor(callback){super(callback);observers.push(this);}};
  t.after(()=>{observers.forEach(o=>o.disconnect());w.close();});
  w.eval(source);await tick();
  return {w,node:w.document.querySelector('#state'),render:w.CompanyState.render};
}

test('shared states expose safe, accessible semantics for all five states',async t=>{
  const {w,node,render}=await fixture(t);
  assert.deepEqual([...w.CompanyState.kinds],['loading','empty','error','denied','success']);
  for(const kind of w.CompanyState.kinds){
    render(node,{kind,title:'<img src=x>',message:'<script>bad()</script>',actionLabel:'<retry>'});
    assert.equal(node.dataset.stateKind,kind);
    assert.equal(node.getAttribute('role'),kind==='error'?'alert':'status');
    assert.equal(node.getAttribute('aria-atomic'),'true');
    assert.equal(node.querySelector('strong').textContent,'<img src=x>');
    assert.equal(node.querySelector('img,script'),null);
    assert.equal(node.querySelector('button').type,'button');
    assert.equal(node.querySelector('button').disabled,kind==='loading');
  }
  for(const kind of ['unknown','__proto__','constructor'])assert.throws(()=>render(node,{kind}),/Unknown workspace state/);
});

test('identical state preserves DOM and uses latest callback; consumers can cancel actions',async t=>{
  const {node,render}=await fixture(t);let calls=0;
  render(node,{kind:'error',actionLabel:'재시도',onAction:()=>calls++});const button=node.querySelector('button');
  render(node,{kind:'error',actionLabel:'재시도',onAction:()=>calls+=10});
  assert.equal(node.querySelector('button'),button);button.click();assert.equal(calls,10);
  node.addEventListener('workspace-state-action',e=>e.preventDefault(),{once:true});button.click();assert.equal(calls,10);
  render(node,{kind:'loading',actionLabel:'재시도',onAction:()=>calls++});node.querySelector('button').click();assert.equal(calls,10);
});

test('state transitions retain keyboard focus without stealing focus from a draft',async t=>{
  const {w,node,render}=await fixture(t,'<input id="draft"><div id="state"></div>');
  const draft=w.document.querySelector('input');draft.value='보존할 초안';draft.focus();
  render(node,{kind:'error',actionLabel:'재시도'});assert.equal(w.document.activeElement,draft);
  node.querySelector('button').focus();render(node,{kind:'loading'});assert.equal(w.document.activeElement,node);
  render(node,{kind:'error',actionLabel:'재시도'});assert.equal(w.document.activeElement,node.querySelector('button'));
  assert.equal(draft.value,'보존할 초안');
});

test('declarative states hydrate initial, dynamic and changed content without replacing stable DOM',async t=>{
  const {w,node}=await fixture(t,'<div id="state" data-workspace-state="empty" data-state-title="조회 결과 없음"></div>');
  assert.equal(node.querySelector('strong').textContent,'조회 결과 없음');const heading=node.querySelector('strong');
  await tick();assert.equal(node.querySelector('strong'),heading);
  const added=w.document.createElement('div');added.dataset.workspaceState='error';added.dataset.stateActionLabel='재시도';w.document.body.append(added);await tick();
  assert.equal(added.dataset.stateKind,'error');let events=0;w.document.addEventListener('workspace-state-action',()=>events++);
  added.querySelector('button').click();assert.equal(events,1);
  added.dataset.workspaceState='success';added.dataset.stateMessage='저장되었습니다.';await tick();
  assert.equal(added.dataset.stateKind,'success');assert.equal(added.querySelector('p').textContent,'저장되었습니다.');
  const stable=added.querySelector('button');await tick();assert.equal(added.querySelector('button'),stable);
});

test('shared toasts replace duplicate ids, escape content and expose accessible close controls',async t=>{
  const {w}=await fixture(t);let calls=0;
  const first=w.CompanyToast.show({id:'lookup',kind:'success',title:'<img src=x>',message:'첫 결과',duration:0});
  assert.equal(first,'lookup');assert.equal(w.document.querySelectorAll('.cw-toast').length,1);
  assert.equal(w.document.querySelector('.cw-toast-stack').getAttribute('aria-live'),'polite');assert.equal(w.document.querySelector('.cw-toast-stack').getAttribute('aria-label'),'업무 알림');
  let toast=w.document.querySelector('.cw-toast');assert.equal(toast.querySelector('img'),null);assert.equal(toast.querySelector('strong').textContent,'<img src=x>');
  assert.equal(toast.querySelector('.cw-feedback').getAttribute('role'),'status');assert.equal(toast.querySelector('.cw-toast-close').getAttribute('aria-label'),'알림 닫기');
  w.CompanyToast.show({id:'lookup',kind:'error',title:'확인 필요',message:'최신 결과',actionLabel:'재시도',onAction:()=>calls++,duration:0});
  assert.equal(w.document.querySelectorAll('.cw-toast').length,1);toast=w.document.querySelector('.cw-toast');assert.match(toast.textContent,/최신 결과/);assert.equal(toast.querySelector('.cw-feedback').getAttribute('role'),'alert');
  toast.querySelector('[data-state-action]').click();assert.equal(calls,1);toast.querySelector('.cw-toast-close').click();assert.equal(w.document.querySelector('.cw-toast-stack'),null);
  assert.equal(w.CompanyToast.dismiss('lookup'),false);
});

test('shared toast timing keeps errors until dismissal and clears transient success',async t=>{
  const {w}=await fixture(t);
  w.CompanyToast.show({id:'success',kind:'success',message:'완료',duration:10});
  w.CompanyToast.show({id:'error',kind:'error',message:'실패'});
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(w.document.querySelector('[data-toast-id="success"]'),null);assert.ok(w.document.querySelector('[data-toast-id="error"]'));
  w.document.dispatchEvent(new w.Event('workspace-entity-scope-change'));assert.equal(w.document.querySelector('.cw-toast-stack'),null);
});
