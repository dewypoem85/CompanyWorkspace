import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveApprovals} from '../check-architecture.mjs';
test('Leave approval forms cannot bypass common lifetime, exact actor and state receipts',()=>{
  const args=['apps/leave/wwwroot/js/approval-forms.js','apps/leave/Pages/Admin/Index.cshtml','apps/leave/Pages/Admin/_ApprovalAction.cshtml','apps/leave/Pages/Admin/Index.cshtml.cs'].map(file=>readFileSync(resolve(root,file),'utf8'));
  assert.deepEqual(checkLeaveApprovals(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','CompanyState.render(','CompanyReadSession.create()','readSession.run(channel','readSession.cancel(reading.channel)','readSession.dispose()','result.isCurrent?.()','controller.dispose()','data.employeeId!==owner','data.previousSnapshot!==sent.get','hasDraft()','clearInterval(timer)']],[1,['approval-forms.js']],[2,['name="expectedEmployeeId"','name="expectedSnapshot"']],[3,['Request.Form["expectedSnapshot"] != before','security.EnsureCanForceDelete(actor)']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveApprovals(...changed).length,marker);}
  assert.ok(checkLeaveApprovals(args[0]+'; window.confirm("Approve?")',...args.slice(1)).length);
  for(const restored of ['Promise.race([])','reading.abort()'])assert.ok(checkLeaveApprovals(args[0]+';'+restored,...args.slice(1)).length,restored);
});
