import {test,expect} from '@playwright/test';
import {assertLeaveControls} from './support/leave-controls.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json',state='[data-application-state]';
async function fixture(page,options={}) {
  const role=options.admin?'admin':'employee',model=JSON.parse(readFileSync(resolve(dir,`leave.application.${role}.json`),'utf8')),html=readFileSync(resolve(dir,`leave.application.${role}.html`),'utf8');
  const writes=[],errors=[];let reads=0,release;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST') {
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(sent);
      const start=sent.get('Input.StartDate'),portion=sent.get('Input.Portion'),query=new URLSearchParams({Year:String(Number(start.slice(0,4))),Month:String(Number(start.slice(5,7))),CalendarView:'month',SelfOnly:sent.get('SelfOnly'),ShowOthers:sent.get('ShowOthers'),RequestLimit:sent.get('RequestLimit'),RequestPage:'1'});
      if(sent.get('ViewEmployeeId'))query.set('ViewEmployeeId',sent.get('ViewEmployeeId'));
      const data={operation:'Apply',employeeId:sent.get('expectedEmployeeId'),id:'9007199254740993',status:'Pending',input:{startDate:start,endDate:sent.get('Input.EndDate'),portion,reason:sent.get('Input.Reason').trim()||null,workPlan:sent.get('Input.WorkPlan').trim()},dates:[{date:start,portion}],calculatedDays:portion==='FullDay'?'1':portion==='기타'||portion==='Birthday'?'0':'0.5',navigateTo:'/Leave/Index?'+query};
      if(options.bad==='input')data.input.workPlan='different';else if(options.bad==='dates')data.dates=[];else if(options.bad==='filter')data.navigateTo+='&SelfOnly=true';else if(options.bad)data[options.bad]='wrong';
      if(options.hold)await new Promise(resolve=>{release=resolve;});
      return route.fulfill({status:options.status||200,contentType:media,json:options.status?{protocol:'workspace-form-v1',outcome:options.status===422?'invalid':options.status===409?'conflict':'unknown',message:'격리 오류'}:{protocol:'workspace-form-v1',outcome:'saved',message:'신청 등록',data}}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path)){reads++;return route.fulfill({body:html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');await page.waitForFunction(()=>window.CompanyForm&&document.querySelector('.cw-header'));
  await page.locator('#openApplyPanel').click();await page.locator('#applyStart').fill(model.start);await page.locator('#applyEnd').fill(model.start);await page.locator('[name="Input.Reason"]').fill('  휴가 사유  ');await page.locator('[name="Input.WorkPlan"]').fill('  업무 인수인계  ');
  return {writes,errors,reads:()=>reads,release:()=>release?.(),model};
}
async function send(page){await page.locator('#applyForm button[type=submit]').click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'신청하기',exact:true}).click();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`application confirmation and pending receipt ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});const submit=page.locator('#applyForm button[type=submit]');
  await page.locator('#cancelApplyPanel').click();await page.locator('#openApplyPanel').click();await expect(page.locator('#applyStart')).toHaveValue(f.model.start);await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('  업무 인수인계  ');
  await assertLeaveControls(page.locator('#applyForm'));await expect(page.locator('[name="Input.WorkPlan"]')).toHaveAttribute('maxlength','2000');await expect(page.locator('[name="Input.WorkPlan"]')).toHaveAttribute('required','');
  await page.locator('#applyPanel').evaluate(node=>window.scrollTo({top:node.getBoundingClientRect().top+window.scrollY-document.querySelector('.cw-header').getBoundingClientRect().height-12,behavior:'instant'}));
  await page.screenshot({path:info.outputPath('application-viewport.png'),animations:'disabled'});
  await page.screenshot({path:info.outputPath('application.png'),animations:'disabled',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await submit.click();await page.screenshot({path:info.outputPath('application-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(submit).toBeFocused();expect(f.writes).toHaveLength(0);
  await send(page);await expect.poll(()=>f.writes.length).toBe(1);await expect(submit).toBeDisabled();await assertLeaveControls(page.locator('#applyForm'));await page.locator('#applyForm').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  expect(f.writes[0].get('__RequestVerificationToken')).toBeTruthy();expect(f.writes[0].get('expectedEmployeeId')).toBeTruthy();f.release();await expect(page).toHaveURL(/\/Leave\/Index\?.*RequestPage=1/);await page.waitForLoadState('domcontentloaded');expect(f.reads()).toBe(2);expect(f.errors).toEqual([]);
});
test('application does not erase another POST editor draft',async({page})=>{
  const f=await fixture(page,{admin:true});await page.locator('[name="ForceInput.Reason"]').evaluate(input=>{input.value='다른 편집 초안';input.dispatchEvent(new Event('input',{bubbles:true}));});await send(page);await expect(page.locator(state)).toContainText('연차 신청을 등록했습니다.');await expect(page.locator('[name="ForceInput.Reason"]')).toHaveValue('다른 편집 초안');expect(f.reads()).toBe(1);await expect(page.locator('[data-application-recheck]')).toHaveAttribute('href',/RequestPage=1/);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const failure of [403,409,500,'employeeId','id','input','dates','calculatedDays','navigateTo','filter'])test(`application unconfirmed receipt preserves draft and blocks repeat ${failure}`,async({page})=>{
  const f=await fixture(page,typeof failure==='number'?{status:failure}:{bad:failure});await send(page);await expect(page.locator(state)).toContainText(failure===403?'저장 권한이 없습니다.':failure===409?'충돌했습니다.':'저장 결과를 확인하지 못했습니다.');await expect(page.locator('#applyForm')).not.toHaveAttribute('aria-busy','true');await expect(page.locator('#applyForm button[type=submit]')).toBeDisabled();await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('  업무 인수인계  ');expect(f.writes).toHaveLength(1);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('application definite rejection allows correction',async({page})=>{
  const f=await fixture(page,{status:422});await send(page);await expect(page.locator(state)).toContainText('입력 내용을 확인');await expect(page.locator('#applyForm button[type=submit]')).toBeEnabled();await page.locator('[name="Input.WorkPlan"]').fill('변경 기록');await send(page);await expect.poll(()=>f.writes.length).toBe(2);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
for(const kind of ['scope','dispose','timeout'])test(`application ignores late acknowledgement after ${kind}`,async({page})=>{
  if(kind==='timeout')await page.clock.install();const f=await fixture(page,{hold:true});await send(page);await expect.poll(()=>f.writes.length).toBe(1);
  if(kind==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));else if(kind==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));else await page.clock.fastForward(31000);
  f.release();await expect(page.locator('#applyForm button[type=submit]')).toBeDisabled();expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
