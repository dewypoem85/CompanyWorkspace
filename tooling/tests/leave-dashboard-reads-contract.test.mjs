import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveDashboardReads} from '../check-architecture.mjs';

test('Leave calendar and request-list reads cannot bypass the common observation and account scope',()=>{
  const markup=readFileSync(resolve(root,'apps/leave/Pages/Leave/Index.cshtml'),'utf8');
  const transport=readFileSync(resolve(root,'apps/leave/wwwroot/js/leave-dashboard-read.js'),'utf8');
  assert.deepEqual(checkLeaveDashboardReads(markup,transport),[]);
  for(const marker of ['CompanyReadSession.create()','readSession.run(channel','readSession.cancel(\'leave-calendar\')','readSession.cancel(\'leave-request-list\')','readSession.dispose()','result.isCurrent?.()','LeaveDashboardRead.read(target.href, signal)','workspace-entity-scope-change','requestId === requestListFetchSeq','matches.length !== 1','matches[0].dataset.readOwner !== currentEmployeeId','data-read-owner="@Model.CurrentEmployee.Id"','leave-dashboard-read.js'])
    assert.ok(checkLeaveDashboardReads(markup.replaceAll(marker,'BYPASS'),transport).length,marker);
  for(const marker of ["paths=new Set(['/leave','/leave/index'])","queryKeys=new Set(['Year'",'url.origin!==root.location.origin','url.hash','url.searchParams.getAll(key).length!==1',"'X-Requested-With':'XMLHttpRequest'","Accept:'text/html'","credentials:'same-origin'","cache:'no-store'","redirect:'error'",'signal?.throwIfAborted()'])
    assert.ok(checkLeaveDashboardReads(markup,transport.replaceAll(marker,'BYPASS')).length,marker);
  for(const restored of ['fetch("/raw")','Promise.race([])','new AbortController()','setTimeout(()=>{},1)'])
    assert.ok(checkLeaveDashboardReads(markup+';'+restored,transport).length,restored);
});
