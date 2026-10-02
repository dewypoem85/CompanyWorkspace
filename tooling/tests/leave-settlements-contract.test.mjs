import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveSettlements} from '../check-architecture.mjs';
test('settlement transport, complete acknowledgement, shared native fields and server domain cannot be omitted',()=>{
  const paths=['apps/leave/wwwroot/js/leave-settlements.js','apps/leave/Pages/Admin/Settlements.cshtml','apps/leave/Pages/Admin/Settlements.cshtml.cs','apps/leave/Services/LeaveSettlementService.cs','packages/workspace-ui/src/primitives.css'];
  const args=paths.map(path=>readFileSync(resolve(root,path),'utf8'));assert.deepEqual(checkLeaveSettlements(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyDialog.confirm(','data.employeeId!==intent.employeeId','data.createdGrantId===data.grantId','controller.dispose()']],[1,['cw-form-fields','data-company-picker="employee"','settlement-raw-draft']],[2,['expectedSnapshot','catch (LeaveSettlementConflictException']],[3,['security.EnsureAdmin(','LeaveSettlementSnapshot.ComputeAsync','await tx.CommitAsync()']],[4,['.cw-form-control','@media(max-width:600px)']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveSettlements(...changed).length,marker);}
  assert.ok(checkLeaveSettlements(args[0]+';fetch("/write")',...args.slice(1)).length);
});
