import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkLogSearch} from '../check-architecture.mjs';

const read = path => readFileSync(resolve(root,path),'utf8');

test('CS log configuration and status reads cannot bypass the common observation session',()=>{
  const args=[read('apps/cs/public/playfab-logs.js'),read('apps/cs/public/playfab-logs.html'),read('apps/cs/public/playfab-logs.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/cs-log-search-reads.md')];
  assert.deepEqual(checkLogSearch(...args),[]);
  for(const marker of ['CompanyReadSession.create()',"Object.freeze(['log-bootstrap', 'log-status'])","const LOG_READ_PATHS = new Set(['/api/config', '/api/playfab/log-search/config', '/api/playfab/log-search/status']);","const LOG_MUTATION_PATHS = new Set(['/api/playfab/log-search/search', '/api/playfab/log-search/cancel']);",'readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkLogSearch(...changed).length,marker);
  }
  for(const bypass of ['\nfetch("/raw")','\nfunction requestJson(){}','\nfunction apiPost(){}']){
    const changed=[...args];changed[0]+=bypass;assert.ok(checkLogSearch(...changed).length,bypass);
  }
  for(const marker of ['`log-bootstrap`','`log-status`','`CompanyReadSession`','configuration','status','search','cancel']){
    const changed=[...args];changed[4]=changed[4].replaceAll(marker,'BYPASS');assert.ok(checkLogSearch(...changed).length,marker);
  }
});
