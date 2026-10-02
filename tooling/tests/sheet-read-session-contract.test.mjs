import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkSheetReads} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('Sheet body reads cannot bypass the generated common observation session',()=>{
  const args=[read('apps/sheet/src/client/useSheetData.ts'),read('apps/sheet/src/client/api.ts'),read('packages/contracts/sheet-reads.md')];
  assert.deepEqual(checkSheetReads(...args),[]);
  for(const marker of ['createWorkspaceReadSession', 'readSession.current?.cancel(channel)', 'session.run(channel, work, 30_000)', "result.status === 'cancelled'", '!result.isCurrent()', 'readOwners.current[channel] === owner', 'session.dispose()', 'workspace-entity-scope-change', 'checkTarget(runtime, initial)', 'checkTarget(runtime, value)']){const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkSheetReads(...changed).length,marker);}
  for(const privateSession of ['\nnew AbortController()','\nPromise.race([])','\nsetTimeout(()=>{},1)']){const changed=[...args];changed[0]+=privateSession;assert.ok(checkSheetReads(...changed).length,privateSession);}
  for(const marker of ["credentials: 'same-origin', cache: 'no-store', redirect: 'manual'", 'readConfig', 'readAnalysis', 'readSnapshots', 'readPreview']){const changed=[...args];changed[1]=changed[1].replaceAll(marker,'BYPASS');assert.ok(checkSheetReads(...changed).length,marker);}
  {const changed=[...args];changed[1]+='\nfetch("/raw")';assert.ok(checkSheetReads(...changed).length);}
  for(const marker of ['`main`','`preview`','`WorkspaceReadSession`','`api.ts`','`sheetReads.ts`','30초','취소','최신 ticket']){const changed=[...args];changed[2]=changed[2].replaceAll(marker,'BYPASS');assert.ok(checkSheetReads(...changed).length,marker);}
});
