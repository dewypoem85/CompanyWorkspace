import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
const read=path=>readFileSync(resolve(root,path),'utf8');
const contract=JSON.parse(read('packages/contracts/account-fields.json')).fields;
const defaults=Object.fromEntries(contract.map(f=>[f.key,f.type.endsWith('[]')?[]:[String(f.default ?? (f.type==='bool'?false:''))]]));
const tick=()=>new Promise(r=>setTimeout(r,0));
const ack=()=>({account:{id:'9007199254740993',updatedAtTicks:'639000000000000001',fields:{...structuredClone(defaults),Name:['새 직원'],Email:['new@example.test'],HireDate:['2024-02-29'],BirthDate:['08-17']}}});
async function fixture(t) {
  const options={AccountType:['employee','shared'],IsActive:['true','false'],Role:['employee','admin','master'],DepartmentId:['','9007199254740995']};
  const controls=contract.map(f=>options[f.key]?`<select name="${f.key}">${options[f.key].map(v=>`<option value="${v}">${v}</option>`).join('')}</select>`:
    f.key==='IsPrivate'?'<input name="IsPrivate" type="checkbox" value="true">':
    f.type.endsWith('[]')?(f.key==='Permissions'?['cs.access','statistics.access','iap.access','iap.publish']:['9007199254740993','42']).map(v=>`<input name="${f.key}" type="checkbox" value="${v}">`).join(''):
    `<input name="${f.key}" value="" ${f.key==='HireDate'?'type="date"':''}>`).join('');
  const dom=new JSDOM(`<form method="post" action="/Admin/Users?handler=Add">${controls}<input name="__RequestVerificationToken" value="csrf" type="hidden"><input type="search"><div data-add-result hidden></div><button type="submit">등록</button><div data-add-followup hidden><span data-add-followup-message></span><button type="button" data-add-another hidden>다른 계정</button></div></form><form id="bulk"><input value="별도 수정 초안"></form>`,{url:'https://company.workspace.test',runScripts:'outside-only'});
  const w=dom.window,form=w.document.querySelector('form'),state=form.querySelector('[data-add-result]');form.dataset.accountDefaults=JSON.stringify(defaults);
  for(const file of ['packages/workspace-ui/src/states.js','packages/workspace-ui/src/forms.js','apps/portal/wwwroot/js/account-create.js'])w.eval(read(file));
  const calls=[];let reply;
  w.fetch=(_,init)=>{calls.push(init);return new Promise(r=>{reply=r;});};
  const controller=w.CompanyAccountCreate.attach(form,{updateType:()=>{
    const shared=form.elements.AccountType.value==='shared';for(const c of form.elements)if(['DepartmentId','ProjectIds','HireDate','BirthDate','Role'].includes(c.name))c.disabled=shared;
  }});
  t.after(()=>{controller.dispose();w.close();});await tick();
  const fill=()=>{form.elements.Name.value=' 새 직원 ';form.elements.Email.value='New@Example.test';form.elements.HireDate.value='2024-02-29';form.elements.BirthDate.value='08-17';form.dispatchEvent(new w.Event('input',{bubbles:true}));};
  return {w,form,state,controller,calls,fill,submit:()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})),
    reply:async(status,data,outcome=status===200?'saved':'invalid',type=w.CompanyForm.mediaType)=>{reply({status,ok:status===200,headers:new Map([['content-type',type]]),json:async()=>({protocol:'workspace-form-v1',outcome,message:'서버 안내',data})});await tick();},
    unload:()=>{const e=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(e);return e.defaultPrevented;}};
}
test('new account confirms canonical fields, preserves other drafts, locks duplicates and explicitly resets only itself',async t=>{
  const f=await fixture(t);assert.equal(f.unload(),false);f.fill();assert.equal(f.unload(),true);
  f.submit();f.submit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.get('__RequestVerificationToken'),'csrf');assert.equal(f.form.elements.Name.disabled,true);
  await f.reply(200,ack());assert.equal(f.controller.phase,'saved');assert.equal(f.form.elements.Name.value,'새 직원');assert.equal(f.form.elements.Email.value,'new@example.test');
  assert.equal(f.form.dataset.createdAccountId,'9007199254740993');assert.equal(f.unload(),false);f.submit();assert.equal(f.calls.length,1);
  assert.equal(f.form.elements.Name.disabled,true);f.form.querySelector('[data-add-another]').click();await tick();
  assert.equal(f.controller.phase,'editing');assert.equal(f.form.elements.Name.disabled,false);assert.equal(f.form.elements.Name.value,'');assert.equal(f.form.elements.IsActive.value,'true');
  assert.equal(f.form.elements.HireDate.value,'');assert.equal(f.form.dataset.createdAccountId,undefined);assert.equal(f.unload(),false);
  assert.equal(f.form.elements.BirthDate.value,'');
  assert.equal(f.w.document.querySelector('#bulk input').value,'별도 수정 초안');
  f.fill();f.submit();await f.reply(500,{});assert.equal(f.controller.phase,'blocked');
  assert.equal(f.form.querySelector('[data-add-followup-message]').textContent.includes('등록 완료'),false);
});
test('only definite input rejection permits another submission; unknown and denied results keep drafts but block repeated creates',async t=>{
  for(const failure of [403,409,500,200,302]) {
    const f=await fixture(t);f.fill();f.submit();await f.reply(422,null);assert.equal(f.controller.phase,'editing');
    f.submit();await f.reply(failure,{},failure===200?'saved':'unknown',failure===302?'text/html':undefined);
    assert.equal(f.controller.phase,'blocked');assert.equal(f.form.elements.Name.value,' 새 직원 ');assert.equal(f.unload(),true);
    f.form.reset();assert.equal(f.form.elements.Name.value,' 새 직원 ');f.submit();assert.equal(f.calls.length,2);
    assert.equal(f.form.querySelector('[data-add-another]').hidden,true);assert.equal(f.form.querySelector('[data-add-followup]').hidden,false);
  }
});
test('scope change blocks registration including a non-abortable late success and never erases either draft',async t=>{
  const f=await fixture(t);f.fill();f.submit();f.w.document.dispatchEvent(new f.w.Event('workspace-entity-scope-change'));
  assert.equal(f.calls[0].signal.aborted,true);await f.reply(200,ack());
  assert.equal(f.controller.phase,'blocked');assert.equal(f.form.elements.Name.value,' 새 직원 ');assert.equal(f.form.dataset.createdAccountId,undefined);
  f.submit();assert.equal(f.calls.length,1);assert.equal(f.w.document.querySelector('#bulk input').value,'별도 수정 초안');
});
test('shared account normalization, generated date and IAP dependency are accepted without numeric ID conversion',async t=>{
  const f=await fixture(t);f.fill();f.form.elements.AccountType.value='shared';f.form.querySelector('[name="Permissions"][value="iap.publish"]').checked=true;
  f.form.dispatchEvent(new f.w.Event('change'));f.submit();
  assert.equal(f.calls[0].body.has('HireDate'),false);assert.equal(f.calls[0].body.has('Role'),false);
  assert.equal(f.calls[0].body.has('BirthDate'),false);
  const result=ack();Object.assign(result.account.fields,{AccountType:['shared'],HireDate:['2026-09-10'],BirthDate:[''],Permissions:['iap.access','iap.publish']});
  await f.reply(200,result);assert.equal(f.controller.phase,'saved');assert.equal(f.form.querySelector('[name="Permissions"][value="iap.access"]').checked,true);
  f.form.querySelector('[data-add-another]').click();await tick();assert.equal(f.form.elements.AccountType.value,'employee');assert.equal(f.form.elements.HireDate.disabled,false);
  assert.equal(f.form.querySelector('[name="Permissions"][value="iap.publish"]').disabled,false);assert.equal(f.form.querySelector('[name="Permissions"][value="iap.publish"]').checked,false);
});
test('partial, mismatched and non-string acknowledgements cannot partially rewrite fields or clear a draft',async t=>{
  for(const mutate of [a=>delete a.fields.IsPrivate,a=>a.id=9007199254740992,a=>a.updatedAtTicks='0',a=>a.fields.Name=['타인'],a=>a.fields.Permissions=['unexpected.access'],a=>a.fields.IsActive=[true],a=>a.fields.ProjectIds=['1','1']]) {
    const f=await fixture(t);f.fill();f.submit();const data=ack();mutate(data.account);await f.reply(200,data);
    assert.equal(f.controller.phase,'blocked');assert.equal(f.form.elements.Name.value,' 새 직원 ');assert.equal(f.form.dataset.createdAccountId,undefined);
  }
});
test('draft changes while pending and disposal both reject late reconciliation',async t=>{
  for(const action of ['edit','dispose']){
    const f=await fixture(t);f.fill();f.submit();if(action==='edit')f.form.elements.Name.value='전송 후 변경';else f.controller.dispose();
    await f.reply(200,ack());assert.equal(f.form.dataset.createdAccountId,undefined);assert.equal(f.form.elements.Name.value,action==='edit'?'전송 후 변경':' 새 직원 ');
  }
});
