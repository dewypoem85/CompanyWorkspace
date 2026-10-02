import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root, validateAccountFields, outputs} from '../build-ui.mjs';
import {checkAccountForm,checkAccountCreation,checkAccountReviewReads} from '../check-architecture.mjs';
const fields=JSON.parse(readFileSync(resolve(root,'packages/contracts/account-fields.json'),'utf8')).fields;
test('account field contract generates the one shared binding model and rejects ambiguous metadata',()=>{
  validateAccountFields(fields);
  const generated=outputs().get('apps/portal/Workspace/AccountFields.g.cs');
  for(const field of fields)assert.ok(generated.includes(`public ${field.type} ${field.key} { get; set; }`));
  for(const change of [{key:'Name'},{type:'Object; bad'},{placement:'missing'},{default:123},{maxLength:-1}]){
    const clone=structuredClone(fields);clone[0]={...clone[0],...change};assert.throws(()=>validateAccountFields(clone));
  }
});

test('registration cannot drop shared transport, defaults, acknowledgement checks or scope protection',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const page=read('apps/portal/Pages/Admin/Users.cshtml'),model=read('apps/portal/Pages/Admin/Users.cshtml.cs'),client=read('apps/portal/wwwroot/js/account-create.js'),contract=read('packages/contracts/portal-account-writes.md');
  assert.deepEqual(checkAccountCreation(page,model,client),[]);
  for(const marker of ['CompanyAccountCreate.attach(','data-add-result','UsersModel.AddDefaults'])assert.ok(checkAccountCreation(page.replace(marker,''),model,client).length);
  for(const marker of ['FormValues(InputFor(user))','FormResult("saved"','committing = true'])assert.ok(checkAccountCreation(page,model.replaceAll(marker,''),client).length,marker);
  for(const marker of ['CompanyForm.attach(','signature() !== sentSignature','workspace-entity-scope-change','beforeunload','transport.dispose()'])assert.ok(checkAccountCreation(page,model,client.replaceAll(marker,'')).length);
  assert.ok(checkAccountCreation(page,model,client+'\nlocation.reload();').length);
  for(const marker of ['`Add`','`BulkUpdate`','account-fields.json','문자열 계정 ID','`UpdatedAtTicks`','최대 500개','Leave projection','전체 공통 필드','422 `invalid`','409 `conflict`','`unknown`','자동 재전송하지 않는다'])assert.ok(contract.includes(marker),marker);
});
test('missing new/edit/renderer normalization and page-owned duplicated controls fail the structure gate',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const view=read('apps/portal/Pages/Shared/_AccountField.cshtml'),page=read('apps/portal/Pages/Admin/Users.cshtml'),model=read('apps/portal/Pages/Admin/Users.cshtml.cs');
  assert.deepEqual(checkAccountForm(fields,view,page,model),[]);
  assert.ok(checkAccountForm(fields,view.replace('case "IsPrivate":',''),page,model).some(x=>x.includes('renderer')));
  assert.ok(checkAccountForm(fields,view,page,model.replace('IsPrivate = user.IsPrivate','')).some(x=>x.includes('projection')));
  assert.ok(checkAccountForm(fields,view,page,model.replace('input.IsPrivate','false')).some(x=>x.includes('normalization')));
  assert.ok(checkAccountForm(fields,view,page+'<input name="IsPrivate">',model).some(x=>x.includes('_AccountField')));
  assert.ok(checkAccountForm(fields,view,page.replace('CompanyForm.attach(','pageOwnedSave('),model).some(x=>x.includes('shared form lifecycle')));
  assert.ok(checkAccountForm(fields,view,page.replace('CompanyReview.open(','pageOwnedDialog('),model).some(x=>x.includes('shared three-way review')));
  assert.ok(checkAccountForm(fields,view,page.replace('CompanyEntityChoices.upsertCheckbox(','pageOwnedCheckbox('),model).some(x=>x.includes('shared entity choice owner')));
  for(const marker of ['CompanyDialog.confirm(','scopeInvalid = true','!scopeInvalid && !resetPending','submittedSignatures.get(row)','signal:lifetime.signal','transport.dispose()','disclosures.destroy()'])
    assert.ok(checkAccountForm(fields,view,page.replaceAll(marker,''),model).some(x=>x.includes('bulk lifecycle')),marker);
  assert.ok(checkAccountForm(fields,view,page+"confirm('모든 변경사항 되돌리기')",model).some(x=>x.includes('private browser confirmation')));
});

test('HTML failure recovery cannot silently reload drafts, rebase versions or drop native reset defaults',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const view=read('apps/portal/Pages/Shared/_AccountField.cshtml'),page=read('apps/portal/Pages/Admin/Users.cshtml'),model=read('apps/portal/Pages/Admin/Users.cshtml.cs');
  for(const marker of ['Model.EditInputFor(user)','Model.EditVersionFor(user)','data-account-baseline','Model.HtmlDrafts','control.defaultValue = original.value','CompanyDisclosure.attach(recovery)','recoveryDisclosures?.destroy()'])
    assert.ok(checkAccountForm(fields,view,page.replaceAll(marker,''),model).some(e=>e.includes('HTML recovery')),marker);
  for(const marker of ['await RecoverHtmlDraftsAsync(updates);','baseline.UpdatedAtTicks == input.UpdatedAtTicks.ToString()','PostedFields(prefix)'])
    assert.ok(checkAccountForm(fields,view,page,model.replaceAll(marker,'')).some(e=>e.includes('HTML recovery')),marker);
});

test('account conflict review cannot bypass the common read session',()=>{
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const page=read('apps/portal/Pages/Admin/Users.cshtml'),transport=read('apps/portal/wwwroot/js/account-review.js'),contract=read('packages/contracts/portal-account-reads.md');
  assert.deepEqual(checkAccountReviewReads(page,transport,contract),[]);
  for(const marker of ['const readSession = window.CompanyReadSession.create()',"readSession.run('account-review'",'window.CompanyAccountReview.read(url,signal)','signal.throwIfAborted()',"readSession.cancel('account-review')",'readSession.dispose()'])
    assert.ok(checkAccountReviewReads(page.replaceAll(marker,'BYPASS'),transport,contract).length,marker);
  assert.ok(checkAccountReviewReads(page.replace("readSession.run('account-review'","new AbortController();readSession.run('account-review'"),transport,contract).some(error=>error.includes('private read timeout')));
  for(const marker of ["url.origin!==root.location.origin","root.fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'manual',signal",'Accept:mediaType',"'X-Requested-With':'XMLHttpRequest'",'await response.json()','signal?.throwIfAborted()'])
    assert.ok(checkAccountReviewReads(page,transport.replaceAll(marker,'BYPASS'),contract).length,marker);
  for(const marker of ['`account-review`','`CompanyReadSession`','30초','계정','페이지 이탈','늦은 응답','초안'])
    assert.ok(checkAccountReviewReads(page,transport,contract.replaceAll(marker,'BYPASS')).length,marker);
});
