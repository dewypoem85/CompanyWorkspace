import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const initial=JSON.parse(readFileSync(resolve(dir,'project-icon.context.json'),'utf8'));
const confirmed=JSON.parse(readFileSync(resolve(dir,'project-icon.saved.json'),'utf8'));
const form='[data-project-icon-form]',state='[data-project-icon-status]',preview='[data-project-icon-preview]';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function fixture(page,{width=320,theme='dark'}={}){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  let context=structuredClone(initial),status=200,readStatus=200,hold=false,release=null,bad=null,stored=png;
  const writes=[],reads=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const values=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push({handler:url.searchParams.get('handler'),values});
      if(hold)await new Promise(resolve=>{release=resolve;});
      if(url.searchParams.get('handler')!=='Icon')return route.fulfill({status:422,contentType:media,json:{protocol:'workspace-form-v1',outcome:'invalid',message:'검증용 조직 입력 오류'}}).catch(()=>{});
      const operation=values.get('Operation'),version=operation==='save'?'c'.repeat(32):'',iconUrl=operation==='save'?'/api/workspace/project-icon/1?v='+version:null;
      const result={...confirmed,data:{...confirmed.data,operation,previousVersion:values.get('ExpectedVersion'),version,iconUrl}};
      if(bad==='target')result.data.projectId='2';if(bad==='version'){result.data.version+='\n';result.data.iconUrl+='\n';}
      if(status===200&&!bad){if(iconUrl){context.projectIcons['1']=iconUrl;stored=Buffer.from(await values.get('Photo').arrayBuffer());}else delete context.projectIcons['1'];}
      return route.fulfill({status,contentType:media,json:status===200?result:{protocol:'workspace-form-v1',outcome:status===409?'conflict':status===422?'invalid':'unknown',message:'격리 오류'}}).catch(()=>{});
    }
    if(path==='/api/workspace/context'){reads.push(path);return route.fulfill({status:readStatus,json:readStatus===200?context:{error:'격리 조회 오류'}});}
    if(path==='/api/workspace/navigation')return route.fulfill({json:{pages:['home.dashboard','home.projects']}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path.startsWith('/api/workspace/project-icon/'))return route.fulfill({body:stored,contentType:'image/png'});
    if(path==='/Admin/Organization')return route.fulfill({body:readFileSync(resolve(dir,'project-icon.edit.html')),contentType:'text/html'});
    const base=resolve(root,'apps/portal/wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://company.workspace.test/Admin/Organization?tab=projects&id=1');await expect(page.locator(form+' input[type=file]')).toBeEnabled();
  return {writes,reads,errors,hold:()=>{hold=true;},release:()=>release?.(),fail:code=>{status=code;},bad:value=>{bad=value;},failRead:()=>{readStatus=503;},restoreRead:()=>{readStatus=200;},
    changeScope:async(kind='account')=>{if(kind==='project')context.projects=[];else context.user={...context.user,id:3};await page.evaluate(()=>window.CompanyWorkspace.refresh());}};
}
async function imageFile(page){const bytes=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=200;const ctx=canvas.getContext('2d');ctx.fillStyle='#289a70';ctx.fillRect(0,0,400,200);return canvas.toDataURL('image/png').split(',')[1];});return {name:'synthetic-project-icon-with-long-file-name-for-mobile.png',mimeType:'image/png',buffer:Buffer.from(bytes,'base64')};}
async function select(page){await page.locator(form+' input[type=file]').setInputFiles(await imageFile(page));await expect(page.locator('[data-project-icon-save]')).toBeEnabled();await expect(page.locator(preview)).toBeVisible();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`project icon shared image editor save remove preserves organization draft ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{width,theme});const name=page.locator('[name="Form.Name"]');await name.fill('보존할 프로젝트 이름 초안');await select(page);
  await page.screenshot({path:info.outputPath('icon-preview.png'),animations:'disabled',fullPage:true});
  await page.locator('[data-project-icon-save]').focus();await page.keyboard.press('Enter');await expect(page.locator(state)).toContainText('프로젝트 아이콘 변경을 완료');
  const sent=f.writes[0].values;expect(f.writes[0].handler).toBe('Icon');expect(sent.get('__RequestVerificationToken')).toBeTruthy();
  expect(sent.get('ProjectId')).toBe('1');expect(sent.get('ExpectedUserId')).toBe(String(initial.user.id));expect(sent.get('ExpectedVersion')).toBe(confirmed.data.version);expect(sent.has('Form.Name')).toBe(false);
  const image=Buffer.from(await sent.get('Photo').arrayBuffer());expect(image.readUInt32BE(16)).toBe(256);expect(image.readUInt32BE(20)).toBe(256);
  await expect(name).toHaveValue('보존할 프로젝트 이름 초안');await expect(page.locator('[name="Form.Version"]')).toHaveValue('1');
  await expect(page.locator('[data-company-project="1"] img').first()).toHaveAttribute('src',/v=cccc/);
  await expect.poll(()=>page.locator('[data-company-project="1"] img').first().evaluate(img=>img.naturalWidth)).toBe(256);
  expect(await page.evaluate(()=>document.cookie)).toContain('CompanyProfileRevision=');
  await page.locator('[data-project-icon-remove]').click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  expect(f.writes).toHaveLength(1);await expect(page.locator('[data-project-icon-remove]')).toBeFocused();
  await page.locator('[data-project-icon-remove]').click();await page.screenshot({path:info.outputPath('icon-remove.png'),animations:'disabled'});
  await page.getByRole('dialog').getByRole('button',{name:'기본 사진으로 변경',exact:true}).click();await expect(page.locator('[data-project-icon-remove]')).toBeDisabled();
  await expect.poll(()=>f.writes.length).toBe(2);expect(f.writes[1].values.get('ExpectedVersion')).toBe('c'.repeat(32));expect(f.writes[1].values.has('Photo')).toBe(false);
  await expect(page.locator('[data-company-project="1"] img')).toHaveCount(0);await expect(name).toHaveValue('보존할 프로젝트 이름 초안');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);
});
for(const kind of [409,403,500,'target','version'])test(`project icon uncertain response preserves image and rechecks only GET ${kind}`,async({page})=>{
  const f=await fixture(page);await select(page);const selected=await page.locator(preview).getAttribute('src');if(typeof kind==='number')f.fail(kind);else f.bad(kind);
  await page.locator('[data-project-icon-save]').click();await expect(page.locator(state)).toContainText('현재 사진 다시 확인');await expect(page.locator(preview)).toHaveAttribute('src',selected);
  await expect(page.locator('[data-project-icon-save]')).toBeDisabled();expect(await page.evaluate(()=>document.cookie)).not.toContain('CompanyProfileRevision=');
  await page.locator(state).getByRole('button',{name:'현재 사진 다시 확인'}).click();await expect(page.locator('[data-project-icon-save]')).toBeEnabled();expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('confirmed icon write with failed context reload never resends and keeps other form editable',async({page})=>{
  const f=await fixture(page);await select(page);f.hold();await page.locator('[data-project-icon-save]').click();await expect.poll(()=>f.writes.length).toBe(1);
  for(const selector of ['input[type=file]','[data-project-icon-save]','[data-project-icon-remove]'])await expect(page.locator(form+' '+selector)).toBeDisabled();
  await page.locator(form).evaluate(el=>el.requestSubmit());expect(f.writes).toHaveLength(1);
  f.failRead();f.release();await expect(page.locator(state)).toHaveAttribute('data-state-kind','success');await expect(page.locator(state)).toContainText('조회만');
  f.restoreRead();await page.locator(state).getByRole('button',{name:'현재 사진 다시 확인'}).click();await expect(page.locator('[data-project-icon-remove]')).toBeEnabled();expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const scope of ['account','project'])test(`project icon confirmation closes on ${scope} scope invalidation`,async({page})=>{
  const f=await fixture(page);await page.locator('[data-project-icon-remove]').click();await f.changeScope(scope);
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator(state)).toHaveAttribute('data-state-kind','denied');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
for(const event of ['scope','dispose','timeout'])test(`project icon ignores late acknowledgement after ${event}`,async({page})=>{
  await page.clock.install();const f=await fixture(page);await select(page);f.hold();await page.locator('[data-project-icon-save]').click();await expect.poll(()=>f.writes.length).toBe(1);
  if(event==='scope')await f.changeScope();else if(event==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));else await page.clock.fastForward(31000);
  const before=await page.locator(state).textContent();f.release();await page.clock.runFor(100);expect(await page.locator(state).textContent()).toBe(before);
  expect(await page.evaluate(()=>document.cookie)).not.toContain('CompanyProfileRevision=');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('organization write makes independent icon editor inert and prevents a second mutation',async({page})=>{
  const f=await fixture(page);f.hold();await page.locator('[name="Form.Name"]').fill('프로젝트 수정');await page.locator('[data-organization-form] button[type=submit]').click();
  await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect.poll(()=>f.writes.length).toBe(1);
  await expect(page.locator('[data-cw-project-icon]')).toHaveJSProperty('inert',true);await page.locator(form).evaluate(el=>el.requestSubmit());expect(f.writes).toHaveLength(1);
  f.release();await expect(page.locator('[data-cw-project-icon]')).toHaveJSProperty('inert',false);expect(f.errors).toEqual([]);
});
