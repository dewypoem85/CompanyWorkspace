import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, root } from '../build-ui.mjs';
import { validateCatalog, checkPage, checkRazorPage, checkEntityBindings, checkTaskReview, checkCommentReview, checkSheetConfirmation, checkTaskConfirmation, checkAccountDisclosures, checkPlayerDisclosures, checkPlayerMutations, checkPersonalTodos, checkReleaseEditor, checkReleaseLists, checkDatePickerReads, checkScheduleToolReads, checkTaskReferenceReads, checkSettingsReads, check } from '../check-architecture.mjs';
import { template } from '../create-page.mjs';
import { resolvePublicAsset } from '../../apps/cs/lib/public-assets.js';
import { checkLogSearch } from '../check-architecture.mjs';
import { checkSteamRefunds } from '../check-architecture.mjs';
import { checkProductCommands } from '../check-architecture.mjs';
import { checkScheduleReads } from '../check-architecture.mjs';
import { checkTaskDetailReads } from '../check-architecture.mjs';
import { checkWebhookSettings } from '../check-architecture.mjs';
import { checkHolidayProtocol } from '../check-architecture.mjs';
import { checkLeaveDiscord } from '../check-architecture.mjs';
import { checkStatisticsControls } from '../check-architecture.mjs';
import { checkStatisticsSourcePill } from '../check-architecture.mjs';
import { checkScheduleBoardCheckboxes } from '../check-architecture.mjs';
import { checkScheduleStatePills } from '../check-architecture.mjs';
import { checkPortalCheckboxes } from '../check-architecture.mjs';
import { checkPortalPermissionPills } from '../check-architecture.mjs';
import { checkPortalDashboardPills } from '../check-architecture.mjs';
import { checkLeaveAuditPill } from '../check-architecture.mjs';
import { checkLeaveAdvancePills } from '../check-architecture.mjs';
import { checkLeaveCompletePill } from '../check-architecture.mjs';
import { checkLeaveLegacyStatusPills } from '../check-architecture.mjs';
import { checkLeaveQueueCounts } from '../check-architecture.mjs';
import { checkCsStatePills } from '../check-architecture.mjs';
import { checkSheetConnectionPill } from '../check-architecture.mjs';
import { checkLeaveLegacyNotificationCss } from '../check-architecture.mjs';
import { checkAutomaticFilterNavigation } from '../check-architecture.mjs';

test('Leave automatic employee filters retain shared GET navigation',()=>{
  const parts=['packages/workspace-ui/src/navigation.js','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Admin/Usage.cshtml','packages/contracts/automatic-navigation.md'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkAutomaticFilterNavigation(...parts),[]);
  for(const [index,marker] of [[0,"event.target.closest?.('[data-cw-auto-submit]')"],[0,"form.method.toLowerCase() !== 'get'"],[0,'form.requestSubmit()'],[1,'data-cw-auto-submit'],[2,'data-cw-auto-submit'],[3,'`requestSubmit()`']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkAutomaticFilterNavigation(...changed).length,marker);
  }
  const inline=[...parts];inline[1]=inline[1].replace('data-cw-auto-submit','onchange="this.form.submit()"');
  assert.ok(checkAutomaticFilterNavigation(...inline).some(error=>error.includes('inline native submit')));
});

test('Leave cannot restore its retired header notification UI',()=>{
  const layout=readFileSync(resolve(root,'apps/leave/Pages/Shared/_Layout.cshtml'),'utf8'),css=readFileSync(resolve(root,'apps/leave/wwwroot/css/site.css'),'utf8');
  assert.deepEqual(checkLeaveLegacyNotificationCss(layout,css),[]);
  for(const marker of ['data-company-workspace data-company-service="leave"','<aside class="cw-sidebar"','<main class="cw-main"'])assert.ok(checkLeaveLegacyNotificationCss(layout.replace(marker,'REMOVED'),css).length,marker);
  for(const selector of ['nav-badge','notification-icon-link','notification-popover','popover-head-actions','browser-notification-button'])assert.ok(checkLeaveLegacyNotificationCss(layout,css+`\n.${selector}{display:block}`).length,selector);
  for(const marker of ['.notification-list-panel{','.notification-item{','.notification-actions{'])assert.ok(checkLeaveLegacyNotificationCss(layout,css.replaceAll(marker,'.removed{')).length,marker);
});

test('Sheet connection mode retains shared state-pill ownership',()=>{
  const parts=['apps/sheet/src/client/App.tsx','apps/sheet/src/client/styles.css','packages/workspace-ui/src/company-workspace.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkSheetConnectionPill(...parts),[]);
  for(const [index,marker] of [[0,'className="connection-badge cw-state-pill"'],[0,"data-tone={config.mode === 'google' ? 'success' : 'warning'}"],[0,'className="live-label cw-state-pill" data-tone="success"'],[0,'<i /> READY'],[3,'html body .cw-state-pill[data-tone="success"]'],[3,'html body .cw-state-pill i'],[3,'width:5px']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkSheetConnectionPill(...changed).length,marker);
  }
  for(const [index,skin] of [[1,'.connection-badge.demo{background:red}'],[1,'.connection-badge i{width:7px}'],[1,'.status-pill i{height:7px}'],[1,'.sync-pill i{border-radius:0}'],[1,'.connection-badge{padding:20px}'],[1,'.live-label{font-size:7px}'],[1,'.live-label i{width:7px}'],[2,'.connection-badge.google{color:green}']]){
    const changed=[...parts];changed[index]+='\n'+skin;assert.ok(checkSheetConnectionPill(...changed).length,skin);
  }
});

test('CS status badges retain shared state-pill ownership in every workflow',()=>{
  const parts=[
    ['index.html','player-data.html','playfab-logs.html','product-commands.html'].map(file=>readFileSync(resolve(root,'apps/cs/public/'+file),'utf8')).join('\n'),
    ['app.js','player-data.js','playfab-logs.js','product-commands.js'].map(file=>readFileSync(resolve(root,'apps/cs/public/'+file),'utf8')).join('\n'),
    ['styles.css','theme.css'].map(file=>readFileSync(resolve(root,'apps/cs/public/'+file),'utf8')).join('\n'),
    readFileSync(resolve(root,'packages/workspace-ui/src/primitives.css'),'utf8')
  ];
  assert.deepEqual(checkCsStatePills(...parts),[]);
  for(const id of ['environmentBadge','statusBadge','steamIdMatch','modeBadge','logModeBadge','logJobStatus','productModeBadge','previewBadge']){
    const changed=[...parts];changed[0]=changed[0].replace(new RegExp(`(id=["']${id}["'][^>]*?)cw-state-pill`),'$1private-pill');assert.ok(checkCsStatePills(...changed).length,id);
  }
  for(const [index,marker] of [[1,"elements.environmentBadge.className = 'cw-state-pill'"],[1,'function setStatePill(element, tone)'],[1,'function setProductBadge(element,tone)'],[3,'html body .cw-state-pill[data-tone="warning"]']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkCsStatePills(...changed).length,marker);
  }
  assert.ok(checkCsStatePills(parts[0],parts[1],parts[2]+'\n.badge-warning{color:red}',parts[3]).some(error=>error.includes('private badge')));
});

test('Discord preferences keep shared checkbox ownership and save boundaries',()=>{
  const parts=['apps/leave/wwwroot/js/discord-settings.js','apps/leave/Pages/Settings/Discord.cshtml','apps/leave/Pages/Settings/Discord.cshtml.cs','apps/leave/wwwroot/css/site.css','packages/workspace-ui/src/company-workspace.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkLeaveDiscord(...parts),[]);
  for(const [index,marker] of [[1,'discord-master-check cw-check-control'],[1,'discord-option-card cw-check-control'],[1,'class="cw-checkbox"'],[5,'html body .cw-check-control'],[5,'html body input.cw-checkbox']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkLeaveDiscord(...changed).length,marker);
  }
  for(const skin of ['.discord-option-card:hover{background:red}', '.discord-option-card input{width:24px}']){
    const changed=[...parts];changed[3]+='\n'+skin;assert.ok(checkLeaveDiscord(...changed).some(error=>error.includes('cannot duplicate')),skin);
  }
});

test('statistics filters retain shared checkbox ownership and conditional visibility',()=>{
  const [markup,css,adapter,primitives]=['apps/statistics/public/index.html','apps/statistics/public/styles.css','apps/statistics/public/workspace-adapter.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkStatisticsControls(markup,css,adapter,primitives),[]);
  for(const marker of ['progress-filter cw-check-control','build-detail-toggle cw-check-control hidden','check-label cw-check-control','id="afterFirstMiddleBoss"','id="combinationNodes"','id="bossLinked"','class="cw-checkbox"'])assert.ok(checkStatisticsControls(markup.replace(marker,'REMOVED'),css,adapter,primitives).length,marker);
  assert.ok(checkStatisticsControls(markup,css+'\n.check-label input{width:15px}',adapter,primitives).some(error=>error.includes('cannot duplicate')));
  assert.ok(checkStatisticsControls(markup,css,adapter.replace('.check-label.hidden { display:none!important; }','REMOVED'),primitives).length);
  assert.ok(checkStatisticsControls(markup,css,adapter,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control')).length);
});

test('statistics aggregation states retain shared state-pill ownership',()=>{
  const parts=['apps/statistics/public/index.html','apps/statistics/public/app.js','apps/statistics/public/styles.css','apps/statistics/public/theme.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkStatisticsSourcePill(...parts),[]);
  for(const [index,marker] of [[0,'class="source-badge cw-state-pill"'],[0,'data-source-badge data-tone="neutral"'],[1,"elements.source.dataset.tone=tone"],[4,'html body .cw-state-pill[data-tone="info"]']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkStatisticsSourcePill(...changed).length,marker);
  }
  for(const [index,skin] of [[2,'.source-badge.live{color:green}'],[2,'.source-badge{padding:20px}'],[3,'.source-badge{background:red}']]){
    const changed=[...parts];changed[index]+='\n'+skin;assert.ok(checkStatisticsSourcePill(...changed).length,skin);
  }
});

test('schedule board filters retain shared checkbox ownership and switch semantics',()=>{
  const [app,filters,css,overview,timeline,primitives]=['apps/schedule/src/App.tsx','apps/schedule/src/ScheduleFilterOverlay.tsx','apps/schedule/src/style.css','apps/schedule/src/overview.css','apps/schedule/src/timeline.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkScheduleBoardCheckboxes(app,filters,css,overview,timeline,primitives),[]);
  for(const marker of ['주말 표시</label>','선택한 주만</label>','직원별로 묶기</label>','aria-label="상세 보기"','className="cw-checkbox"','className="view-toggle cw-check-control"','role="switch"'])assert.ok(checkScheduleBoardCheckboxes(app,filters.replace(marker,'REMOVED'),css,overview,timeline,primitives).length,marker);
  assert.ok(checkScheduleBoardCheckboxes(app,filters,css+'.filters label:where(:not(.cw-form-field)){display:flex}',overview,timeline,primitives).length);
  assert.ok(checkScheduleBoardCheckboxes(app,filters,css,overview+'.schedule-workspace .filters>label:where(:not(.cw-form-field)){color:red}',timeline,primitives).length);
  assert.ok(checkScheduleBoardCheckboxes(app,filters,css,overview,timeline+'\n.view-toggle input{width:16px}',primitives).length);
  assert.ok(checkScheduleBoardCheckboxes(app,filters,css,overview,timeline,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control')).length);
});

test('Schedule demo and today indicators retain shared state-pill ownership',()=>{
  const parts=['apps/schedule/src/App.tsx','apps/schedule/src/WeekBoard.tsx','apps/schedule/src/style.css','apps/schedule/src/timeline.css','apps/schedule/src/theme.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkScheduleStatePills(...parts),[]);
  for(const [index,marker] of [[0,'className="demo-badge cw-state-pill" data-tone="warning"'],[1,'className="today-badge cw-state-pill" data-tone="info"'],[1,'className="status-badge cw-state-pill" data-tone="info"'],[5,'html body .cw-state-pill[data-tone="warning"]']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkScheduleStatePills(...changed).length,marker);
  }
  for(const [index,skin] of [[2,'.day-header small{padding:20px}'],[2,'.demo-badge{color:red}'],[2,'.status-badge{background:red}'],[3,'.range-board .day-header small{color:red}'],[4,'html[data-theme="dark"] .status-badge{color:white}']]){
    const changed=[...parts];changed[index]+='\n'+skin;assert.ok(checkScheduleStatePills(...changed).length,skin);
  }
});

test('Portal account and organization checkboxes retain shared ownership',()=>{
  const parts=['apps/portal/Pages/Shared/_AccountField.cshtml','apps/portal/Pages/Admin/Users.cshtml','apps/portal/Pages/Admin/Organization.cshtml','apps/portal/wwwroot/css/organization.css','apps/portal/wwwroot/css/site.css','apps/portal/wwwroot/css/account-management.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkPortalCheckboxes(...parts),[]);
  for(const [index,marker] of [[0,'account-projects cw-choice-group'],[0,'account-privacy cw-check-control'],[0,'permission-switch cw-switch-control'],[0,'Model.Compact ? "cw-switch" : "cw-checkbox"'],[0,'class="cw-switch-track"'],[1,'permission-switch fixed leave-employee-access cw-switch-control'],[2,'fieldset class="cw-choice-group"'],[2,'organization-check cw-check-control'],[6,'html body .cw-check-control'],[6,'html body .cw-choice-group input[type="checkbox"]'],[6,'html body .cw-switch-control'],[6,'html body input.cw-switch:checked + .cw-switch-track']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkPortalCheckboxes(...changed).length,marker);}
  for(const [index,skin] of [[3,'.organization-check input{width:17px}'],[4,'.option-card:hover{background:red}'],[5,'.account-privacy input{accent-color:red}'],[4,'.permission-switch input{width:17px}'],[5,'.access-matrix-form .permission-switch{display:grid}']]){const changed=[...parts];changed[index]+='\n'+skin;assert.ok(checkPortalCheckboxes(...changed).length,skin);}
});

test('Portal read-only account and permission results retain shared state-pill ownership',()=>{
  const parts=['apps/portal/Pages/Admin/Users.cshtml','apps/portal/wwwroot/css/site.css','apps/portal/wwwroot/css/account-management.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkPortalPermissionPills(...parts),[]);
  for(const [index,marker] of [[0,'account-type-badge employee cw-state-pill" data-tone="info"'],[0,'status cw-state-pill" data-tone="@(user.IsActive ? "success" : "neutral")"'],[0,'permission-result allowed cw-state-pill" data-tone="info">기본'],[0,'permission-result denied leave-shared-excluded cw-state-pill" data-tone="neutral"'],[1,'.access-matrix-form .leave-shared-excluded { display: none; }'],[3,'html body .cw-state-pill[data-tone="success"]'],[3,'html body .cw-state-pill[data-tone="neutral"]']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkPortalPermissionPills(...changed).length,marker);
  }
  for(const [index,skin] of [[1,'.account-type-badge.employee{color:red}'],[1,'.permission-result{padding:20px}'],[1,'.status.active{background:green}'],[2,'.permission-result.denied{background:gray}']]){
    const changed=[...parts];changed[index]+='\n'+skin;assert.ok(checkPortalPermissionPills(...changed).length,skin);
  }
});

test('Portal dashboard service states retain shared state-pill ownership',()=>{
  const parts=['apps/portal/Pages/Index.cshtml','apps/portal/wwwroot/css/site.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkPortalDashboardPills(...parts),[]);
  for(const [index,marker] of [[0,'service-count cw-state-pill" data-tone="success"'],[0,'system-status cw-state-pill" data-tone="success">사용 가능'],[0,'system-status admin cw-state-pill" data-tone="warning">관리자'],[2,'html body .cw-state-pill[data-tone="success"]'],[2,'html body .cw-state-pill[data-tone="warning"]'],[2,'html body .cw-state-pill i']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkPortalDashboardPills(...changed).length,marker);
  }
  for(const skin of ['.system-status{padding:20px}','.system-status.admin{color:orange}','.service-count{font-size:20px}','.service-count i{width:10px}']){
    const changed=[...parts];changed[1]+='\n'+skin;assert.ok(checkPortalDashboardPills(...changed).length,skin);
  }
});

test('Leave audit action retains shared state-pill ownership',()=>{
  const parts=['apps/leave/Pages/Admin/AuditLogs.cshtml','apps/leave/wwwroot/css/audit-logs.css','apps/leave/wwwroot/css/site.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8')),check=values=>checkLeaveAuditPill(values[0],values[1]+'\n'+values[2],values[3]);
  assert.deepEqual(check(parts),[]);
  for(const [index,marker] of [[0,'audit-action-pill cw-state-pill" data-tone="info"'],[3,'html body .cw-state-pill[data-tone="info"]']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(check(changed).length,marker);}
  for(const index of [1,2]){const changed=[...parts];changed[index]+='\n.audit-action-pill{background:red}';assert.ok(check(changed).length);}
});

test('Leave advance states retain shared warning-pill ownership',()=>{
  const parts=['apps/leave/Pages/Admin/Index.cshtml','apps/leave/Pages/Admin/_ApprovalQueues.cshtml','apps/leave/Pages/Leave/Index.cshtml','apps/leave/wwwroot/css/site.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkLeaveAdvancePills(...parts),[]);
  for(const [index,marker] of [[0,'advance-badge cw-state-pill" data-tone="warning"'],[1,'advance-badge cw-state-pill" data-tone="warning"'],[2,'advance-badge cw-state-pill" data-tone="warning"'],[2,'advance-badge detail-advance-badge cw-state-pill" data-tone="warning"'],[4,'html body .cw-state-pill[data-tone="warning"]']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkLeaveAdvancePills(...changed).length,marker);}
  for(const skin of ['.advance-badge{background:red}','html[data-theme="dark"] .advance-badge{color:orange}']){const changed=[...parts];changed[3]+='\n'+skin;assert.ok(checkLeaveAdvancePills(...changed).length,skin);}
});

test('Leave completed-use state retains shared neutral-pill ownership',()=>{
  const parts=['apps/leave/Pages/Leave/Index.cshtml','apps/leave/wwwroot/css/site.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkLeaveCompletePill(...parts),[]);
  for(const [index,marker] of [[0,'request-complete-label cw-state-pill" data-tone="neutral">사용 완료'],[2,'html body .cw-state-pill[data-tone="neutral"]']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkLeaveCompletePill(...changed).length,marker);}
  for(const skin of ['.request-complete-label{background:red}','.request-complete-label{font-weight:900}']){const changed=[...parts];changed[1]+='\n'+skin;assert.ok(checkLeaveCompletePill(...changed).length,skin);}
});

test('Leave removes legacy status-pill skins and keeps its mobile preview on shared states',()=>{
  const parts=['apps/leave/wwwroot/css/site.css','apps/leave/scripts/preview-mobile.mjs','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkLeaveLegacyStatusPills(...parts),[]);
  for(const [index,marker] of [[1,'class="cw-state-pill" data-tone="success">승인'],[1,'request-complete-label cw-state-pill" data-tone="neutral">사용 완료'],[2,'html body .cw-state-pill[data-tone="success"]']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkLeaveLegacyStatusPills(...changed).length,marker);}
  for(const skin of ['.status-pill{padding:5px}','.event-chip.approved,.status-pill.approved{color:green}']){const changed=[...parts];changed[0]+='\n'+skin;assert.ok(checkLeaveLegacyStatusPills(...changed).length,skin);}
});

test('Leave approval queue counts retain shared count-badge ownership',()=>{
  const parts=['apps/leave/Pages/Admin/_ApprovalQueues.cshtml','apps/leave/wwwroot/css/site.css','apps/leave/wwwroot/css/approval-forms.css','packages/workspace-ui/src/primitives.css'].map(path=>readFileSync(resolve(root,path),'utf8')),check=values=>checkLeaveQueueCounts(values[0],values[1]+'\n'+values[2],values[3]);
  assert.deepEqual(check(parts),[]);
  for(const [index,marker] of [[0,'section-count cw-count-badge'],[3,'html body .cw-count-badge']]){const changed=[...parts];changed[index]=changed[index].replace(marker,'REMOVED');assert.ok(check(changed).length,marker);}
  for(const [index,skin] of [[1,'.section-count{padding:20px}'],[1,'html[data-theme="dark"] .section-count{color:white}'],[2,'.section-count{background:red}']]){const changed=[...parts];changed[index]+='\n'+skin;assert.ok(check(changed).length,skin);}
});

test('holiday protocol preserves all write checks, full receipts and native unknown recovery',()=>{
  const parts=['apps/leave/Pages/Admin/Holidays.cshtml','apps/leave/Pages/Admin/Holidays.cshtml.cs','apps/leave/Pages/Admin/Holidays.Protocol.cs','apps/leave/wwwroot/js/holiday-settings.js','apps/leave/wwwroot/js/holiday-contract.js','packages/workspace-ui/src/primitives.css','apps/leave/wwwroot/css/site.css'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkHolidayProtocol(...parts),[]);
  for(const [index,marker] of [[0,'data-holiday-recheck'],[0,'holiday-settings.js'],[1,'await CheckTargetAsync()'],[2,'expectedStateToken'],[2,'jsonHash'],[2,'snapshot = Snapshot()'],[2,'Locked = outcome != "invalid"'],[3,'session.begin('],[3,'CompanyForm.attach('],[3,'CompanyDialog.confirm('],[3,'controller.dispose()'],[4,'oldIds = new Set('],[4,'!oldIds.has(saved.id)']]){
    const changed=[...parts];changed[index]=changed[index].replace(marker,'REMOVED');assert.ok(checkHolidayProtocol(...changed).length,marker);
  }
  const exposed=[...parts];exposed[1]+='\nError=ex.Message;';assert.ok(checkHolidayProtocol(...exposed).length);
  const raw=[...parts];raw[3]+='\nfetch("/raw");';assert.ok(checkHolidayProtocol(...raw).length);
  for(const [index,marker] of [[0,'holiday-overwrite-check cw-check-control'],[0,'class="cw-checkbox"'],[5,'html body .cw-check-control'],[5,'html body input.cw-checkbox']]){const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkHolidayProtocol(...changed).length,marker);}
  const privateSkin=[...parts];privateSkin[6]+='\n.holiday-overwrite-check{background:red}';assert.ok(checkHolidayProtocol(...privateSkin).some(error=>error.includes('cannot duplicate')));
});

test('webhook settings cannot drop common transport, confirmation or checked recipient contract',()=>{
  const parts=['apps/leave/Pages/Admin/NotificationSettings.cshtml','apps/leave/wwwroot/js/webhook-settings.js','apps/leave/Pages/Admin/NotificationSettings.cshtml.cs'].map(path=>readFileSync(resolve(root,path),'utf8'));
  assert.deepEqual(checkWebhookSettings(...parts),[]);
  for(const [index,marker] of [[0,'webhook-settings.js'],[1,'CompanyForm.createSession()'],[1,'session.begin('],[1,'CompanyForm.attach('],[1,'CompanyDialog.confirm('],[1,'context.isCurrent()'],[1,'controller.dispose()'],[2,'expectedStateToken'],[2,'SendTestAsync(actor,Webhooks)']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkWebhookSettings(...changed).length,marker);
  }
  assert.ok(checkWebhookSettings(parts[0],parts[1]+'\nfetch("/raw");',parts[2]).length);
});

test('task detail cannot restore private polling or omit full target and scope checks',()=>{
  const parts=['apps/schedule/src/TaskPanel.tsx','apps/schedule/src/useTaskDetail.ts','apps/schedule/src/scheduleReads.ts','apps/schedule/src/CommentComposer.tsx'].map(read);
  assert.deepEqual(checkTaskDetailReads(...parts),[]);
  for(const [index,marker] of [[0,'useTaskDetail('],[0,'readBlocked={reads.invalid}'],[1,"run('detail'"],[1,'result.isCurrent()'],[1,'epoch.current===generation'],[1,'pending.current===ticket'],[1,'start.refreshIdentity()'],[1,'.dispose()'],[2,'d.task.id===expectedId'],[2,'byId.has(c.parentId)'],[2,'a.taskId===expectedId'],[2,'comments.get(c.id)!.version>=c.version'],[3,'await readDetail()'],[3,'identity.current===commentActorScope(boot.me)']]){
    const changed=[...parts];changed[index]=changed[index].replaceAll(marker,'REMOVED');assert.ok(checkTaskDetailReads(...changed).length,marker);
  }
  assert.ok(checkTaskDetailReads(parts[0]+';setInterval(read,30000)',parts[1],parts[2],parts[3]).length);
  assert.ok(checkTaskDetailReads(parts[0],parts[1]+';fetch("/raw")',parts[2],parts[3]).length);
  assert.ok(checkTaskDetailReads(parts[0],parts[1],parts[2],parts[3]+';api<Detail>("/raw")').length);
});

test('schedule board cannot drop common read observation, identity validation or full response checks',()=>{
  const view=read('apps/schedule/src/App.tsx'),lifecycle=read('apps/schedule/src/useScheduleData.ts'),transport=read('apps/schedule/src/scheduleReads.ts'),legacy=read('apps/schedule/src/api.ts');
  assert.deepEqual(checkScheduleReads(view,lifecycle,transport,legacy),[]);
  for(const marker of ['createWorkspaceReadSession()',"run('bootstrap'","run('board'",'scopeEpoch.current!==epoch','verifiedEpoch.current===epoch','boardFailed.current','.dispose()'])assert.ok(checkScheduleReads(view,lifecycle.replaceAll(marker,'REMOVED'),transport,legacy).length,marker);
  for(const marker of ['taskListResponse','bootstrapResponse','absencesResponse','milestoneResponse','response.redirected','next.total===first.total'])assert.ok(checkScheduleReads(view,lifecycle,transport.replaceAll(marker,'REMOVED'),legacy).length,marker);
  assert.ok(checkScheduleReads(view+";api('/api/bootstrap')",lifecycle,transport,legacy).length);
  assert.ok(checkScheduleReads(view,lifecycle,transport+';location.assign("/auth")',legacy).length);
  for(const restored of ['export async function api(){}','fetch("/api/tasks")','let csrf=""; export function setCsrf(){}'])assert.ok(checkScheduleReads(view,lifecycle,transport,legacy+'\n'+restored).length,restored);
});

test('product commands cannot bypass common confirmation, response checks or uncertain write locks',()=>{
  const body=read('apps/cs/public/product-commands.js'),markup=read('apps/cs/public/product-commands.html'),css=read('apps/cs/public/product-commands.css'),baseCss=read('apps/cs/public/styles.css'),primitives=read('packages/workspace-ui/src/primitives.css'),spec=read('packages/contracts/cs-product-command-reads.md');
  assert.deepEqual(checkProductCommands(body,markup,css,baseCss,primitives,spec),[]);
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDialog.confirm(', 'window.CompanyClipboard.copyText(', 'validateProductConfig(', 'validateProductPreview(', 'validateProductExecution(', 'validateProductLookup(', 'validateProductDeletion(', 'validateInteraction(', 'state.writeUncertain', 'readAfterDeletion(', 'assertCurrent(operation)', 'state.operation!==operation', 'workspace-entity-scope-change', 'prettyPrintJsonLossless(text)', 'state.lastExecutionDryRun'])assert.ok(checkProductCommands(body.replaceAll(marker,'bypass'),markup,css,baseCss,primitives,spec).length,marker);
  for(const privateCopy of ["function copyText(value){}","document.createElement('textarea')",'navigator.clipboard.writeText("x")'])assert.ok(checkProductCommands(body+privateCopy,markup,css,baseCss,primitives).some(error=>error.includes('clipboard')),privateCopy);
  assert.ok(checkProductCommands(body+'window.confirm("write")',markup,css,baseCss,primitives).length);
  assert.ok(checkProductCommands(body,markup+'<dialog></dialog>',css,baseCss,primitives).length);
  assert.ok(checkProductCommands(body,markup,css+'\n.invalid{background:#fff}',baseCss,primitives).length);
  for(const marker of ['<fieldset id="productFields"','id="productMessageBox" hidden','id="manageMessageBox" hidden'])assert.ok(checkProductCommands(body,markup.replace(marker,'bypass'),css,baseCss,primitives).length,marker);
  assert.ok(checkProductCommands(body,markup.replaceAll('confirm-check compact-check cw-check-control','confirm-check compact-check'),css,baseCss,primitives).length);
  assert.ok(checkProductCommands(body,markup.replaceAll('class="cw-checkbox"',''),css,baseCss,primitives).length);
  assert.ok(checkProductCommands(body,markup,css,baseCss+'\n.confirm-check input{width:17px}',primitives).some(error=>error.includes('cannot duplicate')));
  assert.ok(checkProductCommands(body,markup,css,baseCss,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control'),spec).length);
});

test('Steam refunds retain common confirmations, verified receipts and scope-safe reads',()=>{
  const body=read('apps/cs/public/app.js'),markup=read('apps/cs/public/index.html'),css=read('apps/cs/public/steam-refunds.css'),spec=read('packages/contracts/cs-steam-refund-reads.md');
  assert.deepEqual(checkSteamRefunds(body,markup,css,spec),[]);
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDialog.confirm(', 'validateSteamConfig(', 'validateSteamQuery(', 'validateSteamRefund(', 'steamTransactionSignature(', 'inputSignature() !== signature', 'readAfterRefund(', 'state.receipts.set(', 'state.receipts.has(', 'assertCurrent(operation)', 'state.operation !== operation', 'workspace-entity-scope-change'])assert.ok(checkSteamRefunds(body.replaceAll(marker,'bypass'),markup,css,spec).length,marker);
  assert.ok(checkSteamRefunds(body+'window.confirm("refund")',markup,css,spec).length);
  assert.ok(checkSteamRefunds(body+'window.CsToast.show()',markup,css,spec).length);
  assert.ok(checkSteamRefunds(body,markup,css+'\n#refundCard{background:#fff}',spec).length);
  for(const marker of ['id="queryFields"','id="refundFields"','id="steamMessageBox" hidden','class="cw-data-table"'])assert.ok(checkSteamRefunds(body,markup.replace(marker,'bypass'),css,spec).length,marker);
});
const read=file=>readFileSync(resolve(root,file),'utf8');
const catalog={...JSON.parse(read('packages/contracts/services.json')),...JSON.parse(read('packages/contracts/pages.json'))};

test('generated assets and registered adapters match their canonical sources',()=>{ build(true); check(); });
test('log search cannot bypass shared feedback, disclosure, job identity or semantic colors',()=>{
  const body=read('apps/cs/public/playfab-logs.js'),markup=read('apps/cs/public/playfab-logs.html'),css=read('apps/cs/public/playfab-logs.css'),primitives=read('packages/workspace-ui/src/primitives.css'),spec=read('packages/contracts/cs-log-search-reads.md');
  assert.deepEqual(checkLogSearch(body,markup,css,primitives,spec),[]);
  for(const marker of ['window.CompanyState.render(', 'window.CompanyDisclosure.attach(', 'validateLogJob(', 'validateLogConfig(', 'assertCurrent(operation)', 'state.operation !== operation', 'workspace-entity-scope-change', 'state.startUncertain', 'onAction: resumeSavedJob', 'prettyPrintJsonLossless(text)'])assert.ok(checkLogSearch(body.replaceAll(marker,'bypass'),markup,css,primitives,spec).length,marker);
  assert.ok(checkLogSearch(body+'window.CsToast.show()',markup,css,primitives,spec).length);
  assert.ok(checkLogSearch(body,markup,css+'\n.log-result{background:#fff}',primitives,spec).length);
  assert.ok(checkLogSearch(body,markup.replace('id="logMessageBox" hidden','id="logMessageBox"'),css,primitives,spec).length);
  assert.ok(checkLogSearch(body,markup.replace('long-range-confirmation cw-check-control','long-range-confirmation'),css,primitives,spec).length);
  assert.ok(checkLogSearch(body,markup.replace('id="confirmLongRange" class="cw-checkbox"','id="confirmLongRange"'),css,primitives,spec).length);
  assert.ok(checkLogSearch(body,markup,css+'\n.long-range-confirmation{background:red}',primitives,spec).some(error=>error.includes('cannot duplicate')));
  assert.ok(checkLogSearch(body,markup,css+'\n.long-range-confirmation small{color:red}',primitives,spec).some(error=>error.includes('cannot duplicate')));
  assert.ok(checkLogSearch(body,markup,css,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control'),spec).length);
});

test('release lists cannot restore private disclosure, palette or unverified reads',()=>{
  const view=read('apps/schedule/src/Releases.tsx'),actions=read('apps/schedule/src/useReleaseList.ts'),css=read('apps/schedule/src/timeline.css'),primitives=read('packages/workspace-ui/src/primitives.css'),spec=read('packages/contracts/schedule-release-reads.md');
  assert.deepEqual(checkReleaseLists(view,actions,css,primitives,spec),[]);
  for(const marker of ['useWorkspaceDisclosure(', 'useReleaseList<', '<ReleaseListState', 'data-cw-disclosure-panel=', 'cw-table-detail'])assert.ok(checkReleaseLists(view.replaceAll(marker,'bypass'),actions,css,primitives).length);
  for(const marker of ['releaseSeriesPage=', 'releaseRecordsPage=', 'releaseProjectPage=', 'releaseReferenceResponse(', 'releaseRevisionPage=', 'createWorkspaceReadSession()', 'scheduleGet(', 'workspace-entity-scope-change', "session.current?.cancel('release-list')", 'session.current?.dispose()', 'current===generation.current', 'if(requireSuccess)throw cause'])assert.ok(checkReleaseLists(view,actions.replaceAll(marker,'bypass'),css,primitives).length);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel(channel)", "readValue('release-target'", "readValue('release-resolved'", "readValue('release-targets'", "readValue('release-history'", 'releaseReferenceResponse(value,id,form.projectId)', 'releaseProjectPage(value,form.projectId)', 'releaseRevisionPage(value,{id:form.id!,projectId:form.projectId})'])assert.ok(checkReleaseLists(view.replaceAll(marker,'bypass'),actions,css,primitives).length);
  assert.ok(checkReleaseLists(view+"\napi('/api/releases/1')",actions,css,primitives).length);
  for(const marker of ['`release-list`', '`release-target`', '`release-resolved`', '`release-targets`', '`release-history`', '401/403', '`schedule-release-writes.md`'])assert.ok(checkReleaseLists(view,actions,css,primitives,spec.replaceAll(marker,'bypass')).length,marker);
  for(const marker of ['className="release-status cw-state-pill"', "status === 'stable' ? 'success'", "status === 'unrecorded' ? 'neutral' : 'danger'", 'data-tone={tone}', 'data-tone="success"'])assert.ok(checkReleaseLists(view.replaceAll(marker,'bypass'),actions,css,primitives).length,marker);
  assert.ok(checkReleaseLists(view+'<details>',actions,css,primitives).length);for(const skin of ['.release-status{background:#fff}','.release-status.unstable{padding:20px}'])assert.ok(checkReleaseLists(view,actions,css+'\n'+skin,primitives).length,skin);
  assert.ok(checkReleaseLists(view,actions,css,primitives.replace('html body .cw-state-pill[data-tone="neutral"]','REMOVED')).length);
});

test('release forms cannot bypass common review, scope and acknowledged-save boundaries',()=>{
  const view=read('apps/schedule/src/Releases.tsx'),actions=read('apps/schedule/src/useReleaseEditor.ts');assert.deepEqual(checkReleaseEditor(view,actions),[]);
  for(const marker of ['async function requestDiscard(', 'confirmWorkspaceAction(', 'JSON.stringify(baseline.current)===before', 'signal.addEventListener', 'return intent&&stable()?approve:null', 'const approve=()=>stable()&&!locked.current'])assert.ok(checkReleaseEditor(view,actions.replaceAll(marker,'bypass')).length);
  for(const marker of ['useReleaseEditor(', '<WorkspaceState', 'edit.save()', 'edit.review()', 'edit.refreshList()', 'load(false,true)', 'edit.unavailable'])assert.ok(checkReleaseEditor(view.replaceAll(marker,'bypass'),actions).length);
  for(const marker of ['openWorkspaceReview(', 'applyReleaseReview(', 'currentRelease(', 'workspace-entity-scope-change', 'useWorkspaceNavigationRequest(requestDiscard)', 'blockedRef.current', 'valid(generation,actor,captured)'])assert.ok(checkReleaseEditor(view,actions.replaceAll(marker,'bypass')).length);
  assert.ok(checkReleaseEditor(view+'setForm(latest)',actions).length);
});

test('TODO cannot drop shared confirmation, response checks, navigation guards or theme tokens',()=>{
  const view=read('apps/schedule/src/PersonalTodos.tsx'),actions=read('apps/schedule/src/usePersonalTodos.ts'),css=read('apps/schedule/src/todos.css'),primitives=read('packages/workspace-ui/src/primitives.css'),spec=read('packages/contracts/schedule-todo-reads.md');
  assert.deepEqual(checkPersonalTodos(view,actions,css,primitives,spec),[]);
  for(const marker of ['usePersonalTodos(', '<WorkspaceState', '<fieldset', 'todoSignature('])assert.ok(checkPersonalTodos(view.replaceAll(marker,'bypass'),actions,css,primitives).length);
  for(const marker of ['disabled={disabled||editor?.item.id===item.id}', 'onClick={()=>void todos.edit(item)}', 'onClick={()=>void todos.switchTab(true)}', 'className="todo-check-control cw-check-control"', 'className="todo-check cw-checkbox"'])assert.ok(checkPersonalTodos(view.replaceAll(marker,'bypass'),actions,css,primitives).length,marker);
  for(const marker of ['confirmWorkspaceAction(', 'validateTodoList(', 'workspace-entity-scope-change', 'useWorkspaceNavigationRequest(requestTodoNavigationDiscard)', 'blocked.current', 'completed.current'])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('personal-todos')", 'readSession.current?.dispose()', "session.run('personal-todos'", 'scheduleGet(`/api/personal-todos?archived=${tab}`'])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length,marker);
  assert.ok(checkPersonalTodos(view,actions+"\napi(`/api/personal-todos?archived=false`)",css,primitives).length);
  for(const marker of ['`personal-todos`', '`WorkspaceReadSession`', '`scheduleGet`', 'POST/PUT/PATCH/DELETE'])assert.ok(checkPersonalTodos(view,actions,css,primitives,spec.replaceAll(marker,'bypass')).length,marker);
  for(const marker of ['async function requestTodoNavigationDiscard(', 'navigationDiscardRequest.current', "title:'작성 중인 TODO를 버리고 이동할까요?'", "label:'새 TODO'", "label:'TODO 수정'", "value:source==='history'?'브라우저 이전·다음':'사이드바·링크'", 'return intent&&stable()&&!abort.signal.aborted?stable:null'])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length,marker);
  assert.ok(checkPersonalTodos(view,actions.replace('async function requestTodoNavigationDiscard(' ,"confirm('작성 중인 TODO 내용을 닫을까요? 저장하지 않은 내용은 사라집니다.');\nasync function requestTodoNavigationDiscard("),css,primitives).some(error=>error.includes('page navigation')));
  for(const marker of ['async function cancelEdit()', 'editCancelRequest.current', "title:'TODO 수정을 취소할까요?'", 'todoSignature(live.current.editor!.item)', 'if(intent&&stable())setEditor(null)'])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length,marker);
  assert.ok(checkPersonalTodos(view,actions.replace('async function cancelEdit()',"confirm('TODO 수정 내용을 취소할까요?');\nasync function cancelEdit()"),css,primitives).some(error=>error.includes('edit cancellation')));
  for(const marker of ['async function edit(item:PersonalTodo)', 'editSwitchRequest.current', "title:'다른 TODO를 수정할까요?'", 'live.current.items.some(value=>todoSignature(value)===targetSignature)', 'if(intent&&stable())setEditor({item:target,draft:target.title})'])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length,marker);
  assert.ok(checkPersonalTodos(view,actions.replace('async function edit(item:PersonalTodo)',"confirm('현재 TODO 수정 내용을 버릴까요?');\nasync function edit(item:PersonalTodo)"),css,primitives).some(error=>error.includes('edit switching')));
  for(const marker of ['async function switchTab(next:boolean)', 'tabSwitchRequest.current', "title:'TODO 목록을 전환할까요?'", 'if(intent&&stable())applyTabSwitch(next)', "value:next?'보관함':'할 일'"])assert.ok(checkPersonalTodos(view,actions.replaceAll(marker,'bypass'),css,primitives).length,marker);
  assert.ok(checkPersonalTodos(view,actions.replace('async function switchTab(next:boolean)',"confirm('편집 중인 TODO를 닫고 목록을 전환할까요?');\nasync function switchTab(next:boolean)"),css,primitives).some(error=>error.includes('tab switching')));
  assert.ok(checkPersonalTodos(view+'confirm("delete")',actions,css,primitives).length);
  assert.ok(checkPersonalTodos(view,actions,css+' .todo-item{background:#fff}',primitives).length);
  assert.ok(checkPersonalTodos(view,actions,css+' .todo-check{width:19px}',primitives).length);
  assert.ok(checkPersonalTodos(view,actions,css,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control')).length);
});

test('DatePicker holiday reads cannot bypass common cancellation or response validation',()=>{
  const view=read('apps/schedule/src/DatePicker.tsx'),spec=read('packages/contracts/schedule-date-picker-reads.md');
  assert.deepEqual(checkDatePickerReads(view,spec),[]);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('date-picker-holidays')", 'readSession.current?.dispose()', "session.run('date-picker-holidays'", 'scheduleGet(`/api/absences?from=${from}&to=${to}`, signal, absencesResponse)', 'workspace-entity-scope-change', "result.status === 'cancelled'", '!result.isCurrent()'])assert.ok(checkDatePickerReads(view.replaceAll(marker,'bypass'),spec).length,marker);
  assert.ok(checkDatePickerReads(view+"\napi<Absences>(`/api/absences?from=x&to=y`)",spec).length);
  for(const marker of ['`date-picker-holidays`', '`WorkspaceReadSession`', '`scheduleGet`', '`absencesResponse`', '`workspace-entity-scope-change`', '42번째'])assert.ok(checkDatePickerReads(view,spec.replaceAll(marker,'bypass')).length,marker);
});

test('schedule tool task opening cannot bypass common scope or detail validation',()=>{
  const view=read('apps/schedule/src/App.tsx'),spec=read('packages/contracts/schedule-tool-reads.md');
  assert.deepEqual(checkScheduleToolReads(view,spec),[]);
  for(const marker of ['registerScheduleTools(', 'createWorkspaceReadSession()', "session.cancel('webmcp-task-open')", "session.run('webmcp-task-open'", 'scheduleGet(`/api/tasks/${id}`,signal,value=>taskDetailResponse(value,id))', 'workspace-entity-scope-change', "result.status==='cancelled'", '!result.isCurrent()', 'session.dispose()'])assert.ok(checkScheduleToolReads(view.replaceAll(marker,'bypass'),spec).length,marker);
  assert.ok(checkScheduleToolReads(view+"\napi(`/api/tasks/${id}`)",spec).length);
  for(const marker of ['`open_schedule_task`', '`webmcp-task-open`', '`WorkspaceReadSession`', '`scheduleGet`', '`taskDetailResponse`', '`workspace-entity-scope-change`'])assert.ok(checkScheduleToolReads(view,spec.replaceAll(marker,'bypass')).length,marker);
});

test('schedule task references cannot bypass common scope, cache invalidation or response validation',()=>{
  const view=read('apps/schedule/src/TaskLinks.tsx'),panel=read('apps/schedule/src/TaskPanel.tsx'),transport=read('apps/schedule/src/scheduleReads.ts'),spec=read('packages/contracts/schedule-task-reference-reads.md');
  assert.deepEqual(checkTaskReferenceReads(view,panel,transport,spec),[]);
  for(const marker of ['createWorkspaceReadSession()', 'session.current?.cancel(`task-reference:${id}`)', 'reader.run(', '`task-reference:${id}`', 'scheduleGet(`/api/tasks/${id}/reference`, signal, value => taskReferenceResponse(value, id))', 'workspace-entity-scope-change', "result.status === 'cancelled'", 'owner !== generation.current', '!result.isCurrent()', 'requests.current.delete(id)', 'context.scope'])assert.ok(checkTaskReferenceReads(view.replaceAll(marker,'bypass'),panel,transport,spec).length,marker);
  assert.ok(checkTaskReferenceReads(view,panel.replaceAll('enabled={!reads.invalid}','enabled'),transport,spec).length);
  for(const marker of ['export function taskReferenceResponse(', 'reference.id===expectedId', 'nullableId(reference.projectId)', 'bool(reference.archived)'])assert.ok(checkTaskReferenceReads(view,panel,transport.replaceAll(marker,'bypass'),spec).length,marker);
  assert.ok(checkTaskReferenceReads(view+"\napi<Reference>(`/api/tasks/${id}/reference`)",panel,transport,spec).length);
  for(const marker of ['`task-reference:${id}`', '`WorkspaceReadSession`', '`scheduleGet`', '`taskReferenceResponse`', '`workspace-entity-scope-change`'])assert.ok(checkTaskReferenceReads(view,panel,transport,spec.replaceAll(marker,'bypass')).length,marker);
});

test('schedule management reads cannot bypass common scope, validation or archive pagination',()=>{
  const view=read('apps/schedule/src/Settings.tsx'),transport=read('apps/schedule/src/scheduleReads.ts'),spec=read('packages/contracts/schedule-settings-reads.md');
  assert.deepEqual(checkSettingsReads(view,transport,spec),[]);
  for(const marker of ['createWorkspaceReadSession()', "readSession.current?.cancel('settings-milestones')", "readSession.current?.cancel('settings-history')", "readSession.current?.cancel('settings-archive')", 'readSession.current?.dispose()', "session.run<{items:Milestone[];page:MilestonePage|undefined}>(channel", "session.run('settings-history'", "session.run('settings-archive'", 'workspace-entity-scope-change', 'generation===readGeneration.current', 'milestoneRevisionResponse', 'archivedTaskPageResponse', 'mergeTaskListPages(start,result.value)'])assert.ok(checkSettingsReads(view.replaceAll(marker,'bypass'),transport,spec).length,marker);
  for(const marker of ['export function archivedTaskPageResponse(', 'page.items.every(item=>item.archived)', 'export function mergeTaskListPages(', 'next.total===previous.total', '!next.items.some(', 'merged.items.length<=merged.total', 'taskListResponse(merged)'])assert.ok(checkSettingsReads(view,transport.replaceAll(marker,'bypass'),spec).length,marker);
  assert.ok(checkSettingsReads(view+"\napi(`/api/tasks?archived=true`)",transport,spec).length);
  for(const marker of ['`settings-milestones`', '`settings-history`', '`settings-archive`', '`WorkspaceReadSession`', '`scheduleGet`', '`milestonePageResponse`', '`milestoneRevisionResponse`', '`archivedTaskPageResponse`', '`mergeTaskListPages`'])assert.ok(checkSettingsReads(view,transport,spec.replaceAll(marker,'bypass')).length,marker);
});

test('CS mutation confirmation, scope and acknowledgement boundaries cannot be bypassed',()=>{
  const body=read('apps/cs/public/player-data.js'),markup=read('apps/cs/public/player-data.html'),css=read('apps/cs/public/player-data.css'),primitives=read('packages/workspace-ui/src/primitives.css'),spec=read('packages/contracts/cs-player-data-reads.md');
  assert.deepEqual(checkPlayerMutations(body,markup,css,primitives,spec),[]);
  for(const marker of ['window.CompanyDialog.confirm(', 'window.CompanyDialog.present(', 'window.CompanyState.render(',
    'validateMutationResult(action, request,', 'validatePlayerLookup(', 'assertCurrentScope(scope)', 'readAfterMutation(',
    "runMutation('save'", "runMutation('add'", "runMutation('delete'", 'state.mutationBlocked'])
    assert.ok(checkPlayerMutations(body.replaceAll(marker,'bypass'),markup,css,primitives).length,marker);
  assert.ok(checkPlayerMutations(body+'\ndialog.showModal()',markup,css,primitives).length);
  assert.ok(checkPlayerMutations(body,markup,css+'\n.data-dialog {background:white}',primitives).length);
  assert.ok(checkPlayerMutations(body,markup.replace('id="mutationState"','id="bypass"'),css,primitives).length);
  for (const marker of ['validatePlayerConfig(', 'validatePlayerBaseConfig(', 'assertRead(operation)', 'state.readOperation === operation', 'abort.signal.aborted', 'Promise.race([transportJson(path, body, abort.signal, scope), interrupted])', "actionLabel:retry ? '다시 확인'", 'onAction:retry', 'state.disposed', "color('--cw-success-bg')", 'themeObserver.observe'])
    assert.ok(checkPlayerMutations(body.replaceAll(marker,'bypass'),markup,css,primitives).length,marker);
  assert.ok(checkPlayerMutations(body+'\nwindow.CsToast.show()',markup,css,primitives).length);
  assert.ok(checkPlayerMutations(body,markup,css+'\n.test { color:#fff; }',primitives).length);
  assert.ok(checkPlayerMutations(body,markup.replace('id="messageBox" hidden','id="bypass" hidden'),css,primitives).length);
  assert.ok(checkPlayerMutations(body,markup.replaceAll('confirm-check cw-check-control','confirm-check'),css,primitives).length);
  assert.ok(checkPlayerMutations(body,markup.replaceAll('class="cw-checkbox"',''),css,primitives).length);
  assert.ok(checkPlayerMutations(body,markup,css,primitives.replaceAll('html body .cw-check-control','html body .removed-check-control')).length);
  assert.ok(checkPlayerMutations(body,markup,css+'\n.detail-panel .confirm-check{background:red}',primitives).some(error=>error.includes('cannot duplicate')));
  for(const marker of ["chip.className = 'diff-chip cw-state-pill'", "modified: 'warning'", "added: 'success'", "removed: 'danger'", 'chip.dataset.tone'])assert.ok(checkPlayerMutations(body.replace(marker,'REMOVED'),markup,css,primitives).length,marker);
  for(const skin of ['.diff-chip{padding:20px}','.diff-chip.modified{background:orange}'])assert.ok(checkPlayerMutations(body,markup,css+'\n'+skin,primitives).length,skin);
  assert.ok(checkPlayerMutations(body,markup,css,primitives.replace('html body .cw-state-pill[data-tone="danger"]','REMOVED')).length);
});

test('account detail expansion and filtered rows cannot bypass shared disclosure state',()=>{
  const body=read('apps/portal/Pages/Admin/Users.cshtml');assert.deepEqual(checkAccountDisclosures(body),[]);
  for(const marker of ['CompanyDisclosure.attach(form)','disclosures.setOpen(','data-cw-disclosure=','data-cw-disclosure-panel='])assert.ok(checkAccountDisclosures(body.replaceAll(marker,'bypass')).length);
  assert.ok(checkAccountDisclosures(body+"\npeer.setAttribute('aria-expanded', 'true')").length);
});

test('CS player details cannot fork row state, clone the editor or replace filtering with rerendering',()=>{
  const body=read('apps/cs/public/player-data.js'),markup=read('apps/cs/public/player-data.html');assert.deepEqual(checkPlayerDisclosures(body,markup),[]);
  for(const marker of ['CompanyDisclosure.attach(elements.dataStoresContainer','single: true','disclosures.refresh()','disclosures.setOpen(','panel.dataset.cwDisclosurePanel','keyButton.dataset.cwDisclosure','detailButton.dataset.cwDisclosure','cw-table-scroll','cw-table-detail',"keyFilterInput.addEventListener('input', filterDataStores)"])
    assert.ok(checkPlayerDisclosures(body.replaceAll(marker,'bypass'),markup).length);
  assert.ok(checkPlayerDisclosures(body+"\nbutton.setAttribute('aria-expanded', 'true')",markup).length);
  assert.ok(checkPlayerDisclosures(body,markup+'<textarea id="jsonEditor"></textarea>').length);
  assert.ok(checkPlayerDisclosures(body,markup.replace('<fieldset id="interactionFields"','<div id="interactionFields"')).length);
  for(const marker of ['beforeRequest: async','approval.approve()','async function confirmDiscard(',
    'readSignature() === signature','signal?.addEventListener',"title:'편집 내용 버리기'",'if (!approve?.())',"presentEditorDialog('add', opener)","presentEditorDialog('delete', opener)"])
    assert.ok(checkPlayerDisclosures(body.replaceAll(marker,'bypass'),markup).length,marker);
});

test('task archive/restore/comment deletion cannot skip common confirmation or acknowledge without validation',()=>{
  const panel=read('apps/schedule/src/TaskPanel.tsx'),actions=read('apps/schedule/src/useTaskActions.ts');assert.deepEqual(checkTaskConfirmation(panel,actions),[]);
  for(const call of ['confirmWorkspaceAction(','taskActionTarget(','taskActionSignature(','captureTaskAction(','confirmTaskActionReceipt(','verifyTaskActionRead('])assert.ok(checkTaskConfirmation(panel,actions.replaceAll(call,'bypass(')).length);
  assert.ok(checkTaskConfirmation(panel.replace('applyDetail,changed:()=>changed(true)','applyDetail,changed'),actions).length);
  assert.ok(checkTaskConfirmation(panel.replace('writes.recover(fresh,directory)','undefined'),actions).length);
  assert.ok(checkTaskConfirmation(panel,actions.replace('live.current.revalidated?.(checked.detail,checked.directory)','')).length);
  assert.ok(checkTaskConfirmation(panel+'\nasync function archive(){}',actions).length);
  assert.ok(checkTaskConfirmation(panel,actions.replace('start.readDetail()','api<Detail>("/raw")')).length);
  assert.ok(checkTaskConfirmation(panel+"\napi('/api/comments/7?version=1','DELETE')",actions).length);
});

test('sheet writes cannot fork confirmation or omit acknowledged results',()=>{
  const app=read('apps/sheet/src/client/App.tsx'),actions=read('apps/sheet/src/client/useSheetActions.ts');
  assert.deepEqual(checkSheetConfirmation(app,actions),[]);
  assert.ok(checkSheetConfirmation(app+'\nfunction MigrationDialog() {}',actions).length);
  assert.ok(checkSheetConfirmation(app+'\napi.migrate("unchecked")',actions).length);
  for(const call of ['confirmWorkspaceAction(','confirmMigrationReceipt(','confirmSyncReceipt('])assert.ok(checkSheetConfirmation(app,actions.replaceAll(call,'bypass(')).length);
});

test('comments cannot fork comparison or skip acknowledged save checks',()=>{
  const panel=read('apps/schedule/src/TaskPanel.tsx'),composer=read('apps/schedule/src/CommentComposer.tsx');assert.deepEqual(checkCommentReview(panel,composer),[]);
  assert.ok(checkCommentReview(panel+'\nfunction CommentComposer(){}',composer).length);
  for(const call of ['openWorkspaceReview(','commentReviewItem(','applyCommentReview(','useCommentWrites({'])assert.ok(checkCommentReview(panel,composer.replaceAll(call,'bypass(')).length);
  for(const marker of ['confirmWorkspaceAction(', 'async function requestCommentDiscard(', 'discardRevision.current', 'workspace-entity-scope-change', 'commentActorScope(', 'validate:()=>stable()'])assert.ok(checkCommentReview(panel.replaceAll(marker,'bypass('),composer).length,marker);
  assert.ok(checkCommentReview(panel.replace('function Discussion','function Discussion\nconfirm("private")'),composer).some(error=>error.includes('browser confirmation')));
  assert.ok(checkCommentReview(panel,composer+'\nsetVersion(initial.version)').some(e=>e.includes('only their version')));
});

test('task conflicts cannot bypass shared comparison or only replace their version',()=>{
  const body=read('apps/schedule/src/TaskPanel.tsx');assert.deepEqual(checkTaskReview(body),[]);
  assert.ok(checkTaskReview(body.replace('openWorkspaceReview(','pageOwnedDialog(')).length);
  assert.ok(checkTaskReview(body.replaceAll('applyTaskReview(','blindApply(')).length);
  for(const marker of ['async function requestTaskEditCancel(', 'taskDiscardPermit.current', 'taskDiscardRequest.current', 'JSON.stringify({form:value.form,images:value.images})===captured', "title:'업무 편집 초안을 버릴까요?'", 'const closed=await close()', 'if(!closed&&stable())'])assert.ok(checkTaskReview(body.replaceAll(marker,'bypass')).length,marker);
  assert.ok(checkTaskReview(body.replace('function Discussion',"confirm('수정 중인 내용을 취소할까요?');\nfunction Discussion")).some(e=>e.includes('browser confirmation')));
  for(const marker of ['async function requestCommentTransition(', 'commentTransitionRequest.current', 'newCommentRevision.current', 'nestedCommentRevision.current', 'reportNewCommentDirty', 'reportNestedCommentDirty', "title:kind==='edit-task'?'댓글 초안을 버리고 업무를 수정할까요?':'댓글 초안을 버리고 변경 이력을 열까요?'", 'if(intent&&stable())apply()'])assert.ok(checkTaskReview(body.replaceAll(marker,'bypass')).length,marker);
  for(const message of ['작성 중인 댓글을 취소하고 업무를 수정할까요?','작성 중인 댓글을 취소하고 화면을 전환할까요?'])assert.ok(checkTaskReview(body.replace('function Discussion',`confirm('${message}');\nfunction Discussion`)).some(e=>e.includes('browser confirmation')),message);
  for(const marker of ['useWorkspaceNavigationRequest(requestPanelNavigationDiscard)', 'async function requestPanelNavigationDiscard(', 'navigationDiscardRequest.current', "title:'작성 중인 내용을 버리고 이전 화면으로 이동할까요?'", "if(source!=='history')return()=>true", 'return intent&&stable()?stable:null'])assert.ok(checkTaskReview(body.replaceAll(marker,'bypass')).length,marker);
  assert.ok(checkTaskReview(body.replace('function Discussion',"confirm('작성 중인 내용을 닫을까요? 저장하지 않은 내용은 사라집니다.');\nfunction Discussion")).some(e=>e.includes('history navigation')));
  for(const marker of ['async function requestTaskJump(', 'taskJumpRequest.current', '[newCommentRevision.current,nestedCommentRevision.current]', "title:'작성 중인 내용을 버리고 다른 업무로 이동할까요?'", 'const moved=await opened(nextId,commentId)', 'if(!intent||!stable())return'])assert.ok(checkTaskReview(body.replaceAll(marker,'bypass')).length,marker);
  assert.ok(checkTaskReview(body.replace('function Discussion',"confirm('작성 중인 내용을 닫고 다른 일정으로 이동할까요? 저장하지 않은 내용은 사라집니다.');\nfunction Discussion")).some(e=>e.includes('reference navigation')));
  for(const marker of ['beforeCloseRequest:requestPanelCloseDiscard', 'async function requestPanelCloseDiscard(', 'taskCloseRequest.current', "title:'작성 중인 내용을 버리고 업무를 닫을까요?'", 'return intent&&stable()?stable:null'])assert.ok(checkTaskReview(body.replaceAll(marker,'bypass')).length,marker);
  assert.ok(checkTaskReview('setForm(f => ({...f, version: detail.task.version}));\n'+body).some(e=>e.includes('without reviewing')));
});

test('employee selectors declare local IDs and React entity images cannot fork the directory',()=>{
  const file='apps/leave/Pages/Admin/Example.cshtml';
  for(const field of ['EmployeeId','Input.EmployeeId','actorFilter']){
    const tag=`<select name="${field}" data-company-picker="employee" data-company-local="true">`;
    assert.deepEqual(checkEntityBindings(file,tag),[]);
    assert.equal(checkEntityBindings(file,tag.replace('data-company-picker="employee"','')).length,1);
    assert.equal(checkEntityBindings(file,tag.replace('data-company-local="true"','')).length,1);
  }
  assert.equal(checkEntityBindings('apps/schedule/src/Avatar.tsx','window.CompanyWorkspace?.profileUrl(id)').length,1);
  assert.deepEqual(checkEntityBindings('apps/schedule/src/Avatar.tsx','<WorkspaceEntity kind="employee" id={id} />'),[]);
  assert.equal(checkEntityBindings('apps/portal/Pages/Example.cshtml','<fieldset data-search-choices>').length,1);
  assert.equal(checkEntityBindings('apps/schedule/src/Editor.tsx','<div className="mention-picker">').length,1);
  assert.deepEqual(checkEntityBindings('apps/portal/Pages/Example.cshtml','<fieldset data-workspace-choices="project">'),[]);
  const releases=read('apps/schedule/src/Releases.tsx'),identity=read('apps/schedule/src/ReleaseIdentity.tsx');
  assert.deepEqual(checkEntityBindings('apps/schedule/src/Releases.tsx',releases),[]);
  assert.ok(checkEntityBindings('apps/schedule/src/Releases.tsx',releases.replace('<ReleaseActor ','<span ')).length);
  assert.deepEqual(checkEntityBindings('apps/schedule/src/ReleaseIdentity.tsx',identity),[]);
  assert.ok(checkEntityBindings('apps/schedule/src/ReleaseIdentity.tsx',identity.replace('employee.id===actorId','employee.name===actorId')).length);
});
test('every registered CS route and legacy alias resolves through the server allowlist',()=>{
  for(const page of catalog.pages.filter(p=>p.service==='cs'))for(const route of [page.path,...page.aliases||[]]){
    assert.equal(resolvePublicAsset(resolve(root,'apps/cs/public'),route)?.filePath,resolve(root,page.entry));
  }
  for(const path of ['/auth/evil','/api/new','/../../.env','/unregistered']) assert.equal(resolvePublicAsset('.',path),null);
});
test('new page template inherits common shell, responsive viewport and sidebar',()=>{
  const page={service:'cs',title:'새 페이지 <script>alert(1)</script>',entry:'new'};
  const html=template(page);
  assert.deepEqual(checkPage(page,html),[]);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert'));
});
test('missing shared assets/mounts, duplicate global UI and handwritten sidebar fail',()=>{
  const page=catalog.pages[0], html=template(page);
  for(const broken of [
    html.replace('data-company-workspace','data-other'),
    html.replace('company-workspace.css','standalone.css'),
    html.replace('width=device-width','width=1200'),
    html.replace('</aside>','<a href="/">별도 메뉴</a></aside>'),
    html.replace('</main>','</main><aside></aside>'),
    html.replace('</main>','<button data-cw-panel="theme">테마 복제</button></main>')
  ])assert.ok(checkPage(page,broken).length>0);
});
test('unsafe routes, traversal, reserved auth paths, unknown services and permission drift fail',()=>{
  for(const change of [{path:'//evil.test'},{path:'/auth/callback'},{path:'/api/data'},{entry:'../../secret.html'},{permission:'admin.access'},{service:'unknown'}]){
    assert.ok(validateCatalog({...catalog,pages:[{...catalog.pages[0],...change}]}).length>0);
  }
  assert.ok(validateCatalog({...catalog,pages:[catalog.pages[0],catalog.pages[0]]}).length>0);
});

test('SPA registrations require unique views, existing bodies and valid navigation parents',()=>{
  const page=catalog.pages.find(p=>p.id==='statistics.dashboard');
  const detail=catalog.pages.find(p=>p.id==='statistics.build.detail');
  const changed=change=>({...catalog,pages:catalog.pages.map(p=>p.id===detail.id?{...p,...change}:p)});
  for(const change of [{view:undefined},{view:page.view},{view:'unsafe-view'},{parent:'missing'},{parent:'cs.players'},{parent:'statistics.boss.detail'},{nav:true}]) {
    assert.ok(validateCatalog(changed(change)).length>0,JSON.stringify(change));
  }
  assert.deepEqual(validateCatalog(catalog),[],'One SPA document can own multiple registered views');
  const html=read(page.entry);
  assert.deepEqual(checkPage(page,html),[]);
  assert.ok(checkPage(page,html.replace('data-page="dashboard"','data-page="orphan"')).length>0);
});

test('React pages cannot escape the client entry boundary or duplicate views',()=>{
  const page=catalog.pages.find(p=>p.id==='sheet.overview');
  for(const patch of [{entry:'apps/sheet/src/server/index.ts'},{entry:'apps/sheet/src/client/../App.tsx'},{entry:'apps/sheet/src/client/pages/nested/page.tsx'},{view:'not-valid'}]) {
    expectInvalid({...page,...patch});
  }
  function expectInvalid(candidate){assert.ok(validateCatalog({...catalog,pages:[candidate]}).length>0);}
  assert.ok(validateCatalog({...catalog,pages:[page,{...page,id:'sheet.duplicate',path:'/duplicate',aliases:[]}]}).length>0);
});

test('dynamic schedule details and management capabilities must be explicitly registered',()=>{
  const page=catalog.pages.find(p=>p.id==='schedule.task');
  const changed=patch=>({...catalog,pages:catalog.pages.map(p=>p.id===page.id?{...p,...patch}:p)});
  for(const patch of [{path:'/tasks/:anything'},{path:'/tasks/:id/extra'},{nav:true},{capability:'invented.manage'}]){
    assert.ok(validateCatalog(changed(patch)).length>0,JSON.stringify(patch));
  }
  assert.deepEqual(validateCatalog(catalog),[]);
});

test('Razor pages require explicit policies and query variants cannot weaken their server gate',()=>{
  const page=catalog.pages.find(p=>p.id==='home.projects');
  const changed=patch=>({...catalog,pages:catalog.pages.map(p=>p.id===page.id?{...p,...patch}:p)});
  for(const patch of [{policy:undefined},{policy:'InventedPolicy'},{policy:'EmployeeOnly'},{anonymous:true},{query:{handler:'Delete'}},{query:[]},{entry:'apps/portal/Pages/../Unsafe.cshtml'},{path:'/Auth/unsafe'}]){
    assert.ok(validateCatalog(changed(patch)).length>0,JSON.stringify(patch));
  }
  assert.deepEqual(validateCatalog(catalog),[]);
});

test('Razor pages cannot bypass generated routes, titles, policies or the common layout',()=>{
  const page=catalog.pages.find(p=>p.id==='home.profile'),body='@page\n<section>content</section>';
  assert.deepEqual(checkRazorPage(page,body),[]);
  for(const extra of ['@{Layout = null;}','<aside>menu</aside>','@attribute [AllowAnonymous]','@{ViewData["Title"] = "duplicate";}'])assert.ok(checkRazorPage(page,body+extra).length>0);
  assert.ok(checkRazorPage(page,body,'[Authorize(Policy="Other")]').length>0);
  assert.ok(checkRazorPage(page,body.replace('@page','@page "/unregistered"')).length>0);
});
