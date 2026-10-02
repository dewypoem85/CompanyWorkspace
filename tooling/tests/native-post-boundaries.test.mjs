import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkNativePostBoundaries,compareNativePostPolicy,nativePostForms,policyPath} from '../check-native-post-boundaries.mjs';

const policy=JSON.parse(readFileSync(resolve(root,policyPath),'utf8'));
test('all authored native POST forms belong to a reviewed mutation boundary',()=>{
  const result=checkNativePostBoundaries();assert.ok(result.files>0);assert.equal(result.forms,31);assert.match(result.policyHash,/^[a-f0-9]{64}$/);
});
test('new page POST forms and count increases fail closed',()=>{
  const calls=nativePostForms('apps/demo/Page.cshtml','<!-- <form method="post"> --><form\n method="POST"><button>저장</button></form>');
  assert.equal(calls.length,1);assert.match(compareNativePostPolicy(calls,{version:2,sealed:true,entries:[]})[0],/not assigned/);
  assert.equal(nativePostForms('apps/demo/Page.tsx',"<form method={'post'}></form><form method=post></form><form method='get'></form>").length,2);
  const entry=policy.entries[0],extra=nativePostForms(entry.path,'<form method="post" asp-page-handler="Unexpected"></form>')[0];
  assert.match(compareNativePostPolicy([extra],{...policy,entries:[entry]})[0],/not assigned to a concrete/);
});
test('same form count cannot hide a changed handler or contract',()=>{
  const original=nativePostForms('apps/demo/Page.cshtml','<form method="post" asp-page-handler="Save" data-record-form></form>');
  const contract='packages/contracts/profile.md',entry={path:'apps/demo/Page.cshtml',owner:'record save',forms:[{identity:original[0].identity,contract}]};
  assert.deepEqual(compareNativePostPolicy(original,{version:2,sealed:true,entries:[entry]}),[]);
  const changed=nativePostForms('apps/demo/Page.cshtml','<form method="post" asp-page-handler="Delete" data-record-form></form>');
  const errors=compareNativePostPolicy(changed,{version:2,sealed:true,entries:[entry]}).join('\n');
  assert.match(errors,/not assigned to a concrete/);assert.match(errors,/retired or changed/);
});
test('dynamic form and submitter POST overrides cannot bypass the inventory',()=>{
  const source=`
    <form method="get"><button formmethod="POST">save</button></form>
    <button formmethod={'post'}>save</button>
    <script>
      const form=document.createElement('form');
      form.method = 'post';
      button.formMethod = "POST";
      form.setAttribute('method', 'POST');
      button.setAttribute("formmethod", "post");
      const read = form.method === 'post';
    </script>`;
  const calls=nativePostForms('apps/demo/Page.cshtml',source);
  assert.deepEqual(calls.map(call=>call.kind),['submitter-formmethod','submitter-formmethod','property-method','property-method','attribute-method','attribute-method']);
  assert.ok(calls.every(call=>Number.isSafeInteger(call.line)&&call.line>0));
  assert.equal(nativePostForms('apps/demo/Page.js',"// form.method='post'\n/* form.setAttribute('method','post') */\nform.method==='post'").length,0);
  assert.ok(calls.every(call=>/^(?:submitter|property|attribute)-.*:sha256:[a-f0-9]{16}$/.test(call.identity)));
  assert.match(compareNativePostPolicy(calls,{version:2,sealed:true,entries:[]})[0],/not assigned/);
});
test('retired, malformed and unsorted POST policies cannot become exceptions',()=>{
  const temporary=mkdtempSync(resolve(root,'artifacts/native-post-policy-')),contract='packages/contracts/test.md';mkdirSync(dirname(resolve(temporary,contract)),{recursive:true});writeFileSync(resolve(temporary,contract),'# test');
  const path='apps/demo/Page.cshtml',form={path,line:1,identity:'form|id=test'},formPolicy={identity:form.identity,contract},valid={path,owner:'test',forms:[formPolicy]};
  assert.match(compareNativePostPolicy([],{version:2,sealed:true,entries:[valid]},temporary)[0],/retired/);
  for(const changed of [{...valid,forms:[]},{...valid,path:'../escape'},{...valid,forms:[{...formPolicy,contract:'README.md'}]},{...valid,owner:''}])assert.match(compareNativePostPolicy([form],{version:2,sealed:true,entries:[changed]},temporary)[0],/Invalid/);
  assert.match(compareNativePostPolicy([form],{version:2,sealed:true,entries:[{...valid,forms:[formPolicy,formPolicy]}]},temporary)[0],/Invalid native POST form/);
  assert.match(compareNativePostPolicy([form],{version:2,sealed:true,entries:[{...valid,forms:[{...formPolicy,contract:'packages/contracts/native-post-boundaries.md'}]}]},root)[0],/Invalid native POST form/);
  const another={...valid,path:'apps/aaa/Page.cshtml'};assert.match(compareNativePostPolicy([form,{...form,path:another.path}],{version:2,sealed:true,entries:[valid,another]},temporary).at(-1),/sorted/);
});
