import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveExternalScheduleServer,checkLeaveExternalScheduleClient} from '../check-architecture.mjs';

test('external calendar server retains actor, baseline, receipt and safe HTML failure contract',()=>{
  const server=readFileSync(resolve(root,'apps/leave/Pages/Leave/Index.cshtml.cs'),'utf8');
  const markup=readFileSync(resolve(root,'apps/leave/Pages/Leave/Index.cshtml'),'utf8');
  assert.deepEqual(checkLeaveExternalScheduleServer(server,markup),[]);
  for(const marker of ['if (!admin.IsAdmin)','Request.Form["expectedEmployeeId"].Count != 1','Request.Form["expectedSnapshot"] != previousSnapshot','ModelState.TryGetValue(idKey','actorEmployeeId = actorId','id = item.Id.ToString(CultureInfo.InvariantCulture)','Failure("unknown"','ExternalScheduleLocked = true','updatedAtTicks = item.UpdatedAtUtc.Ticks'])
    assert.ok(checkLeaveExternalScheduleServer(server.replaceAll(marker,'BYPASS'),markup).length,marker);
  assert.ok(checkLeaveExternalScheduleServer(server,markup.replace('@Model.ExternalScheduleRawDraft','@Html.Raw(Model.ExternalScheduleRawDraft)')).length);
});

test('external calendar uses shared lifetime, exact receipt, snapshot and coordinated drafts',()=>{
  const args=['apps/leave/wwwroot/js/leave-external-schedules.js','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Leave/Index.cshtml.cs','apps/leave/wwwroot/js/leave-application.js','apps/leave/wwwroot/js/leave-self-actions.js'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveExternalScheduleClient(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','entry.controller.dispose()','observer.disconnect()','data.actorEmployeeId!==owner','data.previousSnapshot!==sent.get','data.input[key]!==intention[key]','discardThen(','snapshot(form)!==captured']],[1,['data-snapshot="@schedule.Snapshot"','LeaveExternalSchedule?.blocksNavigation()']],[3,['LeaveExternalSchedule?.hasDraft()']],[4,['session.hasDraftExcept(sessionOwner)']]])for(const marker of markers){const copy=[...args];copy[index]=copy[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveExternalScheduleClient(...copy).length,marker);}
  assert.ok(checkLeaveExternalScheduleClient(args[0]+';fetch("/save")',...args.slice(1)).length);
});
