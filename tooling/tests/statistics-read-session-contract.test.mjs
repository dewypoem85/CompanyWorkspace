import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkStatisticsReads,checkStatisticsRefreshReads,checkStatisticsOverviewContract} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('Statistics body reads cannot bypass the common observation session',()=>{
  const args=[read('apps/statistics/public/app.js'),read('packages/contracts/statistics-reads.md')];
  assert.deepEqual(checkStatisticsReads(...args),[]);
  for(const marker of ["readSession:window.CompanyReadSession.create()", ".run('statistics-bootstrap'", ".run('statistics-overview'", "state.readSession.cancel('statistics-overview')", 'state.readSession.dispose()', "result.status==='cancelled'", '!result.isCurrent()', 'state.readOwner===owner', "document.addEventListener('workspace-entity-scope-change', invalidateStatistics)"]){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsReads(...changed).length,marker);
  }
  for(const privateSession of ['\nnew AbortController()','\nPromise.race([])']){
    const changed=[...args];changed[0]+=privateSession;assert.ok(checkStatisticsReads(...changed).length,privateSession);
  }
  for(const marker of ["credentials:'same-origin'", "redirect:'manual'", "cache:'no-store'", "includes('application/json')", "'/api/config'", '/api/analytics/overview?', "init.signal?.aborted", 'sessionExpired']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsReads(...changed).length,marker);
  }
  {const changed=[...args];changed[0]+='\nfetch("/raw")';assert.ok(checkStatisticsReads(...changed).length);}
  for(const marker of ['`statistics-bootstrap`','`statistics-overview`','`CompanyReadSession`','`app.js`','30초','취소','최신 ticket','중첩 업무 필드']){
    const changed=[...args];changed[1]=changed[1].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsReads(...changed).length,marker);
  }
});

test('Statistics refresh GET reads cannot bypass the common observation session or weaken POST uncertainty',()=>{
  const args=[read('apps/statistics/public/refresh.js'),read('packages/contracts/statistics-refresh.md')];
  assert.deepEqual(checkStatisticsRefreshReads(...args),[]);
  for(const marker of [
    'readSession = win.CompanyReadSession.create()',
    "readSession.run('statistics-refresh-context'",
    "readSession.run('statistics-refresh-status'",
    "readSession.cancel('statistics-refresh-context')",
    "readSession.cancel('statistics-refresh-status')",
    'readSession.dispose()',
    "result.status === 'cancelled'",
    '!result.isCurrent()',
    "contextRead.status === 'cancelled'",
    '!contextRead.isCurrent()']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsRefreshReads(...changed).length,marker);
  }
  for(const marker of ['async function requestJson(','async function requestMutation(',"credentials: 'same-origin'","redirect: 'manual'","cache: 'no-store'","includes(init?.method === 'POST' ? REFRESH_MEDIA_TYPE : 'application/json')",'signal?.aborted','const work = requestJson(url, init, controller.signal)',"requestMutation('/api/analytics/refresh'"]){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsRefreshReads(...changed).length,marker);
  }
  for(const extra of ['\nnew AbortController()','\nPromise.race([])','\nfetchImpl("/raw")']){
    const changed=[...args];changed[0]+=extra;assert.ok(checkStatisticsRefreshReads(...changed).length,extra);
  }
  for(const marker of ['`statistics-refresh-context`','`statistics-refresh-status`','`CompanyReadSession`','`requestMutation`','GET','POST','30초','미확정']){
    const changed=[...args];changed[1]=changed[1].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsRefreshReads(...changed).length,marker);
  }
});

test('Statistics overview cannot bypass the complete nested response contract',()=>{
  const args=[read('apps/statistics/public/app.js'),read('apps/statistics/public/overview-contract.js'),read('apps/statistics/app-server.js'),read('packages/contracts/statistics-reads.md')];
  assert.deepEqual(checkStatisticsOverviewContract(...args),[]);
  for(const [index,markers] of [
    [0,["import { readStatisticsOverview } from './overview-contract.js'",'readStatisticsOverview(await fetchJson(`/api/analytics/overview?${query}`']],
    [1,['export function readStatisticsOverview(value)','validPublication','summary.playTime',"['platforms','modes']","['characters','skins','weapons','pets','nodes','nodeCombinations','skills','artifacts','combinations']","['characters','skins','weapons','pets','nodes','skills','artifacts','combinations']",'topCombinations','runeConfigurations','buildStats','schemaCutoverVersion']],
    [2,["['/overview-contract.js', ['overview-contract.js', 'text/javascript; charset=utf-8']]"]],
    [3,['`readStatisticsOverview`','`overview-contract.js`','적용 전','summary','trend','outcomes','versions','dimensions','builds','bosses','schema','stats']]
  ])for(const marker of markers){const changed=[...args];changed[index]=changed[index].replaceAll(marker,'BYPASS');assert.ok(checkStatisticsOverviewContract(...changed).length,marker)}
});
