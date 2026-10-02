import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkWorkspaceContextReads} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('company context cannot bypass the common read lifetime or response contract',()=>{
  const args=[read('packages/workspace-ui/src/company-workspace.js'),read('packages/workspace-ui/src/context-contract.js'),read('tooling/build-ui.mjs'),read('packages/contracts/workspace-context-reads.md')];
  assert.deepEqual(checkWorkspaceContextReads(...args),[]);
  for(const [index,markers] of [
    [0,['contextReads=window.CompanyReadSession.create()',"contextReads.run('workspace-context'",'contextReads.dispose()',"result.status==='cancelled'",'!result.isCurrent?.()','revision!==contextRevision','const readContext=async signal=>window.CompanyContextContract.read','function applyContext(value)']],
    [1,['window.CompanyContextContract=Object.freeze({read})','typeof value.authenticated',"['master','admin','employee']",'new Set(value.services.map','stringRecord(value.profiles','stringRecord(value.projectIcons','value.projects']],
    [2,["read('packages/workspace-ui/src/context-contract.js')","read('packages/workspace-ui/src/company-workspace.js')"]],
    [3,['`workspace-context`','`CompanyReadSession`','authenticated','user','서비스 key','profiles/projectIcons','projects','10초','context revision','덮지 않는다']]
  ])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkWorkspaceContextReads(...changed).length,marker);}
  const direct=[...args];direct[0]+="\napi('/context')";assert.ok(checkWorkspaceContextReads(...direct).length,'duplicate context transport');
});
