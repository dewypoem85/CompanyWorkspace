import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {root} from '../build-ui.mjs';
import {resolvePublicAsset} from '../../apps/cs/lib/public-assets.js';

const context={authenticated:true,isAdmin:true,csrfToken:'synthetic-only',user:{id:17,name:'검증 직원',email:'ui@example.test',role:'admin'},profiles:{},projects:[],projectIcons:{},employees:[],services:[{key:'cs',name:'CS',href:'https://cs.workspace.test/refunds'}]};
const mockModule=id=>`let active;export function currentLifecycle(){return active;}export function mount(){document.querySelector('[data-workspace-view="${id}"]').dataset.initialized='true';active={dispose(){},beforeLeave(){return true;}};return active;}mount();`;

test('CS internal tabs keep the shared document, update URL and remount page state',async({page})=>{
  const errors=[];let loads=0,pageGets=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('load',()=>loads++);
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    const shared={'/js/company-workspace.js':'apps/portal/wwwroot/js/company-workspace.js','/js/company-entities.js':'apps/portal/wwwroot/js/company-entities.js','/css/company-workspace.css':'apps/portal/wwwroot/css/company-workspace.css'}[path];
    if(shared)return route.fulfill({body:readFileSync(resolve(root,shared)),contentType:extname(shared)==='.css'?'text/css':'application/javascript'});
    const modules={'/app.js':'cs.refunds','/product-commands.js':'cs.products','/playfab-logs.js':'cs.logs','/player-data.js':'cs.players'};
    if(modules[path])return route.fulfill({body:mockModule(modules[path]),contentType:'text/javascript'});
    const asset=resolvePublicAsset(resolve(root,'apps/cs/public'),path);
    if(asset){
      if(asset.contentType.startsWith('text/html'))pageGets++;
      return route.fulfill({body:readFileSync(asset.filePath),contentType:asset.contentType,headers:asset.contentType.startsWith('text/html')?{'X-Workspace-Identity':'17'}:{}});
    }
    return route.abort();
  });
  await page.goto('https://cs.workspace.test/refunds');
  await expect(page.locator('[data-workspace-view="cs.refunds"][data-initialized="true"]')).toBeVisible();
  await expect(page.locator('[data-workspace-page="cs.logs"]')).toBeVisible();
  await page.evaluate(()=>{document.querySelector('[data-company-workspace]').dataset.shellProof='retained';});
  await page.locator('[data-workspace-page="cs.logs"]').click();
  await expect(page).toHaveURL('https://cs.workspace.test/logs');
  await expect(page.locator('[data-workspace-view="cs.logs"][data-initialized="true"]')).toBeVisible();
  await expect(page.locator('[data-company-workspace]')).toHaveAttribute('data-shell-proof','retained');
  for(const id of ['cs.products','cs.players']){
    await page.locator(`[data-workspace-page="${id}"]`).click();
    await expect(page.locator(`[data-workspace-view="${id}"][data-initialized="true"]`)).toBeVisible();
  }
  await page.goBack();
  await expect(page).toHaveURL('https://cs.workspace.test/products');
  await expect(page.locator('[data-workspace-view="cs.products"][data-initialized="true"]')).toBeVisible();
  expect(loads).toBe(1);
  expect(pageGets).toBe(5);
  expect(errors).toEqual([]);
});
