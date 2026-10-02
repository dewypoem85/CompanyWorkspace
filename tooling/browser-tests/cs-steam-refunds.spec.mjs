import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { root } from '../build-ui.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { createSteamTransactionApi } from '../../apps/cs/lib/steam-transaction-api.js';
import { normalizeTransaction } from '../../apps/cs/lib/steam.js';
import { createSteamProductCatalog } from '../../apps/cs/lib/steam-product-catalog.js';
import { assertCsStatePill } from './support/cs-controls.mjs';

const orderId='18446744073709551615',steamId='76561198000000000',transactionId='9223372036854775807';
const user={id:'1',name:'검증 직원',email:'ui@example.test',role:'admin'};
const context={authenticated:true,isAdmin:true,user,profiles:{},projects:[],projectIcons:{},employees:[],services:[{key:'cs',name:'CS',href:'/workspace/cs'}]};
async function fixture(page,{sandbox=false,enabled=true}={}) {
  const errors=[],unhandled=[],requests=[],steamCalls=[],audit=[];
  const transaction={...normalizeTransaction({orderid:orderId,transid:transactionId,steamid:steamId,status:'Succeeded',currency:'KRW',country:'KR',time:'2026-08-14T03:10:00Z',items:{itemid:'1001',qty:'1',amount:'5500',vat:'550',itemstatus:'Succeeded'}})};
  const config={appId:'2712460',sandbox,refundEnabled:enabled,apiConfigured:true,csrfToken:'synthetic-only',currentUser:user};
  let held='',release=null,override=null,transform=(action,value)=>value,auditRecorded=true;
  const client={
    queryTransaction:async id=>{steamCalls.push(['query',id]);return {...structuredClone(transaction),lookupType:id===transactionId?'transid':'orderid'};},
    refundTransaction:async id=>{steamCalls.push(['refund',id]);transaction.status='Refunded';return {orderId:id,transactionId};}
  };
  const steamReportIndex={findBySteamId:async id=>({transactions:id===steamId?[structuredClone(transaction)]:[],indexedFrom:'2010-01-01T00:00:00Z',updatedAt:'2026-09-21T00:00:00Z'})};
  const steamProductCatalog=createSteamProductCatalog({playFabClient:{getTitleInternalData:async()=>({data:{SteamMicroTxnProductsJson:JSON.stringify({products:[{itemId:'1001',productId:'starter_pack',name:'스타터 패키지',description:'보석과 스킨 묶음'}]})}})}});
  const api=createSteamTransactionApi({steamClient:client,steamReportIndex,steamProductCatalog,refundEnabled:enabled,appendRefundAudit:async entry=>audit.push(entry),appendRefundAuditSafe:async entry=>{audit.push(entry);return auditRecorded;}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/config')return route.fulfill({json:config});
    if(path.startsWith('/api/transactions/')){
      const action=path.split('/').at(-1),body=req.postDataJSON();requests.push({action,body,csrf:req.headers()['x-csrf-token']});
      if(held===action)await new Promise(resolve=>{release=resolve;});
      const special=override?.(action,body);if(special)return route.fulfill(special);
      try {
        const result=action==='query'?await api.query(body):action==='history'?await api.history(body):await api.refund(body,{authenticatedUser:user,requestId:`synthetic-${requests.length}`,ip:'127.0.0.1'});
        return route.fulfill({status:result.statusCode,json:transform(action,result.payload)});
      }catch(error){return route.fulfill({status:error.statusCode||500,json:{error:error.message}});}
    }
    if(req.method()!=='GET'){unhandled.push(`${req.method()} ${path}`);return route.abort();}
    const shared={'/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'}[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    if(path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    const asset=resolvePublicAsset(resolve(root,'apps/cs/public'),path);
    if(asset)return route.fulfill({body:readFileSync(asset.filePath),contentType:asset.contentType});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  return {errors,unhandled,requests,steamCalls,audit,transaction,config,override:fn=>{override=fn;},transform:fn=>{transform=fn;},auditFailure:()=>{auditRecorded=false;},hold:action=>{held=action;release=null;},get pending(){return Boolean(release);},release:()=>{held='';release?.();release=null;}};
}
async function lookup(page,identifier=transactionId) {
  await page.goto('https://cs.workspace.test/refunds');await expect(page.locator('#queryButton')).toBeEnabled();
  await page.locator('#orderId').fill(identifier);await page.locator('#steamId').fill(steamId);await page.locator('#queryButton').click();
  await expect(page.locator('#resultOrderId')).toHaveText(orderId);await expect(page.locator('#queryButton')).toBeEnabled();
}
async function draft(page) {await page.locator('#reason').fill('격리 CS 요청에 따른 환불');await page.locator('#confirmationOrderId').fill(orderId);}
async function confirm(page) {await page.locator('#refundButton').click();await expect(page.locator('.cw-confirm')).toBeVisible();}
async function apply(page) {await page.locator('[data-confirm-apply]').click();await expect(page.locator('.cw-confirm')).toHaveCount(0);}

test('Steam query validation shows field context, persistent toast and focus',async({page})=>{
  const f=await fixture(page);await page.goto('https://cs.workspace.test/refunds');await expect(page.locator('#queryButton')).toBeEnabled();await expect(page.locator('#steamMessageBox')).toBeHidden();
  await page.locator('#queryButton').click();await expect(page.locator('#orderId')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#steamId')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#queryError')).toContainText('하나를 입력');await expect(page.locator('[data-toast-id="steam-validation"]')).toBeVisible();await expect(page.locator('#orderId')).toBeFocused();
  await page.locator('#orderId').fill('invalid');await expect(page.locator('#orderId')).not.toHaveAttribute('aria-invalid','true');await page.locator('#queryButton').click();await expect(page.locator('#orderId')).toHaveAttribute('aria-invalid','true');await expect(page.locator('#queryError')).not.toBeEmpty();await expect(page.locator('#orderId')).toBeFocused();
  await page.locator('#orderId').fill(transactionId);await expect(page.locator('[data-toast-id="steam-validation"]')).toHaveCount(0);expect(f.requests).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam 주문 번호와 Steam ID를 각각 단독으로 조회한다',async({page})=>{
  const f=await fixture(page);await page.goto('https://cs.workspace.test/refunds');await expect(page.locator('#queryButton')).toBeEnabled();
  await page.locator('#orderId').fill(transactionId);await page.locator('#queryButton').click();
  await expect(page.locator('#resultOrderId')).toHaveText(orderId);await expect(page.locator('#steamIdMatch')).toHaveText('주문에서 확인');
  await expect(page.locator('#refundCard')).toBeVisible();
  await page.locator('#orderId').fill('');await page.locator('#steamId').fill(steamId);await page.locator('#queryButton').click();
  await expect(page.locator('#historyCard')).toBeVisible();await expect(page.locator('#historyCount')).toHaveText('1건');
  await expect(page.locator('#historyBody')).toContainText('스타터 패키지');await page.getByRole('button',{name:'상세 보기'}).click();
  await expect(page.locator('[data-history-panel]')).toBeVisible();await expect(page.locator('[data-history-panel]')).toContainText(transactionId);
  await expect(page.locator('[data-history-panel]')).toContainText('starter_pack');await expect(page.locator('#historyCard')).toBeVisible();
  await expect(page.locator('#resultCard')).toBeHidden();await expect(page.locator('#orderId')).toHaveValue('');await expect(page.locator('#steamId')).toHaveValue(steamId);
  expect(f.requests.map(request=>request.action)).toEqual(['query','history']);
  await page.getByRole('button',{name:'이 주문 환불 검토'}).click();await expect(page.locator('#resultOrderId')).toHaveText(orderId);
  await expect(page.locator('#historyCard')).toBeHidden();await expect(page.locator('#refundCard')).toBeVisible();
  expect(f.requests.map(request=>request.action)).toEqual(['query','history','query']);expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('Steam ID 결제 내역 이동은 기존 환불 초안을 명시적으로 확인한 뒤 지운다',async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);await page.locator('#orderId').fill('');await page.locator('#queryButton').click();
  await expect(page.locator('.cw-confirm')).toContainText('결제 내역으로 이동');await page.keyboard.press('Escape');
  await expect(page.locator('#resultOrderId')).toHaveText(orderId);await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');
  await page.locator('#queryButton').click();await apply(page);await expect(page.locator('#historyCard')).toBeVisible();
  await expect(page.locator('#reason')).toHaveValue('');await expect(page.locator('#confirmationOrderId')).toHaveValue('');
  expect(f.requests.filter(request=>request.action==='history')).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const sandbox of [false,true])for(const width of [320,1440])for(const theme of ['light','dark'])test(`Steam shared confirmation and acknowledged refund ${sandbox?'sandbox':'production'} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,{sandbox});await lookup(page);await draft(page);await confirm(page);
  await assertCsStatePill(page,'#environmentBadge',sandbox?'warning':'danger');await assertCsStatePill(page,'#statusBadge','success');await assertCsStatePill(page,'#steamIdMatch','success');
  await expect(page.locator('.cw-confirm')).toContainText(orderId);await expect(page.locator('.cw-confirm')).toContainText(steamId);await expect(page.locator('.cw-confirm')).toContainText(sandbox?'SANDBOX':'PRODUCTION');
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);await page.screenshot({path:info.outputPath('steam-confirm.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(page.locator('.cw-confirm')).toHaveCount(0);await expect(page.locator('#refundButton')).toBeFocused();await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');
  await confirm(page);f.hold('refund');await apply(page);await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#orderId')).toBeDisabled();await expect(page.locator('#reason')).toBeDisabled();
  await page.locator('#refundForm').evaluate(node=>node.requestSubmit());expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(1);f.release();
  await expect(page.locator('#steamMessageBox')).toContainText('현재 거래 상태: Refunded');await expect(page.locator('#queryButton')).toBeEnabled();
  await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','success');await expect(page.locator('#reason')).toHaveValue('');
  await expect(page.locator('#resultOrderId')).toHaveText(orderId);await expect(page.locator('#resultTransactionId')).toHaveText(transactionId);await expect(page.locator('#itemsBody td').nth(0)).toHaveText('스타터 패키지');await expect(page.locator('#itemsBody td').nth(4)).toHaveText('5,500 KRW');
  expect(f.steamCalls.filter(([action])=>action==='refund')).toEqual([['refund',orderId]]);expect(f.audit.map(row=>row.result)).toEqual(['attempted','success']);
  const sent=f.requests.find(r=>r.action==='refund');expect(sent.body).toEqual({orderId,steamId,confirmationOrderId:orderId,reason:'격리 CS 요청에 따른 환불'});expect(sent.csrf).toBe('synthetic-only');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.locator('#steamMessageBox').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('steam-success.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.unhandled).toEqual([]);
});

test('Steam confirmed refund remains success after read failure and read retry never refunds again',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);
  f.override(action=>action==='query'&&f.steamCalls.some(([kind])=>kind==='refund')?{status:503,json:{error:'격리 조회 장애'}}:null);
  await apply(page);await expect(page.locator('#steamMessageBox')).toContainText('재조회에 실패');await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','success');
  await expect(page.locator('#refundButton')).toBeDisabled();f.override(null);await page.getByRole('button',{name:'거래 상태 재확인'}).click();
  await expect(page.locator('#steamMessageBox')).toContainText('현재 거래 상태: Refunded');expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const failure of ['incomplete','html','network'])test(`Steam uncertain ${failure} refund retains draft and blocks repeat even after a Succeeded read`,async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);
  if(failure==='incomplete')f.transform((action,value)=>action==='refund'?{...value,auditRecorded:undefined}:value);
  else await page.route('**/api/transactions/refund',route=>failure==='network'?route.abort():route.fulfill({status:524,contentType:'text/html',body:'Proxy timeout'}));
  await apply(page);await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','error');await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');await expect(page.locator('#refundButton')).toBeDisabled();
  f.transaction.status='Succeeded';await page.getByRole('button',{name:'거래 상태 재확인'}).click();await expect(page.locator('#steamMessageBox')).toContainText('확정할 수 없습니다');
  await expect(page.locator('#refundButton')).toBeDisabled();await page.locator('#queryButton').click();await expect(page.locator('#queryButton')).toBeEnabled();await expect(page.locator('#refundButton')).toBeDisabled();expect(f.errors).toEqual([]);
});

test('Steam preflight detects changed transaction and changed execution configuration without sending refund',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);f.transaction.items[0].amount='999';await page.locator('#refundButton').click();
  await expect(page.locator('#steamMessageBox')).toContainText('거래 정보가 변경');await expect(page.locator('.cw-confirm')).toHaveCount(0);await expect(page.locator('#refundButton')).toBeDisabled();
  await page.locator('#queryButton').click();await expect(page.locator('#refundButton')).toBeEnabled();f.config.refundEnabled=false;await page.locator('#refundButton').click();
  await expect(page.locator('#steamMessageBox')).toContainText('실행 설정이 변경');expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam server rechecks transaction after confirmation and rejects concurrent external refund',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);f.transaction.status='Refunded';await apply(page);
  await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','error');await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');
  expect(f.steamCalls.filter(([kind])=>kind==='refund')).toHaveLength(0);expect(f.audit[0].result).toBe('rejected');expect(f.errors).toEqual([]);
});

test('Steam confirmation rejects programmatically changed draft and scope change closes common dialog',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);
  await page.locator('#reason').evaluate(node=>{node.value='확인 도중 변경한 사유';});await page.locator('[data-confirm-apply]').click();await expect(page.locator('.cw-confirm')).toContainText('입력이 변경');
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);await page.keyboard.press('Escape');await confirm(page);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(page.locator('.cw-confirm')).toHaveCount(0);await expect(page.locator('#resultCard')).toBeHidden();await expect(page.locator('#reason')).toHaveValue('');await expect(page.locator('#queryButton')).toBeDisabled();expect(f.errors).toEqual([]);
});

test('Steam late refund reply after account change cannot restore private transaction or report success',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);f.hold('refund');await apply(page);await expect.poll(()=>f.pending).toBe(true);
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));f.release();await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#resultOrderId')).toBeEmpty();await expect(page.locator('#queryButton')).toBeDisabled();expect(f.errors).toEqual([]);
});

test('Steam read-only config, mismatched Steam ID and malformed queries never expose refund execution',async({page},info)=>{
  const f=await fixture(page,{enabled:false});await lookup(page);await expect(page.locator('#refundCard')).toBeHidden();await expect(page.locator('#steamMessageBox')).toContainText('조회 전용');
  await page.locator('#steamId').fill('76561198000000001');await page.locator('#queryButton').click();await expect(page.locator('#steamMessageBox')).toContainText('불일치');
  f.transform((action,value)=>action==='query'?{...value,verification:{steamIdMatches:true,refundableStatus:true}}:value);await page.locator('#queryButton').click();await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','error');
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam successful refund exposes audit recording failure without presenting a failed refund',async({page},info)=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);f.auditFailure();await apply(page);
  await expect(page.locator('#steamMessageBox')).toContainText('완료 감사 로그 기록에 실패');await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','success');expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('Steam different order lookup requires explicit draft discard and cancellation retains original order',async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);
  const next='18446744073709551614';f.transaction.orderId=next;
  await page.locator('#orderId').fill(next);await page.locator('#queryButton').click();await expect(page.locator('.cw-confirm')).toContainText('다른 주문으로 이동');
  await page.keyboard.press('Escape');await expect(page.locator('#steamMessageBox')).toContainText('주문 이동 취소');await expect(page.locator('#resultOrderId')).toHaveText(orderId);
  await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');await expect(page.locator('#refundButton')).toBeDisabled();
  await page.locator('#queryButton').click();await expect(page.locator('.cw-confirm')).toBeVisible();await apply(page);
  await expect(page.locator('#resultOrderId')).toHaveText(next);await expect(page.locator('#reason')).toHaveValue('');await expect(page.locator('#confirmationOrderId')).toHaveValue('');
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam failed read retains prior transaction and reason but requires fresh verification',async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);f.override(action=>action==='query'?{status:503,json:{error:'격리 조회 장애'}}:null);
  await page.locator('#queryButton').click();await expect(page.locator('#steamMessageBox')).toContainText('격리 조회 장애');await expect(page.locator('#resultOrderId')).toHaveText(orderId);
  await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');await expect(page.locator('#refundButton')).toBeDisabled();
  f.override(null);await page.locator('#queryButton').click();await expect(page.locator('#refundButton')).toBeEnabled();expect(f.errors).toEqual([]);
});

test('Steam transaction query timeout permits only an explicit fresh read',async({page})=>{
  const f=await fixture(page);await page.goto('https://cs.workspace.test/refunds');await expect(page.locator('#queryButton')).toBeEnabled();
  await page.locator('#orderId').fill(transactionId);await page.locator('#steamId').fill(steamId);
  await page.evaluate(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===45_000?100:ms,...args);});
  f.hold('query');await page.locator('#queryButton').click();await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#steamMessageBox')).toContainText('서버 처리 취소를 의미하지 않습니다');await expect(page.locator('#resultCard')).toBeHidden();
  f.release();await page.locator('#queryButton').click();await expect(page.locator('#resultOrderId')).toHaveText(orderId);
  expect(f.requests.filter(r=>r.action==='query')).toHaveLength(2);expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam scope change rejects a delayed decoded transaction from the common read session',async({page})=>{
  const f=await fixture(page);await page.goto('https://cs.workspace.test/refunds');await expect(page.locator('#queryButton')).toBeEnabled();
  await page.locator('#orderId').fill(transactionId);await page.locator('#steamId').fill(steamId);
  await page.evaluate(()=>{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).endsWith('/transactions/query')){
        const payload=await response.json();response.json=()=>new Promise(resolve=>{window.releaseSteamQueryJson=()=>resolve(payload);});
      }
      return response;
    };
  });
  await page.locator('#queryButton').click();await page.waitForFunction(()=>Boolean(window.releaseSteamQueryJson));
  await page.evaluate(()=>{document.dispatchEvent(new Event('workspace-entity-scope-change'));window.releaseSteamQueryJson();});
  await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#resultCard')).toBeHidden();
  await expect(page.locator('#queryButton')).toBeDisabled();expect(f.requests.filter(r=>r.action==='query')).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const status of [401,403])test(`Steam ${status} response clears displayed private result and prevents repeated execution`,async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);f.override(action=>action==='query'?{status,contentType:'text/html',body:'Denied'}:null);
  await page.locator('#queryButton').click();await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#resultCard')).toBeHidden();await expect(page.locator('#resultOrderId')).toBeEmpty();await expect(page.locator('#queryButton')).toBeDisabled();
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});

test('Steam refund observation timeout retains reason and never retries the monetary request',async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);
  await page.evaluate(()=>{const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===45_000?100:ms,...args);});
  f.hold('refund');await apply(page);await expect.poll(()=>f.pending).toBe(true);
  await expect(page.locator('#steamMessageBox')).toContainText('서버 처리 취소를 의미하지 않습니다');await expect(page.locator('#refundButton')).toBeDisabled();
  await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');f.release();
  await page.getByRole('button',{name:'거래 상태 재확인'}).click();await expect(page.locator('#steamMessageBox')).toContainText('확정할 수 없습니다');
  expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(1);expect(f.errors).toEqual([]);
});

for(const event of ['scope','dispose'])test(`Steam ${event} while decoding a non-abortable refund reply cannot acknowledge or clear its draft`,async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);await confirm(page);
  await page.evaluate(()=>{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).endsWith('/transactions/refund')){
        const payload=await response.json();response.json=()=>new Promise(resolve=>{window.releaseSteamJson=()=>resolve(payload);});
      }
      return response;
    };
  });
  await apply(page);await expect.poll(()=>page.evaluate(()=>typeof window.releaseSteamJson)).toBe('function');
  await page.evaluate(event=>{
    if(event==='scope')document.dispatchEvent(new Event('workspace-entity-scope-change'));
    else window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
    window.releaseSteamJson();
  },event);
  if(event==='scope'){await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('#resultOrderId')).toBeEmpty();}
  else{await expect(page.locator('#reason')).toHaveValue('격리 CS 요청에 따른 환불');await expect(page.locator('#steamMessageBox')).not.toHaveAttribute('data-state-kind','success');}
  await expect(page.locator('#queryButton')).toBeDisabled();expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(1);expect(f.errors).toEqual([]);
});

test('Steam preflight owner change blocks refund before showing confirmation',async({page})=>{
  const f=await fixture(page);await lookup(page);await draft(page);f.config.currentUser={...user,id:'2'};
  await page.locator('#refundButton').click();await expect(page.locator('#steamMessageBox')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('.cw-confirm')).toHaveCount(0);
  await expect(page.locator('#reason')).toHaveValue('');expect(f.requests.filter(r=>r.action==='refund')).toHaveLength(0);expect(f.errors).toEqual([]);
});
