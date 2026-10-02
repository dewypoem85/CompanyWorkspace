import { test, expect } from '@playwright/test';
import { assertCsControls, assertCsStatePill } from './support/cs-controls.mjs';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { root } from '../build-ui.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { createProductCommandApi } from '../../apps/cs/lib/product-command-api.js';
import { createMockProductPlayFabClient } from '../../apps/cs/lib/product-playfab.js';
const user={id:'1',name:'검증 직원',email:'ui@example.test',role:'admin'};
const context={authenticated:true,isAdmin:true,user,profiles:{},projects:[],projectIcons:{},employees:[],services:[{key:'cs',name:'CS',href:'/workspace/cs'}]};
async function fixture(page,info,{write=true}={}){
  mkdirSync(info.outputDir,{recursive:true});const dataDir=mkdtempSync(resolve(info.outputDir,'audit-'));
  const errors=[],unhandled=[],requests=[],writes=[],clients={live:createMockProductPlayFabClient(),test:createMockProductPlayFabClient()};
  let held='',release=null,override=null,transform=(a,v)=>v,failId='';
  for(const [environment,client] of Object.entries(clients)){
    const update=client.updateUserReadOnlyData;client.updateUserReadOnlyData=async args=>{writes.push({environment,...args});if(args.playFabId===failId)throw Error('synthetic write failure');return update(args);};
  }
  const api=createProductCommandApi({dataDir,environmentClients:clients,liveEnabled:write});
  if(!write)for(const env of Object.values(api.environments)){env.client.mode='live';env.liveEnabled=false;}
  const base={appId:'2712460',sandbox:false,refundEnabled:false,apiConfigured:false,csrfToken:'synthetic',currentUser:user};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/config')return route.fulfill({json:base});
    if(path.startsWith('/api/playfab/product-commands/')){
      const action=path.split('/').at(-1),body=req.postDataJSON();requests.push({action,body});if(held===action)await new Promise(done=>{release=done;});
      const special=override?.(action,body);if(special)return route.fulfill(special);
      try{const result=await api.handle({path,body,authenticatedUser:user,requestId:'synthetic',ip:'127.0.0.1'});return route.fulfill({status:result.statusCode,json:transform(action,result.payload)});}
      catch(error){return route.fulfill({status:error.statusCode||500,json:{error:error.message}});}
    }
    if(req.method()!=='GET'){unhandled.push(path);return route.abort();}
    const shared={'/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css','/images/company-logo.png':'apps/portal/wwwroot/images/company-logo.png'}[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:{'.css':'text/css','.png':'image/png'}[extname(shared)]||'application/javascript'});
    const asset=resolvePublicAsset(resolve(root,'apps/cs/public'),path);if(asset)return route.fulfill({body:readFileSync(asset.filePath),contentType:asset.contentType});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  return {clients,api,base,errors,unhandled,requests,writes,fail:id=>{failId=id;},override:fn=>{override=fn;},transform:fn=>{transform=fn;},hold:action=>{held=action;release=null;},get pending(){return Boolean(release);},release:()=>{held='';release?.();release=null;}};
}
async function open(page){await page.goto('https://cs.workspace.test/products');await expect(page.locator('#previewButton')).toBeEnabled();}
async function preview(page,environment='live',ids='AAAA\nBBBB'){
  await page.locator('#environmentSelect').selectOption(environment);await page.locator('#uidInput').fill(ids);await page.locator('#productMemo').fill('격리 상품 명령 검증');await page.locator('#currencyGem').fill('125');await page.locator('#currencyMileage').fill('30');
  await page.locator('#previewButton').click();await expect(page.locator('#previewCard')).toBeVisible();await expect(page.locator('#productFields')).toBeEnabled();
}
async function confirm(page){await page.locator('#openConfirmButton').click();await expect(page.locator('.cw-confirm')).toBeVisible();}
async function apply(page){await page.locator('[data-confirm-apply]').click();await expect(page.locator('.cw-confirm')).toHaveCount(0);}
async function lookup(page,ids='AAAA'){if(await page.locator('#managePanel').isHidden())await page.locator('#manageTab').click();await page.locator('#manageUidInput').fill(ids);await page.locator('#lookupButton').click();await expect(page.locator('#manageRows tr')).not.toHaveCount(0);await expect(page.locator('#productFields')).toBeEnabled();}

for(const environment of ['live','test'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`Product common execution ${environment} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,info);await open(page);
  const raised=await page.evaluate(()=>{const node=document.createElement('span');node.style.backgroundColor='var(--cw-raised)';document.body.append(node);const color=getComputedStyle(node).backgroundColor;node.remove();return color;});
  const active=await page.evaluate(()=>{const node=document.createElement('span');node.style.backgroundColor='var(--cw-active)';document.body.append(node);const color=getComputedStyle(node).backgroundColor;node.remove();return color;});
  expect(raised).not.toBe('rgba(0, 0, 0, 0)');
  await assertCsControls(page);
  await page.locator('#charactersInput').fill('invalid-id');
  await expect(page.locator('.product-input-results-wrap')).toHaveCSS('background-color',raised);
  await expect(page.locator('.product-result-visual').first()).toHaveCSS('background-color',raised);
  if(width<651){
    await expect(page.locator('.product-result-copy strong').first()).toHaveCSS('white-space','normal');
    await expect(page.locator('.product-result-status').first()).toHaveCSS('grid-column-start','2');
    expect(await page.locator('.product-result-copy strong').first().evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  }
  await page.locator('.product-input-results-wrap').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('product-input-theme.png'),animations:'disabled'});
  await page.locator('#charactersInput').fill('');await preview(page,environment);
  await assertCsStatePill(page,'#productModeBadge','warning');await assertCsStatePill(page,'#previewBadge',environment==='live'?'danger':'success');
  const dryRun=page.locator('#dryRunCheck'),dryRunControl=dryRun.locator('xpath=..');
  await expect(dryRun).toHaveClass(/\bcw-checkbox\b/);await expect(dryRunControl).toHaveClass(/\bcw-check-control\b/);expect((await dryRun.boundingBox()).width).toBe(18);
  await expect(dryRunControl).toHaveCSS('background-color',active);await dryRunControl.screenshot({path:info.outputPath('dry-run-selected.png'),animations:'disabled'});
  await expect(page.locator('.preview-table code').first()).toHaveCSS('background-color',raised);
  await confirm(page);await expect(page.locator('.cw-confirm')).toContainText('Dry Run');await page.keyboard.press('Escape');await expect(page.locator('#openConfirmButton')).toBeFocused();expect(f.writes).toHaveLength(0);
  await dryRun.uncheck();await page.mouse.move(0,0);await expect(dryRunControl).toHaveCSS('background-color',raised);await dryRunControl.screenshot({path:info.outputPath('dry-run-unselected.png'),animations:'disabled'});await confirm(page);await expect(page.locator('.cw-confirm')).toContainText('AAAA');await expect(page.locator('.cw-confirm')).toContainText('BBBB');await page.screenshot({path:info.outputPath('product-confirm.png'),animations:'disabled'});
  f.hold('execute');await apply(page);await expect.poll(()=>f.pending).toBe(true);await expect(page.locator('#uidInput')).toBeDisabled();await expect(page.locator('#manageMemo')).toBeDisabled();f.release();
  await expect(page.locator('#resultRows tr')).toHaveCount(2);await expect(page.locator('#productFields')).toBeEnabled();await expect(page.locator('#openConfirmButton')).toBeDisabled();
  expect(f.writes).toHaveLength(2);expect(f.writes.every(w=>w.environment===environment)).toBe(true);expect(f.clients[environment].snapshot().AAAA.data['지급'].value).toContain('125');expect(f.clients[environment].snapshot().AAAA.data['지급'].value).toContain('"마일리지":30');
  await expect(page.locator('#uidInput')).toHaveValue('AAAA\nBBBB');await expect(page.locator('#productMessageBox')).toContainText('게임 내 지급·회수 완료를 의미하지 않습니다');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.locator('#resultCard').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('product-result.png'),animations:'disabled'});expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});
test('Product tabs preserve drafts and the execution summary follows current input',async({page},info)=>{
  const f=await fixture(page,info);f.api.environments.live.client.mode='live';await page.setViewportSize({width:1440,height:900});await open(page);
  await expect(page.locator('#productMessageBox')).toBeHidden();await expect(page.locator('#commandPanel')).toBeVisible();await expect(page.locator('#managePanel')).toBeHidden();
  await page.locator('#operationSelect').selectOption('revoke');await page.locator('#uidInput').fill('AAAA\nbad!');await page.locator('#currencyGem').fill('10');await page.locator('#charactersInput').fill('21');
  await expect(page.locator('#executionEnvironment')).toHaveText('라이브 서버');await expect(page.locator('#executionOperation')).toHaveText('회수');
  await expect(page.locator('#executionTargets')).toHaveText('유효 1명 · 오류 1명');await expect(page.locator('#executionCommands')).toHaveText('입력 2개');await expect(page.locator('#executionRisk')).toContainText('실제 쓰기 활성화');
  await page.locator('#manageTab').click();await expect(page.locator('#managePanel')).toBeVisible();await expect(page.locator('#commandPanel')).toBeHidden();
  await page.locator('#manageUidInput').fill('BBBB');await page.locator('#commandTab').click();await expect(page.locator('#uidInput')).toHaveValue('AAAA\nbad!');await expect(page.locator('#currencyGem')).toHaveValue('10');
  await page.locator('#previewButton').click();await expect(page.locator('#uidInput')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#uidInputError')).toContainText('UID 형식 오류');await expect(page.locator('[data-toast-id="product-validation"]')).toBeVisible();await expect(page.locator('#uidInput')).toBeFocused();
  await page.locator('#uidInput').fill('AAAA');await expect(page.locator('[data-toast-id="product-validation"]')).toHaveCount(0);await expect(page.locator('#uidInputError')).toHaveCount(0);
  await page.locator('#productMemo').fill('상품 값 검증');await page.locator('#charactersInput').fill('invalid-id');await page.locator('#previewButton').click();await expect(page.locator('#charactersInput')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#charactersInputError')).toContainText('숫자 ID');await expect(page.locator('[data-toast-id="product-validation"]')).toBeVisible();await expect(page.locator('#charactersInput')).toBeFocused();
  await page.locator('#charactersInput').fill('21');await expect(page.locator('[data-toast-id="product-validation"]')).toHaveCount(0);
  await page.setViewportSize({width:640,height:900});await expect(page.locator('#executionSummary')).toHaveCSS('position','static');expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});
test('Product dry-run, merge approval and snapshot drift retain existing server semantics',async({page},info)=>{
  const f=await fixture(page,info);await f.clients.live.updateUserReadOnlyData({playFabId:'AAAA',data:{'지급':'{"요청ID":"old","재화":{"젬":2}}','회수':'{"요청ID":"opposite","재화":{"젬":1}}'}});f.writes.length=0;
  await open(page);await preview(page,'live','AAAA');const merge=page.locator('#mergeCheck'),mergeControl=merge.locator('xpath=..');await expect(merge).toHaveClass(/\bcw-checkbox\b/);await expect(mergeControl).toHaveClass(/\bcw-check-control\b/);await merge.check();await expect(mergeControl).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');await mergeControl.screenshot({path:info.outputPath('merge-selected.png'),animations:'disabled'});await confirm(page);await apply(page);await expect(page.locator('#resultRows')).toContainText('Dry Run 성공');expect(f.writes).toHaveLength(0);
  await page.locator('#dryRunCheck').uncheck();await confirm(page);await f.clients.live.updateUserReadOnlyData({playFabId:'AAAA',data:{'회수':'{"요청ID":"changed"}'}});f.writes.length=0;await apply(page);
  await expect(page.locator('#resultRows')).toContainText('건너뜀');expect(f.writes).toHaveLength(0);await expect(page.locator('#productMessageBox')).toContainText('미적용 1명');
});
test('Product mileage revoke merges the existing amount and writes the revoke key',async({page},info)=>{
  const f=await fixture(page,info);await f.clients.live.updateUserReadOnlyData({playFabId:'AAAA',data:{'회수':'{"요청ID":"old","재화":{"마일리지":25}}'}});f.writes.length=0;
  await open(page);await page.locator('#operationSelect').selectOption('revoke');await page.locator('#uidInput').fill('AAAA');await page.locator('#productMemo').fill('마일리지 회수 검증');await page.locator('#currencyMileage').fill('75');await page.locator('#previewButton').click();
  await expect(page.locator('#previewCard')).toBeVisible();const merged=JSON.parse(await page.locator('#previewRows td:nth-child(4) code').textContent());expect(merged['재화']['마일리지']).toBe(100);await page.locator('#mergeCheck').check();await page.locator('#dryRunCheck').uncheck();await confirm(page);await expect(page.locator('.cw-confirm')).toContainText('마일리지 75');await apply(page);
  const stored=JSON.parse(f.clients.live.snapshot().AAAA.data['회수'].value);expect(stored['재화']['마일리지']).toBe(100);expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});
test('Product failed UID retry retains request IDs and original execution mode',async({page},info)=>{
  const f=await fixture(page,info);f.fail('BBBB');await open(page);await preview(page);await page.locator('#dryRunCheck').uncheck();await confirm(page);await apply(page);await expect(page.locator('#retryFailedButton')).toBeVisible();await expect(page.locator('#productFields')).toBeEnabled();const ids=await page.locator('#resultRows td:nth-child(2)').allTextContents();
  f.fail('');await page.locator('#dryRunCheck').check();await page.locator('#retryFailedButton').click();await expect(page.locator('.cw-confirm')).toContainText('실패 UID 재시도');await apply(page);await expect(page.locator('#resultRows')).toContainText('재시도 성공');expect(await page.locator('#resultRows td:nth-child(2)').allTextContents()).toEqual(ids);
  const sent=f.requests.filter(r=>r.action==='execute');expect(sent).toHaveLength(2);expect(sent[1].body.playFabIds).toEqual(['BBBB']);expect(sent[1].body.dryRun).toBe(false);expect(sent[1].body.previewToken).toBe(sent[0].body.previewToken);expect(f.errors).toEqual([]);
});
for(const failure of ['incomplete','html'])test(`Product ${failure} acknowledgement locks writes and retains draft`,async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await page.locator('#dryRunCheck').uncheck();await confirm(page);
  if(failure==='incomplete')f.transform((action,value)=>action==='execute'?{...value,results:value.results.slice(0,1)}:value);else f.override(action=>action==='execute'?{status:524,contentType:'text/html',body:'Timeout'}:null);
  await apply(page);await expect(page.locator('#productMessageBox')).toContainText('미확정');await expect(page.locator('#previewButton')).toBeDisabled();await expect(page.locator('#openConfirmButton')).toBeDisabled();await expect(page.locator('#uidInput')).toHaveValue('AAAA\nBBBB');await expect(page.locator('#lookupButton')).toBeEnabled();expect(f.errors).toEqual([]);
});
test('Product deletion preserves opposite key and read failure retries only the read',async({page},info)=>{
  const f=await fixture(page,info);await f.clients.live.updateUserReadOnlyData({playFabId:'AAAA',data:{'지급':'{"요청ID":"original","huge":9223372036854775807}','회수':'{"요청ID":"opposite"}'}});f.writes.length=0;
  await open(page);await lookup(page);await expect(page.locator('#manageRows')).toContainText('9223372036854775807');await page.locator('#manageMemo').fill('격리 삭제 사유');await page.locator('[data-command-delete]').first().click();await expect(page.locator('.cw-confirm')).toContainText('9223372036854775807');
  f.override(action=>action==='lookup'?{status:503,json:{error:'조회 장애'}}:null);await apply(page);await expect(page.locator('#manageMessageBox')).toContainText('삭제 확인');await expect(page.locator('#manageMessageBox')).toHaveAttribute('data-state-kind','success');await expect(page.locator('[data-command-delete]').first()).toBeDisabled();
  f.override(null);await page.getByRole('button',{name:'명령 상태 재확인'}).click();await expect(page.locator('#manageMessageBox')).toContainText('다시 조회');expect(f.writes).toHaveLength(1);expect(f.clients.live.snapshot().AAAA.data['지급']).toBeUndefined();expect(f.clients.live.snapshot().AAAA.data['회수'].value).toContain('opposite');expect(f.errors).toEqual([]);
});
test('Product JSON copy uses the shared clipboard and its compatibility fallback',async({page},info)=>{
  const f=await fixture(page,info);const value='{"요청ID":"copy","huge":9223372036854775807}';await f.clients.live.updateUserReadOnlyData({playFabId:'AAAA',data:{'지급':value}});f.writes.length=0;await open(page);await lookup(page);
  const copy=page.getByRole('button',{name:'JSON 복사',exact:true}).first();
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.nativeCopy=text;}}}));await copy.click();
  await expect.poll(()=>page.evaluate(()=>window.nativeCopy)).toBe(value);await expect(page.locator('[data-toast-id="product-copy"]')).toContainText('JSON을 복사했습니다.');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=command=>{window.fallbackCommand=command;window.fallbackCopy=document.activeElement.value;return true;};});
  await copy.click();await expect.poll(()=>page.evaluate(()=>window.fallbackCopy)).toBe(value);await expect.poll(()=>page.evaluate(()=>window.fallbackCommand)).toBe('copy');
  await expect(copy).toBeEnabled();await expect(page.locator('textarea[aria-hidden="true"]')).toHaveCount(0);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});
test('Product confirmation rejects changed input and account scope closes dialog',async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await confirm(page);await page.locator('#currencyGem').evaluate(node=>{node.value='999';});await page.locator('[data-confirm-apply]').click();await expect(page.locator('.cw-confirm')).toContainText('입력 또는 계정');
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('.cw-confirm')).toHaveCount(0);await expect(page.locator('#uidInput')).toHaveValue('');await expect(page.locator('#previewRows')).toBeEmpty();await expect(page.locator('#uidInput')).toBeDisabled();await expect(page.locator('#productFields')).toHaveJSProperty('disabled',true);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Product expired preview and changed write config are rejected before confirmation',async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+20*60_000;});
  await page.locator('#openConfirmButton').click();await expect(page.locator('#productMessageBox')).toContainText('만료');expect(f.requests.filter(r=>r.action==='execute')).toHaveLength(0);
  await open(page);await preview(page);await page.locator('#dryRunCheck').uncheck();f.api.environments.live.client.mode='live';f.api.environments.live.liveEnabled=false;
  await page.locator('#openConfirmButton').click();await expect(page.locator('#productMessageBox')).toContainText('설정이 변경');await expect(page.locator('.cw-confirm')).toHaveCount(0);expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Product read-only setup still supports dry-run while native controls prevent writes',async({page},info)=>{
  const f=await fixture(page,info,{write:false});await open(page);await preview(page);await expect(page.locator('#dryRunCheck')).toBeChecked();await expect(page.locator('#dryRunCheck')).toBeDisabled();
  await confirm(page);await apply(page);await expect(page.locator('#resultRows')).toContainText('Dry Run 성공');expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const event of ['scope','dispose'])test(`Product ${event} while decoding a non-abortable reply does not apply old results`,async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await page.locator('#dryRunCheck').uncheck();await confirm(page);
  await page.evaluate(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/product-commands/execute')){const value=await response.json();response.json=()=>new Promise(resolve=>{window.releaseProductJson=()=>resolve(value);});}return response;};});
  await apply(page);await expect.poll(()=>page.evaluate(()=>typeof window.releaseProductJson)).toBe('function');
  await page.evaluate(event=>{if(event==='scope')document.dispatchEvent(new Event('workspace-entity-scope-change'));else window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.releaseProductJson();},event);
  await expect(page.locator('#resultRows')).toBeEmpty();await expect(page.locator('#uidInput')).toBeDisabled();
  if(event==='scope')await expect(page.locator('#uidInput')).toHaveValue('');else await expect(page.locator('#uidInput')).toHaveValue('AAAA\nBBBB');expect(f.requests.filter(r=>r.action==='execute')).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('Product observation timeout keeps execution uncertain, including after a fresh lookup',async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await page.locator('#dryRunCheck').uncheck();await confirm(page);
  await page.evaluate(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===45_000?100:ms,...args);});
  f.hold('execute');await apply(page);await expect.poll(()=>f.pending).toBe(true);await expect(page.locator('#productMessageBox')).toContainText('서버 처리 취소를 의미하지 않습니다');f.release();
  await lookup(page);await expect(page.locator('#previewButton')).toBeDisabled();await expect(page.locator('[data-command-delete]').first()).toBeDisabled();expect(f.requests.filter(r=>r.action==='execute')).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('Product preview timeout permits only an explicit fresh read',async({page},info)=>{
  const f=await fixture(page,info);await open(page);
  await page.locator('#uidInput').fill('AAAA');await page.locator('#productMemo').fill('조회 관찰 제한 검증');await page.locator('#currencyGem').fill('125');
  await page.evaluate(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===45_000?100:ms,...args);});
  f.hold('preview');await page.locator('#previewButton').click();await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#productMessageBox')).toContainText('응답 확인 시간이 초과되었습니다');await expect(page.locator('#previewCard')).toBeHidden();expect(f.requests.filter(r=>r.action==='preview')).toHaveLength(1);
  f.release();await page.locator('#previewButton').click();await expect(page.locator('#previewCard')).toBeVisible();expect(f.requests.filter(r=>r.action==='preview')).toHaveLength(2);expect(f.requests.filter(r=>['execute','delete'].includes(r.action))).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const read of ['preview','lookup'])test(`Product late decoded ${read} is rejected after account scope change`,async({page},info)=>{
  const f=await fixture(page,info);await open(page);
  await page.evaluate(read=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).endsWith('/product-commands/'+read)){const value=await response.json();response.json=()=>new Promise(resolve=>{window.releaseProductReadJson=()=>resolve(value);});}return response;};},read);
  if(read==='preview'){
    await page.locator('#uidInput').fill('AAAA');await page.locator('#productMemo').fill('늦은 미리보기 검증');await page.locator('#currencyGem').fill('125');await page.locator('#previewButton').click();
  }else{
    await page.locator('#manageTab').click();await page.locator('#manageUidInput').fill('AAAA');await page.locator('#lookupButton').click();
  }
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseProductReadJson)).toBe('function');
  await page.evaluate(()=>{document.dispatchEvent(new Event('workspace-entity-scope-change'));window.releaseProductReadJson();});
  await expect(page.locator('#previewRows')).toBeEmpty();await expect(page.locator('#manageRows')).toBeEmpty();await expect(page.locator('#uidInput')).toBeDisabled();await expect(page.locator('#productFields')).toHaveJSProperty('disabled',true);
  expect(f.requests.filter(request=>request.action===read)).toHaveLength(1);expect(f.requests.filter(request=>['execute','delete'].includes(request.action))).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const status of [401,403])test(`Product ${status} lookup clears stale private results and locks actions`,async({page},info)=>{
  const f=await fixture(page,info);await open(page);await preview(page);await lookup(page);f.override(action=>action==='lookup'?{status,contentType:'text/html',body:'Denied'}:null);
  await page.locator('#lookupButton').click();await expect(page.locator('#manageMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#manageRows')).toBeEmpty();await expect(page.locator('#previewRows')).toBeEmpty();await expect(page.locator('#uidInput')).toBeDisabled();expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Product repeated identical read failure keeps a rendered common state and previous rows',async({page},info)=>{
  const f=await fixture(page,info);await open(page);await lookup(page);f.override(action=>action==='lookup'?{status:503,json:{error:'같은 조회 장애'}}:null);
  for(let attempt=0;attempt<2;attempt++){await page.locator('#lookupButton').click();await expect(page.locator('#manageMessageBox')).toContainText('같은 조회 장애');await expect(page.locator('#manageMessageBox')).toHaveClass(/cw-feedback/);await expect(page.locator('#manageRows tr')).toHaveCount(2);}
  expect(f.errors).toEqual([]);
});
