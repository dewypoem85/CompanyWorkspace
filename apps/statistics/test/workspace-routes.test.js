import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROUTES, PAGE_FILES } from '../public/workspace-routes.js';

test('all statistics views share the generated server route contract',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const routes=new Map(PAGE_FILES);
  for(const [view,definition] of Object.entries(ROUTES)){
    assert.ok(html.includes(`data-page="${view}"`));
    for(const path of [definition.path,...definition.aliases])assert.equal(routes.get(path)?.[0],'index.html');
  }
  assert.equal(routes.has('/api/config'),false);
  assert.equal(routes.has('/auth/sso/callback'),false);
  assert.equal(ROUTES.buildDetail.path,'/builds/detail');assert.equal(ROUTES.bossDetail.path,'/bosses/detail');
});
