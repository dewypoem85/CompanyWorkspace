import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),media='application/vnd.company.workspace-form+json';
const pending='9007199254740993',cancel='9007199254740995',recent='9007199254740997';
const form=(operation,id)=>`[data-approval-form][data-operation="${operation}"]:has(input[name=id][value="${id}"])`;
const state='[data-approval-state]';
async function fixture(page,options={}){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.approvals.json'),'utf8'));let html=readFileSync(resolve(dir,'leave.approvals.html'),'utf8');
  const writes=[],errors=[];let readFailure=false,reads=0,release,summaryRelease,summaryReads=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){
      const data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();const operation=url.searchParams.get('handler');writes.push({data,operation});
      const approve=operation==='ForceDelete'?null:data.get('approve'),status=operation==='ForceDelete'?'deleted':operation==='Decide'?(approve==='true'?'Approved':'Rejected'):(approve==='true'?'Cancelled':'Approved');
      const receipt={protocol:'workspace-form-v1',outcome:'saved',message:'처리를 완료했습니다.',data:{operation,employeeId:data.get('expectedEmployeeId'),id:data.get('id'),approve,previousSnapshot:data.get('expectedSnapshot'),status}};
      if(options.bad)receipt.data[options.bad]='invalid';
      const reply=()=>route.fulfill({status:options.status||200,contentType:media,json:options.status?{protocol:'workspace-form-v1',outcome:options.status===422?'invalid':options.status===409?'conflict':'unknown',message:'격리 오류'}:receipt}).catch(()=>{});
      if(options.hold)await new Promise(resolve=>{release=resolve;});return reply();
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.searchParams.get('handler')==='QueueSummary'){summaryReads++;if(options.holdSummary)await new Promise(resolve=>{summaryRelease=resolve;});return route.fulfill({json:model.summary}).catch(()=>{});}
    if(['/Admin','/Admin/Index'].includes(path)){reads++;return route.fulfill({status:readFailure||200,body:readFailure?'unavailable':html,contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin');await page.waitForFunction(()=>window.CompanyForm&&document.querySelector('.cw-header'));
  return {writes,errors,reads:()=>reads,release:()=>release?.(),failRead:(status=503)=>{readFailure=status;},restoreRead:()=>{readFailure=false;},summaryReads:()=>summaryReads,releaseSummary:()=>summaryRelease?.(),changed:()=>{model.summary.version='9007199254740993';html=html.replace(/data-queue-version="[^"]*"/,'data-queue-version="9007199254740993"');}};
}
async function confirm(page,selector,label){await page.locator(selector).getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:label,exact:true}).click();}
for(const width of [320,1440])for(const theme of ['light','dark'])test(`approval shared confirmation and draft-safe receipt ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{hold:true});
  const countBadge=page.locator('.section-count').first(),countPalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-active-text);background:var(--cw-active)';const s=getComputedStyle(p),result={color:s.color,background:s.backgroundColor};p.remove();return result;});await expect(countBadge).toHaveClass(/\bcw-count-badge\b/);await expect(countBadge).toHaveCSS('color',countPalette.color);await expect(countBadge).toHaveCSS('background-color',countPalette.background);
  const advancePill=page.locator('.advance-badge').first(),pillPalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-warning);background:var(--cw-warning-bg)';const s=getComputedStyle(p),result={color:s.color,background:s.backgroundColor};p.remove();return result;});await expect(advancePill).toHaveClass(/\bcw-state-pill\b/);await expect(advancePill).toHaveAttribute('data-tone','warning');await expect(advancePill).toHaveCSS('color',pillPalette.color);await expect(advancePill).toHaveCSS('background-color',pillPalette.background);
  const reason=page.locator(form('ForceDelete',recent)+' input[name=reason]');await reason.fill('다른 신청의 미저장 사유');
  const button=page.locator(form('Decide',pending)).getByRole('button',{name:'승인',exact:true});await button.click();await expect(page.getByRole('dialog')).toContainText(pending);await page.screenshot({path:info.outputPath('approval-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(button).toBeFocused();expect(f.writes).toHaveLength(0);
  await confirm(page,form('Decide',pending),'승인');await expect.poll(()=>f.writes.length).toBe(1);await expect(page.locator('#adminApprovalQueuesArea')).toHaveJSProperty('inert',true);
  await page.locator(form('CancelDecide',cancel)).evaluate(form=>form.requestSubmit(form.querySelector('button')));expect(f.writes).toHaveLength(1);
  f.release();await expect(page.locator(state)).toContainText('다른 신청의 삭제 사유를 유지');await expect(reason).toHaveValue('다른 신청의 미저장 사유');await expect(button).toBeDisabled();expect(f.reads()).toBe(1);
  expect(await button.evaluate(button=>{const style=getComputedStyle(button),probe=document.createElement('span');probe.style.color='var(--cw-muted)';button.after(probe);const expected=getComputedStyle(probe).color;probe.remove();return style.color===expected;})).toBe(true);
  expect(f.writes[0].data.get('id')).toBe(pending);expect(f.writes[0].data.get('approve')).toBe('true');expect(f.writes[0].data.get('__RequestVerificationToken')).toBeTruthy();expect(f.writes[0].data.get('expectedSnapshot')).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({path:info.outputPath('approval-saved.png'),animations:'disabled',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);
});
for(const [operation,id,label] of [['Decide',pending,'반려'],['CancelDecide',cancel,'취소 승인'],['CancelDecide',cancel,'취소 반려'],['ForceDelete',recent,'강제 삭제']])test(`approval exact operation ${label}`,async({page})=>{
  const f=await fixture(page);if(operation==='ForceDelete')await page.locator(form(operation,id)+' input[name=reason]').fill('검증용 삭제 사유');
  await confirm(page,form(operation,id),label);await expect(page.locator(state)).toContainText('목록과 처리 상태를 갱신');expect(f.writes).toHaveLength(1);expect(f.writes[0].operation).toBe(operation);expect(f.errors).toEqual([]);
});
for(const failure of [403,409,500,'id','employeeId','approve','previousSnapshot','status'])test(`unconfirmed approval blocks repeats and GET recovery ${failure}`,async({page})=>{
  const f=await fixture(page,typeof failure==='number'?{status:failure}:{bad:failure});await confirm(page,form('Decide',pending),'승인');await expect(page.locator(state)).toContainText('처리 결과를 다시 확인');await expect(page.locator(form('CancelDecide',cancel)+' button').first()).toBeDisabled();expect(f.writes).toHaveLength(1);
  await page.locator(state).getByRole('button',{name:'목록 다시 확인'}).click();await expect(page.locator(state)).toContainText('최신 신청 내역을 확인');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('approval success then read failure is not a write failure and recheck only reads',async({page})=>{
  const f=await fixture(page,{hold:true});await confirm(page,form('Decide',pending),'승인');await expect.poll(()=>f.writes.length).toBe(1);f.failRead();f.release();await expect(page.locator(state)).toContainText('처리는 완료했지만 목록을 갱신하지 못했습니다.');await expect(page.locator(form('Decide',pending)+' button').first()).toBeDisabled();f.restoreRead();await page.locator(state).getByRole('button',{name:'목록 다시 확인'}).click();await expect(page.locator(state)).toContainText('최신 신청');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('refresh and polling preserve typed delete reasons until explicit discard',async({page})=>{
  const f=await fixture(page),reason=page.locator(form('ForceDelete',recent)+' input[name=reason]');await reason.fill('보존 사유');await page.evaluate(()=>window.dispatchEvent(new Event('leave:notifications')));expect(f.reads()).toBe(1);await page.locator('[data-approval-refresh]').click();await page.keyboard.press('Escape');await expect(reason).toHaveValue('보존 사유');await page.locator('[data-approval-refresh]').click();await page.getByRole('dialog').getByRole('button',{name:'목록 새로고침'}).click();await expect(reason).toHaveValue('');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('approval definite input error permits correction but refresh denial hides previous account data',async({page})=>{
  const f=await fixture(page,{status:422});await confirm(page,form('Decide',pending),'승인');await expect(page.locator(state)).toContainText('입력 내용을 확인');await expect(page.locator(form('Decide',pending)+' button').first()).toBeEnabled();f.failRead(403);await page.locator('[data-approval-refresh]').click();await expect(page.locator('#adminApprovalQueuesArea')).toBeHidden();await expect(page.locator(state)).toContainText('로그인 상태 또는 권한이 바뀌었습니다.');expect(f.writes).toHaveLength(1);
});
test('queue polling compares exact long versions and rebinds common forms after replacement',async({page})=>{
  const f=await fixture(page);f.changed();await page.evaluate(()=>window.dispatchEvent(new Event('leave:notifications')));await expect(page.locator('#adminApprovalQueuesArea')).toHaveAttribute('data-queue-version','9007199254740993');expect(f.reads()).toBe(2);await confirm(page,form('CancelDecide',cancel),'취소 반려');await expect(page.locator(state)).toContainText('목록과 처리 상태를 갱신');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('background summary cannot swallow an approval click or replace an open confirmation',async({page})=>{
  const f=await fixture(page,{holdSummary:true});f.changed();await page.evaluate(()=>window.dispatchEvent(new Event('leave:notifications')));await expect.poll(()=>f.summaryReads()).toBe(1);await page.locator(form('Decide',pending)).getByRole('button',{name:'승인',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();f.releaseSummary();await expect(page.getByRole('dialog')).toContainText(pending);expect(f.reads()).toBe(1);await page.keyboard.press('Escape');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
for(const kind of ['scope','dispose','timeout'])test(`approval late response ignored after ${kind}`,async({page})=>{
  if(kind==='timeout')await page.clock.install();const f=await fixture(page,{hold:true});await confirm(page,form('Decide',pending),'승인');await expect.poll(()=>f.writes.length).toBe(1);
  if(kind==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  else if(kind==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  else await page.clock.fastForward(31000);
  f.release();if(kind==='scope')await expect(page.locator('#adminApprovalQueuesArea')).toBeHidden();else if(kind==='timeout')await expect(page.locator(state)).toContainText('처리 결과를 다시 확인');expect(f.reads()).toBe(1);expect(f.errors).toEqual([]);
});
