import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';

const source=readFileSync(resolve(root,'apps/portal/wwwroot/js/account-review.js'),'utf8');
function fixture(t,fetch){
  const dom=new JSDOM('',{runScripts:'outside-only',url:'https://company.workspace.test/Admin/Users'});
  t.after(()=>dom.window.close());dom.window.fetch=fetch;dom.window.eval(source);return dom.window;
}
const response=(overrides={})=>({ok:true,status:200,headers:{get:()=> 'application/vnd.company.workspace-form+json; charset=utf-8'},json:async()=>({protocol:'workspace-form-v1',outcome:'snapshot',data:{accounts:[]}}),...overrides});

test('account review transport sends one same-origin checked request',async t=>{
  const calls=[],w=fixture(t,async(...args)=>{calls.push(args);return response();}),controller=new w.AbortController();
  const value=await w.CompanyAccountReview.read('/Admin/Users?handler=Review&ids=9007199254740993',controller.signal);
  assert.equal(value.outcome,'snapshot');assert.equal(calls.length,1);
  const [url,init]=calls[0];assert.equal(url.origin,'https://company.workspace.test');assert.equal(url.searchParams.get('ids'),'9007199254740993');
  assert.deepEqual({...init.headers},{Accept:w.CompanyAccountReview.mediaType,'X-Requested-With':'XMLHttpRequest'});
  assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'manual');assert.equal(init.signal,controller.signal);
});

test('account review transport rejects cross-origin, denied and malformed responses',async t=>{
  let calls=0,w=fixture(t,async()=>{calls++;return response();});
  await assert.rejects(w.CompanyAccountReview.read('https://evil.example/api'),/주소/);assert.equal(calls,0);
  w.fetch=async()=>response({ok:false,status:403});await assert.rejects(w.CompanyAccountReview.read('/Admin/Users'),/수정 권한/);
  w.fetch=async()=>response({headers:{get:()=> 'text/html'}});await assert.rejects(w.CompanyAccountReview.read('/Admin/Users'),/올바른 서버 응답/);
  w.fetch=async()=>response({json:async()=>{throw Error('broken json');}});await assert.rejects(w.CompanyAccountReview.read('/Admin/Users'),/broken json/);
});

test('account review transport checks cancellation after consuming JSON',async t=>{
  let controller;const w=fixture(t,async()=>response({json:async()=>{controller.abort();return {protocol:'workspace-form-v1'};}}));controller=new w.AbortController();
  await assert.rejects(w.CompanyAccountReview.read('/Admin/Users',controller.signal),error=>error?.name==='AbortError');
});
