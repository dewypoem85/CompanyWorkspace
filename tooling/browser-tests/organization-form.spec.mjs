import {test,expect} from '@playwright/test';
import {assertPortalControls} from './support/portal-controls.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const form='[data-organization-form]',state='[data-organization-result]',submit=form+' button[type=submit]';
const read=file=>readFileSync(resolve(dir,file),'utf8');
async function fixture(page,{tab='departments',edit=false,width=320,theme='dark',recovery=false}={}) {
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const errors=[],writes=[],documents=[];let hold=false,release=null,status=200,malformed=false;
  let context=JSON.parse(read(`organization.${tab}.context.json`));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const fields=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(fields);
      if(hold)await new Promise(resolve=>{release=resolve;});
      const data={...JSON.parse(read(`organization.${tab}.saved.json`)).data,previousId:fields.get('Form.Id'),previousVersion:fields.get('Form.Version'),version:fields.get('Form.Id')?'2':'1'};
      if(malformed)data.userId='wrong';
      return route.fulfill({status,contentType:media,json:{protocol:'workspace-form-v1',outcome:status===200?'saved':status===422?'invalid':status===409?'conflict':'unknown',message:'격리 저장 응답',data}}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:{pages:['home.dashboard','home.departments','home.projects']}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/Organization'){
      documents.push(request.url());
      return route.fulfill({contentType:'text/html',body:read(recovery?'organization.recovery.html':`organization.${tab}.${url.searchParams.has('id')?'edit':'create'}.html`)});
    }
    const base=resolve(root,'apps/portal/wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://company.workspace.test/Admin/Organization?tab='+tab+(edit?'&id=1':''));
  if(recovery)await expect(page.locator(submit)).toBeDisabled();else await expect(page.locator(submit)).toBeEnabled();
  await expect(page.locator('[data-cw-account]')).toBeVisible();
  return {errors,writes,documents,hold:()=>{hold=true;},release:()=>release?.(),fail:code=>{status=code;},malformed:()=>{malformed=true;},
    switchAccount:async()=>{context={...context,user:{...context.user,id:3,name:'다른 검증 계정'}};await page.evaluate(()=>window.CompanyWorkspace.refresh());}};
}
async function save(page){await page.locator(submit).click();await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();}
for(const tab of ['departments','projects'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`organization actual form create and edit confirmed navigation ${tab} ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{tab,width,theme});
  await assertPortalControls(page.locator(form));
  const checkColors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);const token=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};const value={raised:token('raised'),active:token('active')};probe.remove();return value;});
  if(tab==='projects'){const privacy=page.locator('input[type="checkbox"][name="Form.IsPrivate"]'),control=privacy.locator('xpath=..');await expect(privacy).toHaveClass(/\bcw-checkbox\b/);await expect(control).toHaveClass(/\bcw-check-control\b/);expect((await privacy.boundingBox()).width).toBe(18);await expect(control).toHaveCSS('background-color',checkColors.raised);await privacy.check();await expect(control).toHaveCSS('background-color',checkColors.active);await privacy.uncheck();}
  const choices=page.locator('[data-workspace-choices]');if(await choices.count()){await expect(choices).toHaveClass(/\bcw-choice-group\b/);expect((await choices.locator('[data-choice-label] input[type="checkbox"]').first().boundingBox()).width).toBe(18);}
  await page.screenshot({path:info.outputPath('organization-controls.png'),fullPage:true,animations:'disabled'});
  await page.locator('[name="Form.Name"]').fill('새 검증 조직');
  await page.locator(submit).focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({path:info.outputPath('organization-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(page.locator(submit)).toBeFocused();expect(f.writes).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await save(page);await expect(page).toHaveURL(new RegExp('tab='+tab+'&id=1$'));
  expect(f.writes).toHaveLength(1);const sent=f.writes[0];
  expect(sent.get('ExpectedUserId')).toBe(String(JSON.parse(read(`organization.${tab}.context.json`)).user.id));
  expect(sent.get('__RequestVerificationToken')).toBeTruthy();expect(sent.get('Form.Name')).toBe('새 검증 조직');expect(sent.get('Form.Id')).toBe('');
  await page.locator('[name="Form.Name"]').fill('수정 검증 조직');await save(page);
  await expect.poll(()=>f.documents.length).toBe(3);await expect(page.locator(form)).toBeVisible();
  await assertPortalControls(page.locator(form));const archived=page.locator('input[type="checkbox"][name="Form.Archived"]'),archivedControl=archived.locator('xpath=..');await expect(archived).toHaveClass(/\bcw-checkbox\b/);await expect(archivedControl).toHaveClass(/\bcw-check-control\b/);expect((await archived.boundingBox()).width).toBe(18);expect(f.writes).toHaveLength(2);
  expect(f.writes[1].get('Form.Id')).toBe('1');expect(f.writes[1].get('Form.Version')).toBe('1');
  expect(f.errors).toEqual([]);
});
for(const status of [422,409,403,500,'malformed'])test(`organization failure keeps draft and gates repeat writes ${status}`,async({page})=>{
  const f=await fixture(page,{tab:'projects',edit:true});if(status==='malformed')f.malformed();else f.fail(status);
  await page.locator('[name="Form.Name"]').fill('보존할 프로젝트 초안');await save(page);
  await expect(page.locator(state)).toHaveAttribute('data-state-kind',status===403?'denied':'error');
  await expect(page.locator('[name="Form.Name"]')).toHaveValue('보존할 프로젝트 초안');
  await expect(page.locator('[name="Form.Version"]')).toHaveValue('1');expect(f.documents).toHaveLength(1);expect(f.writes).toHaveLength(1);
  if(status===422)await expect(page.locator(submit)).toBeEnabled();else await expect(page.locator(submit)).toBeDisabled();
  expect(f.errors).toEqual([]);
});
for(const phase of ['confirmation','sending','disposed','changed-draft'])test(`organization excludes stale action at ${phase}`,async({page})=>{
  const f=await fixture(page);await page.locator('[name="Form.Name"]').fill('유지할 부서');
  if(phase==='confirmation'){
    await page.locator(submit).click();await expect(page.getByRole('dialog')).toBeVisible();await f.switchAccount();
    await expect(page.getByRole('dialog')).toHaveCount(0);expect(f.writes).toHaveLength(0);
  }else{
    f.hold();await save(page);await expect.poll(()=>f.writes.length).toBe(1);
    await expect(page.locator('[name="Form.Name"]')).toBeDisabled();
    await page.locator(form).evaluate(el=>el.requestSubmit());expect(f.writes).toHaveLength(1);
    if(phase==='sending')await f.switchAccount();
    if(phase==='disposed')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
    if(phase==='changed-draft')await page.locator('[name="Form.Name"]').evaluate(el=>{el.value='프로그램 변경 초안';});
    f.release();
    if(phase==='changed-draft')await expect(page.locator(state)).toHaveAttribute('data-state-kind','error');
    else if(phase==='sending')await expect(page.locator(state)).toHaveAttribute('data-state-kind','denied');
    else await expect(page.locator(form)).not.toHaveAttribute('aria-busy','true');
  }
  await expect(page.locator('[name="Form.Name"]')).toHaveValue(phase==='changed-draft'?'프로그램 변경 초안':'유지할 부서');
  expect(f.documents).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('pending separate project icon cannot be lost by organization navigation',async({page})=>{
  const f=await fixture(page,{tab:'projects',edit:true});
  await page.locator('[data-project-icon-file]').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from('synthetic unsaved file')});
  await page.locator(submit).click();await expect(page.locator(state)).toContainText('아이콘 작업을 먼저');
  expect(f.writes).toHaveLength(0);await expect(page.getByRole('dialog')).toHaveCount(0);
});
for(const width of [320,1440])for(const theme of ['light','dark'])test(`organization HTML recovery preserves unavailable selections ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{tab:'projects',recovery:true,width,theme});
  const draft=page.locator('.organization-posted-draft');
  await expect(draft).toContainText('9999');await expect(draft).toContainText('<script>canary()</script>');
  await expect(page.locator(submit)).toBeDisabled();await expect(page.locator('[name="Form.Version"]')).toHaveValue('0');
  await expect(page.locator(submit)).toHaveCSS('cursor','not-allowed');
  await draft.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('organization-html-recovery.png'),animations:'disabled',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
