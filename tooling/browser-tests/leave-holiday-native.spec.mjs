import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

// Real server-rendered failure after SQLite commit + audit failure, not a fabricated error screen.
for(const width of [320,1440])for(const theme of ['light','dark'])test(`holiday native unknown preserves source and locks writes ${width}px ${theme}`,async({page},info)=>{
  const dir=resolve(root,'artifacts/razor'),model=JSON.parse(readFileSync(resolve(dir,'leave.holiday.json'),'utf8'));
  const errors=[],writes=[],unhandled=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/Admin/Holidays')return route.fulfill({body:readFileSync(resolve(dir,'leave.holiday.unknown.html')),contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/Holidays?Year=2026');
  await expect(page.locator('.cw-header')).toHaveCount(1);
  await expect(page.locator('main .error')).toContainText('이미 반영되었을 수');
  const recheck=page.locator('[data-holiday-recheck] a');
  await expect(recheck).toBeVisible();await expect(recheck).toHaveAttribute('target','_blank');await expect(recheck).toHaveAttribute('href','/Admin/Holidays?Year=2026');
  for(const button of await page.locator('[data-holiday-fields] button').all())await expect(button).toBeDisabled();
  const json=page.locator('[name="Import.JsonText"]');await expect(json).toHaveValue(/"name":" A "/);
  await page.screenshot({path:info.outputPath('unknown.png'),animations:'disabled'});
  await json.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('source.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(errors).toEqual([]);expect(writes).toEqual([]);expect(unhandled).toEqual([]);
});
