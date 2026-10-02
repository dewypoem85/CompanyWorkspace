import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from '../build-ui.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t){const dom=new JSDOM('',{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.eval(readFileSync(resolve(root,'packages/workspace-ui/src/read-session.js'),'utf8'));const s=dom.window.CompanyReadSession.create();t.after(()=>s.dispose());return s;}
test('common reads invalidate delivered tickets and supersede ignored aborts without cancelling other channels',async t=>{
  const s=fixture(t);let release,signal;
  const old=s.run('board',s=>{signal=s;return new Promise(done=>release=done);});await tick();
  const next=await s.run('board',async()=>2),other=await s.run('identity',async()=>3);
  assert.equal((await old).status,'cancelled');assert.equal(signal.aborted,true);release(1);
  assert.equal(next.value,2);assert.equal(next.isCurrent(),true);assert.equal(other.isCurrent(),true);
  s.cancel('board');assert.equal(next.isCurrent(),false);assert.equal(other.isCurrent(),true);
  s.dispose();assert.equal(other.isCurrent(),false);assert.equal((await s.run('identity',async()=>4)).status,'cancelled');
});
test('common read timeout settles non-abortable work once and permits an explicit fresh read',async t=>{
  const s=fixture(t);let release;
  const result=await s.run('board',()=>new Promise(done=>release=done),5);
  assert.equal(result.status,'error');assert.match(result.error.message,/초과/);assert.equal(result.isCurrent(),true);
  const fresh=await s.run('board',async()=>8);release(9);await tick();assert.equal(result.isCurrent(),false);assert.equal(fresh.value,8);
});
test('read failures and synchronous throws are observable only until a newer ticket starts',async t=>{
  const s=fixture(t);const result=await s.run('x',()=>{throw Error('test');});assert.equal(result.status,'error');assert.equal(result.error.message,'test');
  const next=s.run('x',()=>new Promise(()=>{}));s.cancel('x');assert.equal((await next).status,'cancelled');assert.equal(result.isCurrent(),false);
  await assert.rejects(s.run('',async()=>1));await assert.rejects(s.run('x',async()=>1,0));
});
