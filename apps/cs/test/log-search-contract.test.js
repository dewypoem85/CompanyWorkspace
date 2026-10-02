import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogConfig, validateLogJob } from '../public/log-search-contract.js';

const id='00000000-0000-0000-0000-000000000001';
const stats={partitions:2,partitionsScanned:2,blobsListed:1,blobsScanned:1,blobsSkippedByUid:0,rowsScanned:1,blobErrors:0};
const request={from:'2026-08-14T03:00:00.000Z',to:'2026-08-14T04:00:00.000Z',query:'젬',mode:'any',sort:'desc',limit:100,playFabId:'ABC123',eventName:''};
const item={timestamp:'2026-08-14T03:10:00Z',titleId:'TEST',playFabId:'ABC123',eventName:'log',namespace:'custom',eventId:'event',entityId:'ABC123',entityType:'player',snippet:'젬',eventData:'{"counter":9223372036854775807}',eventDataTruncated:false,sourceBlob:'synthetic.parquet'};
const job={id,status:'completed',cancelRequested:false,durationMs:20,progress:{...stats,stage:'completed',resultCount:1},result:{...request,titleId:'TEST',source:'live',durationMs:20,results:[item],stats}};

test('complete log acknowledgement retains exact event text and matches job/title/search',()=>{
  assert.equal(validateLogJob(job,{jobId:id,titleId:'TEST',request}),job);
  assert.equal(job.result.results[0].eventData,'{"counter":9223372036854775807}');
  for(const mutate of [value=>{value.id='00000000-0000-0000-0000-000000000002';},value=>{value.result.titleId='OTHER';},value=>{delete value.result.stats;},value=>{value.result.results[0].eventData={};},value=>{value.result.query='different';},value=>{value.result.results[0].timestamp='bad';},value=>{value.result.limit=501;},value=>{value.progress.partitionsScanned=3;},value=>{value.result.stats.blobErrors=-1;},value=>{value.status='unknown';},value=>{value.result=null;}]) {
    const value=structuredClone(job);mutate(value);assert.throws(()=>validateLogJob(value,{jobId:id,titleId:'TEST',request}));
  }
});
test('log config rejects inconsistent readiness and invalid poll settings',()=>{
  const value={configured:true,storageConfigured:true,titleConfigured:true,titleId:'TEST',source:'live',asynchronous:true,pollIntervalMs:2000};
  assert.equal(validateLogConfig(value),value);
  for(const change of [{source:'test'},{storageConfigured:false},{configured:'true'},{pollIntervalMs:0},{pollIntervalMs:'2000'},{titleId:''}])assert.throws(()=>validateLogConfig({...value,...change}));
});
