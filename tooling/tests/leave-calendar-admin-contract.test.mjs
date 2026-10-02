import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveCalendarAdminServer,checkLeaveCalendarAdminClient,checkLeaveCalendarPreferences} from '../check-architecture.mjs';

test('calendar admin server uses common actor, baseline, saved receipt and safe native recovery contract',()=>{
  const args=['apps/leave/Pages/Leave/Index.cshtml.cs','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Services/LeaveRequestService.cs'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveCalendarAdminServer(...args),[]);
  for(const [index,markers] of [[0,['if (!admin.IsAdmin)','Request.Form["expectedEmployeeId"].Count != 1','Request.Form["expectedSnapshot"] != previousSnapshot','security.EnsureCanForceDelete(admin)','ModelState.TryGetValue(key','actorEmployeeId = actorId','targetEmployeeId = request!.EmployeeId.ToString(CultureInfo.InvariantCulture)','db.LeaveRequests.AsNoTracking().Include(x => x.Dates)','Failure("unknown"','AdminForceLocked = true']],[2,['x.IsActive && !x.IsSharedAccount && !x.IsCompanyMaster','if (conflict) throw new LeaveRequestValidationException']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveCalendarAdminServer(...changed).length,marker);}
  assert.ok(checkLeaveCalendarAdminServer(args[0],args[1].replace('@Model.AdminForceRawDraft','@Html.Raw(Model.AdminForceRawDraft)'),args[2]).length);
});

test('calendar admin client uses shared confirmation, exact receipt and coordinated drafts',()=>{
  const args=['apps/leave/wwwroot/js/leave-calendar-admin.js','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Leave/Index.cshtml.cs','apps/leave/wwwroot/js/leave-application.js','apps/leave/wwwroot/js/leave-self-actions.js','apps/leave/wwwroot/js/leave-external-schedules.js'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveCalendarAdminClient(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','CompanyDialog.present(','entry.controller.dispose()','observer.disconnect()','data.targetEmployeeId!==intention.employeeId','data.previousSnapshot!==sent.get','day.date!==expectedDates[index].date','subject(form)!==before','snapshot(form)!==captured']],[1,['data-admin-target="@(Model.CanAdminEditCalendar ? item.AdminTarget : null)"','LeaveAdminCalendar?.blocksNavigation()']],[3,['LeaveAdminCalendar?.hasDraft()']],[4,['session.begin(sessionOwner']],[5,['LeaveAdminCalendar?.hasDraft()']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveCalendarAdminClient(...changed).length,marker);}
  assert.ok(checkLeaveCalendarAdminClient(args[0]+';fetch("/save")',...args.slice(1)).length);
});

test('calendar preferences keep complete server-rendered GET fields and a binding-only layout',()=>{
  const args=['apps/leave/Pages/Shared/_Layout.cshtml','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Leave/Index.cshtml.cs','packages/workspace-ui/src/primitives.css','apps/leave/wwwroot/css/site.css','apps/leave/wwwroot/css/mobile.css'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveCalendarPreferences(...args),[]);
  for(const [index,markers] of [[0,['input[data-calendar-preference-toggle="true"]','event.stopImmediatePropagation();','submitPreference(form);']],[1,['name="SaveCalendarPreference" value="true"','name="SelfOnly" value="false"','name="ShowOthers" value="false"','cw-check-control','class="cw-checkbox"']],[2,['if (SaveCalendarPreference)','CurrentEmployee.CalendarSelfOnly = SelfOnly;','CurrentEmployee.CalendarShowApprovedOthers = ShowOthers;']],[3,['html body .cw-check-control','html body input.cw-checkbox','.cw-check-control:has(input.cw-checkbox:checked)','.cw-check-control:has(input.cw-checkbox:focus-visible)']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveCalendarPreferences(...changed).length,marker);}
  assert.ok(checkLeaveCalendarPreferences(args[0]+"\ndocument.createElement('input')",...args.slice(1)).some(error=>error.includes('cannot create')));
  assert.ok(checkLeaveCalendarPreferences(...args.slice(0,4),args[4]+'\n.calendar-self-toggle{background:red}',args[5]).some(error=>error.includes('duplicate shared checkbox skin')));
});
