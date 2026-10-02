import { test, expect } from '@playwright/test';
import {assertPortalControls} from './support/portal-controls.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';

const definitions=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='home');
const snapshots=resolve(root,'artifacts/razor'), publicRoot=resolve(root,'apps/portal/wwwroot');
const read=file=>readFileSync(file,'utf8');
const accountFields=JSON.parse(read(resolve(root,'packages/contracts/account-fields.json'))).fields;
async function fixture(page,role='admin') {
  const model=JSON.parse(read(resolve(snapshots,role+'.json'))),errors=[],writes=[],unhandled=[];
  let allowed=model.navigation?.pages||[],fail=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({status:fail?503:role==='guest'?401:200,json:{pages:allowed}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/workspace/push/devices')return route.fulfill({json:{devices:[]}});
    const candidates=model.pages.filter(p=>p.path.toLowerCase()===path.toLowerCase()||(path.toLowerCase()==='/index'&&p.id==='home.dashboard'));
    const document=candidates.sort((a,b)=>Object.keys(b.query).length-Object.keys(a.query).length).find(p=>Object.entries(p.query).every(([key,value])=>url.searchParams.get(key)===value));
    if(document)return route.fulfill({body:read(resolve(snapshots,document.file)),contentType:'text/html'});
    const file=resolve(publicRoot,path.slice(1));
    if(file.startsWith(publicRoot+sep)&&existsSync(file)&&['.js','.css','.svg','.png'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);
    return route.abort();
  });
  return {model,errors,writes,unhandled,allow:value=>{allowed=value;},fail:value=>{fail=value;}};
}

for(const failure of ['duplicate','conflict'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`HTML account recovery keeps original baseline and explicit save ${failure} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,'master');
  const writes=[];
  await page.route('**/Admin/Users',route=>route.fulfill({contentType:'text/html',body:read(resolve(snapshots,`account-recovery-${failure}.html`))}));
  await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push([...data]);
    await route.fulfill({status:failure==='conflict'?409:422,contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:failure==='conflict'?'conflict':'invalid',message:'기존 입력을 확인해 주세요.'}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  const row=page.locator('[data-user-row]').filter({has:page.locator('[data-account-baseline][data-recovered="true"]')}),key=await row.getAttribute('data-row-key');
  const baseline=JSON.parse(await row.locator('[data-account-baseline]').inputValue()),form=page.locator('[data-bulk-form]');
  const detail=page.locator(`[data-user-details="${key}"]`),name=detail.locator('[data-account-field="Name"] input');
  await expect(detail).toBeVisible();await expect(name).toHaveValue('  복원한 직원 초안  ');await expect(row).toHaveClass(/is-dirty/);
  await expect(form.locator('[data-dirty-count]')).toHaveText('1');await expect(row.locator('[name$=".UpdatedAtTicks"]')).toHaveValue(baseline.UpdatedAtTicks);
  const add=page.locator('[data-add-account-form]');await add.locator('[name="Name"]').fill('별도 새 계정 초안');
  await form.locator('[data-save-all]').first().click();await expect(form.locator('[data-bulk-result]')).toHaveAttribute('data-state-kind','error');
  expect(writes).toHaveLength(1);const sent=new Map(writes[0]);expect([...sent.keys()].filter(k=>k.endsWith('.Id'))).toHaveLength(1);
  expect([...sent].find(([k])=>k.endsWith('.UpdatedAtTicks'))[1]).toBe(baseline.UpdatedAtTicks);
  expect(JSON.parse([...sent].find(([k])=>k.endsWith('.Baseline'))[1])).toEqual(baseline);
  if(failure==='conflict'){
    const metrics=await page.locator('[data-account-metric]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.accountMetric,Number(n.textContent)])));
    await page.route('**/Admin/Users?handler=Review&*',route=>route.fulfill({contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'snapshot',data:{
      accounts:[{id:baseline.Id,updatedAtTicks:(BigInt(baseline.UpdatedAtTicks)+10000000n).toString(),fields:{...baseline.Fields,Name:['다른 곳에서 저장한 이름']}}],metrics,choices:{DepartmentId:[],ProjectIds:[]}
    }}}));
    await form.locator('[data-bulk-result]').getByRole('button',{name:'변경 내용 비교'}).click();
    const dialog=page.locator('dialog.cw-review'),field=dialog.locator('[data-review-field="Name"]');
    await expect(dialog).toBeVisible();await expect(field).toHaveAttribute('data-conflict','true');
    await expect(field.locator('[data-review-value="before"]')).toContainText(baseline.Fields.Name[0]);
    await expect(field.locator('[data-review-value="draft"]')).toContainText('복원한 직원 초안');
    await expect(field.locator('[data-review-value="current"]')).toContainText('다른 곳에서 저장한 이름');
    await expect(dialog.locator('[data-review-apply]')).toBeDisabled();await page.keyboard.press('Escape');
  }
  await name.focus();await name.evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({path:info.outputPath('html-draft-restored.png'),animations:'disabled'});
  await form.locator('[data-reset-all]').first().click();await page.getByRole('dialog').getByRole('button',{name:'되돌리기',exact:true}).click();
  await expect(name).toHaveValue(baseline.Fields.Name[0]);await expect(form).not.toHaveAttribute('data-dirty');
  await expect(add.locator('[name="Name"]')).toHaveValue('별도 새 계정 초안');
  await expect(row.locator('[name$=".UpdatedAtTicks"]')).toHaveValue(baseline.UpdatedAtTicks);
  expect(writes).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
});

for(const failure of ['invalid','add-invalid'])test(`HTML account recovery preserves malformed raw text without executable markup ${failure}`,async({page},info)=>{
  await page.setViewportSize({width:320,height:900});await page.emulateMedia({colorScheme:'dark'});const f=await fixture(page,'master');
  await page.route('**/Admin/Users',route=>route.fulfill({contentType:'text/html',body:read(resolve(snapshots,`account-recovery-${failure}.html`))}));
  await page.goto('https://company.workspace.test/Admin/Users');
  const recovery=page.locator('[data-html-draft-recovery]');await expect(recovery).toContainText('invalid-date-RAW');
  const panel=recovery.locator('[data-cw-disclosure-panel]'),toggle=recovery.locator('[data-cw-disclosure]');
  await expect(panel).toBeVisible();await expect(toggle).toHaveAttribute('aria-expanded','true');
  await toggle.click();await expect(panel).toBeHidden();await toggle.click();await expect(panel).toBeVisible();
  await expect(page.locator('[data-account-baseline][data-recovered="true"]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.STOLEN)).toBeUndefined();
  if(failure==='invalid')await expect(recovery).toContainText('<script>window.STOLEN=true</script>');
  else {await expect(page.locator('[data-add-account-form]')).toHaveAttribute('data-create-phase','blocked');await expect(page.locator('[data-add-account-form] [type="submit"]')).toBeDisabled();}
  await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('html-raw-draft.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('HTML account recovery has a usable native form when JavaScript is unavailable',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:320,height:900}}),page=await context.newPage();
  try {
    const f=await fixture(page,'master'),submitted=[];await page.route('**/Admin/Users',route=>route.fulfill({contentType:'text/html',body:read(resolve(snapshots,'account-recovery-duplicate.html'))}));
    await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
      const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();submitted.push([...data]);
      await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Native submission received</title><p>격리된 제출 확인</p>'});
    });
    await page.goto('https://company.workspace.test/Admin/Users');
    const row=page.locator('[data-user-row]').filter({has:page.locator('[data-account-baseline][data-recovered="true"]')}),key=await row.getAttribute('data-row-key');
    const detail=page.locator(`[data-user-details="${key}"]`);await expect(detail).toBeVisible();
    await expect(detail.locator('[data-account-field="Name"] input')).toHaveValue('  복원한 직원 초안  ');
    await expect(page.getByRole('button',{name:'입력한 직원 정보 제출'})).toBeEnabled();
    const baseline=JSON.parse(await row.locator('[data-account-baseline]').inputValue());
    await page.getByRole('button',{name:'입력한 직원 정보 제출'}).click();await expect(page).toHaveTitle('Native submission received');
    expect(submitted).toHaveLength(1);const sent=new Map(submitted[0]);
    const idKey=[...sent].find(([key,value])=>key.endsWith('.Id')&&value===baseline.Id)[0],prefix=idKey.slice(0,-2);
    expect(sent.get(prefix+'Name')).toBe('  복원한 직원 초안  ');expect(sent.get(prefix+'UpdatedAtTicks')).toBe(baseline.UpdatedAtTicks);
    expect(JSON.parse(sent.get(prefix+'Baseline'))).toEqual(baseline);expect([...sent.keys()].filter(key=>key.endsWith('.Id')).length).toBeGreaterThan(1);
    expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
  } finally {await context.close();}
});

for(const kind of ['add','bulk'])test(`HTML account recovery blocks repeat writes after an unconfirmed ${kind} result`,async({page})=>{
  const f=await fixture(page,'master');await page.route('**/Admin/Users',route=>route.fulfill({contentType:'text/html',body:read(resolve(snapshots,`account-recovery-${kind}-unknown.html`))}));
  await page.goto('https://company.workspace.test/Admin/Users');await expect(page.locator('[data-html-draft-recovery]')).toContainText('결과 미확정 초안');
  const form=page.locator(kind==='add'?'[data-add-account-form]':'[data-bulk-form]');
  if(kind==='bulk'){
    const row=form.locator('[data-user-row]:not(.readonly)').last(),key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
    await page.locator(`[data-user-details="${key}"] [name$=".Name"]`).fill('확인 전에 반복하면 안 되는 초안');
    await expect(form.locator('[data-save-all]').first()).toBeDisabled();
  }else await expect(form.locator('[type="submit"]')).toBeDisabled();
  await form.evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`account creation acknowledges once and resets only its own draft ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,'master');
  const requests=[];let status=422,release;
  await page.route('**/Admin/Users?handler=Add',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
    requests.push([...data]);
    if(status===422)return route.fulfill({status,contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'invalid',message:'이메일을 확인해 주세요.'}});
    await new Promise(resolve=>{release=resolve;});
    const defaults=await page.locator('[data-add-account-form]').evaluate(node=>JSON.parse(node.dataset.accountDefaults));
    const fields=Object.fromEntries(Object.keys(defaults).map(key=>[key,data.has(key)?data.getAll(key):defaults[key]]));
    fields.Name=fields.Name.map(value=>value.trim());fields.Email=fields.Email.map(value=>value.trim().toLowerCase());
    if(fields.Permissions.includes('iap.publish')&&!fields.Permissions.includes('iap.access'))fields.Permissions.push('iap.access');
    await route.fulfill({contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'saved',message:'계정을 등록했습니다.',data:{account:{id:'9007199254740993',updatedAtTicks:'639100000000000001',fields}}}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  const form=page.locator('[data-add-account-form]'),bulk=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  await page.locator(`[data-user-details="${key}"] [data-account-field="Name"] input`).fill('기존 직원 편집 유지');
  const bulkBefore=await bulk.evaluate(node=>[...new FormData(node)]),metrics=await page.locator('[data-account-metric]').allTextContents(),rows=await page.locator('[data-user-row]').count();
  const name=form.locator('[name="Name"]'),email=form.locator('[name="Email"]'),birthday=form.locator('[name="BirthDate"]'),save=form.locator('[type="submit"]'),state=form.locator('[data-add-result]');
  await expect(birthday).toHaveAttribute('type','text');await expect(birthday).toHaveAttribute('placeholder','MM-DD');await expect(birthday).toHaveAttribute('maxlength','5');
  await name.fill('  신규 검증 직원  ');await email.fill('New.Test@Example.com');await form.locator('[name="HireDate"]').fill('2026-09-10');await birthday.fill('02-29');
  await form.locator('[name="IsPrivate"]').check();await form.locator('[name="ProjectIds"]').first().check();
  await form.locator('[name="Permissions"][value="iap.publish"]').check();
  await save.click();await expect(state).toHaveAttribute('data-state-kind','error');await expect(form).toHaveAttribute('data-create-phase','editing');
  await expect(name).toHaveValue('  신규 검증 직원  ');await expect(save).toBeEnabled();
  status=200;await save.click();await expect(form).toHaveAttribute('aria-busy','true');await expect(name).toBeDisabled();
  await form.evaluate(node=>node.requestSubmit());expect(requests).toHaveLength(2);await expect.poll(()=>typeof release).toBe('function');release();
  await expect(state).toHaveAttribute('data-state-kind','success');await expect(form).toHaveAttribute('data-create-phase','saved');
  await expect(form).toHaveAttribute('data-created-account-id','9007199254740993');await expect(name).toHaveValue('신규 검증 직원');await expect(email).toHaveValue('new.test@example.com');await expect(birthday).toHaveValue('02-29');
  await expect(name).toBeDisabled();await expect(save).toBeDisabled();await expect(save).toHaveText('등록 완료');await expect(save).not.toHaveClass(/button-primary/);await expect(form.locator('[name="Permissions"][value="iap.access"]')).toBeChecked();
  await expect(form.locator('[data-add-followup]')).toContainText('새로고침 후 반영');await expect(form.locator('[data-add-followup] a')).toHaveAttribute('target','_blank');
  expect(await bulk.evaluate(node=>[...new FormData(node)])).toEqual(bulkBefore);expect(await page.locator('[data-account-metric]').allTextContents()).toEqual(metrics);expect(await page.locator('[data-user-row]').count()).toBe(rows);
  await form.evaluate(node=>node.requestSubmit());expect(requests).toHaveLength(2);
  await form.locator('[data-add-followup]').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('registration-confirmed.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await form.locator('[data-add-another]').click();await expect(name).toHaveValue('');await expect(name).toBeEnabled();await expect(name).toBeFocused();await expect(save).toBeEnabled();
  await expect(state).toBeHidden();await expect(form.locator('[name="IsPrivate"]')).not.toBeChecked();await expect(form.locator('[name="HireDate"]')).toHaveValue('');await expect(birthday).toHaveValue('');
  expect(await form.locator('[name="Permissions"]:checked').count()).toBe(0);expect(await form.locator('[name="ProjectIds"]:checked').count()).toBe(0);
  expect(await bulk.evaluate(node=>[...new FormData(node)])).toEqual(bulkBefore);
  for(const entries of requests){const sent=new Map(entries);expect(sent.get('__RequestVerificationToken')).toBeTruthy();expect(sent.get('BirthDate')).toBe('02-29');}
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const failure of ['scope','malformed','network','denied'])test(`account creation preserves unconfirmed draft without retry: ${failure}`,async({page})=>{
  const f=await fixture(page);let count=0,release;
  await page.route('**/Admin/Users?handler=Add',async route=>{
    count++;await new Promise(resolve=>{release=resolve;});
    if(failure==='network')return route.abort();
    await route.fulfill({status:failure==='denied'?403:200,contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:failure==='denied'?'denied':'saved',message:'확인 필요',data:{account:{id:123}}}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');const form=page.locator('[data-add-account-form]'),name=form.locator('[name="Name"]'),save=form.locator('[type="submit"]');
  await name.fill('보존할 등록 초안');await form.locator('[name="Email"]').fill('draft@example.com');await form.locator('[name="HireDate"]').fill('2026-09-10');
  await save.click();await expect.poll(()=>typeof release).toBe('function');
  if(failure==='scope')await page.evaluate(()=>document.dispatchEvent(new CustomEvent('workspace-entity-scope-change')));
  release();await expect(form).toHaveAttribute('data-create-phase','blocked');await expect(save).toBeDisabled();await expect(name).toHaveValue('보존할 등록 초안');
  await form.evaluate(node=>{node.reset();node.requestSubmit();});await expect(name).toHaveValue('보존할 등록 초안');expect(count).toBe(1);
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await expect(form.locator('[data-add-followup] a')).toBeVisible();await expect(form.locator('[data-add-another]')).toBeHidden();
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared account disclosure preserves drafts and filter state ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,'master');
  await page.goto('https://company.workspace.test/Admin/Users');
  const initial=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'}),key=await initial.getAttribute('data-row-key');
  const row=page.locator(`[data-user-row][data-row-key="${key}"]`),buttons=row.locator('[data-cw-disclosure]');
  const panel=page.locator(`[data-cw-disclosure-panel="${key}"]`),form=page.locator('[data-bulk-form]'),search=page.locator('[data-user-search]');
  const other=page.locator(`[data-user-row]:not(.readonly):not([data-row-key="${key}"])`).first();
  const otherKey=await other.getAttribute('data-row-key'),otherPanel=page.locator(`[data-cw-disclosure-panel="${otherKey}"]`);
  await buttons.last().focus();await page.keyboard.press('Enter');await expect(panel).toBeVisible();
  const panelId=await panel.getAttribute('id');expect(panelId).toBeTruthy();
  for(const button of await buttons.all()){await expect(button).toHaveAttribute('aria-expanded','true');await expect(button).toHaveAttribute('aria-controls',panelId);}
  await expect(buttons.last()).toHaveText('닫기');
  const name=panel.locator('[data-account-field="Name"] input'),privacy=panel.locator('[data-account-field="IsPrivate"] input'),project=panel.locator('input[name$=".ProjectIds"]').first();
  await name.fill('초안 9007199254740993 유지');await privacy.setChecked(!(await privacy.isChecked()));await project.check();
  const snapshot=await form.evaluate(node=>[...new FormData(node)]),dirty=await page.locator('[data-dirty-count]').textContent();
  await buttons.last().focus();await page.keyboard.press('Space');await expect(panel).toBeHidden();await expect(buttons.last()).toBeFocused();
  await buttons.first().click();await expect(panel).toBeVisible();
  await other.locator('[data-cw-disclosure]').last().click();await expect(otherPanel).toBeVisible();await expect(panel).toBeVisible();
  await search.fill('절대없는검색결과');await expect(panel).toBeHidden();await expect(otherPanel).toBeHidden();await expect(search).toBeFocused();
  for(const button of await buttons.all())await expect(button).toHaveAttribute('aria-expanded','false');
  await expect(buttons.last()).toHaveText('정보');
  expect(await form.evaluate(node=>[...new FormData(node)])).toEqual(snapshot);await expect(page.locator('[data-dirty-count]')).toHaveText(dirty);
  await search.fill('');await expect(panel).toBeHidden();await buttons.last().click();await expect(panel).toBeVisible();
  await expect(name).toHaveValue('초안 9007199254740993 유지');expect(await form.evaluate(node=>[...new FormData(node)])).toEqual(snapshot);
  await name.focus();await form.evaluate((node,key)=>window.CompanyDisclosure.attach(node).setOpen(key,false),key);
  await expect(buttons.first()).toBeFocused();await expect(panel).toBeHidden();await buttons.first().click();
  const fields=panel.locator('.cw-table-detail');await fields.scrollIntoViewIfNeeded();
  const bounds=await fields.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(-1);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await fields.screenshot({path:info.outputPath('account-disclosure.png'),animations:'disabled'});
  // The sticky save bar must not make the last detail control unreachable.
  await privacy.click();await privacy.click();await expect(privacy).toBeFocused();
  expect(await form.evaluate(node=>[...new FormData(node)])).toEqual(snapshot);
  await page.screenshot({path:info.outputPath('account-disclosure-last-field.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared multi choices preserve create/edit form values ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  await page.goto('https://company.workspace.test/Admin/Users');
  const add=page.locator('[data-add-account-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const detail=page.locator(`[data-user-details="${key}"]`);
  for(const owner of [add,detail]){
    const group=owner.locator('[data-workspace-choices="project"]'),check=group.locator('input[type="checkbox"]').first();
    await check.check();const name=await check.getAttribute('name');
    const selected=await check.evaluate(node=>new FormData(node.form).getAll(node.name));
    const dirty=await page.locator('[data-dirty-count]').textContent();
    await group.getByRole('searchbox').fill('없는프로젝트');
    await expect(group.locator('[data-choice-status]')).toContainText('0개 표시');await expect(check).toBeHidden();
    expect(await check.evaluate(node=>new FormData(node.form).getAll(node.name))).toEqual(selected);
    expect(await page.locator('[data-dirty-count]').textContent()).toBe(dirty);
    await group.getByRole('searchbox').fill('ㄱㅈㅍㄹㅈㅌ');await expect(check).toBeVisible();await expect(check).toBeChecked();
    await expect(check).toHaveAttribute('name',name);await expect(group.locator('[data-choice-status]')).toContainText('1개 선택');
    const bounds=await group.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(-1);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
    await group.screenshot({path:info.outputPath(owner===add?'create-projects.png':'edit-projects.png'),animations:'disabled'});
    await check.evaluate(node=>node.form.reset());await expect(group.getByRole('searchbox')).toHaveValue('');
    const actual=await group.locator('input[type="checkbox"]:checked').count();await expect(group.locator('[data-choice-status]')).toContainText(`${actual}개 선택`);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`bulk save keeps drafts and reconciles explicit server acknowledgement ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const requests=[];let status=422,hold=false,release;
  await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
    requests.push([...data.entries()]);if(hold)await new Promise(resolve=>{release=resolve;});
    if(status===0)return route.abort();
    if(status===502)return route.fulfill({status,contentType:'text/html',body:'upstream unavailable'});
    const indexes=data.getAll('updates.Index');
    const accounts=indexes.map(index=>{
      const prefix=`updates[${index}].`,fields=Object.fromEntries(accountFields.map(field=>[field.key,data.getAll(prefix+field.key)]));
      fields.Name=fields.Name.map(n=>n.trim());fields.IsPrivate=fields.IsPrivate.length?fields.IsPrivate:['false'];
      return {id:data.get(prefix+'Id'),updatedAtTicks:(BigInt(data.get(prefix+'UpdatedAtTicks'))+100n).toString(),fields};
    });
    const metrics=await page.locator('[data-account-metric]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.accountMetric,Number(node.textContent)])));
    return route.fulfill({status:status===201?200:status,contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome:status===200||status===201?'saved':status===409?'conflict':'invalid',message:status===200?'1명의 변경사항을 저장했습니다.':'확인 필요',data:{accounts:status===201?[]:accounts,metrics}})});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  const form=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const detail=page.locator(`[data-user-details="${key}"]`),name=detail.locator('[data-account-field="Name"] input'),privacy=detail.locator('[data-account-field="IsPrivate"] input');
  const version=page.locator(`[data-row-key="${key}"] input[name$=".UpdatedAtTicks"]`),originalVersion=await version.inputValue();
  await name.fill('  보존할 초안  ');await privacy.check();
  const addDraft=page.locator('[data-add-account-form] [name="Name"]');await addDraft.fill('새 계정의 별도 초안');
  const state=form.locator('[data-bulk-result]'),save=form.locator('[data-save-all]').first();
  for(const failure of [422,409,401,403,502,0,201]){
    status=failure;hold=failure===422;await save.click();
    if(hold){await expect(name).toBeDisabled();await expect(form).toHaveAttribute('aria-busy','true');await expect(state).toHaveAttribute('data-state-kind','loading');
      await form.evaluate(node=>node.requestSubmit());await expect.poll(()=>requests.length).toBe(1);hold=false;release();}
    await expect(state).toHaveAttribute('data-state-kind',[401,403].includes(failure)?'denied':'error');
    await expect(name).toHaveValue('  보존할 초안  ');await expect(privacy).toBeChecked();await expect(version).toHaveValue(originalVersion);
    await expect(save).toBeEnabled();await expect(form).toHaveAttribute('data-dirty','');await expect(form).not.toHaveAttribute('aria-busy');
  }
  expect(requests).toHaveLength(7);
  for(const entries of requests){const data=new Map(entries);expect(data.get('__RequestVerificationToken')).toBeTruthy();expect(entries.filter(([name])=>name.endsWith('.Id'))).toHaveLength(1);expect(entries.find(([name])=>name.endsWith('.UpdatedAtTicks'))[1]).toBe(originalVersion);}
  await page.screenshot({path:info.outputPath('save-unconfirmed.png'),animations:'disabled'});
  status=200;await save.click();await expect(state).toHaveAttribute('data-state-kind','success');
  await expect(name).toHaveValue('보존할 초안');await expect(version).toHaveValue((BigInt(originalVersion)+100n).toString());
  await expect(form).not.toHaveAttribute('data-dirty');await expect(save).toBeDisabled();await expect(addDraft).toHaveValue('새 계정의 별도 초안');
  await name.fill('다음 초안');await form.locator('[data-reset-all]').first().click();await page.locator('[data-confirm-apply]').click();
  await expect(name).toHaveValue('보존할 초안');await expect(privacy).toBeChecked();await expect(form).not.toHaveAttribute('data-dirty');
  expect(requests).toHaveLength(8);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('save-confirmed.png'),animations:'disabled'});
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`conflict review compares three versions, cancels safely and prepares explicit resave ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const writes=[];let readCount=0,readStatus=200,pending,hold=false,malformed='';
  await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();writes.push([...data]);
    await route.fulfill({status:409,contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome:'conflict',message:'다른 곳에서 변경되었습니다.'})});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  const form=page.locator('[data-bulk-form]'),initial=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'}),key=await initial.getAttribute('data-row-key');
  const row=page.locator(`[data-row-key="${key}"]`);await row.locator('[data-detail-toggle]').last().click();
  const detail=page.locator(`[data-user-details="${key}"]`),name=detail.locator('[data-account-field="Name"] input'),email=detail.locator('[data-account-field="Email"] input');
  const version=row.locator('input[name$=".UpdatedAtTicks"]'),originalVersion=await version.inputValue(),id=await row.locator('input[name$=".Id"]').inputValue();
  const fields=await form.evaluate((form,prefix)=>{
    const data=new FormData(form),contract=JSON.parse(form.dataset.accountContract);
    return Object.fromEntries(contract.map(f=>[f.key,f.key==='IsPrivate'?[data.has(prefix+f.key)?'true':'false']:data.getAll(prefix+f.key)]));
  },(await row.locator('input[name$=".Id"]').getAttribute('name')).slice(0,-2));
  const metrics=await page.locator('[data-account-metric]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.accountMetric,Number(n.textContent)])));
  const latestVersion=(BigInt(originalVersion)+100n).toString();
  const latest={...fields,Name:['서버에서 바꾼 이름'],Email:['remote@example.test'],ProjectIds:['98765']};
  await page.route('**/Admin/Users?handler=Review&*',async route=>{
    readCount++;if(hold)await new Promise(resolve=>{pending=resolve;});
    const data=structuredClone({accounts:[{id,updatedAtTicks:latestVersion,fields:latest}],metrics,choices:{DepartmentId:[],ProjectIds:[{value:'98765',label:'새 비공개 프로젝트 · 비공개'}]}});
    if(malformed==='metrics')delete data.metrics.ActiveUserCount;
    if(malformed==='scalar')data.accounts[0].fields.Name=[];
    if(malformed==='permission')data.accounts[0].fields.Permissions=['unknown.permission'];
    if(malformed==='choices')data.choices.ProjectIds.push({...data.choices.ProjectIds[0]});
    await route.fulfill({status:readStatus,contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome:'snapshot',data})});
  });
  const state=form.locator('[data-bulk-result]'),save=form.locator('[data-save-all]').first();
  await name.fill('내가 바꾼 이름');await save.click();await expect(state.getByRole('button',{name:'변경 내용 비교'})).toBeVisible();
  readStatus=403;await state.getByRole('button').click();await expect(state).toContainText('수정 권한');await expect(page.locator('dialog.cw-review')).toHaveCount(0);await expect(version).toHaveValue(originalVersion);
  readStatus=200;
  for(const invalid of ['metrics','scalar','permission','choices']){
    malformed=invalid;await state.getByRole('button').click();await expect(state).toContainText('기존 초안을 유지했습니다');
    await expect(page.locator('dialog.cw-review')).toHaveCount(0);await expect(name).toHaveValue('내가 바꾼 이름');await expect(version).toHaveValue(originalVersion);
    await expect(detail.locator('input[name$=".ProjectIds"][value="98765"]')).toHaveCount(0);
  }
  malformed='';
  readStatus=200;hold=true;await state.getByRole('button').click();await expect.poll(()=>pending!==undefined).toBe(true);
  await name.fill('조회 중 바꾼 초안');hold=false;pending();await expect(state).toContainText('초안 또는 로그인 상태가 바뀌었습니다');await expect(version).toHaveValue(originalVersion);
  await state.getByRole('button').click();const dialog=page.locator('dialog.cw-review');await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'직원 변경 내용 비교'})).toBeFocused();await expect(dialog.locator('[data-review-apply]')).toBeDisabled();
  const conflict=dialog.locator('[data-review-field="Name"]');await expect(conflict).toHaveAttribute('data-conflict','true');
  await expect(conflict.locator('[data-review-value="before"]')).toContainText(fields.Name[0]);await expect(conflict).toContainText('조회 중 바꾼 초안');await expect(conflict).toContainText('서버에서 바꾼 이름');
  await expect(dialog.locator('[data-review-field="ProjectIds"]')).toContainText('새 비공개 프로젝트');
  await expect(dialog.locator('[data-review-field="ProjectIds"]')).toHaveAttribute('data-review-choice','current');
  await expect(conflict).toHaveAttribute('data-review-choice','');
  await page.screenshot({path:info.outputPath('conflict-review.png'),animations:'disabled'});
  expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  expect((await dialog.boundingBox()).x).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Tab');expect(await dialog.evaluate(n=>n.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(name).toHaveValue('조회 중 바꾼 초안');await expect(version).toHaveValue(originalVersion);await expect(state.getByRole('button')).toBeFocused();
  await state.getByRole('button').click();await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);await expect(version).toHaveValue(originalVersion);await expect(name).toHaveValue('조회 중 바꾼 초안');
  await state.getByRole('button').click();await dialog.locator('[data-review-field="Name"] select').selectOption('draft');
  await expect(dialog.locator('[data-review-field="Name"]')).toHaveAttribute('data-review-choice','draft');
  await dialog.locator('[data-review-apply]').click();await expect(dialog).toHaveCount(0);await expect(state).toContainText('아직 서버에 저장하지 않았습니다');
  await expect(name).toHaveValue('조회 중 바꾼 초안');await expect(email).toHaveValue('remote@example.test');await expect(version).toHaveValue(latestVersion);
  const addedProject=detail.locator('input[name$=".ProjectIds"][value="98765"]');
  await expect(addedProject).toBeChecked();await expect(addedProject).toBeEnabled();
  await expect(addedProject.locator('xpath=ancestor::label').locator('[data-choice-text]')).toHaveText('새 비공개 프로젝트 · 비공개');
  await expect(addedProject.locator('xpath=ancestor::label').locator('[data-workspace-entity="project"]')).toHaveAttribute('data-workspace-entity-id','98765');expect(writes).toHaveLength(1);
  await save.click();expect(writes).toHaveLength(2);expect(writes[1].find(([key])=>key.endsWith('.UpdatedAtTicks'))[1]).toBe(latestVersion);
  expect(writes[1].find(([key])=>key.endsWith('.Name'))[1]).toBe('조회 중 바꾼 초안');
  expect(writes[1].filter(([key])=>key.endsWith('.ProjectIds')).map(([,value])=>value)).toEqual(['98765']);
  expect(readCount).toBe(9);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const interruption of ['edit','pagehide'])test(`bulk pending acknowledgement cannot overwrite after ${interruption}`,async({page})=>{
  const f=await fixture(page);let release;
  await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
    const accounts=data.getAll('updates.Index').map(index=>{
      const prefix=`updates[${index}].`,fields=Object.fromEntries(accountFields.map(field=>[field.key,data.getAll(prefix+field.key)]));fields.IsPrivate=fields.IsPrivate.length?fields.IsPrivate:['false'];
      return {id:data.get(prefix+'Id'),updatedAtTicks:(BigInt(data.get(prefix+'UpdatedAtTicks'))+1n).toString(),fields};
    });
    const metrics=await page.locator('[data-account-metric]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.accountMetric,Number(n.textContent)])));
    await new Promise(resolve=>{release=resolve;});await route.fulfill({contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'saved',message:'저장 완료',data:{accounts,metrics}}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  await page.evaluate(()=>{const original=fetch;window.__bulkReplies=0;window.fetch=async(url,init)=>{if(!String(url).includes('handler=BulkUpdate'))return original(url,init);const response=await original(url,{...init,signal:undefined});window.__bulkReplies++;return response;};});
  const form=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'}),key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const name=page.locator(`[data-user-details="${key}"] [data-account-field="Name"] input`),version=row.locator('[name$=".UpdatedAtTicks"]'),originalVersion=await version.inputValue(),originalName=await name.inputValue();
  await name.fill('전송한 초안');await form.locator('[data-save-all]').first().click();await expect.poll(()=>typeof release).toBe('function');
  if(interruption==='edit')await name.evaluate(node=>{node.value='전송 뒤 바뀐 초안';node.dispatchEvent(new Event('input',{bubbles:true}));});
  else await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  release();await expect.poll(()=>page.evaluate(()=>window.__bulkReplies)).toBe(1);
  await expect(name).toHaveValue(interruption==='edit'?'전송 뒤 바뀐 초안':'전송한 초안');await expect(version).toHaveValue(originalVersion);expect(await name.evaluate(node=>node.defaultValue)).toBe(originalName);
  await expect(form).not.toHaveAttribute('aria-busy');await expect(form.locator('[data-bulk-result]')).not.toHaveAttribute('data-state-kind','success');
  if(interruption==='edit')await expect(form.locator('[data-bulk-result]')).toHaveAttribute('data-state-kind','error');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`bulk reset uses shared confirmation and preserves unrelated drafts ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  await page.goto('https://company.workspace.test/Admin/Users');
  const form=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const name=page.locator(`[data-user-details="${key}"] [data-account-field="Name"] input`),original=await name.inputValue();
  const add=page.locator('[data-add-account-form] [name="Name"]');await add.fill('별도 등록 초안');await name.fill('기존 직원 변경 초안');
  const reset=form.locator('[data-reset-all]').first(),before=await form.evaluate(node=>[...new FormData(node)]),dialog=page.locator('dialog.cw-confirm');
  await reset.click();await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading')).toBeFocused();
  await expect(dialog).toContainText('서버에 저장된 내용을 되돌리는 작업은 아닙니다');
  await reset.dispatchEvent('click');await form.evaluate(node=>node.requestSubmit());await expect(dialog).toHaveCount(1);expect(f.writes).toEqual([]);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(reset).toBeFocused();expect(await form.evaluate(node=>[...new FormData(node)])).toEqual(before);
  await reset.click();await name.evaluate(node=>{node.value='확인 중 바뀐 초안';node.dispatchEvent(new Event('input',{bubbles:true}));});
  await dialog.locator('[data-confirm-apply]').click();await expect(dialog).toContainText('확인 중 입력 또는 로그인 상태가 바뀌었습니다');await expect(name).toHaveValue('확인 중 바뀐 초안');
  await dialog.locator('[data-confirm-cancel]').click();await expect(dialog).toHaveCount(0);await expect(reset).toBeFocused();
  await reset.click();await page.screenshot({path:info.outputPath('bulk-reset-confirmation.png'),animations:'disabled'});
  expect(await dialog.locator('[data-confirm-apply]').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;})).toBe(1);
  expect((await dialog.boundingBox()).x).toBeGreaterThanOrEqual(0);expect(await dialog.evaluate(node=>node.scrollWidth)).toBeLessThanOrEqual(width);
  await dialog.locator('[data-confirm-apply]').click();await expect(dialog).toHaveCount(0);await expect(name).toHaveValue(original);await expect(add).toHaveValue('별도 등록 초안');await expect(form).not.toHaveAttribute('data-dirty');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const stage of ['idle','reset','review'])test(`bulk scope invalidation blocks stale actions during ${stage}`,async({page})=>{
  const f=await fixture(page);let reads=0,release;
  await page.route('**/Admin/Users?handler=BulkUpdate',route=>route.fulfill({status:409,contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'conflict',message:'다른 곳에서 변경되었습니다.'}}));
  await page.route('**/Admin/Users?handler=Review*',async route=>{
    reads++;const data=await page.locator('[data-bulk-form]').evaluate((form,keys)=>{
      const row=[...form.querySelectorAll('[data-user-row]:not(.readonly)')].find(row=>row.textContent.includes('검증 직원'));
      const controls=[...row.querySelectorAll('input,select'),...form.querySelector(`[data-user-details="${row.dataset.rowKey}"]`).querySelectorAll('input,select')].filter(c=>c.name);
      const fields=Object.fromEntries(keys.map(key=>[key,controls.filter(c=>c.name.endsWith('.'+key)&&(c.type!=='checkbox'||c.checked)).map(c=>c.value)]));fields.IsPrivate=fields.IsPrivate.length?fields.IsPrivate:['false'];fields.Name=['서버 변경 이름'];
      return {accounts:[{id:controls.find(c=>c.name.endsWith('.Id')).value,updatedAtTicks:controls.find(c=>c.name.endsWith('.UpdatedAtTicks')).value,fields}],metrics:Object.fromEntries([...document.querySelectorAll('[data-account-metric]')].map(n=>[n.dataset.accountMetric,Number(n.textContent)])),choices:{DepartmentId:[],ProjectIds:[]}};
    },accountFields.map(f=>f.key));
    if(stage==='review')await new Promise(resolve=>{release=resolve;});
    await route.fulfill({contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'snapshot',data}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  if(stage==='review')await page.evaluate(()=>{const original=window.fetch;window.__accountReviewReplies=0;window.fetch=async(url,init)=>{const response=await (String(url).includes('handler=Review')?original(url,{...init,signal:undefined}):original(url,init));if(String(url).includes('handler=Review'))window.__accountReviewReplies++;return response;};});
  const form=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'}),key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const name=page.locator(`[data-user-details="${key}"] [data-account-field="Name"] input`);await name.fill('범위 변경 전 초안');
  const before=await form.evaluate(node=>[...new FormData(node)]),state=form.locator('[data-bulk-result]');
  if(stage==='reset')await form.locator('[data-reset-all]').first().click();
  if(stage==='review'){await form.locator('[data-save-all]').first().click();await state.getByRole('button').click();await expect.poll(()=>reads).toBe(1);await expect.poll(()=>typeof release).toBe('function');}
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  release?.();
  if(stage==='review')await expect.poll(()=>page.evaluate(()=>window.__accountReviewReplies)).toBe(1);
  await expect(page.locator('dialog')).toHaveCount(0);await expect(state).toHaveAttribute('data-state-kind','denied');await expect(state.getByRole('button')).toHaveCount(0);
  for(const button of await form.locator('[data-reset-all],[data-save-all]').all())await expect(button).toBeDisabled();
  await form.evaluate(node=>node.requestSubmit());await form.locator('[data-reset-all]').first().dispatchEvent('click');await form.locator('[data-toggle-permission]').first().dispatchEvent('click');
  expect(await form.evaluate(node=>[...new FormData(node)])).toEqual(before);await expect(name).toHaveValue('범위 변경 전 초안');await expect(form).toHaveAttribute('data-dirty');expect(reads).toBe(stage==='review'?1:0);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`bulk pending scope change ignores late save and preserves both drafts ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  let release;const writes=[];
  await page.route('**/Admin/Users?handler=BulkUpdate',async route=>{
    const request=route.request(),data=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
    writes.push([...data]);
    const accounts=data.getAll('updates.Index').map(index=>{
      const prefix=`updates[${index}].`,fields=Object.fromEntries(accountFields.map(field=>[field.key,data.getAll(prefix+field.key)]));
      fields.Name=['적용되면 안 되는 이전 응답'];fields.IsPrivate=fields.IsPrivate.length?fields.IsPrivate:['false'];
      return {id:data.get(prefix+'Id'),updatedAtTicks:(BigInt(data.get(prefix+'UpdatedAtTicks'))+100n).toString(),fields};
    });
    const metrics=await page.locator('[data-account-metric]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.dataset.accountMetric,Number(node.textContent)])));
    await new Promise(r=>{release=r;});
    await route.fulfill({contentType:'application/vnd.company.workspace-form+json',json:{protocol:'workspace-form-v1',outcome:'saved',message:'이전 요청 저장 완료',data:{accounts,metrics}}});
  });
  await page.goto('https://company.workspace.test/Admin/Users');
  // Deliberately ignore fetch cancellation: the shared generation guard must still reject the response.
  await page.evaluate(()=>{
    const original=window.fetch;window.__lateFormReplies=0;
    window.fetch=async(url,init)=>{
      if(!String(url).includes('handler=BulkUpdate'))return original(url,init);
      const response=await original(url,{...init,signal:undefined});window.__lateFormReplies++;return response;
    };
  });
  const form=page.locator('[data-bulk-form]'),row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');await row.locator('[data-detail-toggle]').last().click();
  const name=page.locator(`[data-user-details="${key}"] [data-account-field="Name"] input`);
  const version=row.locator('input[name$=".UpdatedAtTicks"]'),baseline=await version.inputValue();
  const original=await name.evaluate(node=>node.defaultValue),metrics=await page.locator('[data-account-metric]').allTextContents();
  const add=page.locator('[data-add-account-form] [name="Name"]');await add.fill('별도 등록 초안');await name.fill('내가 작성 중인 변경');
  const state=form.locator('[data-bulk-result]');await form.locator('[data-save-all]').first().click();
  await expect(name).toBeDisabled();await expect.poll(()=>release!==undefined).toBe(true);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(state).toHaveAttribute('data-state-kind','denied');await expect(name).toBeEnabled();await expect(form).not.toHaveAttribute('aria-busy');
  await expect(state).toContainText('서버에는 반영되었을 수 있습니다');
  release();await expect.poll(()=>page.evaluate(()=>window.__lateFormReplies)).toBe(1);
  await expect(name).toHaveValue('내가 작성 중인 변경');await expect(add).toHaveValue('별도 등록 초안');await expect(version).toHaveValue(baseline);
  expect(await name.evaluate(node=>node.defaultValue)).toBe(original);expect(await page.locator('[data-account-metric]').allTextContents()).toEqual(metrics);
  await expect(form).toHaveAttribute('data-dirty','');await expect(state).toHaveAttribute('data-state-kind','denied');expect(writes).toHaveLength(1);
  await expect(form.locator('[data-save-all]').first()).toBeDisabled();await form.evaluate(node=>node.requestSubmit());expect(writes).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await state.scrollIntoViewIfNeeded();
  const splitWords=await state.evaluate(node=>[...node.querySelectorAll('strong,p')].flatMap(element=>{
    const text=element.firstChild;if(text?.nodeType!==Node.TEXT_NODE)return [];
    return [...text.textContent.matchAll(/[가-힣]+/g)].filter(match=>{
      const range=document.createRange();range.setStart(text,match.index);range.setEnd(text,match.index+match[0].length);
      return range.getClientRects().length>1;
    }).map(match=>match[0]);
  }));
  expect(splitWords).toEqual([]);
  await page.screenshot({path:info.outputPath('bulk-scope-changed.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const definition of definitions)for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);
  await page.goto('https://company.workspace.test'+definition.path+(definition.query?'?'+new URLSearchParams(definition.query):''));
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',definition.id);
  await expect(page).toHaveTitle(definition.title+'');
  await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation.pages.length);
  await expect(page.locator('.cw-header')).toHaveCount(1);await expect(page.locator('.cw-sidebar')).toHaveCount(1);
  await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  if(definition.nav!==false)await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',definition.id);
  if(definition.id==='home.dashboard'){
    const colors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);const color=name=>{probe.style.color=`var(--cw-${name})`;return getComputedStyle(probe).color;},background=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};const result={success:color('success'),successBg:background('success-bg'),warning:color('warning'),warningBg:background('warning-bg')};probe.remove();return result;});
    const serviceCount=page.locator('.service-count'),available=page.locator('.system-status:not(.admin)').first(),admin=page.locator('.system-status.admin');await expect(serviceCount).toHaveClass(/\bcw-state-pill\b/);await expect(serviceCount).toHaveAttribute('data-tone','success');await expect(serviceCount).toHaveCSS('background-color',colors.successBg);await expect(serviceCount).toHaveCSS('color',colors.success);await expect(available).toHaveClass(/\bcw-state-pill\b/);await expect(available).toHaveAttribute('data-tone','success');await expect(available).toHaveCSS('background-color',colors.successBg);await expect(available).toHaveCSS('color',colors.success);await expect(admin).toHaveClass(/\bcw-state-pill\b/);await expect(admin).toHaveAttribute('data-tone','warning');await expect(admin).toHaveCSS('background-color',colors.warningBg);await expect(admin).toHaveCSS('color',colors.warning);
  }
  await page.screenshot({path:info.outputPath('content.png'),animations:'disabled'});
  const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,10).map(e=>({tag:e.tagName,css:e.className,width:e.getBoundingClientRect().width}))}));
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{message:JSON.stringify(geometry)}).toBe(true);
  if(width<901)await page.locator('[data-cw-nav]').click();
  await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
  await page.screenshot({path:info.outputPath('navigation.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const role of ['guest','employee','shared','master'])test(`portal server-rendered account scope: ${role}`,async({page})=>{
  const f=await fixture(page,role);await page.goto('https://company.workspace.test/');
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','home.dashboard');
  if(role==='guest'){
    await expect(page.locator('.cw-sidebar')).toHaveCount(0);
    await expect(page.locator('.cw-page-link')).toHaveCount(0);
  }else{
    await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation.pages.length);
    await expect(page.locator('[data-cw-account]')).toContainText(f.model.context.user.name);
    expect(await page.locator('.cw-page-link').evaluateAll(nodes=>nodes.map(n=>n.dataset.workspacePage))).toEqual(f.model.navigation.pages);
  }
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const theme of ['light','dark'])test(`profile with long account details stays within 320px ${theme}`,async({page})=>{
  await page.setViewportSize({width:320,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);
  f.model.context.user.email='w'.repeat(64)+'@'+'w'.repeat(50)+'.'+'w'.repeat(50)+'.test';
  f.model.context.user.department='긴 부서 이름 '.repeat(10);
  await page.goto('https://company.workspace.test/settings/profile');
  await expect(page.locator('[data-profile-summary]')).toContainText(f.model.context.user.email);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  expect(f.errors).toEqual([]);
});

test('Razor department/project query navigation and legacy index retain the shared shell',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const f=await fixture(page);
  await page.goto('https://company.workspace.test/Index');
  for(const id of ['home.projects','home.departments','home.profile','home.users']){
    await page.locator(`[data-workspace-page="${id}"]`).click();
    await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',id);
    await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',id);
  }
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('Razor permission refresh removes revoked links and recovers after navigation API failure',async({page})=>{
  const f=await fixture(page);await page.goto('https://company.workspace.test/');
  await expect(page.locator('[data-workspace-page="home.users"]')).toBeVisible();
  f.allow(['home.dashboard','home.profile']);await page.evaluate(()=>dispatchEvent(new Event('focus')));
  await expect(page.locator('.cw-page-link')).toHaveCount(2);
  f.fail(true);await page.evaluate(()=>dispatchEvent(new Event('focus')));await expect(page.locator('.cw-page-link')).toHaveCount(0);
  f.fail(false);await page.evaluate(()=>dispatchEvent(new Event('focus')));await expect(page.locator('.cw-page-link')).toHaveCount(2);
  expect(f.errors).toEqual([]);
});

test('malformed company context is rejected before account or service rendering',async({page})=>{
  const f=await fixture(page);await page.route('**/api/workspace/context',route=>route.fulfill({json:{authenticated:true,user:{id:1,name:'검증',role:'admin'},services:[{key:'cs',name:'CS',href:'/workspace/cs'},{key:'cs',name:'중복',href:'/workspace/cs'}]}}));
  await page.goto('https://company.workspace.test/');
  await expect(page.locator('[data-cw-connection]')).toBeVisible();
  await expect(page.locator('[data-cw-account]')).not.toContainText('검증');
  await expect(page.locator('[data-cw-service-links] a')).toHaveCount(0);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('disposed company context read cannot replace the last completed account',async({page})=>{
  const f=await fixture(page);let calls=0,release;
  await page.route('**/api/workspace/context',async route=>{
    calls++;if(calls===1)return route.fulfill({json:f.model.context});
    await new Promise(resolve=>{release=resolve;});
    return route.fulfill({json:{...f.model.context,user:{...f.model.context.user,name:'늦은 계정'}}}).catch(()=>{});
  });
  await page.goto('https://company.workspace.test/');await expect(page.locator('[data-cw-account]')).toContainText(f.model.context.user.name);
  const pending=page.evaluate(()=>window.CompanyWorkspace.refresh());await expect.poll(()=>calls).toBe(2);
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  release();await pending;
  await expect(page.locator('[data-cw-account]')).toContainText(f.model.context.user.name);
  await expect(page.locator('[data-cw-account]')).not.toContainText('늦은 계정');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`menu states preserve draft, drawer and keyboard retry ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  const f=await fixture(page);await page.goto('https://company.workspace.test/Admin/Users');
  await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation.pages.length);
  const draft=page.locator('[data-add-account-form] [name="Name"]');await draft.fill('작성 중인 초안');
  let status=503,pending=null,hold=false;
  await page.route('**/api/workspace/navigation',async route=>{
    if(hold)await new Promise(resolve=>{pending=resolve;});
    return route.fulfill({status,json:{pages:status===200?f.model.navigation.pages:[]}});
  });
  await page.evaluate(()=>window.CompanyNavigation.refreshPermissions());
  if(width<901)await page.locator('[data-cw-nav]').click();
  const state=page.locator('.cw-sidebar .cw-feedback');
  await expect(state).toHaveAttribute('data-state-kind','error');await expect(state).toBeVisible();
  await expect(page.locator('.cw-page-link')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('menu-error.png'),animations:'disabled'});
  hold=true;
  await state.getByRole('button',{name:'다시 시도',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(state).toHaveAttribute('data-state-kind','loading');await expect(state).toBeFocused();
  await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','false');
  if(width<901)await expect(page.locator('body')).toHaveClass(/cw-nav-open/);
  expect(await state.locator('svg').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await expect(draft).toHaveValue('작성 중인 초안');await expect.poll(()=>pending!==null).toBe(true);
  status=200;hold=false;pending();
  await expect(page.locator('.cw-page-link[aria-current]')).toBeFocused();
  await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','false');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  for(const code of [403,401]){
    status=code;await page.evaluate(()=>window.CompanyNavigation.refreshPermissions());
    await expect(state).toHaveAttribute('data-state-kind','denied');
    await expect(state).toContainText(code===403?'이용 권한':'로그인 확인');
  }
  await state.getByRole('button',{name:'로그인 안내'}).click();
  await expect(page.locator('[data-company-status="session"]')).toContainText('다시 로그인');
  const banner=await page.locator('[data-company-status="session"]').boundingBox();
  expect(banner.x).toBeGreaterThanOrEqual(20);expect(banner.x+banner.width).toBeLessThanOrEqual(width-20);
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Users');
  await expect(draft).toHaveValue('작성 중인 초안');
  await page.screenshot({path:info.outputPath('login-guidance.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared state visuals wrap safely ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://company.workspace.test/');
  await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation.pages.length);
  await page.evaluate(()=>{
    const gallery=document.createElement('section');gallery.dataset.stateGallery='';
    for(const kind of window.CompanyState.kinds){
      const node=document.createElement('div');gallery.append(node);
      window.CompanyState.render(node,{kind,message:'긴 상태 설명 및 식별자 '+'a'.repeat(200),actionLabel:'확인'});
    }
    document.querySelector('main').replaceChildren(gallery);
  });
  await expect(page.locator('[data-state-gallery] .cw-feedback')).toHaveCount(5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('states.png'),fullPage:true,animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const role of ['admin','master'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`account fields share create/edit rendering and state ${role} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,role);await page.goto('https://company.workspace.test/Admin/Users');
  const add=page.locator('[data-add-account-form]');
  const row=page.locator('[data-user-row]:not(.readonly)').filter({hasText:'검증 직원'});
  const key=await row.getAttribute('data-row-key');
  const detail=page.locator(`[data-user-details="${key}"]`);
  const checkColors=await page.evaluate(()=>{const probe=document.createElement('span');document.body.append(probe);const token=name=>{probe.style.backgroundColor=`var(--cw-${name})`;return getComputedStyle(probe).backgroundColor;};const ink=name=>{probe.style.color=`var(--cw-${name})`;return getComputedStyle(probe).color;};const value={raised:token('raised'),active:token('active'),line:token('line'),accent:token('accent'),success:token('success'),successBg:token('success-bg'),activeText:ink('active-text'),successText:ink('success'),muted:ink('muted')};probe.remove();return value;});
  if(role==='admin'){
    const readonly=page.locator('[data-user-row].readonly').first(),accountTypePill=readonly.locator('.account-type-badge');await expect(accountTypePill).toHaveClass(/\bcw-state-pill\b/);await expect(accountTypePill).toHaveAttribute('data-tone','info');await expect(accountTypePill).toHaveCSS('background-color',checkColors.active);await expect(accountTypePill).toHaveCSS('color',checkColors.activeText);
    for(const permission of await readonly.locator('.permission-result.allowed').all()){await expect(permission).toHaveClass(/\bcw-state-pill\b/);await expect(permission).toHaveAttribute('data-tone','info');await expect(permission).toHaveCSS('background-color',checkColors.active);}
    const accountStatus=readonly.locator('.status');await expect(accountStatus).toHaveClass(/\bcw-state-pill\b/);await expect(accountStatus).toHaveAttribute('data-tone','success');await expect(accountStatus).toHaveCSS('background-color',checkColors.successBg);await expect(accountStatus).toHaveCSS('color',checkColors.successText);
    await readonly.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('account-summary-viewport.png'),animations:'disabled'});
  }
  const addPrivacy=add.locator('[name="IsPrivate"]'),addPrivacyControl=addPrivacy.locator('xpath=..');await expect(addPrivacy).toHaveClass(/\bcw-checkbox\b/);await expect(addPrivacyControl).toHaveClass(/\bcw-check-control\b/);expect((await addPrivacy.boundingBox()).width).toBe(18);await expect(addPrivacyControl).toHaveCSS('background-color',checkColors.raised);
  for(const permission of await add.locator('.option-card input[name="Permissions"]').all()){await expect(permission).toHaveClass(/\bcw-checkbox\b/);await expect(permission.locator('xpath=..')).toHaveClass(/\bcw-check-control\b/);expect((await permission.boundingBox()).width).toBe(18);}
  for(const field of accountFields){
    await expect(add.locator(`[data-account-field="${field.key}"]`)).toHaveCount(1);
    const containers=field.placement==='detail'?detail:row;
    expect(await containers.locator(`[data-account-field="${field.key}"]`).count()).toBeGreaterThan(0);
  }
  const compactPermission=row.locator('input.cw-switch[data-permission]').first(),compactControl=compactPermission.locator('xpath=..'),compactTrack=compactControl.locator('.cw-switch-track');
  await expect(compactPermission).toHaveAttribute('role','switch');await expect(compactControl).toHaveClass(/\bcw-switch-control\b/);await expect(compactTrack).toHaveCSS('background-color',await compactPermission.isChecked()?checkColors.accent:checkColors.line);
  const compactBox=await compactControl.boundingBox(),trackBox=await compactTrack.boundingBox();expect(compactBox.height).toBeGreaterThanOrEqual(42);expect(trackBox.width).toBe(34);expect(trackBox.height).toBe(20);
  const compactBefore=await compactPermission.isChecked();await compactPermission.focus();await page.keyboard.press('Space');await expect(compactPermission).toBeChecked({checked:!compactBefore});await expect(compactTrack).toHaveCSS('background-color',compactBefore?checkColors.line:checkColors.accent);await page.keyboard.press('Space');await expect(compactPermission).toBeChecked({checked:compactBefore});
  const fixedPermission=row.locator('.leave-employee-access input.cw-switch'),fixedTrack=fixedPermission.locator('xpath=..').locator('.cw-switch-track');await expect(fixedPermission).toBeDisabled();await expect(fixedPermission).toHaveAttribute('role','switch');await expect(fixedTrack).toHaveCSS('background-color',checkColors.success);
  const accountType=row.locator('.account-type-select'),excluded=row.locator('.leave-shared-excluded');await expect(excluded).toHaveClass(/\bcw-state-pill\b/);await expect(excluded).toHaveAttribute('data-tone','neutral');await expect(excluded).toBeHidden();await accountType.selectOption('shared');await expect(excluded).toBeVisible();await expect(excluded).toHaveCSS('background-color',checkColors.raised);await expect(excluded).toHaveCSS('color',checkColors.muted);await accountType.selectOption('employee');await expect(excluded).toBeHidden();
  await add.locator('[name="Name"]').fill('입력 유지 검증');
  await add.locator('[name="Email"]').fill('new-browser@example.test');
  await add.locator('[name="HireDate"]').fill('2025-01-01');
  await add.locator('[name="DepartmentId"]').selectOption({label:'개발'});
  await add.locator('[name="ProjectIds"]').first().check();
  await add.locator('[name="IsPrivate"]').check();
  await expect(addPrivacyControl).toHaveCSS('background-color',checkColors.active);
  await add.locator('[name="AccountType"]').selectOption('shared');
  await expect(add.locator('[name="HireDate"]')).toBeDisabled();
  await expect(add.locator('[name="DepartmentId"]')).toBeDisabled();
  await assertPortalControls(add);
  await add.locator('[name="AccountType"]').selectOption('employee');
  await expect(add.locator('[name="HireDate"]')).toHaveValue('2025-01-01');
  await expect(add.locator('[name="ProjectIds"]').first()).toBeChecked();
  await expect(add.locator('[name="IsPrivate"]')).toBeChecked();
  const names=await add.evaluate(form=>[...new FormData(form).keys()]);
  for(const field of accountFields.filter(f=>f.key!=='Permissions'))expect(names).toContain(field.key);
  expect(new Set(names.filter(n=>n==='IsPrivate')).size).toBe(1);
  await add.screenshot({path:info.outputPath('account-create.png'),animations:'disabled'});
  await add.evaluate(node=>window.scrollTo({top:node.getBoundingClientRect().top+scrollY-80,behavior:'instant'}));
  await page.screenshot({path:info.outputPath('account-create-viewport.png'),animations:'disabled'});
  await row.locator('[data-detail-toggle]').last().click();
  await expect(detail).toBeVisible();
  const privacy=detail.locator('[name$=".IsPrivate"]');
  await expect(privacy).toHaveClass(/\bcw-checkbox\b/);await expect(privacy.locator('xpath=..')).toHaveClass(/\bcw-check-control\b/);expect((await privacy.boundingBox()).width).toBe(18);await expect(privacy).toBeChecked();await privacy.uncheck();
  await expect(row.locator('[data-privacy-summary]')).toHaveText('일반 공개');
  await expect(page.locator('[data-dirty-count]')).toHaveText('1');
  await assertPortalControls(add);await assertPortalControls(detail);await assertPortalControls(row);
  await detail.screenshot({path:info.outputPath('account-edit.png'),animations:'disabled'});
  await detail.evaluate(node=>{node.closest('.cw-table-scroll').scrollLeft=0;window.scrollTo({top:node.getBoundingClientRect().top+scrollY-80,behavior:'instant'});});
  expect(await detail.locator('[data-account-field="Name"]').evaluate(node=>node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(60);
  await page.screenshot({path:info.outputPath('account-edit-viewport.png'),animations:'disabled'});
  const scroll=page.getByRole('region',{name:'회사 계정 권한 표'});
  await scroll.focus();await expect(scroll).toBeFocused();
  if(width===320){await scroll.evaluate(node=>{node.scrollLeft=0;});await page.keyboard.press('ArrowRight');await expect.poll(()=>scroll.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);}
  await page.locator('[data-reset-all]').first().click();await page.locator('[data-confirm-apply]').click();
  await expect(privacy).toBeChecked();await expect(row.locator('[data-privacy-summary]')).toHaveText('비공개 직원');
  await expect(page.locator('[data-dirty-count]')).toHaveText('0');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});
