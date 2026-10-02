import {test,expect} from '@playwright/test';
import {assertNativeButtons} from './support/native-buttons.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json',form='[data-settlement-form]',state='[data-settlement-state]';
async function fixture(page,options={}) {
  const model=JSON.parse(readFileSync(resolve(dir,'leave.settlements.json'),'utf8')),html=readFileSync(resolve(dir,options.optional?'leave.settlements.optional.html':'leave.settlements.html'),'utf8');
  const writes=[],errors=[];let reads=0,release;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(sent);
      const data={operation:'Settle',actorEmployeeId:model.actor,employeeId:model.employee,grantId:sent.get('grantId'),id:'9007199254740999',previousSnapshot:sent.get('expectedSnapshot'),type:sent.get('type'),days:String(Number(sent.get('days'))),note:sent.get('note').trim()||'사유 미입력',processedDate:model.today,createdGrantId:sent.get('type')==='CarryOver'?'9007199254740997':null,navigateTo:'/Admin/Settlements'};
      if(options.bad)data[options.bad]='wrong';
      if(options.hold)await new Promise(done=>{release=done;});
      const status=options.status||200;
      return route.fulfill({status,contentType:options.html?'text/html':media,json:options.html?undefined:status===200?{protocol:'workspace-form-v1',outcome:'saved',message:'정산 완료',data}:{protocol:'workspace-form-v1',outcome:status===422?'invalid':status===409?'conflict':'unknown',message:'격리된 정산 오류'},body:options.html?'<h1>로그인</h1>':undefined}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/Settlements'){reads++;return route.fulfill({body:html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/Settlements');
  await page.waitForFunction(()=>window.CompanyForm&&document.querySelector('.cw-header')&&document.querySelector('[name=expectedSnapshot]')?.value);
  await page.locator('#settlementEmployee').selectOption(model.employee);await page.locator('[name=grantId]').selectOption(model.grant);
  await page.locator('[name=days]').fill('1.50');if(!options.optional)await page.locator('[name=note]').fill('  연말 정산  ');
  return {model,writes,errors,release:()=>release?.(),reads:()=>reads};
}
const confirm=page=>page.getByRole('dialog',{name:'연차 정산을 처리할까요?'});
async function submit(page){await page.locator(form+' button[type=submit]').click();await expect(confirm(page)).toBeVisible();await confirm(page).getByRole('button',{name:'정산 처리',exact:true}).click();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`settlement common search confirmation receipt ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});
  await page.locator('#settlementEmployee').click();const picker=page.getByRole('dialog',{name:'직원 검색',exact:true});await expect(picker).toBeVisible();await picker.getByRole('searchbox').fill('ㅇㅂㅇㅈ');await expect(picker.getByRole('option')).toHaveCount(1);await expect(picker.locator('.cw-entity-avatar')).toHaveCount(1);await picker.getByRole('option').click();
  await page.locator('[name=type]').selectOption('CarryOver');await page.locator(form+' button[type=submit]').click();await expect(confirm(page)).toContainText('1.5일');await expect(confirm(page)).toContainText('연말 정산');await expect(confirm(page)).toContainText('외부 일정 검증 직원');
  await page.screenshot({path:info.outputPath('settlement-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(page.locator(form+' button[type=submit]')).toBeFocused();expect(f.writes).toHaveLength(0);
  await submit(page);await expect.poll(()=>f.writes.length).toBe(1);expect(f.writes[0].get('__RequestVerificationToken')).toBeTruthy();expect(f.writes[0].get('grantId')).toBe(f.model.grant);expect(f.writes[0].get('expectedEmployeeId')).toBe(f.model.actor);expect(f.writes[0].get('expectedSnapshot')).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('[name=days]')).toBeDisabled();await page.locator(form).evaluate(node=>node.requestSubmit());expect(f.writes).toHaveLength(1);f.release();
  await expect(page.locator(state)).toContainText('처리 결과를 확인했습니다.');await expect(page.locator('[name=note]')).toHaveValue('  연말 정산  ');await expect(page.locator(form+' button[type=submit]')).toBeDisabled();expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);await page.screenshot({path:info.outputPath('settlement-saved.png'),animations:'disabled'});
});
for(const type of ['Expiration','CarryOver','Compensation'])test(`settlement exact ${type} acknowledgement`,async({page})=>{const f=await fixture(page);await page.locator('[name=type]').selectOption(type);await submit(page);await expect(page.locator(state)).toContainText('정산 처리 결과를 확인했습니다.');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);});
test('settlement optional reason follows actual server policy',async({page})=>{const f=await fixture(page,{optional:true});await submit(page);await expect(page.locator(state)).toContainText('정산 처리 결과를 확인했습니다.');expect(f.writes[0].get('note')).toBe('');expect(f.errors).toEqual([]);});
for(const bad of ['operation','actorEmployeeId','employeeId','grantId','id','previousSnapshot','type','days','note','processedDate','createdGrantId','navigateTo'])test(`settlement rejects mismatched ${bad}`,async({page})=>{
  const f=await fixture(page,{bad});await submit(page);await expect(page.locator(state)).toContainText('저장 결과를 확인하지 못했습니다.');await expect(page.locator(form+' button[type=submit]')).toBeDisabled();await expect(page.locator('[name=days]')).toHaveValue('1.50');expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const status of [403,409,500])test(`settlement uncertain or denied response ${status}`,async({page})=>{const f=await fixture(page,{status});await submit(page);await expect(page.locator('[data-settlement-recheck]')).toBeVisible();await expect(page.locator(form+' button[type=submit]')).toBeDisabled();expect(f.writes).toHaveLength(1);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);});
test('settlement HTML response cannot be treated as success',async({page})=>{const f=await fixture(page,{html:true});await submit(page);await expect(page.locator(state)).toContainText('저장 결과를 확인하지 못했습니다.');await expect(page.locator('[name=days]')).toBeDisabled();expect(f.errors).toEqual([]);});
test('settlement definite validation failure allows corrected input',async({page})=>{const f=await fixture(page,{status:422});await submit(page);await expect(page.locator(state)).toContainText('입력 내용을 확인해 주세요.');await expect(page.locator('[name=days]')).toBeEnabled();await page.locator('[name=days]').fill('0.5');await submit(page);await expect.poll(()=>f.writes.length).toBe(2);expect(f.writes[1].get('days')).toBe('0.5');expect(f.errors).toEqual([]);});
for(const action of ['scope','dispose','timeout','remove'])test(`settlement ignores late response after ${action}`,async({page})=>{
  if(action==='timeout')await page.clock.install();const f=await fixture(page,{hold:true});await submit(page);await expect.poll(()=>f.writes.length).toBe(1);
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  if(action==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  else if(action==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  else if(action==='remove')await page.locator(form).evaluate(node=>node.remove());else await page.clock.fastForward(31000);
  f.release();await expect(page.locator(state)).not.toContainText('정산 처리 결과를 확인했습니다.');if(action!=='remove')await expect(page.locator('[name=days]')).toBeDisabled();expect(f.writes).toHaveLength(1);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('settlement modified confirmation intent never posts',async({page})=>{const f=await fixture(page);await page.locator(form+' button[type=submit]').click();await expect(confirm(page)).toBeVisible();await page.locator('[name=days]').evaluate(node=>node.value='2');await confirm(page).getByRole('button',{name:'정산 처리',exact:true}).click();await expect(confirm(page)).toHaveCount(0);expect(f.writes).toHaveLength(0);await expect(page.locator('[name=days]')).toBeEnabled();expect(f.errors).toEqual([]);});
for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared native field geometry and tokens ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const input=page.locator('[name=days]');await input.focus();
  await assertNativeButtons(page.locator('[data-settlement-form] button'));
  const styles=await input.evaluate(node=>{
    const probe=document.createElement('span');document.body.append(probe);const color=name=>{probe.style.color=`var(${name})`;return getComputedStyle(probe).color;};
    const style=getComputedStyle(node),amount=node.getBoundingClientRect(),type=node.form.elements.type.getBoundingClientRect();
    // Fieldset's anonymous content grid may keep repeat()/minmax() in computedStyle: assert actual geometry.
    const result={background:style.backgroundColor,raised:color('--cw-raised'),foreground:style.color,text:color('--cw-text'),border:style.borderColor,line:color('--cw-line'),outline:style.outlineColor,accent:color('--cw-accent'),radius:style.borderRadius,height:amount.height,amount:{x:amount.x,y:amount.y,width:amount.width},type:{x:type.x,y:type.y,width:type.width}};probe.remove();return result;
  });
  expect(styles.background).toBe(styles.raised);expect(styles.foreground).toBe(styles.text);expect(styles.border).toBe(styles.line);expect(styles.outline).toBe(styles.accent);expect(styles.radius).toBe('8px');expect(styles.height).toBeGreaterThanOrEqual(44);
  expect(styles.amount.width).toBeCloseTo(styles.type.width,0);
  if(width===320){expect(styles.amount.x).toBe(styles.type.x);expect(styles.amount.y).toBeGreaterThan(styles.type.y);}else{expect(styles.amount.y).toBe(styles.type.y);expect(styles.amount.x).toBeGreaterThan(styles.type.x);}
  await input.fill('0.25');expect(await input.evaluate(node=>node.checkValidity())).toBe(false);await input.fill('0.5');expect(await input.evaluate(node=>node.checkValidity())).toBe(true);expect(f.writes).toHaveLength(0);
  await page.locator('.settlement-history').scrollIntoViewIfNeeded();await expect(page.locator('.settlement-history')).toContainText('기존 정산 검증');await expect(page.locator('.settlement-history [data-company-local-employee]')).toHaveCount(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);await page.screenshot({path:info.outputPath('settlement-history.png'),animations:'disabled'});
});
