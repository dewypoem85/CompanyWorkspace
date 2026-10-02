import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const read=path=>readFileSync(resolve(root,path),'utf8');

test('server-rendered workspace pages opt into reduced-motion-aware same-origin transitions',()=>{
  const css=read('packages/workspace-ui/src/company-workspace.css');
  assert.match(css,/@view-transition\s*\{\s*navigation:auto;\s*\}/);
  assert.match(css,/view-transition-name:cw-workspace-header/);
  assert.match(css,/view-transition-name:cw-workspace-sidebar/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*::view-transition-old\(root\)[\s\S]*animation:none/);
  for(const page of ['apps/portal/Pages/Shared/_Layout.cshtml','apps/leave/Pages/Shared/_Layout.cshtml','apps/cs/public/index.html','apps/cs/public/product-commands.html','apps/cs/public/playfab-logs.html','apps/cs/public/player-data.html']) {
    assert.match(read(page),/company-workspace\.css/,page);
  }
});

test('CS inner topbar remains in flow below the shared header',()=>{
  const css=read('packages/workspace-ui/src/company-workspace.css');
  assert.doesNotMatch(css,/company-service-cs \.workspace-topbar\s*\{[^}]*top:var\(--cw-header-height\)/);
  assert.match(css,/html body \.workspace-topbar[^}]*position:relative; top:0/);
});
