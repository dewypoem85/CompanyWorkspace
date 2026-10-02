import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';

const source=readFileSync(resolve(root,'apps/leave/wwwroot/js/leave-dashboard-read.js'),'utf8');
function fixture(t,fetch){
  const dom=new JSDOM('',{runScripts:'outside-only',url:'https://leave.workspace.test/Leave/Index'});
  t.after(()=>dom.window.close());dom.window.fetch=fetch;dom.window.eval(source);return dom.window;
}
const response=(overrides={})=>({ok:true,status:200,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>'<section id="calendarArea"></section>',...overrides});

test('leave dashboard transport sends one bounded same-origin HTML request',async t=>{
  const calls=[],w=fixture(t,async(...args)=>{calls.push(args);return response();}),controller=new w.AbortController();
  const html=await w.LeaveDashboardRead.read('/Leave/Index?Year=2026&Month=9&SelfOnly=true',controller.signal);
  assert.match(html,/calendarArea/);assert.equal(calls.length,1);
  const [url,init]=calls[0];assert.equal(url.origin,'https://leave.workspace.test');assert.equal(url.searchParams.get('Year'),'2026');
  assert.deepEqual({...init.headers},{'X-Requested-With':'XMLHttpRequest',Accept:'text/html'});assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal,controller.signal);
});

test('leave dashboard transport rejects foreign, malformed and unexpected routes before rendering',async t=>{
  let calls=0,w=fixture(t,async()=>{calls++;return response();});
  for(const url of ['https://evil.example/Leave','/Admin/Users','/Leave#private','/Leave?handler=Delete','/Leave?Year=2026&Year=2027'])await assert.rejects(w.LeaveDashboardRead.read(url),/주소/);
  assert.equal(calls,0);
  w.fetch=async()=>response({ok:false,status:403});await assert.rejects(w.LeaveDashboardRead.read('/Leave'),/HTTP 403/);
  w.fetch=async()=>response({headers:{get:()=> 'application/json'}});await assert.rejects(w.LeaveDashboardRead.read('/Leave'),/올바른 연차 조회 응답/);
});

test('leave dashboard transport checks cancellation after consuming the HTML body',async t=>{
  let controller;const w=fixture(t,async()=>response({text:async()=>{controller.abort();return '<main></main>';}}));controller=new w.AbortController();
  await assert.rejects(w.LeaveDashboardRead.read('/Leave',controller.signal),error=>error?.name==='AbortError');
});
