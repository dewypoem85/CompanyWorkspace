// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act, StrictMode, useRef, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import dialogsSource from '../../../packages/workspace-ui/src/dialogs.js?raw';
import {useWorkspaceModal} from './generated/workspace-modal';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,node:HTMLDivElement,visible=true,allowed=false,key='first';
let closeGuard:((context:{signal:AbortSignal})=>Promise<(()=>boolean)|null>)|undefined;
const onClose=vi.fn();
function Harness(){
  const ref=useRef<HTMLDialogElement>(null),[value,setValue]=useState('9223372036854775807');
  const modal=useWorkspaceModal(ref,{scope:'retain',canClose:()=>allowed,beforeCloseRequest:closeGuard,onClose});
  return <>{visible&&createPortal(<dialog ref={ref} key={key} className="cw-modal" aria-label="초안"><input value={value} onChange={e=>setValue(e.target.value)}/><button onClick={()=>modal.close()}>닫기</button></dialog>,document.body)}</>;
}
const render=()=>act(async()=>root.render(<StrictMode><Harness/></StrictMode>));
beforeEach(()=>{
  vi.resetAllMocks();visible=true;allowed=false;key='first';closeGuard=undefined;
  window.eval(dialogsSource);
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());document.body.replaceChildren();});
test('StrictMode attaches once, keeps portal ownership and reads updated guards without resetting drafts',async()=>{
  await render();const dialog=document.querySelector('dialog')!;
  expect(dialog.open).toBe(true);expect(document.querySelectorAll('dialog')).toHaveLength(1);
  await act(async()=>dialog.querySelector('button')!.click());expect(onClose).not.toHaveBeenCalled();
  allowed=true;await render();expect(document.querySelector('dialog')).toBe(dialog);expect(dialog.querySelector('input')!.value).toBe('9223372036854775807');
  await act(async()=>dialog.querySelector('button')!.click());expect(onClose).toHaveBeenCalledExactlyOnceWith('request');expect(dialog.open).toBe(false);
});
test('async close uses the shared owner, fresh guards and retains the same React draft node',async()=>{
  let resolve!:(value:(()=>boolean)|null)=>void;closeGuard=vi.fn(()=>new Promise<(()=>boolean)|null>(done=>resolve=done));allowed=true;
  await render();const dialog=document.querySelector('dialog')!;
  await act(async()=>{dialog.querySelector('button')!.click();dialog.querySelector('button')!.click();});
  expect(closeGuard).toHaveBeenCalledTimes(1);expect(dialog.open).toBe(true);expect(onClose).not.toHaveBeenCalled();
  allowed=false;await render();await act(async()=>resolve(()=>true));expect(dialog.open).toBe(true);expect(onClose).not.toHaveBeenCalled();
  allowed=true;closeGuard=vi.fn(async()=>()=>true);await render();
  await act(async()=>dialog.querySelector('button')!.click());expect(closeGuard).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledExactlyOnceWith('request');expect(dialog.querySelector('input')!.value).toBe('9223372036854775807');
});

test('async close scope and node replacement abort pending approval without closing a new owner',async()=>{
  const requests:{signal:AbortSignal;resolve:(value:(()=>boolean)|null)=>void}[]=[];
  closeGuard=({signal})=>new Promise(resolve=>requests.push({signal,resolve}));allowed=true;await render();
  const first=document.querySelector('dialog')!;await act(async()=>first.querySelector('button')!.click());
  await act(async()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));expect(requests[0].signal.aborted).toBe(true);expect(first.open).toBe(true);
  await act(async()=>first.querySelector('button')!.click());key='replacement';await render();
  const replacement=document.querySelector('dialog')!;expect(requests[1].signal.aborted).toBe(true);
  await act(async()=>requests.forEach(request=>request.resolve(()=>true)));expect(replacement.open).toBe(true);expect(onClose).not.toHaveBeenCalled();
});

test('conditional hide and key replacement dispose nodes without calling user close',async()=>{
  await render();const old=document.querySelector('dialog')!;key='second';await render();
  const next=document.querySelector('dialog')!;expect(next).not.toBe(old);expect(old.open).toBe(false);expect(next.open).toBe(true);
  visible=false;await render();expect(document.querySelector('dialog')).toBeNull();expect(next.open).toBe(false);expect(onClose).not.toHaveBeenCalled();
  visible=true;await render();expect(document.querySelector('dialog')!.open).toBe(true);
});
test('retained owner ignores scope but unmount closes outstanding shared intent',async()=>{
  await render();const shared=(window as unknown as {CompanyDialog:{confirm:(options:object)=>Promise<unknown>}}).CompanyDialog;
  let pending:Promise<unknown>;
  await act(async()=>{pending=shared.confirm({title:'저장'});document.dispatchEvent(new Event('workspace-entity-scope-change'));});
  expect(await pending!).toBeNull();expect(document.querySelector('dialog')!.open).toBe(true);expect(onClose).not.toHaveBeenCalled();
  await act(async()=>{pending=shared.confirm({title:'다시 저장'});});visible=false;await render();expect(await pending!).toBeNull();expect(document.querySelectorAll('dialog')).toHaveLength(0);
});
