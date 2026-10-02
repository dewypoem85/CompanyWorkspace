import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const media='application/vnd.company.workspace-form+json';
const main=page=>page.locator('[data-grant-form="Adjust"]');
const add=page=>page.locator('[data-grant-form="AddGrant"]');
const remove=(page,id)=>page.locator(`[data-grant-row="${id}"] [data-grant-form]`);
async function fixture(page,options={}) {
  const dir=resolve(root,'artifacts/razor'),model=JSON.parse(readFileSync(resolve(dir,'leave.grants.json'),'utf8'));
  const catalogs=new Map([model.catalog,model.other].map(data=>[data.employeeId,{...data,reasonRequired:!options.optional}]));
  const writes=[],reads=[],errors=[],releases=[];let readFailures=options.readFailures||0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST') {
      const sent=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
      const operation=url.searchParams.get('handler')||'Adjust',employee=operation==='Adjust'?sent.get('EmployeeId'):operation==='AddGrant'?sent.get('AddEmployeeId'):[...catalogs.values()].find(c=>c.grants.some(r=>r.grant.id===sent.get('grantId')))?.employeeId;
      const catalog=catalogs.get(employee),type=operation==='Adjust'?'Manual':operation==='AddGrant'?sent.get('AddGrantType'):catalog.grants.find(r=>r.grant.id===sent.get('grantId')).grant.type;
      const date=sent.get(operation==='Adjust'?'EffectiveDate':'AddGrantedDate');
      const previous=catalog.grants.find(row=>operation==='DeleteGrant'?row.grant.id===sent.get('grantId'):row.grant.type===type&&row.grant.grantedDate===date),old=previous?.grant;
      const days=operation==='DeleteGrant'?old.days:String(Number(sent.get(operation==='Adjust'?'Days':'AddDays'))),reason=sent.get(operation==='Adjust'?'Note':operation==='AddGrant'?'AddNote':'DeleteGrantReason').trim()||'사유 미입력';
      // Test values intentionally use known dates and small half-days, independently of the browser contract implementation.
      const expiry=date==='2024-02-29'?'2025-02-27':date==='2024-03-01'?'2025-02-28':date==='2024-04-01'?'2025-03-31':date?.replace('2026','2027');
      const text=`${catalog.today} ${catalog.actorName}: ${Number(days)>0?'+':''}${days}일 보정 - ${reason}`;
      const grant=operation==='DeleteGrant'?{...old}:{...(old||{id:(9007199254741100n+BigInt(writes.length)).toString(),employeeId:employee,isImported:false,sourceGrantId:null}),type,grantedDate:date,
        expiresDate:operation==='Adjust'?expiry:sent.get('AddExpiresDate')||expiry,days:operation==='Adjust'?String(Number(old?.days||0)+Number(days)):days,
        note:operation==='Adjust'?(old?.note?.trim()?old.note+'\n'+text:text):`관리자 수동 추가 - ${catalog.actorName}: ${reason}`};
      const data={operation,actorEmployeeId:catalog.actorEmployeeId,employeeId:employee,employeeSnapshot:sent.get('expectedEmployeeSnapshot'),previousSnapshot:sent.get('expectedSnapshot'),
        snapshot:operation==='DeleteGrant'?'':String(writes.length+1).padStart(64,'f'),grant,beforeDays:old?.days||'0',inputDays:days,reason,navigateTo:'/Admin/Adjustments?employeeId='+employee};
      const count=writes.length;writes.push({operation,sent,data:structuredClone(data)});
      const status=options.statuses?.[count]||options.status||200;
      if(status===200){if(previous)catalog.grants.splice(catalog.grants.indexOf(previous),1);if(operation!=='DeleteGrant')catalog.grants.push({grant:structuredClone(grant),snapshot:data.snapshot,allocated:previous?.allocated||'0',settled:previous?.settled||'0',remaining:String(Number(grant.days)-Number(previous?.allocated||0)-Number(previous?.settled||0))});}
      if(options.bad){const parts=options.bad.split('.');let item=data;for(const key of parts.slice(0,-1))item=item[key];item[parts.at(-1)]='wrong';}
      if(options.hold)await new Promise(done=>releases.push(done));
      return route.fulfill({status,contentType:options.html?'text/html':media,body:options.html?'<h1>로그인</h1>':JSON.stringify(status===200?{protocol:'workspace-form-v1',outcome:'saved',message:'처리 완료',data}:{protocol:'workspace-form-v1',outcome:status===422?'invalid':status===409?'conflict':status===403?'denied':'unknown',message:'격리된 처리 오류'})}).catch(()=>{});
    }
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/Adjustments'&&url.searchParams.get('handler')==='Baseline') {
      reads.push(url.searchParams.get('employeeId'));if(options.holdRead)await new Promise(done=>releases.push(done));
      if(readFailures-->0)return route.fulfill({status:500,json:{error:'isolated read error'}}).catch(()=>{});
      return route.fulfill({json:catalogs.get(url.searchParams.get('employeeId'))}).catch(()=>{});
    }
    if(path==='/Admin/Adjustments')return route.fulfill({body:readFileSync(resolve(dir,options.optional?'leave.grants.optional.html':'leave.grants.html')),contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/Adjustments?employeeId='+model.employee);await expect(page.locator('.cw-header')).toBeVisible();await expect(main(page).locator('[name=expectedEmployeeId]')).toHaveValue(model.catalog.actorEmployeeId);await expect(main(page).locator('button[type=submit]')).toBeEnabled();
  model.deleteGrant=(BigInt(model.grant)+2n).toString();
  return {model,writes,reads,errors,release:()=>releases.splice(0).forEach(done=>done())};
}
async function fill(page,f) {
  await main(page).locator('[name=EffectiveDate]').fill('2024-02-29');await main(page).locator('[name=Days]').fill('1.50');await main(page).locator('[name=Note]').fill('  보정 확인  ');
  await add(page).locator('[name=AddGrantType]').selectOption('Imported');await add(page).locator('[name=AddGrantedDate]').fill('2024-03-01');await add(page).locator('[name=AddDays]').fill('2.50');await add(page).locator('[name=AddNote]').fill('  추가 확인  ');
  await remove(page,f.model.deleteGrant).locator('[name=DeleteGrantReason]').fill('  삭제 확인  ');
}
async function submit(page,form) {
  await form.locator('button[type=submit]').click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  if(await form.getAttribute('data-grant-form')==='DeleteGrant')await expect(dialog.locator('[data-confirm-apply]')).toHaveAttribute('data-tone','danger');
  await dialog.getByRole('button',{name:/^(적용|발생분 삭제)$/}).click();
}
const operations=['Adjust','AddGrant','DeleteGrant'];
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
for(const width of [320,1440])for(const theme of ['light','dark'])for(const order of orders)test(`grant independent drafts save ${order.join('-')} ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await fill(page,f);
  const forms=[main(page),add(page),remove(page,f.model.deleteGrant)];
  for(const index of order){await submit(page,forms[index]);await expect(forms[index].locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');}
  expect(f.writes.map(w=>w.operation)).toEqual(order.map(i=>operations[i]));expect(f.reads).toEqual([]);
  expect(f.writes.every(w=>w.sent.get('__RequestVerificationToken')&&w.sent.get('expectedEmployeeId')===f.model.catalog.actorEmployeeId)).toBe(true);
  await expect(main(page).locator('[name=Note]')).toHaveValue('  보정 확인  ');await expect(add(page).locator('[name=AddNote]')).toHaveValue('  추가 확인  ');await expect(remove(page,f.model.deleteGrant).locator('[name=DeleteGrantReason]')).toHaveValue('  삭제 확인  ');
  for(const form of forms)await expect(form.locator('button[type=submit]')).toBeDisabled();
  expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);
  if(order.join('')==='012')await page.screenshot({path:info.outputPath('grant-saved.png'),animations:'disabled'});
});
test('grant shared slot blocks stale delete and add without blocking a different date',async({page})=>{
  const f=await fixture(page);await fill(page,f);await remove(page,f.model.grant).locator('[name=DeleteGrantReason]').fill('같은 발생분 삭제');
  await add(page).locator('[name=AddGrantType]').selectOption('Manual');await add(page).locator('[name=AddGrantedDate]').fill('2024-02-29');
  await submit(page,main(page));await expect(main(page).locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');await expect(remove(page,f.model.grant).locator('button')).toBeDisabled();await expect(add(page).locator('button')).toBeDisabled();
  await add(page).locator('[name=AddGrantedDate]').fill('2024-04-01');await expect(add(page).locator('button')).toBeEnabled();await submit(page,add(page));await expect(add(page).locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});
test('grant confirmation cancel and changed captured intent never write',async({page},info)=>{
  const f=await fixture(page);await fill(page,f);await main(page).locator('button[type=submit]').click();await expect(page.getByRole('dialog')).toContainText('외부 일정 검증 직원');await page.screenshot({path:info.outputPath('grant-confirm.png')});await page.keyboard.press('Escape');await expect(main(page).locator('button[type=submit]')).toBeFocused();expect(f.writes).toHaveLength(0);
  await main(page).locator('button[type=submit]').click();await main(page).locator('[name=Days]').evaluate(node=>node.value='9');await page.getByRole('dialog').getByRole('button',{name:'적용',exact:true}).click();await expect(add(page).locator('button[type=submit]')).toBeEnabled();expect(f.writes).toHaveLength(0);
});
test('grant employee list switch preserves every deletion draft and explicit dates',async({page})=>{
  const f=await fixture(page);await fill(page,f);const filter=page.locator('[data-grant-filter] select');await filter.selectOption(f.model.otherEmployee);await expect(remove(page,f.model.otherGrant)).toBeVisible();await remove(page,f.model.otherGrant).locator('[name=DeleteGrantReason]').fill('다른 직원 사유');
  await filter.selectOption(f.model.employee);await expect(remove(page,f.model.deleteGrant).locator('[name=DeleteGrantReason]')).toHaveValue('  삭제 확인  ');await filter.selectOption(f.model.otherEmployee);await expect(remove(page,f.model.otherGrant).locator('[name=DeleteGrantReason]')).toHaveValue('다른 직원 사유');expect(f.reads).toEqual([f.model.otherEmployee]);
  await add(page).locator('[name=AddExpiresDate]').fill('2026-12-31');await add(page).locator('[name=AddEmployeeId]').selectOption(f.model.otherEmployee);await expect(add(page).locator('[name=AddGrantedDate]')).toHaveValue('2024-03-01');await expect(add(page).locator('[name=AddExpiresDate]')).toHaveValue('2026-12-31');await expect(main(page).locator('[name=Note]')).toHaveValue('  보정 확인  ');expect(f.errors).toEqual([]);
});
test('grant read failure retains previous table and retry is read-only',async({page})=>{
  const f=await fixture(page,{readFailures:1});await fill(page,f);const filter=page.locator('[data-grant-filter] select');await filter.selectOption(f.model.otherEmployee);await expect(page.locator('[data-grant-list-state]')).toContainText('불러오지 못했습니다');await expect(filter).toHaveValue(f.model.employee);await expect(remove(page,f.model.deleteGrant).locator('[name=DeleteGrantReason]')).toHaveValue('  삭제 확인  ');
  await filter.selectOption(f.model.otherEmployee);await expect(remove(page,f.model.otherGrant)).toBeVisible();expect(f.reads).toHaveLength(2);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('grant late table read does not replace a later cached selection or allow overlapping writes',async({page})=>{
  const f=await fixture(page,{holdRead:true});await fill(page,f);const filter=page.locator('[data-grant-filter] select');await filter.selectOption(f.model.otherEmployee);await expect.poll(()=>f.reads.length).toBe(1);await expect(main(page).locator('button[type=submit]')).toBeDisabled();await main(page).evaluate(form=>form.requestSubmit());expect(f.writes).toHaveLength(0);
  await filter.selectOption(f.model.employee);await expect(page.locator('[data-grant-list-label]')).toContainText('외부 일정 검증 직원');f.release();await expect(main(page).locator('button[type=submit]')).toBeEnabled();await expect(page.locator('[data-grant-list-label]')).toContainText('외부 일정 검증 직원');await expect(remove(page,f.model.deleteGrant)).toBeVisible();expect(f.errors).toEqual([]);
});
test('grant warm lookup error can retry without replacing the typed form',async({page})=>{
  const f=await fixture(page,{readFailures:1});await fill(page,f);await main(page).locator('[name=EmployeeId]').selectOption(f.model.otherEmployee);const state=main(page).locator('[data-grant-read-state]');await expect(state).toContainText('불러오지 못했습니다');await expect(main(page).locator('[name=EffectiveDate]')).toHaveValue('2024-02-29');await state.getByRole('button',{name:'다시 확인'}).click();await expect(state).toBeHidden();await expect(main(page).locator('[name=Note]')).toHaveValue('  보정 확인  ');expect(f.writes).toHaveLength(0);expect(f.reads).toHaveLength(2);expect(f.errors).toEqual([]);
});
for(const bad of ['employeeId','previousSnapshot','grant.id','grant.days','grant.note','navigateTo'])test(`grant incomplete ${bad} acknowledgement locks every draft`,async({page})=>{
  const f=await fixture(page,{bad});await fill(page,f);await submit(page,main(page));await expect(main(page).locator('[data-grant-state]')).toContainText('저장 결과를 확인하지 못했습니다.');await expect(add(page).locator('button[type=submit]')).toBeDisabled();await expect(add(page).locator('[name=AddNote]')).toHaveValue('  추가 확인  ');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const status of [403,409,500])test(`grant ${status} response locks independent forms too`,async({page})=>{
  const f=await fixture(page,{status});await fill(page,f);await submit(page,main(page));await expect(page.locator('[data-grant-recheck]')).toBeVisible();await expect(add(page).locator('button[type=submit]')).toBeDisabled();expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('grant definite 422 allows correction without erasing a different draft',async({page})=>{
  const f=await fixture(page,{statuses:[422,200]});await fill(page,f);await submit(page,main(page));await expect(main(page).locator('[data-grant-state]')).toContainText('격리된 처리 오류');await main(page).locator('[name=Days]').fill('2');await submit(page,main(page));await expect(main(page).locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');await expect(add(page).locator('[name=AddNote]')).toHaveValue('  추가 확인  ');await expect(add(page).locator('button[type=submit]')).toBeEnabled();expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});
for(const action of ['scope','dispose','remove','timeout'])test(`grant shared session rejects late completion after ${action}`,async({page})=>{
  if(action==='timeout')await page.clock.install();const f=await fixture(page,{hold:true});await fill(page,f);await submit(page,main(page));await expect.poll(()=>f.writes.length).toBe(1);await expect(add(page).locator('button[type=submit]')).toBeDisabled();
  if(action==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(action==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(action==='remove')await main(page).evaluate(node=>node.remove());
  if(action==='timeout')await page.clock.fastForward(31000);
  f.release();await expect(add(page).locator('button[type=submit]')).toBeDisabled();await expect(add(page).locator('[name=AddNote]')).toHaveValue('  추가 확인  ');await expect(page.getByText('처리 결과를 확인했습니다.',{exact:true})).toHaveCount(0);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('grant optional reason uses the actual server-normalized fallback',async({page})=>{
  const f=await fixture(page,{optional:true});await fill(page,f);await main(page).locator('[name=Note]').fill('');await submit(page,main(page));await expect(main(page).locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');expect(f.writes[0].data.reason).toBe('사유 미입력');expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`grant common fields buttons and employee identity ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);await fill(page,f);
  await expect(page.locator('[data-grant-list-label] [data-company-local-employee]')).toHaveAttribute('data-company-local-employee',f.model.employee);
  const button=remove(page,f.model.grant).locator('button[type=submit]');
  const colors=async node=>node.evaluate(el=>{const probe=document.createElement('span');document.body.append(probe);const color=token=>{probe.style.color=`var(${token})`;return getComputedStyle(probe).color;};const css=getComputedStyle(el),result={background:css.backgroundColor,text:css.color,danger:color('--cw-danger'),dangerBg:color('--cw-danger-bg'),raised:color('--cw-raised'),muted:color('--cw-muted'),height:el.getBoundingClientRect().height};probe.remove();return result;});
  const before=await colors(button);expect(before.background).toBe(before.dangerBg);expect(before.text).toBe(before.danger);expect(before.height).toBeGreaterThanOrEqual(44);
  await main(page).locator('button[type=submit]').click();await expect(page.getByRole('dialog').locator('.cw-entity-avatar')).toHaveText('외');await page.screenshot({path:info.outputPath('grant-confirm-theme.png'),animations:'disabled'});await page.getByRole('dialog').getByRole('button',{name:'적용',exact:true}).click();await expect(main(page).locator('[data-grant-state]')).toContainText('처리 결과를 확인했습니다.');
  const after=await colors(button);expect(after.background).toBe(after.raised);expect(after.text).toBe(after.muted);await expect(button).toBeDisabled();
  await page.locator('[data-grant-filter] select').selectOption(f.model.otherEmployee);await expect(page.locator('[data-grant-list-label] .cw-entity-avatar')).toHaveText('다');await expect(page.locator('[data-grant-list-label] [data-company-local-employee]')).toHaveAttribute('data-company-local-employee',f.model.otherEmployee);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);await main(page).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('grant-fields-theme.png'),animations:'disabled'});
  const deletion=remove(page,f.model.otherGrant);await deletion.locator('[name=DeleteGrantReason]').fill('삭제 검토');await deletion.locator('button[type=submit]').click();
  const confirm=page.getByRole('dialog');await expect(confirm.locator('[data-confirm-apply]')).toHaveAttribute('data-tone','danger');await expect(confirm.locator('[data-confirm-apply]')).toHaveCSS('color',before.danger);await expect(confirm).toContainText('다른 검증 직원');
  await page.screenshot({path:info.outputPath('grant-delete-confirm.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(deletion.locator('[name=DeleteGrantReason]')).toHaveValue('삭제 검토');expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
});
