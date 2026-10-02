import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor'),read=name=>readFileSync(resolve(dir,`leave.audit.${name}.html`),'utf8');
const meta=()=>JSON.parse(readFileSync(resolve(dir,'leave.audit.json'),'utf8'));
async function fixture(page,{width=320,theme='dark',native=false,photo=false}={}){
  await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme,reducedMotion:'reduce'});
  const model=meta(),requests=[],errors=[],writes=[];let failure=null,hold=false,releases=[];
  // Synthetic profile media; identity and local/company mapping come from TestServer.
  if(photo)model.context.profiles[String(model.context.user.id)]='/media/audit-profile.svg';
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){writes.push(path);return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path==='/media/audit-profile.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#6366f1"/></svg>'});
    if(path==='/Admin/AuditLogs'){
      const ajax=request.headers()['x-requested-with']==='XMLHttpRequest';
      if(ajax){requests.push(url);if(hold)await new Promise(resolve=>releases.push(resolve));}
      if(ajax&&failure==='network')return route.abort();
      if(ajax&&typeof failure==='number')return route.fulfill({status:failure,body:'temporary error'});
      let name=url.searchParams.get('targetFilter')==='missing-audit'?'empty':url.searchParams.get('targetFilter')==='audit-exact-0'?'filtered':url.searchParams.get('AuditLimit')==='20'?'large':url.searchParams.get('AuditPage')==='2'?'second':'initial';
      let html=read(name);
      if(ajax&&failure==='owner')html=html.replace(/data-audit-owner="\d+"/,'data-audit-owner="999999"');
      if(ajax&&failure==='malformed')html='<html><p>not an audit result</p></html>';
      if(ajax&&failure==='criteria')html=html.replace('data-audit-target=""','data-audit-target="different"');
      return route.fulfill({contentType:'text/html',body:html}).catch(()=>{});
    }
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Admin/AuditLogs');
  if(!native)await expect(page.locator('#auditLogsArea')).toHaveAttribute('data-cw-disclosure-root','');
  return {model,requests,errors,writes,fail:value=>failure=value,hold:()=>hold=true,release:()=>{hold=false;releases.splice(0).forEach(fn=>fn());}};
}
const rows=page=>page.locator('[data-audit-row]'),state=page=>page.locator('#auditLogsState');
for(const width of [320,1440])for(const theme of ['light','dark'])test(`audit shared detail and actual paging ${width}px ${theme}`,async({page},info)=>{
  const f=await fixture(page,{width,theme});await expect(rows(page)).toHaveCount(10);
  const fields=await page.locator('#auditLogsArea .cw-form-control').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,label:!!n.closest('.cw-form-field'),color:getComputedStyle(n).color,background:getComputedStyle(n).backgroundColor})));
  const fieldPalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-text);background:var(--cw-raised)';const s=getComputedStyle(p),result={color:s.color,background:s.backgroundColor};p.remove();return result;});
  for(const field of fields){expect(field.height).toBeGreaterThanOrEqual(44);expect(field.label).toBe(true);expect(field.color).toBe(fieldPalette.color);expect(field.background).toBe(fieldPalette.background);}
  const actionPill=rows(page).first().locator('.audit-action-pill'),pillPalette=await page.evaluate(()=>{const p=document.createElement('span');document.body.append(p);p.style.cssText='color:var(--cw-active-text);background:var(--cw-active)';const s=getComputedStyle(p),result={color:s.color,background:s.backgroundColor};p.remove();return result;});await expect(actionPill).toHaveClass(/\bcw-state-pill\b/);await expect(actionPill).toHaveAttribute('data-tone','info');await expect(actionPill).toHaveCSS('color',pillPalette.color);await expect(actionPill).toHaveCSS('background-color',pillPalette.background);
  await expect(rows(page).first().locator('[data-company-local-employee]')).toHaveText('테');
  const actor=rows(page).first().locator('.audit-actor');expect(await actor.evaluate(n=>Math.abs(n.firstElementChild.getBoundingClientRect().top-n.lastElementChild.getBoundingClientRect().top))).toBeLessThan(8);
  const first=rows(page).first().getByRole('button',{name:'보기'});await first.focus();await page.keyboard.press('Enter');
  const detail=page.locator('[data-cw-disclosure-panel]:not([hidden])');await expect(detail).toHaveCount(1);
  await expect(detail).toContainText('9223372036854775807');await expect(detail).toContainText('<script>window.STOLEN=true</script>');
  expect(await page.evaluate(()=>window.STOLEN)).toBeUndefined();
  const styles=await detail.locator('pre').first().evaluate(node=>({background:getComputedStyle(node).backgroundColor,color:getComputedStyle(node).color,theme:document.documentElement.dataset.theme}));
  const palette=await page.evaluate(()=>{const n=document.createElement('span');document.body.append(n);n.style.backgroundColor='var(--cw-surface)';const background=getComputedStyle(n).backgroundColor;n.style.color='var(--cw-text)';const color=getComputedStyle(n).color;n.remove();return {background,color};});
  expect(styles).toEqual({...palette,theme});
  await detail.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('audit-detail.png'),animations:'disabled'});
  await rows(page).nth(1).getByRole('button',{name:'보기'}).click();await expect(detail).toHaveCount(1);await expect(first).toHaveAttribute('aria-expanded','false');
  await page.getByRole('link',{name:'다음',exact:true}).click();await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).last()).toHaveAttribute('data-audit-row','9007199254740993');
  await rows(page).last().getByRole('button',{name:'보기'}).click();await expect(detail).toContainText('9223372036854775807');
  await page.locator('[name="AuditLimit"]').filter({has:page.locator('option')}).selectOption('20');await expect(rows(page)).toHaveCount(12);
  await page.locator('#auditLogsListForm select').selectOption('10');await expect(rows(page)).toHaveCount(10);
  await page.locator('#auditLogsFilterForm [name="targetFilter"]').fill('missing-audit');await page.getByRole('button',{name:'필터 적용'}).click();
  await expect(page.locator('#auditLogsArea [data-state-kind="empty"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});

for(const width of [320,1440])test(`audit mapped profile and searched actor remain connected after filter ${width}px`,async({page})=>{
  const f=await fixture(page,{width,photo:true});
  const image=rows(page).first().locator('.audit-actor img');await expect(image).toBeVisible();
  expect(await image.evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
  await page.waitForFunction(()=>window.CompanyEntities);
  await page.locator('#auditLogsFilterForm [name="actorFilter"]').press('Space');
  const dialog=page.getByRole('dialog');await dialog.getByRole('searchbox').fill('ㅌㅅㅌ');await expect(dialog.getByRole('option')).toHaveCount(1);
  await dialog.getByRole('searchbox').press('Enter');
  await expect(page.locator('#auditLogsFilterForm [name="actorFilter"]')).toHaveValue(f.model.actor);
  await page.locator('#auditLogsFilterForm [name="actionFilter"]').selectOption('EmployeeUpdated');
  await page.locator('#auditLogsFilterForm [name="targetFilter"]').fill('audit-exact-0');await page.getByRole('button',{name:'필터 적용'}).click();
  await expect(rows(page)).toHaveCount(1);await expect(rows(page).locator('img')).toHaveAttribute('src',/\/media\/audit-profile.svg$/);
  expect(f.requests[0].searchParams.get('actorFilter')).toBe(f.model.actor);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test.describe('audit native GET fallback',()=>{
  test.use({javaScriptEnabled:false});
  for(const width of [320,1440])test(`details and filters without scripts ${width}px`,async({page})=>{
    const f=await fixture(page,{width,native:true});
    await expect(page.locator('[data-cw-disclosure-panel]').first()).toBeVisible();
    await expect(page.locator('[data-cw-disclosure]').first()).toBeHidden();
    await expect(page.locator('[data-cw-disclosure-panel]').first()).toContainText('9223372036854775807');
    await page.locator('#auditLogsFilterForm [name="targetFilter"]').fill('missing-audit');await page.getByRole('button',{name:'필터 적용'}).click();
    await expect(rows(page)).toHaveCount(0);await expect(page).toHaveURL(/targetFilter=missing-audit/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
  });
});
for(const failure of [503,'network','malformed','criteria'])test(`audit read failure retains last result and retries GET ${failure}`,async({page},info)=>{
  const f=await fixture(page);f.fail(failure);await page.getByRole('button',{name:'필터 적용'}).click();
  await expect(state(page)).toHaveAttribute('data-state-kind','error');await expect(rows(page)).toHaveCount(10);
  await expect(page).toHaveURL('https://leave.workspace.test/Admin/AuditLogs');
  await page.screenshot({path:info.outputPath('audit-error.png'),animations:'disabled'});
  f.fail(null);await state(page).getByRole('button').click();await expect(state(page)).toBeHidden();expect(f.requests).toHaveLength(2);
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});
for(const failure of [401,403,'owner','scope'])test(`audit removes old private body on ${failure}`,async({page})=>{
  const f=await fixture(page);
  if(failure==='scope')await page.evaluate(()=>document.dispatchEvent(new CustomEvent('workspace-entity-scope-change')));
  else {f.fail(failure);await page.getByRole('button',{name:'필터 적용'}).click();}
  await expect(state(page)).toHaveAttribute('data-state-kind','denied');await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#auditLogsArea')).toBeEmpty();expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
test('audit timeout releases observation without retrying or losing filters',async({page})=>{
  const f=await fixture(page);await page.clock.install();f.hold();await page.getByRole('button',{name:'필터 적용'}).click();
  await expect.poll(()=>f.requests.length).toBe(1);await page.clock.fastForward(15001);
  await expect(state(page)).toHaveAttribute('data-state-kind','error');await expect(rows(page)).toHaveCount(10);
  f.release();await expect(state(page)).toHaveAttribute('data-state-kind','error');expect(f.requests).toHaveLength(1);
});
for(const interruption of ['scope','pagehide','input','superseded'])test(`audit ignores non-abortable late HTML after ${interruption}`,async({page})=>{
  const f=await fixture(page);
  await page.evaluate(()=>{const original=window.fetch;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/Admin/AuditLogs')&&!window.auditHeld){window.auditHeld=true;const text=response.text.bind(response);response.text=async()=>{const result=await text();await new Promise(resolve=>window.releaseAuditText=resolve);return result;};}return response;};});
  await page.getByRole('button',{name:'필터 적용'}).click();await page.waitForFunction(()=>typeof window.releaseAuditText==='function');
  if(interruption==='scope')await page.evaluate(()=>document.dispatchEvent(new CustomEvent('workspace-entity-scope-change')));
  if(interruption==='pagehide')await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  if(interruption==='input')await page.locator('#auditLogsFilterForm [name="targetFilter"]').fill('new draft');
  if(interruption==='superseded'){await page.getByRole('link',{name:'다음',exact:true}).click();await expect(rows(page)).toHaveCount(2);}
  await page.evaluate(()=>window.releaseAuditText());
  if(interruption==='scope')await expect(rows(page)).toHaveCount(0);
  else await expect(rows(page)).toHaveCount(interruption==='superseded'?2:10);
  if(interruption==='input')await expect(page.locator('#auditLogsFilterForm [name="targetFilter"]')).toHaveValue('new draft');
  expect(f.errors).toEqual([]);expect(f.writes).toEqual([]);
});
