import {test,expect} from '@playwright/test';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {root} from '../build-ui.mjs';
const dir=resolve(root,'artifacts/razor');
async function fixture(page,year=false){
  const model=JSON.parse(readFileSync(resolve(dir,'leave.calendar-entities.json'),'utf8'));
  const html=readFileSync(resolve(dir,`leave.calendar-entities${year?'.year':''}.html`),'utf8');
  const requests=[],errors=[],images=[];
  let context=structuredClone(model.context);
  // Deliberately provide a profile at the unmapped local ID too: it must never be used.
  context.profiles={[model.companyId]:'/media/calendar-profile-v1.svg','9007199254741016':'/media/wrong-local.svg'};
  context.projectIcons={[model.projectId]:'/media/calendar-project-v1.svg'};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(request.method()!=='GET'){requests.push(request.url());return route.abort();}
    if(path==='/api/workspace/context')return route.fulfill({json:context});
    if(path==='/api/workspace/navigation')return route.fulfill({json:model.navigation});
    if(path==='/api/workspace/notifications')return route.fulfill({json:{items:[],sources:[],unreadCount:0}});
    if(path.startsWith('/media/')){images.push(path);return path.includes('broken')?route.fulfill({status:404}):route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#605de9"/><circle cx="24" cy="17" r="8" fill="white"/><path d="M8 44a16 16 0 0 1 32 0" fill="white"/></svg>'});}
    if(['/Leave','/Leave/Index'].includes(path))return route.fulfill({body:html,contentType:'text/html'});
    const base=resolve(root,'apps',url.hostname==='company.example.com'?'portal':'leave','wwwroot'),file=resolve(base,path.slice(1));
    if(file.startsWith(base+sep)&&existsSync(file)&&['.js','.css','.svg'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]});
    return route.abort();
  });
  await page.goto('https://leave.workspace.test/Leave');
  await page.waitForFunction(()=>window.CompanyEntityDisplay&&window.LeaveDayDetail&&document.querySelector('.cw-header'));
  return {model,requests,errors,images,refresh:async(profiles)=>{context.profiles=profiles;await page.evaluate(()=>window.CompanyWorkspace.refresh());},logout:async()=>{context={authenticated:false,services:[]};await page.evaluate(()=>window.CompanyWorkspace.refresh());}};
}
const person=(page,id,scope='')=>page.locator(`${scope} [data-company-local-employee="${id}"]`);
const project=(page,id,scope='')=>page.locator(`${scope} [data-company-project="${id}"]`);
async function open(page,date){await page.locator(`#leaveCalendar td[data-date="${date}"] [data-day-detail-trigger]`).click();await expect(page.locator('#dayDetailModal')).toBeVisible();}
function nextDay(date){const day=new Date(date+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+1);return day.toISOString().slice(0,10);}
async function assertReadable(locator,minimum=4.5){
  const samples=await locator.evaluateAll(nodes=>{
    const rgba=value=>{const parts=value.match(/[\d.]+/g)?.map(Number)||[];return [parts[0]||0,parts[1]||0,parts[2]||0,parts.length>3?parts[3]:1];};
    const blend=(front,back)=>{const alpha=front[3]+back[3]*(1-front[3]);return alpha?[0,1,2].map(i=>(front[i]*front[3]+back[i]*back[3]*(1-front[3]))/alpha).concat(alpha):[0,0,0,0];};
    const luminance=color=>{const channel=value=>{value/=255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);};return .2126*channel(color[0])+.7152*channel(color[1])+.0722*channel(color[2]);};
    const ratio=(a,b)=>{const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);};
    return nodes.filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>{
      const chain=[];for(let current=node;current;current=current.parentElement)chain.unshift(current);
      const background=chain.reduce((result,current)=>blend(rgba(getComputedStyle(current).backgroundColor),result),[0,0,0,0]);
      const foreground=blend(rgba(getComputedStyle(node).color),background);
      return {label:(node.textContent||node.getAttribute('aria-label')||node.className).trim().slice(0,80),ratio:ratio(foreground,background),color:getComputedStyle(node).color,background};
    });
  });
  expect(samples.length).toBeGreaterThan(0);
  for(const sample of samples)expect(sample.ratio,`${sample.label}: ${sample.color} on ${sample.background.join(',')}`).toBeGreaterThanOrEqual(minimum);
}
async function assertPhoto(avatars,revision,prefix='calendar-profile'){
  expect(await avatars.count()).toBeGreaterThan(0);
  for(const avatar of await avatars.all()){
    await expect(avatar).toBeVisible();await expect(avatar).toHaveAttribute('aria-hidden','true');
    await expect(avatar.locator('img')).toHaveAttribute('src',new RegExp(`${prefix}-${revision}\\.svg$`));
    await expect.poll(()=>avatar.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  }
}

for(const width of [320,1440])for(const theme of ['light','dark'])test(`calendar profiles and lossless detail labels ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page);
  const calendar=page.locator('#leaveCalendar.cw-calendar-table[data-calendar-layout="month"]');
  await expect(calendar).toHaveAttribute('role','table');await expect(calendar).toHaveAttribute('aria-label',/^\d{4}년 \d{1,2}월 연차 달력$/);
  expect(await calendar.locator('th:not([scope="col"])').count()).toBe(0);
  await expect(calendar).toHaveCSS('table-layout','fixed');await expect(calendar).toHaveCSS('border-collapse','separate');
  await expect(calendar.locator('td[data-date][data-date-label]').first()).toBeVisible();
  await assertPhoto(person(page,f.model.localId,'#leaveCalendar'),'v1');
  await expect(person(page,f.model.localId,'#leaveCalendar').first()).toHaveCSS('width','16px');
  await expect(page.locator(`#leaveCalendar [data-detail="생일"][data-employee-id="${f.model.localId}"]`)).toBeVisible();
  await expect(page.locator(`#leaveCalendar [data-detail="생일"][data-employee-id="${f.model.localId}"] .birthday-icon`)).toHaveText('🎂');
  const milestone=page.locator('#leaveCalendar [data-detail="주요일정"]');
  await expect(milestone).toHaveCount(1);await expect(milestone.locator('.milestone-icon')).toHaveText('📌');
  await assertPhoto(project(page,f.model.projectId,'#leaveCalendar'),'v1','calendar-project');
  await expect(project(page,f.model.projectId,'#leaveCalendar')).toHaveCSS('width','16px');
  await expect(milestone).toContainText('주요 일정 <검수> & 확인');await expect(milestone).toContainText('검수 · 프로젝트 <원문>');
  await assertReadable(page.locator('.calendar-view-button,.calendar-toolbar a.btn,.event-chip > span'));
  if(await page.locator('.warning-metric strong').count())await assertReadable(page.locator('.warning-metric strong'),3);
  await calendar.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('month-calendar.png'),animations:'disabled'});
  await open(page,f.model.start);
  for(const kind of ['renewal','external-schedule','birthday']){
    const row=page.locator(`#dayDetailBody .${kind}-detail`).filter({has:person(page,f.model.localId)});
    await expect(row.locator('.leave-detail-person-name')).toHaveText(f.model.name);
    await expect(row.locator('.leave-detail-person-name b')).toHaveCount(0);
    await assertPhoto(person(page,f.model.localId,`#dayDetailBody .${kind}-detail`),'v1');
  }
  const birthdayDetail=page.locator('#dayDetailBody .birthday-detail').filter({has:person(page,f.model.localId)});
  await expect(birthdayDetail.locator('.birthday-detail-icon')).toHaveText('🎂');
  const milestoneDetail=page.locator('#dayDetailBody .milestone-detail');
  await expect(milestoneDetail.locator('.milestone-detail-icon')).toHaveText('📌');
  await assertPhoto(project(page,f.model.projectId,'#dayDetailBody'),'v1','calendar-project');
  await expect(milestoneDetail.locator('strong')).toHaveText('주요 일정 <검수> & 확인');
  await expect(milestoneDetail).toContainText('검수 · 프로젝트 <원문>');
  await expect(page.locator('#dayDetailBody .holiday-detail strong')).toHaveText('공휴일|<b>원문</b>');
  await expect(person(page,'9007199254741016','#dayDetailBody').first()).toHaveText('미');
  await expect(person(page,'9007199254741016','#dayDetailBody').locator('img')).toHaveCount(0);
  await assertReadable(page.locator('#dayDetailBody .detail-item strong,#dayDetailBody .detail-item > span,#dayDetailBody .detail-work-plan,#dayDetailBody .detail-work-plan b'));
  await page.screenshot({path:info.outputPath('calendar-entity-detail.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await open(page,nextDay(f.model.start));
  const leave=page.locator('#dayDetailBody .leave-detail');
  await expect(leave.locator('.leave-detail-person-name')).toHaveText(f.model.name);
  await expect(leave).toContainText('연차 · 승인');await expect(leave).toContainText('사유|<b>원문</b>');
  const source=page.locator(`#leaveCalendar [data-detail="신청"][data-employee-id="${f.model.localId}"]`);
  const requestId=await source.getAttribute('data-request-id');
  await expect(leave.locator('.force-delete-button')).toHaveAttribute('data-request-id',requestId);
  await assertReadable(page.locator('#dayDetailBody .detail-item strong,#dayDetailBody .detail-item > span,#dayDetailBody .detail-work-plan,#dayDetailBody .detail-work-plan b'));
  await assertPhoto(person(page,f.model.localId,'#dayDetailBody'),'v1');
  await page.screenshot({path:info.outputPath('calendar-leave-profile.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  expect(f.images).not.toContain('/media/wrong-local.svg');expect(f.requests).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [320,1440])for(const theme of ['light','dark'])test(`year calendar uses the same mapped profiles ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});const f=await fixture(page,true);
  const calendars=page.locator('.year-mini-calendar.cw-calendar-table[data-calendar-layout="year-mini"]');
  await expect(calendars).toHaveCount(12);
  for(const calendar of await calendars.all()){
    await expect(calendar).toHaveAttribute('role','table');await expect(calendar).toHaveAttribute('aria-label',/^\d{4}년 \d{1,2}월 연차 달력$/);
    expect(await calendar.locator('th:not([scope="col"])').count()).toBe(0);
  }
  await expect(calendars.first()).toHaveCSS('table-layout','fixed');await expect(calendars.first()).toHaveCSS('border-collapse','collapse');
  const avatars=person(page,f.model.localId,'.year-mini-calendar');await assertPhoto(avatars,'v1');
  await expect(page.locator('.year-event.birthday').first()).toBeVisible();
  await expect(page.locator('.year-event.birthday .birthday-icon').first()).toHaveText('🎂');
  await expect(page.locator('.year-event.milestone').first()).toContainText('주요 일정 <검수> & 확인');
  await expect(page.locator('.year-event.milestone .milestone-icon').first()).toHaveText('📌');
  await assertPhoto(project(page,f.model.projectId,'.year-mini-calendar'),'v1','calendar-project');
  await expect(project(page,f.model.projectId,'.year-mini-calendar').first()).toHaveCSS('width','14px');
  await expect(avatars.first()).toHaveCSS('width','14px');await avatars.first().scrollIntoViewIfNeeded();
  await assertReadable(page.locator('.calendar-view-button,.calendar-toolbar a.btn,.year-holiday-name,.year-event,.year-event-more'));
  await page.screenshot({path:info.outputPath('year-profile.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(f.errors).toEqual([]);expect(f.requests).toEqual([]);
});

test('calendar photos follow context revisions, removal, failure, reopening and logout',async({page})=>{
  const f=await fixture(page);await open(page,nextDay(f.model.start));const avatar=person(page,f.model.localId,'#dayDetailBody');
  await assertPhoto(avatar,'v1');await avatar.locator('img').evaluate(img=>window.oldCalendarImage=img);
  await f.refresh({[f.model.companyId]:'/media/calendar-profile-v2.svg'});await assertPhoto(avatar,'v2');
  await page.evaluate(()=>window.oldCalendarImage.dispatchEvent(new Event('error')));await assertPhoto(avatar,'v2');
  await f.refresh({});await expect(avatar).toHaveText('🧑');await expect(avatar.locator('img')).toHaveCount(0);
  await f.refresh({[f.model.companyId]:'/media/broken.svg'});await expect(avatar).toHaveText('🧑');
  await f.refresh({[f.model.companyId]:'/media/calendar-profile-v3.svg'});await assertPhoto(avatar,'v3');
  await page.keyboard.press('Escape');await open(page,f.model.start);await assertPhoto(person(page,f.model.localId,'#dayDetailBody'),'v3');
  await f.logout();await expect(page.locator('#dayDetailModal')).not.toBeVisible();await expect(person(page,f.model.localId).locator('img')).toHaveCount(0);
  expect(f.requests).toEqual([]);expect(f.errors).toEqual([]);
});
