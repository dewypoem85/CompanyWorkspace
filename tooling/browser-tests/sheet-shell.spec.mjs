import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';

const definitions=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='sheet');
const clientRoot=resolve(root,'apps/sheet/dist/client');
const account={authenticated:true,user:{id:1,name:'검증 직원',role:'employee'},services:[{key:'sheet',name:'시트 관리',href:'/workspace/sheet'}],profiles:{},projects:[],employees:[],csrfToken:'synthetic'};
const analysis={id:'synthetic-analysis',mode:'demo',createdAt:'2026-09-10T00:00:00Z',spreadsheet:{id:'synthetic-sheet',title:'검증용 번역 시트',url:'https://example.test/sheet'},totals:{formulas:1,ready:1,blocked:0,sourceSpreadsheets:1,sourceSheets:1},sheets:[{sheetId:0,title:'검증 데이터',rowCount:10,columnCount:4,formulaCount:1,blockerCount:0}],rules:[{id:'rule-1',target:{spreadsheetId:'synthetic-sheet',sheetId:0,sheetTitle:'검증 데이터',cell:'B2',key:'TestKey',language:'Korean'},source:{spreadsheetId:'synthetic-source',sheetTitle:'원문',cell:'A1',url:'https://example.test/source'},formula:'=IMPORTRANGE("synthetic-source","원문!A1")',plainValue:'검증 문구',formattedValue:'검증 문구',status:'ready'}]};
const snapshots=[{id:'synthetic-snapshot',kind:'migration',spreadsheetId:'synthetic-sheet',spreadsheetTitle:'검증용 번역 시트',analysisId:analysis.id,createdAt:analysis.createdAt,entryCount:1}];
const form=(data,message='완료')=>({contentType:'application/vnd.company.workspace-form+json',body:JSON.stringify({protocol:'workspace-form-v1',outcome:'saved',message,data})});
async function fixture(page,allowed=true) {
  const errors=[],writes=[];let documents=0,analyses=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents++;
    if(path==='/api/workspace/context')return route.fulfill({json:{...account,services:allowed?account.services:[]}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(new URL(request.url()).origin==='https://company.example.com'&&path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    if(path==='/api/config')return route.fulfill({json:{mode:'demo',writesEnabled:false,actorId:String(account.user.id),defaultSpreadsheetId:'synthetic-sheet',defaultSpreadsheetUrl:'https://example.test/sheet'}});
    if(path==='/api/spreadsheets/analyze'){analyses++;return route.fulfill({json:analysis});}
    if(path==='/api/snapshots')return route.fulfill({json:snapshots});
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    const shared={
      '/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js',
      '/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js',
      '/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'
    }[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const isPage=definitions.some(p=>[p.path,...p.aliases||[]].includes(path));
    const file=resolve(clientRoot,isPage?'index.html':path.slice(1));
    if(file.startsWith(clientRoot+sep)&&existsSync(file)&&['.html','.js','.css'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[extname(file)]});
    return route.abort();
  });
  return {errors,writes,documents:()=>documents,analyses:()=>analyses};
}

for(const definition of definitions)for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://sheet.workspace.test'+definition.path);
  await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(page.locator('[data-route-title]')).toHaveText(definition.title);
  if(width<901){
    await expect(page.locator('.main-content > .topbar > div:first-child')).toBeHidden();
    await expect(page.locator('.cw-current')).toBeVisible();
    expect(await page.locator('.main-content > .topbar').evaluate(node=>getComputedStyle(node).position)).toBe('static');
  }
  if(width>=901)await expect(page.locator('[data-route-title]')).toBeVisible();
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',definition.view);
  await expect(page.locator('.cw-page-link')).toHaveCount(definitions.filter(p=>p.nav!==false).length);
  await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',definition.id);
  await expect(page.locator('.cw-feedback[data-state-kind="error"]')).toHaveCount(0);
  const connection=page.locator('.connection-badge');
  await expect(connection).toHaveClass(/\bcw-state-pill\b/);await expect(connection).toHaveAttribute('data-tone','warning');await expect(connection).toHaveText('데모 모드');
  await expect(connection.locator('i')).toHaveCSS('width','5px');await expect(connection.locator('i')).toHaveCSS('height','5px');await expect(connection.locator('i')).toHaveCSS('border-radius','50%');
  if(width>=901){
    const colors=await connection.evaluate(el=>{const probe=document.createElement('span');document.body.append(probe);probe.style.backgroundColor='var(--cw-warning-bg)';probe.style.color='var(--cw-warning)';const expected={background:getComputedStyle(probe).backgroundColor,color:getComputedStyle(probe).color};probe.remove();return{background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,expected};});
    expect(colors.background).toBe(colors.expected.background);expect(colors.color).toBe(colors.expected.color);
  }
  if(definition.view==='overview'){
    expect(await page.locator('.hero-copy h1 span').evaluate(el=>el.getClientRects().length)).toBe(1);
    const readiness=page.locator('.live-label');await expect(readiness).toHaveClass(/\bcw-state-pill\b/);await expect(readiness).toHaveAttribute('data-tone','success');await expect(readiness).toHaveText('READY');await expect(readiness.locator('i')).toHaveCSS('width','5px');await expect(readiness.locator('i')).toHaveCSS('height','5px');await expect(readiness.locator('i')).toHaveCSS('border-radius','50%');
    const readinessColors=await readiness.evaluate(el=>{const probe=document.createElement('span');document.body.append(probe);probe.style.backgroundColor='var(--cw-success-bg)';probe.style.color='var(--cw-success)';const expected={background:getComputedStyle(probe).backgroundColor,color:getComputedStyle(probe).color};probe.remove();return{background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,expected};});expect(readinessColors.background).toBe(readinessColors.expected.background);expect(readinessColors.color).toBe(readinessColors.expected.color);
  }
  const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,css:e.className,width:e.getBoundingClientRect().width}))}));
  await page.screenshot({path:info.outputPath('content.png'),animations:'disabled'});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{message:JSON.stringify(geometry)}).toBe(true);
  if(definition.view==='migration') {
    const style=await page.evaluate(()=>{
      const th=document.querySelector('.cw-data-table th'),td=document.querySelector('.cw-data-table td');
      const probe=document.createElement('span');document.body.append(probe);probe.style.backgroundColor='var(--cw-raised)';probe.style.color='var(--cw-text)';
      const expected={background:getComputedStyle(probe).backgroundColor,text:getComputedStyle(probe).color};probe.remove();
      return {header:getComputedStyle(th).backgroundColor,text:getComputedStyle(td).color,size:parseFloat(getComputedStyle(td).fontSize),expected};
    });
    expect(style.header).toBe(style.expected.background);expect(style.text).toBe(style.expected.text);expect(style.size).toBeGreaterThanOrEqual(12);
    const pill=page.locator('.rules-table .cw-state-pill').first();
    await expect(pill).toHaveCSS('position','static');
    const cell=await pill.locator('..').boundingBox(),bounds=await pill.boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(cell.y);expect(bounds.y+bounds.height).toBeLessThanOrEqual(cell.y+cell.height);
  }
  if(definition.view==='snapshots') {
    const button=await page.locator('.snapshot-row button').boundingBox();
    expect(button.x+button.width).toBeLessThanOrEqual(width);
  }
  if(width<901)await page.locator('[data-cw-nav]').click();
  await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
  await page.screenshot({path:info.outputPath('navigation.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('React menu navigation preserves app state and back/forward history',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const f=await fixture(page);await page.goto('https://sheet.workspace.test/');
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','overview');
  await expect(page.locator('.cw-page-link')).toHaveCount(definitions.length);
  const initialAnalyses=f.analyses();
  for(const view of ['migration','translations','snapshots','releases']) {
    await page.locator(`[data-workspace-page="sheet.${view}"]`).click();
    await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',view);
    await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page','sheet.'+view);
  }
  await page.goBack();await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','snapshots');
  await page.goForward();await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','releases');
  expect(f.analyses()).toBe(initialAnalyses);expect(f.documents()).toBe(1);expect(f.errors).toEqual([]);
});

test('denied sheet context removes navigation without losing the signed-in account',async({page})=>{
  await fixture(page,false);await page.goto('https://sheet.workspace.test/');
  await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await expect(page.locator('.cw-sidebar')).toBeHidden();
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared sheet confirmation protects reviewed writes ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);let current=structuredClone(analysis),snapshotFailed=false,release=null,migrations=0,syncs=0,badSync=true;
  current.mode='google';
  const payloads=[],writeHeaders=[];
  let preview={id:'reviewed-preview',createdAt:analysis.createdAt,target:analysis.spreadsheet,language:'Korean',totals:{tracked:1,changed:1,unchanged:0,sourceSpreadsheets:1,sourceSheets:1},items:[{ruleId:'rule-1',key:'TestKey',status:'changed',source:{...analysis.rules[0].source,value:'new'},target:{spreadsheetId:analysis.spreadsheet.id,sheetTitle:'검증 데이터',cell:'B2',currentValue:'old'}}]};
  await page.route('**/api/config',route=>route.fulfill({json:{mode:'google',writesEnabled:true,actorId:String(account.user.id),defaultSpreadsheetId:analysis.spreadsheet.id,defaultSpreadsheetUrl:'https://example.test/sheet'}}));
  await page.route('**/api/spreadsheets/analyze',route=>route.fulfill({json:current}));
  await page.route('**/api/snapshots',route=>route.fulfill(snapshotFailed?{status:503,json:{error:'스냅샷 목록 읽기 실패'}}:{json:snapshots}));
  await page.route('**/api/sync/korean/preview',route=>route.fulfill({json:preview}));
  await page.route('**/api/migrations/apply',async route=>{
    migrations++;const sent=route.request().postDataJSON();payloads.push(sent);writeHeaders.push(route.request().headers());await new Promise(resolve=>{release=resolve;});
    current={...current,rules:[],totals:{...current.totals,formulas:0,ready:0}};snapshotFailed=true;
    const result={id:'migration-result',spreadsheetId:analysis.spreadsheet.id,snapshotId:'snapshot-after-write',ruleFile:'rules.json',startedAt:analysis.createdAt,completedAt:analysis.createdAt,converted:1,remaining:0};
    return route.fulfill(form({operation:'migration',analysisId:sent.analysisId,spreadsheetId:analysis.spreadsheet.id,result}));
  });
  await page.route('**/api/sync/korean/apply',route=>{
    syncs++;const sent=route.request().postDataJSON();payloads.push(sent);writeHeaders.push(route.request().headers());
    if(badSync)return route.fulfill(form({id:'incomplete'}));
    const before=preview;preview={...preview,totals:{...preview.totals,changed:0,unchanged:1},items:preview.items.map(item=>({...item,status:'unchanged',target:{...item.target,currentValue:item.source.value}}))};
    const result={id:'sync-result',spreadsheetId:analysis.spreadsheet.id,previewId:before.id,snapshotId:'sync-snapshot',completedAt:analysis.createdAt,updated:1,unchanged:0};
    return route.fulfill(form({operation:'korean-sync',previewId:sent.previewId,spreadsheetId:sent.spreadsheetId,result}));
  });
  await page.goto('https://sheet.workspace.test/migration');await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await expect(page.locator('.connection-badge')).toHaveClass(/\bcw-state-pill\b/);await expect(page.locator('.connection-badge')).toHaveAttribute('data-tone','success');await expect(page.locator('.connection-badge')).toHaveText('Google 연결됨');
  const trigger=page.getByRole('button',{name:'수식 제거 실행',exact:true}),dialog=page.locator('dialog.cw-confirm');
  await trigger.click();await expect(dialog).toBeVisible();await expect(dialog.locator('h2')).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();expect(migrations).toBe(0);
  await trigger.click();await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await expect(dialog).toHaveCount(0);expect(migrations).toBe(0);
  await expect(page.locator('[data-workspace-view]')).toHaveCount(0);await expect(page.locator('main .cw-feedback')).toHaveAttribute('data-state-kind','denied');
  await page.getByRole('button',{name:'페이지 다시 열기'}).click();await expect(trigger).toBeVisible();
  await trigger.click();await page.evaluate(()=>{history.pushState(null,'','/snapshots');window.dispatchEvent(new PopStateEvent('popstate'));});
  await expect(dialog).toHaveCount(0);await page.goBack();await expect(trigger).toBeVisible();
  // The modal isolates background controls; refreshing is an explicit step after cancelling.
  await trigger.click();current={...current,id:'fresh-analysis'};
  await expect(page.locator('.page-title button')).toBeDisabled();
  await dialog.locator('[data-confirm-cancel]').click();
  await page.getByRole('button',{name:'복사본 분석'}).click();await expect(page.getByRole('button',{name:'복사본 분석'})).toBeEnabled();
  await trigger.click();await dialog.locator('input').fill('수식 제거 ');await expect(dialog.locator('[data-confirm-apply]')).toBeDisabled();
  await dialog.locator('input').fill('수식 제거');
  await page.screenshot({path:info.outputPath('sheet-confirm.png'),animations:'disabled'});
  const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
  expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await dialog.locator('[data-confirm-apply]').click();await expect(dialog).toHaveCount(0);await expect.poll(()=>release!==null).toBe(true);
  await expect(trigger).toBeDisabled();await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='수식 제거 실행')?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(migrations).toBe(1);expect(payloads[0]).toEqual({analysisId:'fresh-analysis',confirmation:'수식 제거'});expect(writeHeaders[0]['x-workspace-actor']).toBe(String(account.user.id));expect(writeHeaders[0]['x-workspace-sheet-state']).toBe('fresh-analysis');release();
  const result=page.locator('main .cw-feedback').first();await expect(result).toContainText('실행은 완료되었지만 목록 조회에 실패');await expect(result).toHaveAttribute('data-state-kind','success');await expect(trigger).toBeDisabled();
  snapshotFailed=false;await result.getByRole('button',{name:'데이터 다시 확인'}).click();await expect(result).toContainText('실행 후 데이터를 다시 확인');expect(migrations).toBe(1);await expect(trigger).toBeDisabled();
  if(width<901)await page.locator('[data-cw-nav]').click();await page.locator('[data-workspace-page="sheet.translations"]').click();
  await page.getByRole('button',{name:'지금 비교하기'}).click();
  const sync=page.getByRole('button',{name:'한국어 갱신 실행',exact:true});await sync.click();await dialog.locator('input').fill('한국어 갱신');await dialog.locator('[data-confirm-apply]').click();
  await expect(result).toContainText('저장 결과를 확인하지 못했습니다');await expect(result).toContainText('서버에는 반영되었을 수도');await expect(sync).toBeDisabled();expect(syncs).toBe(1);
  expect(payloads[1]).toEqual({spreadsheetId:analysis.spreadsheet.id,previewId:'reviewed-preview',confirmation:'한국어 갱신'});
  expect(writeHeaders[1]['x-workspace-actor']).toBe(String(account.user.id));expect(writeHeaders[1]['x-workspace-sheet-state']).toBe('reviewed-preview');
  preview={...preview,id:'fresh-preview'};await result.getByRole('button',{name:'데이터 다시 확인'}).click();await expect(sync).toBeEnabled();expect(syncs).toBe(1);
  badSync=false;await sync.click();await dialog.locator('input').fill('한국어 갱신');await dialog.locator('[data-confirm-apply]').click();
  await expect(result).toContainText('한국어 갱신 완료');await expect(sync).toBeDisabled();expect(syncs).toBe(2);expect(payloads[2].previewId).toBe('fresh-preview');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('read-only sheet confirmation explains the gate without issuing a write',async({page})=>{
  const f=await fixture(page);await page.goto('https://sheet.workspace.test/migration');
  await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await page.getByRole('button',{name:'수식 제거 실행'}).click();
  const dialog=page.locator('dialog.cw-confirm');await expect(dialog).toContainText('ALLOW_SHEET_WRITES=true');
  await dialog.locator('input').fill('수식 제거');await expect(dialog.locator('[data-confirm-apply]')).toBeDisabled();
  await dialog.locator('[data-confirm-cancel]').click();await expect(dialog).toHaveCount(0);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('legacy index document remains the overview route',async({page})=>{
  const f=await fixture(page);await page.goto('https://sheet.workspace.test/index.html');
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','overview');
  await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page','sheet.overview');
  expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared sheet controls, filters and snapshot disclosures ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const capture=async name=>{
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:info.outputPath(name),fullPage:true});
  };
  const f=await fixture(page);
  const records=[...snapshots,{...snapshots[0],id:'snapshot-second-9007199254740993',kind:'korean-sync',spreadsheetId:'synthetic-sheet-'+('long-'.repeat(25))}];
  await page.route('**/api/snapshots',route=>route.fulfill({json:records}));
  const preview={id:'preview',createdAt:analysis.createdAt,target:analysis.spreadsheet,language:'Korean',totals:{tracked:2,changed:1,unchanged:1,sourceSpreadsheets:1,sourceSheets:1},items:[
    {ruleId:'one',key:'ChangedKey',status:'changed',source:{spreadsheetId:'source',sheetTitle:'원문',cell:'A1',url:'https://example.test/source',value:'새로운 값'},target:{spreadsheetId:'synthetic-sheet',sheetTitle:'검증 데이터',cell:'B2',currentValue:'기존 값'}},
    {ruleId:'two',key:'UnchangedKey',status:'unchanged',source:{spreadsheetId:'source',sheetTitle:'원문',cell:'A2',url:'https://example.test/source',value:'같은 값'},target:{spreadsheetId:'synthetic-sheet',sheetTitle:'검증 데이터',cell:'B3',currentValue:'같은 값'}},
  ]};
  await page.route('**/api/sync/korean/preview',route=>route.fulfill({json:preview}));
  await page.goto('https://sheet.workspace.test/migration');await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  const search=page.getByRole('searchbox',{name:'연결 규칙 검색'});
  const inputStyle=await search.evaluate(el=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--cw-raised)';probe.style.color='var(--cw-text)';document.body.append(probe);const expected={background:getComputedStyle(probe).backgroundColor,color:getComputedStyle(probe).color};probe.remove();return {background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,height:el.getBoundingClientRect().height,expected};});
  expect(inputStyle.background).toBe(inputStyle.expected.background);expect(inputStyle.color).toBe(inputStyle.expected.color);expect(inputStyle.height).toBeGreaterThanOrEqual(44);
  await search.fill('missing');await expect(page.locator('.rules-panel .cw-feedback')).toContainText('조건에 맞는 연결 규칙이 없습니다.');
  await search.fill('TestKey');await page.getByLabel('대상 탭').selectOption('검증 데이터');await expect(page.locator('.rules-table tbody tr')).toHaveCount(1);
  await search.focus();await expect(search).toHaveCSS('outline-style','solid');
  const action=page.getByRole('button',{name:'수식 제거 실행'});await action.click();
  await expect(page.locator('dialog.cw-confirm')).toContainText('ALLOW_SHEET_WRITES=true');await expect(action).toBeDisabled();
  const disabled=await action.evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--cw-muted)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {actual:getComputedStyle(el).color,expected};});
  expect(disabled.actual).toBe(disabled.expected);await page.keyboard.press('Escape');await expect(action).toBeEnabled();await expect(action).toBeFocused();
  const scroll=page.getByRole('region',{name:'시트 비교 결과 표'});await scroll.focus();
  if(width===320){
    await scroll.press('ArrowRight');await expect.poll(()=>scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
    const frame=await scroll.boundingBox(),last=await page.locator('.rules-table tbody td').last().boundingBox();
    expect(last.x+last.width).toBeLessThanOrEqual(frame.x+frame.width+1);
  }
  await capture('shared-migration.png');
  const go=async view=>{if(width<901)await page.locator('[data-cw-nav]').click();await page.locator(`[data-workspace-page="sheet.${view}"]`).click();};
  await go('translations');await page.getByRole('button',{name:'지금 비교하기'}).click();
  await expect(page.locator('.sync-table tbody tr')).toHaveCount(1);await page.getByLabel('비교 상태').selectOption('all');await expect(page.locator('.sync-table tbody tr')).toHaveCount(2);
  await page.getByRole('searchbox',{name:'비교 결과 검색'}).fill('없는 값');await expect(page.locator('.sync-rules .cw-feedback')).toContainText('조건에 맞는 비교 결과가 없습니다.');
  await page.getByRole('searchbox',{name:'비교 결과 검색'}).fill('새로운 값');await expect(page.locator('.sync-table tbody tr')).toHaveCount(1);await expect(page.getByRole('button',{name:'한국어 갱신 실행'})).toBeDisabled();
  await capture('shared-translation.png');
  await go('snapshots');const buttons=page.locator('.snapshot-row button'),panels=page.locator('[data-cw-disclosure-panel]');
  await expect(buttons).toHaveCount(2);await expect(buttons.first()).toBeEnabled();await expect(panels.first()).toBeHidden();
  await buttons.first().focus();await buttons.first().press('Enter');await expect(buttons.first()).toHaveAttribute('aria-expanded','true');await expect(buttons.first()).toHaveText('기록 정보 닫기');
  await expect(panels.first()).toContainText('synthetic-snapshot');await expect(panels.first()).toContainText('복원은 실행하지 않습니다.');
  await buttons.nth(1).click();await expect(panels.first()).toBeHidden();await expect(panels.nth(1)).toContainText(records[1].spreadsheetId);await expect(buttons.first()).toHaveAttribute('aria-expanded','false');
  await expect(panels.nth(1)).toContainText('한국어 원문 갱신');expect(await buttons.nth(1).getAttribute('aria-controls')).toBe(await panels.nth(1).getAttribute('id'));
  await capture('shared-snapshot.png');
  await buttons.nth(1).press('Space');await expect(panels.nth(1)).toBeHidden();
  await go('overview');await go('snapshots');await buttons.first().click();await expect(panels.first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`React common states recover initialization and empty snapshots ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);let failed=true,configs=0,release=null,hold=false;
  await page.route('**/api/config',async route=>{
    configs++;
    if(hold)await new Promise(resolve=>{release=resolve;});
    return route.fulfill(failed?{status:503,json:{error:'설정 서버 연결 실패'}}:{json:{mode:'demo',writesEnabled:false,actorId:String(account.user.id),defaultSpreadsheetId:analysis.spreadsheet.id,defaultSpreadsheetUrl:'https://example.test/sheet'}});
  });
  await page.route('**/api/snapshots',route=>route.fulfill({json:[]}));
  await page.goto('https://sheet.workspace.test/snapshots');
  const error=page.locator('main .cw-feedback[data-state-kind="error"]');
  await expect(error).toContainText('설정 서버 연결 실패');await expect(page.locator('.metric-card')).toHaveCount(0);
  failed=false;hold=true;await error.getByRole('button',{name:'다시 시도'}).click();
  await expect(page.locator('main .cw-feedback[data-state-kind="loading"]')).toBeVisible();
  await expect.poll(()=>release!==null).toBe(true);expect(configs).toBe(2);hold=false;release();
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view','snapshots');
  await expect(page.locator('main .cw-feedback[data-state-kind="empty"]')).toContainText('아직 생성된 스냅샷');
  await page.screenshot({path:info.outputPath('react-empty.png'),animations:'disabled'});
  if(width<901)await page.locator('[data-cw-nav]').click();
  await page.locator('[data-workspace-page="sheet.translations"]').click();
  await expect(page.locator('main .cw-feedback[data-state-kind="empty"]')).toContainText('원본과 번역 시트');
  let previews=0;
  await page.route('**/api/sync/korean/preview',route=>{previews++;return route.fulfill({status:503,json:{error:'원문 비교 실패'}});});
  await page.getByRole('button',{name:'지금 비교하기'}).click();await expect(error).toContainText('원문 비교 실패');
  await error.getByRole('button',{name:'다시 시도'}).click();await expect.poll(()=>previews).toBe(2);await expect(error).toBeVisible();
  expect(configs).toBe(2);expect(f.documents()).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`sheet validated reads preserve good data and revoke old content ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  let result=analysis,denied=false;
  await page.route('**/api/spreadsheets/analyze',route=>route.fulfill(denied?{status:403,contentType:'text/html',body:'denied'}:{json:result}));
  await page.goto('https://sheet.workspace.test/migration');await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await expect(page.locator('.rules-table tbody')).toContainText('TestKey');
  const reanalyze=page.getByRole('button',{name:'복사본 분석'}),error=page.locator('main .cw-feedback[data-state-kind="error"]');
  result={...analysis,rules:[{id:'incomplete'}]};await reanalyze.click();await expect(error).toContainText('조회 응답이 올바르지 않습니다');
  await expect(page.locator('.rules-table tbody')).toContainText('TestKey');
  result={...analysis,id:'other',spreadsheet:{...analysis.spreadsheet,id:'other'},rules:analysis.rules.map(rule=>({...rule,target:{...rule.target,spreadsheetId:'other'}}))};
  await error.getByRole('button',{name:'다시 시도'}).click();await expect(error).toContainText('조회 대상 또는 연결 모드가 변경');
  await expect(page.locator('.source-link')).toHaveAttribute('href',analysis.spreadsheet.url);
  result=analysis;await reanalyze.click();await expect(error).toHaveCount(0);await expect(reanalyze).toBeEnabled();
  denied=true;await reanalyze.click();const state=page.locator('main .cw-feedback[data-state-kind="denied"]');
  await expect(state).toContainText('로그인 상태 또는 접근 권한이 변경');await expect(page.locator('[data-workspace-view]')).toHaveCount(0);
  await expect(page.locator('.source-link')).toHaveCount(0);await expect(page.locator('.connection-badge')).toHaveCount(0);
  await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('sheet-denied.png'),fullPage:true});
  denied=false;await state.getByRole('button',{name:'페이지 다시 열기'}).click();await expect(page.locator('.rules-table tbody')).toContainText('TestKey');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('sheet late JSON after account change cannot restore content or trigger further reads',async({page})=>{
  const f=await fixture(page);
  await page.addInitScript(()=>{
    const original=window.fetch;window.fetch=async(...args)=>{
      const response=await original(...args);
      if(window.holdSheetJSON&&String(args[0]).includes('/api/spreadsheets/analyze')){
        const json=response.json.bind(response);response.json=async()=>{const value=await json();await new Promise(resolve=>{window.releaseSheetJSON=resolve;});return value;};
      }
      return response;
    };
  });
  await page.goto('https://sheet.workspace.test/migration');await expect(page.locator('.rules-table tbody')).toContainText('TestKey');
  await page.evaluate(()=>{window.holdSheetJSON=true;});await page.getByRole('button',{name:'복사본 분석'}).click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseSheetJSON)).toBe('function');
  await page.evaluate(()=>{document.dispatchEvent(new Event('workspace-entity-scope-change'));window.releaseSheetJSON();});
  await expect(page.locator('main .cw-feedback')).toHaveAttribute('data-state-kind','denied');await expect(page.locator('[data-workspace-view]')).toHaveCount(0);
  const count=f.analyses();await page.evaluate(()=>{history.pushState(null,'','/snapshots');dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page.locator('[data-route-title]')).toHaveText('스냅샷');await expect(page.locator('.snapshot-row')).toHaveCount(0);expect(f.analyses()).toBe(count);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('sheet preview navigation cancels pending comparison and returning permits an explicit fresh read',async({page})=>{
  const f=await fixture(page);let release=null,calls=0;
  const preview={id:'preview',createdAt:analysis.createdAt,target:analysis.spreadsheet,language:'Korean',totals:{tracked:0,changed:0,unchanged:0,sourceSpreadsheets:0,sourceSheets:0},items:[]};
  await page.route('**/api/sync/korean/preview',async route=>{calls++;if(calls===1)await new Promise(resolve=>{release=resolve;});return route.fulfill({json:preview});});
  await page.goto('https://sheet.workspace.test/translations');await page.getByRole('button',{name:'지금 비교하기'}).click();await expect.poll(()=>release!==null).toBe(true);
  await page.locator('[data-workspace-page="sheet.snapshots"]').click();release();await page.goBack();
  await expect(page.locator('main .cw-feedback[data-state-kind="empty"]')).toContainText('원본과 번역 시트');
  await page.getByRole('button',{name:'지금 비교하기'}).click();await expect(page.locator('.sync-metrics')).toBeVisible();
  await expect(page.getByRole('button',{name:'한국어 갱신 실행'})).toBeDisabled();expect(calls).toBe(2);expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});
