import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const feed=id=>({items:id?[{source:'leave',sourceId:id,sourceLabel:'연차',type:'LeaveRequestCreated',title:'알림',message:'내용',link:'/notifications',isRead:false,createdAtUtc:'2026-09-10T01:00:00Z'}]:[],sources:[],unreadCount:id?1:0});
async function fixture(t,timeoutMs=1000){
  const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());
  for(const name of ['notification-contract','notification-session'])w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/'+name+'.js'),'utf8'));
  let context={authenticated:true,user:{id:'1',role:'employee'},services:[{key:'leave'}]},locked=true;
  const calls=[],states=[],feeds=[],resets=[];
  const session=w.CompanyNotificationSession.attach({getContext:()=>context,timeoutMs,
    request:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),
    onFeed:value=>feeds.push(value),onReset:()=>resets.push(true),onState:value=>states.push(value),onLock:value=>locked=value});
  t.after(()=>session.dispose());session.update();await tick();
  return {session,calls,states,feeds,resets,get locked(){return locked;},
    change:async(id)=>{context={...context,user:{...context.user,id}};session.update();await tick();},
    reply:async(index,value=feed())=>{calls[index].resolve(value);await tick();},
    fail:async(index,status)=>{calls[index].reject(Object.assign(Error('격리 오류'),{status}));await tick();}};
}
test('notification session scopes requests and serializes read/write controls',async t=>{
  const f=await fixture(t);assert.ok(f.locked);assert.match(f.calls[0].url,/expectedUserId=1/);
  assert.equal(await f.session.write('all'),false);assert.equal(f.calls.length,1);
  await f.reply(0,feed('9007199254740993'));assert.equal(f.locked,false);
  const write=f.session.write('leave:9007199254740993');await tick();
  assert.ok(f.locked);assert.equal(f.calls[1].options.expectedStatus,204);
  assert.equal(await f.session.write('all'),false);assert.equal(await f.session.read(),false);
  await f.reply(1,null);assert.equal(f.calls[2].options.method,undefined);
  await f.reply(2,feed());assert.equal(await write,true);assert.equal(f.locked,false);assert.equal(f.states.at(-1).kind,'success');
});
test('confirmed write and failed refresh stay distinct, with read-only recovery',async t=>{
  const f=await fixture(t);await f.reply(0);const write=f.session.write('all');await tick();await f.reply(1,null);await f.fail(2,503);await write;
  assert.equal(f.states.at(-1).kind,'success');assert.match(f.states.at(-1).message,/조회만/);assert.ok(f.locked);
  f.states.at(-1).retry();await tick();await f.reply(3);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});
test('unconfirmed writes are not automatically retried or treated as rollback',async t=>{
  const f=await fixture(t);await f.reply(0);const write=f.session.write('all');await tick();await f.fail(1,503);assert.equal(await write,false);
  assert.match(f.states.at(-1).message,/반영 여부.*확인되지/);assert.equal(await f.session.write('all'),false);
  f.states.at(-1).retry();await tick();assert.equal(f.calls[2].options.method,undefined);await f.reply(2);
  assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});
test('account switch rejects non-abortable old reads without unlocking a new request',async t=>{
  const f=await fixture(t);await f.change('2');assert.ok(f.calls[0].options.signal.aborted);assert.match(f.calls[1].url,/expectedUserId=2/);
  await f.reply(0,feed('100'));assert.ok(f.locked);assert.equal(f.feeds.length,0);
  await f.reply(1,feed('200'));assert.equal(f.feeds[0].items[0].sourceId,'200');assert.equal(f.locked,false);
});
test('account change after write acknowledgement cannot display old success after its refresh',async t=>{
  const f=await fixture(t);await f.reply(0);const write=f.session.write('all');await tick();await f.reply(1,null);
  await f.change('2');await f.reply(3,feed('200'));const count=f.states.length;
  await f.reply(2,feed('100'));await write;assert.equal(f.states.length,count);assert.equal(f.feeds.at(-1).items[0].sourceId,'200');
});
test('scope invalidation suspends requests until fresh context and dispose ignores late JSON',async t=>{
  const f=await fixture(t);f.session.invalidate();assert.equal(await f.session.read(),false);assert.equal(await f.session.write('all'),false);
  await f.reply(0,feed('100'));assert.equal(f.feeds.length,0);f.session.update();await tick();assert.equal(f.calls.length,2);
  f.session.dispose();const count=f.states.length;await f.reply(1,feed('200'));assert.equal(f.states.length,count);assert.equal(f.feeds.length,0);
});
test('observation timeout settles a write even when transport ignores cancellation',async t=>{
  const f=await fixture(t,30);await f.reply(0);let followed=false;const write=f.session.write('all',()=>followed=true);await tick();
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(await write,false);assert.ok(f.calls[1].options.signal.aborted);assert.ok(f.locked);
  await f.reply(1,null);assert.equal(followed,false);assert.equal(f.calls.length,2);
});
for(const status of [401,403,409])test(`notification ${status} clears private output and retains denied state`,async t=>{
  const f=await fixture(t);await f.reply(0,feed('1'));const resets=f.resets.length;const read=f.session.read();await tick();await f.fail(1,status);await read;
  assert.ok(f.resets.length>resets);assert.equal(f.states.at(-1).kind,'denied');assert.ok(f.locked);
});
