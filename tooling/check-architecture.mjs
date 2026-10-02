import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, walk } from './build-ui.mjs';
import { checkThemes } from './check-theme-contract.mjs';
import { checkPrimitives } from './check-ui-primitives.mjs';
import { checkOwnedModals, checkLeaveDayDetail } from './check-owned-modals.mjs';
import {checkNetworkBoundaries} from './check-network-boundaries.mjs';
import {checkNativePostBoundaries} from './check-native-post-boundaries.mjs';
import { checkScheduleTaskWrites, checkScheduleTaskWriteClient, checkScheduleQuickStatusClient, checkScheduleImageUploads, checkScheduleCommentWrites, checkScheduleMilestoneWrites, checkScheduleTaskActions, checkScheduleReleaseWrites, checkSchedulePersonalTodoWrites } from './check-schedule-task-writes.mjs';
export { checkScheduleQuickStatusClient, checkScheduleImageUploads, checkScheduleCommentWrites, checkScheduleMilestoneWrites, checkScheduleTaskActions, checkScheduleReleaseWrites, checkSchedulePersonalTodoWrites } from './check-schedule-task-writes.mjs';
export function validateCatalog(catalog) {
  const errors=[], ids=new Set(), routes=new Set(), entries=new Set(), views=new Set();
  const services=new Map(catalog.services.map(service=>[service.id,service]));
  if (services.size!==catalog.services.length) errors.push('Duplicate service ID');
  for (const page of catalog.pages) {
    const service=services.get(page.service);
    if (!service) { errors.push(`${page.id}: unknown service`); continue; }
    if (ids.has(page.id)) errors.push(`${page.id}: duplicate ID`); ids.add(page.id);
    if (!/^[a-z][a-z0-9.]*$/.test(page.id)||!page.title?.trim()) errors.push('Invalid page ID/title');
    if (page.permission!==service.permission) errors.push(`${page.id}: permission must match service gate; finer permissions require a server adapter`);
    const react=service.adapter==='react', razor=service.adapter==='razor';
    if(react && !['src','src/client'].includes(service.client)) errors.push(`${page.id}: unsupported React client root`);
    const entryPattern=razor?`^apps/${service.app}/Pages/(?:[A-Za-z][A-Za-z0-9-]*/)*[A-Za-z][A-Za-z0-9-]*\\.cshtml$`:react?`^apps/${service.app}/${service.client}/(?:App|pages/[a-z][a-z0-9-]*)\\.tsx$`:`^apps/${service.app}/public/[a-z0-9-]+\\.html$`;
    if (!new RegExp(entryPattern).test(page.entry)) errors.push(`${page.id}: unsafe or unsupported entry`);
    if (entries.has(page.entry) && !razor && service.adapter!=='static-spa' && !(react&&page.entry.endsWith('/App.tsx'))) errors.push(`${page.id}: duplicate entry`); entries.add(page.entry);
    if(razor) {
      if(!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(service.namespace||'')||service.navigationEndpoint!=='/api/workspace/navigation')errors.push(`${page.id}: invalid Razor adapter`);
      if(page.anonymous===true ? page.policy!==undefined : !service.policies?.includes(page.policy))errors.push(`${page.id}: explicit Razor authentication policy required`);
      if(catalog.pages.some(p=>p!==page&&p.entry===page.entry&&(p.path!==page.path||p.policy!==page.policy||p.anonymous!==page.anonymous)))errors.push(`${page.id}: query variants must share route and server policy`);
    }else if(page.policy!==undefined||page.anonymous!==undefined||page.query!==undefined)errors.push(`${page.id}: unsupported Razor metadata`);
    if(page.query && (typeof page.query!=='object'||Array.isArray(page.query)||!Object.keys(page.query).length||Object.entries(page.query).some(([key,value])=>!/^tab$/.test(key)||typeof value!=='string'||!/^[a-z][a-z0-9-]*$/.test(value))))errors.push(`${page.id}: invalid query variant`);
    if(service.adapter==='static-spa'||react) {
      if(!/^[a-z][a-zA-Z0-9]*$/.test(page.view||'')) errors.push(`${page.id}: SPA view required`);
      const key=page.service+':'+page.view;
      if(views.has(key))errors.push(`${page.id}: duplicate SPA view`); views.add(key);
    }
    if(page.parent) {
      const parent=catalog.pages.find(p=>p.id===page.parent);
      if(!parent || parent.service!==page.service || parent.nav===false || page.nav!==false)errors.push(`${page.id}: invalid navigation parent`);
    }
    if(page.capability && (!react || !service.capabilities?.includes(page.capability)))errors.push(`${page.id}: undeclared capability`);
    if(page.badge!==undefined && (page.nav===false || page.badge!==true || (!razor && !(react && page.badgeAuthorization==='authenticated-client'))))errors.push(`${page.id}: badge requires a visible server-authorized page`);
    if(page.badgeAuthorization!==undefined && (!react || page.badge!==true || page.badgeAuthorization!=='authenticated-client'))errors.push(`${page.id}: invalid client badge authorization`);
    for(const path of [page.path,...(page.aliases||[])]) {
      const parameterized=react && page.nav===false && /\/:(?:id|[a-zA-Z][a-zA-Z0-9_]*)/.test(path);
      const checkedPath=parameterized?path.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g,(_,name)=>name==='id'?'1':'route-value'):path;
      if(page.id==='schedule.task'&&path!=='/tasks/:id')errors.push(`${page.id}: task detail route must remain /tasks/:id`);
      if (!/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/?(?:\.html)?)?$/.test(checkedPath) || /^\/(?:api|auth|health)(?:\/|$)/i.test(path)) errors.push(`${page.id}: unsafe/reserved route ${path}`);
      const key=page.service+':'+path.toLowerCase().replace(/\/$/,'')+':'+JSON.stringify(page.query||{});
      if(routes.has(key)) errors.push(`${page.id}: duplicate route ${path}`); routes.add(key);
    }
  }
  return errors;
}
export function checkPage(page,html) {
  const errors=[];
  if ((html.match(/data-company-workspace\b/g)||[]).length!==1) errors.push('exactly one shared header mount required');
  if (!html.includes(`data-company-service="${page.service}"`)) errors.push('wrong service');
  if ((html.match(/data-workspace-navigation=/g)||[]).length!==1 || !html.includes(`data-workspace-navigation="${page.service}"`)) errors.push('shared navigation mount required');
  const aside=html.match(/<aside\b[^>]*data-workspace-navigation=[\s\S]*?<\/aside>/)?.[0];
  if (!aside || !/^<aside\b[^>]*>\s*<\/aside>$/.test(aside)) errors.push('navigation markup must be owned by the shared renderer');
  if ((html.match(/<aside\b/g)||[]).length!==1) errors.push('duplicate sidebar');
  for(const asset of ['company-workspace.js','company-workspace.css']) if(!html.includes(asset)) errors.push(`${asset} missing`);
  if (!/<meta\s+name="viewport"[^>]*width=device-width/.test(html)) errors.push('responsive viewport required');
  if (!/<main\b/.test(html)) errors.push('main landmark required');
  if(page.view && !html.includes(`data-page="${page.view}"`)) errors.push('registered SPA page body missing');
  if (/filter\s*:\s*invert\(/i.test(html)) errors.push('inverted theme prohibited');
  if (/data-cw-(?:logout|panel|theme)=|class="cw-header"/.test(html)) errors.push('page duplicates global UI');
  return errors.map(message=>`${page.entry}: ${message}`);
}
export function checkNavigationReads(navigation, builder, contract) {
  const errors=[];
  for(const marker of ['CompanyReadSession.create()',"const channelFor = service => `workspace-navigation-${service}`",'readSession.run(channel','cancelAuthorizationReads()','readSession.cancel(channel)','readSession.dispose()','signal.throwIfAborted()',"result.status==='cancelled'",'!result.isCurrent?.()','validateAuthorization(service,data)',"document.addEventListener('company-context'"])
    if(!navigation.includes(marker))errors.push('Shared navigation reads must retain common lifetime and response validation: '+marker);
  if(/AbortSignal\.timeout\s*\(|Promise\.race\s*\(|new\s+AbortController\s*\(/.test(navigation))errors.push('Shared navigation cannot restore a private timeout or cancellation session');
  const readIndex=builder.indexOf("read('packages/workspace-ui/src/read-session.js')"),navigationIndex=builder.indexOf("read('packages/workspace-ui/src/navigation.js')");
  if(readIndex<0||navigationIndex<0||readIndex>navigationIndex)errors.push('Generated shell must load the read session before navigation');
  for(const marker of ['`workspace-navigation-*`','`CompanyReadSession`','계정·역할·허용 서비스 범위','8초','최신 ticket','401','403','pages','badges'])
    if(!contract.includes(marker))errors.push('Shared navigation read contract missing: '+marker);
  return errors;
}
export function checkWorkspaceContextReads(shell, validator, builder, contract) {
  const errors=[];
  for(const marker of ['contextReads=window.CompanyReadSession.create()',"contextReads.run('workspace-context'",'contextReads.dispose()',"result.status==='cancelled'",'!result.isCurrent?.()','revision!==contextRevision','const readContext=async signal=>window.CompanyContextContract.read', 'function applyContext(value)'])
    if(!shell.includes(marker))errors.push('Company context reads must retain common lifetime, revision and validation: '+marker);
  if((shell.match(/api\('\/context'/g)||[]).length!==1)errors.push('Company context must use one checked read transport');
  for(const marker of ['window.CompanyContextContract=Object.freeze({read})','typeof value.authenticated',"['master','admin','employee']",'new Set(value.services.map','stringRecord(value.profiles','stringRecord(value.projectIcons','value.projects'])
    if(!validator.includes(marker))errors.push('Company context response contract missing: '+marker);
  const validatorIndex=builder.indexOf("read('packages/workspace-ui/src/context-contract.js')"),shellIndex=builder.indexOf("read('packages/workspace-ui/src/company-workspace.js')");
  if(validatorIndex<0||shellIndex<0||validatorIndex>shellIndex)errors.push('Generated shell must load the context contract before its consumer');
  for(const marker of ['`workspace-context`','`CompanyReadSession`','authenticated','user','서비스 key','profiles/projectIcons','projects','10초','context revision','덮지 않는다'])
    if(!contract.includes(marker))errors.push('Company context read contract missing: '+marker);
  return errors;
}
export function checkRazorPage(page, body, model = '') {
  const errors=[];
  if(!/^@page\s*$/m.test(body))errors.push('Razor routes must come from the page contract');
  if(/Layout\s*=|<aside\b|<main\b|data-company-workspace\b|data-cw-(?:logout|panel|theme)=/.test(body))errors.push('Razor page must inherit shared layout');
  if(/ViewData\["Title"\]\s*=|\b(?:Authorize|AllowAnonymous)(?:Attribute)?\b/.test(body+'\n'+model))errors.push('Razor titles and authorization must come from the page contract');
  return errors.map(error=>`${page.id}: ${error}`);
}
export function checkAccountForm(fields, view, page, model) {
  const errors=[];
  const projection=model.slice(model.indexOf('public AccountInput InputFor'),model.indexOf('public int? SavedCount'));
  const preparation=model.slice(model.indexOf('private static ProposedUser Prepare'),model.indexOf('private static void Apply'));
  for(const field of fields) {
    if(!view.includes(`case "${field.key}":`))errors.push(`Account field renderer missing: ${field.key}`);
    if(!new RegExp(`\\b${field.key}\\s*=`).test(projection))errors.push(`Account edit projection missing: ${field.key}`);
    if(!preparation.includes('input.'+field.key))errors.push(`Account server normalization missing: ${field.key}`);
    if(new RegExp(`name="(?:updates\\[.*?\\]\\.)?${field.key}"`,'i').test(page))errors.push(`Account input must use _AccountField: ${field.key}`);
  }
  if(!page.includes('AccountFields.All.Where') || !page.includes('name="_AccountField"'))errors.push('Account create/edit must enumerate the shared field contract');
  if(!page.includes('CompanyForm.attach(') || !page.includes('data-bulk-result'))errors.push('Account bulk save must use shared form lifecycle and result state');
  if(!page.includes('CompanyReview.open('))errors.push('Account conflict review must use shared three-way review');
  if(!page.includes('CompanyEntityChoices.upsertCheckbox('))errors.push('Account dynamic project choices must use the shared entity choice owner');
  for(const marker of ['CompanyDialog.confirm(','scopeInvalid = true','!scopeInvalid && !resetPending','submittedSignatures.get(row)','signal:lifetime.signal','transport.dispose()','disclosures.destroy()'])
    if(!page.includes(marker))errors.push('Account bulk lifecycle must preserve shared confirmation, current drafts and scope disposal: '+marker);
  if(/\bconfirm\('모든 변경사항/.test(page))errors.push('Account reset cannot restore a private browser confirmation');
  for(const marker of ['Model.EditInputFor(user)','Model.EditVersionFor(user)','data-account-baseline','Model.HtmlDrafts','control.defaultValue = original.value','CompanyDisclosure.attach(recovery)','recoveryDisclosures?.destroy()'])
    if(!page.includes(marker))errors.push('Account HTML recovery must retain drafts and native reset baselines: '+marker);
  for(const marker of ['await RecoverHtmlDraftsAsync(updates);','baseline.UpdatedAtTicks == input.UpdatedAtTicks.ToString()','PostedFields(prefix)'])
    if(!model.includes(marker))errors.push('Account HTML recovery must preserve posted versions and contract-only raw fields: '+marker);
  return errors;
}
export function checkAccountReviewReads(page, transport, contract) {
  const errors=[];
  for(const marker of ['const readSession = window.CompanyReadSession.create()',"readSession.run('account-review'",'window.CompanyAccountReview.read(url,signal)','signal.throwIfAborted()','observed.status === \'cancelled\'','!observed.isCurrent?.()',"readSession.cancel('account-review')",'readSession.dispose()'])
    if(!page.includes(marker))errors.push('Account conflict review must retain common read lifetime: '+marker);
  const review=page.slice(page.indexOf('const reviewConflict = async () =>'),page.indexOf('transport = window.CompanyForm.attach'));
  if(/new\s+AbortController\s*\(|Promise\.race\s*\(|setTimeout\s*\(/.test(review))errors.push('Account conflict review cannot restore a private read timeout or cancellation session');
  for(const marker of ["url.origin!==root.location.origin","root.fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'manual',signal",'Accept:mediaType',"'X-Requested-With':'XMLHttpRequest'",'response.headers.get(\'content-type\')','await response.json()','signal?.throwIfAborted()'])
    if(!transport.includes(marker))errors.push('Account review transport must retain origin, response and cancellation checks: '+marker);
  if(/\bfetch\s*\(/.test(review))errors.push('Account page cannot own the review fetch');
  for(const marker of ['`account-review`','`CompanyReadSession`','30초','계정','페이지 이탈','늦은 응답','초안'])
    if(!contract.includes(marker))errors.push('Account conflict review contract missing: '+marker);
  return errors;
}
export function checkAutomaticFilterNavigation(navigation, leaveIndex, leaveUsage, contract) {
  const errors=[];
  for(const marker of ["event.target.closest?.('[data-cw-auto-submit]')","form.method.toLowerCase() !== 'get'",'event.defaultPrevented','control.disabled',"form.getAttribute('aria-busy') === 'true'",'form.requestSubmit()',"document.addEventListener('change', requestFilterNavigation)"])
    if(!navigation.includes(marker))errors.push('Automatic GET filter navigation must retain the shared guarded behavior: '+marker);
  for(const [name,page,field] of [['leave dashboard',leaveIndex,'name="ViewEmployeeId"'],['leave usage',leaveUsage,'name="EmployeeId"']]){
    const control=page.slice(page.indexOf(field)-100,page.indexOf(field)+240);
    if(!control.includes('data-cw-auto-submit'))errors.push(`${name} employee filter must use shared automatic navigation`);
    if(/onchange\s*=|\.form\.submit\s*\(/.test(control))errors.push(`${name} employee filter cannot retain inline native submit`);
  }
  for(const marker of ['GET','`data-cw-auto-submit`','`requestSubmit()`','쓰기','disabled','aria-busy'])if(!contract.includes(marker))errors.push('Automatic navigation contract missing: '+marker);
  return errors;
}
export function checkPortalCheckboxes(view, users, organization, organizationCss, siteCss, accountCss, primitives) {
  const errors=[];
  for(const marker of ['account-projects cw-choice-group','account-privacy cw-check-control','class="cw-checkbox"','Model.Compact ? "permission-switch cw-switch-control" : "option-card cw-check-control"','Model.Compact ? "cw-switch" : "cw-checkbox"','class="cw-switch-track"'])if(!view.includes(marker))errors.push('Portal account checkbox contract missing: '+marker);
  for(const marker of ['permission-switch fixed leave-employee-access cw-switch-control','class="cw-switch"','role="switch"','class="cw-switch-track"','data-tone="success"'])if(!users.includes(marker))errors.push('Portal permission switch contract missing: '+marker);
  for(const marker of ['organization-check cw-check-control','class="cw-checkbox"','fieldset class="cw-choice-group"'])if(!organization.includes(marker))errors.push('Portal organization checkbox contract missing: '+marker);
  if((organization.match(/organization-check cw-check-control/g)||[]).length!==3||(organization.match(/<input class="cw-checkbox" type="checkbox" asp-for="Form\./g)||[]).length!==3)errors.push('Organization privacy, feedback handler and archive controls must use the shared checkbox');
  if(/class="organization-check"[^>]*data-choice-label/.test(view+organization))errors.push('Searchable entity choices must stay owned by cw-choice-group');
  if(/\.organization-check\s+input|\.organization-check(?=[^{]*\{)[^{]*\{[^}]*(?:display|padding|gap|color|background|border)/i.test(organizationCss))errors.push('Organization CSS cannot duplicate shared checkbox layout, size or theme');
  for(const block of siteCss.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/\.option-card(?::(?:hover|has\([^)]*\)))?\s*$/.test(block[1])&&/(?:^|;)\s*(?:background|border(?:-color)?|padding|display|gap|cursor|accent-color|width|height)\s*:/i.test(block[2]))errors.push('Account permission cards cannot duplicate shared checkbox ownership');
  if(/\.option-card\s+input\s*\{/.test(siteCss))errors.push('Account permission cards cannot duplicate shared checkbox ownership');
  if(/\.account-privacy\s+input\s*\{[^}]*(?:accent-color|width|height|outline|background|border|color)\s*:/i.test(accountCss))errors.push('Account privacy cannot duplicate shared checkbox ownership');
  if(/\.permission-switch\s+(?:input|i)(?:::[\w-]+)?\s*\{|\.permission-switch(?=[^{]*\{)[^{]*\{[^}]*(?:display|position|justify-items|gap|cursor|background|border|padding)\s*:/i.test(siteCss+accountCss))errors.push('Portal permission switch cannot duplicate shared switch ownership');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-choice-group [data-choice-label]','html body .cw-choice-group input[type="checkbox"]','html body .cw-switch-control','html body input.cw-switch','html body .cw-switch-track','html body input.cw-switch:checked + .cw-switch-track','html body input.cw-switch:focus-visible + .cw-switch-track'])if(!primitives.includes(marker))errors.push('Shared Portal checkbox primitive missing: '+marker);
  return errors;
}
export function checkPortalPermissionPills(users, siteCss, accountCss, primitives) {
  const errors=[];
  for(const marker of [
    'account-type-badge employee cw-state-pill" data-tone="info"',
    'status cw-state-pill" data-tone="@(user.IsActive ? "success" : "neutral")"',
    'permission-result allowed cw-state-pill" data-tone="info">기본',
    'permission-result allowed cw-state-pill" data-tone="info">전체',
    'permission-result denied leave-shared-excluded cw-state-pill" data-tone="neutral"'
  ])if(!users.includes(marker))errors.push('Portal read-only account state must use a shared semantic pill: '+marker);
  for(const marker of ['.access-matrix-form .leave-shared-excluded { display: none; }','.access-matrix-form .shared-account-row .leave-shared-excluded { display: inline-flex; }'])if(!siteCss.includes(marker))errors.push('Portal shared-account exclusion visibility must override the shared pill display safely: '+marker);
  if(/\.(?:account-type-badge|permission-result|status)(?:\.[\w-]+)?\s*\{[^}]*(?:background|color|padding|border(?:-radius|-color)?|font-size|font-weight)\s*:/s.test(siteCss+'\n'+accountCss))errors.push('Portal account and permission results cannot retain a private pill palette or sizing');
  for(const marker of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="info"]','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for Portal account results: '+marker);
  return errors;
}
export function checkPortalDashboardPills(index, siteCss, primitives) {
  const errors=[];
  for(const marker of ['service-count cw-state-pill" data-tone="success"','system-status cw-state-pill" data-tone="success">사용 가능','system-status admin cw-state-pill" data-tone="warning">관리자'])if(!index.includes(marker))errors.push('Portal dashboard service state must use a shared semantic pill: '+marker);
  if(/\.(?:system-status|service-count)(?:\.[\w-]+)?\s*(?:i\s*)?\{[^}]*(?:background|color|padding|border(?:-radius|-color)?|font-size|font-weight|display|align-items|gap|width|height|box-shadow)\s*:/s.test(siteCss))errors.push('Portal dashboard service states cannot retain a private pill palette, dot or sizing');
  for(const marker of ['html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill i'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for Portal dashboard service state: '+marker);
  return errors;
}
export function checkLeaveAuditPill(markup, css, primitives) {
  const errors=[];
  const marker='audit-action-pill cw-state-pill" data-tone="info"';
  if(!markup.includes(marker))errors.push('Leave audit action must use the shared info state pill: '+marker);
  if(/\.audit-action-pill\s*\{[^}]*(?:background|color|padding|border(?:-radius|-color)?|font-size|font-weight)\s*:/s.test(css))errors.push('Leave audit action cannot retain a private pill palette or sizing');
  for(const required of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="info"]'])if(!primitives.includes(required))errors.push('Shared state pill primitive missing for Leave audit action: '+required);
  return errors;
}
export function checkLeaveAuditReads(client) {
  const errors=[];
  for(const marker of ['CompanyReadSession.create()','readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()','workspace-entity-scope-change','d.auditOwner !== owner','d.auditAction !== expected.action',"next.querySelector('script')"])
    if(!client.includes(marker))errors.push('Leave audit reads must retain common lifetime and full response checks: '+marker);
  if(/Promise\.race\s*\(|new\s+AbortController\s*\(|setTimeout\s*\(/.test(client))errors.push('Leave audit reads cannot restore a private timeout or cancellation session');
  return errors;
}
export function checkLeaveAdvancePills(admin, queues, leave, css, primitives) {
  const errors=[];
  const staticMarker='advance-badge cw-state-pill" data-tone="warning"';
  if((admin.match(new RegExp(staticMarker,'g'))||[]).length!==2)errors.push('Leave admin advance states must use two shared warning pills');
  if((queues.match(new RegExp(staticMarker,'g'))||[]).length!==4)errors.push('Leave approval queues must use four shared warning pills');
  if(!leave.includes(staticMarker))errors.push('Leave self history advance state must use the shared warning pill');
  const detailMarker='advance-badge detail-advance-badge cw-state-pill" data-tone="warning"';
  if(!leave.includes(detailMarker))errors.push('Leave calendar detail advance state must use the shared warning pill');
  if(/\.advance-badge\s*\{[^}]*(?:background|color|padding|border(?:-radius|-color)?|font-size|font-weight|display|align-items|width|white-space)\s*:/s.test(css)||/(?:data-theme="dark"|theme-dark)[^{]*\.advance-badge\s*\{/s.test(css))errors.push('Leave advance states cannot retain a private pill palette or sizing');
  for(const required of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="warning"]'])if(!primitives.includes(required))errors.push('Shared state pill primitive missing for Leave advance state: '+required);
  return errors;
}
export function checkLeaveCompletePill(leave, css, primitives) {
  const errors=[];
  const marker='request-complete-label cw-state-pill" data-tone="neutral">사용 완료';
  if(!leave.includes(marker))errors.push('Leave completed-use state must use the shared neutral pill: '+marker);
  if(/\.request-complete-label\s*\{[^}]*(?:background|color|padding|border(?:-radius|-color)?|font-size|font-weight|display|align-items|min-height|white-space)\s*:/s.test(css))errors.push('Leave completed-use state cannot retain a private pill palette or sizing');
  for(const required of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(required))errors.push('Shared state pill primitive missing for Leave completed-use state: '+required);
  return errors;
}
export function checkLeaveLegacyStatusPills(css, preview, primitives) {
  const errors=[];
  if(/\.status-pill(?:\.[\w-]+)?\s*\{/.test(css)||/,\.status-pill\.[\w-]+\s*\{/.test(css))errors.push('Leave cannot retain unused private status-pill skins');
  for(const marker of ['class="cw-state-pill" data-tone="success">승인','request-complete-label cw-state-pill" data-tone="neutral">사용 완료'])if(!preview.includes(marker))errors.push('Leave mobile preview must use the shared state-pill contract: '+marker);
  for(const required of ['html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(required))errors.push('Shared state pill primitive missing for Leave mobile preview: '+required);
  return errors;
}
export function checkLeaveQueueCounts(markup, css, primitives) {
  const errors=[];
  const marker='section-count cw-count-badge';
  if((markup.match(new RegExp(marker,'g'))||[]).length!==2)errors.push('Leave approval queue headings must use two shared count badges');
  if(/\.section-count\s*\{[^}]*(?:display|align-items|justify-content|place-items|min-width|min-height|height|padding|border(?:-radius|-color)?|background|color|font-size|font-weight|line-height|vertical-align)\s*:/s.test(css)||/(?:data-theme="dark"|theme-dark)[^{]*\.section-count\s*\{/s.test(css))errors.push('Leave queue counts cannot retain private badge geometry, palette or theme overrides');
  if(!primitives.includes('html body .cw-count-badge'))errors.push('Shared count badge primitive missing for Leave approval queues');
  return errors;
}
export function checkEntityBindings(file, body) {
  const errors=[];
  if(file==='apps/schedule/src/Releases.tsx'&&(!body.includes('<ReleaseActor ')||!body.includes('<ReleaseProject ')))errors.push(`${file}: release actor/project displays must use shared identity adapters`);
  if(file==='apps/schedule/src/ReleaseIdentity.tsx'&&(!body.includes('<Avatar id={actor?.id}')||!body.includes('<ProjectIcon id={project?.id}')||!body.includes('employee.id===actorId')))errors.push(`${file}: release profiles must use authorized IDs and shared renderers`);
  if(/\.(?:tsx|cshtml)$/.test(file)&&(/data-search-choices\b|className="mention-picker"/.test(body)))errors.push(`${file}: use shared entity choices/suggestions instead of a page-owned search list`);
  if(file.startsWith('apps/leave/Pages/')&&file.endsWith('.cshtml'))for(const tag of body.match(/<select\b[^>]*>/g)||[]){
    const field=tag.match(/(?:name|asp-for)="([^"]+)"/)?.[1];
    if(field&&(/employeeid$/i.test(field)||field==='actorFilter')&&(!tag.includes('data-company-picker="employee"')||!tag.includes('data-company-local="true"')))
      errors.push(`${file}: employee select must explicitly bind the shared picker and local ID mapping`);
  }
  if(file.endsWith('.tsx')&&!file.includes('/generated/')&&/\.(?:profileUrl|projectUrl)\b/.test(body))errors.push(`${file}: entity images must use WorkspaceEntity instead of a page-owned profile directory`);
  return errors;
}
export function checkAccountCreation(page, model, client) {
  const errors=[];
  for(const marker of ['data-add-result','data-account-defaults','UsersModel.AddDefaults','~/js/account-create.js','CompanyAccountCreate.attach('])
    if(!page.includes(marker))errors.push('Account registration must use shared fields and create lifecycle: '+marker);
  const add=model.slice(model.indexOf('public async Task<IActionResult> OnPostAddAsync'),model.indexOf('public async Task<IActionResult> OnPostUpdateAsync'));
  for(const marker of ['FormValues(InputFor(user))','FormResult("saved"','FormResult("invalid"','FormResult("unknown"','committing = true'])
    if(!add.includes(marker))errors.push('Account registration must acknowledge canonical committed fields: '+marker);
  for(const marker of ['CompanyForm.attach(','validateAcknowledgement(data, submitted, defaults);','signature() !== sentSignature','workspace-entity-scope-change','beforeunload',"outcome === 'invalid'",'transport.dispose()'])
    if(!client.includes(marker))errors.push('Account registration must retain shared transport, draft and scope protection: '+marker);
  if(/\bfetch\s*\(|location\.(?:reload|assign|replace)\s*\(/.test(client))errors.push('Account registration cannot duplicate transport or automatically discard other form drafts');
  return errors;
}
export function checkTaskReview(body) {
  const task = body.split('function Discussion')[0], errors=[];
  if (!task.includes('openWorkspaceReview(') || !task.includes('taskReviewItem(') || !task.includes('applyTaskReview(')) errors.push('Task conflicts must use the shared review and explicit field reconciliation');
  for(const marker of ['async function requestTaskEditCancel(', 'taskDiscardPermit.current', 'taskDiscardRequest.current', 'JSON.stringify({form:value.form,images:value.images})===captured', "title:'업무 편집 초안을 버릴까요?'", 'const closed=await close()', 'if(!closed&&stable())'])
    if(!task.includes(marker))errors.push('Task edit cancellation requires checked shared confirmation and guarded close: '+marker);
  if(task.includes("confirm('수정 중인 내용을 취소할까요?')"))errors.push('Task edit cancellation cannot restore browser confirmation');
  for(const marker of ['async function requestCommentTransition(', 'commentTransitionRequest.current', 'newCommentRevision.current', 'nestedCommentRevision.current', 'reportNewCommentDirty', 'reportNestedCommentDirty', "title:kind==='edit-task'?'댓글 초안을 버리고 업무를 수정할까요?':'댓글 초안을 버리고 변경 이력을 열까요?'", 'if(intent&&stable())apply()'])
    if(!task.includes(marker))errors.push('Task-level comment draft transitions require checked shared confirmation: '+marker);
  for(const message of ['작성 중인 댓글을 취소하고 업무를 수정할까요?','작성 중인 댓글을 취소하고 화면을 전환할까요?'])if(task.includes(`confirm('${message}')`))errors.push('Task-level comment draft transitions cannot restore browser confirmation: '+message);
  for(const marker of ['useWorkspaceNavigationRequest(requestPanelNavigationDiscard)', 'async function requestPanelNavigationDiscard(', 'navigationDiscardRequest.current', "title:'작성 중인 내용을 버리고 이전 화면으로 이동할까요?'", "if(source!=='history')return()=>true", 'return intent&&stable()?stable:null'])
    if(!task.includes(marker))errors.push('Task history navigation requires checked shared draft confirmation: '+marker);
  if(task.includes("confirm('작성 중인 내용을 닫을까요? 저장하지 않은 내용은 사라집니다.')"))errors.push('Task history navigation cannot restore its retired browser confirmation');
  for(const marker of ['async function requestTaskJump(', 'taskJumpRequest.current', '[newCommentRevision.current,nestedCommentRevision.current]', "title:'작성 중인 내용을 버리고 다른 업무로 이동할까요?'", 'const moved=await opened(nextId,commentId)', 'if(!intent||!stable())return'])
    if(!task.includes(marker))errors.push('Task reference navigation requires checked shared draft confirmation: '+marker);
  if(task.includes("confirm('작성 중인 내용을 닫고 다른 일정으로 이동할까요? 저장하지 않은 내용은 사라집니다.')"))errors.push('Task reference navigation cannot restore browser confirmation');
  for(const marker of ['beforeCloseRequest:requestPanelCloseDiscard', 'async function requestPanelCloseDiscard(', 'taskCloseRequest.current', "title:'작성 중인 내용을 버리고 업무를 닫을까요?'", 'return intent&&stable()?stable:null'])
    if(!task.includes(marker))errors.push('Task modal close requires checked shared draft confirmation: '+marker);
  if (/setForm\([^\n]*version:\s*detail\.task\.version/.test(task)) errors.push('Task conflicts cannot rebase a version without reviewing fields');
  return errors;
}
export function checkCommentReview(panel, composer) {
  const errors=[];
  if(!panel.includes("import { CommentComposer } from './CommentComposer'")||panel.includes('function CommentComposer('))errors.push('Comment editing must use the shared-review composer adapter');
  for(const call of ['openWorkspaceReview(','commentReviewItem(','applyCommentReview(','useCommentWrites({'])if(!composer.includes(call))errors.push('Comment review or acknowledged save reconciliation is missing: '+call);
  for(const marker of ['confirmWorkspaceAction(', 'async function requestCommentDiscard(', 'discardRevision.current', 'workspace-entity-scope-change', 'commentActorScope(', 'validate:()=>stable()'])if(!panel.includes(marker))errors.push('Comment draft transitions require checked shared confirmation: '+marker);
  const discussion=panel.slice(panel.indexOf('function Discussion'));
  if(/\bconfirm\s*\(/.test(discussion))errors.push('Comment editor transitions cannot restore browser confirmation');
  if(/setVersion\(initial(?:\?|)\.version\)|현재 내용으로 재시도 준비/.test(panel+composer))errors.push('Comments cannot rebase only their version');
  return errors;
}
export function checkSheetConfirmation(app, actions) {
  const errors=[];
  if(!app.includes('useSheetActions(')||/function (MigrationDialog|SyncDialog)\(/.test(app))errors.push('Sheet writes must use the shared confirmation adapter');
  for(const call of ['confirmWorkspaceAction(','confirmMigrationReceipt(','confirmSyncReceipt('])if(!actions.includes(call))errors.push('Sheet confirmation or acknowledged result is missing: '+call);
  if(/api\.(migrate|applyKoreanSync)\(/.test(app))errors.push('Sheet pages cannot bypass the confirmed action lifecycle');
  return errors;
}
export function checkSheetWrites(actions, writes, api, server, contract='') {
  const errors=[];
  for(const marker of ['createWorkspaceWriteTransport(', 'createWorkspaceReadSession(', "session.run('after-write'", '30_000', "reads.current?.cancel('after-write')", 'reads.current?.dispose()', 'writer.send(', "'X-Workspace-Actor':captured.config!.actorId", "'X-Workspace-Sheet-State':migration?analysis!.id:preview!.id", 'activeWrite.current', 'confirmMigrationReceipt(', 'confirmSyncReceipt(', 'transport.current?.dispose()', 'workspace-entity-scope-change'])
    if(!actions.includes(marker))errors.push('Sheet writes require the common transport and current reviewed scope: '+marker);
  for(const marker of ['confirmMigrationReceipt', 'confirmSyncReceipt', 'exactKeys(', "sent.confirmation !== '수식 제거'", "sent.confirmation !== '한국어 갱신'", 'value.analysisId !== analysis.id', 'value.previewId !== preview.id'])
    if(!writes.includes(marker))errors.push('Sheet write receipts must bind the entire transmitted command: '+marker);
  if(/(?:migrate|applyKoreanSync)\s*:/.test(api)||api.includes("'/api/migrations/apply'")||api.includes("'/api/sync/korean/apply'"))errors.push('Sheet checked read API cannot carry raw write shortcuts');
  for(const marker of ["workspaceFormMediaType = 'application/vnd.company.workspace-form+json'", 'companyActorId(request)', 'validateSheetWriteContext(', 'requireSheetWriteContext(request,response,expectedAnalysisId)', 'requireSheetWriteContext(request,response,previewId)', 'workspaceSaved(response', 'workspaceRejected(response', "operation:'migration'", "operation:'korean-sync'", "protocol:'workspace-form-v1'", "outcome:status === 409 ? 'conflict' : 'invalid'"])
    if(!server.includes(marker))errors.push('Sheet server must emit the common saved/conflict/invalid protocol: '+marker);
  for(const marker of ['`CompanyForm`','`WorkspaceReadSession`','`after-write`','`workspace-form-v1`','`X-Workspace-Actor`','`X-Workspace-Sheet-State`','30초','자동 재전송하지 않는다','분석 ID','미리보기 ID','후속 조회'])
    if(contract&&!contract.includes(marker))errors.push('Sheet write contract is incomplete: '+marker);
  return errors;
}
export function checkSheetReads(hook, api, contract='') {
  const errors=[];
  for(const marker of ['createWorkspaceReadSession', 'readSession.current?.cancel(channel)', 'session.run(channel, work, 30_000)', "result.status === 'cancelled'", '!result.isCurrent()', 'readOwners.current[channel] === owner', 'session.dispose()', 'workspace-entity-scope-change', 'checkTarget(runtime, initial)', 'checkTarget(runtime, value)'])if(!hook.includes(marker))errors.push('Sheet body reads require the common observation session: '+marker);
  if(/new AbortController\s*\(|Promise\.race\s*\(|setTimeout\s*\(/.test(hook))errors.push('Sheet body reads cannot restore a private timeout or cancellation session');
  for(const marker of ["credentials: 'same-origin', cache: 'no-store', redirect: 'manual'", 'readConfig', 'readAnalysis', 'readSnapshots', 'readPreview', "'/api/config'", "'/api/spreadsheets/analyze'", "'/api/snapshots'", "'/api/sync/korean/preview'"])if(!api.includes(marker))errors.push('Sheet checked read transport is incomplete: '+marker);
  if((api.match(/\bfetch\s*\(/g)||[]).length!==1)errors.push('Sheet API must keep one checked JSON transport');
  for(const marker of ['`main`','`preview`','`WorkspaceReadSession`','`api.ts`','`sheetReads.ts`','30초','취소','최신 ticket'])if(contract&&!contract.includes(marker))errors.push('Sheet read contract is incomplete: '+marker);
  return errors;
}
export function checkSheetConnectionPill(app, css, workspaceCss, primitives) {
  const errors=[];
  for(const marker of ['className="connection-badge cw-state-pill"', "data-tone={config.mode === 'google' ? 'success' : 'warning'}", "config.mode === 'google' ? 'Google 연결됨' : '데모 모드'"])
    if(!app.includes(marker))errors.push('Sheet connection state must use the shared status pill contract: '+marker);
  for(const marker of ['className="live-label cw-state-pill" data-tone="success"','<i /> READY'])if(!app.includes(marker))errors.push('Sheet readiness must use the shared success pill: '+marker);
  if(/\.connection-badge\.(?:google|demo)\b|\.(?:connection-badge|status-pill|sync-pill)\s+i\s*\{/.test(css+workspaceCss))errors.push('Sheet state pills cannot retain a private mode palette or dot skin');
  if(/\.connection-badge\s*\{[^}]*(?:background|color|border(?:-color|-radius)?|padding|min-height|font-size|font-weight|gap)\s*:/s.test(css))errors.push('Sheet connection badge cannot duplicate shared pill layout or theme');
  if(/\.live-label(?:\s+i)?\s*\{[^}]*(?:display|align-items|gap|background|color|border(?:-color|-radius)?|padding|min-height|font-size|font-weight|width|height)\s*:/s.test(css+workspaceCss))errors.push('Sheet readiness cannot retain a private pill palette, sizing or dot skin');
  for(const marker of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill i','width:5px','height:5px','border-radius:50%'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for Sheet connection/readiness status: '+marker);
  return errors;
}
export function checkTaskConfirmation(panel, actions) {
  const errors=[];
  if(!actions.includes('live.current.readDetail()')||!actions.includes('start.readDetail()')||/api<Detail>/.test(actions))errors.push('Task actions must delegate detail reads to the shared panel lifecycle');
  const actionBinding=panel.match(/useTaskActions\(\{[\s\S]*?\}\)/)?.[0]||'';
  if(!actionBinding.includes('changed:()=>changed(true)'))errors.push('Task actions must use the shared confirmation lifecycle with observable refresh failure');
  if(!actionBinding.includes('writes.recover(fresh,directory)')||!actions.includes('live.current.revalidated?.(checked.detail,checked.directory)'))errors.push('Explicit action recheck must pass the verified original identity to the shared write scope');
  for(const call of ['confirmWorkspaceAction(','taskActionTarget(','taskActionSignature(','captureTaskAction(','confirmTaskActionReceipt(','verifyTaskActionRead('])if(!actions.includes(call))errors.push('Task confirmation or acknowledged result is missing: '+call);
  if(/async function (archive|remove)\(/.test(panel)||/api\([^\n]*(?:\/archive|\/restore|\/comments\/[^\n]*'DELETE')/.test(panel))errors.push('Task pages cannot bypass the confirmed archive/restore/comment deletion lifecycle');
  return errors;
}
export function checkAccountDisclosures(body) {
  const errors=[];
  if(!body.includes('CompanyDisclosure.attach(form)')||!body.includes('disclosures.setOpen('))errors.push('Account detail rows and filtering must use the shared disclosure lifecycle');
  for(const tag of body.match(/<button\b[^>]*data-detail-toggle[^>]*>/g)||[])if(!tag.includes('data-cw-disclosure='))errors.push('Account detail triggers must declare the shared disclosure key');
  for(const tag of body.match(/<tr\b[^>]*data-user-details[^>]*>/g)||[])if(!tag.includes('data-cw-disclosure-panel=')||!tag.includes(' hidden'))errors.push('Account details must declare their panel and initial hidden state');
  if(/detail\?\.classList\.toggle\('hidden'|peer\.setAttribute\('aria-expanded'/.test(body))errors.push('Account pages cannot duplicate shared disclosure state');
  return errors;
}
export function checkPlayerDisclosures(body, markup) {
  const errors=[];
  for(const marker of ['beforeRequest: async', 'approval.approve()', 'async function confirmDiscard(',
    'readSignature() === signature', 'signal?.addEventListener', "title:'편집 내용 버리기'", 'if (!approve?.())', "presentEditorDialog('add', opener)", "presentEditorDialog('delete', opener)"])
    if(!body.includes(marker))errors.push(`CS draft transitions require shared awaited approval and current target: ${marker}`);
  for(const marker of ['CompanyDisclosure.attach(elements.dataStoresContainer', 'single: true', 'disclosures.refresh()', 'disclosures.setOpen(', 'panel.dataset.cwDisclosurePanel', 'keyButton.dataset.cwDisclosure', 'detailButton.dataset.cwDisclosure', 'cw-table-scroll', 'cw-table-detail', "keyFilterInput.addEventListener('input', filterDataStores)"])
    if(!body.includes(marker))errors.push(`Player editor must keep shared disclosure binding: ${marker}`);
  if(/attachInlineDetail\(|setAttribute\(['"]aria-expanded['"]/.test(body))errors.push('Player editor cannot duplicate shared row expansion state');
  if((markup.match(/id="jsonEditor"/g)||[]).length!==1||(markup.match(/id="detailPanel"/g)||[]).length!==1)errors.push('Player data must retain one editor node');
  for(const id of ['interactionFields','addFields','deleteFields'])if(!markup.includes(`<fieldset id="${id}"`))errors.push('Player operations must retain native pending-interaction locks');
  return errors;
}
export function checkPlayerMutations(body, markup, css, primitives, spec='') {
  const errors=[];
  for (const marker of ['validatePlayerConfig(', 'validatePlayerBaseConfig(', 'assertRead(operation)', 'state.readOperation === operation', 'abort.signal.aborted', 'Promise.race([transportJson(path, body, abort.signal, scope), interrupted])', "actionLabel:retry ? '다시 확인'", 'onAction:retry', 'state.disposed', "color('--cw-success-bg')", "themeObserver.observe"])
    if (!body.includes(marker)) errors.push('Player reads require shared state, current operation and semantic diff colors: '+marker);
  if (/CsToast|renderCompanyUser/.test(body) || /#[\da-f]{3,8}\b|rgba?\(/i.test(css)) errors.push('Player data cannot restore private feedback, identity rendering or raw theme colors');
  if (!markup.includes('id="messageBox" hidden')) errors.push('Player reads require a persistent shared feedback region');
  for(const marker of ['window.CompanyDialog.confirm(', 'window.CompanyDialog.present(', 'window.CompanyState.render(',
    'validateMutationResult(action, request,', 'validatePlayerLookup(', 'assertCurrentScope(scope)', 'readAfterMutation(',
    "runMutation('save'", "runMutation('add'", "runMutation('delete'", 'state.mutationBlocked'])
    if(!body.includes(marker))errors.push(`CS mutations must retain shared confirmation and acknowledgement handling: ${marker}`);
  if(body.includes('.showModal()') || /window\.confirm\(`\$\{state\.lookup\.environmentLabel/.test(body))errors.push('CS mutations cannot restore private confirmation lifetimes');
  if(markup.includes('class="dialog-card') || /\.data-dialog(?:::backdrop)?\s*\{/.test(css))errors.push('CS dialogs must use the shared form frame and theme');
  if((markup.match(/class="confirm-check cw-check-control"/g)||[]).length!==3||(markup.match(/class="cw-checkbox"/g)||[]).length!==3)errors.push('CS player save, add and delete confirmations require the shared checkbox primitive');
  if(/(?:\.detail-panel|\.data-dialog)\s+\.confirm-check(?:\s+input)?\s*\{[^}]*(?:background|border(?:-color)?|color|outline|accent-color|width|height)\s*:/s.test(css))errors.push('CS player confirmations cannot duplicate shared checkbox theme or input sizing');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for CS player confirmations: '+marker);
  for(const id of ['mutationState','addState','deleteState'])if(!markup.includes(`id="${id}"`))errors.push('CS mutations require persistent shared result regions');
  for(const marker of ["chip.className = 'diff-chip cw-state-pill'", "modified: 'warning'", "added: 'success'", "removed: 'danger'", 'chip.dataset.tone'])if(!body.includes(marker))errors.push('CS diff summary must use shared semantic state pills: '+marker);
  if(/\.diff-chip(?:\.[\w-]+)?\s*\{[^}]*(?:display|align-items|min-height|padding|border(?:-color|-radius)?|background|color|font-size|font-weight|white-space)\s*:/s.test(css))errors.push('CS diff summary cannot retain a private pill palette or sizing');
  for(const marker of ['html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill[data-tone="danger"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for CS diff summary: '+marker);
  for(const marker of ['CompanyReadSession.create()', "Object.freeze(['player-bootstrap', 'player-lookup'])", "const PLAYER_READ_PATHS = new Set(['/api/config', '/api/playfab/player-data/config', '/api/playfab/player-data/lookup']);", "const PLAYER_MUTATION_PATHS = new Set(['/api/playfab/player-data/save', '/api/playfab/player-data/add', '/api/playfab/player-data/delete']);", 'readSession.run(channel', 'readSession.cancel(channel)', 'readSession.dispose()', 'result.isCurrent?.()', 'signal.throwIfAborted()'])if(!body.includes(marker))errors.push('Player configuration and lookup reads require the common observation boundary: '+marker);
  if((body.match(/\bfetch\s*\(/g)||[]).length!==1||/function\s+(?:apiPost|apiRequest)\s*\(/.test(body))errors.push('Player reads and mutations must share one checked transport without a generic raw request bypass');
  for(const marker of ['`player-bootstrap`','`player-lookup`','`CompanyReadSession`','configuration','lookup','save','add','delete'])if(spec&&!spec.includes(marker))errors.push('Player data read contract is incomplete: '+marker);
  return errors;
}
export function checkCsStatePills(markup, scripts, styles, primitives) {
  const errors=[];
  for(const id of ['environmentBadge','statusBadge','steamIdMatch','modeBadge','logModeBadge','logJobStatus','productModeBadge','previewBadge'])
    if(!new RegExp(`id=["']${id}["'][^>]*class=["'][^"']*\\bcw-state-pill\\b[^"']*["'][^>]*data-tone=["']neutral["']`).test(markup))errors.push('CS status pill must start with shared neutral state: '+id);
  for(const marker of [
    "elements.environmentBadge.className = 'cw-state-pill'", 'elements.environmentBadge.dataset.tone',
    "elements.statusBadge.className = 'cw-state-pill'", 'elements.statusBadge.dataset.tone',
    "elements.steamIdMatch.className = 'cw-state-pill'", 'elements.steamIdMatch.dataset.tone',
    'function setModeTone(tone)', 'function setStatePill(element, tone)', 'function setProductBadge(element,tone)'
  ])if(!scripts.includes(marker))errors.push('CS dynamic status pill contract missing: '+marker);
  if(/\bbadge-(?:neutral|warning|danger|success)\b|className\s*=\s*[`"']badge\b/.test(markup+scripts+styles)||/(?:^|\n)\s*\.badge(?:\b|[-:])[^\n{]*\{/.test(styles))errors.push('CS cannot retain a private badge palette or runtime class');
  for(const marker of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill[data-tone="danger"]','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for CS: '+marker);
  return errors;
}
export function checkSteamRefunds(body, markup, css, spec='') {
  const errors=[];
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDialog.confirm(', 'validateSteamConfig(', 'validateSteamQuery(', 'validateSteamRefund(', 'steamTransactionSignature(', 'inputSignature() !== signature', 'readAfterRefund(', 'state.receipts.set(', 'state.receipts.has(', 'assertCurrent(operation)', 'state.operation !== operation', 'workspace-entity-scope-change'])
    if(!body.includes(marker))errors.push(`Steam refunds require shared confirmation and verified outcomes: ${marker}`);
  if(/CsToast|window\.confirm\s*\(/.test(body))errors.push('Steam refunds cannot restore private feedback or browser confirmation');
  if(/#[\da-f]{3,8}\b/i.test(css))errors.push('Steam refund styles must use semantic theme tokens');
  for(const id of ['queryFields','refundFields'])if(!markup.includes(`<fieldset id="${id}"`))errors.push('Steam actions require native pending field locks');
  if(!markup.includes('id="steamMessageBox" hidden')||!markup.includes('class="cw-data-table"'))errors.push('Steam actions require shared feedback and table framing');
  for(const marker of ['CompanyReadSession.create()', "Object.freeze(['steam-config', 'steam-query', 'steam-history'])", "const STEAM_READ_PATHS = new Set(['/api/config', '/api/transactions/query', '/api/transactions/history']);", "const STEAM_MUTATION_PATHS = new Set(['/api/transactions/refund']);", 'readSession.run(channel', 'readSession.cancel(channel)', 'readSession.dispose()', 'result.isCurrent?.()', 'signal.throwIfAborted()'])if(!body.includes(marker))errors.push('Steam configuration, transaction and history reads require the common observation boundary: '+marker);
  if((body.match(/\bfetch\s*\(/g)||[]).length!==1||/function\s+requestJson\s*\(/.test(body))errors.push('Steam reads and refund must share one checked transport without a generic raw request bypass');
  for(const marker of ['`steam-config`','`steam-query`','`steam-history`','`CompanyReadSession`','configuration','transaction query','history','refund'])if(spec&&!spec.includes(marker))errors.push('Steam read contract is incomplete: '+marker);
  return errors;
}
export function checkProductCommands(body, markup, css, baseCss, primitives, spec='') {
  const errors=[];
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDialog.confirm(', 'window.CompanyClipboard.copyText(', 'validateProductConfig(', 'validateProductPreview(', 'validateProductExecution(', 'validateProductLookup(', 'validateProductDeletion(', 'validateInteraction(', 'state.writeUncertain', 'readAfterDeletion(', 'assertCurrent(operation)', 'state.operation!==operation', 'workspace-entity-scope-change', 'prettyPrintJsonLossless(text)', 'state.lastExecutionDryRun'])
    if(!body.includes(marker))errors.push(`Product commands must retain common lifecycle and verified outcomes: ${marker}`);
  if(/CsToast|window\.confirm\s*\(|\.showModal\(/.test(body)||markup.includes('<dialog'))errors.push('Product commands cannot restore private confirmation and feedback');
  if(/function\s+copyText\s*\(|createElement\(['"]textarea['"]\)|navigator\.clipboard/.test(body))errors.push('Product commands must use the shared clipboard owner');
  if(/#[\da-f]{3,8}\b|rgba?\(/i.test(css)||/\.confirm-dialog/.test(css))errors.push('Product commands must use semantic colors and shared dialog framing');
  for(const marker of ['<fieldset id="productFields"','id="productMessageBox" hidden','id="manageMessageBox" hidden','cw-data-table'])if(!markup.includes(marker))errors.push('Product commands require shared table/status and native locks: '+marker);
  if((markup.match(/confirm-check compact-check cw-check-control/g)||[]).length!==2||(markup.match(/class="cw-checkbox"/g)||[]).length!==2)errors.push('Product Dry Run and merge approval require the shared checkbox primitive');
  if(/\.confirm-check(?:\s+input)?\s*\{[^}]*(?:background|border(?:-color)?|color|outline|accent-color|width|height|padding)\s*:/s.test(baseCss+'\n'+css))errors.push('Product command checkboxes cannot duplicate shared checkbox theme or sizing');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:disabled)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for Product commands: '+marker);
  for(const marker of ['CompanyReadSession.create()', "Object.freeze(['product-bootstrap', 'product-preview', 'product-lookup'])", "const PRODUCT_READ_PATHS = new Set(['/api/config', '/api/playfab/product-commands/config', '/api/playfab/product-commands/preview', '/api/playfab/product-commands/lookup']);", "const PRODUCT_MUTATION_PATHS = new Set(['/api/playfab/product-commands/execute', '/api/playfab/product-commands/delete']);", 'readSession.run(channel', 'readSession.cancel(channel)', 'readSession.dispose()', 'result.isCurrent?.()', 'signal.throwIfAborted()'])if(!body.includes(marker))errors.push('Product configuration, preview and lookup reads require the common observation boundary: '+marker);
  if((body.match(/\bfetch\s*\(/g)||[]).length!==1||/function\s+(?:apiPost|requestJson)\s*\(/.test(body))errors.push('Product reads and mutations must share one checked transport without a generic raw request bypass');
  for(const marker of ['`product-bootstrap`','`product-preview`','`product-lookup`','`CompanyReadSession`','configuration','preview','lookup','execute','delete'])if(spec&&!spec.includes(marker))errors.push('Product command read contract is incomplete: '+marker);
  return errors;
}
export function checkLogSearch(body, markup, css, primitives, spec='') {
  const errors=[];
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDisclosure.attach(', 'validateLogJob(', 'validateLogConfig(', 'assertCurrent(operation)', 'state.operation !== operation', 'workspace-entity-scope-change', 'state.startUncertain', 'onAction: resumeSavedJob', 'prettyPrintJsonLossless(text)'])
    if(!body.includes(marker))errors.push(`Log search must retain common states and verified job lifecycle: ${marker}`);
  if(/CsToast|createElement\(['"]details['"]\)|JSON\.stringify\(JSON\.parse/.test(body))errors.push('Log search cannot restore private feedback/disclosure or lossy JSON formatting');
  if(/#[\da-f]{3,8}\b/i.test(css))errors.push('Log search colors must use semantic theme tokens');
  for(const id of ['logMessageBox','logScanWarning'])if(!markup.includes(`id="${id}" hidden`))errors.push('Log search requires initially hidden shared feedback regions');
  if(!markup.includes('class="cw-form-wide long-range-confirmation cw-check-control hidden"')||!markup.includes('id="confirmLongRange" class="cw-checkbox"'))errors.push('Log long-range confirmation requires the shared checkbox primitive');
  if(/\.long-range-confirmation(?:\s+(?:input|strong|small))?\s*\{[^}]*(?:background|border(?:-color)?|color|outline|accent-color|width|(?<!line-)height|padding)\s*:/s.test(css))errors.push('Log long-range confirmation cannot duplicate shared checkbox theme or sizing');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for log long-range confirmation: '+marker);
  for(const marker of ['CompanyReadSession.create()', "Object.freeze(['log-bootstrap', 'log-status'])", "const LOG_READ_PATHS = new Set(['/api/config', '/api/playfab/log-search/config', '/api/playfab/log-search/status']);", "const LOG_MUTATION_PATHS = new Set(['/api/playfab/log-search/search', '/api/playfab/log-search/cancel']);", 'readSession.run(channel', 'readSession.cancel(channel)', 'readSession.dispose()', 'result.isCurrent?.()', 'signal.throwIfAborted()'])if(!body.includes(marker))errors.push('Log configuration and status reads require the common observation boundary: '+marker);
  if((body.match(/\bfetch\s*\(/g)||[]).length!==1||/function\s+(?:apiPost|requestJson)\s*\(/.test(body))errors.push('Log reads and mutations must share one checked transport without a generic raw request bypass');
  for(const marker of ['`log-bootstrap`','`log-status`','`CompanyReadSession`','configuration','status','search','cancel'])if(spec&&!spec.includes(marker))errors.push('Log read contract is incomplete: '+marker);
  return errors;
}
export function checkStatisticsControls(markup, css, adapterCss, primitives) {
  const errors=[];
  for(const marker of ['progress-filter cw-check-control','build-detail-toggle cw-check-control hidden','check-label cw-check-control','id="afterFirstMiddleBoss"','id="combinationNodes"','id="bossLinked"'])if(!markup.includes(marker))errors.push('Statistics filters require shared checkbox markup: '+marker);
  if((markup.match(/class="cw-checkbox"/g)||[]).length!==3)errors.push('Statistics must expose exactly three shared filter checkboxes');
  if(/\.check-label(?:\s+input)?\s*\{[^}]*(?:display|gap|background|border(?:-color)?|color|outline|accent-color|min-width|width|(?<!line-)height|padding)\s*:/s.test(css))errors.push('Statistics filters cannot duplicate shared checkbox layout, theme or sizing');
  if(!adapterCss.includes('.check-label.hidden { display:none!important; }'))errors.push('Statistics combination checkbox must retain its explicit hidden state');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for Statistics filters: '+marker);
  return errors;
}
export function checkStatisticsSourcePill(markup, script, css, themeCss, primitives) {
  const errors=[];
  for(const marker of ['class="source-badge cw-state-pill"','data-source-badge data-tone="neutral"'])if(!markup.includes(marker))errors.push('Statistics aggregation status must start with the shared neutral pill: '+marker);
  for(const marker of ["function setSourceStatus(text,tone)","elements.source.className='source-badge cw-state-pill'",'elements.source.dataset.tone=tone',"'warning':'success'",",'danger')",",'info')","?'neutral':'warning'"])
    if(!script.includes(marker))errors.push('Statistics aggregation status must map runtime states to shared tones: '+marker);
  if(/\.source-badge\.live\b/.test(css+themeCss))errors.push('Statistics aggregation status cannot retain its private live palette');
  if(/\.source-badge\s*\{[^}]*(?:background|color|border(?:-color|-radius)?|padding|font-size|font-weight|letter-spacing)\s*:/s.test(css+themeCss))errors.push('Statistics aggregation status cannot duplicate shared pill layout or theme');
  for(const marker of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill[data-tone="danger"]','html body .cw-state-pill[data-tone="info"]','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for Statistics aggregation status: '+marker);
  return errors;
}
export function checkStatisticsReads(script, contract='') {
  const errors=[];
  for(const marker of ["readSession:window.CompanyReadSession.create()", ".run('statistics-bootstrap'", ".run('statistics-overview'", "state.readSession.cancel('statistics-overview')", 'state.readSession.dispose()', "result.status==='cancelled'", '!result.isCurrent()', 'state.readOwner===owner', "document.addEventListener('workspace-entity-scope-change', invalidateStatistics)"])
    if(!script.includes(marker))errors.push('Statistics body reads require the common observation session: '+marker);
  if(/new AbortController\s*\(|Promise\.race\s*\(/.test(script))errors.push('Statistics body reads cannot restore a private cancellation session');
  for(const marker of ["credentials:'same-origin'", "redirect:'manual'", "cache:'no-store'", "includes('application/json')", "'/api/config'", '/api/analytics/overview?', "init.signal?.aborted", 'sessionExpired'])
    if(!script.includes(marker))errors.push('Statistics checked JSON transport is incomplete: '+marker);
  if((script.match(/\bfetch\s*\(/g)||[]).length!==1)errors.push('Statistics app must keep one checked JSON transport');
  for(const marker of ['`statistics-bootstrap`','`statistics-overview`','`CompanyReadSession`','`app.js`','30초','취소','최신 ticket','중첩 업무 필드'])
    if(contract&&!contract.includes(marker))errors.push('Statistics read contract is incomplete: '+marker);
  return errors;
}
export function checkStatisticsRefreshReads(script, contract='') {
  const errors=[];
  for(const marker of [
    'readSession = win.CompanyReadSession.create()',
    "readSession.run('statistics-refresh-context'",
    "readSession.run('statistics-refresh-status'",
    "readSession.cancel('statistics-refresh-context')",
    "readSession.cancel('statistics-refresh-status')",
    'readSession.dispose()',
    "result.status === 'cancelled'",
    '!result.isCurrent()',
    "contextRead.status === 'cancelled'",
    '!contextRead.isCurrent()'])
    if(!script.includes(marker))errors.push('Statistics refresh GET reads require the common observation session: '+marker);
  for(const marker of ['async function requestJson(','async function requestMutation(',"credentials: 'same-origin'","redirect: 'manual'","cache: 'no-store'","includes(init?.method === 'POST' ? REFRESH_MEDIA_TYPE : 'application/json')",'signal?.aborted','const work = requestJson(url, init, controller.signal)',"requestMutation('/api/analytics/refresh'"])
    if(!script.includes(marker))errors.push('Statistics refresh transport boundary is incomplete: '+marker);
  const mutationStart=script.indexOf('async function requestMutation('), mutationEnd=script.indexOf('const contextUrl',mutationStart);
  const mutation=mutationStart>=0&&mutationEnd>mutationStart?script.slice(mutationStart,mutationEnd):'';
  if((script.match(/new AbortController\s*\(/g)||[]).length!==2||!mutation.includes('new AbortController()'))errors.push('Statistics refresh may keep a private AbortController only for the document lifecycle and POST uncertainty boundary');
  if((script.match(/Promise\.race\s*\(/g)||[]).length!==1||!mutation.includes('Promise.race([work, ended])'))errors.push('Statistics refresh may keep a timeout race only around the POST uncertainty boundary');
  if((script.match(/fetchImpl\s*\(/g)||[]).length!==1)errors.push('Statistics refresh must keep one checked transport for GET and POST');
  for(const marker of ['`statistics-refresh-context`','`statistics-refresh-status`','`CompanyReadSession`','`requestMutation`','GET','POST','30초','미확정'])
    if(contract&&!contract.includes(marker))errors.push('Statistics refresh read contract is incomplete: '+marker);
  return errors;
}
export function checkStatisticsOverviewContract(script, validator, server, contract='') {
  const errors=[];
  for(const marker of ["import { readStatisticsOverview } from './overview-contract.js'",'readStatisticsOverview(await fetchJson(`/api/analytics/overview?${query}`'])
    if(!script.includes(marker))errors.push('Statistics must validate overview data before applying it: '+marker);
  for(const marker of ['export function readStatisticsOverview(value)','validPublication','summary.playTime',"['platforms','modes']","['characters','skins','weapons','pets','nodes','nodeCombinations','skills','artifacts','combinations']","['characters','skins','weapons','pets','nodes','skills','artifacts','combinations']",'topCombinations','runeConfigurations','buildStats','schemaCutoverVersion'])
    if(!validator.includes(marker))errors.push('Statistics overview nested contract is incomplete: '+marker);
  if(!server.includes("['/overview-contract.js', ['overview-contract.js', 'text/javascript; charset=utf-8']]"))errors.push('Statistics server must publish the overview contract module');
  for(const marker of ['`readStatisticsOverview`','`overview-contract.js`','적용 전','summary','trend','outcomes','versions','dimensions','builds','bosses','schema','stats'])
    if(contract&&!contract.includes(marker))errors.push('Statistics overview contract documentation is incomplete: '+marker);
  return errors;
}
export function checkScheduleBoardCheckboxes(app, filters, css, overviewCss, timelineCss, primitives) {
  const errors=[];
  const markup=app+'\n'+filters;
  for(const marker of ['주말 표시</label>','선택한 주만</label>','직원별로 묶기</label>','1주만 보기 고정</label>','aria-label="상세 보기"'])if(!filters.includes(marker))errors.push('Schedule board checkbox behavior missing: '+marker);
  if((markup.match(/className="cw-checkbox"/g)||[]).length!==5)errors.push('Schedule board must expose exactly five shared checkboxes');
  if((markup.match(/className="(?:view-toggle )?cw-check-control"/g)||[]).length!==5)errors.push('Schedule board must wrap all five checkboxes in the shared control');
  if((markup.match(/role="switch"/g)||[]).length!==3)errors.push('Schedule view options must retain the grouping, fixed-week and detail switch semantics');
  if(css.includes('.filters label:where(:not(.cw-form-field))'))errors.push('Schedule filters cannot duplicate shared checkbox layout or theme');
  if(overviewCss.includes('.filters>label:where(:not(.cw-form-field))'))errors.push('Schedule overview cannot restore a private checkbox label selector');
  if(/\.timeline-options\s+label\s*\{|\.view-toggle(?:\s+input)?\s*\{/.test(timelineCss))errors.push('Schedule view options cannot duplicate shared checkbox ownership');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for Schedule board options: '+marker);
  return errors;
}
export function checkScheduleStatePills(app, board, css, timelineCss, themeCss, primitives) {
  const errors=[];
  for(const marker of ['className="demo-badge cw-state-pill" data-tone="warning"'])if(!app.includes(marker))errors.push('Schedule demo status must use the shared warning pill: '+marker);
  for(const marker of ['className="today-badge cw-state-pill" data-tone="info"','className="status-badge cw-state-pill" data-tone="info"'])if(!board.includes(marker))errors.push('Schedule today status must use the shared info pill: '+marker);
  if(/\.day-header\s+small\s*\{|\.status-badge\s*\{/.test(css+timelineCss))errors.push('Schedule today status cannot retain private pill sizing or palette');
  if(/\.demo-badge\s*\{[^}]*(?:background|color|border(?:-color|-radius)?|padding|font-size|font-weight|letter-spacing)\s*:/s.test(css+timelineCss))errors.push('Schedule demo status cannot duplicate shared pill layout or theme');
  if(/\.status-badge\b/.test(themeCss))errors.push('Schedule dark theme cannot override the shared today pill');
  for(const marker of ['html body .cw-state-pill','html body .cw-state-pill[data-tone="warning"]','html body .cw-state-pill[data-tone="info"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for Schedule indicators: '+marker);
  return errors;
}
export function checkHolidayProtocol(view, model, protocol, client, contract, primitives, css) {
  const errors=[];
  for(const marker of ['data-holiday-snapshot','data-holiday-recheck','data-holiday-fields disabled="@Model.Locked"'])if(!view.includes(marker))errors.push('Holiday native recovery required: '+marker);
  if((model.match(/await CheckTargetAsync\(\)/g)||[]).length!==5)errors.push('All holiday writes and the post-online-read boundary must check the submitted baseline');
  for(const marker of ['workspace-form-v1','expectedEmployeeId','expectedStateToken','AsNoTracking()','previousStateToken = previous','snapshot = Snapshot()','jsonHash','Success = null','Locked = outcome != "invalid"'])if(!protocol.includes(marker))errors.push('Holiday form response contract required: '+marker);
  if(/ex\.Message/.test(model+protocol))errors.push('Holiday failure responses must not expose internal exceptions');
  for(const marker of ['data-holiday-screen','data-holiday-row-template','holiday-settings.js'])if(!view.includes(marker))errors.push('Holiday page must use its shared form adapter: '+marker);
  for(const [marker,count] of [['holiday-overwrite-check cw-check-control',2],['class="cw-checkbox"',2]])if(view.split(marker).length-1!==count)errors.push('Holiday overwrite checkbox must use the shared primitive: '+marker);
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','.cw-check-control:has(input.cw-checkbox:checked)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive is incomplete: '+marker);
  if(/\.holiday-overwrite-check[^{}]*\{[^{}]*(?:background|color|border|accent-color|box-shadow|font-weight|min-height|padding)\s*:/s.test(css))errors.push('Holiday overwrite checkbox cannot duplicate the shared skin');
  for(const marker of ['CompanyForm.createSession()','session.begin(','CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','validateHolidayReceipt(','context.isCurrent()','controller.dispose()','workspace-entity-scope-change'])if(!client.includes(marker))errors.push('Holiday shared form lifecycle required: '+marker);
  for(const marker of ['validateHolidaySnapshot','previousStateToken','sameRows','overwriteExisting','data.counts','jsonHash','oldIds = new Set(','!oldIds.has(saved.id)'])if(!contract.includes(marker))errors.push('Holiday complete response validation required: '+marker);
  if(/\bfetch\s*\(|\bconfirm\s*\(/.test(client.replaceAll('CompanyDialog.confirm(',''))||/onsubmit=|return confirm/.test(view))errors.push('Holiday page cannot duplicate transport or native confirmation');
  return errors;
}

export function checkWebhookSettings(view, client, model) {
  const errors=[];
  for(const marker of ['data-webhook-screen','data-webhook-snapshot','data-webhook-row-template','webhook-settings.js'])if(!view.includes(marker))errors.push('Webhook settings must bind shared forms: '+marker);
  for(const marker of ['CompanyForm.createSession()','session.begin(','CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','validateWebhookReceipt(','context.isCurrent()','controller.dispose()','workspace-entity-scope-change'])if(!client.includes(marker))errors.push('Webhook shared lifecycle required: '+marker);
  for(const marker of ['workspace-form-v1','CheckTarget()','expectedEmployeeId','expectedStateToken','Snapshot()','Unknown(ex)','SendTestAsync(actor,Webhooks)'])if(!model.includes(marker))errors.push('Webhook checked receipt/targets required: '+marker);
  if(/\bfetch\s*\(|\bconfirm\s*\(/.test(client.replaceAll('CompanyDialog.confirm(',''))||/onsubmit=|return confirm/.test(view))errors.push('Webhook settings cannot duplicate transport or native confirmation');
  return errors;
}

export function checkScheduleReads(view, lifecycle, transport, legacy='') {
  const errors=[];
  for(const marker of ['useScheduleData(', '<WorkspaceState', 'reads.identityError', 'reads.outcome', 'retainEditor'])if(!view.includes(marker))errors.push(`Schedule board must use shared reads and guarded content: ${marker}`);
  for(const marker of ['createWorkspaceReadSession()', "run('bootstrap'", "run('board'", 'workspace-entity-scope-change', '.isCurrent()', 'scopeEpoch.current!==epoch', 'verifiedEpoch.current===epoch', 'boardFailed.current', '.dispose()'])if(!lifecycle.includes(marker))errors.push(`Schedule reads must retain observation and identity boundaries: ${marker}`);
  for(const marker of ['bootstrapResponse', 'taskListResponse', 'milestoneResponse', 'absencesResponse', 'signal.throwIfAborted()', "cache:'no-store'", 'response.redirected', 'loadWeeks(', 'next.total===first.total'])if(!transport.includes(marker))errors.push(`Schedule responses must retain validation and pagination: ${marker}`);
  if(/api(?:<[^>]+>)?\(['"]\/api\/(?:bootstrap|tasks\?)/.test(view))errors.push('Schedule App cannot restore raw bootstrap or board reads');
  if(/location\.|sessionExpired\(|setCsrf\(/.test(transport))errors.push('Read transport cannot navigate or change login state before observation is validated');
  if(/\bfetch\s*\(|export\s+async\s+function\s+api\b|\bsetCsrf\b/.test(legacy))errors.push('Schedule cannot restore its retired raw API transport or global CSRF state');
  return errors;
}
export function checkDatePickerReads(view, spec='') {
  const errors=[];
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('date-picker-holidays')", 'readSession.current?.dispose()', "session.run('date-picker-holidays'", 'scheduleGet(`/api/absences?from=${from}&to=${to}`, signal, absencesResponse)', 'workspace-entity-scope-change', "result.status === 'cancelled'", '!result.isCurrent()'])if(!view.includes(marker))errors.push(`DatePicker holidays require common lifetime and verified GET handling: ${marker}`);
  if(/\bapi(?:<[^>]+>)?\s*\(\s*`\/api\/absences\?/.test(view))errors.push('DatePicker holidays cannot restore the private raw GET path');
  for(const marker of ['`date-picker-holidays`', '`WorkspaceReadSession`', '`scheduleGet`', '`absencesResponse`', '`workspace-entity-scope-change`', '42번째'])if(spec&&!spec.includes(marker))errors.push(`DatePicker holiday read contract is incomplete: ${marker}`);
  return errors;
}
export function checkScheduleToolReads(view, spec='') {
  const errors=[];
  for(const marker of ['registerScheduleTools(', 'createWorkspaceReadSession()', "session.cancel('webmcp-task-open')", "session.run('webmcp-task-open'", 'scheduleGet(`/api/tasks/${id}`,signal,value=>taskDetailResponse(value,id))', 'workspace-entity-scope-change', "result.status==='cancelled'", '!result.isCurrent()', 'session.dispose()'])if(!view.includes(marker))errors.push(`Schedule tool reads require common lifetime and verified task detail: ${marker}`);
  if(/\bapi(?:<[^>]+>)?\s*\(\s*`\/api\/tasks\/\$\{id\}`/.test(view))errors.push('Schedule tool cannot restore the private task preflight GET');
  for(const marker of ['`open_schedule_task`', '`webmcp-task-open`', '`WorkspaceReadSession`', '`scheduleGet`', '`taskDetailResponse`', '`workspace-entity-scope-change`'])if(spec&&!spec.includes(marker))errors.push(`Schedule tool read contract is incomplete: ${marker}`);
  return errors;
}
export function checkTaskReferenceReads(view, panel, transport, spec='') {
  const errors=[];
  for(const marker of ['createWorkspaceReadSession()', 'session.current?.cancel(`task-reference:${id}`)', 'reader.run(', '`task-reference:${id}`', 'scheduleGet(`/api/tasks/${id}/reference`, signal, value => taskReferenceResponse(value, id))', 'workspace-entity-scope-change', "result.status === 'cancelled'", 'owner !== generation.current', '!result.isCurrent()', 'requests.current.delete(id)', 'context.scope'])if(!view.includes(marker))errors.push(`Task references require common lifetime, cache invalidation and verified GET handling: ${marker}`);
  if(!panel.includes('enabled={!reads.invalid}'))errors.push('Task references must stop while the task detail identity is invalid');
  for(const marker of ['export function taskReferenceResponse(', 'reference.id===expectedId', 'nullableId(reference.projectId)', 'bool(reference.archived)'])if(!transport.includes(marker))errors.push(`Task reference response validation missing: ${marker}`);
  if(/\bapi(?:<[^>]+>)?\s*\(\s*`\/api\/tasks\/\$\{id\}\/reference`/.test(view))errors.push('Task references cannot restore the private raw GET path');
  for(const marker of ['`task-reference:${id}`', '`WorkspaceReadSession`', '`scheduleGet`', '`taskReferenceResponse`', '`workspace-entity-scope-change`'])if(spec&&!spec.includes(marker))errors.push(`Task reference read contract is incomplete: ${marker}`);
  return errors;
}
export function checkSettingsReads(view, transport, spec='') {
  const errors=[];
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('settings-milestones')", "readSession.current?.cancel('settings-history')", "readSession.current?.cancel('settings-archive')", 'readSession.current?.dispose()', "session.run<{items:Milestone[];page:MilestonePage|undefined}>(channel", "session.run('settings-history'", "session.run('settings-archive'", 'workspace-entity-scope-change', 'generation===readGeneration.current', 'milestoneRevisionResponse', 'archivedTaskPageResponse', 'mergeTaskListPages(start,result.value)'])if(!view.includes(marker))errors.push(`Settings reads require common lifetime, scope and pagination: ${marker}`);
  if(/\bapi(?:<[^>]+>)?\s*\([^\n]*\/api\/(?:milestones|tasks\?archived=true)/.test(view))errors.push('Settings cannot restore private milestone or archive GETs');
  for(const marker of ['export function archivedTaskPageResponse(', 'page.items.every(item=>item.archived)', 'export function mergeTaskListPages(', 'next.total===previous.total', '!next.items.some(', 'merged.items.length<=merged.total', 'taskListResponse(merged)'])if(!transport.includes(marker))errors.push(`Settings page validation missing: ${marker}`);
  for(const marker of ['`settings-milestones`', '`settings-history`', '`settings-archive`', '`WorkspaceReadSession`', '`scheduleGet`', '`milestonePageResponse`', '`milestoneRevisionResponse`', '`archivedTaskPageResponse`', '`mergeTaskListPages`'])if(spec&&!spec.includes(marker))errors.push(`Settings read contract is incomplete: ${marker}`);
  return errors;
}
export function checkTaskDetailReads(view,lifecycle,transport,composer){
  const errors=[];
  for(const marker of ['useTaskDetail(', 'reads.outcome', 'reads.loading', 'reads.invalid', 'readBlocked={reads.invalid}'])if(!view.includes(marker))errors.push(`Task detail must use common reads and explicit recovery: ${marker}`);
  for(const marker of ['createWorkspaceReadSession()', "run('detail'", 'taskDetailResponse(', 'assertCurrentTaskDetail(', 'result.isCurrent()', 'epoch.current===generation', 'pending.current===ticket', 'revoked.current', 'failed.current', 'start.pollPaused()', 'start.refreshIdentity()', 'workspace-entity-scope-change', '.dispose()'])if(!lifecycle.includes(marker))errors.push(`Task detail observation boundary missing: ${marker}`);
  for(const marker of ['export function taskDetailResponse(', 'd.task.id===expectedId', 'byId.has(c.parentId)', 'a.taskId===expectedId', 'export function assertCurrentTaskDetail(', 'comments.get(c.id)!.version>=c.version'])if(!transport.includes(marker))errors.push(`Task detail response validation missing: ${marker}`);
  for(const marker of ['await readDetail()', 'readBlocked||scopeChanged', 'previousReadBlocked.current', 'identity.current===commentActorScope(boot.me)'])if(!composer.includes(marker))errors.push(`Comment review must preserve shared reads and original owner recovery: ${marker}`);
  if(/api<Detail>/.test(composer))errors.push('Comment comparison cannot restore private detail reads');
  if(/api<Detail>|setInterval\(/.test(view)||/\bfetch\(|\bapi(?:<|\()|location\./.test(lifecycle))errors.push('TaskPanel detail reads cannot restore an independent transport/poll loop');
  return errors;
}
export function checkPersonalTodos(view, actions, css, primitives, spec='') {
  const errors=[];
  for(const marker of ['usePersonalTodos(', '<WorkspaceState', '<fieldset', 'todoSignature('])if(!view.includes(marker))errors.push(`TODO view requires common lifecycle: ${marker}`);
  for(const marker of ['disabled={disabled||editor?.item.id===item.id}', 'onClick={()=>void todos.edit(item)}', 'onClick={()=>void todos.switchTab(true)}'])if(!view.includes(marker))errors.push(`TODO view requires reachable guarded transitions: ${marker}`);
  for(const marker of ['confirmWorkspaceAction(', 'validateTodoList(', 'workspace-entity-scope-change', 'useWorkspaceNavigationRequest(requestTodoNavigationDiscard)', 'blocked.current', 'completed.current'])if(!actions.includes(marker))errors.push(`TODO actions require scope, draft and acknowledgement handling: ${marker}`);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('personal-todos')", 'readSession.current?.dispose()', "session.run('personal-todos'", 'scheduleGet(`/api/personal-todos?archived=${tab}`'])if(!actions.includes(marker))errors.push(`TODO reads require common lifetime and verified GET handling: ${marker}`);
  if(/\bapi(?:<[^>]+>)?\s*\(\s*`\/api\/personal-todos\?/.test(actions))errors.push('TODO reads cannot restore the private raw GET path');
  for(const marker of ['async function requestTodoNavigationDiscard(', 'navigationDiscardRequest.current', "title:'작성 중인 TODO를 버리고 이동할까요?'", "label:'새 TODO'", "label:'TODO 수정'", "value:source==='history'?'브라우저 이전·다음':'사이드바·링크'", 'return intent&&stable()&&!abort.signal.aborted?stable:null'])if(!actions.includes(marker))errors.push(`TODO page navigation requires checked shared confirmation: ${marker}`);
  if(actions.includes("confirm('작성 중인 TODO 내용을 닫을까요? 저장하지 않은 내용은 사라집니다.')"))errors.push('TODO page navigation cannot restore browser confirmation');
  for(const marker of ['async function cancelEdit()', 'editCancelRequest.current', "title:'TODO 수정을 취소할까요?'", 'todoSignature(live.current.editor!.item)', 'if(intent&&stable())setEditor(null)'])if(!actions.includes(marker))errors.push(`TODO edit cancellation requires checked shared confirmation: ${marker}`);
  if(actions.includes("confirm('TODO 수정 내용을 취소할까요?')"))errors.push('TODO edit cancellation cannot restore browser confirmation');
  for(const marker of ['async function edit(item:PersonalTodo)', 'editSwitchRequest.current', "title:'다른 TODO를 수정할까요?'", 'live.current.items.some(value=>todoSignature(value)===targetSignature)', 'if(intent&&stable())setEditor({item:target,draft:target.title})'])if(!actions.includes(marker))errors.push(`TODO edit switching requires checked shared confirmation: ${marker}`);
  if(actions.includes("confirm('현재 TODO 수정 내용을 버릴까요?')"))errors.push('TODO edit switching cannot restore browser confirmation');
  for(const marker of ['async function switchTab(next:boolean)', 'tabSwitchRequest.current', "title:'TODO 목록을 전환할까요?'", 'if(intent&&stable())applyTabSwitch(next)', "value:next?'보관함':'할 일'"])if(!actions.includes(marker))errors.push(`TODO tab switching requires checked shared confirmation: ${marker}`);
  if(actions.includes("confirm('편집 중인 TODO를 닫고 목록을 전환할까요?')"))errors.push('TODO tab switching cannot restore browser confirmation');
  for(const marker of ['className="todo-check-control cw-check-control"', 'className="todo-check cw-checkbox"'])if(!view.includes(marker))errors.push(`TODO completion requires shared checkbox ownership: ${marker}`);
  if(/\.todo-check(?:-control)?(?::focus-visible)?\s*\{[^}]*(?:width|height|accent-color|outline|background|border|color)\s*:/i.test(css))errors.push('TODO completion cannot duplicate shared checkbox size, focus or theme');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for TODO completion: '+marker);
  for(const marker of ['`personal-todos`', '`WorkspaceReadSession`', '`scheduleGet`', 'POST/PUT/PATCH/DELETE'])if(spec&&!spec.includes(marker))errors.push(`TODO read contract is incomplete: ${marker}`);
  if(/\b(?:window\.)?confirm\(/.test(view)||/#[\da-f]{3,8}\b/i.test(css))errors.push('TODO cannot restore private confirmation or hardcoded theme colors');
  return errors;
}
export function checkReleaseEditor(view,actions) {
  const errors=[];
  for(const marker of ['async function requestDiscard(', 'confirmWorkspaceAction(', 'JSON.stringify(baseline.current)===before', 'signal.addEventListener', 'return intent&&stable()?approve:null', 'const approve=()=>stable()&&!locked.current'])if(!actions.includes(marker))errors.push('Release draft close requires checked asynchronous permission: '+marker);
  for(const marker of ['useReleaseEditor(', '<WorkspaceState', 'edit.save()', 'edit.review()', 'edit.refreshList()', 'load(false,true)', 'edit.unavailable'])if(!view.includes(marker))errors.push(`Release editor must retain common review and save feedback: ${marker}`);
  for(const marker of ['openWorkspaceReview(', 'applyReleaseReview(', 'currentRelease(', 'workspace-entity-scope-change', 'useWorkspaceNavigationRequest(requestDiscard)', 'blockedRef.current', 'valid(generation,actor,captured)'])if(!actions.includes(marker))errors.push(`Release editing requires reviewed scope and acknowledged responses: ${marker}`);
  if(/setForm\(latest\)|setLatest\(|\bconfirm\(/.test(view))errors.push('Release editor cannot restore unreviewed latest-value replacement');
  return errors;
}
export function checkReleaseLists(view,actions,css,primitives,spec='') {
  const errors=[];
  for(const marker of ['useWorkspaceDisclosure(', 'useReleaseList<', '<ReleaseListState', 'data-cw-disclosure-panel=', 'cw-table-detail'])if(!view.includes(marker))errors.push(`Release lists must use shared disclosure and feedback: ${marker}`);
  for(const marker of ['releaseSeriesPage=', 'releaseRecordsPage=', 'releaseProjectPage=', 'releaseReferenceResponse(', 'releaseRevisionPage=', 'createWorkspaceReadSession()', 'scheduleGet(', 'workspace-entity-scope-change', "session.current?.cancel('release-list')", 'session.current?.dispose()', 'current===generation.current', 'if(requireSuccess)throw cause'])if(!actions.includes(marker))errors.push(`Release reads must retain common lifetime, scope and response verification: ${marker}`);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel(channel)", "readValue('release-target'", "readValue('release-resolved'", "readValue('release-targets'", "readValue('release-history'", 'releaseReferenceResponse(value,id,form.projectId)', 'releaseProjectPage(value,form.projectId)', 'releaseRevisionPage(value,{id:form.id!,projectId:form.projectId})'])if(!view.includes(marker))errors.push(`Release detail reads must retain common lifetime and identity checks: ${marker}`);
  if(/\bapi\s*(?:<[^>]+>)?\s*\([^\n]*(?:\/api\/(?:release|legacy-release))/.test(view+actions))errors.push('Release reads cannot restore private raw API requests');
  if(/<details|aria-expanded=/.test(view))errors.push('Release disclosure visibility and ARIA belong to the shared controller');
  for(const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(/\.(?:release-|version-|series-)/.test(block[1])&&/#[\da-f]{3,8}\b/i.test(block[2]))errors.push('Release styles must use shared theme tokens');
  for(const marker of ['className="release-status cw-state-pill"', "status === 'stable' ? 'success'", "status === 'unrecorded' ? 'neutral' : 'danger'", 'data-tone={tone}', 'data-tone="success"'])if(!view.includes(marker))errors.push('Release statuses must use shared semantic state pills: '+marker);
  for(const marker of ['`release-list`', '`release-target`', '`release-resolved`', '`release-targets`', '`release-history`', '401/403', '`schedule-release-writes.md`'])if(spec&&!spec.includes(marker))errors.push(`Release read contract is incomplete: ${marker}`);
  if(/\.release-status(?:\.[\w-]+)?\s*\{[^}]*(?:display|align-items|width|padding|border(?:-color|-radius)?|background|color|font-size|font-weight|white-space)\s*:/s.test(css))errors.push('Release statuses cannot retain a private pill palette or sizing');
  for(const marker of ['html body .cw-state-pill[data-tone="success"]','html body .cw-state-pill[data-tone="danger"]','html body .cw-state-pill[data-tone="neutral"]'])if(!primitives.includes(marker))errors.push('Shared state pill primitive missing for release statuses: '+marker);
  return errors;
}
export function checkLeaveNotifications(body, markup, server, css) {
  const errors=[];
  for(const marker of ['window.CompanyForm.attach(', 'window.CompanyState.render(', 'validateNotificationReceipt(', 'context.isCurrent()', 'captured.scope !== scope', 'signature(form) !== captured.signature', 'controller.dispose()', 'list.replaceChildren()', 'workspace-entity-scope-change'])
    if(!body.includes(marker))errors.push('Leave notifications must retain shared forms, verified receipts and teardown: '+marker);
  for(const action of ['MarkRead','MarkAllRead','Open'])if(!markup.includes(`data-notification-action="${action}"`))errors.push('Leave notification action must opt into shared forms: '+action);
  for(const marker of ['id="notificationState" hidden','data-notification-owner="@Model.EmployeeId"','name="expectedEmployeeId" value="@Model.EmployeeId"','data-workspace-state="empty"','data-read-status'])if(!markup.includes(marker))errors.push('Leave notifications require shared identity/status contract: '+marker);
  for(const marker of ['workspace-form-v1','CultureInfo.InvariantCulture','ModelState.IsValid','MatchesEmployee(expectedEmployeeId, employee.Id)','notifications.MarkReadAsync(id, employee.Id)','notifications.MarkAllReadAsync(employee.Id)','Url.IsLocalUrl(item.Link)'])if(!server.includes(marker))errors.push('Notification acknowledgement must preserve owner and destination checks: '+marker);
  const rules=css.slice(css.indexOf('.notification-list-panel'),css.indexOf('@media(max-width:720px)',css.indexOf('.notification-list-panel')));
  if(!rules.includes('var(--cw-active)') || /#[\da-f]{3,8}\b|rgba?\(/i.test(rules))errors.push('Notification states must use semantic theme tokens');
  return errors;
}
export function checkLeaveLegacyNotificationCss(layout, css) {
  const errors=[];
  for(const marker of ['data-company-workspace data-company-service="leave"','<aside class="cw-sidebar"','<main class="cw-main"'])if(!layout.includes(marker))errors.push('Leave must retain the shared shell boundary: '+marker);
  for(const selector of ['nav-badge-link','nav-badge','danger-badge','notification-icon-link','bell-icon','notification-badge','notification-menu-wrap','notification-popover','notification-popover-head','notification-popover-body','popover-sub-link','popover-empty','popover-notification','popover-notification-top','popover-head-actions','browser-notification-button'])if(new RegExp(`\\.${selector}\\b`).test(css))errors.push('Leave cannot restore its retired header notification UI: '+selector);
  for(const marker of ['.notification-list-panel{','.notification-item{','.notification-item.is-unread{','.notification-actions{','@media(max-width:720px){.notification-item{'])if(!css.includes(marker))errors.push('Leave notification page styles must remain available: '+marker);
  return errors;
}
export function checkLeaveDiscord(body,markup,server,css,tokens,primitives) {
  const errors=[];
  for(const marker of ['window.CompanyForm.attach(', 'window.CompanyState.render(', 'window.CompanyDialog.confirm(', 'validateDiscordReceipt(', 'context.isCurrent()', 'captured.signature!==signature()', 'controller.dispose()', 'fields.replaceChildren()', 'workspace-entity-scope-change', 'returnFocus'])
    if(!body.includes(marker))errors.push('Discord settings must retain shared form/state/confirmation and scope: '+marker);
  for(const action of ['Save','Unlink','Test','Link'])if(!markup.includes(`data-discord-action="${action}"`))errors.push('Discord action contract missing: '+action);
  for(const marker of ['discord-master-check cw-check-control','discord-option-card cw-check-control','class="cw-checkbox"'])if(!markup.includes(marker))errors.push('Discord preferences require shared checkbox markup: '+marker);
  if((markup.match(/class="cw-checkbox"/g)||[]).length!==2)errors.push('Discord preference templates must expose exactly the master and option shared checkboxes');
  if(/onsubmit\s*=|window\.confirm\(/.test(markup+body))errors.push('Discord must not restore its private confirmation');
  for(const marker of ['workspace-form-v1','CheckTarget(employee,expectedEmployeeId,expectedStateToken)','CheckTarget(Employee,expectedEmployeeId,expectedStateToken)','DiscordDmNotificationCatalog.NormalizeSelected','discordDm.BuildAuthorizationUrl(state)','discordDm.SendTestAsync(employee)'])
    if(!server.includes(marker))errors.push('Discord must preserve server scope, catalog and OAuth/DM ownership: '+marker);
  const rules=css.slice(css.indexOf('/* v9.36:'),css.indexOf('@media(max-width:820px)',css.indexOf('/* v9.36:')));
  if(/#[\da-f]{3,8}\b|rgba?\(/i.test(rules))errors.push('Discord preferences must use semantic selected/theme states');
  if(/\.discord-(?:master-check|option-card)(?::(?:hover|focus-within|has\([^}]+\)))?\s*\{[^}]*(?:background|border(?:-color)?|color|outline|accent-color)\s*:/s.test(css)||/\.discord-(?:master-check|option-card)\s+input\s*\{[^}]*(?:background|border|color|outline|accent-color|width|height)\s*:/s.test(css))errors.push('Discord preferences cannot duplicate shared checkbox theme or input sizing');
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','html body .cw-check-control:has(input.cw-checkbox:checked)','html body .cw-check-control:has(input.cw-checkbox:disabled)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive missing for Discord preferences: '+marker);
  const defined=new Set([...tokens.matchAll(/(--cw-[\w-]+)\s*:/g)].map(match=>match[1]));
  for(const match of rules.matchAll(/var\((--cw-[\w-]+)/g))if(!defined.has(match[1]))errors.push('Undefined Discord semantic token: '+match[1]);
  return errors;
}
export function checkProfileForm(client, markup, server, shell, image) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','transport.dispose()','workspace-entity-scope-change','data.userId!==owner','stamp(resource.receiptUrl(data))','readContext(abort.signal)','Promise.race','bitmap?.close()'])
    if(!image.includes(marker))errors.push('Images must retain common form, receipt, bounded image lifetime and scope: '+marker);
  for(const marker of ['CompanyImageEditor.attach(','imagePath:','value.profiles?.[owner]','receiptUrl:data=>data.avatarUrl'])
    if(!client.includes(marker))errors.push('Profile must retain its shared image resource contract: '+marker);
  for(const marker of ['data-profile-form','method="post"','enctype="multipart/form-data"','name="ExpectedUserId"','name="ExpectedVersion"','data-profile-status'])
    if(!markup.includes(marker))errors.push('Profile native form contract missing: '+marker);
  for(const marker of ['ExpectedUserId != id','Request.Form["ExpectedVersion"].Count != 1','AvatarStore.ApplyAsync(db, user.Id, image, expected)','workspace-form-v1'])
    if(!server.includes(marker))errors.push('Profile server scope and acknowledgement missing: '+marker);
  if(!shell.includes('CompanyProfile.attach(')||/api\('\/avatar'/.test(shell)||/\bfetch\s*\(|(?<![\w.])(?:window\.)?confirm\s*\(/.test(client+image))errors.push('Profile cannot restore a private request/confirmation implementation');
  return errors;
}
export function checkProjectIcon(client, image, markup, server, entities, shell) {
  const errors=[];
  for(const marker of ['CompanyImageEditor.attach(','value.isAdmin','value.projects.some','form.elements.ProjectId.value===id','data.projectId===id','data.previousVersion===sent.get','value.projectIcons'])
    if(!client.includes(marker))errors.push('Project icon resource contract missing: '+marker);
  for(const marker of ['resource.allowed(value)','resource.receiptMatches(data,sent)','stamp(resource.receiptUrl(data))','transport.dispose()','imagePending','CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm('])
    if(!image.includes(marker))errors.push('Shared image lifetime missing: '+marker);
  for(const marker of ['data-cw-project-icon','asp-page-handler="Icon"','enctype="multipart/form-data"','name="ProjectId"','name="ExpectedVersion"'])
    if(!markup.includes(marker))errors.push('Project icon native form missing: '+marker);
  for(const marker of ['OnPostIconAsync','ExpectedUserId != owner','WorkspaceImageKind.Project, id, image, expected','previousVersion = expected','OrganizationService.RequireAdmin(actor)'])
    if(!server.includes(marker))errors.push('Project icon server scope/version missing: '+marker);
  if(!shell.includes('CompanyProjectIcon.attach(')||/sendIcon|setupIcons/.test(entities)||/\bfetch\s*\(|window\.confirm\s*\(/.test(client))errors.push('Project icon cannot restore a separate image request/editor implementation');
  return errors;
}
export function checkLeaveSettlements(client, markup, server, service, primitives) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyForm.createSession()','CompanyDialog.confirm(','CompanyState.render(','controller.dispose()','observer.disconnect()','workspace-entity-scope-change','snapshot()!==captured','data.actorEmployeeId!==actor','data.employeeId!==intent.employeeId','data.previousSnapshot!==sent.get','data.days!==intent.days','data.createdGrantId===data.grantId','lease?.current'])
    if(!client.includes(marker))errors.push('Settlement common lifetime or complete receipt missing: '+marker);
  if(/\bfetch\s*\(|\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(client.replaceAll('CompanyDialog.confirm(','')))errors.push('Settlement bypasses shared transport/dialog');
  for(const marker of ['leave-settlements.js','data-company-picker="employee"','data-company-local="true"','data-company-local-employee=','cw-form-fields','cw-form-control','cw-data-table','asp-antiforgery="true"','settlement-raw-draft'])
    if(!markup.includes(marker))errors.push('Settlement shared fields or native recovery missing: '+marker);
  for(const marker of ['expectedEmployeeId','expectedSnapshot','workspace-form-v1','RawDraft = JsonSerializer.Serialize','actorEmployeeId = actorId','createdGrantId = result.CreatedGrantId?.ToString','catch (LeaveSettlementValidationException','catch (LeaveSettlementConflictException','"unknown"'])
    if(!server.includes(marker))errors.push('Settlement server acknowledgement missing: '+marker);
  for(const marker of ['security.EnsureAdmin(','source.Employee.IsSharedAccount','source.Employee.IsCompanyMaster','LeaveSettlementSnapshot.ComputeAsync','await tx.CommitAsync()','await audit.WriteAsync','return settlement;'])
    if(!service.includes(marker))errors.push('Settlement domain contract missing: '+marker);
  for(const marker of ['.cw-form-fields','.cw-form-field','.cw-form-control','.cw-form-wide','@media(max-width:600px)'])
    if(!primitives.includes(marker))errors.push('Shared native form fields missing: '+marker);
  return errors;
}
export function checkLeaveGrantProtocol(server, core, markup, snapshot, settlement) {
  const errors=[];
  for(const marker of ['OnGetBaseline(long employeeId)','security.EnsureCanForceDelete(actor)','security.EnsureAdmin(actor)','expectedEmployeeId','expectedEmployeeSnapshot','expectedSnapshot','workspace-form-v1','employeeSnapshot, previousSnapshot','grant.SourceGrantId is long','Request.Form[key].Count','ModelState.TryGetValue','Enum.IsDefined(AddGrantType)','DraftFields.ToDictionary','"unknown"'])
    if(!server.includes(marker))errors.push('Leave grant protocol contract missing: '+marker);
  for(const marker of ['await tx.CommitAsync()','await audit.WriteAsync','allocated != 0 || settled != 0','existing.GrantedDays += Days','value % .5m == 0'])
    if(!core.includes(marker))errors.push('Leave grant business invariant missing: '+marker);
  for(const marker of ['Model.Locked','@Model.RawDraft','data-workspace-state="error"','target="_blank"'])
    if(!markup.includes(marker))errors.push('Leave grant native recovery missing: '+marker);
  for(const marker of ['x.LeaveRequest.Status','createdTicks = grant.CreatedAtUtc.Ticks','grant.GrantedDays','employee.HireDate'])
    if(!snapshot.includes(marker))errors.push('Shared grant snapshot missing: '+marker);
  if(!settlement.includes('LeaveGrantSnapshot.ComputeAsync(db, balance.Grant)'))errors.push('Settlement must consume the shared grant baseline');
  return errors;
}
export function checkLeaveGrantClient(client, values, markup, row, server, primitives) {
  const errors=[];
  for(const marker of ['CompanyForm.createSession()','CompanyReadSession.create()','readSession.run(channel','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()','reads.get(employeeId)===record','CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','session.begin(owner,[C.resource(plan)])','C.saved(data,entry.intent,context)','entry.captured!==capture(entry)','session.revision===revision','tables.has(data.employeeId)','entry.savedDraft=draft(entry)','entry.controller.dispose()','observer.disconnect()','workspace-entity-scope-change','CompanyEntityDisplay.localEmployeeId(plan.employeeId)'])
    if(!client.includes(marker))errors.push('Leave grant shared editor contract missing: '+marker);
  if(/\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(client.replaceAll('CompanyDialog.confirm(',''))||/method\s*:\s*['"]POST['"]/i.test(client))errors.push('Leave grant writes and confirmation must use shared owners');
  if(/Promise\.race\s*\(|record\.abort|read\.abort\.abort\(\)|Grant read timeout/.test(client))errors.push('Leave grant reads cannot restore a private timeout or cancellation session');
  for(const marker of ['BigInt','setUTCFullYear','data.employeeSnapshot!==intent.employeeSnapshot','data.previousSnapshot!==intent.previousSnapshot','g.sourceGrantId!==(old?.sourceGrantId??null)','data.navigateTo!==','leave-grant-slot','slots.has(key)'])
    if(!values.includes(marker))errors.push('Leave grant precision or full receipt missing: '+marker);
  for(const marker of ['leave-grants.js','leave-grants-contract.js','data-grant-initial','data-grant-row-template','data-grant-filter','cw-form-fields','cw-form-control','cw-button','data-company-local-employee='])
    if(!markup.includes(marker))errors.push('Leave grant shared native markup missing: '+marker);
  for(const marker of ['asp-page-handler="DeleteGrant"','data-grant-form="DeleteGrant"','cw-form-control','cw-button','data-variant="danger"','data-grant-state'])
    if(!row.includes(marker))errors.push('Leave grant reusable row missing: '+marker);
  for(const marker of ['CatalogAsync','actorName = actor.Name','reasonRequired =','canDelete =','allocated =','settled =','remaining ='])
    if(!server.includes(marker))errors.push('Leave grant editor catalog missing: '+marker);
  for(const marker of ['button.cw-button','button.cw-button:disabled','button.cw-button:focus-visible'])
    if(!primitives.includes(marker))errors.push('Shared native button state missing: '+marker);
  return errors;
}
export function checkLeaveFormSession(shared, consumers, markup) {
  const errors=[];
  for(const marker of ['function createSession()','active !== token','captured.forEach(key => spent.add(key))',"outcome === 'unknown'",'previous?.abort.abort()','workspace-entity-scope-change','hasDraftExcept(owner)','createSession, mediaType','get revision() { return revision; }'])if(!shared.includes(marker))errors.push('Shared form session ownership missing: '+marker);
  for(const client of consumers)for(const marker of ['window.LeaveFormSession ||= window.CompanyForm.createSession()','session.track(sessionOwner','session.begin(sessionOwner','lease?.current',"lease?.finish(saved?'saved':outcome==='invalid'?'invalid':'unknown')",'session.hasDraftExcept(sessionOwner)','session.subscribe('])if(!client.includes(marker))errors.push('Leave form session connection missing: '+marker);
  if(!consumers[1].includes("'leave-request:'")||!consumers[2].includes("'external-schedule:'")||!consumers[3].includes("'leave-request:'"))errors.push('Leave form resources must distinguish namespaces and share request identity');
  if(!consumers[2].includes('setEditor({...data.input,id:data.id,snapshot:data.snapshot})'))errors.push('External save must update the confirmed editor ID and version');
  if(!markup.includes("dataset.applicationSaved === 'true'"))errors.push('Confirmed application must release calendar date selection');
  if(markup.split('const formRevision = window.LeaveFormSession?.revision;').length!==3||markup.split('formRevision !== window.LeaveFormSession?.revision').length!==5)errors.push('Calendar/list GET success and failure must reject a superseded form revision');
  return errors;
}
export function checkLeaveDashboardReads(markup,transport) {
  const errors=[];
  for(const marker of ['CompanyReadSession.create()','readSession.run(channel','readSession.cancel(\'leave-calendar\')','readSession.cancel(\'leave-request-list\')','readSession.dispose()','result.isCurrent?.()','LeaveDashboardRead.read(target.href, signal)','workspace-entity-scope-change','requestId === requestListFetchSeq','matches.length !== 1','matches[0].dataset.readOwner !== currentEmployeeId','data-read-owner="@Model.CurrentEmployee.Id"','leave-dashboard-read.js'])
    if(!markup.includes(marker))errors.push('Leave dashboard reads must retain common lifetime, account and response checks: '+marker);
  for(const marker of ["paths=new Set(['/leave','/leave/index'])","queryKeys=new Set(['Year'",'url.origin!==root.location.origin','url.hash','url.searchParams.getAll(key).length!==1',"'X-Requested-With':'XMLHttpRequest'","Accept:'text/html'","credentials:'same-origin'","cache:'no-store'","redirect:'error'",'response.headers.get(\'content-type\')','signal?.throwIfAborted()'])if(!transport.includes(marker))errors.push('Leave dashboard transport check missing: '+marker);
  if((transport.match(/\bfetch\s*\(/g)||[]).length!==1||/\bfetch\s*\(/.test(markup))errors.push('Leave dashboard reads must use one dedicated checked transport inside the common read session');
  if(/Promise\.race\s*\(|new\s+AbortController\s*\(|setTimeout\s*\(/.test(markup))errors.push('Leave dashboard reads cannot restore a private timeout or cancellation session');
  return errors;
}
export function checkLeaveCalendarAdminClient(client, markup, server, application, selfActions, external) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyDialog.confirm(','CompanyDialog.present(','cw-dialog-form','cw-review cw-confirm','entry.controller.dispose()','observer.disconnect()','workspace-entity-scope-change','snapshot(form)!==captured','data.actorEmployeeId!==owner','data.targetEmployeeId!==intention.employeeId','data.previousSnapshot!==sent.get','data.previousStatus!==','data.reason!==reason','day.date!==expectedDates[index].date','data.id!==intention.id','url.searchParams.getAll(key).length!==1','subject(form)!==before','otherDraft()','deleteDirty()','discard(','form.requestSubmit()'])if(!client.includes(marker))errors.push('Calendar admin common lifetime or full receipt missing: '+marker);
  for(const marker of ['leave-calendar-admin.js','data-leave-admin-screen','data-admin-target="@(Model.CanAdminEditCalendar ? item.AdminTarget : null)"','LeaveAdminCalendar?.selectDate','LeaveAdminCalendar?.blocksNavigation()','LeaveAdminCalendar?.remove(button)','data-force-reset','data-force-resume'])if(!markup.includes(marker))errors.push('Calendar admin form connection missing: '+marker);
  if(markup.includes("prompt('강제 삭제")||markup.includes("confirm('해당 신청 전체를 강제 삭제"))errors.push('Calendar admin cannot retain private native prompts');
  for(const consumer of [application,selfActions,external])if(!consumer.includes('LeaveAdminCalendar?.hasDraft()')||!consumer.includes('session.begin(sessionOwner')||!consumer.includes('lease?.current'))errors.push('Leave editors must coordinate real admin drafts and pending writes');
  if(!server.includes('string AdminTarget')||!server.includes('calculatedDays = request.CalculatedDays.ToString("0.############################"')||!server.includes('request.Dates.OrderBy(x => x.Date)'))errors.push('Calendar admin target must carry complete server-rendered dates and lossless IDs');
  if(/\bfetch\s*\(|\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(client.replaceAll('CompanyDialog.confirm(','')))errors.push('Calendar admin cannot own private transport or confirmation');
  return errors;
}
export function checkLeaveCalendarAdminServer(server, markup, service) {
  const errors=[];
  const start=server.indexOf('async Task<IActionResult> ProcessAdminForce('),end=server.indexOf('public Task<IActionResult> OnPostExternalScheduleSave(');
  const handler=start>=0&&end>start?server.slice(start,end):'';
  for(const marker of ['Response.Headers.CacheControl = "no-store"','Request.Headers.Accept','if (!admin.IsAdmin)','Request.Form["expectedEmployeeId"].Count != 1','Request.Form["expectedSnapshot"] != previousSnapshot','ModelState.TryGetValue(key','security.EnsureCanForceDelete(admin)','security.RequireReason(','LeaveRequestSnapshot.Compute(request)','actorEmployeeId = actorId','targetEmployeeId = request!.EmployeeId.ToString(CultureInfo.InvariantCulture)','id = request.Id.ToString(CultureInfo.InvariantCulture)','db.LeaveRequests.AsNoTracking().Include(x => x.Dates)','catch (OperationCanceledException)','Failure("unknown"','AdminForceLocked = true'])
    if(!handler.includes(marker))errors.push('Leave calendar admin server contract missing: '+marker);
  if(handler.includes('Error = ex.Message')||handler.includes('Request.Form.ToDictionary'))errors.push('Calendar admin failure cannot echo arbitrary fields or private errors');
  if(!server.includes('!IsAdminPreview && !AdminForceLocked')||!markup.includes('@Model.AdminForceRawDraft')||markup.includes('Html.Raw(Model.AdminForceRawDraft)'))errors.push('Calendar admin HTML failure requires encoded recovery and locked mutation controls');
  const create=service.slice(service.indexOf('public async Task<LeaveRequest> ForceCreateForDateAsync('),service.indexOf('public async Task DecideAsync('));
  if(!create.includes('x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster')||!create.includes('if (conflict) throw new LeaveRequestValidationException'))errors.push('Calendar force creation must retain real employee and pre-write validation policy');
  return errors;
}
export function checkLeaveCalendarPreferences(layout,markup,server,primitives,siteCss,mobileCss) {
  const errors=[];
  for(const marker of ['input[data-calendar-preference-toggle="true"]','event.stopImmediatePropagation();','submitPreference(form);'])if(!layout.includes(marker))errors.push('Leave calendar preferences must bind the server-rendered toggle: '+marker);
  if(/document\.createElement\(['"]input['"]\)|\.innerHTML\s*=/.test(layout))errors.push('Leave layout cannot create page-specific preference fields');
  for(const [marker,count] of [['name="SaveCalendarPreference" value="true"',1],['data-calendar-preference-toggle="true"',4],['name="SelfOnly" value="false"',2],['name="ShowOthers" value="false"',2],['cw-check-control',4],['class="cw-checkbox"',4]])if(markup.split(marker).length-1!==count)errors.push('Leave calendar preference markup is incomplete: '+marker);
  for(const marker of ['html body .cw-check-control','html body input.cw-checkbox','.cw-check-control:has(input.cw-checkbox:checked)','.cw-check-control:has(input.cw-checkbox:focus-visible)'])if(!primitives.includes(marker))errors.push('Shared checkbox primitive is incomplete: '+marker);
  for(const match of (siteCss+'\n'+mobileCss).matchAll(/[^{}]*\.calendar-(?:self-toggle|show-others-toggle)[^{}]*\{([^{}]*)\}/g))if(/(?:background|color|border|accent-color|box-shadow|font-weight|min-height|padding)\s*:/.test(match[1]))errors.push('Leave calendar preference cannot duplicate shared checkbox skin');
  for(const marker of ['if (SaveCalendarPreference)','CurrentEmployee.CalendarSelfOnly = SelfOnly;','CurrentEmployee.CalendarShowApprovedOthers = ShowOthers;'])if(!server.includes(marker))errors.push('Leave calendar preference persistence is incomplete: '+marker);
  return errors;
}
export function checkLeaveExternalScheduleServer(server, markup) {
  const errors=[];
  const start=server.indexOf('async Task<IActionResult> ProcessExternalSchedule('),end=server.indexOf('private async Task LoadPageAsync(');
  const handler=start>=0&&end>start?server.slice(start,end):'';
  for(const marker of ['Request.Headers.Accept','Response.Headers.CacheControl = "no-store"','if (!admin.IsAdmin)','Request.Form["expectedEmployeeId"].Count != 1','Request.Form["expectedSnapshot"].Count != 1','Request.Form["expectedSnapshot"] != previousSnapshot','ModelState.TryGetValue(idKey','ExternalScheduleFingerprint(item)','actorEmployeeId = actorId','id = item.Id.ToString(CultureInfo.InvariantCulture)','catch (OperationCanceledException)','Failure("unknown"','ExternalScheduleLocked = true','createdAtTicks = item.CreatedAtUtc.Ticks','updatedAtTicks = item.UpdatedAtUtc.Ticks'])
    if(!handler.includes(marker))errors.push('Leave external schedule server contract missing: '+marker);
  if(handler.includes('Error = ex.Message')||handler.includes('Request.Form.ToDictionary'))errors.push('External schedule failure must not leak raw exceptions or arbitrary fields');
  if(!server.includes('CurrentEmployee.IsAdmin && !ExternalScheduleLocked')||!markup.includes('@Model.ExternalScheduleRawDraft')||markup.includes('Html.Raw(Model.ExternalScheduleRawDraft)'))errors.push('External schedule HTML failure must retain encoded draft and lock mutation controls');
  return errors;
}
export function checkLeaveExternalScheduleClient(client, markup, server, application, selfActions) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','entry.controller.dispose()','observer.disconnect()','workspace-entity-scope-change','snapshot(form)!==captured','data.actorEmployeeId!==owner','data.previousSnapshot!==sent.get','data.input[key]!==intention[key]','url.searchParams.getAll(key).length!==1','hasDraft()','discardThen(','otherDraft()','form.requestSubmit()'])if(!client.includes(marker))errors.push('Leave external schedule client contract missing: '+marker);
  for(const marker of ['leave-external-schedules.js','data-snapshot="@schedule.Snapshot"','data-leave-external-screen','LeaveExternalSchedule?.blocksNavigation()','LeaveExternalSchedule?.remove(externalDelete)','LeaveExternalSchedule?.selectDate'])if(!markup.includes(marker))errors.push('Leave external schedule calendar connection missing: '+marker);
  if(!server.includes('item.Memo, IndexModel.ExternalScheduleFingerprint(item)'))errors.push('Calendar must expose actual external schedule baseline');
  for(const consumer of [application,selfActions])if(!consumer.includes('LeaveExternalSchedule?.hasDraft()')||!consumer.includes('session.hasDraftExcept(sessionOwner)')||!consumer.includes('session.begin(sessionOwner'))errors.push('Leave writes must coordinate with external draft/lifetime');
  if(/\bfetch\s*\(|\b(?:window\.)?confirm\s*\(/.test(client.replaceAll('CompanyDialog.confirm(','')))errors.push('External schedule cannot own private transport or confirmation');
  if(markup.includes("confirm('이 외부 일정 기록을 삭제"))errors.push('Legacy external schedule confirmation cannot remain');
  return errors;
}
export function checkLeaveSelfActions(client, markup, partial, server, snapshot, application) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','entry.controller.dispose()','observer.disconnect()','workspace-entity-scope-change','data.previousSnapshot!==sent.get','data.previousStatus!==prior','data.status!==expected','snapshot(form)!==captured','hasDraft()','area.inert=session.pending','leaveSelfBusy'])if(!client.includes(marker))errors.push('Leave self actions shared lifetime/receipt missing: '+marker);
  for(const marker of ['leave-self-actions.js','data-leave-self-screen','data-request-snapshot','form.requestSubmit()','window.CompanyDialog.attach(detailModal,'])if(!markup.includes(marker))errors.push('Leave self action calendar/list connection missing: '+marker);
  for(const marker of ['data-leave-self-action','name="expectedEmployeeId"','name="expectedSnapshot"','name="expectedStatus"','asp-antiforgery="true"'])if(!partial.includes(marker))errors.push('Leave self action shared native form missing: '+marker);
  for(const marker of ['ProcessSelfAction(id, "Cancel")','ProcessSelfAction(id, "WithdrawCancel")','x.Id==id&&x.EmployeeId==actor.Id','Request.Form["expectedSnapshot"]!=before','previousSnapshot=before','requests.RequestCancelAsync','requests.WithdrawCancelRequestAsync','Failure("unknown"'])if(!server.includes(marker))errors.push('Leave self action server contract missing: '+marker);
  if(!snapshot.includes('request.Dates.OrderBy')||!snapshot.includes('request.CancelRequestedAtUtc'))errors.push('Leave shared snapshot must retain status and entire request dates');
  if(!application.includes('session.begin(sessionOwner)')||!application.includes('lease?.current'))errors.push('Leave apply must coordinate with pending self actions');
  if(/\bfetch\s*\(|window\.confirm\s*\(/.test(client)||/onsubmit=/.test(partial))errors.push('Leave self actions cannot restore private transport/confirmation');
  return errors;
}
export function checkLeaveApplication(client, markup, server, service) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','controller.dispose();lock()','workspace-entity-scope-change','data.employeeId!==owner','snapshot()!==captured','BigInt(data.id)','data.input.workPlan!==sent.get','otherDraft()','url.searchParams.getAll(key).length!==1'])
    if(!client.includes(marker))errors.push('Leave application must retain shared lifetime and full acknowledgement: '+marker);
  for(const marker of ['leave-application.js','data-application-state','name="expectedEmployeeId"','asp-page-handler="Apply"','applicationRawDraft','applicationLocked'])if(!markup.toLowerCase().includes(marker.toLowerCase()))errors.push('Leave application form contract missing: '+marker);
  for(const marker of ['Request.Form["expectedEmployeeId"] != owner','catch (LeaveRequestValidationException ex)','Failure("unknown"','requests.CreateAsync','created.Id.ToString(CultureInfo.InvariantCulture)'])if(!server.includes(marker))errors.push('Leave application server contract missing: '+marker);
  if(!service.includes('class LeaveRequestValidationException')||!service.includes('await tx.CommitAsync()'))errors.push('Leave application must distinguish validation from committed work');
  if(/\bfetch\s*\(|window\.confirm\s*\(/.test(client))errors.push('Leave application cannot restore private transport/confirmation');
  return errors;
}
export function checkLeaveApprovals(client, markup, action, server) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','CompanyReadSession.create()','readSession.run(channel','readSession.cancel(reading.channel)','readSession.dispose()','result.isCurrent?.()','controller.dispose()','workspace-entity-scope-change','hasDraft()','data.employeeId!==owner','data.previousSnapshot!==sent.get','snapshot(form,submitter)!==captured','clearInterval(timer)'])
    if(!client.includes(marker))errors.push('Leave approvals must retain shared lifetime and exact receipt: '+marker);
  for(const marker of ['data-approval-screen','data-approval-state','approval-forms.js'])if(!markup.includes(marker))errors.push('Leave approval screen contract missing: '+marker);
  for(const marker of ['data-approval-form','name="expectedEmployeeId"','name="expectedSnapshot"','asp-antiforgery="true"'])if(!action.includes(marker))errors.push('Leave approval native action missing: '+marker);
  for(const marker of ['Request.Form["expectedEmployeeId"] != actorId','Request.Form["expectedSnapshot"] != before','previousSnapshot = before','security.EnsureCanForceDelete(actor)','service.DecideAsync','service.DecideCancelAsync','service.ForceDeleteAsync'])if(!server.includes(marker))errors.push('Leave approval authority/transition contract missing: '+marker);
  if(/(?<![\w.])(?:window\.)?confirm\s*\(|onsubmit=|onclick=/.test(client+markup+action))errors.push('Leave approvals cannot restore independent execution confirmations');
  if(/Promise\.race\s*\(|new\s+AbortController\(\).*Read timeout|reading\.abort\(\)/s.test(client))errors.push('Leave approval reads cannot restore a private timeout or cancellation session');
  return errors;
}
export function checkOrganizationForm(client, markup, server) {
  const errors=[];
  for(const marker of ['CompanyForm.attach(','CompanyState.render(','CompanyDialog.confirm(','controller.dispose()','workspace-entity-scope-change','captured !== snapshot()','sentSnapshot !== snapshot()','data.userId !== sent.get','data.previousVersion !== previousVersion','BigInt(data.version)'])
    if(!client.includes(marker))errors.push('Organization must retain shared form, confirmation, full receipt and scope: '+marker);
  for(const marker of ['data-organization-form','method="post"','asp-for="ExpectedUserId"','asp-for="Form.Version"','data-organization-result','data-write-locked'])
    if(!markup.includes(marker))errors.push('Organization native form contract missing: '+marker);
  for(const marker of ['ExpectedUserId != actorId','DbUpdateConcurrencyException','OrganizationValidationException','workspace-form-v1','previousVersion = Form.Version','WriteLocked = outcome != "invalid"'])
    if(!server.includes(marker))errors.push('Organization server receipt and failure recovery missing: '+marker);
  if(/\bfetch\s*\(|window\.confirm\s*\(/.test(client))errors.push('Organization cannot restore private request or confirmation paths');
  return errors;
}
export function check() {
  checkThemes();
  const primitives=checkPrimitives();
  console.log(`Shared primitives: ${primitives.files} app sources checked; ${primitives.remaining} existing occurrences tracked, no new allowances.`);
  const network=checkNetworkBoundaries();
  console.log(`Browser network boundaries: ${network.calls} reviewed fetch calls across ${network.files} sources.`);
  const posts=checkNativePostBoundaries();
  console.log(`Native POST boundaries: ${posts.forms} reviewed forms across ${posts.files} sources.`);
  const read=path=>readFileSync(resolve(root,path),'utf8');
  const catalog={...JSON.parse(read('packages/contracts/services.json')),...JSON.parse(read('packages/contracts/pages.json'))};
  const errors=validateCatalog(catalog), entries=new Set(catalog.pages.map(p=>p.entry));
  errors.push(...checkNavigationReads(read('packages/workspace-ui/src/navigation.js'),read('tooling/build-ui.mjs'),read('packages/contracts/navigation-reads.md')));
  errors.push(...checkAutomaticFilterNavigation(read('packages/workspace-ui/src/navigation.js'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Admin/Usage.cshtml'),read('packages/contracts/automatic-navigation.md')));
  errors.push(...checkWorkspaceContextReads(read('packages/workspace-ui/src/company-workspace.js'),read('packages/workspace-ui/src/context-contract.js'),read('tooling/build-ui.mjs'),read('packages/contracts/workspace-context-reads.md')));
  const accountFields=JSON.parse(read('packages/contracts/account-fields.json')).fields;
  const accountView=read('apps/portal/Pages/Shared/_AccountField.cshtml');
  const accountPage=read('apps/portal/Pages/Admin/Users.cshtml');
  errors.push(...checkProfileForm(read('packages/workspace-ui/src/profile.js'),read('apps/portal/Pages/Settings/Profile.cshtml'),read('apps/portal/Pages/Settings/Profile.cshtml.cs'),read('packages/workspace-ui/src/company-workspace.js'),read('packages/workspace-ui/src/image-editor.js')));
  errors.push(...checkOrganizationForm(read('apps/portal/wwwroot/js/organization.js'),read('apps/portal/Pages/Admin/Organization.cshtml'),read('apps/portal/Pages/Admin/Organization.cshtml.cs')));
  errors.push(...checkPortalCheckboxes(accountView,accountPage,read('apps/portal/Pages/Admin/Organization.cshtml'),read('apps/portal/wwwroot/css/organization.css'),read('apps/portal/wwwroot/css/site.css'),read('apps/portal/wwwroot/css/account-management.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkPortalPermissionPills(accountPage,read('apps/portal/wwwroot/css/site.css'),read('apps/portal/wwwroot/css/account-management.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkPortalDashboardPills(read('apps/portal/Pages/Index.cshtml'),read('apps/portal/wwwroot/css/site.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveAuditPill(read('apps/leave/Pages/Admin/AuditLogs.cshtml'),read('apps/leave/wwwroot/css/audit-logs.css')+'\n'+read('apps/leave/wwwroot/css/site.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveAuditReads(read('apps/leave/wwwroot/js/audit-logs.js')));
  errors.push(...checkLeaveAdvancePills(read('apps/leave/Pages/Admin/Index.cshtml'),read('apps/leave/Pages/Admin/_ApprovalQueues.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/wwwroot/css/site.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveCompletePill(read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/wwwroot/css/site.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveLegacyStatusPills(read('apps/leave/wwwroot/css/site.css'),read('apps/leave/scripts/preview-mobile.mjs'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveQueueCounts(read('apps/leave/Pages/Admin/_ApprovalQueues.cshtml'),read('apps/leave/wwwroot/css/site.css')+'\n'+read('apps/leave/wwwroot/css/approval-forms.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveApprovals(read('apps/leave/wwwroot/js/approval-forms.js'),read('apps/leave/Pages/Admin/Index.cshtml'),read('apps/leave/Pages/Admin/_ApprovalAction.cshtml'),read('apps/leave/Pages/Admin/Index.cshtml.cs')));
  errors.push(...checkLeaveApplication(read('apps/leave/wwwroot/js/leave-application.js'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/Services/LeaveRequestService.cs')));
  errors.push(...checkLeaveSelfActions(read('apps/leave/wwwroot/js/leave-self-actions.js'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Leave/_SelfActionForm.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/Services/LeaveRequestSnapshot.cs'),read('apps/leave/wwwroot/js/leave-application.js')));
  errors.push(...checkLeaveSettlements(read('apps/leave/wwwroot/js/leave-settlements.js'),read('apps/leave/Pages/Admin/Settlements.cshtml'),read('apps/leave/Pages/Admin/Settlements.cshtml.cs'),read('apps/leave/Services/LeaveSettlementService.cs'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveGrantProtocol(read('apps/leave/Pages/Admin/Adjustments.Protocol.cs'),read('apps/leave/Pages/Admin/Adjustments.cshtml.cs'),read('apps/leave/Pages/Admin/Adjustments.cshtml'),read('apps/leave/Services/LeaveGrantSnapshot.cs'),read('apps/leave/Services/LeaveSettlementSnapshot.cs')));
  errors.push(...checkLeaveGrantClient(read('apps/leave/wwwroot/js/leave-grants.js'),read('apps/leave/wwwroot/js/leave-grants-contract.js'),read('apps/leave/Pages/Admin/Adjustments.cshtml'),read('apps/leave/Pages/Admin/_GrantRow.cshtml'),read('apps/leave/Pages/Admin/Adjustments.Protocol.cs'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveFormSession(read('packages/workspace-ui/src/forms.js'),['leave-application','leave-self-actions','leave-external-schedules','leave-calendar-admin'].map(name=>read('apps/leave/wwwroot/js/'+name+'.js')),read('apps/leave/Pages/Leave/Index.cshtml')));
  errors.push(...checkLeaveDashboardReads(read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/wwwroot/js/leave-dashboard-read.js')));
  errors.push(...checkLeaveCalendarAdminClient(read('apps/leave/wwwroot/js/leave-calendar-admin.js'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/wwwroot/js/leave-application.js'),read('apps/leave/wwwroot/js/leave-self-actions.js'),read('apps/leave/wwwroot/js/leave-external-schedules.js')));
  errors.push(...checkLeaveCalendarAdminServer(read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Services/LeaveRequestService.cs')));
  errors.push(...checkLeaveCalendarPreferences(read('apps/leave/Pages/Shared/_Layout.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('packages/workspace-ui/src/primitives.css'),read('apps/leave/wwwroot/css/site.css'),read('apps/leave/wwwroot/css/mobile.css')));
  errors.push(...checkLeaveExternalScheduleServer(read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/Pages/Leave/Index.cshtml')));
  errors.push(...checkLeaveExternalScheduleClient(read('apps/leave/wwwroot/js/leave-external-schedules.js'),read('apps/leave/Pages/Leave/Index.cshtml'),read('apps/leave/Pages/Leave/Index.cshtml.cs'),read('apps/leave/wwwroot/js/leave-application.js'),read('apps/leave/wwwroot/js/leave-self-actions.js')));
  errors.push(...checkProjectIcon(read('packages/workspace-ui/src/project-icon.js'),read('packages/workspace-ui/src/image-editor.js'),read('apps/portal/Pages/Admin/Organization.cshtml'),read('apps/portal/Pages/Admin/Organization.cshtml.cs'),read('packages/workspace-ui/src/company-entities.js'),read('packages/workspace-ui/src/company-workspace.js')));
  errors.push(...checkAccountForm(accountFields,accountView,accountPage,read('apps/portal/Pages/Admin/Users.cshtml.cs')));
  errors.push(...checkAccountReviewReads(accountPage,read('apps/portal/wwwroot/js/account-review.js'),read('packages/contracts/portal-account-reads.md')));
  errors.push(...checkAccountCreation(accountPage,read('apps/portal/Pages/Admin/Users.cshtml.cs'),read('apps/portal/wwwroot/js/account-create.js')));
  errors.push(...checkAccountDisclosures(accountPage));
  errors.push(...checkPlayerDisclosures(read('apps/cs/public/player-data.js'),read('apps/cs/public/player-data.html')));
  errors.push(...checkPlayerMutations(read('apps/cs/public/player-data.js'),read('apps/cs/public/player-data.html'),read('apps/cs/public/player-data.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/cs-player-data-reads.md')));
  errors.push(...checkCsStatePills(
    ['index.html','player-data.html','playfab-logs.html','product-commands.html'].map(file=>read('apps/cs/public/'+file)).join('\n'),
    ['app.js','player-data.js','playfab-logs.js','product-commands.js'].map(file=>read('apps/cs/public/'+file)).join('\n'),
    read('apps/cs/public/styles.css')+'\n'+read('apps/cs/public/theme.css'),
    read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLogSearch(read('apps/cs/public/playfab-logs.js'),read('apps/cs/public/playfab-logs.html'),read('apps/cs/public/playfab-logs.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/cs-log-search-reads.md')));
  errors.push(...checkStatisticsControls(read('apps/statistics/public/index.html'),read('apps/statistics/public/styles.css'),read('apps/statistics/public/workspace-adapter.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkStatisticsSourcePill(read('apps/statistics/public/index.html'),read('apps/statistics/public/app.js'),read('apps/statistics/public/styles.css'),read('apps/statistics/public/theme.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkStatisticsReads(read('apps/statistics/public/app.js'),read('packages/contracts/statistics-reads.md')));
  errors.push(...checkStatisticsRefreshReads(read('apps/statistics/public/refresh.js'),read('packages/contracts/statistics-refresh.md')));
  errors.push(...checkStatisticsOverviewContract(read('apps/statistics/public/app.js'),read('apps/statistics/public/overview-contract.js'),read('apps/statistics/app-server.js'),read('packages/contracts/statistics-reads.md')));
  errors.push(...checkScheduleBoardCheckboxes(read('apps/schedule/src/App.tsx'),read('apps/schedule/src/ScheduleFilterOverlay.tsx'),read('apps/schedule/src/style.css'),read('apps/schedule/src/overview.css'),read('apps/schedule/src/timeline.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkScheduleStatePills(read('apps/schedule/src/App.tsx'),read('apps/schedule/src/WeekBoard.tsx'),read('apps/schedule/src/style.css'),read('apps/schedule/src/timeline.css'),read('apps/schedule/src/theme.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkSteamRefunds(read('apps/cs/public/app.js'),read('apps/cs/public/index.html'),read('apps/cs/public/steam-refunds.css'),read('packages/contracts/cs-steam-refund-reads.md')));
  errors.push(...checkProductCommands(read('apps/cs/public/product-commands.js'),read('apps/cs/public/product-commands.html'),read('apps/cs/public/product-commands.css'),read('apps/cs/public/styles.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkLeaveNotifications(read('apps/leave/wwwroot/js/notification-center.js'),read('apps/leave/Pages/Notifications/Index.cshtml'),read('apps/leave/Pages/Notifications/Index.cshtml.cs'),read('apps/leave/wwwroot/css/site.css')));
  errors.push(...checkLeaveLegacyNotificationCss(read('apps/leave/Pages/Shared/_Layout.cshtml'),read('apps/leave/wwwroot/css/site.css')));
  errors.push(...checkLeaveDiscord(read('apps/leave/wwwroot/js/discord-settings.js'),read('apps/leave/Pages/Settings/Discord.cshtml'),read('apps/leave/Pages/Settings/Discord.cshtml.cs'),read('apps/leave/wwwroot/css/site.css'),read('packages/workspace-ui/src/company-workspace.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkTaskReview(read('apps/schedule/src/TaskPanel.tsx')));
  errors.push(...checkCommentReview(read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/CommentComposer.tsx')));
  errors.push(...checkSheetConfirmation(read('apps/sheet/src/client/App.tsx'),read('apps/sheet/src/client/useSheetActions.ts')));
  errors.push(...checkSheetWrites(read('apps/sheet/src/client/useSheetActions.ts'),read('apps/sheet/src/client/sheetWrites.ts'),read('apps/sheet/src/client/api.ts'),read('apps/sheet/src/server/index.ts'),read('packages/contracts/sheet-writes.md')));
  errors.push(...checkSheetReads(read('apps/sheet/src/client/useSheetData.ts'),read('apps/sheet/src/client/api.ts'),read('packages/contracts/sheet-reads.md')));
  errors.push(...checkSheetConnectionPill(read('apps/sheet/src/client/App.tsx'),read('apps/sheet/src/client/styles.css'),read('packages/workspace-ui/src/company-workspace.css'),read('packages/workspace-ui/src/primitives.css')));
  errors.push(...checkTaskConfirmation(read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/useTaskActions.ts')));
  errors.push(...checkScheduleReads(read('apps/schedule/src/App.tsx'),read('apps/schedule/src/useScheduleData.ts'),read('apps/schedule/src/scheduleReads.ts'),read('apps/schedule/src/api.ts')));
  errors.push(...checkDatePickerReads(read('apps/schedule/src/DatePicker.tsx'),read('packages/contracts/schedule-date-picker-reads.md')));
  errors.push(...checkScheduleToolReads(read('apps/schedule/src/App.tsx'),read('packages/contracts/schedule-tool-reads.md')));
  errors.push(...checkTaskReferenceReads(read('apps/schedule/src/TaskLinks.tsx'),read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/scheduleReads.ts'),read('packages/contracts/schedule-task-reference-reads.md')));
  errors.push(...checkSettingsReads(read('apps/schedule/src/Settings.tsx'),read('apps/schedule/src/scheduleReads.ts'),read('packages/contracts/schedule-settings-reads.md')));
  errors.push(...checkTaskDetailReads(read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/useTaskDetail.ts'),read('apps/schedule/src/scheduleReads.ts'),read('apps/schedule/src/CommentComposer.tsx')));
  errors.push(...checkScheduleTaskWrites(read('apps/schedule/server/TaskRoutes.cs'),read('apps/schedule/server/TaskWriteProtocol.cs')));
  errors.push(...checkScheduleTaskWriteClient(read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/useTaskWrites.ts'),read('apps/schedule/src/taskWrites.ts')));
  errors.push(...checkScheduleQuickStatusClient(read('apps/schedule/src/App.tsx'),read('apps/schedule/src/useTaskQuickStatus.ts'),read('apps/schedule/src/taskWrites.ts')));
  errors.push(...checkScheduleImageUploads(read('apps/schedule/server/ImageRoutes.cs'),read('apps/schedule/server/ImageWriteProtocol.cs'),read('apps/schedule/src/Editor.tsx'),read('apps/schedule/src/useImageUploads.ts'),read('apps/schedule/src/imageUploads.ts'),read('packages/workspace-ui/react/workspace-form.ts')));
  errors.push(...checkScheduleCommentWrites(read('apps/schedule/server/DiscussionRoutes.cs'),read('apps/schedule/server/CommentWriteProtocol.cs'),read('apps/schedule/server/TaskRoutes.cs'),read('apps/schedule/src/CommentComposer.tsx'),read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/useCommentWrites.ts'),read('apps/schedule/src/commentWrites.ts')));
  errors.push(...checkScheduleMilestoneWrites(read('apps/schedule/server/ManagementRoutes.cs'),read('apps/schedule/server/MilestoneWriteProtocol.cs'),read('apps/schedule/src/Settings.tsx'),read('apps/schedule/src/useMilestoneWrites.ts'),read('apps/schedule/src/milestoneWrites.ts'),read('apps/schedule/src/scheduleReads.ts')));
  errors.push(...checkScheduleTaskActions(read('apps/schedule/server/TaskRoutes.cs'),read('apps/schedule/server/DiscussionRoutes.cs'),read('apps/schedule/server/TaskWriteProtocol.cs'),read('apps/schedule/server/CommentWriteProtocol.cs'),read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/useTaskActions.ts'),read('apps/schedule/src/taskActions.ts'),read('packages/contracts/schedule-task-actions.md')));
  errors.push(...checkScheduleReleaseWrites(read('apps/schedule/server/ReleaseRoutes.cs'),read('apps/schedule/server/ReleaseWriteProtocol.cs'),read('apps/schedule/src/Releases.tsx'),read('apps/schedule/src/useReleaseEditor.ts'),read('apps/schedule/src/releaseWrites.ts'),read('packages/contracts/schedule-release-writes.md')));
  errors.push(...checkSchedulePersonalTodoWrites(read('apps/schedule/server/PersonalTodoRoutes.cs'),read('apps/schedule/server/PersonalTodoWriteProtocol.cs'),read('apps/schedule/src/usePersonalTodos.ts'),read('apps/schedule/src/personalTodoWrites.ts'),read('packages/contracts/schedule-todo-writes.md')));
  errors.push(...checkOwnedModals(read('apps/schedule/src/TaskPanel.tsx'),read('apps/schedule/src/Editor.tsx'),read('apps/schedule/src/DatePicker.tsx'),read('apps/schedule/src/Releases.tsx'),read('apps/schedule/src/DateNavigation.tsx'),read('apps/schedule/src/Settings.tsx'),read('apps/schedule/src/useMilestoneWrites.ts')));
  errors.push(...checkLeaveDayDetail(read('apps/leave/Pages/Leave/Index.cshtml'),['leave-self-actions','leave-external-schedules','leave-calendar-admin'].map(name=>read('apps/leave/wwwroot/js/'+name+'.js')),['site','mobile'].map(name=>read('apps/leave/wwwroot/css/'+name+'.css'))));
  errors.push(...checkWebhookSettings(read('apps/leave/Pages/Admin/NotificationSettings.cshtml'),read('apps/leave/wwwroot/js/webhook-settings.js'),read('apps/leave/Pages/Admin/NotificationSettings.cshtml.cs')));
  errors.push(...checkHolidayProtocol(read('apps/leave/Pages/Admin/Holidays.cshtml'),read('apps/leave/Pages/Admin/Holidays.cshtml.cs'),read('apps/leave/Pages/Admin/Holidays.Protocol.cs'),read('apps/leave/wwwroot/js/holiday-settings.js'),read('apps/leave/wwwroot/js/holiday-contract.js'),read('packages/workspace-ui/src/primitives.css'),read('apps/leave/wwwroot/css/site.css')));
  errors.push(...checkPersonalTodos(read('apps/schedule/src/PersonalTodos.tsx'),read('apps/schedule/src/usePersonalTodos.ts'),read('apps/schedule/src/todos.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/schedule-todo-reads.md')));
  errors.push(...checkReleaseEditor(read('apps/schedule/src/Releases.tsx'),read('apps/schedule/src/useReleaseEditor.ts')));
  errors.push(...checkReleaseLists(read('apps/schedule/src/Releases.tsx'),read('apps/schedule/src/useReleaseList.ts'),read('apps/schedule/src/timeline.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/schedule-release-reads.md')));
  for (const page of catalog.pages) {
    try {
      const service=catalog.services.find(s=>s.id===page.service);
      if(service?.adapter==='razor') {
        const body=read(page.entry);
        const model=existsSync(resolve(root,page.entry+'.cs'))?read(page.entry+'.cs'):'';
        errors.push(...checkRazorPage(page,body,model));
      } else if(service?.adapter==='react') {
        const body=read(page.entry);
        if(page.entry.endsWith('/App.tsx')) {
          if(!new RegExp(`\\b${page.view}:\\s*\\S`).test(body))errors.push(`${page.id}: React page body missing`);
        } else if(!/export default function/.test(body))errors.push(`${page.id}: default page component required`);
      } else errors.push(...checkPage(page,read(page.entry)));
    } catch { errors.push(`Missing page ${page.entry}`); }
  }
  for (const service of catalog.services.filter(s=>s.navigation==='shared')) {
    if(service.adapter==='razor') {
      const base=`apps/${service.app}`,layout=read(base+'/Pages/Shared/_Layout.cshtml');
      errors.push(...checkPage({service:service.id,entry:base+'/Pages/Shared/_Layout.cshtml'},layout));
      if(!layout.includes('WorkspacePages.Resolve(')||!layout.includes('data-workspace-view='))errors.push(`${base}: Razor metadata binding required`);
      if(!read(base+'/Pages/_ViewStart.cshtml').includes('Layout = "_Layout"'))errors.push(`${base}: shared default layout required`);
      const program=read(base+'/Program.cs');
      if(!program.includes('WorkspacePages.Configure(options)')||!program.includes('app.MapGet("/api/workspace/navigation", WorkspacePages.Navigation).RequireAuthorization()'))errors.push(`${base}: generated Razor routes, policies and protected navigation endpoint required`);
      const systemPages=service.systemPages||[];
      for(const p of systemPages)if(!p.reason?.trim()||!p.entry.startsWith(base+'/Pages/')||p.entry.includes('..')||!/^@page(?:\s|$)/m.test(read(p.entry)))errors.push(`${base}: invalid technical endpoint exception`);
      for(const file of walk(base+'/Pages'))if(file.endsWith('.cshtml')) {
        const body=read(file);
        errors.push(...checkEntityBindings(file,body));
        if(/^@page(?:\s|$)/m.test(body)&&!entries.has(file)&&!systemPages.some(p=>p.entry===file))errors.push(`Unregistered page: ${file}`);
        if(file.endsWith('/_ViewStart.cshtml')&&file!==base+'/Pages/_ViewStart.cshtml')errors.push(`${file}: nested layout overrides prohibited`);
      }
    } else if(service.adapter==='react') {
      const base=`apps/${service.app}/${service.client}`;
      const html=read(`apps/${service.app}/${service.document||service.client+'/index.html'}`), app=read(base+'/App.tsx');
      if(!html.includes(`data-company-service="${service.id}"`)||!html.includes('width=device-width')||!html.includes('company-workspace.js')||!html.includes('company-workspace.css')||(html.match(/data-company-workspace\b/g)||[]).length!==1)errors.push(`${base}: shared responsive header required`);
      if((app.match(/<WorkspaceNavigation\b/g)||[]).length!==1||!app.includes(`service="${service.id}"`)||!app.includes('useWorkspacePage(PAGES)')||!app.includes('Record<View, ReactNode>')||!app.includes('...additionalPages'))errors.push(`${base}: shared React page adapter required`);
      for(const file of walk(base)) {
        if(file.includes('/generated/'))continue;
        const body=read(file);
        errors.push(...checkEntityBindings(file,body));
        if(file.includes('/pages/')&&file.endsWith('.tsx')&&!entries.has(file))errors.push(`Unregistered page: ${file}`);
        if(file.endsWith('.tsx')&&(/<aside\b|data-workspace-navigation=|className="cw-header"|data-cw-(?:logout|panel|theme)=/.test(body)))errors.push(`${file}: page duplicates shared navigation/UI`);
      }
    } else for(const file of walk(`apps/${service.app}/public`)) if(file.endsWith('.html')&&!entries.has(file)) errors.push(`Unregistered page: ${file}`);
  }
  for(const file of walk('packages')) {
    if(!/\.(?:js|mjs|css|tsx|ts)$/.test(file))continue;
    const body=read(file);
    if(/(?:from\s*|import\s*\(|require\s*\()['"][^'"]*apps\//.test(body)) errors.push(`${file}: packages cannot depend on apps`);
    if(file.endsWith('.css')&&!file.endsWith('/company-workspace.css')&&/(?:#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|filter\s*:\s*invert\()/i.test(body)) errors.push(`${file}: use semantic theme tokens`);
  }
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`Architecture: ${catalog.pages.length} registered pages checked; ${catalog.services.filter(s=>s.navigation==='legacy').length} legacy adapters still require migration.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) check();
