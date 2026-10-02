import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveGrantProtocol,checkLeaveGrantClient} from '../check-architecture.mjs';

test('grant server protocol preserves prewrite checks, business restrictions, native recovery and shared baseline',()=>{
  const paths=['apps/leave/Pages/Admin/Adjustments.Protocol.cs','apps/leave/Pages/Admin/Adjustments.cshtml.cs','apps/leave/Pages/Admin/Adjustments.cshtml','apps/leave/Services/LeaveGrantSnapshot.cs','apps/leave/Services/LeaveSettlementSnapshot.cs'];
  const args=paths.map(path=>readFileSync(resolve(root,path),'utf8'));assert.deepEqual(checkLeaveGrantProtocol(...args),[]);
  for(const [index,markers] of [[0,['expectedEmployeeSnapshot','expectedSnapshot','security.EnsureCanForceDelete(actor)','DraftFields.ToDictionary','"unknown"']],[1,['allocated != 0 || settled != 0','await tx.CommitAsync()','existing.GrantedDays += Days']],[2,['Model.Locked','@Model.RawDraft','data-workspace-state="error"']],[3,['x.LeaveRequest.Status','employee.HireDate','createdTicks = grant.CreatedAtUtc.Ticks']],[4,['LeaveGrantSnapshot.ComputeAsync(db, balance.Grant)']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveGrantProtocol(...changed).length,marker);}
});

test('grant shared editor guard rejects representative lifecycle, precision, row and native-button bypasses',()=>{
  const paths=['apps/leave/wwwroot/js/leave-grants.js','apps/leave/wwwroot/js/leave-grants-contract.js','apps/leave/Pages/Admin/Adjustments.cshtml','apps/leave/Pages/Admin/_GrantRow.cshtml','apps/leave/Pages/Admin/Adjustments.Protocol.cs','packages/workspace-ui/src/primitives.css'];
  const args=paths.map(path=>readFileSync(resolve(root,path),'utf8'));assert.deepEqual(checkLeaveGrantClient(...args),[]);
  for(const [index,markers] of [[0,['CompanyForm.attach(','CompanyReadSession.create()','readSession.run(channel','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()','reads.get(employeeId)===record','session.begin(owner,[C.resource(plan)])','C.saved(data,entry.intent,context)','tables.has(data.employeeId)','session.revision===revision','entry.controller.dispose()']],[1,['BigInt','data.employeeSnapshot!==intent.employeeSnapshot','g.sourceGrantId!==(old?.sourceGrantId??null)']],[2,['data-grant-row-template','cw-form-control']],[3,['data-grant-form="DeleteGrant"','data-variant="danger"']],[4,['actorName = actor.Name','remaining =']],[5,['button.cw-button:disabled']]])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkLeaveGrantClient(...changed).length,marker);}
  for(const bypass of ['window.confirm("delete")','fetch("/write",{method:"POST"})','Promise.race([])','record.abort','read.abort.abort()']){const changed=[...args];changed[0]+=bypass;assert.ok(checkLeaveGrantClient(...changed).length,bypass);}
});
