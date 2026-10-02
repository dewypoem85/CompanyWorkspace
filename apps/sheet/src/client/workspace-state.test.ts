// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { WorkspaceState, type WorkspaceStateProps } from './generated/workspace-state';

const container=document.createElement('div');document.body.append(container);
const scope=window as unknown as {CompanyState?:{render:(node:HTMLElement,props:WorkspaceStateProps)=>void}};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;container.replaceChildren();delete scope.CompanyState;});

test('React state adapter delegates all state props and updates callbacks without replacing its mount',()=>{
  const renderer=vi.fn((node:HTMLElement,props:WorkspaceStateProps)=>{node.textContent=props.message||'';});scope.CompanyState={render:renderer};
  const first=vi.fn(),next=vi.fn();root=createRoot(container);
  act(()=>root!.render(createElement(WorkspaceState,{kind:'error',message:'조회 실패',actionLabel:'재시도',onAction:first})));
  const mount=container.firstElementChild;expect(renderer).toHaveBeenCalledOnce();
  act(()=>root!.render(createElement(WorkspaceState,{kind:'error',message:'조회 실패',actionLabel:'재시도',onAction:next})));
  expect(container.firstElementChild).toBe(mount);expect(renderer.mock.lastCall?.[1].onAction).toBe(next);
  act(()=>root!.render(createElement(WorkspaceState,{kind:'success',message:'저장 완료'})));
  expect(renderer.mock.lastCall?.[1].kind).toBe('success');expect(container.textContent).toBe('저장 완료');
});

test('missing shared runtime still displays safe fallback text',()=>{
  root=createRoot(container);
  act(()=>root!.render(createElement(WorkspaceState,{kind:'error',message:'<img src=x> 연결 실패'})));
  expect(container.textContent).toBe('<img src=x> 연결 실패');expect(container.querySelector('img')).toBeNull();
});
