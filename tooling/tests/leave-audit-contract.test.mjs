import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLeaveAuditReads} from '../check-architecture.mjs';

test('Leave audit reads cannot bypass the common observation lifetime or response checks',()=>{
  const client=readFileSync(resolve(root,'apps/leave/wwwroot/js/audit-logs.js'),'utf8');
  assert.deepEqual(checkLeaveAuditReads(client),[]);
  for(const marker of ['CompanyReadSession.create()','readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()','workspace-entity-scope-change','d.auditOwner !== owner','d.auditAction !== expected.action',"next.querySelector('script')"])
    assert.ok(checkLeaveAuditReads(client.replaceAll(marker,'BYPASS')).length,marker);
  for(const restored of ['Promise.race([])','new AbortController()','setTimeout(()=>{},1)'])
    assert.ok(checkLeaveAuditReads(client+';'+restored).length,restored);
});
