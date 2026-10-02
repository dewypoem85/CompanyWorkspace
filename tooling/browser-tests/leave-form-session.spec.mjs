import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),approved='9007199254740995',pending='9007199254740993';
const state={apply:'[data-application-state]',admin:'[data-leave-admin-state]',external:'[data-leave-external-state]',self:'[data-leave-self-state]'};
const success={apply:'연차 신청을 등록했습니다',admin:'관리자 연차 처리 결과를 확인했습니다',external:'외부 일정 처리 결과를 확인했습니다',self:'신청 처리 결과를 확인했습니다'};
function receipt(operation,sent,index){
  const query=new URLSearchParams();for(const key of ['Year','Month','CalendarView','SelfOnly','ShowOthers','ViewEmployeeId','RequestLimit','RequestPage']){const value=sent.get(key);if(value)query.set(key,value);}
  const newId=String(9007199254741000n+BigInt(index)),hash='abcdef'[index%6].repeat(64);
  const month=date=>{query.set('Year',String(Number(date.slice(0,4))));query.set('Month',String(Number(date.slice(5,7))));query.set('CalendarView','month');};
  let data;
  if(operation==='Apply'){
    const startDate=sent.get('Input.StartDate'),endDate=sent.get('Input.EndDate'),portion=sent.get('Input.Portion');month(startDate);query.set('RequestPage','1');
    data={operation,employeeId:sent.get('expectedEmployeeId'),id:newId,status:'Pending',input:{startDate,endDate,portion,reason:sent.get('Input.Reason')?.trim()||null,workPlan:sent.get('Input.WorkPlan').trim()},calculatedDays:portion==='FullDay'?'1':portion==='기타'||portion==='Birthday'?'0':'0.5',dates:[{date:startDate,portion}]};
  }else if(['Cancel','WithdrawCancel'].includes(operation)){
    const prior=sent.get('expectedStatus');data={operation,employeeId:sent.get('expectedEmployeeId'),id:sent.get('id'),previousSnapshot:sent.get('expectedSnapshot'),previousStatus:prior,status:operation==='WithdrawCancel'?'Approved':prior==='Pending'?'Cancelled':'CancelRequested'};
  }else if(operation.startsWith('ExternalSchedule')){
    const deleting=operation==='ExternalScheduleDelete',id=sent.get(deleting?'id':'ExternalInput.Id'),input=deleting?JSON.parse(sent.get('displayInput')):Object.fromEntries(Object.entries({employeeId:'EmployeeId',startDate:'StartDate',endDate:'EndDate',category:'Category',memo:'Memo'}).map(([key,field])=>[key,sent.get('ExternalInput.'+field)]));input.category=input.category.trim();input.memo=input.memo.trim();month(input.startDate);
    data={operation,mode:deleting?'delete':id?'update':'create',actorEmployeeId:sent.get('expectedEmployeeId'),id:id||newId,previousSnapshot:sent.get('expectedSnapshot'),snapshot:deleting?'':hash,input};
  }else{
    const deleting=operation==='AdminForceDelete',target=deleting?JSON.parse(sent.get('displayTarget')):null,date=sent.get('ForceInput.Date'),portion=sent.get('ForceInput.Portion');if(!deleting)month(date);
    data={operation,actorEmployeeId:sent.get('expectedEmployeeId'),targetEmployeeId:deleting?target.employeeId:sent.get('ForceInput.EmployeeId'),id:deleting?target.id:newId,previousSnapshot:sent.get('expectedSnapshot'),snapshot:deleting?'':hash,previousStatus:deleting?target.status:null,status:deleting?'deleted':'Approved',reason:sent.get(deleting?'ForceDeleteReason':'ForceInput.Reason').trim()||'사유 미입력',calculatedDays:deleting?target.calculatedDays:portion==='FullDay'?'1':'0.5',dates:deleting?target.dates:[{date,portion}]};
  }
  return {...data,navigateTo:'/Leave/Index?'+query};
}
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.calendar-admin.json'),'utf8')),html=readFileSync(resolve(dir,'leave.calendar-admin.html'),'utf8'),writes=[],errors=[];let reads=0,release,releaseRead;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData(),operation=url.searchParams.get('handler');writes.push({sent,operation});
      const index=writes.length,data=receipt(operation,sent,index);
      if(options.hold===index)await new Promise(resolve=>{release=resolve;});
      const failed=options.fail===index,invalid=options.invalid===index;return route.fulfill({status:failed?500:invalid?422:200,contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome:failed?'unknown':invalid?'invalid':'saved',message:failed||invalid?'격리 오류':'저장 확인',data})}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path)){reads++;if(reads>1&&options.holdRead)await new Promise(resolve=>{releaseRead=resolve;});return route.fulfill({status:reads>1?options.readStatus||200:200,body:html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');await page.waitForFunction(()=>window.LeaveAdminCalendar&&document.querySelector('.cw-header'));
  return {model,writes,errors,reads:()=>reads,release:()=>release?.(),releaseRead:()=>releaseRead?.()};
}
async function open(page,f){await page.locator(`#leaveCalendar td[data-date="${f.model.start}"]`).click();}
async function drafts(page,f){
  await page.locator('#openApplyPanel').click();await page.locator('#applyStart').fill(f.model.start);await page.locator('#applyEnd').fill(f.model.start);await page.locator('[name="Input.WorkPlan"]').fill('신청 초안');await page.locator('#cancelApplyPanel').click();
  await open(page,f);await page.locator('[name="ForceInput.Reason"]').fill('추가 초안');await page.locator('#externalScheduleMemo').fill('외부 초안');await page.keyboard.press('Escape');
}
async function submit(page,f,kind,id=approved){
  if(kind==='apply'){
    await page.locator('#openApplyPanel').click();await page.locator('#applyForm [type=submit]').click();await page.getByRole('dialog',{name:'연차를 신청할까요?'}).getByRole('button',{name:'신청하기',exact:true}).click();
  }else if(kind==='self'){
    const form=page.locator(`#leaveRequestsArea [data-leave-self-action]:has(input[name=id][value="${id}"])`).first();await form.locator('button').click();await page.getByRole('dialog').getByRole('button',{name:id===pending?'신청 취소':'취소 요청',exact:true}).click();
  }else{
    await open(page,f);
    if(kind==='admin'){await page.locator('#adminForceAddForm [type=submit]').click();await page.getByRole('dialog',{name:'연차를 강제로 추가할까요?'}).getByRole('button',{name:'승인 상태로 추가'}).click();}
    else if(kind==='delete'){await page.locator(`.force-delete-button[data-request-id="${id}"]`).click();const dialog=page.getByRole('dialog',{name:'신청 전체를 강제 삭제할까요?'});await dialog.getByLabel('강제 삭제 사유').fill('삭제 초안');await dialog.getByRole('button',{name:'신청 전체 삭제',exact:true}).click();}
    else{await page.locator('#externalScheduleSubmit').click();await page.getByRole('dialog',{name:/^외부 일정을 (추가|수정)할까요\?$/}).getByRole('button',{name:/^(추가|수정 저장)$/}).click();}
  }
}
for(const order of [['admin','external','apply'],['admin','apply','external'],['apply','external','admin'],['apply','admin','external'],['external','admin','apply'],['external','apply','admin']])for(const theme of ['light','dark'])test(`independent drafts save in sequence ${order.join('-')} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width:theme==='dark'?320:1440,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await drafts(page,f);
  for(let index=0;index<order.length;index++){
    await submit(page,f,order[index]);await expect.poll(()=>f.writes.length).toBe(index+1);
    if(index<order.length-1){await expect(page.locator(state[order[index]])).toContainText(success[order[index]]);expect(f.reads()).toBe(1);expect(await page.evaluate(()=>window.LeaveFormSession.invalid)).toBe(false);await expect.poll(()=>page.evaluate(()=>window.LeaveFormSession.pending)).toBe(false);}
    if(index===0)await page.screenshot({path:info.outputPath('continue-other-drafts.png'),animations:'disabled'});
  }
  await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.reads()).toBe(2);expect(f.writes.every(write=>write.sent.get('__RequestVerificationToken'))).toBe(true);expect(f.errors).toEqual([]);
});
test('delete and add in one editor continue independently; stale same-request actions stay disabled',async({page})=>{
  const f=await fixture(page);await drafts(page,f);await submit(page,f,'delete');await expect(page.locator(state.admin)).toContainText(success.admin);
  await open(page,f);await expect(page.locator(`.force-delete-button[data-request-id="${approved}"]`)).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator(`#leaveRequestsArea [data-leave-self-action]:has(input[name=id][value="${approved}"]) button`)).toBeDisabled();
  await submit(page,f,'admin');await expect.poll(()=>f.writes.length).toBe(2);await expect(page.locator(state.admin)).toContainText(success.admin);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('confirmed external create becomes a versioned editor, not a second create',async({page})=>{
  const f=await fixture(page);await drafts(page,f);await submit(page,f,'external');await expect(page.locator(state.external)).toContainText(success.external);
  const createdId=receipt(f.writes[0].operation,f.writes[0].sent,1).id;await open(page,f);await expect(page.locator('#externalScheduleSubmit')).toBeDisabled();await page.locator('#externalScheduleMemo').fill('저장 이후 추가 수정');await page.keyboard.press('Escape');
  await submit(page,f,'external');await expect.poll(()=>f.writes.length).toBe(2);await expect(page.locator(state.external)).toContainText(success.external);
  expect(f.writes[1].sent.get('ExternalInput.Id')).toBe(createdId);expect(f.writes[1].sent.get('expectedSnapshot')).toBe('b'.repeat(64));expect(f.writes[1].sent.get('ExternalInput.Memo')).toBe('저장 이후 추가 수정');expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('an unknown second write locks other drafts even after a confirmed first write',async({page})=>{
  const f=await fixture(page,{fail:2});await drafts(page,f);await submit(page,f,'admin');await expect(page.locator(state.admin)).toContainText(success.admin);await submit(page,f,'external');await expect(page.locator(state.external)).toContainText('저장 결과를 확인하지 못했습니다');
  await expect(page.locator('#applyForm [type=submit]')).toBeDisabled();await page.locator('#applyForm').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(2);await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('신청 초안');expect(await page.evaluate(()=>window.LeaveFormSession.invalid)).toBe(true);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('a second in-flight write warns on unload and rejects a late result after scope change',async({page})=>{
  const f=await fixture(page,{hold:2});await drafts(page,f);await submit(page,f,'admin');await expect(page.locator(state.admin)).toContainText(success.admin);await submit(page,f,'external');await expect.poll(()=>f.writes.length).toBe(2);
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));f.release();await expect(page.locator(state.external)).toContainText('권한이 바뀌었습니다');await expect(page.locator('#applyForm [type=submit]')).toBeDisabled();expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('cancelling one request permits another but retires the same request in both calendar action paths',async({page})=>{
  const f=await fixture(page);await drafts(page,f);await submit(page,f,'self',pending);await expect(page.locator(state.self)).toContainText(success.self);
  await submit(page,f,'self',approved);await expect.poll(()=>f.writes.length).toBe(2);await expect(page.locator(state.self)).toContainText(success.self);
  await open(page,f);await expect(page.locator(`.force-delete-button[data-request-id="${approved}"]`)).toBeDisabled();await page.locator('.force-delete-button[data-request-id="'+approved+'"]').evaluate(button=>window.LeaveAdminCalendar.remove(button));expect(f.writes).toHaveLength(2);
  await page.keyboard.press('Escape');await submit(page,f,'external');await expect.poll(()=>f.writes.length).toBe(3);await expect(page.locator(state.external)).toContainText(success.external);expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
test('a definite rejection on the second write keeps its draft while another form can still save',async({page})=>{
  const f=await fixture(page,{invalid:2});await drafts(page,f);await submit(page,f,'admin');await expect(page.locator(state.admin)).toContainText(success.admin);await submit(page,f,'external');await expect(page.locator(state.external)).toContainText('입력 내용을 확인해 주세요');expect(await page.evaluate(()=>window.LeaveFormSession.invalid)).toBe(false);
  await submit(page,f,'apply');await expect(page.locator(state.apply)).toContainText(success.apply);await open(page,f);await page.locator('#externalScheduleMemo').fill('수정한 외부 초안');await page.keyboard.press('Escape');await submit(page,f,'external');await expect(page).toHaveURL(/\/Leave\/Index\?/);expect(f.writes).toHaveLength(4);expect(f.reads()).toBe(2);expect(f.errors).toEqual([]);
});
test('saved force input cannot repeat unchanged but a new explicit reset can start a new intent',async({page})=>{
  const f=await fixture(page);await drafts(page,f);await submit(page,f,'admin');await expect(page.locator(state.admin)).toContainText(success.admin);await open(page,f);await expect(page.locator('#adminForceAddForm [type=submit]')).toBeDisabled();await page.locator('#adminForceAddForm').evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(1);
  await page.getByRole('button',{name:'추가 초안 초기화'}).click();await page.locator('[name="ForceInput.Reason"]').fill('별도 보정');await page.keyboard.press('Escape');await submit(page,f,'admin');await expect.poll(()=>f.writes.length).toBe(2);await expect(page.locator(state.admin)).toContainText(success.admin);expect(f.writes[1].sent.get('ForceInput.Reason')).toBe('별도 보정');expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
for(const area of ['calendarArea','leaveRequestsArea'])for(const status of [200,500])test(`older ${area} GET ${status} cannot overwrite or redirect after a confirmed write`,async({page})=>{
  const f=await fixture(page,{holdRead:true,readStatus:status});await page.locator('#'+area).evaluate(node=>{node.dataset.identity='original';});
  if(area==='calendarArea')await page.getByRole('link',{name:'다음 달',exact:true}).click();else await page.locator('#leaveRequestListForm select[name=RequestLimit]').selectOption('20');
  await expect.poll(()=>f.reads()).toBe(2);
  await page.evaluate(start=>{const apply=document.getElementById('applyForm');apply.elements.namedItem('Input.StartDate').value=start;apply.elements.namedItem('Input.EndDate').value=start;apply.elements.namedItem('Input.WorkPlan').value='늦은 조회 중 작성한 초안';const add=document.getElementById('adminForceAddForm');add.elements.namedItem('ForceInput.Date').value=start;add.elements.namedItem('ForceInput.Reason').value='조회 이후 보정';add.requestSubmit();},f.model.start);
  await page.getByRole('dialog',{name:'연차를 강제로 추가할까요?'}).getByRole('button',{name:'승인 상태로 추가'}).click();await expect(page.locator(state.admin)).toContainText(success.admin);await expect.poll(()=>page.evaluate(()=>window.LeaveFormSession.pending)).toBe(false);
  f.releaseRead();await expect(page.locator('#'+area)).not.toHaveClass(/is-loading/);await expect(page.locator('#'+area)).toHaveAttribute('data-identity','original');await expect(page.locator('[name="Input.WorkPlan"]')).toHaveValue('늦은 조회 중 작성한 초안');expect(f.reads()).toBe(2);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
