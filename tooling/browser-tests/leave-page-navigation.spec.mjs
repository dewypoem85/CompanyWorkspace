import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

const pages=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(page=>page.service==='leave');
const snapshots=resolve(root,'artifacts/razor');

async function fixture(page) {
  const model=JSON.parse(readFileSync(resolve(snapshots,'leave.admin.json'),'utf8'));
  const errors=[];let loads=0,pageGets=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('load',()=>loads++);
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.searchParams.get('handler')==='QueueSummary')return route.fulfill({json:model.approvalSummary});
    if(path==='/Admin/Adjustments'&&url.searchParams.get('handler')==='Baseline')return route.fulfill({status:model.grantCatalogs?.[url.searchParams.get('employeeId')]?200:404,json:model.grantCatalogs?.[url.searchParams.get('employeeId')]||{}});
    if(url.searchParams.get('handler')==='Queue')return route.fulfill({body:readFileSync(resolve(snapshots,'leave.queue.admin.html')),contentType:'text/html'});
    const definition=pages.find(page=>[page.path,...page.aliases||[]].some(candidate=>candidate.toLowerCase()===path.toLowerCase())&&Object.entries(page.query||{}).every(([key,value])=>url.searchParams.get(key)===value));
    const document=model.pages.find(page=>page.id===definition?.id);
    if(document){pageGets++;return route.fulfill({body:readFileSync(resolve(snapshots,document.file)),contentType:'text/html'});}
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot');
    const file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg','.png'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]});
    return route.abort();
  });
  return {errors,loads:()=>loads,pageGets:()=>pageGets};
}

test('Leave dashboard and usage tabs keep one document and restore page scripts on Back',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://leave.workspace.test/Leave');
  await expect(page.locator('[data-workspace-view="leave.dashboard"]')).toBeVisible();
  await expect(page.locator('[data-workspace-page="leave.usage"]')).toBeVisible();
  await page.evaluate(()=>{document.querySelector('[data-company-workspace]').dataset.shellProof='retained';});
  await page.locator('[data-workspace-page="leave.usage"]').click();
  await expect(page).toHaveURL('https://leave.workspace.test/Leave/Usage');
  await expect(page.locator('[data-workspace-view="leave.usage"]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('https://leave.workspace.test/Leave');
  await expect(page.locator('[data-workspace-view="leave.dashboard"]')).toBeVisible();
  await expect(page.locator('[data-company-workspace]')).toHaveAttribute('data-shell-proof','retained');
  expect(state.loads()).toBe(1);
  expect(state.pageGets()).toBe(3);
  expect(state.errors).toEqual([]);
});

test('Leave admin module pages reinitialize without a document reload',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://leave.workspace.test/Admin/Holidays');
  await expect(page.locator('[data-workspace-page="leave.notifications.settings"]')).toBeVisible();
  await page.locator('[data-workspace-page="leave.notifications.settings"]').click();
  await expect(page).toHaveURL('https://leave.workspace.test/Admin/NotificationSettings');
  await expect(page.locator('[data-webhook-screen]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('https://leave.workspace.test/Admin/Holidays');
  await expect(page.locator('[data-holiday-screen]')).toBeVisible();
  expect(state.loads()).toBe(1);
  expect(state.errors).toEqual([]);
});

test('Leave keeps an unsaved application when tab navigation is cancelled',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://leave.workspace.test/Leave');
  await page.locator('#openApplyPanel').click();
  const reason=page.locator('#applyForm [name="Input.Reason"]');
  await reason.fill('저장하지 않은 연차 사유');
  await page.locator('[data-workspace-page="leave.usage"]').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'취소'}).click();
  await expect(page).toHaveURL('https://leave.workspace.test/Leave');
  await expect(reason).toHaveValue('저장하지 않은 연차 사유');
  expect(state.loads()).toBe(1);
  expect(state.errors).toEqual([]);
});

test('Leave registered sidebar pages switch without reloading the document',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://leave.workspace.test/Leave');
  const ids=pages.filter(item=>item.clientNavigation&&item.nav!==false).map(item=>item.id);
  for(const id of ids){
    const link=page.locator(`[data-workspace-page="${id}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator(`[data-workspace-view="${id}"]`)).toBeVisible();
  }
  expect(state.loads()).toBe(1);
  expect(state.errors).toEqual([]);
});
