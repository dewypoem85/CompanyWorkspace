import {test,expect} from '@playwright/test';
import {assertLeaveControls} from './support/leave-controls.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),state='[data-leave-admin-state]',reason='[name="ForceInput.Reason"]',targetId='9007199254740995';
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.calendar-admin.json'),'utf8')),html=readFileSync(resolve(dir,options.optionalReason?'leave.calendar-admin.optional.html':'leave.calendar-admin.html'),'utf8');let reads=0,release,releaseRead;const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push(sent);
      const operation=url.searchParams.get('handler'),deleting=operation==='AdminForceDelete',target=deleting?JSON.parse(sent.get('displayTarget')):null,date=sent.get('ForceInput.Date'),portion=sent.get('ForceInput.Portion');
      const query=new URLSearchParams();for(const key of ['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage']){const value=!deleting&&key==='Year'?String(Number(date.slice(0,4))):!deleting&&key==='Month'?String(Number(date.slice(5,7))):!deleting&&key==='CalendarView'?'month':sent.get(key);if(value)query.set(key,value);}
      const data={operation,actorEmployeeId:sent.get('expectedEmployeeId'),targetEmployeeId:deleting?target.employeeId:sent.get('ForceInput.EmployeeId'),id:deleting?target.id:'9007199254741009',previousSnapshot:sent.get('expectedSnapshot'),snapshot:deleting?'':'a'.repeat(64),previousStatus:deleting?target.status:null,status:deleting?'deleted':'Approved',reason:(sent.get(deleting?'ForceDeleteReason':'ForceInput.Reason')||'').trim()||'사유 미입력',calculatedDays:deleting?target.calculatedDays:({FullDay:'1',Morning:'0.5',Afternoon:'0.5',특수휴가:'0',기타:'0',Birthday:'0'})[portion],dates:deleting?target.dates:[{date,portion}],navigateTo:'/Leave/Index?'+query};
      if(options.bad==='dates')data.dates=[];else if(options.bad==='filter')data.navigateTo+='&RequestPage=9';else if(options.bad==='other-id')data.id='9007199254740993';else if(options.bad)data[options.bad]='wrong';
      if(options.hold)await new Promise(resolve=>{release=resolve;});
      return route.fulfill({status:options.status||200,contentType:options.html?'text/html':'application/vnd.company.workspace-form+json',body:options.html?'<h1>Proxy error</h1>':JSON.stringify(options.status?{protocol:'workspace-form-v1',outcome:options.status===422?'invalid':options.status===409?'conflict':'unknown',message:'격리된 오류'}:{protocol:'workspace-form-v1',outcome:'saved',message:'처리 완료',data})}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path)){reads++;if(reads>1&&options.holdRead)await new Promise(resolve=>{releaseRead=resolve;});return route.fulfill({status:reads>1?options.readStatus||200:200,body:html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');await page.waitForFunction(()=>window.LeaveAdminCalendar&&document.querySelector('.cw-header'));
  return {model,errors,writes,reads:()=>reads,release:()=>release?.(),releaseRead:()=>releaseRead?.()};
}
const addDialog=page=>page.getByRole('dialog',{name:'연차를 강제로 추가할까요?'}),deleteDialog=page=>page.getByRole('dialog',{name:'신청 전체를 강제 삭제할까요?'});
async function assertDetailFrame(page,width){
  const dialog=page.locator('#dayDetailModal');
  await expect(dialog).toHaveClass(/cw-modal/);await expect(dialog).toHaveJSProperty('open',true);
  expect(await dialog.evaluate(node=>node.parentElement.id)).toBe('calendarArea');
  const geometry=await dialog.evaluate(node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect(),sample=document.createElement('i');node.append(sample);sample.style.color='var(--cw-surface)';const surface=getComputedStyle(sample).color;sample.style.color='var(--cw-text)';const text=getComputedStyle(sample).color;sample.style.color='var(--cw-backdrop)';const backdrop=getComputedStyle(sample).color;sample.remove();return {surface,text,backdrop,background:style.backgroundColor,color:style.color,actualBackdrop:getComputedStyle(node,'::backdrop').backgroundColor,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,overflow:node.scrollWidth-node.clientWidth};});
  expect(geometry.background).toBe(geometry.surface);expect(geometry.color).toBe(geometry.text);expect(geometry.actualBackdrop).toBe(geometry.backdrop);
  expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width+1);expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(1001);expect(geometry.overflow).toBeLessThanOrEqual(1);
}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`calendar detail shared modal preserves keyboard, nested confirmation and drafts ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const trigger=page.locator(`#leaveCalendar td[data-date="${f.model.start}"] [data-day-detail-trigger]`),detail=page.locator('#dayDetailModal');
  await trigger.focus();await page.keyboard.press('Enter');await assertDetailFrame(page,width);await expect(page.locator('#dayDetailTitle')).toBeFocused();
  await page.locator(reason).fill('닫고 다시 열어도 남는 초안 9007199254740993');
  await addReview(page);await expect(addDialog(page)).toBeVisible();await page.keyboard.press('Escape');await expect(detail).toBeVisible();await expect(page.locator('#adminForceAddForm [type=submit]')).toBeFocused();
  await page.screenshot({path:info.outputPath('calendar-owned-detail.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(detail).not.toBeVisible();await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator(reason)).toHaveValue('닫고 다시 열어도 남는 초안 9007199254740993');
  await detail.evaluate(node=>{node.scrollTop=node.scrollHeight;});await expect(detail.locator('[data-close-day-detail]')).toBeInViewport();
  await page.mouse.click(2,2);await expect(detail).not.toBeVisible();await expect(trigger).toBeFocused();await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>document.querySelector('#dayDetailModal').contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#dayDetailModal').contains(document.activeElement))).toBe(true);
  await addReview(page);await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('dialog[open]')).toHaveCount(0);
  await trigger.click();await expect(detail).not.toBeVisible();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('calendar detail replacement releases parent and confirmation without removing retained form nodes',async({page})=>{
  const f=await fixture(page);await open(page,f);await page.locator(reason).fill('교체 전 초안');await addReview(page);await expect(addDialog(page)).toBeVisible();
  await page.locator('#calendarArea').evaluate(area=>area.remove());await expect(page.locator('dialog[open]')).toHaveCount(0);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('calendar detail retains bfcache and guards native close before releasing a departing page',async({page})=>{
  const f=await fixture(page);await open(page,f);await page.locator(reason).fill('화면 이탈 초안');await addReview(page);
  await page.locator('#dayDetailModal').evaluate(node=>node.close());await expect(page.locator('#dayDetailModal')).toHaveJSProperty('open',true);await expect(addDialog(page)).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await expect(page.locator('dialog[open]')).toHaveCount(2);await expect(page.locator(reason)).toHaveValue('화면 이탈 초안');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator(reason)).toHaveValue('화면 이탈 초안');
  await page.locator(`#leaveCalendar td[data-date="${f.model.start}"] [data-day-detail-trigger]`).evaluate(node=>node.click());await expect(page.locator('dialog[open]')).toHaveCount(0);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
async function open(page,f,date=f.model.start){await page.locator(`#leaveCalendar td[data-date="${date}"]`).click();}
async function draftOther(page,f){await page.locator('#openApplyPanel').click();await page.locator('#applyStart').fill(f.model.start);await page.locator('#applyEnd').fill(f.model.start);await page.locator('[name="Input.WorkPlan"]').fill('다른 신청 초안');await page.locator('#cancelApplyPanel').click();}
async function addReview(page){await page.locator('#adminForceAddForm [type=submit]').click();}
async function save(page){await addReview(page);await addDialog(page).getByRole('button',{name:'승인 상태로 추가'}).click();}
async function deleteReview(page,id=targetId){await page.locator(`.force-delete-button[data-request-id="${id}"]`).click();}
async function deleteSave(page){await deleteDialog(page).getByLabel('강제 삭제 사유').fill('잘못된 기록 삭제');await deleteDialog(page).getByRole('button',{name:'신청 전체 삭제',exact:true}).click();}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`admin calendar common review, native fields and draft preservation ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});await draftOther(page,f);await open(page,f);
  const employee=page.locator('[name="ForceInput.EmployeeId"]'),original=await employee.inputValue();
  await employee.press('Space');const picker=page.getByRole('dialog').filter({has:page.getByRole('searchbox')});
  await picker.getByRole('searchbox').fill('ㅌㅅㅌ');await expect(picker.getByRole('option')).toHaveCount(1);
  await picker.getByRole('searchbox').press('Enter');await expect(employee).toHaveValue(original);await expect(employee).toBeFocused();await expect(page.locator('#dayDetailModal')).toBeVisible();expect(f.writes).toHaveLength(0);
  await page.locator(reason).fill('누락 기록 보정');await expect(page.locator('#adminForceDate')).toHaveValue(f.model.start);await assertLeaveControls(page.locator('#adminForceAddForm'));await assertLeaveControls(page.locator('#dayDetailBody'),{fields:false});await page.locator('#adminForceAddForm').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('force-editor.png'),animations:'disabled'});
  await addReview(page);await expect(addDialog(page)).toContainText(f.model.start);await expect(addDialog(page)).toContainText('누락 기록 보정');await page.screenshot({path:info.outputPath('force-add-review.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(page.locator('#adminForceAddForm [type=submit]')).toBeFocused();await expect(page.locator('#dayDetailModal')).toBeVisible();expect(f.writes).toHaveLength(0);
  await save(page);await expect.poll(()=>f.writes.length).toBe(1);await page.locator('#adminForceAddForm').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);f.release();
  await expect(page.locator(state)).toContainText('관리자 연차 처리 결과를 확인했습니다');await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('다른 신청 초안');
  expect(f.writes[0].get('expectedEmployeeId')).toBe(f.model.chip.employeeId);expect(f.writes[0].get('expectedSnapshot')).toBe('');expect(f.writes[0].get('__RequestVerificationToken')).toBeTruthy();expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
});
for(const operation of ['add','delete'])test(`admin ${operation} navigates only after complete acknowledgement`,async({page})=>{
  const f=await fixture(page);await open(page,f);
  if(operation==='add'){await page.locator(reason).fill('누락 기록 보정');await save(page);}else{await deleteReview(page);await expect(deleteDialog(page)).toContainText(f.model.chip.dates[1].date);await deleteSave(page);}
  await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.writes).toHaveLength(1);expect(f.reads()).toBe(2);expect(f.errors).toEqual([]);
});
for(const operation of ['add','delete'])test(`admin ${operation} respects optional reason policy`,async({page})=>{
  const f=await fixture(page,{optionalReason:true});await open(page,f);
  if(operation==='add')await save(page);else{await deleteReview(page);await expect(deleteDialog(page).getByLabel('강제 삭제 사유')).not.toHaveAttribute('required');await deleteDialog(page).getByRole('button',{name:'신청 전체 삭제',exact:true}).click();}
  await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('force add keeps its selected date and draft until explicit reset',async({page})=>{
  const f=await fixture(page);await open(page,f);await page.locator(reason).fill('다른 날 클릭으로 바뀌면 안 됨');await page.keyboard.press('Escape');
  const next=new Date(f.model.start+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);const nextDate=next.toISOString().slice(0,10);await open(page,f,nextDate);
  await expect(page.locator('#adminForceDate')).toHaveValue(f.model.start);await expect(page.locator(reason)).toHaveValue('다른 날 클릭으로 바뀌면 안 됨');
  await page.keyboard.press('Escape');await page.getByRole('link',{name:'다음 달',exact:true}).click();expect(f.reads()).toBe(1);await open(page,f,nextDate);
  await page.getByRole('button',{name:'추가 초안 초기화'}).click();await page.keyboard.press('Escape');await expect(page.locator(reason)).not.toHaveValue('');
  await page.getByRole('button',{name:'추가 초안 초기화'}).click();await page.getByRole('dialog',{name:'강제 추가 초안을 버릴까요?'}).getByRole('button',{name:'초안 버리기',exact:true}).click();
  await expect(page.locator(reason)).toHaveValue('');await expect(page.locator('#adminForceDate')).toHaveValue(nextDate);expect(await page.evaluate(()=>window.LeaveAdminCalendar.hasDraft())).toBe(false);expect(f.errors).toEqual([]);
});
for(const width of [320,1440])for(const theme of ['light','dark'])test(`delete reason shared dialog keeps cancelled draft and full dates ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await open(page,f);await page.locator(reason).fill('추가 초안도 유지');await deleteReview(page);
  await expect(deleteDialog(page)).toContainText(f.model.chip.dates[1].date);await expect(deleteDialog(page).locator('dd').nth(1)).toHaveCSS('white-space','pre-wrap');expect((await deleteDialog(page).boundingBox()).width).toBeLessThanOrEqual(560);await deleteDialog(page).getByLabel('강제 삭제 사유').fill('진행 중 사유');await page.screenshot({path:info.outputPath('force-delete-review.png'),animations:'disabled'});await page.keyboard.press('Escape');
  await expect(page.locator('#forceDeleteReason')).toHaveValue('진행 중 사유');await expect(page.locator(`.force-delete-button[data-request-id="${targetId}"]`)).toBeFocused();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'삭제 사유 이어쓰기'}).click();await expect(deleteDialog(page).getByLabel('강제 삭제 사유')).toHaveValue('진행 중 사유');await deleteSave(page);
  await expect(page.locator(state)).toContainText('관리자 연차 처리 결과를 확인했습니다');await expect(page.locator(reason)).toHaveValue('추가 초안도 유지');await expect(page.locator('#forceDeleteReason')).toHaveValue('');expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
});
test('switching delete target confirms only the old delete draft is discarded',async({page})=>{
  const f=await fixture(page);await open(page,f);await page.locator('#externalScheduleMemo').fill('외부 일정 초안');await deleteReview(page);await deleteDialog(page).getByLabel('강제 삭제 사유').fill('원래 삭제 사유');await page.keyboard.press('Escape');
  await deleteReview(page,'9007199254740993');await expect(page.getByRole('dialog',{name:'강제 삭제 사유를 버릴까요?'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('#forceDeleteReason')).toHaveValue('원래 삭제 사유');
  await deleteReview(page,'9007199254740993');await page.getByRole('dialog',{name:'강제 삭제 사유를 버릴까요?'}).getByRole('button',{name:'초안 버리기',exact:true}).click();await expect(deleteDialog(page)).toContainText('9007199254740993');await deleteSave(page);
  await expect(page.locator(state)).toContainText('처리 결과');await expect(page.locator('#externalScheduleMemo')).toHaveValue('외부 일정 초안');expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const bad of ['operation','actorEmployeeId','targetEmployeeId','id','previousSnapshot','snapshot','previousStatus','status','reason','calculatedDays','dates','navigateTo','filter',403,409,500,'html'])test(`force add rejects incomplete or failed receipt ${bad}`,async({page})=>{
  const f=await fixture(page,typeof bad==='number'?{status:bad}:bad==='html'?{html:true}:{bad});await open(page,f);await page.locator(reason).fill('미확정 초안');await save(page);
  await expect(page.locator('#adminForceAddForm [type=submit]')).toBeDisabled();await expect(page.locator(reason)).toHaveValue('미확정 초안');await expect(page.locator(state)).toBeVisible();expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const bad of ['other-id','previousStatus','snapshot','dates',500])test(`force delete keeps reason after an unconfirmed acknowledgement ${bad}`,async({page})=>{
  const f=await fixture(page,typeof bad==='number'?{status:bad}:{bad});await open(page,f);await deleteReview(page);await deleteSave(page);
  await expect(page.locator('[data-force-resume]')).toBeDisabled();await expect(page.locator('#forceDeleteReason')).toHaveValue('잘못된 기록 삭제');expect(f.reads()).toBe(1);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const end of ['scope','timeout','remove'])test(`force delete ignores late saved acknowledgement after ${end}`,async({page})=>{
  const f=await fixture(page,{hold:true});await open(page,f);await deleteReview(page);if(end==='timeout')await page.clock.install();await deleteSave(page);await expect.poll(()=>f.writes.length).toBe(1);
  if(end==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(end==='timeout')await page.clock.fastForward(31000);
  if(end==='remove')await page.locator('#adminForceDeleteForm').evaluate(form=>form.remove());
  f.release();await expect(page.locator(state)).toBeVisible();expect(f.reads()).toBe(1);if(end!=='remove')await expect(page.locator('#forceDeleteReason')).toHaveValue('잘못된 기록 삭제');expect(f.errors).toEqual([]);
});
test('definite validation error permits corrected input and dynamic clean calendar forms reconnect',async({page})=>{
  const options={status:422},f=await fixture(page,options);await open(page,f);await page.keyboard.press('Escape');await page.getByRole('link',{name:'다음 달',exact:true}).click();await expect.poll(()=>f.reads()).toBe(2);await expect(page.locator('#calendarArea')).not.toHaveClass(/is-loading/);await open(page,f);
  await page.locator(reason).fill('교정할 내용');await save(page);await expect(page.locator(state)).toContainText('격리된 오류');await expect(page.locator('#adminForceAddForm [type=submit]')).toBeEnabled();options.status=0;
  await open(page,f);await page.locator(reason).fill('교정 완료');await save(page);await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});
for(const end of ['scope','dispose','timeout','remove','changed'])test(`force add ignores late acknowledgement after ${end}`,async({page})=>{
  const f=await fixture(page,{hold:true});await open(page,f);await page.locator(reason).fill('반드시 보존');if(end==='timeout')await page.clock.install();await save(page);await expect.poll(()=>f.writes.length).toBe(1);
  if(end==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(end==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(end==='timeout')await page.clock.fastForward(31000);
  if(end==='remove')await page.locator('#adminForceAddForm').evaluate(form=>form.remove());
  if(end==='changed')await page.locator(reason).evaluate(input=>{input.value='전송 중 새 초안';});
  f.release();if(end!=='dispose')await expect(page.locator(state)).toBeVisible();await expect.poll(()=>f.reads()).toBe(1);expect(f.writes).toHaveLength(1);if(end!=='remove')await expect(page.locator(reason)).toHaveValue(end==='changed'?'전송 중 새 초안':'반드시 보존');expect(f.errors).toEqual([]);
});
test('pending force write suppresses other POST flows and warns on document unload',async({page})=>{
  const f=await fixture(page,{hold:true});await draftOther(page,f);await open(page,f);await page.locator(reason).fill('대기 작업');await save(page);await expect.poll(()=>f.writes.length).toBe(1);
  for(const selector of ['#applyForm','[data-leave-self-action]','#externalScheduleForm'])await page.locator(selector).first().evaluate(form=>form.requestSubmit());
  expect(f.writes).toHaveLength(1);expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);f.release();await expect(page.locator(state)).toContainText('처리 결과');expect(f.errors).toEqual([]);
});
test('force confirmations reject changed inputs and scope closes the shared reason dialog',async({page})=>{
  const f=await fixture(page);await open(page,f);await page.locator(reason).fill('추가 확인');await addReview(page);await page.locator(reason).evaluate(input=>{input.value='확인 중 변경';});await addDialog(page).getByRole('button',{name:'승인 상태로 추가'}).click();expect(f.writes).toHaveLength(0);
  await deleteReview(page);await deleteDialog(page).getByLabel('강제 삭제 사유').fill('삭제 확인 중');await page.locator('#adminForceDeleteForm [name="expectedSnapshot"]').evaluate(input=>{input.value='b'.repeat(64);});await deleteDialog(page).getByRole('button',{name:'신청 전체 삭제',exact:true}).click();expect(f.writes).toHaveLength(0);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(deleteDialog(page)).toHaveCount(0);await expect(page.locator('#forceDeleteReason')).toHaveValue('삭제 확인 중');expect(f.errors).toEqual([]);
});
for(const status of [200,500])test(`inflight calendar GET ${status} preserves a late force draft`,async({page})=>{
  const f=await fixture(page,{holdRead:true,readStatus:status});await open(page,f);await page.keyboard.press('Escape');await page.getByRole('link',{name:'다음 달',exact:true}).click();await expect.poll(()=>f.reads()).toBe(2);
  await page.locator(reason).evaluate(input=>{input.value='조회 중 늦은 입력';input.dispatchEvent(new Event('input',{bubbles:true}));});f.releaseRead();await expect(page.locator('#calendarArea')).not.toHaveClass(/is-loading/);await expect(page.locator(reason)).toHaveValue('조회 중 늦은 입력');expect(f.reads()).toBe(2);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
