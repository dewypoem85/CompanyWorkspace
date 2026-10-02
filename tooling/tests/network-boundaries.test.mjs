import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
import {collectNetworkCalls,compareNetworkPolicy,networkCalls} from '../check-network-boundaries.mjs';

const policy=()=>JSON.parse(readFileSync(resolve(root,'packages/contracts/network-boundaries.json'),'utf8'));

test('all authored browser fetches belong to a reviewed transport boundary',()=>{
  const {calls}=collectNetworkCalls();
  assert.deepEqual(compareNetworkPolicy(calls,policy()),[]);
  assert.equal(calls.length,17);
  assert.equal(new Set(calls.map(call=>call.path)).size,17);
});

test('new page fetches and increases in an existing owner fail closed',()=>{
  const {calls}=collectNetworkCalls(),current=policy();
  assert.match(compareNetworkPolicy([...calls,{path:'apps/portal/Pages/NewTool.cshtml',line:1}],current).join('\n'),/not assigned/);
  assert.match(compareNetworkPolicy([...calls,{...calls[0],line:999}],current).join('\n'),/count changed/);
  assert.equal(networkCalls('apps/portal/Pages/NewTool.cshtml','<!-- fetch(ignored) --><script>fetch("/api/private")</script>').length,1);
  for(const bypass of ['new XMLHttpRequest()','axios.post("/api/private")','navigator.sendBeacon("/api/private")'])
    assert.equal(networkCalls('apps/portal/Pages/NewTool.cshtml',`<script>${bypass}</script>`).length,1,bypass);
});

test('computed and indirect browser transports cannot bypass the inventory',()=>{
  const variants=[
    `window['fetch']('/api/private')`,
    `globalThis["fetch"].call(window,'/api/private')`,
    `self.fetch.apply(self,['/api/private'])`,
    `window.fetch.bind(window)('/api/private')`,
    `new window.XMLHttpRequest()`,
    `new globalThis['XMLHttpRequest']()`,
    `axios['post']('/api/private')`,
    `navigator['sendBeacon']('/api/private')`,
    `Reflect.get(window,'fetch')('/api/private')`,
    `Reflect.get(navigator,"sendBeacon")('/api/private')`
  ];
  for(const bypass of variants)assert.equal(networkCalls('apps/portal/Pages/NewTool.cshtml',`<script>${bypass}</script>`).length,1,bypass);
  assert.equal(networkCalls('apps/portal/Pages/NewTool.cshtml',`<!-- window['fetch']('/ignored') --><script>// fetch('/ignored')\nconst label='fetch';</script>`).length,0);
});

test('retired, malformed and unsorted policy entries cannot become exceptions',()=>{
  const {calls}=collectNetworkCalls(),current=policy(),first=current.entries[0];
  assert.match(compareNetworkPolicy(calls.filter(call=>call.path!==first.path),current).join('\n'),/retired/);
  assert.match(compareNetworkPolicy(calls,{...current,sealed:false}).join('\n'),/Invalid sealed/);
  assert.match(compareNetworkPolicy(calls,{...current,entries:[...current.entries].reverse()}).join('\n'),/sorted/);
  assert.match(compareNetworkPolicy(calls,{...current,entries:[{...first,contract:'packages/contracts/missing.md'},...current.entries.slice(1)]}).join('\n'),/Invalid or duplicate/);
});
