import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../../packages/workspace-ui/src/disclosure.js',import.meta.url),'utf8');
function fixture(options={}) {
  const dom=new JSDOM('<form id="root"><input id="search"><button type="button" data-cw-disclosure="user-1" data-cw-closed-label="정보" data-cw-open-label="닫기">정보</button><button type="button" data-cw-disclosure="user-1"><span>공개 설정</span></button><div data-cw-disclosure-panel="user-1" hidden><input name="name" value="원본"><input name="private" type="checkbox"></div><button type="button" data-cw-disclosure="user-2">두 번째</button><div data-cw-disclosure-panel="user-2" hidden><input name="email" value="synthetic@example.test"></div></form>',{runScripts:'outside-only'});
  dom.window.eval(source);const {document}=dom.window,root=document.getElementById('root'),controller=dom.window.CompanyDisclosure.attach(root,options);
  return {dom,document,root,controller,buttons:[...root.querySelectorAll('[data-cw-disclosure]')],panels:[...root.querySelectorAll('[data-cw-disclosure-panel]')]};
}
test('multiple trigger labels and aria share the visible panel without replacing fields or values',()=>{
  const f=fixture(),[first,second]=f.panels,input=first.querySelector('input');let writes=0;f.root.addEventListener('submit',e=>{e.preventDefault();writes++;});
  f.buttons[0].click();assert.equal(first.hidden,false);assert.equal(f.buttons[0].textContent,'닫기');assert.equal(f.buttons[1].innerHTML,'<span>공개 설정</span>');
  for(const button of f.buttons.slice(0,2)){assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(f.document.getElementById(button.getAttribute('aria-controls')),first);}
  input.value='저장하지 않은 초안';first.querySelector('[type=checkbox]').checked=true;f.buttons[2].click();assert.equal(first.hidden,false);assert.equal(second.hidden,false);
  f.buttons[1].click();assert.equal(first.hidden,true);assert.equal(f.buttons[0].textContent,'정보');assert.equal(input.value,'저장하지 않은 초안');assert.equal(new f.dom.window.FormData(f.root).get('name'),'저장하지 않은 초안');assert.equal(new f.dom.window.FormData(f.root).get('private'),'on');assert.equal(writes,0);
  f.buttons[0].click();assert.equal(first.querySelector('input'),input);f.dom.window.close();
});
test('programmatic filter close restores focus if needed and never clears the hidden draft',()=>{
  const f=fixture();f.controller.setOpen('user-1',true);const input=f.panels[0].querySelector('input');input.value='남을 내용';input.focus();
  f.controller.setOpen('user-1',false,{returnFocus:f.document.getElementById('search')});assert.equal(f.document.activeElement.id,'search');assert.equal(input.value,'남을 내용');
  for(const button of f.buttons.slice(0,2))assert.equal(button.getAttribute('aria-expanded'),'false');f.controller.setOpen('user-1',true);input.focus();f.controller.setOpen('user-1',false);assert.equal(f.document.activeElement,f.buttons[0]);f.dom.window.close();
});
test('single mode switches atomically only after an explicit synchronous approval',()=>{
  let allow=false,plan;const f=fixture({single:true,beforeChange:value=>{plan=value;return allow;}});assert.equal(f.controller.setOpen('user-1',true),false);allow=true;f.controller.setOpen('user-1',true);allow=false;
  f.buttons[2].click();assert.equal(f.controller.isOpen('user-1'),true);assert.equal(f.controller.isOpen('user-2'),false);assert.equal(plan.changes.length,2);
  allow=true;f.buttons[2].click();assert.equal(f.controller.isOpen('user-1'),false);assert.equal(f.controller.isOpen('user-2'),true);f.dom.window.close();
});
test('cancelled events, rejected promises, thrown guards and reentrant calls cannot change visibility',()=>{
  const f=fixture();const cancel=e=>e.preventDefault();f.root.addEventListener('workspace-disclosure-before-change',cancel);assert.equal(f.controller.setOpen('user-1',true),false);f.root.removeEventListener('workspace-disclosure-before-change',cancel);
  let nested;f.root.addEventListener('workspace-disclosure-before-change',()=>{nested=f.controller.setOpen('user-2',true);});f.controller.setOpen('user-1',true);assert.equal(nested,false);assert.equal(f.panels[1].hidden,true);f.dom.window.close();
  for(const beforeChange of [()=>Promise.resolve(true),()=>Promise.reject(Error('async guard')),()=>{throw Error('guard');}]){const g=fixture({beforeChange});assert.equal(g.controller.setOpen('user-1',true),false);assert.equal(g.panels[0].hidden,true);g.dom.window.close();}
});
test('removed/replaced DOM and duplicate keys cannot use stale relationships',()=>{
  const f=fixture();const old=f.panels[0];old.remove();assert.equal(f.controller.setOpen('user-1',true),false);const replacement=old.cloneNode(true);f.root.append(replacement);f.controller.refresh();f.buttons[0].click();assert.equal(replacement.hidden,false);assert.equal(old.hidden,true);
  f.root.append(replacement.cloneNode(true));f.controller.refresh();assert.equal(f.controller.setOpen('user-1',true),false);assert.equal(f.buttons[0].hasAttribute('aria-controls'),false);for(const panel of f.root.querySelectorAll('[data-cw-disclosure-panel="user-1"]'))assert.equal(panel.hidden,true);f.dom.window.close();
});
test('guard-driven DOM replacement is rejected, while detached initial roots and opaque keys are supported',()=>{
  let f;f=fixture({beforeChange:()=>{f.panels[0].replaceWith(f.panels[0].cloneNode(true));return true;}});assert.equal(f.controller.setOpen('user-1',true),false);assert.equal(f.root.querySelector('[data-cw-disclosure-panel]').hidden,true);
  const detached=f.document.createElement('section'),panel=f.document.createElement('div'),button=f.document.createElement('button');panel.hidden=true;panel.dataset.cwDisclosurePanel='키["9007199254740993"]';button.type='button';button.dataset.cwDisclosure=panel.dataset.cwDisclosurePanel;detached.append(button,panel);
  const c=f.dom.window.CompanyDisclosure.attach(detached);assert.equal(c.setOpen(button.dataset.cwDisclosure,true),true);assert.equal(panel.hidden,false);f.dom.window.close();
});
test('nested groups, disabled controls and teardown stay isolated; reattachment does not double-toggle',()=>{
  const f=fixture();f.panels[0].innerHTML+='<section id="child"><button type="button" data-cw-disclosure="user-1">안쪽</button><div data-cw-disclosure-panel="user-1" hidden>안쪽 내용</div></section>';
  const child=f.document.getElementById('child'),nested=f.dom.window.CompanyDisclosure.attach(child);f.controller.refresh();f.buttons[0].click();child.querySelector('button').click();assert.equal(nested.isOpen('user-1'),true);assert.equal(f.controller.isOpen('user-1'),true);
  f.buttons[0].disabled=true;f.buttons[0].click();assert.equal(f.controller.isOpen('user-1'),true);f.controller.destroy();f.buttons[1].click();assert.equal(f.panels[0].hidden,false);
  const again=f.dom.window.CompanyDisclosure.attach(f.root);assert.equal(again,f.dom.window.CompanyDisclosure.attach(f.root));f.buttons[1].click();assert.equal(f.panels[0].hidden,true);f.dom.window.close();
});

test('teardown during a guard cancels the pending transition without changing fields or focus',()=>{
  let f;f=fixture({beforeChange:()=>{f.controller.destroy();return true;}});
  f.document.getElementById('search').focus();const before=f.root.innerHTML;
  assert.equal(f.controller.setOpen('user-1',true),false);assert.equal(f.root.innerHTML,before);
  assert.equal(f.document.activeElement.id,'search');assert.equal(f.controller.isOpen('user-1'),false);f.dom.window.close();
});

test('async requests keep the old panel and values until approval, then switch once',async()=>{
  let resolve,signal,requested;
  const f=fixture({single:true,beforeRequest:details=>{signal=details.signal;return new Promise(done=>{resolve=done;});},beforeChange:details=>{requested=details.requested;return true;}});
  f.controller.setOpen('user-1',true);f.panels[0].querySelector('input').value='초안';
  const pending=f.controller.requestOpen('user-2',true);
  assert.equal(f.controller.isOpen('user-1'),true);assert.equal(f.controller.isOpen('user-2'),false);
  assert.equal(await f.controller.requestOpen('user-2',true),false);f.buttons[2].click();assert.equal(signal.aborted,false);
  resolve(true);assert.equal(await pending,true);assert.equal(requested,true);assert.equal(f.controller.isOpen('user-1'),false);
  assert.equal(f.controller.isOpen('user-2'),true);assert.equal(f.panels[0].querySelector('input').value,'초안');f.dom.window.close();
});

for(const interruption of ['refresh','scope','destroy','replace','detach','visibility','direct'])test(`async disclosure rejects a late approval after ${interruption}`,async()=>{
  let resolve,signal;
  const f=fixture({single:true,beforeRequest:details=>{signal=details.signal;return new Promise(done=>{resolve=done;});}});
  f.controller.setOpen('user-1',true);const pending=f.controller.requestOpen('user-2',true);
  if(interruption==='refresh')f.controller.refresh();
  if(interruption==='scope')f.document.dispatchEvent(new f.dom.window.CustomEvent('workspace-entity-scope-change'));
  if(interruption==='destroy')f.controller.destroy();
  if(interruption==='replace')f.panels[1].replaceWith(f.panels[1].cloneNode(true));
  if(interruption==='detach')f.root.remove();
  if(interruption==='visibility')f.panels[0].hidden=true;
  if(interruption==='direct')f.controller.setOpen('user-1',false);
  if(['refresh','scope','destroy','direct'].includes(interruption)){
    assert.equal(signal.aborted,true);
    assert.equal(await pending,false); // The guard may ignore abort and never settle.
  }
  resolve(true);assert.equal(await pending,false);assert.equal(f.panels[1].hidden,true);
  if(f.root.querySelector('[data-cw-disclosure-panel="user-2"]'))assert.equal(f.root.querySelector('[data-cw-disclosure-panel="user-2"]').hidden,true);
  f.dom.window.close();
});

test('async denial, exception and final synchronous guard cannot approve a transition',async()=>{
  for(const beforeRequest of [()=>false,async()=>false,async()=>{throw Error('no');},async()=>true]){
    const f=fixture({beforeRequest,beforeChange:()=>false});assert.equal(await f.controller.requestOpen('user-1',true),false);
    assert.equal(f.panels[0].hidden,true);f.dom.window.close();
  }
});
