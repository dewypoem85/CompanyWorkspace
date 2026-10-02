import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const form=(page,operation)=>page.locator(`[data-holiday-action="${operation}"]`);
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.holiday.json'),'utf8')),imports=JSON.parse(readFileSync(resolve(dir,'leave.holiday.imports.json'),'utf8'));
  const errors=[],writes=[],unhandled=[];let adds=0,jsons=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const action=url.searchParams.get('handler');writes.push({action,body:request.postData(),accept:request.headers().accept});
      if(path!=='/Admin/Holidays'){unhandled.push(path);return route.abort();}
      const receipt=options.receipt||(action==='Add'?model[adds++?'update':'add']:action==='Delete'?model.delete:action==='ImportOnline'?imports.onlineReceipt:imports[['skipReceipt','overwriteReceipt','repeatedReceipt'][jsons++]]);
      return route.fulfill({status:options.status||200,contentType:options.html?'text/html':media,body:options.html?'<html>login</html>':JSON.stringify(receipt)});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/Holidays')return route.fulfill({body:readFileSync(resolve(dir,'leave.holiday.html')),contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/Holidays?Year=2026');
  await expect(form(page,'Add').locator('[name="expectedEmployeeId"]')).toHaveCount(1);
  return {model,imports,errors,writes,unhandled};
}
const clean=f=>{expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);};
async function edit(page){await form(page,'Add').getByLabel('날짜',{exact:true}).fill('2026-02-01');await form(page,'Add').getByLabel('이름',{exact:true}).fill(' 신규 휴일 ');}
async function confirm(page,operation){await form(page,operation).getByRole('button').first().click();await page.locator('[data-confirm-apply]').click();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`holiday shared add update delete and local year preserve drafts ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await edit(page);
  const json=form(page,'ImportJson').getByLabel('JSON',{exact:true});await json.fill('미저장 JSON 원문 9223372036854775807');
  await form(page,'Add').getByRole('button').click();await expect(page.getByRole('dialog')).toContainText('2026-02-01');
  await page.screenshot({path:info.outputPath('confirmation.png'),animations:'disabled'});await page.getByRole('dialog').press('Escape');expect(f.writes).toHaveLength(0);
  await confirm(page,'Add');await expect(page.locator('[data-holiday-row]')).toHaveCount(2);await expect(form(page,'Add').getByRole('button')).toBeDisabled();
  await form(page,'Add').getByLabel('날짜',{exact:true}).fill('2026-01-01');await form(page,'Add').getByLabel('이름',{exact:true}).fill(' 수정 ');
  await confirm(page,'Add');await expect(page.locator('[data-holiday-row="9007199254740993"] [data-holiday-name]')).toHaveText('수정');
  await page.locator('[data-holiday-row="9007199254740993"] button').click();await page.locator('[data-confirm-apply]').click();await expect(page.locator('[data-holiday-row]')).toHaveCount(1);
  const filter=page.locator('[data-holiday-year-form]');await filter.getByLabel('연도').fill('2027');await filter.getByRole('button').click();await expect(page.locator('[data-holiday-name]')).toHaveText('다른 연도');
  await filter.getByLabel('연도').fill('2026');await filter.getByRole('button').click();await expect(page.locator('[data-holiday-name]')).toHaveText('신규 휴일');
  await expect(json).toHaveValue('미저장 JSON 원문 9223372036854775807');await expect(form(page,'Add').getByLabel('이름',{exact:true})).toHaveValue(' 수정 ');
  await page.locator('[data-holiday-state]').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  expect((await page.locator('[data-holiday-state]').boundingBox()).y).toBeGreaterThanOrEqual((await page.locator('.cw-header').boundingBox()).height);
  await page.screenshot({path:info.outputPath('saved.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.writes.map(x=>x.action)).toEqual(['Add','Add','Delete']);expect(f.writes.every(x=>x.accept===media)).toBe(true);clean(f);
});
for(const width of [320,1440])for(const theme of ['light','dark'])test(`holiday imports preserve source and validate unchanged skips ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await edit(page);
  const json=form(page,'ImportJson'),raw=json.getByLabel('JSON',{exact:true});await raw.fill(f.imports.raw);
  await confirm(page,'ImportJson');await expect(page.locator('[data-holiday-state]')).toContainText('추가 1건 · 수정 0건 · 건너뜀 1건');
  await json.getByRole('checkbox').check();await confirm(page,'ImportJson');await expect(page.locator('[data-holiday-state]')).toContainText('수정 1건');
  await json.getByRole('checkbox').uncheck();await confirm(page,'ImportJson');await expect(page.locator('[data-holiday-state]')).toContainText('추가 0건 · 수정 0건 · 건너뜀 2건');
  await confirm(page,'ImportOnline');await expect(page.locator('[data-holiday-state]')).toContainText('반영을 확인');
  await expect(raw).toHaveValue(f.imports.raw);await expect(form(page,'Add').getByLabel('이름',{exact:true})).toHaveValue(' 신규 휴일 ');
  expect(f.writes.map(x=>x.action)).toEqual(['ImportJson','ImportJson','ImportJson','ImportOnline']);
  expect(f.writes[1].body).toContain('true');expect(f.writes[1].body).toContain('false');
  await page.screenshot({path:info.outputPath('imports.png'),animations:'disabled'});clean(f);
});
for(const failure of ['owner','previous','id','input','other-year','token','navigate','html','401','403','409','502'])test(`holiday unconfirmed ${failure} locks all forms`,async({page})=>{
  const model=JSON.parse(readFileSync(resolve(dir,'leave.holiday.json'),'utf8')),receipt=structuredClone(model.add),data=receipt.data;
  if(failure==='owner')data.snapshot.actorEmployeeId='999';if(failure==='previous')data.previousStateToken='A'.repeat(64);
  if(failure==='id')data.snapshot.items[1].id=9007199254740995;if(failure==='input')data.intent.name='변경';
  if(failure==='other-year')data.snapshot.items.at(-1).name='다름';if(failure==='token')data.snapshot.stateToken=data.previousStateToken;if(failure==='navigate')data.navigateTo='/wrong';
  const f=await fixture(page,{receipt,status:Number(failure)||200,html:failure==='html'});await edit(page);await confirm(page,'Add');
  await expect(page.locator('[data-holiday-fields]')).toHaveJSProperty('disabled',true);await expect(form(page,'ImportOnline').getByRole('button')).toBeDisabled();
  await expect(page.locator('[data-holiday-recheck]')).toBeVisible();await expect(page.locator('[data-holiday-row]')).toHaveCount(1);
  await expect(form(page,'Add').getByLabel('이름',{exact:true})).toHaveValue(' 신규 휴일 ');
  await form(page,'ImportOnline').evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));expect(f.writes).toHaveLength(1);clean(f);
});
test('holiday invalid is editable and confirmation rejects changed checkbox without POST',async({page})=>{
  const f=await fixture(page,{status:422,receipt:{protocol:'workspace-form-v1',outcome:'invalid',message:'저장 전 입력 오류'}});await edit(page);
  await confirm(page,'Add');await expect(page.locator('[data-holiday-state]')).toContainText('저장 전 입력 오류');await expect(form(page,'Add').getByRole('button')).toBeEnabled();
  await form(page,'ImportOnline').getByRole('button').click();await form(page,'ImportOnline').getByRole('checkbox').evaluate(node=>node.checked=true);
  await page.locator('[data-confirm-apply]').click();expect(f.writes).toHaveLength(1);await page.getByRole('dialog').press('Escape');clean(f);
});
for(const boundary of ['scope','pagehide','timeout','draft','removed','form-removed'])test(`holiday late receipt after ${boundary} cannot replace rows or resume writes`,async({page})=>{
  const f=await fixture(page);await edit(page);
  await page.evaluate(({receipt,boundary})=>{
    const fetch=window.fetch.bind(window),timer=window.setTimeout.bind(window);if(boundary==='timeout')window.setTimeout=(fn,ms,...args)=>timer(fn,ms===30000?100:ms,...args);
    window.fetch=async(url,options)=>{if(options?.method!=='POST')return fetch(url,options);window.postCount=(window.postCount||0)+1;
      return {status:200,ok:true,headers:new Headers({'content-type':'application/vnd.company.workspace-form+json'}),json:()=>new Promise(resolve=>window.release=()=>resolve(receipt))};};
  },{receipt:f.model.add,boundary});
  await confirm(page,'Add');await page.waitForFunction(()=>window.release);await expect(form(page,'ImportOnline').getByRole('button')).toBeDisabled();
  await form(page,'ImportOnline').evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));expect(await page.evaluate(()=>window.postCount)).toBe(1);
  if(boundary==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(boundary==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(boundary==='draft')await form(page,'Add').getByLabel('이름',{exact:true}).evaluate(node=>node.value='새 초안');
  if(boundary==='removed')await page.locator('[data-holiday-screen]').evaluate(node=>node.remove());
  if(boundary==='form-removed')await form(page,'Add').evaluate(node=>node.remove());
  if(boundary==='timeout')await expect(page.locator('[data-holiday-recheck]')).toBeVisible();
  await page.evaluate(async()=>{window.release();await new Promise(resolve=>setTimeout(resolve,30));});
  if(boundary==='scope'){await expect(page.locator('[data-holiday-row]')).toHaveCount(0);await expect(page.locator('[data-holiday-snapshot]')).toHaveText('');}
  else if(boundary!=='removed'){await expect(page.locator('[data-holiday-row]')).toHaveCount(1);await expect(page.locator('[data-holiday-fields]')).toHaveJSProperty('disabled',true);}
  expect(await page.evaluate(()=>window.postCount)).toBe(1);clean(f);
});
