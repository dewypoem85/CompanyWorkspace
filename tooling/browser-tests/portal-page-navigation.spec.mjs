import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

const snapshots=resolve(root,'artifacts/razor');
const publicRoot=resolve(root,'apps/portal/wwwroot');

async function fixture(page) {
  const model=JSON.parse(readFileSync(resolve(snapshots,'admin.json'),'utf8'));
  const errors=[];let loads=0,pageGets=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('load',()=>loads++);
  await page.route('**/*',route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:{pages:model.navigation.pages}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/api/workspace/push/devices')return route.fulfill({json:{devices:[]}});
    const document=model.pages.filter(page=>page.path.toLowerCase()===path.toLowerCase()).sort((a,b)=>Object.keys(b.query).length-Object.keys(a.query).length).find(page=>Object.entries(page.query).every(([key,value])=>url.searchParams.get(key)===value));
    if(document){pageGets++;return route.fulfill({body:readFileSync(resolve(snapshots,document.file)),contentType:'text/html'});}
    const file=resolve(publicRoot,path.slice(1));
    if(file.startsWith(publicRoot+sep)&&existsSync(file)&&['.js','.css','.svg','.png'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]});
    return route.abort();
  });
  return {errors,loads:()=>loads,pageGets:()=>pageGets};
}

test('Portal tabs preserve the shell and initialize account management after navigation',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://company.workspace.test/');
  await expect(page.locator('[data-workspace-page="home.users"]')).toBeVisible();
  await page.evaluate(()=>{document.querySelector('[data-company-workspace]').dataset.shellProof='retained';});
  await page.locator('[data-workspace-page="home.users"]').click();
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Users');
  await expect(page.locator('[data-bulk-form]')).toBeVisible();
  await expect(page.locator('[data-company-workspace]')).toHaveAttribute('data-shell-proof','retained');
  await page.locator('[data-workspace-page="home.departments"]').click();
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Organization');
  await expect(page.locator('[data-organization-form]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Users');
  await expect(page.locator('[data-bulk-form]')).toBeVisible();
  expect(state.loads()).toBe(1);
  expect(state.pageGets()).toBe(4);
  expect(state.errors).toEqual([]);
});

test('Portal blocks a tab change until an organization draft is explicitly discarded',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://company.workspace.test/Admin/Organization');
  const name=page.locator('[data-organization-form] [name="Form.Name"]');
  await name.fill('저장하지 않은 부서');
  await page.locator('[data-workspace-page="home.projects"]').click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'취소'}).click();
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Organization');
  await expect(name).toHaveValue('저장하지 않은 부서');
  await page.locator('[data-workspace-page="home.projects"]').click();
  await dialog.getByRole('button',{name:'버리고 이동'}).click();
  await expect(page).toHaveURL('https://company.workspace.test/Admin/Organization?tab=projects');
  expect(state.loads()).toBe(1);
  expect(state.errors).toEqual([]);
});

test('Portal registered sidebar pages switch without reloading the document',async({page})=>{
  const state=await fixture(page);
  await page.goto('https://company.workspace.test/');
  for(const id of ['home.profile','home.users','home.departments','home.projects','home.dashboard']){
    const link=page.locator(`[data-workspace-page="${id}"]`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator(`[data-workspace-view="${id}"]`)).toBeVisible();
  }
  expect(state.loads()).toBe(1);
  expect(state.errors).toEqual([]);
});
