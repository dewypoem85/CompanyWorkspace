// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import {usePlanningWrites} from './usePlanningWrites';
import type {Bootstrap} from './types';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,node:HTMLDivElement,state:ReturnType<typeof usePlanningWrites>;
const fetchMock=vi.fn(),changed=vi.fn(async()=>{});
const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[10],role:'employee' as const,active:true,shared:false,access:true,isAdmin:false};
const boot:Bootstrap={me,employees:[me],departments:[],leads:[],projects:[],goals:[],demo:false,csrfToken:'synthetic'};
function Harness(){state=usePlanningWrites(boot,changed);return null;}

beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);vi.stubGlobal('fetch',fetchMock);
  fetchMock.mockImplementation(async(input,init)=>Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'저장',data:{operation:String(input).includes('work-goals')?'goal-create':String(input).includes('shared-todos')?'todo-create':'schedule-create',value:{id:1}}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}}));
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();});

test('planning writes register their document owner and allow TODO and detailed schedule requests',async()=>{
  await act(async()=>root!.render(createElement(Harness)));
  let todo=false,schedule=false;
  await act(async()=>{todo=await state.run('todo-create','/api/tasks/101/shared-todos','POST',{title:'공용 확인',version:0});});
  await act(async()=>{schedule=await state.run('schedule-create','/api/tasks/101/schedule-items','POST',{title:'상세 확인',date:'2026-09-14',version:0});});
  expect(todo).toBe(true);expect(schedule).toBe(true);expect(fetchMock).toHaveBeenCalledTimes(2);expect(changed).toHaveBeenCalledTimes(2);
  for(const [,request] of fetchMock.mock.calls){expect(request.headers.get('X-CSRF-TOKEN')).toBe('synthetic');expect(request.headers.get('X-Workspace-Actor')).toBe('1');}
  expect(state.outcome?.kind).toBe('success');
});

test('reopened goal panel can create another goal without reusing a spent request key',async()=>{
  await act(async()=>root!.render(createElement(Harness)));
  await act(async()=>{expect(await state.run('goal-create','/api/work-goals','POST',{title:'첫 목표',version:0})).toBe(true);});
  act(()=>root!.unmount());root=createRoot(node);
  await act(async()=>root!.render(createElement(Harness)));
  await act(async()=>{expect(await state.run('goal-create','/api/work-goals','POST',{title:'다음 목표',version:0})).toBe(true);});
  expect(fetchMock).toHaveBeenCalledTimes(2);expect(changed).toHaveBeenCalledTimes(2);
});
