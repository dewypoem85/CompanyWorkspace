import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const snapshots=resolve(root,'artifacts/razor');
const original=JSON.parse(readFileSync(resolve(snapshots,'portal.notifications.large.json'),'utf8'));
const readButton='[data-cw-read="schedule:9223372036854775807"]';
const state='[data-cw-notification-state]';
async function fixture(page,{width=320,theme='dark'}={}) {
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const model=JSON.parse(readFileSync(resolve(snapshots,'admin.json'),'utf8')),requests=[],errors=[];
  let context=model.context,feed=original,readStatus=200,writeStatus=204,hold=false,held=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path.startsWith('/api/workspace/notifications')){
      requests.push({url,method:req.method(),csrf:req.headers()['x-workspace-csrf']});
      if(req.method()==='POST'){
        if(hold){await new Promise(resolve=>{held=resolve;});held=null;}
        return route.fulfill({status:writeStatus, ...(writeStatus===204?{}:{json:{error:'격리 응답'}})}).catch(()=>{});
      }
      return route.fulfill({status:readStatus,json:readStatus===200?feed:{error:'격리 조회 오류'}});
    }
    if(req.method()!=='GET')throw Error('Unexpected mutation: '+path);
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/notifications')return route.fulfill({contentType:'text/html',body:readFileSync(resolve(snapshots,'portal.notifications.large.html'))});
    const base=resolve(root,'apps/portal/wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.css','.js','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://company.workspace.test/notifications');
  await page.getByRole('button',{name:'알림',exact:true}).click();
  await expect(page.locator(readButton)).toBeEnabled();
  return {requests,errors,model,setRead:status=>{readStatus=status;},setFeed:value=>{feed=value;},setWrite:status=>{writeStatus=status;},hold:()=>{hold=true;},release:()=>held?.(),
    writes:()=>requests.filter(r=>r.method==='POST'),
    switchAccount:async()=>{context={...context,user:{...context.user,id:3,name:'다른 검증 계정'}};await page.evaluate(()=>window.CompanyWorkspace.refresh());},
    refresh:()=>page.evaluate(()=>window.CompanyWorkspace.refresh())};
}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`notification confirmed write with failed refresh ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{width,theme});f.hold();
  await page.locator(readButton).click();await expect.poll(()=>f.writes().length).toBe(1);
  await expect(page.locator('[data-cw-read-all]')).toBeDisabled();await expect(page.locator('[data-center-read-all]')).toBeDisabled();
  await expect(page.locator('[data-cw-open-notice]').first()).toHaveAttribute('aria-disabled','true');
  expect(f.writes()[0].url.searchParams.get('expectedUserId')).toBe(String(f.model.context.user.id));
  expect(f.writes()[0].csrf).toBe(f.model.context.csrfToken);
  f.setRead(503);f.release();
  await expect(page.locator(state)).toHaveAttribute('data-state-kind','success');await expect(page.locator(state)).toContainText('조회만');
  await expect(page.locator('[data-cw-read-all]')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('confirmed-write-refresh-failed.png'),animations:'disabled'});
  f.setRead(200);await page.locator(state).getByRole('button',{name:'목록 다시 확인'}).click();
  await expect(page.locator(readButton)).toBeEnabled();expect(f.writes()).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const status of [200,401,403,409,503])test(`notification unconfirmed write does not retry status ${status}`,async({page})=>{
  const f=await fixture(page);f.setWrite(status);await page.locator(readButton).click();
  await expect(page.locator(state)).toHaveAttribute('data-state-kind',[401,403,409].includes(status)?'denied':'error');
  await expect(page.locator(state)).toContainText('반영 여부가 확인되지');await expect(page.locator('[data-cw-read-all]')).toBeDisabled();
  if([401,403,409].includes(status))await expect(page.locator('.notification-feed article')).toHaveCount(0);
  await page.locator(state).getByRole('button',{name:'목록 다시 확인'}).click();await expect(page.locator(readButton)).toBeEnabled();
  expect(f.writes()).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('notification account switch drops old document and late write without navigation',async({page})=>{
  const f=await fixture(page);f.hold();await page.locator(readButton).click();await expect.poll(()=>f.writes().length).toBe(1);
  f.setFeed({items:[],sources:[],unreadCount:0});await f.switchAccount();
  await expect(page.locator('[data-cw-notices]')).toContainText('새로운 알림이 없습니다.');
  await expect(page.locator('.notification-feed article')).toHaveCount(0);
  await expect(page.locator('[data-center-state]')).toHaveAttribute('data-state-kind','denied');
  await expect(page.locator('[data-center-read-all]')).toBeDisabled();
  f.release();await expect(page.locator(state)).toBeHidden();
  expect(f.requests.filter(r=>r.method==='GET').at(-1).url.searchParams.get('expectedUserId')).toBe('3');
  expect(f.writes()).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('notification partial feed, repeated empty and malformed response use common state',async({page})=>{
  const f=await fixture(page);
  for(let i=0;i<2;i++){
    f.setFeed({items:[],sources:[],unreadCount:0});await f.refresh();await expect(page.locator('[data-cw-notices]')).toContainText('새로운 알림이 없습니다.');
    f.setFeed(original);await f.refresh();await expect(page.locator(readButton)).toBeEnabled();
  }
  f.setFeed({...original,sources:original.sources.map(s=>({...s,available:false}))});await f.refresh();
  await expect(page.locator(state)).toContainText('일부 서비스');await expect(page.locator('[data-cw-count]')).toHaveText('!');
  f.setFeed({...original,items:[{...original.items[0],sourceId:9007199254740992}]});await f.refresh();
  await expect(page.locator(state)).toHaveAttribute('data-state-kind','error');await expect(page.locator('[data-cw-read-all]')).toBeDisabled();
  expect(f.writes()).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('notification page disposal ignores late confirmation and removes private output',async({page})=>{
  const f=await fixture(page);f.hold();await page.locator(readButton).click();await expect.poll(()=>f.writes().length).toBe(1);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  await expect(page.locator('[data-cw-notices] article')).toHaveCount(0);await expect(page.locator('[data-center-read-all]')).toBeDisabled();
  const before=await page.locator(state).textContent();f.release();
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
  expect(await page.locator(state).textContent()).toBe(before);expect(f.writes()).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('notification observation timeout never treats an aborted write as rollback or retries it',async({page})=>{
  await page.clock.install();const f=await fixture(page);f.hold();await page.locator(readButton).click();
  await expect.poll(()=>f.writes().length).toBe(1);await page.clock.fastForward(16000);
  await expect(page.locator(state)).toHaveAttribute('data-state-kind','error');await expect(page.locator(state)).toContainText('반영 여부가 확인되지');
  await expect(page.locator('[data-cw-read-all]')).toBeDisabled();f.release();
  await page.locator(state).getByRole('button',{name:'목록 다시 확인'}).click();await expect(page.locator(readButton)).toBeEnabled();
  expect(f.writes()).toHaveLength(1);expect(f.errors).toEqual([]);
});
