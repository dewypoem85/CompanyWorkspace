import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const url='https://discord.com/api/webhooks/987654321/synthetic-two-token-xxxxxxxx';
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.webhook.json'),'utf8')),writes=[],errors=[],unhandled=[];
  page.on('pageerror',e=>errors.push(e.message));let added=false;
  await page.route('**/*',async route=>{
    const request=route.request(),uri=new URL(request.url()),path=uri.pathname;
    if(request.method()==='POST'){
      const action=uri.searchParams.get('handler');writes.push({action,body:request.postData(),accept:request.headers().accept});
      if(path!=='/Admin/NotificationSettings'){unhandled.push(path);return route.abort();}
      const receipt=options.receipt||model[action==='Add'?'add':action==='Delete'?'delete':added?'test':'initialTest'];if(action==='Add')added=true;
      return route.fulfill({status:options.status||200,contentType:options.html?'text/html':media,body:options.html?'<html>login</html>':JSON.stringify(receipt)});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/NotificationSettings')return route.fulfill({body:readFileSync(resolve(dir,'leave.webhook.html')),contentType:'text/html'});
    const base=resolve(root,'apps',uri.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/NotificationSettings');await expect(page.locator('[data-webhook-action="Add"] [name="expectedEmployeeId"]')).toHaveCount(1);
  return {model,writes,errors,unhandled};
}
const form=(page,op)=>page.locator(`[data-webhook-action="${op}"]`);
const clean=f=>{expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);};
async function edit(page){await form(page,'Add').getByLabel('웹훅 URL').fill(url);await form(page,'Add').getByLabel('메모').fill('추가 채널');}
async function confirm(page,op){await form(page,op).getByRole('button').first().click();await page.locator('[data-confirm-apply]').click();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`webhook confirmed sequence and preserved drafts ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await edit(page);
  await form(page,'Add').getByRole('button').click();await expect(page.getByRole('dialog')).not.toContainText('synthetic-two-token');
  await page.screenshot({path:info.outputPath('confirmation.png'),animations:'disabled'});
  await page.getByRole('dialog').press('Escape');expect(f.writes).toHaveLength(0);await expect(form(page,'Add').getByLabel('메모')).toHaveValue('추가 채널');
  await confirm(page,'Test');await expect(page.locator('[data-webhook-state]')).toContainText('실제 수신');await expect(form(page,'Add').getByLabel('웹훅 URL')).toHaveValue(url);
  await confirm(page,'Add');await expect(page.locator('[data-webhook-row]')).toHaveCount(2);await expect(form(page,'Add').getByRole('button')).toBeDisabled();
  await form(page,'Add').getByLabel('메모').fill('다른 미저장 메모');
  await page.locator('[data-webhook-row="9007199254740993"] button').click();await page.locator('[data-confirm-apply]').click();
  await expect(page.locator('[data-webhook-row]')).toHaveCount(1);await expect(form(page,'Add').getByLabel('메모')).toHaveValue('다른 미저장 메모');
  expect((await page.locator('[data-webhook-state]').boundingBox()).y).toBeGreaterThanOrEqual((await page.locator('.cw-header').boundingBox()).height);
  await page.screenshot({path:info.outputPath('saved.png'),animations:'disabled'});
  expect(f.writes.map(x=>x.action)).toEqual(['Test','Add','Delete']);expect(f.writes.every(x=>x.accept===media)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);clean(f);
});
for(const failure of ['owner','previous','id','memo','hash','list','navigate','html','401','403','409','502'])test(`webhook unconfirmed ${failure} locks all writes`,async({page})=>{
  const model=JSON.parse(readFileSync(resolve(dir,'leave.webhook.json'),'utf8')),receipt=structuredClone(model.add),data=receipt.data;
  if(failure==='owner')data.snapshot.actorEmployeeId='999';if(failure==='previous')data.previousStateToken='A'.repeat(64);
  if(failure==='id')data.affected.id=9007199254740994;if(failure==='memo')data.affected.memo='changed';if(failure==='hash')data.affected.urlHash='A'.repeat(64);
  if(failure==='list')data.snapshot.items.shift();if(failure==='navigate')data.navigateTo='https://example.test';
  const f=await fixture(page,{receipt,status:Number(failure)||200,html:failure==='html'});await edit(page);await confirm(page,'Add');
  await expect(page.locator('[data-webhook-fields]')).toHaveJSProperty('disabled',true);await expect(form(page,'Test').getByRole('button')).toBeDisabled();await expect(page.locator('[data-webhook-recheck]')).toBeVisible();
  await expect(page.locator('[data-webhook-row]')).toHaveCount(1);await expect(form(page,'Add').getByLabel('메모')).toHaveValue('추가 채널');
  await form(page,'Test').evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));expect(f.writes).toHaveLength(1);clean(f);
});
test('webhook definite invalid input can be edited and confirmation detects changes',async({page})=>{
  const f=await fixture(page,{status:422,receipt:{protocol:'workspace-form-v1',outcome:'invalid',message:'입력 확인'}});await edit(page);
  await form(page,'Add').getByRole('button').click();await form(page,'Add').getByLabel('메모').evaluate(node=>node.value='변경됨');
  await page.locator('[data-confirm-apply]').click();expect(f.writes).toHaveLength(0);await page.getByRole('dialog').press('Escape');
  await confirm(page,'Add');await expect(page.locator('[data-webhook-state]')).toContainText('입력 확인');await expect(page.locator('[data-webhook-fields]')).toHaveJSProperty('disabled',false);await expect(form(page,'Add').getByRole('button')).toBeEnabled();clean(f);
});
for(const boundary of ['scope','pagehide','timeout','draft','removed','form-removed'])test(`webhook ignores nonabortable late receipt after ${boundary}`,async({page})=>{
  const f=await fixture(page);await edit(page);
  await page.evaluate(({receipt,boundary})=>{
    const fetch=window.fetch.bind(window),timer=window.setTimeout.bind(window);if(boundary==='timeout')window.setTimeout=(fn,ms,...args)=>timer(fn,ms===30000?100:ms,...args);
    window.fetch=async(url,options)=>{if(options?.method!=='POST')return fetch(url,options);window.postCount=(window.postCount||0)+1;
      return {status:200,ok:true,headers:new Headers({'content-type':'application/vnd.company.workspace-form+json'}),json:()=>new Promise(resolve=>window.release=()=>resolve(receipt))};};
  },{receipt:f.model.add,boundary});
  await confirm(page,'Add');await page.waitForFunction(()=>window.release);
  await expect(form(page,'Test').getByRole('button')).toBeDisabled();
  await form(page,'Test').evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));
  expect(await page.evaluate(()=>window.postCount)).toBe(1);
  if(boundary==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(boundary==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(boundary==='draft')await form(page,'Add').getByLabel('메모').evaluate(node=>node.value='새 초안');
  if(boundary==='removed')await page.locator('[data-webhook-screen]').evaluate(node=>node.remove());
  if(boundary==='form-removed')await form(page,'Add').evaluate(node=>node.remove());
  if(boundary==='timeout')await expect(page.locator('[data-webhook-recheck]')).toBeVisible();
  await page.evaluate(async()=>{window.release();await new Promise(resolve=>setTimeout(resolve,30));});
  if(boundary==='scope'){await expect(page.locator('[data-webhook-row]')).toHaveCount(0);await expect(page.locator('[data-webhook-snapshot]')).toHaveText('');}
  else if(boundary!=='removed'){await expect(page.locator('[data-webhook-row]')).toHaveCount(1);await expect(page.locator('[data-webhook-fields]')).toHaveJSProperty('disabled',true);await expect(form(page,'Test').getByRole('button')).toBeDisabled();}
  expect(await page.evaluate(()=>window.postCount)).toBe(1);clean(f);
});
