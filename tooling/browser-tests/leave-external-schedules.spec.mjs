import {test,expect} from '@playwright/test';
import {assertLeaveControls} from './support/leave-controls.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),id='9007199254740995',second='9007199254740997',state='[data-leave-external-state]';
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.external-schedules.json'),'utf8')),html=readFileSync(resolve(dir,'leave.external-schedules.html'),'utf8');let reads=0,release,releaseRead;const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(sent);
      const operation=url.searchParams.get('handler'),deleting=operation==='ExternalScheduleDelete',input=deleting?JSON.parse(sent.get('displayInput')):Object.fromEntries(Object.entries({employeeId:'EmployeeId',startDate:'StartDate',endDate:'EndDate',category:'Category',memo:'Memo'}).map(([key,field])=>[key,sent.get('ExternalInput.'+field)?.trim()]));
      const target=sent.get(deleting?'id':'ExternalInput.Id'),query=new URLSearchParams({Year:String(Number(input.startDate?.slice(0,4))),Month:String(Number(input.startDate?.slice(5,7))),CalendarView:'month'});
      for(const key of ['SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage'])if(sent.get(key))query.set(key,sent.get(key));
      const data={operation,mode:deleting?'delete':target?'update':'create',actorEmployeeId:sent.get('expectedEmployeeId'),id:target||'9007199254740999',previousSnapshot:sent.get('expectedSnapshot'),snapshot:deleting?'':'a'.repeat(64),input,navigateTo:'/Leave/Index?'+query};
      if(options.bad==='input')data.input={...input,memo:'wrong'};else if(options.bad)data[options.bad]='wrong';
      if(options.hold)await new Promise(resolve=>{release=resolve;});
      return route.fulfill({status:options.status||200,contentType:'application/vnd.company.workspace-form+json',json:options.status?{protocol:'workspace-form-v1',outcome:options.status===422?'invalid':options.status===409?'conflict':'unknown',message:'격리 오류'}:{protocol:'workspace-form-v1',outcome:'saved',message:'저장 완료',data}}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path)){reads++;if(reads>1&&options.holdRead)await new Promise(resolve=>{releaseRead=resolve;});return route.fulfill({status:reads>1?options.readStatus||200:200,body:html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');await page.waitForFunction(()=>window.LeaveExternalSchedule&&document.querySelector('.cw-header'));
  return {model,errors,writes,reads:()=>reads,release:()=>release?.(),releaseRead:()=>releaseRead?.()};
}
const modal=page=>page.getByRole('dialog',{name:/외부 일정을 (추가|수정|삭제)할까요/});
async function open(page,f){await page.locator(`#leaveCalendar td[data-date="${f.model.start}"]`).click();}
async function edit(page,f){await open(page,f);await page.locator(`.external-schedule-edit-button[data-schedule-id="${id}"]`).click();}
async function save(page){await page.locator('#externalScheduleSubmit').click();await modal(page).locator('button').last().click();}
async function draftOther(page,f){await page.locator('#openApplyPanel').click();await page.locator('#applyStart').fill(f.model.start);await page.locator('#applyEnd').fill(f.model.start);await page.locator('[name="Input.WorkPlan"]').fill('다른 신청 초안');await page.locator('#cancelApplyPanel').click();}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`external edit common confirmation and native fields ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});await draftOther(page,f);await edit(page,f);await page.locator('#externalScheduleMemo').fill('수정 메모');await assertLeaveControls(page.locator('#externalScheduleForm'));await assertLeaveControls(page.locator('#dayDetailBody'),{fields:false});await page.screenshot({path:info.outputPath('external-editor.png'),animations:'disabled'});await page.locator('#externalScheduleSubmit').click();
  await expect(modal(page)).toContainText('수정 메모');await expect(modal(page)).toContainText(f.model.start);await page.screenshot({path:info.outputPath('external-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(page.locator('#externalScheduleSubmit')).toBeFocused();await expect(page.locator('#dayDetailModal')).toBeVisible();expect(f.writes).toHaveLength(0);
  await save(page);await expect.poll(()=>f.writes.length).toBe(1);await page.locator('#externalScheduleForm').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);f.release();
  await expect(page.locator(state)).toContainText('처리 결과를 확인했습니다');expect(f.writes[0].get('ExternalInput.Id')).toBe(id);expect(f.writes[0].get('expectedSnapshot')).toBe(f.model.snapshot);expect(f.writes[0].get('__RequestVerificationToken')).toBeTruthy();
  await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('다른 신청 초안');expect(f.reads()).toBe(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);
});
for(const operation of ['create','update','delete'])test(`external ${operation} navigates only after exact confirmation`,async({page})=>{
  const f=await fixture(page);await open(page,f);
  if(operation==='update')await page.locator(`.external-schedule-edit-button[data-schedule-id="${id}"]`).click();
  if(operation==='delete'){await page.locator(`.external-schedule-delete-button[data-schedule-id="${id}"]`).click();await modal(page).locator('button').last().click();}
  else{await page.locator('#externalScheduleMemo').fill('신규 또는 수정');await save(page);}
  await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.writes).toHaveLength(1);expect(f.reads()).toBe(2);expect(f.errors).toEqual([]);
});
test('external draft survives date selection, calendar navigation and delete of another record',async({page})=>{
  const f=await fixture(page);await edit(page,f);await page.locator('#externalScheduleMemo').fill('지워지면 안 되는 초안');
  await page.keyboard.press('Escape');await open(page,f);await expect(page.locator('#externalScheduleMemo')).toHaveValue('지워지면 안 되는 초안');
  await page.keyboard.press('Escape');await page.getByRole('link',{name:'다음 달',exact:true}).click();expect(f.reads()).toBe(1);await open(page,f);
  await page.locator(`.external-schedule-delete-button[data-schedule-id="${second}"]`).click();await modal(page).locator('button').last().click();await expect(page.locator(state)).toContainText('처리 결과');
  await expect(page.locator('#externalScheduleMemo')).toHaveValue('지워지면 안 되는 초안');expect(f.reads()).toBe(1);expect(f.writes[0].get('id')).toBe(second);expect(f.errors).toEqual([]);
});
test('external editor switch and reset discard only with common confirmation',async({page})=>{
  const f=await fixture(page);await edit(page,f);await page.locator('#externalScheduleMemo').fill('첫 초안');await page.locator(`.external-schedule-edit-button[data-schedule-id="${second}"]`).click();
  const confirm=page.getByRole('dialog',{name:'작성 중인 외부 일정 내용을 버릴까요?'});await expect(confirm).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#externalScheduleMemo')).toHaveValue('첫 초안');
  await page.locator('#externalScheduleEditCancel').click();await confirm.getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(page.locator('#externalScheduleMemo')).toHaveValue('');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
for(const failure of [403,409,500,'mode','operation','actorEmployeeId','id','previousSnapshot','snapshot','input','navigateTo'])test(`external rejects incomplete receipt ${failure}`,async({page})=>{
  const f=await fixture(page,typeof failure==='number'?{status:failure}:{bad:failure});await edit(page,f);await page.locator('#externalScheduleMemo').fill('오류 뒤에도 보관');await save(page);
  await expect(page.locator(state)).toContainText(failure===403?'저장 권한':failure===409?'충돌':'저장 결과를 확인하지 못했습니다');await expect(page.locator('#externalScheduleSubmit')).toBeDisabled();await expect(page.locator('#externalScheduleMemo')).toHaveValue('오류 뒤에도 보관');expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('external definite input rejection remains editable and dynamic calendar forms reattach',async({page})=>{
  const f=await fixture(page,{status:422});await page.getByRole('link',{name:'다음 달',exact:true}).click();await expect.poll(()=>f.reads()).toBe(2);await edit(page,f);await save(page);await expect(page.locator(state)).toContainText('입력 내용을 확인');await open(page,f);await expect(page.locator('#externalScheduleSubmit')).toBeEnabled();await page.locator('#externalScheduleMemo').fill('교정');await save(page);await expect.poll(()=>f.writes.length).toBe(2);expect(f.errors).toEqual([]);
});
for(const action of ['scope','dispose','timeout','removed'])test(`external late acknowledgement after ${action} is ignored`,async({page})=>{
  if(action==='timeout')await page.clock.install();const f=await fixture(page,{hold:true});await edit(page,f);await save(page);await expect.poll(()=>f.writes.length).toBe(1);
  if(action==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  else if(action==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  else if(action==='removed')await page.locator('#externalScheduleForm').evaluate(form=>form.remove());
  else await page.clock.fastForward(31000);
  f.release();await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.leaveExternalBusy)).toBe('true');expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('external confirmation rejects modified intent and pending write suppresses other forms',async({page})=>{
  const f=await fixture(page,{hold:true});await draftOther(page,f);await edit(page,f);await page.locator('#externalScheduleSubmit').click();await page.locator('#externalScheduleMemo').evaluate(el=>{el.value='확인 중 변경';});await modal(page).locator('button').last().click();expect(f.writes).toHaveLength(0);
  await save(page);await expect.poll(()=>f.writes.length).toBe(1);await page.locator('#applyForm').evaluate(form=>form.requestSubmit());await page.locator('[data-leave-self-action]').first().evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);f.release();await expect(page.locator(state)).toContainText('처리 결과');expect(f.errors).toEqual([]);
});
for(const status of [200,500])test(`inflight calendar GET ${status} cannot replace or navigate away from external draft`,async({page})=>{
  const f=await fixture(page,{holdRead:true,readStatus:status});await edit(page,f);await page.keyboard.press('Escape');await page.getByRole('link',{name:'다음 달',exact:true}).click();await expect.poll(()=>f.reads()).toBe(2);
  // Loading already suppresses pointer clicks. Also protect a late programmatic/keyboard value change.
  await page.locator('#externalScheduleMemo').evaluate(el=>{el.value='조회 중 작성한 초안';el.dispatchEvent(new Event('input',{bubbles:true}));});f.releaseRead();await expect(page.locator('#calendarArea')).not.toHaveClass(/is-loading/);await open(page,f);await expect(page.locator('#externalScheduleMemo')).toHaveValue('조회 중 작성한 초안');expect(f.reads()).toBe(2);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('scope change dismisses external discard confirmation and preserves draft',async({page})=>{
  const f=await fixture(page);await edit(page,f);await page.locator('#externalScheduleMemo').fill('범위 변경 전 초안');await page.locator('#externalScheduleEditCancel').click();await expect(page.getByRole('dialog',{name:'작성 중인 외부 일정 내용을 버릴까요?'})).toBeVisible();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.getByRole('dialog',{name:'작성 중인 외부 일정 내용을 버릴까요?'})).toHaveCount(0);await expect(page.locator('#externalScheduleMemo')).toHaveValue('범위 변경 전 초안');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('external response cannot overwrite a programmatically changed pending draft',async({page})=>{
  const f=await fixture(page,{hold:true});await edit(page,f);await save(page);await expect.poll(()=>f.writes.length).toBe(1);await page.locator('#externalScheduleMemo').evaluate(el=>{el.value='전송 이후 새 내용';});f.release();await expect(page.locator(state)).toContainText('저장 결과를 확인하지 못했습니다');await expect(page.locator('#externalScheduleMemo')).toHaveValue('전송 이후 새 내용');await expect(page.locator('#externalScheduleSubmit')).toBeDisabled();expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
