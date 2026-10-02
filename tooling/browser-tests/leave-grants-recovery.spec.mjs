import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

// Actual Razor failure response from the isolated SSO/SQLite integration test. This
// verifies recovery, not the still-pending enhanced adjustment editor migration.
for(const width of [320,1440])for(const theme of ['light','dark'])test(`grant native recovery remains readable and non-writing ${width} ${theme}`,async({page},info)=>{
  const dir=resolve(root,'artifacts/razor'),model=JSON.parse(readFileSync(resolve(dir,'leave.adjustment-recovery.json'),'utf8')),html=readFileSync(resolve(dir,'leave.adjustment-recovery.html'),'utf8');
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=='GET'){writes.push(url.pathname);return route.abort();}
    if(url.pathname==='/api/workspace/context')return route.fulfill({json:model.context});
    if(url.pathname==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(url.pathname==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.pathname==='/Admin/Adjustments')return route.fulfill({body:html,contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,url.pathname.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/Adjustments');await expect(page.locator('.cw-header')).toBeVisible();
  const state=page.locator('[data-workspace-state="error"]');await expect(state).toContainText('자동 만료일을 계산할 수 없는 날짜');await expect(state).toHaveClass(/cw-feedback/);await expect(state).toHaveAttribute('role','alert');
  const raw=page.locator('.adjustment-raw-draft');await expect(raw).toBeVisible();expect(JSON.parse(await raw.textContent()).Note).toEqual(['<script>injected()</script>']);
  await expect(page.locator('main form[method=post]')).toHaveCount(0);const link=page.getByRole('link',{name:'최신 발생분 내역 확인'});await expect(link).toHaveAttribute('target','_blank');await link.focus();await expect(link).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(writes).toEqual([]);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('grant-recovery.png'),animations:'disabled'});
});
