import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {checkProductCommands} from '../check-architecture.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');

test('CS product configuration, preview and lookup cannot bypass the common observation session',()=>{
  const args=[read('apps/cs/public/product-commands.js'),read('apps/cs/public/product-commands.html'),read('apps/cs/public/product-commands.css'),read('apps/cs/public/styles.css'),read('packages/workspace-ui/src/primitives.css'),read('packages/contracts/cs-product-command-reads.md')];
  assert.deepEqual(checkProductCommands(...args),[]);
  for(const marker of ['CompanyReadSession.create()',"Object.freeze(['product-bootstrap', 'product-preview', 'product-lookup'])","const PRODUCT_READ_PATHS = new Set(['/api/config', '/api/playfab/product-commands/config', '/api/playfab/product-commands/preview', '/api/playfab/product-commands/lookup']);","const PRODUCT_MUTATION_PATHS = new Set(['/api/playfab/product-commands/execute', '/api/playfab/product-commands/delete']);",'readSession.run(channel','readSession.cancel(channel)','readSession.dispose()','result.isCurrent?.()','signal.throwIfAborted()']){
    const changed=[...args];changed[0]=changed[0].replaceAll(marker,'BYPASS');assert.ok(checkProductCommands(...changed).length,marker);
  }
  for(const bypass of ['\nfetch("/raw")','\nfunction requestJson(){}']){const changed=[...args];changed[0]+=bypass;assert.ok(checkProductCommands(...changed).length,bypass);}
  for(const marker of ['`product-bootstrap`','`product-preview`','`product-lookup`','`CompanyReadSession`','configuration','preview','lookup','execute','delete']){const changed=[...args];changed[5]=changed[5].replaceAll(marker,'BYPASS');assert.ok(checkProductCommands(...changed).length,marker);}
});
