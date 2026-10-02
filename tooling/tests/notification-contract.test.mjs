import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
const read=path=>readFileSync(resolve(root,path),'utf8');
const item=(sourceId,source='leave')=>({source,sourceId,sourceLabel:'연차관리',type:'LeaveRequestCreated',title:'알림',message:'내용',link:'/notifications',isRead:false,createdAtUtc:'2026-09-10T01:00:00Z'});
const feed=(...items)=>({items,sources:[{source:'leave',available:true},{source:'schedule',available:true}],unreadCount:items.length});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
test('notification identifiers retain full long precision and reject ambiguous legacy values',t=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());
  dom.window.eval(read('packages/workspace-ui/src/notification-contract.js'));
  const c=dom.window.CompanyNotificationContract;
  for(const value of ['1','9007199254740993','9223372036854775807'])assert.equal(c.id(value),value);
  assert.equal(c.id(123),'123');assert.equal(c.id(Number.MAX_SAFE_INTEGER),'9007199254740991');
  for(const value of [0,-1,1.5,NaN,Infinity,9007199254740992,'0','01','-1','+1','1e3',' 1','9223372036854775808',{},null])assert.throws(()=>c.id(value));
  assert.equal(c.compare('9007199254740993','9007199254740992'),1);
  assert.equal(c.compare('10','9'),1);assert.equal(c.compare('123','123'),0);
  for(const value of ['other:1','leave:1:2','leave:1/read','leave:01','leave:9223372036854775808'])assert.throws(()=>c.key(value));
});
test('feed validation normalizes a copy and rejects malformed or duplicate identities before rendering',t=>{
  const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());
  dom.window.eval(read('packages/workspace-ui/src/notification-contract.js'));
  const c=dom.window.CompanyNotificationContract,original=feed(item(1),item('1','schedule'));
  assert.equal(c.feed(original).items[0].sourceId,'1');assert.equal(original.items[0].sourceId,1);
  for(const value of [null,{}, {...original,unreadCount:-1},{...original,sources:[{source:'bad',available:true}]},
    feed(item('1'),item(1)),feed({...item('1'),title:null}),feed({...item('1'),createdAtUtc:'bad'}),feed(item('9007199254740993'),item(9007199254740992))])assert.throws(()=>c.feed(value));
});
async function shell(t,service='home'){
  const dom=new JSDOM('<!doctype html><div data-company-workspace data-company-service="'+service+'"></div>',{url:'https://'+service+'.example.test',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,observers=[],Native=w.MutationObserver;
  w.MutationObserver=class extends Native{constructor(callback){super(callback);observers.push(this);}};
  t.after(()=>{for(const observer of observers)observer.disconnect();w.close();});
  w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  w.ResizeObserver=class{observe(){}disconnect(){}};w.AbortSignal.timeout=()=>new w.AbortController().signal;
  const writes=[],events=[],alerts=[];let current=feed(item('9007199254740992'));
  w.Notification=class{static permission='granted';constructor(){alerts.push(this);}close(){this.closed=true;this.onclose?.();}};
  w.fetch=async(url,init={})=>{
    if(init.method==='POST'){writes.push(String(url));return {ok:true,status:204};}
    return {ok:true,status:200,json:async()=>String(url).includes('/context')?{authenticated:true,isAdmin:true,user:{id:'1',name:'검증',email:'test@example.test',role:'admin'},services:[],profiles:{},csrfToken:'synthetic'}:current};
  };
  w.addEventListener('leave:notifications',event=>events.push(event.detail.items));
  w.eval(read('apps/portal/wwwroot/js/company-workspace.js'));await tick();
  return {w,writes,events,alerts,update:async value=>{current=value;w.dispatchEvent(new w.Event('focus'));await tick();}};
}
for(const service of ['home','leave','schedule','cs','statistics','sheet','iap'])test(`${service} generated shell sends exact read ID and compares adjacent large IDs`,async t=>{
  const f=await shell(t,service),doc=f.w.document;
  await f.update(feed(item('9007199254740993'),item('9223372036854775807','schedule')));
  assert.equal(f.events.length,1);assert.equal(f.events[0][0].sourceId,'9007199254740993');
  const button=doc.querySelector('[data-cw-read="schedule:9223372036854775807"]');assert.ok(button);
  button.click();await tick();assert.equal(new URL(f.writes[0]).pathname,'/api/workspace/notifications/schedule/9223372036854775807/read');assert.equal(new URL(f.writes[0]).searchParams.get('expectedUserId'),'1');
  doc.querySelector('[data-cw-read]').dataset.cwRead='leave:9223372036854775808';doc.querySelector('[data-cw-read]').click();await tick();
  assert.equal(f.writes.length,1);
  await f.update(feed(item(9007199254740992)));
  assert.equal(doc.querySelectorAll('[data-cw-read="leave:9007199254740992"]').length,0);
  assert.ok([...doc.querySelectorAll('[data-cw-read]')].every(button=>button.disabled));
  assert.match(doc.querySelector('[data-cw-notification-state]').textContent,/식별자/);
});
test('company scope invalidation closes OS alerts and resets private notification watermark',async t=>{
  const f=await shell(t),doc=f.w.document;
  await f.update(feed({...item('9007199254740993'),createdAtUtc:'2026-09-10T02:00:00Z'}));
  assert.equal(f.alerts.length,1);assert.equal(typeof f.alerts[0].onclick,'function');
  doc.dispatchEvent(new f.w.CustomEvent('workspace-entity-scope-change'));
  assert.equal(f.alerts[0].closed,true);assert.equal(f.alerts[0].onclick,null);
  assert.equal(doc.querySelector('[data-cw-count]').hidden,true);
  assert.equal(doc.querySelector('[data-company-service]').dataset.latestLeave,undefined);
  assert.equal(doc.querySelectorAll('[data-cw-notices] article').length,0);
  await f.update(feed({...item('9007199254740994'),createdAtUtc:'2026-09-10T03:00:00Z'}));
  assert.equal(f.alerts.length,1);assert.equal(f.writes.length,0);
});
