import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

const snapshots=resolve(root,'artifacts/razor');
const employeeId='9007199254740993';

async function fixture(page,role='admin'){
  const model=JSON.parse(readFileSync(resolve(snapshots,role==='admin'?'leave.calendar-admin.json':'leave.application.employee.json'),'utf8'));
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(['/Leave','/Leave/Index'].includes(new URL(request.url()).pathname))requests.push(request);});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET')return route.abort();
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path)){
      const variant=role==='admin'?(url.searchParams.get('ViewEmployeeId')===employeeId?'preview':url.searchParams.get('SelfOnly')==='true'?'self-only':''):
        url.searchParams.get('ShowOthers')==='true'?'show-others':'';
      const name=`leave.${role==='admin'?'calendar-admin':'application.employee'}${variant?'.'+variant:''}.html`;
      return route.fulfill({body:readFileSync(resolve(snapshots,name)),contentType:'text/html'});
    }
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg','.png'].includes(extname(file)))
      return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');
  await page.waitForFunction(()=>window.CompanyPageRouter?.navigate&&window.LeaveDashboardRead?.read);
  return {errors,requests};
}

test('self-only preference refreshes only the calendar and keeps the current dashboard',async({page})=>{
  const f=await fixture(page);
  await page.locator('main').evaluate(node=>node.dataset.viewProbe='original');
  await page.locator('#calendarArea').evaluate(node=>node.dataset.calendarProbe='original');
  const toggle=page.locator('#calendarMoveForm input[name="SelfOnly"][type="checkbox"]');
  const read=page.waitForRequest(request=>new URL(request.url()).searchParams.get('SaveCalendarPreference')==='true');
  await toggle.check();
  expect((await read).isNavigationRequest()).toBe(false);
  await expect(page).toHaveURL(url=>url.searchParams.get('SelfOnly')==='true');
  await expect(page.locator('#calendarMoveForm input[name="SelfOnly"][type="checkbox"]')).toBeChecked();
  await expect(page.locator('main')).toHaveAttribute('data-view-probe','original');
  await expect(page.locator('#calendarArea')).not.toHaveAttribute('data-calendar-probe','original');
  await expect(page.locator('.view-as-form input[name="SelfOnly"]')).toHaveValue('true');
  await expect(page.locator('#applyForm input[name="SelfOnly"]')).toHaveValue('true');
  expect(f.requests.filter(request=>request.isNavigationRequest())).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('employee show-others preference refreshes only the calendar',async({page})=>{
  const f=await fixture(page,'employee');
  await page.locator('main').evaluate(node=>node.dataset.viewProbe='original');
  await page.locator('#calendarArea').evaluate(node=>node.dataset.calendarProbe='original');
  const read=page.waitForRequest(request=>new URL(request.url()).searchParams.get('SaveCalendarPreference')==='true');
  await page.locator('#calendarMoveForm input[name="ShowOthers"][type="checkbox"]').check();
  expect((await read).isNavigationRequest()).toBe(false);
  await expect(page).toHaveURL(url=>url.searchParams.get('ShowOthers')==='true');
  await expect(page.locator('#calendarMoveForm input[name="ShowOthers"][type="checkbox"]')).toBeChecked();
  await expect(page.locator('main')).toHaveAttribute('data-view-probe','original');
  await expect(page.locator('#calendarArea')).not.toHaveAttribute('data-calendar-probe','original');
  expect(f.requests.filter(request=>request.isNavigationRequest())).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('view-as changes the dashboard body without reloading the document',async({page})=>{
  const f=await fixture(page);
  await page.locator('.cw-header').evaluate(node=>node.dataset.shellProbe='original');
  await page.locator('main').evaluate(node=>node.dataset.viewProbe='original');
  const select=page.locator('.view-as-form select[name="ViewEmployeeId"]');
  await expect(select.locator(`option[value="${employeeId}"]`)).toHaveCount(1);
  const read=page.waitForRequest(request=>new URL(request.url()).searchParams.get('ViewEmployeeId')===employeeId);
  await select.press('Space');
  await page.getByRole('dialog',{name:'대신보기'}).getByRole('option',{name:/외부 일정 검증 직원/}).click();
  expect((await read).isNavigationRequest()).toBe(false);
  await expect(page).toHaveURL(url=>url.searchParams.get('ViewEmployeeId')===employeeId);
  await expect(page.locator('.admin-preview-banner')).toBeVisible();
  await expect(page.locator('.cw-header')).toHaveAttribute('data-shell-probe','original');
  await expect(page.locator('main')).not.toHaveAttribute('data-view-probe','original');
  await expect(page.locator('#openApplyPanel')).toHaveCount(0);
  expect(f.requests.filter(request=>request.isNavigationRequest())).toHaveLength(1);
  expect(f.errors).toEqual([]);

  await page.locator('.view-as-form select[name="ViewEmployeeId"]').press('Space');
  await page.getByRole('dialog',{name:'대신보기'}).getByRole('option',{name:'내 화면'}).click();
  await expect(page).toHaveURL(url=>!url.searchParams.get('ViewEmployeeId'));
  await expect(page.locator('#openApplyPanel')).toBeVisible();
  await expect(page.locator('.cw-header')).toHaveAttribute('data-shell-probe','original');
  expect(f.requests.filter(request=>request.isNavigationRequest())).toHaveLength(1);
});

test('cancelled view-as change retains an unfinished leave application',async({page})=>{
  const f=await fixture(page);
  await page.locator('#openApplyPanel').click();
  await page.locator('#applyForm [name="Input.WorkPlan"]').fill('저장 전 업무 일정');
  await page.locator('.view-as-form select[name="ViewEmployeeId"]').selectOption(employeeId);
  const dialog=page.getByRole('dialog',{name:'작성 중인 연차 정보'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'취소'}).click();
  await expect(page).toHaveURL(url=>!url.searchParams.get('ViewEmployeeId'));
  await expect(page.locator('.view-as-form select[name="ViewEmployeeId"]')).toHaveValue('');
  await expect(page.locator('#applyForm [name="Input.WorkPlan"]')).toHaveValue('저장 전 업무 일정');
  expect(f.requests.filter(request=>request.isNavigationRequest())).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
