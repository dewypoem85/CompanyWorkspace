import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkPlayerMutations} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('CS player configuration and lookup cannot bypass the common observation session',()=>{
  const args=[read('apps/cs/public/player-data.js'),read('apps/cs/public/player-data.html'),read('apps/cs/public/player-data.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/cs-player-data-reads.md')];
  assert.deepEqual(checkPlayerMutations(...args),[]);
  for(const marker of ['CompanyReadSession.create()',"Object.freeze(['player-bootstrap', 'player-lookup'])","const PLAYER_READ_PATHS = new Set(['/api/config', '/api/playfab/player-data/config', '/api/playfab/player-data/lookup']);","const PLAYER_MUTATION_PATHS = new Set(['/api/playfab/player-data/save', '/api/playfab/player-data/add', '/api/playfab/player-data/delete']);",'readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkPlayerMutations(...changed).length,marker);
  }
  for(const bypass of ['\nfetch("/raw")','\nfunction apiRequest(){}']){const changed=[...args];changed[0]+=bypass;assert.ok(checkPlayerMutations(...changed).length,bypass);}
  for(const marker of ['`player-bootstrap`','`player-lookup`','`CompanyReadSession`','configuration','lookup','save','add','delete']){const changed=[...args];changed[4]=changed[4].replaceAll(marker,'BYPASS');assert.ok(checkPlayerMutations(...changed).length,marker);}
});
