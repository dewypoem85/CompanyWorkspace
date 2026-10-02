import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkSteamRefunds} from '../check-architecture.mjs';

const read = path => readFileSync(resolve(root,path),'utf8');

test('CS Steam configuration and transaction reads cannot bypass the common observation session',()=>{
  const args=[read('apps/cs/public/app.js'),read('apps/cs/public/index.html'),read('apps/cs/public/steam-refunds.css'),read('packages/contracts/cs-steam-refund-reads.md')];
  assert.deepEqual(checkSteamRefunds(...args),[]);
  for(const marker of ['CompanyReadSession.create()',"Object.freeze(['steam-config', 'steam-query', 'steam-history'])","const STEAM_READ_PATHS = new Set(['/api/config', '/api/transactions/query', '/api/transactions/history']);","const STEAM_MUTATION_PATHS = new Set(['/api/transactions/refund']);",'readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkSteamRefunds(...changed).length,marker);
  }
  for(const bypass of ['\nfetch("/raw")','\nfunction requestJson(){}']){const changed=[...args];changed[0]+=bypass;assert.ok(checkSteamRefunds(...changed).length,bypass);}
  for(const marker of ['`steam-config`','`steam-query`','`steam-history`','`CompanyReadSession`','configuration','transaction query','history','refund']){const changed=[...args];changed[3]=changed[3].replaceAll(marker,'BYPASS');assert.ok(checkSteamRefunds(...changed).length,marker);}
});
