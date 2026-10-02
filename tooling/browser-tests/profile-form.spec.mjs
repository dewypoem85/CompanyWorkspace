import {test,expect} from '@playwright/test';
import {assertNativeButtons} from './support/native-buttons.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const initial=JSON.parse(readFileSync(resolve(dir,'profile.context.json'),'utf8'));
const saved=JSON.parse(readFileSync(resolve(dir,'profile.saved.json'),'utf8'));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const form='[data-profile-form]',state='[data-profile-status]',preview='[data-profile-preview]';
async function fixture(page,{width=320,theme='dark'}={}) {
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  let context=structuredClone(initial),result=structuredClone(saved),status=200,readStatus=200,hold=false,held=null,malformed=false,storedImage=png;
  result.data.version='b'.repeat(32);result.data.avatarUrl='/api/workspace/avatar/'+initial.user.id+'?v='+result.data.version;
  const writes=[],reads=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const values=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(values);
      const operation=values.get('Operation');result={...result,data:{...result.data,operation,...(operation==='remove'?{version:'',avatarUrl:null}:{})}};
      if(hold)await new Promise(resolve=>{held=resolve;});
      if(status===200&&!malformed){if(values.get('Photo'))storedImage=Buffer.from(await values.get('Photo').arrayBuffer());context.user.avatarUrl=result.data.avatarUrl;if(result.data.avatarUrl)context.profiles[String(context.user.id)]=result.data.avatarUrl;else delete context.profiles[String(context.user.id)];}
      return route.fulfill({status,contentType:media,json:malformed?{...result,data:{...result.data,userId:'wrong'}}:result}).catch(()=>{});
    }
    if(path==='/api/workspace/context'){reads.push(path);return route.fulfill({status:readStatus,json:readStatus===200?context:{error:'격리 조회 오류'}});}
    if(path==='/api/workspace/navigation')return route.fulfill({json:{pages:['home.dashboard','home.profile']}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path.startsWith('/api/workspace/avatar/'))return route.fulfill({body:storedImage,contentType:'image/png'});
    if(path==='/settings/profile')return route.fulfill({body:readFileSync(resolve(dir,'profile.edit.html')),contentType:'text/html'});
    const base=resolve(root,'apps/portal/wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://company.workspace.test/settings/profile');await expect(page.locator(form+' input[type=file]')).toBeEnabled();
  return {writes,reads,errors,hold:()=>{hold=true;},release:()=>held?.(),failRead:()=>{readStatus=503;},restoreRead:()=>{readStatus=200;},malformed:()=>{malformed=true;},fail:(code,outcome='unknown')=>{status=code;result={...result,outcome,message:'격리 오류'};},
    switchAccount:async()=>{context={...context,user:{...context.user,id:3,name:'다른 검증 계정'}};await page.evaluate(()=>window.CompanyWorkspace.refresh());}};
}
async function imageFile(page){
  const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const ctx=canvas.getContext('2d');ctx.fillStyle='#9250cc';ctx.fillRect(0,0,400,200);return canvas.toDataURL('image/png').split(',')[1];});
  return {name:'synthetic-profile-photo-with-a-long-name-for-mobile-layout.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
}
async function select(page){
  await page.locator(form+' input[type=file]').setInputFiles(await imageFile(page));
  await expect(page.locator('[data-profile-save]')).toBeEnabled();await expect(page.locator(preview)).toBeVisible();
}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`profile shared form saves normalized image and confirms removal ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{width,theme});
  await assertNativeButtons(page.locator('.cw-profile-actions button'));await select(page);
  await assertNativeButtons(page.locator('.cw-profile-actions button'));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('profile-preview.png'),animations:'disabled',fullPage:true});
  await page.locator('[data-profile-save]').focus();await page.keyboard.press('Enter');
  await expect.poll(()=>f.writes.length).toBe(1);await expect(page.locator(state)).toContainText('프로필 변경을 완료');
  const posted=f.writes[0],image=Buffer.from(await posted.get('Photo').arrayBuffer());
  expect(posted.get('__RequestVerificationToken')).toBeTruthy();expect(posted.get('ExpectedUserId')).toBe(String(initial.user.id));expect(posted.get('ExpectedVersion')).toBe(saved.data.version);
  expect(image.readUInt32BE(16)).toBe(256);expect(image.readUInt32BE(20)).toBe(256);expect(posted.has('Name')).toBe(false);
  await expect(page.locator(preview)).toBeHidden();await expect(page.locator('[data-cw-account] img').first()).toHaveAttribute('src',/v=bbbb/);
  await expect.poll(()=>page.locator('[data-cw-account] img').first().evaluate(img=>img.naturalWidth)).toBe(256);
  expect(await page.evaluate(()=>document.cookie)).toContain('CompanyProfileRevision=');
  await page.locator('[data-profile-remove]').click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  expect(f.writes).toHaveLength(1);await expect(page.locator('[data-profile-remove]')).toBeFocused();
  await page.locator('[data-profile-remove]').click();await page.screenshot({path:info.outputPath('profile-remove-confirm.png'),animations:'disabled'});
  await page.getByRole('dialog').getByRole('button',{name:'기본 사진으로 변경',exact:true}).click();
  await expect.poll(()=>f.writes.length).toBe(2);await expect(page.locator(state)).toContainText('프로필 변경을 완료');
  expect(f.writes[1].get('Operation')).toBe('remove');expect(f.writes[1].has('Photo')).toBe(false);await expect(page.locator('[data-profile-remove]')).toBeDisabled();
  await assertNativeButtons(page.locator('.cw-profile-actions button'));
  await expect(page.locator('[data-cw-account] img')).toHaveCount(0);expect(f.errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
});
test('profile confirmed save locks all controls and refresh failure retries only GET',async({page})=>{
  const f=await fixture(page);await select(page);f.hold();await page.locator('[data-profile-save]').click();await expect.poll(()=>f.writes.length).toBe(1);
  for(const selector of ['input[type=file]','[data-profile-save]','[data-profile-remove]'])await expect(page.locator(form+' '+selector)).toBeDisabled();
  await assertNativeButtons(page.locator('.cw-profile-actions button'));
  f.failRead();f.release();await expect(page.locator(state)).toHaveAttribute('data-state-kind','success');await expect(page.locator(state)).toContainText('조회만');
  f.restoreRead();await page.locator(state).getByRole('button',{name:'현재 사진 다시 확인'}).click();await expect(page.locator('[data-profile-remove]')).toBeEnabled();expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const kind of ['malformed','unknown','conflict','denied'])test(`profile preserves selected image after ${kind} and recovers by reading`,async({page})=>{
  const f=await fixture(page);await select(page);const before=await page.locator(preview).getAttribute('src');
  if(kind==='malformed')f.malformed();else f.fail(kind==='denied'?403:kind==='conflict'?409:500,kind==='conflict'?'conflict':'unknown');
  await page.locator('[data-profile-save]').click();await expect(page.locator(state)).toContainText('현재 사진 다시 확인');
  await expect(page.locator(preview)).toHaveAttribute('src',before);await expect(page.locator('[data-profile-save]')).toBeDisabled();
  await page.locator(state).getByRole('button',{name:'현재 사진 다시 확인'}).click();await expect(page.locator('[data-profile-save]')).toBeEnabled();
  expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('profile account switch during confirmation cannot remove another account photo',async({page})=>{
  const f=await fixture(page);await page.locator('[data-profile-remove]').click();await expect(page.getByRole('dialog')).toBeVisible();await f.switchAccount();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator(state)).toHaveAttribute('data-state-kind','denied');await expect(page.locator('[data-profile-save]')).toBeDisabled();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
for(const event of ['scope','dispose','timeout'])test(`profile late acknowledgement after ${event} is never applied`,async({page})=>{
  await page.clock.install();const f=await fixture(page);await select(page);f.hold();await page.locator('[data-profile-save]').click();await expect.poll(()=>f.writes.length).toBe(1);
  if(event==='scope')await f.switchAccount();else if(event==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));else await page.clock.fastForward(31000);
  const before=await page.locator(state).textContent();f.release();await page.clock.runFor(100);
  expect(await page.locator(state).textContent()).toBe(before);expect(await page.evaluate(()=>document.cookie)).not.toContain('CompanyProfileRevision=');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const event of ['scope','dispose','timeout'])test(`profile delayed bitmap after ${event} is closed without restoring preview`,async({page})=>{
  await page.clock.install();await page.addInitScript(()=>{const original=window.createImageBitmap;window.createImageBitmap=file=>new Promise(resolve=>{window.releaseBitmap=async()=>{const value=await original(file),close=value.close.bind(value);value.close=()=>{window.bitmapClosed=true;close();};resolve(value);};});});
  const f=await fixture(page);await page.locator(form+' input[type=file]').setInputFiles(await imageFile(page));await expect(page.locator(state)).toHaveAttribute('data-state-kind','loading');
  if(event==='scope')await f.switchAccount();else if(event==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));else await page.clock.fastForward(16000);
  const before=await page.locator(state).textContent();await page.evaluate(()=>window.releaseBitmap());await page.clock.runFor(50);
  expect(await page.evaluate(()=>window.bitmapClosed)).toBe(true);await expect(page.locator(preview)).toBeHidden();expect(await page.locator(state).textContent()).toBe(before);
  expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('profile invalid file and failed PNG conversion remain editable without writes',async({page})=>{
  const f=await fixture(page),input=page.locator(form+' input[type=file]');
  for(let i=0;i<2;i++){await input.setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});await expect(page.locator(state)).toHaveAttribute('data-state-kind','error');await expect(input).toBeEnabled();await input.setInputFiles([]);}
  await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=callback=>callback(null);});await input.setInputFiles(await imageFile(page));
  await expect(page.locator(state)).toHaveAttribute('data-state-kind','error');await expect(input).toBeEnabled();await expect(page.locator('[data-profile-save]')).toBeDisabled();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
