import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateHolidaySnapshot,validateHolidayReceipt,holidayTextHash} from '../../apps/leave/wwwroot/js/holiday-contract.js';
const row={id:'9007199254740993',date:'2026-01-01',name:'신정'},future={id:'9007199254740994',date:'2027-01-01',name:'다른 연도'};
const before={actorEmployeeId:'4',stateToken:'A'.repeat(64),items:[row,future]};
const data=(operation,intent,items)=>({operation,intent,previousStateToken:before.stateToken,snapshot:{...before,stateToken:'B'.repeat(64),items},applied:null,counts:null,navigateTo:'/Admin/Holidays?Year=2026'});
test('holiday snapshots retain exact Int64 IDs, calendar dates, unique dates and sorted rows',()=>{
  assert.equal(validateHolidaySnapshot(before),before);
  for(const changed of [{...before,actorEmployeeId:4},{...before,items:[future,row]},{...before,items:[row,row]},
    {...before,items:[{...row,id:9007199254740993}]},{...before,items:[{...row,date:'2026-02-31'}]},
    {...before,items:[{...row,id:'9223372036854775808'}]}])assert.throws(()=>validateHolidaySnapshot(changed));
});
test('holiday Add/Delete validate exact target and preserve all other dates and IDs',()=>{
  const intent={date:row.date,name:'수정'},receipt=data('Add',intent,[{...row,name:'수정'},future]);
  assert.equal(validateHolidayReceipt(receipt,'Add',before,intent).year,2026);
  for(const mutate of [x=>x.intent.name='다름',x=>x.snapshot.items[0].id='99',x=>x.snapshot.items[1].name='변경',x=>x.snapshot.items.pop(),x=>x.snapshot.actorEmployeeId='5',x=>x.previousStateToken='C'.repeat(64),x=>x.navigateTo='/wrong',x=>x.applied=[]]){
    const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>validateHolidayReceipt(bad,'Add',before,intent));
  }
  const remove=data('Delete',{id:row.id},[future]);assert.equal(validateHolidayReceipt(remove,'Delete',before,{id:row.id}).snapshot.items.length,1);
  assert.throws(()=>validateHolidayReceipt(remove,'Delete',before,{id:'1'}));
  const noop=data('Add',{date:row.date,name:row.name},before.items);noop.snapshot.stateToken=before.stateToken;
  assert.equal(validateHolidayReceipt(noop,'Add',before,noop.intent).snapshot.stateToken,before.stateToken);
});
test('holiday imports verify every applied date, overwrite choice, digest, counts and complete final list',()=>{
  const intent={year:2026,overwriteExisting:true,jsonHash:'C'.repeat(64)},added={id:'9007199254740995',date:'2026-03-01',name:'삼일절'};
  const receipt={...data('ImportJson',intent,[{...row,name:'수정'},added,future]),applied:[{date:row.date,name:'수정'},{date:added.date,name:added.name}],counts:{created:1,updated:1,skipped:0}};
  assert.equal(validateHolidayReceipt(receipt,'ImportJson',before,intent).counts.updated,1);
  for(const mutate of [x=>x.intent.jsonHash='D'.repeat(64),x=>x.intent.overwriteExisting=false,x=>x.counts.created=2,x=>x.applied.reverse(),x=>x.applied[0].date='2027-01-01',x=>x.snapshot.items[1].id=row.id,x=>x.snapshot.items[2].name='삭제?',x=>x.snapshot.stateToken=before.stateToken]){
    const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>validateHolidayReceipt(bad,'ImportJson',before,intent));
  }
  const online={...receipt,operation:'ImportOnline',intent:{...intent,jsonHash:null}};
  assert.equal(validateHolidayReceipt(online,'ImportOnline',before,online.intent).year,2026);
  const skip={...receipt,intent:{...intent,overwriteExisting:false},snapshot:{...receipt.snapshot,items:[row,added,future]},counts:{created:1,updated:0,skipped:1}};
  assert.equal(validateHolidayReceipt(skip,'ImportJson',before,skip.intent).counts.skipped,1);
});
test('holiday JSON hashing does not parse or round numeric tokens in the source',async()=>{
  const source='[{"date":"2026-01-01","name":"신정","id":9223372036854775807}]';
  assert.match(await holidayTextHash(source),/^[A-F0-9]{64}$/);
  assert.notEqual(await holidayTextHash(source),await holidayTextHash(source+' '));
  assert.equal(source.includes('9223372036854775807'),true);
});
