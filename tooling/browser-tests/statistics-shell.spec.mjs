import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';
import { createDemoOverview } from '../../apps/statistics/lib/demo-data.js';
import { PAGE_FILES } from '../../apps/statistics/public/workspace-routes.js';

const definitions=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='statistics');
const menuCount=definitions.filter(p=>p.nav!==false).length;
const publicRoot=resolve(root,'apps/statistics/public');
const context={authenticated:true,isAdmin:false,csrfToken:'synthetic',user:{id:1,name:'검증 직원',email:'test@example.test',role:'employee'},profiles:{},projects:[],projectIcons:{},employees:[],services:[{key:'statistics',name:'게임 통계',href:'/workspace/statistics'}]};
const payload=createDemoOverview({from:'2026-09-01',to:'2026-09-07'});
async function fixture(page,authorized=true){
  const errors=[], queries=[]; let documents=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents++;
    if(path==='/api/workspace/context')return route.fulfill({json:authorized?context:{...context,services:[]}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.origin==='https://company.example.com'&&path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    if(path==='/api/config')return route.fulfill({json:{storageConfigured:true,sync:{persistence:'azure'},publication:{inProgress:false}}});
    if(path==='/api/analytics/overview'){queries.push(url.search);return route.fulfill({json:payload});}
    const shared={
      '/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js',
      '/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js',
      '/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'
    }[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const filename=new Map(PAGE_FILES).get(path)?.[0] || path.slice(1);
    const file=resolve(publicRoot,filename);
    if(file.startsWith(publicRoot+sep)&&existsSync(file)&&['.html','.js','.css','.png','.webp','.svg'].includes(extname(file))){
      const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}[extname(file)];
      return route.fulfill({body:readFileSync(file),contentType:type});
    }
    return route.abort();
  });
  return {errors,queries,documents:()=>documents};
}
for(const definition of definitions)for(const width of [320,390,1440])for(const theme of ['light','dark']){
  test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
    const f=await fixture(page);
    await page.goto('https://statistics.workspace.test'+definition.path);
    await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    if(width<901){
      const offset=await page.evaluate(()=>({header:document.querySelector('.cw-header').getBoundingClientRect().bottom,bar:document.querySelector('.topbar').getBoundingClientRect().top}));
      expect(offset.bar).toBeGreaterThanOrEqual(offset.header-1);
      expect(offset.header).toBeLessThanOrEqual(56);
      await expect(page.locator('.topbar .breadcrumb')).toBeHidden();
      await expect(page.locator('.topbar-actions')).toBeVisible();
    }
    await expect(page.locator('[data-route-title]')).toHaveText(definition.title);
    await expect(page.locator('[data-page]:not(.hidden)')).toHaveAttribute('data-page',definition.view);
    await expect(page.locator('.cw-page-link')).toHaveCount(menuCount);
    await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',definition.parent||definition.id);
    await expect(page.locator('[data-persistence]')).toHaveText('Azure 영속 저장');
    const source=page.locator('[data-source-badge]');
    await expect(source).toHaveClass(/\bcw-state-pill\b/);
    await expect(source).toHaveAttribute('data-tone','warning');
    const sourceColors=await source.evaluate(node=>{const probe=document.createElement('i');probe.style.backgroundColor='var(--cw-warning-bg)';probe.style.color='var(--cw-warning)';document.body.append(probe);const result={background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,expectedBackground:getComputedStyle(probe).backgroundColor,expectedColor:getComputedStyle(probe).color};probe.remove();return result});
    expect(sourceColors.background).toBe(sourceColors.expectedBackground);
    expect(sourceColors.color).toBe(sourceColors.expectedColor);
    await expect(page.locator('[data-message]')).toBeHidden();
    await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
    const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,shell:['.workspace','.topbar','.topbar-actions','[data-source-badge]','.filterbar'].map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{selector,width:r.width,right:r.right,scrollWidth:e.scrollWidth,minWidth:s.minWidth,maxWidth:s.maxWidth,flex:s.flex,overflow:s.overflowX}}),wide:[...document.querySelectorAll('body *')].filter(e=>!e.closest('.table-wrap')&&e.getBoundingClientRect().right>innerWidth+1).slice(0,30).map(e=>({tag:e.tagName,css:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,scrollWidth:e.scrollWidth,parent:e.parentElement.className,overflow:getComputedStyle(e).overflowX}))}));
    await page.screenshot({path:info.outputPath('content.png'),animations:'disabled'});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),{message:JSON.stringify(geometry)}).toBe(true);
    if(definition.view==='results')await page.locator('.schema-panel').screenshot({path:info.outputPath('schema.png'),animations:'disabled'});
    if(width<901)await page.locator('[data-cw-nav]').click();
    await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
    await page.screenshot({path:info.outputPath('navigation.png'),animations:'disabled'});
    expect(f.errors).toEqual([]);
  });
}
test('dynamic navigation preserves filters, title, active item and browser history without reload',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const f=await fixture(page);
  await page.goto('https://statistics.workspace.test/');
  await expect(page.locator('.cw-page-link')).toHaveCount(menuCount);
  await page.locator('#modeLevelMin').fill('8');await page.locator('#modeLevelMin').dispatchEvent('change');
  await expect.poll(()=>f.queries.some(q=>q.includes('minModeLevel=8'))).toBe(true);
  for(const id of ['results','builds','bosses']){
    await page.locator(`[data-workspace-page="statistics.${id}"]`).click();
    await expect(page.locator('[data-page]:not(.hidden)')).toHaveAttribute('data-page',id);
    await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page','statistics.'+id);
    await expect(page.locator('#modeLevelMin')).toHaveValue('8');
  }
  await page.goBack();await expect(page.locator('[data-route-title]')).toHaveText('빌드 분석');
  await page.goForward();await expect(page.locator('[data-route-title]')).toHaveText('보스 분석');
  expect(f.documents()).toBe(1);expect(f.errors).toEqual([]);
});
test('permission revocation hides menus while keeping account status visible',async({page})=>{
  const f=await fixture(page,false);await page.goto('https://statistics.workspace.test/');
  await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await expect(page.locator('.cw-sidebar')).toBeHidden();expect(f.errors).toEqual([]);
});

test('statistics rejects non-JSON bootstrap responses before rendering analytics',async({page})=>{
  const f=await fixture(page);
  await page.route('**/api/config',route=>route.fulfill({status:200,contentType:'text/html',body:'<html>login</html>'}));
  await page.goto('https://statistics.workspace.test/');
  await expect(page.locator('[data-message]')).toContainText('서버 응답 형식을 확인하지 못했습니다.');
  await expect(page.locator('[data-updated]')).toHaveText('집계 완료 시각 확인 중');
  expect(f.errors).toEqual([]);
});

test('statistics rejects malformed nested overview data before replacing the completed view',async({page})=>{
  const f=await fixture(page);
  const malformed=structuredClone(payload);malformed.builds.characters[0].components.weapons[0].adoptionRate='62.2';
  await page.route('**/api/analytics/overview?*',route=>route.fulfill({json:malformed}));
  await page.goto('https://statistics.workspace.test/');
  await expect(page.locator('[data-message]')).toContainText('builds.characters[0].components.weapons[0]');
  await expect(page.locator('[data-updated]')).toHaveText('집계 완료 시각 확인 중');
  await expect(page.locator('[data-kpi="totalRuns"]')).toHaveText('—');
  expect(f.errors).toEqual([]);
});

test('statistics scope invalidation rejects overview JSON released after cancellation',async({page})=>{
  await page.addInitScript(()=>{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      const response=await original(...args),url=new URL(typeof args[0]==='string'?args[0]:args[0].url,location.href);
      if(url.pathname==='/api/analytics/overview'){
        const value=await response.json();
        response.json=()=>new Promise(resolve=>{window.releaseStatisticsOverview=()=>resolve(value)});
      }
      return response;
    };
  });
  const f=await fixture(page);await page.goto('https://statistics.workspace.test/');
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseStatisticsOverview)).toBe('function');
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await page.evaluate(()=>window.releaseStatisticsOverview());
  await expect(page.locator('[data-source-badge]')).toHaveText('계정 확인 필요');
  await expect(page.locator('[data-page]:not(.hidden)')).toHaveCount(0);
  await expect(page.locator('[data-updated]')).toHaveText('집계 완료 시각 확인 중');
  expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`populated detail links and refresh retain selection ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);
  for(const kind of ['build','boss']) {
    const listing=kind==='build'?'builds':'bosses';
    await page.goto(`https://statistics.workspace.test/${listing}`);
    await page.locator(`[data-${kind}-rows] tr.clickable-row`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${listing}/detail\\?.*key=`));
    const title=page.locator(kind==='build'?'[data-detail-title]':'[data-boss-detail-title]');
    await expect(title).not.toContainText('찾을 수 없습니다');
    const selected=await title.textContent();expect(selected.trim()).not.toBe('');
    const url=page.url();await page.reload();
    await expect(title).toHaveText(selected);
    await expect(page).toHaveURL(url);
    await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',`statistics.${listing}`);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath(`${kind}-detail.png`),animations:'disabled'});
  }
  expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared controls keep states, native validation and table navigation ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://statistics.workspace.test/builds');
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await expect(page.locator('[data-combination-node-control]')).toBeHidden();
  const colors=await page.evaluate(()=>{
    const probe=document.createElement('span');document.body.append(probe);
    const resolved={};for(const key of ['active','active-text','raised','text','line','accent','muted','hover','success','danger','warning']){probe.style.color=`var(--cw-${key})`;resolved[key]=getComputedStyle(probe).color;}probe.remove();return resolved;
  });
  const progress=page.locator('#afterFirstMiddleBoss'),progressControl=progress.locator('xpath=..');
  await expect(progress).toHaveClass(/\bcw-checkbox\b/);await expect(progressControl).toHaveClass(/\bcw-check-control\b/);expect((await progress.boundingBox()).width).toBe(18);await expect(progressControl).toHaveCSS('background-color',colors.active);
  await progressControl.screenshot({path:info.outputPath('progress-filter-selected.png'),animations:'disabled'});
  await expect(page.locator('[data-days="7"]')).toHaveCSS('background-color',colors.active);
  await expect(page.locator('[data-days="30"]')).toHaveCSS('background-color',colors.raised);
  await page.locator('[data-days="30"]').click();
  await expect(page.locator('[data-days="30"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-days="30"]')).toHaveCSS('background-color',colors.active);
  await expect(page.locator('[data-days="7"]')).toHaveCSS('background-color',colors.raised);
  await page.locator('[data-days="30"]').evaluate(button=>button.dataset.variant='quiet');
  await page.locator('[data-days="30"]').hover();
  await expect(page.locator('[data-days="30"]'),'quiet selected hover must not erase selection').toHaveCSS('background-color',colors.active);
  await page.locator('[data-days="30"]').evaluate(button=>delete button.dataset.variant);
  await page.locator('#modeLevelMin').fill('-1');expect(await page.locator('#modeLevelMin').evaluate(e=>e.validity.rangeUnderflow)).toBe(true);
  await page.locator('#modeLevelMin').fill('5');await page.locator('#modeLevelMin').focus();
  await expect(page.locator('#modeLevelMin')).toHaveCSS('background-color',colors.raised);
  await expect(page.locator('#modeLevelMin')).toHaveCSS('outline-color',colors.accent);
  await page.locator('#modeLevelMin').press('Tab');await expect.poll(()=>f.queries.some(q=>q.includes('minModeLevel=5'))).toBe(true);
  await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await page.locator('[data-build-type="combinations"]').click();
  await expect(page.locator('[data-combination-node-control]')).toBeVisible();
  await expect(page.locator('[data-build-type="combinations"]')).toHaveCSS('background-color',colors.active);
  const combination=page.locator('#combinationNodes'),combinationControl=combination.locator('xpath=..');
  await expect(combination).toHaveClass(/\bcw-checkbox\b/);await expect(combinationControl).toHaveClass(/\bcw-check-control\b/);expect((await combination.boundingBox()).width).toBe(18);await expect(combinationControl).toHaveCSS('background-color',colors.raised);
  await combination.check();await expect(combinationControl).toHaveCSS('background-color',colors.active);await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');await combinationControl.screenshot({path:info.outputPath('combination-filter-selected.png'),animations:'disabled'});
  await combination.uncheck();await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  await page.locator('[data-build-type="characters"]').click();
  await expect(page.locator('[data-combination-node-control]')).toBeHidden();
  await page.locator('[data-build-sort="name"]').click();
  await expect(page.locator('[data-sort-column="name"]')).toHaveAttribute('aria-sort','ascending');
  await expect(page.locator('[data-build-sort="name"]')).toHaveCSS('background-color',colors.active);
  await page.locator('[data-build-sort="name"]').click();
  await expect(page.locator('[data-sort-column="name"]')).toHaveAttribute('aria-sort','descending');
  const help=page.locator('.build-table .help-tip').first();await page.locator('[data-build-sort="name"]').press('Tab');
  await expect(help).toBeFocused();
  await expect(help).toHaveCSS('outline-color',colors.accent);
  const table=page.locator('.build-table');
  await expect(table.locator('th').first()).toHaveCSS('background-color',colors.raised);
  await expect(table.locator('tbody td').first()).toHaveCSS('color',colors.text);
  for(const tone of ['success','danger','warning']){
    const cells=table.locator(`td[data-tone="${tone}"]`);
    if(await cells.count())await expect(cells.first()).toHaveCSS('color',colors[tone]);
  }
  expect(await table.locator('td[data-tone]').count()).toBeGreaterThan(0);
  await table.locator('tbody tr').first().focus();
  await expect(table.locator('tbody tr').first()).toHaveCSS('background-color',colors.hover);
  await table.locator('tbody tr').first().hover();
  expect(await table.locator('tbody td').first().evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgb(16, 40, 59)');
  await page.locator('.build-table').screenshot({path:info.outputPath('shared-table.png'),animations:'disabled'});
  if(width<901){
    const scroller=table.locator('..');
    expect(await scroller.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
    await scroller.evaluate(e=>e.scrollLeft=e.scrollWidth);
    expect(await scroller.evaluate(e=>e.scrollLeft)).toBeGreaterThan(0);
    const edge=await scroller.boundingBox(),last=await table.locator('tbody tr').first().locator('td').last().boundingBox();
    expect(last.x+last.width).toBeLessThanOrEqual(edge.x+edge.width+1);
    await scroller.screenshot({path:info.outputPath('shared-table-scrolled.png'),animations:'disabled'});
    await scroller.evaluate(e=>e.scrollLeft=0);
  }
  const missing=await page.evaluate(()=>[...document.querySelectorAll('.topbar button,.filterbar button,main button,main table,.filterbar input:not([type=checkbox]),.filterbar select,main input:not([type=checkbox]),main select')].filter(e=>!e.closest('[data-company-workspace],.cw-sidebar')&&!e.classList.contains(e.tagName==='BUTTON'?'cw-button':e.tagName==='TABLE'?'cw-data-table':'cw-form-control')).map(e=>e.outerHTML.slice(0,150)));
  expect(missing).toEqual([]);
  await page.locator('[data-build-catalog] button').first().click();
  await expect(page.locator('[data-page="buildDetail"]')).toBeVisible();
  expect(await page.locator('main button:not(.cw-button)').count()).toBe(0,'dynamic loadout and combination actions use the same button');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator('[data-refresh]').evaluate(button=>button.disabled=true);
  await expect(page.locator('[data-refresh]')).toHaveCSS('background-color',colors.raised);
  await expect(page.locator('[data-refresh]')).toHaveCSS('color',colors.muted);
  await page.locator('[data-refresh]').evaluate(button=>button.disabled=false);
  await page.screenshot({path:info.outputPath('shared-detail.png'),animations:'disabled'});
  await page.goto('https://statistics.workspace.test/bosses');await expect(page.locator('#main')).not.toHaveAttribute('aria-busy','true');
  const linked=page.locator('#bossLinked'),linkedControl=linked.locator('xpath=..');await expect(linked).toHaveClass(/\bcw-checkbox\b/);await expect(linkedControl).toHaveClass(/\bcw-check-control\b/);expect((await linked.boundingBox()).width).toBe(18);await expect(linkedControl).toHaveCSS('background-color',colors.raised);await linked.check();await expect(linkedControl).toHaveCSS('background-color',colors.active);await linkedControl.screenshot({path:info.outputPath('boss-filter-selected.png'),animations:'disabled'});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(f.errors).toEqual([]);
});
