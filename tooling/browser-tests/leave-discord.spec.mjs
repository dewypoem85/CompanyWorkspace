import {test,expect} from '@playwright/test';
import {assertNativeButtons} from './support/native-buttons.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const snapshots=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const form=action=>`form[data-discord-action="${action}"]`;
async function fixture(page,options={}) {
  const role=options.role||'employee',model=JSON.parse(readFileSync(resolve(snapshots,`leave.discord.${role}.fixture.json`),'utf8'));
  const errors=[],writes=[],unhandled=[],held=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const action=url.searchParams.get('handler');writes.push({action,body:request.postData(),accept:request.headers().accept});
      if(path!=='/Settings/Discord'){unhandled.push(path);return route.abort();}
      if(action==='Link')return route.fulfill({body:'<!doctype html><meta charset="utf-8"><h1>OAuth navigation boundary</h1>',contentType:'text/html'});
      const reply=()=>route.fulfill({status:options.status||200,contentType:options.html?'text/html':media,
        body:options.html?'<html>Login</html>':JSON.stringify(options.receipt||model[{Save:'save',Unlink:'unlink',Test:'initialTest'}[action]])});
      if(options.hold){held.push(reply);return;}return reply();
    }
    if(request.method()!=='GET'){unhandled.push(request.method()+path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Settings/Discord')return route.fulfill({body:readFileSync(resolve(snapshots,`leave.discord.${role}.${options.unlinked?'unlinked.':''}fixture.html`)),contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  await page.goto('https://leave.workspace.test/Settings/Discord');await page.waitForFunction(()=>window.CompanyForm&&document.querySelector('.cw-header'));
  return {model,errors,writes,unhandled,release:async()=>{await expect.poll(()=>held.length).toBe(1);await held.shift()();}};
}
async function edit(page){await page.locator('[name="selectedTypes"][value="LeaveRequestApproved"]').uncheck();await page.locator('[name="selectedTypes"][value="LeaveRequestRejected"]').check();}
function clean(f){expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`Discord shared save and selected theme ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1050});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});
  await assertNativeButtons(page.locator('#discordFields button'));
  await edit(page);await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');
  const selected=page.locator('.discord-option-card').filter({has:page.locator('[value="LeaveRequestRejected"]')});
  const unselected=page.locator('.discord-option-card').filter({has:page.locator('[value="LeaveRequestApproved"]')});
  const controls=page.locator('.discord-preference-form input[type="checkbox"]');
  for(const checkbox of await controls.all()){
    await expect(checkbox).toHaveClass(/\bcw-checkbox\b/);await expect(checkbox.locator('xpath=..')).toHaveClass(/\bcw-check-control\b/);
    expect((await checkbox.boundingBox()).width).toBe(18);
  }
  const colors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe),color=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};const result={active:color('active'),raised:color('raised')};probe.remove();return result;});
  await expect(selected).toHaveCSS('background-color',colors.active);await expect(unselected).toHaveCSS('background-color',colors.raised);
  await page.locator(form('Save')+' button').press('Enter');await expect(page.locator('#discordFields')).toHaveJSProperty('disabled',true);
  await expect(page.locator(form('Link')+' button')).toBeDisabled();await expect(page.locator(form('Test')+' button')).toBeDisabled();
  await assertNativeButtons(page.locator('#discordFields button'));
  await page.locator(form('Save')).evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));await f.release();
  await expect(page.locator('#discordDirty')).toHaveText('변경 없음');await expect(page.locator('#discordFields')).toHaveJSProperty('disabled',false);
  await expect(page.locator(form('Save')+' [name="expectedStateToken"]')).toHaveValue(f.model.save.data.snapshot.stateToken);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toContain('__RequestVerificationToken');expect(f.writes[0].body).toContain('expectedEmployeeId');expect(f.writes[0].accept).toBe(media);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect((await page.locator('#discordState').boundingBox()).y).toBeGreaterThanOrEqual((await page.locator('.cw-header').boundingBox()).height);
  await page.screenshot({path:info.outputPath('discord-settings.png'),animations:'disabled'});
  await page.locator('.discord-preference-form').screenshot({path:info.outputPath('discord-checkboxes.png'),animations:'disabled'});clean(f);
});
test('unlink confirmation cancels with focus and clears settings only after save',async({page},info)=>{
  const f=await fixture(page,{hold:true});await edit(page);const trigger=page.locator(form('Unlink')+' button');await trigger.click();
  await expect(page.getByRole('dialog')).toContainText('저장하지 않은 변경');expect(f.writes).toHaveLength(0);
  await page.getByRole('dialog').press('Escape');await expect(trigger).toBeFocused();await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');
  await trigger.click();await page.screenshot({path:info.outputPath('unlink-confirm.png'),animations:'disabled'});
  await page.locator('[data-confirm-apply]').click();await expect(page.locator('#discordIdentity')).toContainText('검증 Discord');
  await f.release();await expect(page.locator('#discordIdentity')).toHaveText('미연동');
  await expect(page.locator(form('Test'))).toBeHidden();await expect(page.locator(form('Unlink'))).toBeHidden();await expect(page.locator(form('Save')+' button')).toBeDisabled();
  await expect(page.locator(form('Link')+' button')).toBeEnabled();await expect(page.locator('#discordDirty')).toHaveText('변경 없음');expect(f.writes).toHaveLength(1);clean(f);
});
test('DM test does not save or erase preference drafts',async({page})=>{
  const f=await fixture(page);await edit(page);await page.locator(form('Test')+' button').click();
  await expect(page.locator('#discordState')).toContainText('실제 수신은 Discord에서 확인');await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');
  await expect(page.locator('[name="selectedTypes"][value="LeaveRequestRejected"]')).toBeChecked();expect(f.writes.map(x=>x.action)).toEqual(['Test']);clean(f);
});
test('OAuth remains native and asks before discarding a draft',async({page})=>{
  const f=await fixture(page);await edit(page);await page.locator(form('Link')+' button').click();
  await expect(page.getByRole('dialog')).toContainText('저장하지 않은 설정');expect(f.writes).toHaveLength(0);
  await page.locator('[data-confirm-apply]').click();await expect(page.getByRole('heading')).toHaveText('OAuth navigation boundary');expect(f.writes).toHaveLength(1);expect(f.writes[0].accept).not.toBe(media);clean(f);
});
for(const failure of ['owner','settings','html','401','403','409','502'])test(`Discord ${failure} preserves drafts and never retries`,async({page})=>{
  const model=JSON.parse(readFileSync(resolve(snapshots,'leave.discord.employee.fixture.json'),'utf8')),receipt=structuredClone(model.save);
  if(failure==='owner')receipt.data.snapshot.employeeId='2';if(failure==='settings')receipt.data.snapshot.selectedTypes=['LeaveRequestApproved'];
  const f=await fixture(page,{receipt,html:failure==='html',status:Number(failure)||200});await edit(page);await page.locator(form('Save')+' button').click();
  await expect(page.locator('#discordRecheck')).toBeVisible();await expect(page.locator('#discordFields')).toHaveJSProperty('disabled',true);
  await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');await expect(page.locator('[value="LeaveRequestRejected"]')).toBeChecked();
  await page.locator(form('Save')).evaluate(node=>node.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true})));expect(f.writes).toHaveLength(1);clean(f);
});
for(const boundary of ['scope','pagehide','timeout','draft'])test(`Discord ignores late JSON after ${boundary}`,async({page})=>{
  const f=await fixture(page);await edit(page);
  await page.evaluate(({receipt,boundary})=>{
    const original=window.fetch.bind(window),timer=window.setTimeout.bind(window);
    if(boundary==='timeout')window.setTimeout=(fn,ms,...args)=>timer(fn,ms===30000?120:ms,...args);
    window.fetch=async(url,options)=>{
      if(options?.method!=='POST')return original(url,options);window.postCount=(window.postCount||0)+1;
      return {status:200,ok:true,headers:new Headers({'content-type':'application/vnd.company.workspace-form+json'}),json:()=>new Promise(resolve=>window.releaseReply=()=>resolve(receipt))};
    };
  },{receipt:f.model.save,boundary});
  await page.locator(form('Save')+' button').click();await page.waitForFunction(()=>window.releaseReply);
  if(boundary==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(boundary==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(boundary==='draft')await page.locator('[value="LeaveRequestApproved"]').evaluate(node=>node.checked=true);
  if(boundary==='timeout')await expect(page.locator('#discordRecheck')).toBeVisible();
  await page.evaluate(async()=>{window.releaseReply();await new Promise(resolve=>setTimeout(resolve,20));});
  await expect(page.locator('#discordFields')).toHaveJSProperty('disabled',true);
  if(boundary==='scope'){await expect(page.locator('#discordIdentity')).toHaveCount(0);await expect(page.locator('#discordSnapshot')).toHaveText('');}
  else await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');
  expect(await page.evaluate(()=>window.postCount)).toBe(1);clean(f);
});
test('scope change dismisses unlink confirmation without native fallback',async({page})=>{
  const f=await fixture(page);await page.locator(form('Unlink')+' button').click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#discordState')).toContainText('이전 계정의 Discord 정보');expect(f.writes).toHaveLength(0);clean(f);
});
test('unlink review rejects inputs changed while confirming',async({page})=>{
  const f=await fixture(page);await page.locator(form('Unlink')+' button').click();
  await page.locator('[value="LeaveRequestRejected"]').evaluate(node=>node.checked=true);
  await page.locator('[data-confirm-apply]').click();await expect(page.getByRole('dialog')).toContainText('설정이 변경되었습니다.');
  expect(f.writes).toHaveLength(0);await page.getByRole('dialog').press('Escape');await expect(page.locator('#discordDirty')).toHaveText('저장하지 않은 변경');clean(f);
});
test('unlinked and administrator catalogs use actual server renderings',async({page})=>{
  const f=await fixture(page,{unlinked:true,role:'admin'});await expect(page.locator('#discordIdentity')).toHaveText('미연동');
  await expect(page.locator('[name="selectedTypes"]')).toHaveCount(8);await expect(page.locator(form('Save')+' button')).toBeDisabled();
  for(const checkbox of await page.locator('.discord-preference-form .cw-checkbox').all())await expect(checkbox).toBeDisabled();
  await expect(page.locator(form('Link')+' button')).toBeEnabled();expect(f.writes).toHaveLength(0);clean(f);
});
