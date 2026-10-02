import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t){
  const dom=new JSDOM('',{url:'https://company.workspace.test',runScripts:'outside-only'}),w=dom.window;
  w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/forms.js'),'utf8'));
  const session=w.CompanyForm.createSession();session.track('first');session.track('second');
  t.after(()=>{session.dispose();w.close();});return {w,session};
}
test('one shared lease serializes confirmation and writes without locking independent saved work',t=>{
  const {session:s}=fixture(t),key='leave-request:9007199254740995:baseline';
  const lease=s.begin('first',[key]);assert.equal(lease.current,true);assert.equal(s.pending,true);
  assert.equal(s.blocked('first'),false);assert.equal(s.blocked('second'),true);
  assert.equal(s.begin('first'),null);assert.equal(s.begin('second'),null);
  assert.equal(lease.finish('saved'),true);assert.equal(lease.current,false);assert.equal(lease.signal.aborted,true);
  assert.equal(s.pending,false);assert.equal(s.invalid,false);assert.equal(s.blocked('second'),false);
  assert.equal(s.begin('second',[key]),null);assert.equal(s.begin('first',[key]),null);
  const next=s.begin('second',['leave-request:9007199254740997:baseline']);assert.ok(next);next.finish('saved');
  const fresh=s.begin('first',['leave-request:9007199254740995:fresh-baseline']);assert.ok(fresh);fresh.finish('cancelled');
});
for(const outcome of ['cancelled','invalid'])test(`${outcome} releases the exact lease without consuming a baseline`,t=>{
  const {session:s}=fixture(t),lease=s.begin('first',['old']);lease.finish(outcome);
  const next=s.begin('second',['old']);assert.ok(next);assert.equal(lease.finish('unknown'),false);
  assert.equal(next.current,true);assert.equal(s.invalid,false);next.finish('saved');
});
test('an unconfirmed result locks all owners without clearing their drafts or retrying',t=>{
  const {session:s}=fixture(t);let dirty=true;s.track('draft',()=>dirty);
  s.begin('first',['old']).finish('unknown');assert.equal(s.invalid,true);assert.equal(s.pending,false);
  assert.equal(s.begin('second',['other']),null);assert.equal(s.hasDraftExcept('first'),true);
  dirty=false;assert.equal(s.hasDraftExcept('first'),false);assert.equal(s.blocked('second'),true);
});
test('scope change and non-persisted disposal retire old leases permanently',t=>{
  const {w,session:s}=fixture(t),lease=s.begin('first');
  w.document.dispatchEvent(new w.Event('workspace-entity-scope-change'));
  assert.equal(lease.signal.aborted,true);assert.equal(lease.current,false);assert.equal(lease.finish('saved'),false);
  assert.equal(s.invalid,true);assert.equal(s.begin('second'),null);s.invalidate();s.dispose();s.dispose();
  assert.equal(s.begin('first'),null);
});
test('bfcache pagehide keeps the document session; real pagehide disposes and unsubscribes',async t=>{
  const {w,session:s}=fixture(t);let changes=0;s.subscribe(()=>changes++);
  const lease=s.begin('first');await tick();const previous=changes;
  w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(lease.current,true);
  w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(lease.current,false);
  assert.equal(lease.signal.aborted,true);assert.equal(lease.finish('saved'),false);
  await tick();assert.equal(changes,previous);assert.equal(s.invalid,true);
});
test('draft ownership excludes only the supplied owner and fails closed if a reader throws',t=>{
  const {session:s}=fixture(t);let dirty=true;s.track('draft',()=>dirty);
  assert.equal(s.hasDraftExcept('draft'),false);assert.equal(s.hasDraftExcept('first'),true);
  dirty=false;assert.equal(s.hasDraftExcept('first'),false);s.track('broken',()=>{throw Error('removed DOM');});
  assert.equal(s.hasDraftExcept('first'),true);
});
test('subscriptions coalesce changes, isolate errors and can be removed',async t=>{
  const {session:s}=fixture(t);let changes=0;s.subscribe(()=>{throw Error('view error');});
  const unsubscribe=s.subscribe(()=>changes++);s.begin('first').finish('cancelled');await tick();assert.equal(changes,1);
  unsubscribe();s.begin('second').finish('saved');await tick();assert.equal(changes,1);
});
test('registration and resource validation reject accidental names and preserve lease ownership',t=>{
  const {session:s}=fixture(t);assert.throws(()=>s.track('first'));assert.throws(()=>s.track(''));assert.throws(()=>s.track('bad',42));
  assert.equal(s.begin('unknown'),null);assert.throws(()=>s.begin('first',['']));assert.throws(()=>s.begin('first',[123]));
  const resources=['original'],lease=s.begin('first',resources);resources[0]='changed';
  assert.throws(()=>lease.finish('success'));assert.equal(lease.current,true);lease.finish('saved');
  assert.equal(s.begin('second',['original']),null);assert.ok(s.begin('second',['changed']));
});
test('reads can reject an older revision even after a confirmed write is no longer pending',t=>{
  const {session:s}=fixture(t),before=s.revision,lease=s.begin('first');assert.notEqual(s.revision,before);
  const writing=s.revision;lease.finish('saved');assert.equal(s.pending,false);assert.equal(s.revision,writing);
  const next=s.begin('second');assert.notEqual(s.revision,writing);next.finish('cancelled');
  const latest=s.revision;s.invalidate();assert.notEqual(s.revision,latest);
});
