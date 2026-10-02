import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { root } from '../build-ui.mjs';

const pages=JSON.parse(readFileSync(resolve(root,'packages/contracts/pages.json'),'utf8')).pages.filter(p=>p.service==='leave');
const snapshots=resolve(root,'artifacts/razor');
async function fixture(page,role='admin') {
  const model=JSON.parse(readFileSync(resolve(snapshots,'leave.'+role+'.json'),'utf8')),errors=[],writes=[],unhandled=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({status:model.navigation?200:401,json:model.navigation||{}});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(url.searchParams.get('handler')==='QueueSummary')return route.fulfill({json:model.approvalSummary});
    if(path==='/Admin/Adjustments'&&url.searchParams.get('handler')==='Baseline')return route.fulfill({status:model.grantCatalogs?.[url.searchParams.get('employeeId')]?200:404,json:model.grantCatalogs?.[url.searchParams.get('employeeId')]||{}});
    if(url.searchParams.get('handler')==='Queue')return route.fulfill({body:readFileSync(resolve(snapshots,'leave.queue.'+role+'.html')),contentType:'text/html'});
    const definition=pages.find(p=>[p.path,...p.aliases||[]].some(x=>x.toLowerCase()===path.toLowerCase()));
    const document=model.pages.find(p=>p.id===definition?.id);
    if(document)return route.fulfill({body:readFileSync(resolve(snapshots,document.file)),contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot');
    const file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg','.png'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[extname(file)]});
    if(path!=='/favicon.ico')unhandled.push(path);return route.abort();
  });
  return {model,errors,writes,unhandled};
}

for(const path of ['/Admin','/Admin/Employees','/Master/Employees','/Admin/Usage','/Leave/Usage','/Admin/Security','/Leave'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`shared responsive records ${path} ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page,path.startsWith('/Master')?'master':'admin');await page.goto('https://leave.workspace.test'+path);
  await expect(page.locator('.cw-header')).toHaveCount(1);
  const tables=page.locator('table.cw-data-table[data-layout]');expect(await tables.count()).toBeGreaterThan(0);
  let tableIndex=0;
  for(const table of await tables.all()){
    await expect(table).toHaveAttribute('role','table');
    const problems=await table.evaluate(table=>{
      const problems=[],cards=table.dataset.layout==='cards',headers=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      for(const th of table.querySelectorAll('th'))if(th.scope!==(cards?'col':'row'))problems.push('header scope');
      for(const row of table.tBodies[0]?.rows||[])for(const [index,td] of [...row.cells].entries()){
        if(td.tagName!=='TD')continue;
        if(cards&&td.dataset.label!==(td.colSpan>1?'':headers[index]))problems.push('label mismatch: '+td.dataset.label);
        if(cards&&td.firstElementChild?.className!=='cw-table-value')problems.push('value wrapper');
        if(innerWidth<=720&&cards&&td.dataset.label){
          const style=getComputedStyle(td,'::before'),probe=document.createElement('div');
          Object.assign(probe.style,{position:'absolute',visibility:'hidden',font:style.font,width:getComputedStyle(td).gridTemplateColumns.split(' ')[0],lineHeight:style.lineHeight,overflowWrap:style.overflowWrap});
          probe.textContent=td.dataset.label;document.body.append(probe);
          if(probe.getBoundingClientRect().height+16>td.getBoundingClientRect().height+1)problems.push('label overlaps: '+td.dataset.label);
          probe.remove();
        }
      }
      if(innerWidth<=720&&getComputedStyle(table).display!=='block')problems.push('not cards');
      return problems;
    });expect(problems).toEqual([]);
    await table.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`records-${tableIndex++}.png`),animations:'disabled'});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const [path,name] of [['/Admin/Usage','EmployeeId']])test(`shared employee filter performs one native GET navigation ${path}`,async({page})=>{
  const f=await fixture(page);await page.goto('https://leave.workspace.test'+path);
  const select=page.locator(`select[name="${name}"]`);await expect(select).toHaveAttribute('data-cw-auto-submit','');
  const target=await select.locator('option').evaluateAll(options=>options.find(option=>option.value&&option.value!=='0')?.value);expect(target).toBeTruthy();
  const request=page.waitForRequest(request=>request.isNavigationRequest()&&new URL(request.url()).searchParams.get(name)===target);
  await select.selectOption(target);const navigated=await request;
  expect(navigated.method()).toBe('GET');expect(new URL(navigated.url()).searchParams.getAll(name)).toEqual([target]);
  await expect(page).toHaveURL(url=>url.searchParams.get(name)===target);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`explicit local employee picker preserves grant form values ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://leave.workspace.test/Admin/Adjustments');
  await page.waitForFunction(()=>window.CompanyEntities);
  const select=page.locator('#grantEmployeeSelect');await expect(select).toHaveAttribute('data-company-local','true');
  const choices=await select.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent.trim(),date:n.dataset.defaultDate})));
  const target=choices.find(item=>item.text.includes('검증 직원'));expect(target).toBeTruthy();
  await select.press('Space');const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox').fill('ㄱㅈㅈㅇ');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('searchbox')).toHaveCSS('height','44px');
  await expect(dialog.getByRole('button',{name:'닫기'})).toHaveCSS('box-shadow','none');
  expect(await dialog.getByRole('searchbox').evaluate(node=>getComputedStyle(node).color)).toBe(await dialog.evaluate(node=>getComputedStyle(node).color));
  await expect(dialog.locator('.cw-picker-heading strong')).toHaveCSS('line-height','21px');
  expect((await dialog.locator('.cw-picker-heading strong').boundingBox()).height).toBeLessThanOrEqual(22);
  expect(await dialog.locator('.cw-picker-options').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('local-employee-picker.png'),animations:'disabled'});
  await dialog.getByRole('searchbox').press('Enter');await expect(select).toHaveValue(target.value);
  await expect(select).toBeFocused();await expect(page.locator('[name="AddGrantedDate"]')).toHaveValue(target.date);
  expect(await select.evaluate(node=>new FormData(node.form).get('AddEmployeeId'))).toBe(target.value);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const [role,key,label] of [['admin','SelfOnly','자기것만 보기'],['employee','ShowOthers','다른 사람 연차도 같이 보기']])test(`server-rendered ${role} calendar preference keeps one exact native GET fallback`,async({page},info)=>{
  await page.setViewportSize({width:320,height:900});await page.emulateMedia({colorScheme:'dark'});
  const f=await fixture(page,role);await page.goto('https://leave.workspace.test/Leave');
  const form=page.locator('#calendarMoveForm'),toggle=form.getByRole('checkbox',{name:label});
  await expect(form.locator('[name="SaveCalendarPreference"]')).toHaveValue('true');await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveClass(/\bcw-checkbox\b/);await expect(toggle.locator('xpath=..')).toHaveClass(/\bcw-check-control\b/);
  await expect(form.locator(`input[type="hidden"][name="${key}"]`)).toHaveValue('false');
  await expect(form.locator(`input[type="checkbox"][name="${key==='SelfOnly'?'ShowOthers':'SelfOnly'}"]`)).toHaveCount(0);
  const visual=await toggle.evaluate(input=>{const label=input.closest('.cw-check-control'),style=getComputedStyle(label),inputStyle=getComputedStyle(input);return {inputWidth:inputStyle.width,inputHeight:inputStyle.height,accent:inputStyle.accentColor,border:style.borderTopWidth,background:style.backgroundColor,color:style.color};});
  expect(visual.inputWidth).toBe('18px');expect(visual.inputHeight).toBe('18px');expect(visual.border).toBe('1px');expect(visual.accent).not.toBe('auto');expect(visual.background).not.toBe('rgba(0, 0, 0, 0)');expect(visual.color).not.toBe('rgba(0, 0, 0, 0)');
  const initial=await toggle.isChecked(),before=visual.background;await toggle.evaluate(input=>input.checked=!input.checked);expect(await toggle.evaluate(input=>getComputedStyle(input.closest('.cw-check-control')).backgroundColor)).not.toBe(before);await toggle.evaluate((input,checked)=>input.checked=checked,initial);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('calendar-preference.png'),animations:'disabled'});
  const next=!(await toggle.isChecked());
  await toggle.evaluate((input,value)=>{input.checked=value;},next);
  const values=await form.evaluate(form=>[...new FormData(form).entries()]);
  expect(values.filter(([name])=>name===key).map(([,value])=>value)).toEqual(next?['true','false']:['false']);
  expect(values.some(([name])=>name===(key==='SelfOnly'?'ShowOthers':'SelfOnly'))).toBe(false);
  expect(values.filter(([name])=>name==='SaveCalendarPreference').map(([,value])=>value)).toEqual(['true']);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const definition of pages)for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`${definition.id} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://leave.workspace.test'+definition.path);
  await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',definition.id);
  await expect(page).toHaveTitle(definition.title+' - 연차관리');
  if(definition.id==='leave.discord'){
    const raised=await page.evaluate(()=>{const node=document.createElement('span');node.style.backgroundColor='var(--cw-raised)';document.body.append(node);const color=getComputedStyle(node).backgroundColor;node.remove();return color;});
    expect(raised).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('.discord-config-warning code')).toHaveCSS('background-color',raised);
    await page.locator('.discord-config-warning code').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('discord-warning-theme.png'),animations:'disabled'});
    await page.evaluate(()=>window.scrollTo(0,0));
  }
  await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation.pages.length);
  await expect(page.locator('.cw-header')).toHaveCount(1);await expect(page.locator('.cw-sidebar')).toHaveCount(1);
  await expect.poll(()=>page.locator('.cw-logo img').evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  if(definition.nav!==false)await expect(page.locator('.cw-page-link[aria-current]')).toHaveAttribute('data-workspace-page',definition.id);
  await page.screenshot({path:info.outputPath('content.png'),animations:'disabled'});
  const geometry=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth,wide:[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,css:e.className,width:e.getBoundingClientRect().width}))}));
  expect(geometry.document,JSON.stringify(geometry)).toBeLessThanOrEqual(width+1);
  if(width<901)await page.locator('[data-cw-nav]').click();
  await expect.poll(async()=>Math.round((await page.locator('.cw-sidebar').boundingBox()).x)).toBe(0);
  await expect(page.locator('[data-workspace-badge="leave.approvals"]')).toHaveText('2');
  await page.screenshot({path:info.outputPath('navigation.png'),animations:'disabled'});
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const route of ['Holidays','NotificationSettings'])for(const width of [320,1440])for(const theme of ['light','dark'])test(`admin settings common controls ${route} ${width}px ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});
  const f=await fixture(page);await page.goto('https://leave.workspace.test/Admin/'+route);
  await expect(page.locator('.cw-header')).toHaveCount(1);
  const main=page.locator('main'),fields=main.locator('.cw-form-control');
  expect(await fields.count()).toBe(route==='Holidays'?6:2);
  const tokens=await page.evaluate(()=>{
    const node=document.createElement('span');document.body.append(node);
    const result={};for(const name of ['raised','text','muted','danger','danger-bg']){
      node.style.color=`var(--cw-${name})`;result[name]=getComputedStyle(node).color;
    }node.remove();return result;
  });
  for(const field of await fields.all()){
    await expect(field).toHaveCSS('background-color',tokens.raised);
    await expect(field).toHaveCSS('color',tokens.text);
    expect((await field.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await expect(main.locator('button:not(.cw-button)')).toHaveCount(0);
  await expect(main.locator('table:not(.cw-data-table)')).toHaveCount(0);
  await expect(main.locator('.cw-data-table th').first()).toHaveCSS('background-color',tokens.raised);
  const add=main.locator('form[action$="handler=Add"]');
  const labels=add.locator('.cw-form-field'),a=await labels.nth(0).boundingBox(),b=await labels.nth(1).boundingBox();
  if(width===320)expect(b.y).toBeGreaterThan(a.y+a.height);else expect(b.y).toBe(a.y);
  await expect(add.locator('[name="__RequestVerificationToken"]')).toHaveCount(1);
  if(route==='Holidays'){
    await expect(main.locator('[id="Import_Year"]')).toHaveCount(0);
    const online=main.locator('form[action$="handler=ImportOnline"]'),json=main.locator('form[action$="handler=ImportJson"]');
    for(const checkbox of await main.locator('.holiday-overwrite-check input[type="checkbox"]').all()){
      await expect(checkbox).toHaveClass(/\bcw-checkbox\b/);await expect(checkbox.locator('xpath=..')).toHaveClass(/\bcw-check-control\b/);
      expect((await checkbox.boundingBox()).width).toBe(18);await expect(checkbox.locator('xpath=..')).toHaveCSS('background-color',tokens.raised);
    }
    await online.locator('[name="Import.Year"]').fill('2025');await json.locator('[name="Import.Year"]').fill('2026');
    const before=await online.getByRole('checkbox').evaluate(node=>getComputedStyle(node.closest('.cw-check-control')).backgroundColor);await online.getByRole('checkbox').check();await expect(json.getByRole('checkbox')).not.toBeChecked();expect(await online.getByRole('checkbox').evaluate(node=>getComputedStyle(node.closest('.cw-check-control')).backgroundColor)).not.toBe(before);
    const raw='[{"date":"2026-01-01","name":"검증","id":9223372036854775807}]';
    await json.getByLabel('JSON',{exact:true}).fill(raw);
    await expect(json.getByLabel('JSON',{exact:true})).toHaveCSS('font-family',/monospace/);
    expect(await json.evaluate(form=>new FormData(form).get('Import.JsonText'))).toBe(raw);
    await online.locator('[name="Import.Year"]').fill('1999');
    expect(await online.evaluate(form=>form.checkValidity())).toBe(false);
    await online.locator('[name="Import.Year"]').fill('2025');
    await expect(main.locator('button[data-variant="danger"]').first()).toHaveCSS('color',tokens.danger);
  }else{
    expect(await add.evaluate(form=>form.checkValidity())).toBe(false);
    await add.getByLabel('웹훅 URL').fill('https://discord.com/api/webhooks/synthetic/not-a-secret');
    await add.getByLabel('메모').fill('격리 검증');
    expect(await add.evaluate(form=>new FormData(form).get('Memo'))).toBe('격리 검증');
    const testButton=main.getByRole('button',{name:'전체 테스트 발송'});
    await expect(testButton).toBeDisabled();await expect(testButton).toHaveCSS('color',tokens.muted);
  }
  await fields.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('fields.png'),animations:'disabled'});
  const region=main.getByRole('region');await region.scrollIntoViewIfNeeded();await region.focus();
  await expect(region).toBeFocused();
  await page.screenshot({path:info.outputPath('table.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});

for(const role of ['guest','employee','shared','master'])test(`leave role-scoped navigation ${role}`,async({page})=>{
  const f=await fixture(page,role),signedIn=role==='employee'||role==='master';
  await page.goto('https://leave.workspace.test'+(signedIn?'/Leave':'/Account/AccessDenied'));
  await expect(page.locator('.cw-page-link')).toHaveCount(f.model.navigation?.pages.length||0);
  await expect(page.locator('.cw-sidebar')).toHaveCount(signedIn?1:0);
  if(role==='employee')await expect(page.locator('[data-workspace-badge]')).toHaveCount(0);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

test('leave navigation follows registered routes and live queue badges survive rerender',async({page})=>{
  await page.setViewportSize({width:1440,height:900});const f=await fixture(page);
  await page.goto('https://leave.workspace.test/Leave/Index');
  for(const id of ['leave.usage','leave.approvals','leave.discord']){
    await page.locator(`[data-workspace-page="${id}"]`).click();
    await expect(page.locator('[data-workspace-view]')).toHaveAttribute('data-workspace-view',id);
  }
  const badge=page.locator('[data-workspace-badge="leave.approvals"]');
  await expect(badge).toHaveText('2');
  await page.evaluate(()=>CompanyNavigation.setBadge('leave','leave.approvals',120));await expect(badge).toHaveText('99+');
  await page.evaluate(()=>CompanyNavigation.setBadge('leave','leave.approvals',0));await expect(badge).toBeHidden();
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);expect(f.unhandled).toEqual([]);
});
