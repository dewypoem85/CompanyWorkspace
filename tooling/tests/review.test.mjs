import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
function fixture(t){
  const dom=new JSDOM('<button id="opener">비교</button>',{runScripts:'outside-only'}),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/dialogs.js'),'utf8'));
  w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/review.js'),'utf8'));
  t.after(()=>w.close());return w;
}
const field=(key,before,draft,current,set=false)=>({key,label:key,before:[before],draft:[draft],current:[current],set});
test('three-way review distinguishes own, remote, converged and conflicting changes without parsing numbers',t=>{
  const w=fixture(t),items=w.CompanyReview.plan([{id:'1',label:'직원',fields:[field('own','0','1','0'),field('remote','0','0','1'),field('same','0','1','1'),field('conflict','0','1','2'),field('large','9007199254740992','9007199254740993','9007199254740992')]}]);
  assert.deepEqual(Array.from(items[0].fields,f=>f.choice),['draft','current','draft',null,'draft']);
  assert.equal(items[0].fields[4].draft[0],'9007199254740993');
  const sets=w.CompanyReview.plan([{id:'1',fields:[{key:'projects',before:['1','2'],draft:['2','1'],current:['1','2'],set:true}]}]);
  assert.equal(sets[0].fields[0].own,false);
  assert.throws(()=>w.CompanyReview.plan([{id:'1',fields:[{key:'x',before:[1],draft:[],current:[]}]}]),/string/);
});
test('review requires explicit conflicts, escapes content, returns field values only and restores focus',async t=>{
  const w=fixture(t),opener=w.document.querySelector('button');opener.focus();
  const promise=w.CompanyReview.open({items:[{id:'1',label:'<script>user</script>',fields:[field('name','old','<img src=x>','server')]}]});
  const dialog=w.document.querySelector('dialog'),apply=dialog.querySelector('[data-review-apply]');
  assert.equal(dialog.querySelectorAll('img,script').length,0);assert.equal(apply.disabled,true);
  assert.throws(()=>w.CompanyReview.open({items:[]}),/already open/);
  const select=dialog.querySelector('select');select.value='draft';select.dispatchEvent(new w.Event('change'));
  assert.equal(apply.disabled,false);apply.click();const result=await promise;
  assert.equal(result[0].fields.name[0],'<img src=x>');assert.equal(w.document.querySelector('dialog'),null);assert.equal(w.document.activeElement,opener);
});
test('Escape, cancel and identity changes discard review choices without applying or mutating input',async t=>{
  const w=fixture(t),items=[{id:'1',fields:[field('name','old','mine','remote')]}];
  for(const action of ['escape','cancel','scope']){
    const promise=w.CompanyReview.open({items});const dialog=w.document.querySelector('dialog');
    if(action==='escape')dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));
    if(action==='cancel')dialog.querySelector('[data-review-cancel]').click();
    if(action==='scope')w.document.dispatchEvent(new w.Event('workspace-entity-scope-change'));
    assert.equal(await promise,null);assert.equal(items[0].fields[0].draft[0],'mine');
  }
});
test('consumer cross-field validation retains the review and requires corrected choices',async t=>{
  const w=fixture(t),promise=w.CompanyReview.open({items:[{id:'1',fields:[field('type','employee','shared','employee')]}],validate:items=>items[0].fields.type[0]==='shared'?'역할을 확인하세요.':null});
  const dialog=w.document.querySelector('dialog');dialog.querySelector('[data-review-apply]').click();
  assert.equal(dialog.open,true);assert.match(dialog.querySelector('footer').textContent,/역할을 확인하세요/);
  const select=dialog.querySelector('select');select.value='current';select.dispatchEvent(new w.Event('change'));dialog.querySelector('[data-review-apply]').click();
  assert.equal((await promise)[0].fields.type[0],'employee');
});

test('consumer unmount signal closes the dialog and a cancelled request cannot open it',async t=>{
  const w=fixture(t),abort=new w.AbortController(),items=[{id:'1',fields:[field('name','old','mine','remote')]}];
  const pending=w.CompanyReview.open({items,signal:abort.signal});abort.abort();
  assert.equal(await pending,null);assert.equal(w.document.querySelector('dialog'),null);
  assert.equal(await w.CompanyReview.open({items,signal:abort.signal}),null);
  const next=w.CompanyReview.open({items});w.document.querySelector('[data-review-cancel]').click();assert.equal(await next,null);
});
