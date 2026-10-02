import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import {root} from '../build-ui.mjs';

function fixture(t){
  const dom=new JSDOM('<button id="copy">복사</button><p id="selected">유지할 선택</p>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
  w.eval(readFileSync(resolve(root,'packages/workspace-ui/src/clipboard.js'),'utf8'));
  t.after(()=>w.close());return {w,d};
}

test('shared clipboard prefers the native API without creating a fallback field',async t=>{
  const {w,d}=fixture(t);const calls=[];
  Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async value=>calls.push(value)}});
  d.execCommand=()=>{throw Error('fallback must not run');};
  await w.CompanyClipboard.copyText('정확한 값 9223372036854775807');
  assert.deepEqual(calls,['정확한 값 9223372036854775807']);assert.equal(d.querySelector('textarea'),null);
});

test('shared clipboard fallback preserves focus and selection and always removes its field',async t=>{
  const {w,d}=fixture(t);Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:undefined});
  const button=d.querySelector('#copy'),clone={},selection={rangeCount:1,getRangeAt:()=>({cloneRange:()=>clone}),removed:0,added:[],removeAllRanges(){this.removed++;},addRange(range){this.added.push(range);}};button.focus();Object.defineProperty(d,'getSelection',{configurable:true,value:()=>selection});
  let copied='';d.execCommand=command=>{const field=d.querySelector('textarea');assert.equal(command,'copy');assert.equal(field.readOnly,true);assert.equal(field.tabIndex,-1);assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,field.value.length);copied=field.value;return true;};
  await w.CompanyClipboard.copyText('fallback 원문');
  assert.equal(copied,'fallback 원문');assert.equal(d.querySelector('textarea'),null);assert.equal(d.activeElement,button);assert.equal(selection.removed,1);assert.deepEqual(selection.added,[clone]);
});

for(const failure of ['rejected','unsupported'])test(`shared clipboard ${failure} fallback fails closed after cleanup`,async t=>{
  const {w,d}=fixture(t);Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:undefined});const button=d.querySelector('#copy');button.focus();
  if(failure==='rejected')d.execCommand=()=>false;
  await assert.rejects(()=>w.CompanyClipboard.copyText('보존할 값'),/클립보드 복사/);
  assert.equal(d.querySelector('textarea'),null);assert.equal(d.activeElement,button);
});
