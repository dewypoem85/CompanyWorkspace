import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductCommandApi } from '../lib/product-command-api.js';
import { createMockProductPlayFabClient } from '../lib/product-playfab.js';
import { validateProductConfig,validateProductPreview,validateProductExecution,validateProductLookup,validateProductDeletion } from '../public/product-command-contract.js';
const request={environment:'live',operation:'grant',playFabIds:['AAAA','BBBB'],memo:'격리 검증 요청',command:{currencies:{gem:125,mileage:30},characters:[0],pets:[5],skins:['21-1','21-1'],weapons:[],packages:['package','package']}};
async function fixture(t){
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'product-contract-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const clients={live:createMockProductPlayFabClient(),test:createMockProductPlayFabClient()};
  const api=createProductCommandApi({dataDir,environmentClients:clients,liveEnabled:true});
  return {clients,call:async(action,body={})=>(await api.handle({path:'/api/playfab/product-commands/'+action,body,authenticatedUser:{id:'1',name:'검증',email:'ui@example.test'},requestId:'synthetic',ip:'127.0.0.1'})).payload};
}
test('product acknowledgement contracts accept actual config, preview, dry-run, write, lookup and delete responses',async t=>{
  const f=await fixture(t);validateProductConfig(await f.call('config'));
  const preview=validateProductPreview(await f.call('preview',request),request);
  const execute={environment:'live',previewToken:preview.previewToken,dryRun:true,mergePlayFabIds:[]};
  validateProductExecution(await f.call('execute',execute),preview,execute);
  execute.dryRun=false;validateProductExecution(await f.call('execute',execute),preview,execute);
  const queried=validateProductLookup(await f.call('lookup',request),request),first=queried.results[0];
  const deletion={environment:'live',playFabId:first.playFabId,operation:'grant',expectedDataVersion:first.dataVersion,expectedValue:first.grant.value,memo:'삭제 검증 요청'};
  validateProductDeletion(await f.call('delete',deletion),deletion);
  validateProductDeletion(await f.call('delete',deletion),deletion);
});
test('product preview rejects wrong environment, duplicate IDs, missing summary and changed command request IDs',async t=>{
  const f=await fixture(t),original=await f.call('preview',request);
  for(const mutate of [v=>{v.environment='test';},v=>{v.items[1].playFabId='AAAA';},v=>{v.summary.characters=[];},v=>{v.items[0].commandJson='{"요청ID":"other"}';},v=>{v.existingCount=1;},v=>{v.items[0].dataVersion='0';},v=>{delete v.memo;}]){
    const value=structuredClone(original);mutate(value);assert.throws(()=>validateProductPreview(value,request));
  }
});
test('execution acknowledgements bind token, target subset, request IDs, mode and result counts',async t=>{
  const f=await fixture(t),preview=await f.call('preview',request),execute={environment:'live',previewToken:preview.previewToken,dryRun:false,playFabIds:['BBBB']};
  const original=await f.call('execute',execute);validateProductExecution(original,preview,execute);
  for(const mutate of [v=>{v.previewToken='other';},v=>{v.dryRun=true;},v=>{v.results=[];},v=>{v.results[0].requestId='different';},v=>{v.totalCount=2;},v=>{v.results[0].status='unknown';},v=>{v.results[0].auditRecorded='yes';}]){
    const value=structuredClone(original);mutate(value);assert.throws(()=>validateProductExecution(value,preview,execute));
  }
});
test('lookup and deletion reject unrelated or incomplete results before applying any UI updates',async t=>{
  const f=await fixture(t);const original=await f.call('lookup',request);validateProductLookup(original,request);
  for(const mutate of [v=>{v.results.pop();},v=>{v.successCount=0;},v=>{v.results[0].success='true';},v=>{v.results[0].grant={value:1,lastUpdated:''};}]){
    const value=structuredClone(original);mutate(value);assert.throws(()=>validateProductLookup(value,request));
  }
  for(const value of [{},{environment:'test',playFabId:'AAAA',key:'지급',status:'skipped',detail:'none'},{environment:'live',playFabId:'AAAA',key:'지급',status:'success'}])assert.throws(()=>validateProductDeletion(value,{...request,playFabId:'AAAA'}));
});
