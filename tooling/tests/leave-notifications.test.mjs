import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveNotifications} from '../check-architecture.mjs';
import {validateNotificationReceipt} from '../../apps/leave/wwwroot/js/notification-center.js';

test('notification receipts preserve long string IDs, operation and local navigation',()=>{
  const origin='https://leave.workspace.test';
  for(const operation of ['MarkRead','MarkAllRead','Open']) {
    const expected={operation,employeeId:'9007199254740993',id:operation==='MarkAllRead'?null:'9223372036854775807'};
    const value={...expected,navigateTo:operation==='Open'?'/Leave?Year=2026':null};
    assert.equal(validateNotificationReceipt(value,expected,origin),value);
    for(const patch of [{id:3},{employeeId:9007199254740993},{employeeId:'other'},{operation:'other'},{id:'9007199254740992'}])assert.throws(()=>validateNotificationReceipt({...value,...patch},expected,origin));
    for(const path of ['https://external.invalid','//external.invalid','/\\external.invalid','/\nexternal.invalid'])assert.throws(()=>validateNotificationReceipt({...value,navigateTo:path},expected,origin));
    if(operation==='MarkAllRead')assert.throws(()=>validateNotificationReceipt({...value,id:'1'},{...expected,id:'1'},origin));
  }
});
test('notification forms cannot bypass shared transport, scope and semantic states',()=>{
  const read=file=>readFileSync(resolve(root,file),'utf8');
  const body=read('apps/leave/wwwroot/js/notification-center.js'),markup=read('apps/leave/Pages/Notifications/Index.cshtml'),server=read('apps/leave/Pages/Notifications/Index.cshtml.cs'),css=read('apps/leave/wwwroot/css/site.css');
  assert.deepEqual(checkLeaveNotifications(body,markup,server,css),[]);
  for(const marker of ['window.CompanyForm.attach(', 'window.CompanyState.render(', 'validateNotificationReceipt(', 'context.isCurrent()', 'captured.scope !== scope', 'signature(form) !== captured.signature', 'controller.dispose()', 'list.replaceChildren()', 'workspace-entity-scope-change'])assert.ok(checkLeaveNotifications(body.replaceAll(marker,'bypass'),markup,server,css).length,marker);
  for(const action of ['MarkRead','MarkAllRead','Open'])assert.ok(checkLeaveNotifications(body,markup.replace(`data-notification-action="${action}"`,'bypass'),server,css).length);
  assert.ok(checkLeaveNotifications(body,markup,server.replaceAll('Url.IsLocalUrl(item.Link)','true'),css).length);
  assert.ok(checkLeaveNotifications(body,markup,server.replaceAll('MatchesEmployee(expectedEmployeeId, employee.Id)','true'),css).length);
  assert.ok(checkLeaveNotifications(body,markup.replaceAll('name="expectedEmployeeId" value="@Model.EmployeeId"','bypass'),server,css).length);
  assert.ok(checkLeaveNotifications(body,markup,server,css.replace('background:var(--cw-active)','background:#fff')).length);
});
