import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkSheetWrites} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');
test('Sheet writes cannot bypass common transport, exact receipts or server envelopes',()=>{
  const args=[read('apps/sheet/src/client/useSheetActions.ts'),read('apps/sheet/src/client/sheetWrites.ts'),read('apps/sheet/src/client/api.ts'),read('apps/sheet/src/server/index.ts'),read('packages/contracts/sheet-writes.md')];
  assert.deepEqual(checkSheetWrites(...args),[]);
  for(const [index,markers] of [
    [0,['createWorkspaceWriteTransport(', 'createWorkspaceReadSession(', "session.run('after-write'", '30_000', "reads.current?.cancel('after-write')", 'reads.current?.dispose()', 'writer.send(', "'X-Workspace-Actor':captured.config!.actorId", "'X-Workspace-Sheet-State':migration?analysis!.id:preview!.id", 'activeWrite.current', 'confirmMigrationReceipt(', 'confirmSyncReceipt(', 'transport.current?.dispose()']],
    [1,['exactKeys(', "sent.confirmation !== '수식 제거'", "sent.confirmation !== '한국어 갱신'", 'value.analysisId !== analysis.id', 'value.previewId !== preview.id']],
    [3,["workspaceFormMediaType = 'application/vnd.company.workspace-form+json'", 'companyActorId(request)', 'validateSheetWriteContext(', 'requireSheetWriteContext(request,response,expectedAnalysisId)', 'requireSheetWriteContext(request,response,previewId)', 'workspaceSaved(response', 'workspaceRejected(response', "protocol:'workspace-form-v1'"]],
    [4,['`CompanyForm`','`WorkspaceReadSession`','`after-write`','`workspace-form-v1`','`X-Workspace-Actor`','`X-Workspace-Sheet-State`','30초','자동 재전송하지 않는다','분석 ID','미리보기 ID','후속 조회']],
  ])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkSheetWrites(...changed).length,marker);}
  {const changed=[...args];changed[2]+="\nconst bypass={migrate:()=>fetch('/api/migrations/apply')}";assert.ok(checkSheetWrites(...changed).length);}
});
