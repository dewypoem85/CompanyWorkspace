import {test,expect} from '@playwright/test';
import {assertNativeButtons} from './support/native-buttons.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

const snapshots=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const one='9007199254740993',two='9007199254740995';
const row=id=>`[data-notification-id="${id}"]`;
const action=(id,name='MarkRead')=>`${row(id)} [data-notification-action="${name}"]`;
async function fixture(page,options={}) {
  const model=JSON.parse(readFileSync(resolve(snapshots,'leave.notifications.fixture.json'),'utf8'));
  const errors=[],writes=[],unhandled=[],held=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST') {
      writes.push({path,handler:url.searchParams.get('handler'),body:request.postData(),accept:request.headers().accept});
      if(!path.startsWith('/Notifications')){unhandled.push(request.method()+path);return route.abort();}
      const key={MarkRead:'read',MarkAllRead:'all',Open:'opened'}[url.searchParams.get('handler')];
      const reply=()=>route.fulfill({status:options.status||200,contentType:options.html?'text/html':media,
        body:options.html?'<html>Sign in</html>':JSON.stringify(options.receipt||model[key])});
      if(options.hold){held.push(reply);return;}
      return reply();
    }
    if(request.method()!=='GET'){unhandled.push(request.method()+path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Notifications','/Notifications/Index'].includes(path))return route.fulfill({body:readFileSync(resolve(snapshots,'leave.notifications.fixture.html')),contentType:'text/html'});
    if(path==='/Leave')return route.fulfill({body:'<!doctype html><meta charset="utf-8"><title>Verified destination</title><h1>연차 상세</h1>',contentType:'text/html; charset=utf-8'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  await page.goto('https://leave.workspace.test/Notifications');
  await page.waitForFunction(()=>window.CompanyForm&&window.CompanyState&&document.querySelector('.cw-header'));
  return {model,errors,writes,unhandled,release:async()=>{await expect.poll(()=>held.length).toBe(1);await held.shift()();}};
}
function clean(f){expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`notification confirmed single read ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,{hold:true});
  await assertNativeButtons(page.locator('#notificationFields button'));
  await expect(page.locator(row(one)+' [data-read-status]')).toHaveText('읽지 않음');
  await page.locator(action(one)+' button').press('Enter');
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',true);
  await expect(page.locator(action(two)+' button')).toBeDisabled();
  await assertNativeButtons(page.locator('#notificationFields button'));
  await page.locator('[data-notification-action="MarkAllRead"]').evaluate(form=>form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
  await expect.poll(()=>f.writes.length).toBe(1);
  await expect(page.locator(row(one)+' [data-read-status]')).toHaveText('읽지 않음');
  await f.release();
  await expect(page.locator('#notificationState')).toContainText('읽음 처리했습니다.');
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',false);
  await expect(page.locator(row(one)+' [data-read-status]')).toHaveText('읽음');
  await expect(page.locator(row(two)+' [data-read-status]')).toHaveText('읽지 않음');
  await expect(page.locator(action(one))).toBeHidden();
  expect(f.writes[0].body).toContain(one);expect(f.writes[0].body).toContain('__RequestVerificationToken');expect(f.writes[0].accept).toBe(media);
  expect(f.writes[0].body).toContain('expectedEmployeeId');
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('notifications.png'),animations:'disabled'});clean(f);
});

test('all owned notifications reconcile only after confirmed save',async({page})=>{
  const f=await fixture(page,{hold:true});await page.locator('[data-notification-action="MarkAllRead"] button').click();
  await expect(page.locator('.notification-item.is-unread')).toHaveCount(2);await f.release();
  await expect(page.locator('.notification-item.is-read')).toHaveCount(2);
  await expect(page.locator('[data-notification-action="MarkAllRead"]')).toBeHidden();
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',false);expect(f.writes).toHaveLength(1);clean(f);
});
test('Open uses a validated local destination after the owned receipt',async({page})=>{
  const f=await fixture(page,{hold:true});await page.locator(action(two,'Open')+' button').click();
  await expect(page).toHaveURL(/\/Notifications$/);await f.release();await expect(page).toHaveURL('https://leave.workspace.test/Leave');
  await expect(page.getByRole('heading')).toHaveText('연차 상세');expect(f.writes).toHaveLength(1);clean(f);
});

for(const failure of ['owner','id','operation','html','401','403','500'])test(`unconfirmed notification ${failure} never changes rows or retries POST`,async({page})=>{
  const m=JSON.parse(readFileSync(resolve(snapshots,'leave.notifications.fixture.json'),'utf8'));
  const receipt=structuredClone(m.read);
  if(failure==='owner')receipt.data.employeeId='2';if(failure==='id')receipt.data.id=9007199254740993;
  if(failure==='operation')receipt.data.operation='MarkAllRead';
  const f=await fixture(page,{receipt,html:failure==='html',status:Number(failure)||200});
  await page.locator(action(one)+' button').click();await expect(page.locator('#notificationRecheck')).toBeVisible();
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',true);
  await expect(page.locator('.notification-item.is-unread')).toHaveCount(2);
  await page.locator(action(one)).evaluate(form=>form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
  expect(f.writes).toHaveLength(1);
  await page.locator('#notificationRecheck a').click();await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',false);
  expect(f.writes).toHaveLength(1);clean(f);
});

for(const boundary of ['scope','pagehide','timeout','target'])test(`late JSON ignores abort at notification ${boundary} boundary`,async({page})=>{
  const f=await fixture(page);
  await page.evaluate(({receipt,boundary})=>{
    const fetch=window.fetch.bind(window),timer=window.setTimeout.bind(window);
    if(boundary==='timeout')window.setTimeout=(fn,ms,...args)=>timer(fn,ms===30000?120:ms,...args);
    window.fetch=async(url,options)=>{
      if(options?.method!=='POST')return fetch(url,options);
      window.postCount=(window.postCount||0)+1;
      return {status:200,ok:true,headers:new Headers({'content-type':'application/vnd.company.workspace-form+json'}),json:()=>new Promise(resolve=>{window.releaseReply=()=>resolve(receipt);})};
    };
  },{receipt:f.model.read,boundary});
  await page.locator(action(one)+' button').click();await page.waitForFunction(()=>window.releaseReply);
  if(boundary==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(boundary==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(boundary==='target')await page.locator(action(one)+' [name="id"]').evaluate(el=>el.value='9007199254740997');
  if(boundary==='timeout')await expect(page.locator('#notificationRecheck')).toBeVisible();
  await page.evaluate(async()=>{window.releaseReply();await new Promise(r=>setTimeout(r,20));});
  if(boundary==='target')await expect(page.locator('#notificationRecheck')).toBeVisible();
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',true);
  await expect(page.locator('.notification-item.is-read')).toHaveCount(0);
  await expect(page.locator('.notification-item')).toHaveCount(boundary==='scope'?0:2);
  expect(await page.evaluate(()=>window.postCount)).toBe(1);expect(f.writes).toHaveLength(0);clean(f);
});

test('header refresh failure does not turn a confirmed write into a retry',async({page})=>{
  const f=await fixture(page);await page.evaluate(()=>CompanyWorkspace.refresh=async()=>{throw Error('Refresh unavailable');});
  await page.locator(action(one)+' button').click();await expect(page.locator('#notificationState')).toContainText('읽음 처리는 완료되었습니다.');
  await expect(page.locator(row(one)+' [data-read-status]')).toHaveText('읽음');
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',false);expect(f.writes).toHaveLength(1);clean(f);
});

test('changed rendered account is rejected before transport',async({page})=>{
  const f=await fixture(page);
  await page.locator(action(one)+' [name="expectedEmployeeId"]').evaluate(el=>el.value='2');
  await page.locator(action(one)+' button').click();
  await expect(page.locator('#notificationState')).toContainText('저장 요청을 보내지 않았습니다.');
  await expect(page.locator('#notificationFields')).toHaveJSProperty('disabled',false);
  await expect(page.locator('.notification-item.is-unread')).toHaveCount(2);
  expect(f.writes).toHaveLength(0);clean(f);
});
