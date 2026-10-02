import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateWebhookSnapshot,validateWebhookReceipt} from '../../apps/leave/wwwroot/js/webhook-settings.js';
const row={id:'9007199254740993',memo:'채널',maskedUrl:'https://discord.com/api/webhooks/***',createdAt:'2026-09-11 09:00'};
const before={actorEmployeeId:'4',stateToken:'A'.repeat(64),items:[row]};
test('webhook snapshot preserves exact IDs and rejects malformed or unmasked directories',()=>{
  assert.equal(validateWebhookSnapshot(before),before);
  assert.throws(()=>validateWebhookSnapshot({...before,items:[{...row,createdAt:'2026-02-31 99:00'}]}));
  for(const patch of [{actorEmployeeId:4},{stateToken:'bad'},{items:[row,row]},{items:[{...row,id:9007199254740993}]},{items:[{...row,id:'9223372036854775808'}]},{items:[{...row,maskedUrl:'https://discord.com/api/webhooks/1/secret'}]}])assert.throws(()=>validateWebhookSnapshot({...before,...patch}));
});
test('webhook Add validates every old row, new exact ID, masked target and URL digest before publishing',()=>{
  const intent={memo:'새 채널',urlHash:'C'.repeat(64),maskedUrl:row.maskedUrl};
  const receipt={operation:'Add',previousStateToken:before.stateToken,navigateTo:'/Admin/NotificationSettings',affected:{id:'9007199254740994',memo:intent.memo,urlHash:intent.urlHash},snapshot:{...before,stateToken:'B'.repeat(64),items:[row,{...row,id:'9007199254740994',memo:intent.memo}]}};
  assert.equal(validateWebhookReceipt(receipt,'Add',before,intent),receipt.snapshot);
  for(const mutate of [x=>delete x.affected,x=>x.affected.urlHash='D'.repeat(64),x=>x.snapshot.items[0].memo='changed',x=>x.snapshot.items[1].maskedUrl='https://discordapp.com/api/webhooks/***',x=>x.snapshot.stateToken=before.stateToken,x=>x.snapshot.actorEmployeeId='5',x=>x.navigateTo='/']){const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>validateWebhookReceipt(changed,'Add',before,intent));}
});
test('webhook Delete and Test validate the complete checked target set',()=>{
  const base={previousStateToken:before.stateToken,navigateTo:'/Admin/NotificationSettings'};
  const test={...base,operation:'Test',affected:null,snapshot:structuredClone(before)};
  assert.equal(validateWebhookReceipt(test,'Test',before,{}),test.snapshot);
  for(const mutate of [x=>x.affected={},x=>x.snapshot.items=[],x=>x.snapshot.items[0].memo='changed',x=>x.snapshot.stateToken='B'.repeat(64)]){const changed=structuredClone(test);mutate(changed);assert.throws(()=>validateWebhookReceipt(changed,'Test',before,{}));}
  const remove={...base,operation:'Delete',affected:{id:row.id},snapshot:{...before,stateToken:'B'.repeat(64),items:[]}};
  assert.equal(validateWebhookReceipt(remove,'Delete',before,{id:row.id}),remove.snapshot);
  assert.throws(()=>validateWebhookReceipt(remove,'Delete',before,{id:'1'}));
  assert.throws(()=>validateWebhookReceipt({...remove,snapshot:before},'Delete',before,{id:row.id}));
});
