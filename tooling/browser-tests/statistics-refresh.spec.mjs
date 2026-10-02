import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';
import { createDemoOverview } from '../../apps/statistics/lib/demo-data.js';
import { publicationRevision } from '../../apps/statistics/lib/publication-contract.js';
import { REFRESH_PROTOCOL, REFRESH_MEDIA_TYPE } from '../../apps/statistics/public/refresh-contract.js';

const publicRoot = resolve(root, 'apps/statistics/public');
const initial = () => ({ status:'idle',runId:null,startedAt:null,completedAt:null,dataThrough:null,refreshAllowedAt:null,nextAt:null,
  inProgress:false,totalProfiles:0,publishedProfiles:0,currentProfile:'',error:'' });
async function fixture(page, options = {}) {
  const user = { id:'9007199254740993',name:'검증 직원',role:options.role || 'employee' };
  const control = { publication:initial(),contextUser:user,posts:[],reads:0,queries:[],errors:[],failOverview:false,hold:false,release:null,mode:'accepted' };
  if (options.cooldown) control.publication = { ...initial(),completedAt:'2026-09-11T00:00:00Z',dataThrough:'2026-09-11T00:00:00Z',refreshAllowedAt:'2026-09-11T01:00:00Z' };
  page.on('pageerror', error => control.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path === '/api/workspace/context') return route.fulfill({json:{authenticated:true,isAdmin:user.role!=='employee',csrfToken:'synthetic',user,employees:[],projects:[],profiles:{},projectIcons:{},services:[{key:'statistics',name:'게임 통계',href:'/workspace/statistics'}]}});
    if (path === '/api/workspace/notifications') return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if (path === '/api/config') return route.fulfill({json:{mode:'live',currentUser:user,storageConfigured:true,sync:{persistence:'azure'},publication:control.publication}});
    if (path === '/api/analytics/overview') {
      control.queries.push(url.search);
      if (control.failOverview) return route.fulfill({status:503,json:{error:'synthetic read failed'}});
      return route.fulfill({json:{...createDemoOverview({from:'2026-09-01',to:'2026-09-07'}),mode:'live',publication:control.publication,publishedAt:control.publication.completedAt}});
    }
    if (path === '/api/analytics/refresh-context') {
      control.reads++;
      return route.fulfill({json:{protocol:REFRESH_PROTOCOL,user:control.contextUser,mode:'live',titleId:'TEST',publication:control.publication,
        revision:publicationRevision(control.publication),available:true,pending:false,serverTime:'2026-09-11T00:30:00Z'}});
    }
    if (path === '/api/analytics/refresh') {
      const input = route.request().postDataJSON(); control.posts.push(input);
      const reply = async () => {
        if (control.mode === 'conflict') return route.fulfill({status:409,contentType:REFRESH_MEDIA_TYPE,body:JSON.stringify({protocol:REFRESH_PROTOCOL,outcome:'conflict',message:'집계 기준값 변경'})});
        if (control.mode === 'denied') return route.fulfill({status:403,contentType:REFRESH_MEDIA_TYPE,body:JSON.stringify({protocol:REFRESH_PROTOCOL,outcome:'denied',message:'권한 변경'})});
        if (control.mode === 'unknown') return route.fulfill({status:202,contentType:REFRESH_MEDIA_TYPE,body:'{"ok":true}'});
        control.publication = { ...control.publication,status:'running',runId:input.requestId,startedAt:'2026-09-11T00:31:00Z',inProgress:true };
        return route.fulfill({status:202,contentType:REFRESH_MEDIA_TYPE,body:JSON.stringify({protocol:REFRESH_PROTOCOL,acceptance:'accepted',requestId:input.requestId,
          user,mode:input.mode,titleId:input.titleId,expectedRevision:input.expectedRevision,force:input.force,publication:control.publication})});
      };
      if (control.hold) return new Promise(done => { control.release = async () => { await reply(); done(); }; });
      return reply();
    }
    const shared = { '/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css' }[path];
    if (shared) return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const file = resolve(publicRoot,path==='/'?'index.html':path.slice(1));
    if (file.startsWith(publicRoot+sep)&&existsSync(file)&&['.html','.js','.css'].includes(extname(file))) return route.fulfill({body:readFileSync(file),contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://statistics.example.com/');
  await expect(page.locator('[data-refresh]')).toBeEnabled();
  await expect(page.locator('[data-analysis-loading]')).toBeHidden();
  return control;
}
const finish = control => { control.publication={...control.publication,status:'ready',inProgress:false,completedAt:'2026-09-11T00:32:00Z',dataThrough:'2026-09-11T00:31:00Z'}; };

for (const width of [320,1440]) for (const theme of ['light','dark']) test(`common confirmation and accepted/completed states ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900}); await page.emulateMedia({colorScheme:theme});
  const control=await fixture(page,{role:'admin',cooldown:true});
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await page.locator('[data-refresh]').click();
  const dialog=page.locator('dialog.cw-confirm'); await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('강제'); await expect(dialog).toContainText('라이브 · TEST');
  expect(control.posts).toHaveLength(0);
  await page.screenshot({path:info.outputPath('confirmation.png'),fullPage:true});
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(page.locator('[data-refresh]')).toBeFocused();
  expect(control.posts).toHaveLength(0);
  await page.locator('[data-refresh]').click(); await page.locator('[data-confirm-apply]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('갱신 요청이 접수되었습니다.');
  expect(control.posts).toHaveLength(1); expect(control.posts[0].force).toBe(true); expect(control.posts[0].expectedUserId).toBe('9007199254740993');
  await expect(page.locator('[data-refresh]')).toBeDisabled(); finish(control);
  await expect(page.locator('[data-refresh-state]')).toContainText('집계와 화면 갱신이 완료되었습니다.',{timeout:8000});
  await page.screenshot({path:info.outputPath('complete.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true); expect(control.errors).toEqual([]);
});
test('employee cooldown has no force option or write',async({page})=>{
  const control=await fixture(page,{cooldown:true}); await page.locator('[data-refresh]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('수동 갱신 대기 시간'); await expect(page.locator('dialog')).toHaveCount(0); expect(control.posts).toHaveLength(0);
});
test('filter edits during pending acceptance resume as GET without a stuck loading overlay or another POST',async({page})=>{
  const control=await fixture(page);control.hold=true;
  await page.locator('[data-refresh]').click();await page.locator('[data-confirm-apply]').click();await expect.poll(()=>control.posts.length).toBe(1);
  const before=control.queries.length;
  await page.locator('#modeLevelMin').fill('3');await page.locator('#modeLevelMin').press('Tab');
  await expect(page.locator('[data-analysis-loading]')).toBeHidden();expect(control.queries.length).toBe(before);
  await control.release();await expect.poll(()=>control.queries.length).toBe(before+1);
  expect(control.queries.at(-1)).toContain('minModeLevel=3');await expect(page.locator('[data-analysis-loading]')).toBeHidden();expect(control.posts).toHaveLength(1);
});
test('changed role from context invalidates the old page even before a shared scope event arrives',async({page})=>{
  const control=await fixture(page,{role:'admin'});control.contextUser={...control.contextUser,role:'employee'};
  await page.locator('[data-refresh]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('회사 계정이나 권한이 변경');
  await expect(page.locator('[data-refresh]')).toBeDisabled();await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('[data-page]:not(.hidden)')).toHaveCount(0);expect(control.posts).toHaveLength(0);expect(control.errors).toEqual([]);
});
test('definite conflict permits a fresh confirmation; malformed success allows reads only',async({page})=>{
  const control=await fixture(page); control.mode='conflict';
  await page.locator('[data-refresh]').click(); await page.locator('[data-confirm-apply]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('갱신 요청이 거부되었습니다.'); await expect(page.locator('[data-refresh]')).toBeEnabled();
  control.mode='unknown'; await page.locator('[data-refresh]').click(); await page.locator('[data-confirm-apply]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('접수 여부가 미확정'); await expect(page.locator('[data-refresh]')).toBeDisabled();
  await page.locator('[data-refresh-state] [data-state-action]').click(); await expect(page.locator('[data-refresh-state]')).toContainText('조회로 재실행 잠금을 해제하지 않습니다.'); expect(control.posts).toHaveLength(2);
});
for(const moment of ['confirm','post','pagehide'])test(`${moment} invalidation rejects late responses and repeated writes`,async({page})=>{
  const control=await fixture(page); control.hold=true;
  await page.locator('[data-refresh]').click(); await expect(page.locator('dialog')).toBeVisible();
  if(moment!=='confirm'){await page.locator('[data-confirm-apply]').click();await expect.poll(()=>control.posts.length).toBe(1);}
  await page.evaluate(type=>type==='pagehide'?window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})):document.dispatchEvent(new Event('workspace-entity-scope-change')),moment);
  await expect(page.locator('dialog')).toHaveCount(0); await expect(page.locator('[data-refresh]')).toBeDisabled();
  if(control.release)await control.release();
  if(moment!=='pagehide')await expect(page.locator('[data-refresh-state]')).toContainText('회사 계정이나 권한이 변경');
  await expect(page.locator('[data-refresh-state]')).not.toContainText('요청이 접수되었습니다.'); expect(control.errors).toEqual([]);
});
test('completed publication plus failed overview is read-only recovery, never another POST',async({page})=>{
  const control=await fixture(page); await page.locator('[data-refresh]').click(); await page.locator('[data-confirm-apply]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('접수되었습니다'); control.failOverview=true; finish(control);
  await expect(page.locator('[data-refresh-state]')).toContainText('집계는 완료됐지만 화면을 갱신하지 못했습니다.',{timeout:8000});
  control.failOverview=false; await page.locator('[data-refresh-state] [data-state-action]').click();
  await expect(page.locator('[data-refresh-state]')).toContainText('집계와 화면 갱신이 완료되었습니다.');expect(control.posts).toHaveLength(1);
});
test('POST timeout does not accept a late response or unlock repeated submission',async({page})=>{
  await page.clock.install(); const control=await fixture(page); control.hold=true;
  await page.locator('[data-refresh]').click(); await page.locator('[data-confirm-apply]').click();await expect.poll(()=>control.posts.length).toBe(1);
  await page.clock.fastForward(31000);await expect(page.locator('[data-refresh-state]')).toContainText('접수 여부가 미확정');
  await control.release();await expect(page.locator('[data-refresh]')).toBeDisabled();expect(control.posts).toHaveLength(1);expect(control.errors).toEqual([]);
});

test('non-abortable late JSON cannot repaint or clear scope denial',async({page})=>{
  const control=await fixture(page);
  await page.evaluate(()=>{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      const response=await original(...args);
      if(String(args[0])==='/api/analytics/refresh'){
        const value=await response.json();
        response.json=()=>new Promise(resolve=>{window.releaseRefreshJson=()=>resolve(value)});
      }
      return response;
    };
  });
  await page.locator('[data-refresh]').click();await page.locator('[data-confirm-apply]').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseRefreshJson)).toBe('function');
  await page.evaluate(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await expect(page.locator('[data-refresh-state]')).toContainText('회사 계정이나 권한이 변경');
  await page.evaluate(()=>window.releaseRefreshJson());
  await expect(page.locator('[data-refresh-state]')).toContainText('회사 계정이나 권한이 변경');
  await expect(page.locator('[data-refresh]')).toBeDisabled();expect(control.posts).toHaveLength(1);expect(control.errors).toEqual([]);
});
