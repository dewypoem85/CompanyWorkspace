import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteamTransactionApi } from '../lib/steam-transaction-api.js';
import { normalizeTransaction, SteamApiError } from '../lib/steam.js';
import { validateSteamConfig, validateSteamQuery, validateSteamHistory, validateSteamRefund } from '../public/steam-transaction-contract.js';
const orderId='18446744073709551615', steamId='76561198000000000', transactionId='9223372036854775807';
const request={orderId,steamId,confirmationOrderId:orderId,reason:'격리 환불 검증'};
const actor={authenticatedUser:{id:'1',name:'검증 직원',email:'ui@example.test'},requestId:'synthetic',ip:'127.0.0.1'};
function fixture(options={}) {
  const audit=[],calls=[];
  const transaction={...normalizeTransaction({orderid:orderId,steamid:steamId,transid:transactionId,status:'Succeeded',currency:'KRW',items:{itemid:'gold',qty:0,amount:'0',vat:'0',itemstatus:'Succeeded'}}),lookupType:'orderid'};
  let gate=null, refundError=null, auditFailure='';
  const client={queryTransaction:async id=>{calls.push(['query',id]);if(gate)await gate;return {...structuredClone(transaction),lookupType:id===transactionId?'transid':'orderid'};},refundTransaction:async id=>{calls.push(['refund',id]);if(refundError)throw refundError;transaction.status='Refunded';return {orderId:id,transactionId};}};
  const api=createSteamTransactionApi({steamClient:client,refundEnabled:true,
    appendRefundAudit:async entry=>{if(auditFailure==='attempted')throw new Error('synthetic audit failure');audit.push(entry);},
    appendRefundAuditSafe:async entry=>{audit.push(entry);return auditFailure!==entry.result;},...options});
  return {api,audit,calls,transaction,hold:()=>{let done;gate=new Promise(resolve=>{done=resolve;});return ()=>{gate=null;done();};},failRefund:error=>{refundError=error;},failAudit:value=>{auditFailure=value;}};
}
test('real Steam domain query/refund preserves string IDs, normalized zero amounts and audit acknowledgement',async()=>{
  const f=fixture();const queried=await f.api.query(request);validateSteamQuery(queried.payload,request);
  assert.equal(queried.payload.transaction.items[0].amount,'0');
  const byTransaction=await f.api.query({...request,orderId:transactionId});validateSteamQuery(byTransaction.payload,{...request,orderId:transactionId});
  const refunded=await f.api.refund(request,actor);validateSteamRefund(refunded.payload,orderId);
  assert.equal(refunded.statusCode,200);assert.deepEqual(f.audit.map(entry=>entry.result),['attempted','success']);
  assert.equal(f.audit[1].user,actor.authenticatedUser);assert.equal(f.calls.filter(([kind])=>kind==='refund').length,1);
});
test('Order ID와 Steam ID는 각각 단독으로 조회할 수 있다',async()=>{
  const historyTransaction=normalizeTransaction({orderid:orderId,steamid:steamId,transid:transactionId,status:'Succeeded',currency:'KRW',time:'2026-09-21T00:00:00Z'});
  const f=fixture({steamReportIndex:{findBySteamId:async value=>({transactions:value===steamId?[historyTransaction]:[],indexedFrom:'2010-01-01T00:00:00Z',updatedAt:'2026-09-21T00:00:01Z'})}});
  const orderRequest={orderId,steamId:''},orderResponse=await f.api.query(orderRequest);
  assert.equal(validateSteamQuery(orderResponse.payload,orderRequest),orderResponse.payload);
  assert.deepEqual(orderResponse.payload.verification,{steamIdProvided:false,steamIdMatches:true,refundableStatus:true});
  const historyRequest={orderId:'',steamId},historyResponse=await f.api.history(historyRequest);
  assert.equal(validateSteamHistory(historyResponse.payload,historyRequest),historyResponse.payload);
  assert.equal(historyResponse.payload.transactions[0].transactionId,transactionId);
});
test('server rejects disabled refunds, invalid confirmation, reason and Steam ID/status changes before refund',async()=>{
  assert.equal((await fixture({refundEnabled:false}).api.refund(request,actor)).statusCode,403);
  for(const change of [{confirmationOrderId:'1'},{reason:'짧음'},{reason:'가'.repeat(501)},{orderId:'18446744073709551616'},{steamId:'x'}]) {
    const f=fixture();await assert.rejects(()=>f.api.refund({...request,...change},actor));assert.equal(f.calls.filter(([kind])=>kind==='refund').length,0);
  }
  for(const change of [{steamId:'76561198000000001'},{status:'Refunded'}]) {
    const f=fixture();Object.assign(f.transaction,change);assert.equal((await f.api.refund(request,actor)).statusCode,409);
    assert.deepEqual(f.audit.map(entry=>entry.result),['rejected']);assert.equal(f.calls.filter(([kind])=>kind==='refund').length,0);
  }
});
test('server retains concurrent order lock and rechecks status after the first request completes',async()=>{
  const f=fixture(),release=f.hold(),first=f.api.refund(request,actor);
  assert.equal((await f.api.refund(request,actor)).statusCode,409);release();assert.equal((await first).statusCode,200);
  assert.equal((await f.api.refund(request,actor)).statusCode,409);assert.equal(f.calls.filter(([kind])=>kind==='refund').length,1);
});
test('audit failure before Steam blocks write; failure after success is acknowledged without duplicate refund',async()=>{
  const before=fixture();before.failAudit('attempted');await assert.rejects(()=>before.api.refund(request,actor));assert.equal(before.calls.filter(([kind])=>kind==='refund').length,0);
  const after=fixture();after.failAudit('success');const response=await after.api.refund(request,actor);validateSteamRefund(response.payload,orderId);
  assert.equal(response.payload.auditRecorded,false);assert.match(response.payload.message,/완료 감사 로그 기록에 실패/);
});
test('upstream failure records the failed attempt and releases the existing in-process lock',async()=>{
  const f=fixture();f.failRefund(new SteamApiError('synthetic rejection',{errorCode:7}));await assert.rejects(()=>f.api.refund(request,actor));
  assert.deepEqual(f.audit.map(entry=>entry.result),['attempted','failed']);assert.equal(f.audit[1].detail,'steam_error_7');
  f.failRefund(null);assert.equal((await f.api.refund(request,actor)).statusCode,200);
});
test('Steam UI rejects unrelated/incomplete acknowledgements and contradictory verification',async()=>{
  const f=fixture(),query=(await f.api.query(request)).payload;
  for(const mutate of [value=>{value.transaction.orderId='1';},value=>{value.transaction.steamId=Number(steamId);},value=>{value.verification.steamIdMatches=false;},value=>{value.transaction.items[0].amount=0;},value=>{delete value.transaction.lookupType;}]) {
    const value=structuredClone(query);mutate(value);assert.throws(()=>validateSteamQuery(value,request));
  }
  for(const value of [{},{refund:{orderId:'1',transactionId},auditRecorded:true,message:'ok'},{refund:{orderId,transactionId:Number(transactionId)},auditRecorded:true,message:'ok'},{refund:{orderId,transactionId},message:'ok'}])assert.throws(()=>validateSteamRefund(value,orderId));
  const config={appId:'2712460',sandbox:false,refundEnabled:false,apiConfigured:true,csrfToken:'synthetic',currentUser:{id:'1'}};
  assert.equal(validateSteamConfig(config),config);assert.throws(()=>validateSteamConfig({...config,refundEnabled:'true'}));
});
