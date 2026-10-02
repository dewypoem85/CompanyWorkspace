import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveApplication} from '../check-architecture.mjs';
test('Leave application cannot bypass shared transport, exact receipt or server actor checks',()=>{
  const args=['apps/leave/wwwroot/js/leave-application.js','apps/leave/Pages/Leave/Index.cshtml','apps/leave/Pages/Leave/Index.cshtml.cs','apps/leave/Services/LeaveRequestService.cs'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveApplication(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','controller.dispose();lock()','data.employeeId!==owner','data.input.workPlan!==sent.get','otherDraft()','url.searchParams.getAll(key).length!==1']],[1,['leave-application.js','name="expectedEmployeeId"']],[2,['Request.Form["expectedEmployeeId"] != owner','catch (LeaveRequestValidationException ex)','Failure("unknown"']],[3,['class LeaveRequestValidationException']]])for(const marker of markers){const copy=[...args];copy[index]=copy[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveApplication(...copy).length,marker);}
  assert.ok(checkLeaveApplication(args[0]+';window.confirm("Submit?")',...args.slice(1)).length);
});
