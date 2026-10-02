import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';

const scenarios=[
  {name:'external',fixture:'leave.external-recovery',region:'외부 일정 제출 내용',field:'ExternalInput.Memo',forms:'#externalScheduleForm,#externalScheduleDeleteForm',link:'현재 일정 확인'},
  {name:'admin force add',fixture:'leave.admin-force-recovery-add',region:'관리자 연차 제출 내용',field:'ForceInput.Reason',forms:'#adminForceAddForm,#adminForceDeleteForm',link:'현재 연차 내역 확인'},
  {name:'admin force delete',fixture:'leave.admin-force-recovery-delete',region:'관리자 연차 제출 내용',field:'ForceDeleteReason',forms:'#adminForceAddForm,#adminForceDeleteForm',link:'현재 연차 내역 확인'}
];
for(const scenario of scenarios)for(const width of [320,1440])for(const theme of ['light','dark'])test(`${scenario.name} native failure keeps encoded draft and read-only recovery ${width} ${theme}`,async({page,context},info)=>{
  const dir=resolve(root,'artifacts/razor');
  const model=JSON.parse(readFileSync(resolve(dir,scenario.fixture+'.json'),'utf8'));
  const html=readFileSync(resolve(dir,scenario.fixture+'.html'),'utf8'),errors=[],writes=[];
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()==='POST'){writes.push(request.url());return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:model.context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(['/Leave','/Leave/Index'].includes(path))return route.fulfill({body:html,contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');await page.waitForFunction(()=>window.CompanyForm&&document.querySelector('.cw-header'));
  const recovery=page.getByRole('region',{name:scenario.region}),raw=recovery.locator('pre');
  await expect(recovery).toBeVisible();await expect(raw).toContainText('bad-id');
  expect(JSON.parse(await raw.textContent())[scenario.field]).toEqual(['<script>window.injected=true</script>']);
  expect(await page.evaluate(()=>window.injected)).toBeUndefined();
  await expect(page.locator(scenario.forms)).toHaveCount(0);
  const styles=await raw.evaluate(el=>{const css=getComputedStyle(el),rootCss=getComputedStyle(document.documentElement);const probe=document.createElement('div');probe.style.backgroundColor=rootCss.getPropertyValue('--cw-raised');document.body.append(probe);const bg=getComputedStyle(probe).backgroundColor;probe.remove();return {bg:css.backgroundColor,expected:bg};});
  expect(styles.bg).toBe(styles.expected);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  const link=recovery.getByRole('link',{name:scenario.link});await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener');
  await raw.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('form-recovery.png'),animations:'disabled'});
  const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');await popup.close();
  await expect(raw).toContainText('bad-id');expect(writes).toHaveLength(0);expect(errors).toEqual([]);
});
