import {test,expect} from '@playwright/test';
import {assertNativeButtons} from './support/native-buttons.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const snapshots=resolve(root,'artifacts/razor');
const feed=JSON.parse(readFileSync(resolve(snapshots,'portal.notifications.large.json'),'utf8'));
for(const width of [320,1440])for(const theme of ['light','dark'])test(`Portal long notification IDs remain exact ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const model=JSON.parse(readFileSync(resolve(snapshots,'admin.json'),'utf8')),writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(req.method()!=='GET'){writes.push(path);return route.fulfill({status:204});}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:feed});
    if(path==='/notifications')return route.fulfill({contentType:'text/html',body:readFileSync(resolve(snapshots,'portal.notifications.large.html'))});
    const base=resolve(root,'apps/portal/wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.css','.js','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://company.workspace.test/notifications');
  await assertNativeButtons(page.locator('[data-notification-center] button'));
  await page.getByRole('button',{name:'알림',exact:true}).click();
  await expect(page.locator('[data-cw-read="schedule:9223372036854775807"]')).toBeVisible();
  await page.locator('[data-cw-read="schedule:9223372036854775807"]').click();
  await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toBe('/api/workspace/notifications/schedule/9223372036854775807/read');
  await page.keyboard.press('Escape');
  // The native center reloads after marking read; wait for the replacement document before teardown.
  await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('[data-center-read="leave:9007199254740993"]').click()]);
  await page.waitForLoadState('load');
  await expect.poll(()=>writes.length).toBe(2);expect(writes[1]).toBe('/api/workspace/notifications/leave/9007199254740993/read');
  await expect(page.locator('.notification-feed')).toBeVisible();
  const colors=await page.locator('.workspace-notification.is-unread').first().evaluate(node=>({border:getComputedStyle(node).borderLeftColor,accent:getComputedStyle(document.documentElement).getPropertyValue('--cw-accent').trim()}));
  const expected=await page.evaluate(color=>{const el=document.createElement('span');el.style.color=color;document.body.append(el);const value=getComputedStyle(el).color;el.remove();return value;},colors.accent);
  expect(colors.border).toBe(expected);
  expect(await page.locator('.notification-meta > span').first().evaluate(node=>node.getBoundingClientRect().height)).toBeLessThan(20);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('notifications.png'),animations:'disabled'});expect(errors).toEqual([]);
});
