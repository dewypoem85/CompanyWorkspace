import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { outputs, root } from '../build-ui.mjs';

test('the supplied company logo owns the shared brand and browser tab icon',()=>{
  const source=readFileSync(resolve(root,'packages/workspace-ui/assets/company-logo.png'));
  const generated=outputs();
  const published=generated.get('apps/portal/wwwroot/images/company-logo.png');
  const shell=generated.get('apps/portal/wwwroot/js/company-workspace.js');
  const layout=readFileSync(resolve(root,'apps/portal/Pages/Shared/_Layout.cshtml'),'utf8');

  assert.ok(Buffer.isBuffer(published));
  assert.deepEqual(published,source,'the published PNG must remain byte-identical to the supplied logo');
  assert.match(shell,/const COMPANY_LOGO = BASE \+ '\/images\/company-logo\.png'/);
  assert.doesNotMatch(shell,/__COMPANY_LOGO_DATA_URI__/);
  assert.doesNotMatch(shell,/data:image\/png;base64,/);
  assert.match(shell,/favicon\.setAttribute\('type','image\/png'\)/);
  assert.match(shell,/logoImage\.src=COMPANY_LOGO/);
  assert.match(shell,/logoImage\.addEventListener\('error'/);
  assert.match(shell,/<span class="cw-logo"><\/span>/,'fallback text must not sit behind the transparent logo image');
  assert.match(shell,/logoImage\.remove\(\);logo\.textContent='96'/,'fallback text is only shown when the logo image fails');
  assert.match(layout,/company-logo\.png[^>]+type="image\/png"/);
});
