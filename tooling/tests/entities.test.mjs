import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { root } from '../build-ui.mjs';
const read=file=>readFileSync(resolve(root,file),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function fixture(t,body){
  const dom=new JSDOM('<!doctype html><body>'+body,{url:'https://company.example.test',runScripts:'outside-only'}),w=dom.window;
  const observers=[],Native=w.MutationObserver;
  w.MutationObserver=class extends Native{constructor(callback){super(callback);observers.push(this);}};
  t.after(()=>{observers.forEach(o=>o.disconnect());w.close();});
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  let profiles={'11':'/profile/11?v=1','22':'/profile/22?v=1'},projects={'9':'/project/9?v=1'};
  w.CompanyWorkspace={profileUrl:id=>profiles[id]||null,projectUrl:id=>projects[id]||null,refresh:async()=>{}};
  const source=read('packages/workspace-ui/src/company-workspace.js');
  w.eval(source.slice(source.indexOf('function createSearchMatcher'),source.indexOf('  const scriptUrl')));
  w.eval(read('packages/workspace-ui/src/entity-display.js'));
  w.eval(read('packages/workspace-ui/src/entity-choices.js'));
  w.eval(read('packages/workspace-ui/src/company-entities.js'));
  await tick();
  const context={authenticated:true,user:{id:1,role:'admin'},services:[{key:'leave'}]};
  const update=detail=>w.document.dispatchEvent(new w.CustomEvent('company-context',{detail}));update(context);
  return {w,doc:w.document,update,context,profiles:value=>{profiles=value;},projects:value=>{projects=value;}};
}

test('company IDs and explicit local mappings share one profile renderer without name matching',async t=>{
  const f=await fixture(t,'<script type="application/json" data-company-employee-map>{"5":11}</script><span data-company-local-employee="5">김</span><span data-company-avatar="22">김</span><span data-company-local-employee="22">김</span><span data-workspace-entity="project" data-workspace-entity-id="9"></span>');
  const nodes=f.doc.querySelectorAll('span');
  assert.equal(nodes[0].querySelector('img').getAttribute('src'),'/profile/11?v=1');
  assert.equal(nodes[1].querySelector('img').getAttribute('src'),'/profile/22?v=1');
  assert.equal(nodes[2].textContent,'김');assert.equal(nodes[2].querySelector('img'),null,'An unmapped local ID must never be treated as a company ID');
  assert.equal(nodes[3].querySelector('img').getAttribute('src'),'/project/9?v=1');
  f.profiles({});f.projects({});f.update(f.context);await tick();
  assert.equal(f.doc.querySelectorAll('img').length,0);assert.equal(nodes[3].textContent,'P');
});

test('profile revisions, failed images and dynamic React-style mounts preserve correct fallbacks',async t=>{
  const f=await fixture(t,'<span data-workspace-entity="employee" data-workspace-entity-id="11" data-workspace-entity-name="김직원"></span>');
  const node=f.doc.querySelector('span'),old=node.querySelector('img');
  f.profiles({'11':'/profile/11?v=2'});f.update(f.context);const fresh=node.querySelector('img');
  old.dispatchEvent(new f.w.Event('error'));assert.equal(node.querySelector('img'),fresh,'Old image errors cannot erase the new revision');
  fresh.dispatchEvent(new f.w.Event('error'));await tick();assert.equal(node.textContent,'김');assert.equal(node.querySelector('img'),null);
  node.dataset.workspaceEntityName='박직원';node.dataset.workspaceEntityId='22';await tick();assert.equal(node.textContent,'박');
  const added=f.doc.createElement('span');added.dataset.companyAvatar='11';added.textContent='김';f.doc.body.append(added);await tick();
  assert.equal(added.querySelector('img').getAttribute('src'),'/profile/11?v=2');
  const invalid=f.doc.createElement('span');f.w.CompanyEntityDisplay.render(invalid,{kind:'employee',id:'__proto__',name:'<script>'});assert.equal(invalid.textContent,'<');assert.equal(invalid.children.length,0);
});

test('default employee profiles receive stable distinguishing color tones',async t=>{
  const f=await fixture(t,'<span data-workspace-entity="employee" data-workspace-entity-id="31" data-workspace-entity-name="김직원"></span><span data-workspace-entity="employee" data-workspace-entity-id="32" data-workspace-entity-name="김직원"></span><span data-company-avatar="31">김</span><span data-workspace-entity="project" data-workspace-entity-id="8" data-workspace-entity-name="프로젝트"></span>');
  const nodes=f.doc.querySelectorAll('span');
  assert.match(nodes[0].dataset.workspaceAvatarTone,/^\d+$/);
  assert.notEqual(nodes[0].dataset.workspaceAvatarTone,nodes[1].dataset.workspaceAvatarTone);
  assert.equal(nodes[0].dataset.workspaceAvatarTone,nodes[2].dataset.workspaceAvatarTone);
  assert.equal(nodes[3].dataset.workspaceAvatarTone,undefined,'Project fallbacks retain their own icon treatment');
  f.profiles({'31':'/profile/31?v=1'});f.update(f.context);await tick();
  assert.equal(nodes[0].dataset.workspaceAvatarTone,nodes[2].dataset.workspaceAvatarTone,'Photo availability must not change the employee color identity');
});

test('default employee profile palette exposes at least twenty distinct tones',async t=>{
  const f=await fixture(t,'');const tones=new Set();
  for(let id=1;id<=128;id+=1){
    const employee=f.doc.createElement('span');
    f.w.CompanyEntityDisplay.render(employee,{kind:'employee',id:String(id),name:`직원 ${id}`});
    const tone=Number(employee.dataset.workspaceAvatarTone);
    assert.ok(Number.isInteger(tone) && tone>=0 && tone<24);
    tones.add(tone);
  }
  assert.ok(tones.size>=20,`expected at least 20 distinct tones, received ${tones.size}`);
});

test('picker searches initials and submits the original value rather than the display company ID',async t=>{
  const f=await fixture(t,'<form><label>담당자<select name="Person" data-company-picker="employee" data-company-local="true"><option value="">전체</option><option value="5" data-company-id="11">김직원 · 개발</option><option value="6" data-company-id="22">김직원 · 운영</option></select></label></form>');
  const select=f.doc.querySelector('select');let changes=0;select.addEventListener('change',()=>changes++);
  f.w.CompanyEntities.open(select);const search=f.doc.querySelector('input[type=search]');search.value='ㄱㅈㅇ';search.dispatchEvent(new f.w.Event('input'));
  const options=f.doc.querySelectorAll('[role=option]');assert.equal(options.length,2);
  const avatars=[...f.doc.querySelectorAll('.cw-entity-avatar[data-workspace-entity="employee"][data-workspace-avatar-tone]')];
  assert.equal(avatars.length,2);assert.notEqual(avatars[0].dataset.workspaceAvatarTone,avatars[1].dataset.workspaceAvatarTone);
  assert.equal(options[1].querySelector('img').getAttribute('src'),'/profile/22?v=1');options[1].click();
  assert.equal(select.value,'6');assert.equal(new f.w.FormData(select.form).get('Person'),'6');assert.equal(changes,1);assert.equal(f.doc.activeElement,select);
});

test('IME composition and legacy keycode 229 do not choose an entity or move candidate focus',async t=>{
  const f=await fixture(t,'<select data-company-picker="employee"><option value="">전체</option><option value="11">김직원</option></select>');
  const select=f.doc.querySelector('select');let changes=0;select.addEventListener('change',()=>changes++);
  f.w.CompanyEntities.open(select);const search=f.doc.querySelector('input[type=search]');
  search.value='김';search.dispatchEvent(new f.w.Event('input'));
  const key=props=>search.dispatchEvent(new f.w.KeyboardEvent('keydown',{bubbles:true,cancelable:true,...props}));
  key({key:'Enter',isComposing:true});assert.ok(f.doc.querySelector('dialog'));assert.equal(changes,0);
  key({key:'Enter',keyCode:229});assert.ok(f.doc.querySelector('dialog'));assert.equal(changes,0);
  search.dispatchEvent(new f.w.CompositionEvent('compositionstart',{bubbles:true}));
  key({key:'ArrowDown'});assert.equal(f.doc.activeElement,search);
  key({key:'Enter'});assert.ok(f.doc.querySelector('dialog'));assert.equal(changes,0);
  search.dispatchEvent(new f.w.CompositionEvent('compositionend',{bubbles:true,data:'김'}));
  key({key:'Enter'});assert.equal(select.value,'11');assert.equal(changes,1);assert.equal(f.doc.querySelector('dialog'),null);
});

test('open picker revalidates options, disabled fields and account changes before selection',async t=>{
  const f=await fixture(t,'<fieldset><select data-company-picker="employee"><option value="11">김직원</option><option value="22">비공개 직원</option></select></fieldset>');
  const select=f.doc.querySelector('select');f.w.CompanyEntities.open(select);
  const stale=f.doc.querySelector('[data-option-value="22"]');select.options[1].remove();stale.click();
  assert.equal(select.value,'11');await tick();assert.equal(f.doc.querySelector('[data-option-value="22"]'),null);
  const option=f.doc.createElement('option');option.value='33';option.textContent='새 직원';select.append(option);await tick();assert.ok(f.doc.querySelector('[data-option-value="33"]'));
  select.closest('fieldset').disabled=true;await tick();assert.equal(f.doc.querySelector('dialog'),null);f.w.CompanyEntities.open(select);assert.equal(f.doc.querySelector('dialog'),null);
  select.closest('fieldset').disabled=false;f.w.CompanyEntities.open(select);f.update({...f.context,user:{id:2,role:'employee'}});assert.equal(f.doc.querySelector('dialog'),null);
});

test('picker does not infer entity type from a field name or override native multiple selection',async t=>{
  const f=await fixture(t,'<div data-company-service="leave"></div><select name="EmployeeId"><option value="11">김직원</option></select><select multiple data-company-picker="employee"><option value="11">김직원</option></select>');
  const selects=f.doc.querySelectorAll('select');assert.equal(selects[0].dataset.companyPicker,undefined);
  f.w.CompanyEntities.open(selects[0]);f.w.CompanyEntities.open(selects[1]);assert.equal(f.doc.querySelector('dialog'),null);
  const event=new f.w.KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true});selects[1].dispatchEvent(event);assert.equal(event.defaultPrevented,false);
});

test('changed option identities and disabled groups cannot submit a stale picker result',async t=>{
  const f=await fixture(t,'<select data-company-picker="employee"><option value="">전체</option><optgroup label="직원"><option value="11">김직원</option></optgroup></select>');
  const select=f.doc.querySelector('select'),option=select.options[1];let changes=0;
  select.addEventListener('change',()=>changes++);f.w.CompanyEntities.open(select);
  const old=f.doc.querySelector('[data-option-value="11"]');option.value='22';old.click();
  assert.equal(select.value,'');assert.equal(changes,0);await tick();
  const renamed=f.doc.querySelector('[data-option-value="22"]');option.label='새 직원';renamed.click();
  assert.equal(changes,0);await tick();
  const disabled=f.doc.querySelector('[data-option-value="22"]');option.parentElement.disabled=true;disabled.click();
  assert.equal(changes,0);await tick();assert.equal(f.doc.querySelector('[data-option-value="22"]').disabled,true);
});

test('keyboard navigation retains native values and refreshes the selected icon',async t=>{
  const f=await fixture(t,'<form><select data-company-picker="employee"><option value="11" selected>김직원</option><option value="22">박직원</option></select></form>');
  const select=f.doc.querySelector('select');f.w.CompanyEntities.open(select);
  const search=f.doc.querySelector('input[type=search]');search.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  assert.equal(f.doc.activeElement.dataset.optionValue,'22');f.doc.activeElement.click();
  assert.equal(select.value,'22');assert.match(select.style.backgroundImage,/profile\/22/);
  // Native form reset is covered in Chrome: JSDOM 26 caches selectedOptions after reset.
});

test('shared checkbox searches retain posted selections, disabled fields and server-hidden rows',async t=>{
  const f=await fixture(t,'<form><fieldset data-workspace-choices="project"><input type="search" data-choice-search><label data-choice-label><input name="Projects" type="checkbox" value="9" checked><span data-choice-text>던전 슬래셔</span></label><label data-choice-label><input name="Projects" type="checkbox" value="10"><span data-choice-text>네크로드</span></label><label data-choice-label hidden><input type="checkbox" disabled value="11"><span data-choice-text>숨긴 프로젝트</span></label></fieldset></form>');
  const group=f.doc.querySelector('fieldset'),search=group.querySelector('[data-choice-search]'),rows=group.querySelectorAll('label');
  search.value='ㄴㅋㄹㄷ';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.equal(rows[0].classList.contains('cw-choice-filtered'),true);assert.equal(rows[1].classList.contains('cw-choice-filtered'),false);
  assert.deepEqual([...new f.w.FormData(f.doc.querySelector('form')).getAll('Projects')],['9']);
  assert.equal(group.querySelector('[data-choice-status]').textContent,'1개 선택 · 1개 표시');
  search.value='';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(rows[2].hidden,true);assert.equal(rows[2].querySelector('input').disabled,true);
  const added=f.w.CompanyEntityChoices.upsertCheckbox(group,{name:'Projects',value:'12',label:'새 프로젝트',entityId:'12',disabled:true});await tick();
  assert.equal(added.created,true);assert.equal(added.input.disabled,true);assert.equal(added.input.name,'Projects');assert.equal(added.input.value,'12');
  const updated=f.w.CompanyEntityChoices.upsertCheckbox(group,{name:'Projects',value:'12',label:'변경된 <프로젝트>',entityId:'12',disabled:false});
  assert.equal(updated.created,false);assert.equal(updated.input,added.input);assert.equal(updated.input.disabled,false);assert.equal(updated.input.closest('label').querySelector('[data-choice-text]').textContent,'변경된 <프로젝트>');
  assert.equal(updated.input.closest('label').querySelector('[data-workspace-entity="project"]').dataset.workspaceEntityId,'12');
  assert.equal(group.querySelector('[data-choice-status]').textContent,'1개 선택 · 3개 표시');
  search.value='없는 이름';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.match(group.querySelector('[data-choice-status]').textContent,/검색 결과가 없습니다/);
});

test('entity scope changes distinguish profile refresh from account and permission changes',async t=>{
  const f=await fixture(t,'');let changes=0;f.doc.addEventListener('workspace-entity-scope-change',()=>changes++);
  f.update({...f.context,profiles:{11:'/profile/11?v=2'}});assert.equal(changes,0);
  f.update({...f.context,user:{id:1,role:'employee'}});assert.equal(changes,1);
  f.update({...f.context,authenticated:false,user:null,services:[]});assert.equal(changes,2);
});

test('organization search alone does not set the unsaved-business-change guard',async t=>{
  const f=await fixture(t,'<form method="post" data-organization-form><input name="Tab" value="departments"><input name="Form.Name" value="개발"><input type="search" data-choice-search><input type="checkbox" name="EmployeeIds" value="11"><button type="submit">저장</button><div data-organization-result hidden></div></form>');
  for(const file of ['states.js','dialogs.js','forms.js'])f.w.eval(read('packages/workspace-ui/src/'+file));
  f.w.eval(read('apps/portal/wwwroot/js/organization.js'));
  const before=()=>{const event=new f.w.Event('beforeunload',{cancelable:true});f.w.dispatchEvent(event);return event.defaultPrevented;};
  f.doc.querySelector('[data-choice-search]').dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(before(),false);
  f.doc.querySelector('[name="EmployeeIds"]').dispatchEvent(new f.w.Event('change',{bubbles:true}));assert.equal(before(),true);
  f.doc.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(before(),true,'A confirmation is not a saved write; keep the draft guard');
  f.w.dispatchEvent(new f.w.PageTransitionEvent('pagehide',{persisted:false}));
});
