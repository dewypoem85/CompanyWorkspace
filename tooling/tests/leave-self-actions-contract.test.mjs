import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveSelfActions} from '../check-architecture.mjs';
test('employee cancellation cannot bypass shared form, calendar snapshot or server ownership',()=>{
  const args=['apps/leave/wwwroot/js/leave-self-actions.js','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Leave/_SelfActionForm.cshtml','apps/leave/Pages/Leave/Index.cshtml.cs','apps/leave/Services/LeaveRequestSnapshot.cs','apps/leave/wwwroot/js/leave-application.js'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveSelfActions(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','entry.controller.dispose()','observer.disconnect()','data.previousSnapshot!==sent.get','data.status!==expected','hasDraft()','area.inert=session.pending']],[1,['data-request-snapshot','leave-self-actions.js']],[2,['name="expectedEmployeeId"','name="expectedSnapshot"']],[3,['x.Id==id&&x.EmployeeId==actor.Id','Request.Form["expectedSnapshot"]!=before','Failure("unknown"']],[4,['request.Dates.OrderBy']],[5,['session.begin(sessionOwner)','lease?.current']]])for(const marker of markers){const copy=[...args];copy[index]=copy[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveSelfActions(...copy).length,marker);}
  assert.ok(checkLeaveSelfActions(args[0]+';window.confirm("Cancel?")',...args.slice(1)).length);
});
