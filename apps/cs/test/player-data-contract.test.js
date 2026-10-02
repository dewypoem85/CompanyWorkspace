import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlayerDataApi} from '../lib/player-data-api.js';
import {createMockProductPlayFabClient} from '../lib/product-playfab.js';
import {validateMutationResult, validatePlayerLookup, validatePlayerConfig, validatePlayerBaseConfig} from '../public/player-data-contract.js';

const target={environment:'test',playFabId:'SYNTHETIC_ID'};
test('player configuration validates all stores, environment flags and authenticated base config',async t=>{
  const call=await fixture(t),config=await call('config',{});
  assert.equal(validatePlayerConfig(config),config);
  for (const change of [r=>r.dataStores.pop(),r=>r.dataStores[0].saveCompression=false,r=>r.environments.test.id='live',r=>r.environments.test.dataStores=['user'],r=>r.environments.test.configured=false,r=>r.environments.test.writeEnabled='true',r=>r.saveDataCompression='plain',r=>r.maxValueBytes=-1]) {
    const invalid=structuredClone(config);change(invalid);assert.throws(()=>validatePlayerConfig(invalid));
  }
  const base={csrfToken:'synthetic-only',currentUser:{id:'synthetic-owner'}};
  assert.equal(validatePlayerBaseConfig(base),base);
  for (const invalid of [{}, {...base,csrfToken:''}, {...base,currentUser:null}, ...['', ' ', -1, NaN, 1.5].map(id=>({...base,currentUser:{id}}))]) assert.throws(()=>validatePlayerBaseConfig(invalid));
});
async function fixture(t) {
  const dataDir=await mkdtemp(join(tmpdir(),'cs-contract-'));t.after(()=>rm(dataDir,{recursive:true,force:true}));
  const client=createMockProductPlayFabClient({seed:{[target.playFabId]:{userData:{SaveData:'{"gem":1}'},data:{same:'read'},internalData:{same:'internal'}}}});
  const api=createPlayerDataApi({dataDir,environmentClients:{test:client}});
  return async(action,body)=>(await api.handle({path:`/api/playfab/player-data/${action}`,body,authenticatedUser:{id:'synthetic'},requestId:'synthetic',ip:'127.0.0.1'})).payload;
}
test('browser contract accepts real handler stores and rejects partial, duplicate or wrong-target snapshots',async t=>{
  const call=await fixture(t),result=await call('lookup',{...target,dataStore:'all'});
  assert.equal(validatePlayerLookup(result,target),result);
  for(const change of [r=>r.playFabId='other',r=>r.totalKeys++,r=>r.stores.pop(),r=>r.stores[1]=r.stores[0],r=>r.stores[0].records.SaveData.value=123,r=>r.stores[0].editToken='',r=>r.stores[0].keys.push('missing')]){
    const broken=structuredClone(result);change(broken);assert.throws(()=>validatePlayerLookup(broken,target));
  }
});
test('mutation acknowledgements preserve ES3 text, store identity and legacy compression migration',async t=>{
  const call=await fixture(t),value='{"counter":9223372036854775807,"escaped":"\\uAC00","name":"검증"}';
  for(const store of ['user','readonly','internal']) {
    const lookup=await call('lookup',{...target,dataStore:store});
    const request={...target,dataStore:store,editToken:lookup.editToken,key:store==='user'?'SaveData':'same',value,reason:'검증 작업',confirmed:true};
    const result=await call('save',request);assert.equal(validateMutationResult('save',request,result),result);
    for(const patch of [{environment:'live'},{playFabId:'other'},{dataStore:'wrong'},{key:'wrong'},{dataVersion:-1},{editToken:lookup.editToken},{record:{...result.record,value:'rounded'}},{removedKeys:['same']},{bytes:-1},{decodedBytes:value.length}])
      assert.throws(()=>validateMutationResult('save',request,{...result,...patch}),JSON.stringify(patch));
    for(const field of Object.keys(result)) {const broken={...result};delete broken[field];assert.throws(()=>validateMutationResult('save',request,broken),field);}
    assert.equal(result.record.value,value);
  }
});
test('add and delete use their own existing acknowledgement shape and never accept mismatched targets',async t=>{
  const call=await fixture(t);
  for(const action of ['add','delete']){
    const lookup=await call('lookup',{...target,dataStore:'internal'});
    const request={...target,dataStore:'internal',editToken:lookup.editToken,key:'new-key',value:'검증 값',reason:'검증 작업',confirmed:true};
    const result=await call(action,request);assert.equal(validateMutationResult(action,request,result),result);
    for(const field of Object.keys(result)){const broken={...result};delete broken[field];assert.throws(()=>validateMutationResult(action,request,broken),field);}
    assert.throws(()=>validateMutationResult(action,{...request,dataStore:'readonly'},result));
  }
});
