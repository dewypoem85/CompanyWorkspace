import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {root} from '../build-ui.mjs';

const read=path=>readFileSync(resolve(root,path),'utf8');
const catalog={...JSON.parse(read('packages/contracts/services.json')),...JSON.parse(read('packages/contracts/pages.json'))};
const nextHtml='<!doctype html><html lang="ko"><head><title>직원 사용 통계 - 연차관리</title></head><body><div data-company-workspace data-company-service="leave"></div><main data-workspace-view="leave.employee.usage" data-workspace-identity="17" data-workspace-role="admin"><h1>직원 사용 통계</h1></main><div data-workspace-page-scripts></div></body></html>';

function fixture(t,html=nextHtml) {
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>직원 연결 현황 - 연차관리</title></head><body><div data-company-workspace data-company-service="leave"></div><header id="shell"></header><aside><a data-cw-soft-route href="/Admin/Usage">직원 사용 통계</a></aside><main data-workspace-view="leave.employees" data-workspace-identity="17" data-workspace-role="admin"><h1>직원 연결 현황</h1></main><div data-workspace-page-scripts></div></body></html>',{url:'https://leave.example.test/Admin/Employees',runScripts:'outside-only',virtualConsole});
  t.after(()=>dom.window.close());
  const {window}=dom;
  window.CompanyPageCatalog=structuredClone(catalog);
  window.scrollTo=()=>{};
  let reads=0;
  window.fetch=async()=>{reads++;return {ok:true,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>html};};
  window.eval(read('packages/workspace-ui/src/read-session.js'));
  window.eval(read('packages/workspace-ui/src/page-router.js'));
  return {window,reads:()=>reads,errors};
}

const settle=window=>new Promise(resolve=>window.setTimeout(resolve,25));

test('same-service registered pages replace only the body outlet and retain shell',async t=>{
  const {window,reads}=fixture(t);
  await settle(window);
  const shell=window.document.getElementById('shell');
  const link=window.document.querySelector('[data-cw-soft-route]');
  link.dispatchEvent(new window.MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  await settle(window);
  assert.equal(reads(),1);
  assert.equal(window.document.getElementById('shell'),shell);
  assert.equal(window.location.pathname,'/Admin/Usage');
  assert.equal(window.document.querySelector('[data-workspace-view]').dataset.workspaceView,'leave.employee.usage');
  assert.equal(window.document.title,'직원 사용 통계 - 연차관리');
});

test('different account response never replaces the current page',async t=>{
  const {window,errors}=fixture(t,nextHtml.replace('data-workspace-identity="17"','data-workspace-identity="23"'));
  await settle(window);
  window.CompanyPageRouter.navigate(new URL('/Admin/Usage',window.location.href)).catch(()=>{});
  await settle(window);
  assert.equal(window.document.querySelector('[data-workspace-view]').dataset.workspaceView,'leave.employees');
  assert.equal(errors.length,1,'identity mismatch must request a regular document navigation');
});

test('a cancelled draft confirmation never changes the page or URL',async t=>{
  const {window}=fixture(t);
  window.CompanyPageRouter.register('leave.employees',{beforeLeave:()=>null});
  await settle(window);
  window.document.querySelector('[data-cw-soft-route]').dispatchEvent(new window.MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  await settle(window);
  assert.equal(window.location.pathname,'/Admin/Employees');
  assert.equal(window.document.querySelector('[data-workspace-view]').dataset.workspaceView,'leave.employees');
});

test('slow page reads retain the old view and a changed account discards the late response',async t=>{
  const {window,errors}=fixture(t);
  await settle(window);
  const originalFetch=window.fetch;
  let release;
  window.fetch=()=>new Promise(resolve=>{release=()=>resolve(originalFetch());});
  window.document.querySelector('[data-cw-soft-route]').dispatchEvent(new window.MouseEvent('click',{button:0,bubbles:true,cancelable:true}));
  await settle(window);
  assert.equal(window.document.querySelector('[data-workspace-view]').dataset.workspaceView,'leave.employees');
  assert.equal(window.location.pathname,'/Admin/Employees');
  window.document.dispatchEvent(new window.Event('company-context'));
  release();
  await settle(window);
  assert.equal(window.document.querySelector('[data-workspace-view]').dataset.workspaceView,'leave.employees');
  assert.equal(window.location.pathname,'/Admin/Employees');
  assert.deepEqual(errors,[]);
});
