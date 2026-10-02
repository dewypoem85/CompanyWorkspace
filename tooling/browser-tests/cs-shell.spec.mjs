import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { root } from '../build-ui.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { assertCsControls, assertCsStatePill } from './support/cs-controls.mjs';
import { assertCallouts } from './support/callouts.mjs';

const pages=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='cs');
const context={authenticated:true,isAdmin:true,csrfToken:'synthetic-only',user:{id:1,name:'검증 직원',email:'ui@example.test',role:'admin'},profiles:{},projects:[],projectIcons:{},employees:[],services:[
  {key:'schedule',name:'팀 일정',href:'/workspace/schedule'}, {key:'leave',name:'연차관리',href:'/workspace/leave'},
  {key:'cs',name:'CS',href:'/workspace/cs'},{key:'statistics',name:'게임 통계',href:'/workspace/statistics'},
  {key:'sheet',name:'시트 관리',href:'/workspace/sheet'}
]};

// These tests exercise real HTML/CSS + shared JS, but intentionally do not execute
// domain modules or use real employee/PlayFab/Azure data. Domain suites run separately.
async function fixture(page,allowed=true){
  const failures=[]; page.on('pageerror',error=>failures.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url()), path=url.pathname;
    if (path==='/api/workspace/context') return route.fulfill({json:allowed?context:{...context,services:[]}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.origin==='https://company.example.com'&&path==='/images/company-logo.png')return route.fulfill({body:readFileSync(resolve(root,'apps/portal/wwwroot/images/company-logo.png')),contentType:'image/png'});
    const shared={
      '/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js',
      '/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js',
      '/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'
    }[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const asset=resolvePublicAsset(resolve(root,'apps/cs/public'),path);
    if(asset){
      // Preserve the theme bridge; domain initializers are not part of this shell test.
      if(asset.contentType.startsWith('text/javascript')&&path!=='/theme.js')return route.fulfill({body:'/* Domain module isolated for shell tests. */',contentType:'application/javascript'});
      return route.fulfill({body:readFileSync(asset.filePath),contentType:asset.contentType});
    }
    return route.abort(); // No external network, including production APIs.
  });
  return failures;
}
test('CS company logo loads under production image and style policy',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  const errors=await fixture(page);
  await page.route('https://cs.workspace.test/',route=>route.fulfill({body:readFileSync(resolve(root,'apps/cs/public/index.html')),contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'self'; base-uri 'none'; connect-src 'self' https://company.example.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' https://company.example.com; object-src 'none'; script-src 'self' https://company.example.com; style-src 'self' https://company.example.com"}}));
  await page.goto('https://cs.workspace.test/');
  await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  expect(errors).toEqual([]);
});

for(const definition of pages)for(const width of [320,390,1440])for(const theme of ['light','dark']){
  test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.emulateMedia({colorScheme:theme});
    const errors=await fixture(page);
    await page.goto('https://cs.workspace.test'+definition.path);
    await expect(page.locator('.cw-page-link')).toHaveCount(pages.length);
    await expect(page.locator('.cw-header')).toHaveCount(1);
    await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
    await expect(page.locator('.cw-sidebar')).toHaveCount(1);
    if(width<901){
      const offset=await page.evaluate(()=>({header:document.querySelector('.cw-header').getBoundingClientRect().bottom,bar:document.querySelector('.workspace-topbar').getBoundingClientRect().top,position:getComputedStyle(document.querySelector('.workspace-topbar')).position}));
      expect(offset.bar).toBeGreaterThanOrEqual(offset.header-1);
      expect(offset.header).toBeLessThanOrEqual(56);
      expect(offset.position).toBe('static');
      await expect(page.locator('.workspace-topbar .breadcrumbs')).toBeHidden();
      await expect(page.locator('.cw-current')).toBeVisible();
    }
    await expect(page.locator('.cw-page-link[aria-current="page"]')).toHaveAttribute('data-workspace-page',definition.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const expectedPills={'cs.refunds':3,'cs.players':1,'cs.logs':2,'cs.products':2}[definition.id];
    await expect(page.locator('.cw-state-pill')).toHaveCount(expectedPills);
    expect(await page.locator('.cw-state-pill').evaluateAll(nodes=>nodes.every(node=>node.dataset.tone==='neutral'))).toBe(true);
    await assertCsStatePill(page,'.workspace-topbar .cw-state-pill','neutral');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await assertCsControls(page);
    await assertCallouts(page,definition.id==='cs.refunds'?1:definition.id==='cs.logs'?2:3);
    await page.screenshot({path:info.outputPath('controls.png'),fullPage:true,animations:'disabled'});
    if(width<901){
      await expect(page.locator('[data-cw-service-menu]')).toBeVisible();
      await expect(page.locator('.cw-services-inline')).toHaveAttribute('aria-hidden','true');
      await page.locator('[data-cw-nav]').click();
    }
    await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','false');
    // aria state changes before the CSS transition finishes; verify the actual geometry too.
    await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
    const styles=await page.locator('.cw-page-nav').evaluate(nav=>{
      const active=nav.querySelector('[aria-current]'), idle=nav.querySelector('a:not([aria-current])');
      return {active:getComputedStyle(active).backgroundColor,idle:getComputedStyle(idle).backgroundColor,color:getComputedStyle(active).color};
    });
    expect(styles.active).not.toBe(styles.idle);
    expect(styles.color).not.toBe(styles.active);
    await page.screenshot({path:info.outputPath('navigation.png'),fullPage:false,animations:'disabled'});
    await page.locator('[data-cw-sidebar-close]').click();
    await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','true');
    await page.locator('[data-cw-nav]').click();
    await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','false');
    if(width<901){await page.keyboard.press('Escape');await expect(page.locator('.cw-sidebar')).toHaveAttribute('aria-hidden','true');}
    expect(errors).toEqual([]);
  });
}
test('denied service does not expose its submenu',async({page})=>{
  const errors=await fixture(page,false);await page.goto('https://cs.workspace.test/players');
  await expect(page.locator('[data-cw-account]')).toContainText('검증 직원');
  await expect(page.locator('.cw-page-link')).toHaveCount(0);
  await expect(page.locator('.cw-sidebar')).toBeHidden();expect(errors).toEqual([]);
});
