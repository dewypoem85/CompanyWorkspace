import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { root } from '../build-ui.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { createPlayerDataApi, encodeStoredValue, decodeStoredValue } from '../../apps/cs/lib/player-data-api.js';
import { createMockProductPlayFabClient } from '../../apps/cs/lib/product-playfab.js';
import { prettyPrintJsonLossless } from '../../apps/cs/public/json-lossless.js';
import { assertCsControls, assertCsStatePill } from './support/cs-controls.mjs';

const uid='SYNTHETIC_PLAYER_1', oddKey='same["9007199254740993"]';
const raw='{"gem":123,"counter":9223372036854775807,"escaped":"\\uAC00","rows":['+Array.from({length:100},(_,i)=>`{"index":${i},"name":"검증"}`).join(',')+']}';
const context={authenticated:true,isAdmin:true,csrfToken:'synthetic-only',user:{id:1,name:'검증 직원',email:'ui@example.test',role:'admin'},profiles:{},projects:[],projectIcons:{},employees:[],services:[{key:'cs',name:'CS',href:'/workspace/cs'}]};

// Real browser module + real player-data handler. Only PlayFab transport is in-memory.
// Every network request is intercepted; no production identity, credentials or mutation.
async function fixture(page,info) {
  const errors=[],unhandled=[],requests=[],clients={};let hold='',release=null, transform=(action,result)=>result;
  for(const env of ['live','test'])clients[env]=createMockProductPlayFabClient({seed:{[uid]:{
    userData:{'SaveData-Compression':encodeStoredValue('SaveData-Compression',raw),[oddKey]:`${env} user`,LoginToken:'synthetic-token'},
    data:{[oddKey]:`${env} readonly`},internalData:{[oddKey]:`${env} internal`}
  }}});
  const dataDir=info.outputPath('synthetic-audit');await mkdir(dataDir,{recursive:true});
  const api=createPlayerDataApi({dataDir,environmentClients:clients});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/config')return route.fulfill({json:{csrfToken:'synthetic-only',currentUser:context.user}});
    if(path.startsWith('/api/playfab/player-data/')){
      const action=path.split('/').at(-1),body=request.postDataJSON();requests.push({action,body,csrf:request.headers()['x-csrf-token']});
      if(hold===action)await new Promise(resolve=>{release=resolve;});
      try {
        const result=await api.handle({path,body,authenticatedUser:context.user,requestId:`synthetic-${requests.length}`,ip:'127.0.0.1'});
        return route.fulfill({status:result.statusCode,json:transform(action,result.payload)});
      } catch(error){return route.fulfill({status:error.statusCode||500,json:{error:error.message}});}
    }
    if(request.method()!=='GET'){unhandled.push(`${request.method()} ${path}`);return route.abort();}
    const shared={'/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css','/images/company-logo.png':'apps/portal/wwwroot/images/company-logo.png'}[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:{'.css':'text/css','.png':'image/png'}[extname(shared)]||'application/javascript'});
    const asset=resolvePublicAsset(resolve(root,'apps/cs/public'),path);
    if(asset)return route.fulfill({body:readFileSync(asset.filePath),contentType:asset.contentType});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  return {errors,unhandled,requests,clients,transform:fn=>{transform=fn;},hold:action=>{hold=action;release=null;},get pending(){return Boolean(release);},release:()=>{hold='';release?.();release=null;}};
}
async function lookup(page,env='test') {
  await page.goto('https://cs.workspace.test/players');
  await expect(page.locator('#environmentSelect')).toBeEnabled();
  await page.locator('#environmentSelect').selectOption(env);await page.locator('#playFabIdInput').fill(uid);
  await page.locator('#lookupButton').click();await expect(page.locator('.data-store-section')).toHaveCount(3);
  await expect(page.locator('#lookupButton')).toBeEnabled();
}
function row(page,store,key){return page.locator('tr[data-store][data-key]').filter({has:page.locator('button[data-cw-disclosure]').filter({hasText:key})}).filter({has:page.locator(`button[data-store="${store}"]`)});}
function trigger(page,store,key){return row(page,store,key).locator('[data-cw-disclosure]').first();}
async function edit(page,value){await page.locator('#jsonEditor').fill(value);await page.locator('#reasonInput').fill('격리 CS 검증');await page.locator('#confirmCheck').check();}
async function confirmSave(page){await page.locator('#saveButton').click();await page.locator('[data-confirm-apply]').click();}
async function discard(page, action, accept=true){
  await action();const dialog=page.getByRole('dialog',{name:'편집 내용 버리기',exact:true});
  await expect(dialog).toBeVisible();await dialog.locator(accept?'[data-confirm-apply]':'[data-confirm-cancel]').click();
  await expect(dialog).toHaveCount(0);
}

test('Player lookup validation shows an anchored error, persistent toast and focus',async({page},info)=>{
  const f=await fixture(page,info);await page.goto('https://cs.workspace.test/players');await expect(page.locator('#lookupButton')).toBeEnabled();await expect(page.locator('#messageBox')).toBeHidden();
  await page.locator('#lookupButton').click();
  await expect(page.locator('#playFabIdInput')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#playFabIdError')).toContainText('올바른 PlayFab UID');await expect(page.locator('[data-toast-id="player-validation"]')).toBeVisible();await expect(page.locator('#playFabIdInput')).toBeFocused();
  await page.locator('#playFabIdInput').fill(uid);await expect(page.locator('[data-toast-id="player-validation"]')).toHaveCount(0);await expect(page.locator('#playFabIdError')).toBeHidden();expect(f.requests.filter(request=>request.action==='lookup')).toHaveLength(0);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])for(const action of ['key','reset','environment','lookup'])
test(`CS shared draft discard ${action} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,info),native=[];page.on('dialog',dialog=>{native.push(dialog.type());void dialog.dismiss();});
  await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'보존할 수정 원문 9223372036854775807');
  const editor=page.locator('#jsonEditor'),source=trigger(page,'readonly',oddKey),other=trigger(page,'internal',oddKey);
  const invoke=()=>action==='key'?other.click():action==='environment'?page.locator('#environmentSelect').selectOption('live'):page.locator(action==='reset'?'#resetButton':'#lookupButton').click();
  await invoke();const dialog=page.getByRole('dialog',{name:'편집 내용 버리기',exact:true});
  await expect(dialog).toBeVisible();await expect(editor).toHaveValue('보존할 수정 원문 9223372036854775807');await expect(source).toHaveAttribute('aria-expanded','true');
  await expect(dialog).toContainText(uid);await expect(editor).toBeDisabled();expect(f.requests.filter(r=>r.action==='lookup')).toHaveLength(1);
  const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  expect(await dialog.locator('[data-confirm-apply]').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length;})).toBe(1);
  if(action==='key'){
    await other.evaluate(node=>node.click());await expect(dialog).toHaveCount(1);
    await page.screenshot({path:info.outputPath('discard-confirm.png'),animations:'disabled'});
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(editor).toBeEnabled();
  await expect(editor).toHaveValue('보존할 수정 원문 9223372036854775807');await expect(page.locator('#reasonInput')).toHaveValue('격리 CS 검증');await expect(page.locator('#confirmCheck')).toBeChecked();
  if(action==='environment')await expect(page.locator('#environmentSelect')).toHaveValue('test');
  await discard(page,invoke);
  if(action==='key'){await expect(editor).toHaveValue('test internal');await expect(other).toHaveAttribute('aria-expanded','true');}
  if(action==='reset')await expect(editor).toHaveValue('test readonly');
  if(action==='environment'){await expect(page.locator('#environmentSelect')).toHaveValue('live');await expect(page.locator('#editorCard')).toBeHidden();}
  if(action==='lookup'){await expect.poll(()=>f.requests.filter(r=>r.action==='lookup').length).toBe(2);await expect(page.locator('[data-toast-id="player-lookup"]')).toBeVisible();await expect(page.locator('#messageBox')).toBeHidden();}
  expect(f.requests.filter(r=>['save','add','delete'].includes(r.action))).toHaveLength(0);expect(native).toEqual([]);expect(f.errors).toEqual([]);
});

for(const interruption of ['scope','dispose','draft','target','panel','filter'])
test(`CS shared draft discard rejects ${interruption} during review`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'확인 대기 원문');
  const other=trigger(page,'internal',oddKey);await other.click();const dialog=page.getByRole('dialog',{name:'편집 내용 버리기',exact:true});await expect(dialog).toBeVisible();
  await dialog.locator('[data-confirm-apply]').evaluate(node=>{window.oldDiscardButton=node;});
  if(interruption==='scope')await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(interruption==='dispose')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(interruption==='draft')await page.locator('#jsonEditor').evaluate(node=>{node.value='더 최근 수정 원문';node.dispatchEvent(new Event('input',{bubbles:true}));});
  if(interruption==='target')await page.locator('#playFabIdInput').evaluate(node=>{node.value='OTHER_PLAYER';});
  if(interruption==='panel')await other.evaluate(node=>{const panel=document.getElementById(node.getAttribute('aria-controls'));panel.replaceWith(panel.cloneNode(true));});
  if(interruption==='filter')await page.locator('#keyFilterInput').evaluate(node=>{node.value='없는키검색';node.dispatchEvent(new Event('input',{bubbles:true}));});
  if(['draft','target'].includes(interruption)){
    await dialog.locator('[data-confirm-apply]').click();await expect(dialog).toContainText('대상 또는 초안이 바뀌었습니다');await dialog.locator('[data-confirm-cancel]').click();
  }else if(interruption==='panel')await dialog.locator('[data-confirm-apply]').click();
  await expect(dialog).toHaveCount(0);await page.evaluate(()=>window.oldDiscardButton.click());
  await expect(other).toHaveAttribute('aria-expanded','false');await expect(page.locator('#jsonEditor')).toHaveValue(interruption==='draft'?'더 최근 수정 원문':'확인 대기 원문');
  expect(f.requests.filter(r=>r.action==='lookup')).toHaveLength(1);expect(f.requests.filter(r=>['save','add','delete'].includes(r.action))).toHaveLength(0);expect(f.errors).toEqual([]);
});

for (const width of [320,1440]) for (const theme of ['light','dark']) test(`Player read states and semantic diff colors ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,info);await lookup(page);
  await expect(page.locator('[data-toast-id="player-lookup"]')).toBeVisible();await expect(page.locator('#messageBox')).toBeHidden();
  await assertCsStatePill(page,'#modeBadge','warning');await expect(page.locator('#csToastRegion')).toHaveCount(0);
  await trigger(page,'user','SaveData-Compression').click();await edit(page,prettyPrintJsonLossless(raw).replace('"gem": 123','"gem": 321'));
  await page.locator('#nextChangeButton').click();
  const pixels=()=>page.locator('#jsonDiffLayer').evaluate(canvas=>{
    const ctx=canvas.getContext('2d'),bytes=ctx.getImageData(10,0,1,canvas.height).data;
    const colors=[];for(let i=0;i<bytes.length;i+=4)if(bytes[i+3])colors.push([...bytes.slice(i,i+4)].join(','));return [...new Set(colors)];
  });
  await expect.poll(pixels).not.toEqual([]);const before=await pixels();
  await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});await expect.poll(pixels).not.toEqual(before);
  await expect(page.locator('#jsonEditor')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await page.emulateMedia({colorScheme:theme});await expect.poll(pixels).toEqual(before);
  await assertCsControls(page);
  const actionGeometry=await page.locator('.row-actions button').evaluateAll(buttons=>buttons.map(button=>{
    const range=document.createRange();range.selectNodeContents(button);const cell=button.closest('td').getBoundingClientRect(),rect=button.getBoundingClientRect();
    return {lines:range.getClientRects().length,inside:rect.left>=cell.left-1&&rect.right<=cell.right+1};
  }));
  for(const geometry of actionGeometry){expect(geometry.lines).toBe(1);expect(geometry.inside).toBe(true);}
  const scroller=page.locator('[data-data-store="user"] .cw-table-scroll');await scroller.focus();
  if(width===320){await page.keyboard.press('ArrowRight');await expect.poll(()=>scroller.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);await scroller.evaluate(node=>{node.scrollLeft=0;});}
  await page.locator('#jsonEditor').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('player-shared-editor.png'),animations:'disabled'});
  await page.locator('#keyFilterInput').fill('존재하지않는키');
  await expect(page.locator('.empty-data[data-state-kind="empty"]')).toHaveCount(3);
  await expect(page.locator('#jsonEditor')).toBeHidden();
  await page.locator('.empty-data').first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('player-empty-state.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.locator('#keyFilterInput').fill('');await trigger(page,'user','SaveData-Compression').click();
  expect(await page.locator('#jsonEditor').inputValue()).toContain('"gem": 321');
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('Player config failure can be retried without automatic login or duplicate identity rendering',async({page},info)=>{
  const f=await fixture(page,info);let fail=true;
  await page.route('**/api/playfab/player-data/config',route=>fail?route.fulfill({json:{environments:{}}}):route.fallback());
  await page.goto('https://cs.workspace.test/players');await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','error');
  await expect(page.locator('#lookupButton')).toBeDisabled();await page.locator('#playFabIdInput').fill(uid);
  fail=false;await page.locator('#messageBox button').click();await expect(page.locator('#lookupButton')).toBeEnabled();await expect(page.locator('#playFabIdInput')).toHaveValue(uid);
  await page.locator('#lookupButton').click();await expect(page.locator('.data-store-section')).toHaveCount(3);
  expect(f.requests.filter(r=>r.action==='lookup')).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('Repeated read errors preserve draft and previous rows, retry performs only reads',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'보존해야 하는 편집 초안');
  let failed=true,attempts=0;
  await page.route('**/api/playfab/player-data/lookup',route=>{attempts++;return failed?route.fulfill({status:503,json:{error:'일시적인 읽기 오류'}}):route.fallback();});
  await discard(page,()=>page.locator('#refreshButton').click());await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','error');
  await expect(page.locator('#jsonEditor')).toHaveValue('보존해야 하는 편집 초안');await expect(page.locator('#saveButton')).toBeDisabled();await expect(page.locator('.data-store-section')).toHaveCount(3);
  await discard(page,()=>page.locator('#messageBox button').click());await expect.poll(()=>attempts).toBe(2);await expect(page.locator('#messageBox')).toHaveClass(/cw-feedback/);await expect(page.locator('#messageBox')).toContainText('일시적인 읽기 오류');
  failed=false;await discard(page,()=>page.locator('#messageBox button').click());await expect(page.locator('[data-toast-id="player-lookup"]')).toBeVisible();await expect(page.locator('#messageBox')).toBeHidden();await expect(page.locator('#jsonEditor')).toHaveValue('test readonly');
  expect(f.requests.filter(r=>['save','add','delete'].includes(r.action))).toHaveLength(0);expect(attempts).toBe(3);expect(f.errors).toEqual([]);
});

for(const status of [401,403]) test(`HTML ${status} read preserves draft but prevents stale token writes`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'권한 확인 전 보존');
  await page.route('**/api/playfab/player-data/lookup',route=>route.fulfill({status,contentType:'text/html',body:'Denied'}));
  await discard(page,()=>page.locator('#refreshButton').click());await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#saveButton')).toBeDisabled();
  await expect(page.locator('#jsonEditor')).toHaveValue('권한 확인 전 보존');expect(f.requests.filter(r=>r.action==='save')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Player read target mismatch and input changes cannot replace the visible snapshot',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();
  f.transform((action,value)=>action==='lookup'?{...value,playFabId:'WRONG_PLAYER'}:value);
  await page.locator('#refreshButton').click();await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','error');await expect(page.locator('#targetUid')).toHaveText(uid);
  f.transform((action,value)=>value);f.hold('lookup');await page.locator('#refreshButton').click();await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#jsonEditor')).toBeDisabled();await page.locator('#jsonEditor').evaluate(node=>{node.value='조회 도중 프로그램으로 바뀐 초안';});
  f.release();await expect(page.locator('#messageBox')).toContainText('조회 중 대상 또는 초안이 바뀌었습니다');await expect(page.locator('#jsonEditor')).toHaveValue('조회 도중 프로그램으로 바뀐 초안');expect(f.errors).toEqual([]);
});

for(const mode of ['scope','dispose'])test(`Player ${mode} rejects old non-abortable JSON without unlocking a newer read`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();
  await page.evaluate(()=>{const fetch=window.fetch;let first=true;window.fetch=async(...args)=>{const response=await fetch(...args);if(first&&String(args[0]).endsWith('/player-data/lookup')){first=false;const data=await response.json();response.json=()=>new Promise(resolve=>{window.releasePlayerJson=()=>resolve(data);});}return response;};});
  await page.locator('#refreshButton').click();await expect.poll(()=>page.evaluate(()=>typeof window.releasePlayerJson)).toBe('function');
  if(mode==='scope'){
    await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','denied');
    f.hold('lookup');await page.locator('#lookupButton').click();await expect.poll(()=>f.pending).toBe(true);
    await page.evaluate(()=>window.releasePlayerJson());await expect(page.locator('#environmentSelect')).toBeDisabled();await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','loading');
    f.release();await expect(page.locator('[data-toast-id="player-lookup"]')).toBeVisible();await expect(page.locator('#messageBox')).toBeHidden();await expect(page.locator('#environmentSelect')).toBeEnabled();
  }else{
    await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));window.releasePlayerJson();});
    await expect(page.locator('#environmentSelect')).toBeDisabled();await expect(page.locator('#jsonEditor')).toHaveValue('test readonly');
  }
  expect(f.requests.filter(r=>r.action==='save')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Player ignored-abort JSON deadline settles before the stale JSON promise',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();
  await page.evaluate(()=>{
    const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===45_000?200:ms,...args);
    const fetch=window.fetch;window.fetch=async(...args)=>{const response=await fetch(...args);if(String(args[0]).endsWith('/player-data/lookup')){const data=await response.json();response.json=()=>new Promise(resolve=>{window.releasePlayerJson=()=>resolve(data);});}return response;};
  });
  await page.locator('#refreshButton').click();await expect.poll(()=>page.evaluate(()=>typeof window.releasePlayerJson)).toBe('function');
  await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','error');await expect(page.locator('#environmentSelect')).toBeEnabled();await expect(page.locator('#messageBox')).toContainText('관찰 시간이 초과');
  await page.evaluate(()=>window.releasePlayerJson());await expect(page.locator('#messageBox')).toHaveAttribute('data-state-kind','error');expect(f.errors).toEqual([]);
});

test('A stale unauthorized body cannot trigger a new login prompt after scope changes',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);
  await page.route('**/api/playfab/player-data/lookup',route=>route.fulfill({status:401,json:{loginUrl:'/synthetic-login',error:'expired'}}));
  await page.evaluate(()=>{
    window.loginPrompts=0;window.CompanyWorkspace.sessionExpired=()=>window.loginPrompts++;
    const fetch=window.fetch;window.fetch=async(...args)=>{const response=await fetch(...args);if(String(args[0]).endsWith('/player-data/lookup')){const data=await response.json();response.json=()=>new Promise(resolve=>{window.releasePlayerJson=()=>resolve(data);});}return response;};
  });
  await page.locator('#refreshButton').click();await expect.poll(()=>page.evaluate(()=>typeof window.releasePlayerJson)).toBe('function');
  await page.evaluate(()=>{document.dispatchEvent(new Event('workspace-entity-scope-change'));window.releasePlayerJson();});
  await expect(page.locator('#messageBox')).toContainText('이전 조회 응답을 적용하지 않습니다');expect(await page.evaluate(()=>window.loginPrompts)).toBe(0);expect(f.errors).toEqual([]);
});

test('Player read timeout is recoverable without dropping the previous editor',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'관찰 중단 뒤에도 보존');
  await page.evaluate(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===45_000?100:ms,...args);});
  f.hold('lookup');await discard(page,()=>page.locator('#refreshButton').click());await expect.poll(()=>f.pending).toBe(true);await expect(page.locator('#messageBox')).toContainText('서버 처리의 취소나 롤백을 뜻하지 않습니다');
  await expect(page.locator('#jsonEditor')).toHaveValue('관찰 중단 뒤에도 보존');await expect(page.locator('#saveButton')).toBeDisabled();f.release();expect(f.errors).toEqual([]);
});

for(const env of ['live','test'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`CS shared player disclosure retains one editor and drafts ${env} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,info);await lookup(page,env);
  const sourceRow=row(page,'user','SaveData-Compression'),buttons=sourceRow.locator('[data-cw-disclosure]'),editor=page.locator('#jsonEditor');
  await buttons.first().focus();await page.keyboard.press('Enter');await expect(editor).toBeVisible();
  await expect(editor).toHaveValue(prettyPrintJsonLossless(raw));const editorNode=await editor.elementHandle();
  const draft=(await editor.inputValue()).replace('"gem": 123','"gem": 321');await edit(page,draft);
  const modifiedChip=page.locator('#diffSummary .diff-chip'),modifiedPalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-warning);background:var(--cw-warning-bg)';const s=getComputedStyle(p),result={color:s.color,background:s.backgroundColor};p.remove();return result;});await expect(modifiedChip).toContainText('수정');await expect(modifiedChip).toHaveClass(/\bcw-state-pill\b/);await expect(modifiedChip).toHaveAttribute('data-tone','warning');await expect(modifiedChip).toHaveCSS('color',modifiedPalette.color);await expect(modifiedChip).toHaveCSS('background-color',modifiedPalette.background);await page.locator('#nextChangeButton').click();await expect(page.locator('#changePosition')).toContainText('1 /');
  await editor.evaluate(node=>node.scrollTo({top:240,left:0,behavior:'instant'}));
  const caret=await editor.evaluate(node=>node.selectionStart),scroll=await editor.evaluate(node=>node.scrollTop);
  await page.locator('#detailPanel').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:info.outputPath('player-json-detail.png'),animations:'disabled'});
  await page.locator('#closeDetailButton').click();await expect(editor).toBeHidden();
  for(const button of await buttons.all())await expect(button).toHaveAttribute('aria-expanded','false');
  await buttons.first().click();await expect(editor).toHaveValue(draft);await expect(page.locator('#reasonInput')).toHaveValue('격리 CS 검증');await expect(page.locator('#confirmCheck')).toBeChecked();
  const active=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--cw-active)';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;});
  await expect(page.locator('#detailPanel .confirm-check')).toHaveCSS('background-color',active);
  await page.locator('#detailPanel .confirm-check').screenshot({path:info.outputPath('confirmation-selected.png'),animations:'disabled'});
  expect(await editor.evaluate(node=>node.selectionStart)).toBe(caret);expect(await editor.evaluate(node=>node.scrollTop)).toBe(scroll);
  const filter=page.locator('#keyFilterInput');await filter.fill('없는키검색');await expect(editor).toBeHidden();await expect(filter).toBeFocused();
  for(const button of await buttons.all())await expect(button).toHaveAttribute('aria-expanded','false');
  await filter.fill('');await expect(editor).toBeHidden();await buttons.first().click();await expect(editor).toHaveValue(draft);
  const other=trigger(page,'readonly',oddKey);await discard(page,()=>other.click(),false);await expect(editor).toHaveValue(draft);await expect(other).toHaveAttribute('aria-expanded','false');
  await discard(page,()=>other.click());await expect(editor).toHaveValue(`${env} readonly`);await expect(page.locator('[data-cw-disclosure-panel]:visible')).toHaveCount(1);
  expect(await editor.evaluate((node,old)=>node===old,editorNode)).toBe(true);await expect(page.locator('#keyMeta')).toContainText('읽기 전용 데이터');
  const internal=trigger(page,'internal',oddKey);await internal.click();await expect(editor).toHaveValue(`${env} internal`);await expect(page.locator('#reasonInput')).toHaveValue('');await expect(page.locator('#confirmCheck')).not.toBeChecked();
  await page.locator('#jsonEditor').scrollIntoViewIfNeeded();const bounds=await page.locator('#detailPanel').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(-1);
  const layout=await page.locator('#detailPanel').evaluate(node=>{const result=[];for(let el=node;el;el=el.parentElement)result.push({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,container:getComputedStyle(el).containerType});return result;});
  expect(bounds.x+bounds.width,JSON.stringify(layout)).toBeLessThanOrEqual(width+1);
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1&&!el.closest('.cw-table-scroll')).map(el=>({tag:el.tagName,id:el.id,cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})).slice(0,20));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth),JSON.stringify({overflow,layout,viewport:await page.evaluate(()=>({width:innerWidth,x:scrollX,client:document.documentElement.clientWidth}))})).toBeLessThanOrEqual(width+1);
  await page.locator('#reasonInput').scrollIntoViewIfNeeded();
  expect(await page.locator('.save-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  const confirmation=page.locator('#detailPanel .confirm-check'),confirmationInput=confirmation.locator('input');
  expect((await confirmation.boundingBox()).height).toBeLessThan(220);
  await expect(confirmation).toHaveClass(/\bcw-check-control\b/);await expect(confirmationInput).toHaveClass(/\bcw-checkbox\b/);
  expect((await confirmationInput.boundingBox()).width).toBe(18);
  const raised=await confirmation.evaluate(node=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--cw-raised)';node.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value;});
  await page.mouse.move(0,0);await expect(confirmation).toHaveCSS('background-color',raised);
  await confirmation.screenshot({path:info.outputPath('confirmation-unselected.png'),animations:'disabled'});
  await page.screenshot({path:info.outputPath('player-inline-editor.png'),animations:'disabled'});
  expect(f.requests.filter(r=>r.action==='lookup')).toHaveLength(1);expect(f.requests.filter(r=>['save','add','delete'].includes(r.action))).toHaveLength(0);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const env of ['live','test'])test(`CS player writes preserve store tokens, compression and pending target ${env}`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page,env);await trigger(page,'user','SaveData-Compression').click();
  const draft=prettyPrintJsonLossless(raw).replace('"gem": 123','"gem": 456');await edit(page,draft);f.hold('save');
  await confirmSave(page);await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#jsonEditor')).toBeDisabled();await expect(page.locator('#environmentSelect')).toBeDisabled();await expect(page.locator('#keyFilterInput')).toBeDisabled();
  await page.locator('#lookupForm').evaluate(node=>node.requestSubmit());expect(f.requests.filter(r=>r.action==='lookup')).toHaveLength(1);
  await page.locator('#saveButton').evaluate(node=>node.click());expect(f.requests.filter(r=>r.action==='save')).toHaveLength(1);f.release();
  await expect(page.locator('#jsonEditor')).toBeEnabled();await expect(page.locator('#changeStatus')).toContainText('변경 없음');await expect(page.locator('#jsonEditor')).toHaveValue(draft);
  const stored=await f.clients[env].getUserData({playFabId:uid});expect(decodeStoredValue('SaveData-Compression',stored.data['SaveData-Compression'].value).value).toBe(draft);
  for(const store of ['readonly','internal']){
    await trigger(page,store,oddKey).click();await edit(page,`${env} ${store} updated`);await confirmSave(page);
    await expect(page.locator('#changeStatus')).toContainText('변경 없음');await expect(page.locator('#jsonEditor')).toHaveValue(`${env} ${store} updated`);
    await expect(page.locator('[data-cw-disclosure-panel]:visible')).toHaveCount(1);
  }
  const saves=f.requests.filter(r=>r.action==='save');expect(saves.map(r=>r.body.dataStore)).toEqual(['user','readonly','internal']);expect(new Set(saves.map(r=>r.body.editToken)).size).toBe(3);expect(saves.every(r=>r.csrf==='synthetic-only'&&r.body.environment===env&&r.body.playFabId===uid)).toBe(true);
  expect((await f.clients[env].getUserReadOnlyData({playFabId:uid})).data[oddKey].value).toBe(`${env} readonly updated`);expect((await f.clients[env].getUserInternalData({playFabId:uid})).data[oddKey].value).toBe(`${env} internal updated`);
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('CS add/delete and failed refresh preserve disclosure relationships and drafts',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'user','SaveData-Compression').click();
  await edit(page,'{"counter":9223372036854775807}');
  await page.route('**/api/playfab/player-data/lookup',route=>route.fulfill({status:503,json:{error:'격리 조회 실패'}}));
  await discard(page,()=>page.locator('#refreshButton').click());await expect(page.locator('#refreshButton')).toBeEnabled();await expect(page.locator('#jsonEditor')).toHaveValue('{"counter":9223372036854775807}');
  await page.unroute('**/api/playfab/player-data/lookup');
  await expect(page.locator('.data-store-section[data-data-store="readonly"] [data-action="add"]')).toBeDisabled();
  await discard(page,()=>page.locator('#refreshButton').click());await expect(page.locator('[data-toast-id="player-lookup"]')).toBeVisible();await expect(page.locator('#messageBox')).toBeHidden();
  const add=page.locator('.data-store-section[data-data-store="readonly"] [data-action="add"]');await add.click();await expect(page.locator('#addDialog')).toBeVisible();await expect(page.getByRole('dialog',{name:'편집 내용 버리기',exact:true})).toHaveCount(0);await expect(page.locator('[data-cw-disclosure-panel]:visible')).toHaveCount(0);
  await page.locator('#addKeyInput').fill('new-key');await page.locator('#addValueInput').fill('일반 문자열');await page.locator('#addReasonInput').fill('격리 추가 검증');await page.locator('#addConfirmCheck').check();await page.locator('#addSubmitButton').click();
  await expect(page.locator('#addDialog')).not.toBeVisible();await expect(page.locator('#jsonEditor')).toHaveValue('일반 문자열');await expect(page.locator('#keyMeta')).toContainText('읽기 전용 데이터 / new-key');
  await row(page,'readonly','new-key').locator('[data-action="delete"]').click();await expect(page.locator('[data-cw-disclosure-panel]:visible')).toHaveCount(0);
  await page.locator('#deleteReasonInput').fill('격리 삭제 검증');await page.locator('#deleteConfirmCheck').check();await page.locator('#deleteSubmitButton').click();await expect(page.locator('#deleteDialog')).not.toBeVisible();
  await expect(row(page,'readonly','new-key')).toHaveCount(0);await expect(page.locator('#jsonEditor')).toBeHidden();await trigger(page,'internal',oddKey).click();await expect(page.locator('#jsonEditor')).toHaveValue('test internal');
  expect(f.requests.filter(r=>r.action==='add')).toHaveLength(1);expect(f.requests.filter(r=>r.action==='delete')).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('CS conflicting save retains the original draft through close and filtered reopen without retries',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'internal',oddKey).click();await edit(page,'보존할 충돌 초안 9223372036854775807');
  await f.clients.test.updateUserInternalData({playFabId:uid,data:{[oddKey]:'동료가 변경한 값'}});
  await confirmSave(page);await expect(page.locator('#mutationState')).toContainText('거부');await expect(page.locator('#saveButton')).toBeDisabled();
  await expect(page.locator('#changeStatus')).toContainText('변경됨');await expect(page.locator('#jsonEditor')).toHaveValue('보존할 충돌 초안 9223372036854775807');
  expect(f.requests.filter(r=>r.action==='save')).toHaveLength(1);await page.locator('#closeDetailButton').click();await page.locator('#keyFilterInput').fill('없는키');await page.locator('#keyFilterInput').fill('');
  await trigger(page,'internal',oddKey).click();await expect(page.locator('#jsonEditor')).toHaveValue('보존할 충돌 초안 9223372036854775807');await expect(page.locator('#reasonInput')).toHaveValue('격리 CS 검증');
  expect((await f.clients.test.getUserInternalData({playFabId:uid})).data[oddKey].value).toBe('동료가 변경한 값');expect(f.requests.filter(r=>r.action==='save')).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`CS common mutation dialogs retain focus, scope and form geometry ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,info);await lookup(page);await trigger(page,'internal',oddKey).click();await edit(page,'새 초안');
  await page.locator('#saveButton').click();const confirm=page.locator('dialog.cw-confirm');await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(uid);await expect(confirm).toContainText('내부 데이터');await expect(confirm).toContainText(oddKey);
  expect(await confirm.locator('[data-confirm-apply]').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
  expect(f.requests.filter(r=>r.action==='save')).toHaveLength(0);
  await page.screenshot({path:info.outputPath('save-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(confirm).toHaveCount(0);await expect(page.locator('#saveButton')).toBeFocused();await expect(page.locator('#jsonEditor')).toHaveValue('새 초안');
  await page.locator('#saveButton').click();await page.locator('#jsonEditor').evaluate(node=>{node.value='확인 중 바뀐 초안';node.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('[data-confirm-apply]').click();await expect(confirm).toContainText('입력이 바뀌었습니다');expect(f.requests.filter(r=>r.action==='save')).toHaveLength(0);
  await page.locator('[data-confirm-cancel]').click();await expect(page.locator('#jsonEditor')).toHaveValue('확인 중 바뀐 초안');
  const add=page.locator('.data-store-section[data-data-store="internal"] [data-action="add"]');await discard(page,()=>add.click());
  const dialog=page.locator('#addDialog');await expect(dialog).toHaveClass(/cw-review/);await page.locator('#addKeyInput').fill('새 키');await page.locator('#addValueInput').fill('{"counter":9223372036854775807}');
  await page.locator('#addReasonInput').fill('화면 검증');await page.locator('#addConfirmCheck').check();
  const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width+1);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await page.locator('#addFields').evaluate(node=>getComputedStyle(node).borderTopWidth)).toBe('0px');
  expect(await page.locator('#addSubmitButton').evaluate(node=>parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
  await page.locator('#addConfirmCheck').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('add-form.png'),animations:'disabled'});
  await page.locator('[data-close-dialog="addDialog"]').click();await expect(dialog).toHaveCount(0);await expect(add).toBeFocused();
  await add.click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  const remove=row(page,'internal',oddKey).locator('[data-action="delete"]');await remove.click();await expect(page.locator('#deleteDialog')).toHaveClass(/cw-review/);
  await page.screenshot({path:info.outputPath('delete-form.png'),animations:'disabled'});
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(page.locator('#deleteDialog')).toHaveCount(0);await expect(page.locator('#mutationState')).toContainText('로그인·권한');
  expect(f.requests.filter(r=>['save','add','delete'].includes(r.action))).toHaveLength(0);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const action of ['add','delete'])test(`CS acknowledged ${action} separates failed reads and recovers without repeating mutation`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);
  if(action==='add'){
    await page.locator('.data-store-section[data-data-store="internal"] [data-action="add"]').click();
    await page.locator('#addKeyInput').fill('new-key');await page.locator('#addValueInput').fill('검증 값');
  }else await row(page,'internal',oddKey).locator('[data-action="delete"]').click();
  await page.locator(`#${action}ReasonInput`).fill('조회 실패 검증');await page.locator(`#${action}ConfirmCheck`).check();
  await page.route('**/api/playfab/player-data/lookup',route=>route.fulfill({status:503,json:{error:'격리 목록 장애'}}));
  f.hold(action);await page.locator(`#${action}SubmitButton`).click();await expect.poll(()=>f.pending).toBe(true);
  await page.keyboard.press('Escape');await expect(page.locator(`#${action}Dialog`)).toBeVisible();await expect(page.locator(`#${action}ReasonInput`)).toBeDisabled();
  await page.locator(`#${action}Form`).evaluate(node=>node.requestSubmit());expect(f.requests.filter(r=>r.action===action)).toHaveLength(1);f.release();
  const state=page.locator('#mutationState');await expect(state).toContainText('변경은 완료');await expect(state).toHaveAttribute('data-state-kind','success');await expect(page.locator(`#${action}Dialog`)).toHaveCount(0);
  await page.unroute('**/api/playfab/player-data/lookup');
  if(action==='add'){
    await trigger(page,'internal',oddKey).click();await page.locator('#jsonEditor').fill('목록 장애 뒤 작성한 새 초안');
    await discard(page,()=>state.locator('[data-state-action]').click(),false);await expect(page.locator('#jsonEditor')).toHaveValue('목록 장애 뒤 작성한 새 초안');
  }
  if(action==='add')await discard(page,()=>state.locator('[data-state-action]').click());else await state.locator('[data-state-action]').click();await expect(state).toContainText('변경했습니다');
  if(action==='add')await expect(row(page,'internal','new-key')).toHaveCount(1);else await expect(row(page,'internal',oddKey)).toHaveCount(0);
  expect(f.requests.filter(r=>r.action===action)).toHaveLength(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('CS unconfirmed save preserves draft and scope changes ignore late acknowledgements',async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'internal',oddKey).click();await edit(page,'응답 손상 검증');
  f.transform((action,result)=>action==='save'?{...result,playFabId:'OTHER_PLAYER'}:result);await confirmSave(page);
  await expect(page.locator('#mutationState')).toContainText('변경 결과를 확인하지 못했습니다');await expect(page.locator('#jsonEditor')).toHaveValue('응답 손상 검증');await expect(page.locator('#saveButton')).toBeDisabled();
  expect((await f.clients.test.getUserInternalData({playFabId:uid})).data[oddKey].value).toBe('응답 손상 검증');expect(f.requests.filter(r=>r.action==='save')).toHaveLength(1);
  f.transform((action,result)=>result);await discard(page,()=>page.locator('#refreshButton').click());await expect(page.locator('#jsonEditor')).toBeEnabled();
  await edit(page,'이전 계정의 처리 중 초안');f.hold('save');await confirmSave(page);await expect.poll(()=>f.pending).toBe(true);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));f.release();await expect(page.locator('#jsonEditor')).toBeEnabled();
  await expect(page.locator('#mutationState')).toContainText('로그인·권한이 변경');await expect(page.locator('#jsonEditor')).toHaveValue('이전 계정의 처리 중 초안');await expect(page.locator('#changeStatus')).toContainText('변경됨');
  await expect(page.locator('#saveButton')).toBeDisabled();expect(f.requests.filter(r=>r.action==='save')).toHaveLength(2);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const failure of ['html','network','forbidden','partial'])test(`CS ${failure} response never clears a draft or automatically retries`,async({page},info)=>{
  const f=await fixture(page,info);await lookup(page);await trigger(page,'readonly',oddKey).click();await edit(page,'실패 시 보존할 값');
  let attempts=0;
  await page.route('**/api/playfab/player-data/save',route=>{
    attempts++;
    if(failure==='network')return route.abort('failed');
    if(failure==='html')return route.fulfill({status:200,contentType:'text/html',body:'<html>로그인 화면</html>'});
    return route.fulfill({status:failure==='forbidden'?403:200,json:failure==='forbidden'?{error:'쓰기 권한 없음'}:{message:'부분 응답'}});
  });
  await confirmSave(page);
  await expect(page.locator('#mutationState')).toHaveAttribute('data-state-kind',failure==='forbidden'?'denied':'error');
  const feedback=await page.locator('#mutationState').boundingBox();expect(feedback.y).toBeLessThan(page.viewportSize().height);expect(feedback.y+feedback.height).toBeGreaterThan(0);
  await expect(page.locator('#jsonEditor')).toBeEnabled();await expect(page.locator('#jsonEditor')).toHaveValue('실패 시 보존할 값');await expect(page.locator('#saveButton')).toBeDisabled();
  await page.locator('#closeDetailButton').click();await trigger(page,'readonly',oddKey).click();await expect(page.locator('#jsonEditor')).toHaveValue('실패 시 보존할 값');
  expect(attempts).toBe(1);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});
