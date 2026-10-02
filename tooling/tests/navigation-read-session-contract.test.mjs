import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkNavigationReads} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('shared sidebar authorization cannot bypass the common read lifetime',()=>{
  const args=[read('packages/workspace-ui/src/navigation.js'),read('tooling/build-ui.mjs'),read('packages/contracts/navigation-reads.md')];
  assert.deepEqual(checkNavigationReads(...args),[]);
  for(const [index,markers] of [
    [0,['CompanyReadSession.create()',"const channelFor = service => `workspace-navigation-${service}`",'readSession.run(channel','cancelAuthorizationReads()','readSession.cancel(channel)','readSession.dispose()','signal.throwIfAborted()',"result.status==='cancelled'",'!result.isCurrent?.()','validateAuthorization(service,data)',"document.addEventListener('company-context'"]],
    [1,["read('packages/workspace-ui/src/read-session.js')","read('packages/workspace-ui/src/navigation.js')"]],
    [2,['`workspace-navigation-*`','`CompanyReadSession`','계정·역할·허용 서비스 범위','8초','최신 ticket','401','403','pages','badges']]
  ])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkNavigationReads(...changed).length,marker);}
  for(const extra of ['\nAbortSignal.timeout(8000)','\nPromise.race([])','\nnew AbortController()']){const changed=[...args];changed[0]+=extra;assert.ok(checkNavigationReads(...changed).length,extra);}
  const reordered=[...args];reordered[1]=reordered[1].replace("read('packages/workspace-ui/src/read-session.js')+'\\n'+read('packages/workspace-ui/src/navigation.js')","read('packages/workspace-ui/src/navigation.js')+'\\n'+read('packages/workspace-ui/src/read-session.js')");
  assert.ok(checkNavigationReads(...reordered).length,'load order');
});
