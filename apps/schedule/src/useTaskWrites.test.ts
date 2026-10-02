// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useTaskWrites} from './useTaskWrites';
import {taskSnapshot} from './taskReview';
import type {Detail} from './types';
import type {ConfirmOptions} from './generated/workspace-confirm';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Options=Parameters<typeof useTaskWrites>[0];
let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useTaskWrites>,latest:Detail;
const fetchMock=vi.fn(),confirmMock=vi.fn();
function Harness(){state=useTaskWrites(options);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
const flush=async()=>act(async()=>{});
function acknowledgement(){
  const task={...latest.task,...options.draft.form,version:2,updatedAt:'2026-09-11T01:00:00Z'};
  latest={...latest,task,editing:{actorId:'1',stateToken:'b'.repeat(64)}};
  return Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'확인',data:{operation:'update',actorId:'1',previousStateToken:'a'.repeat(64),stateToken:'b'.repeat(64),task,attachments:[],navigateTo:'/tasks/101'}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
}
beforeEach(()=>{
  vi.resetAllMocks();vi.useRealTimers();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);
  Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});
  const me={id:1,name:'직원',department:'',departmentId:null,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
  latest={task:{id:101,title:'업무',body:'원문 9223372036854775807',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z'},canEdit:true,comments:[],attachments:[],history:[],editing:{actorId:'1',stateToken:'a'.repeat(64)}};
  const boot={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'synthetic'};
  options={id:101,boot,draft:taskSnapshot(latest),baseline:structuredClone(latest),detail:structuredClone(latest),blocked:()=>false,hasDraft:true,
    refreshIdentity:vi.fn(async()=>boot),readDetail:vi.fn(async()=>structuredClone(latest)),changed:vi.fn(async()=>{}),committed:vi.fn(),refreshed:vi.fn(),review:vi.fn()};
  options.draft.form.title='내 초안';fetchMock.mockImplementation(async()=>acknowledgement());
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();vi.useRealTimers();});

test('validated ACK commits once and a failed follow-up read only retries GET, preserving the exact draft',async()=>{
  await render();(options.readDetail as ReturnType<typeof vi.fn>).mockResolvedValueOnce(structuredClone(latest)).mockRejectedValueOnce(Error('offline')).mockImplementation(async()=>structuredClone(latest));
  await act(async()=>{await state.run();});expect(options.committed).toHaveBeenCalledOnce();expect(options.refreshed).not.toHaveBeenCalled();expect(state.needsRefresh).toBe(true);expect(state.outcome?.kind).toBe('success');
  expect(options.draft.form.body).toBe('원문 9223372036854775807');
  await act(async()=>{await state.run();await state.refreshSaved();});expect(fetchMock).toHaveBeenCalledOnce();expect(options.refreshed).toHaveBeenCalledOnce();expect(state.needsRefresh).toBe(false);
  const [,request]=fetchMock.mock.calls[0];expect(request.headers.get('X-Workspace-State')).toBe('a'.repeat(64));expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(request.headers.get('X-CSRF-TOKEN')).toBe('synthetic');
});

test.each(['draft','actor','baseline'])('preflight %s changes send no request and retain the original input',async kind=>{
  await render();let release!:(value:Detail)=>void;(options.readDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>new Promise(done=>release=done));
  let pending!:Promise<void>;act(()=>{pending=state.run();});await flush();
  if(kind==='draft')options={...options,draft:{...options.draft,form:{...options.draft.form,title:'나중 초안'}}};
  if(kind==='actor')options={...options,boot:{...options.boot,me:{...options.boot.me,id:2}}};
  if(kind==='baseline')latest={...latest,editing:{actorId:'1',stateToken:'c'.repeat(64)}};
  await render();await act(async()=>{release(latest);await pending;});expect(fetchMock).not.toHaveBeenCalled();expect(options.committed).not.toHaveBeenCalled();expect(options.draft.form.body).toContain('9223372036854775807');expect(state.busy).toBe(false);expect(state.outcome?.kind).not.toBe('loading');
});

test('a newer detail while confirming invalidates intent and never submits the stale baseline',async()=>{
  let confirmOptions!:ConfirmOptions,release!:(value:{confirmation:string})=>void;
  confirmMock.mockImplementation((value:ConfirmOptions)=>{confirmOptions=value;return new Promise(done=>release=done);});await render();
  let pending!:Promise<void>;act(()=>{pending=state.run();});await flush();expect(confirmOptions.validate?.({confirmation:''})).toBeNull();
  options={...options,detail:{...latest,editing:{actorId:'1',stateToken:'c'.repeat(64)}}};await render();expect(confirmOptions.validate?.({confirmation:''})).toContain('변경');
  await act(async()=>{release({confirmation:''});await pending;});expect(fetchMock).not.toHaveBeenCalled();expect(state.busy).toBe(false);
});

test('a newly unassigned task requires a separate checked confirmation before the normal save confirmation',async()=>{
  options={...options,id:undefined,baseline:undefined,detail:undefined,draft:{...options.draft,form:{...options.draft.form,projectId:null,version:0}}};
  confirmMock.mockResolvedValueOnce({confirmation:''}).mockResolvedValueOnce(null);await render();
  await act(async()=>{await state.run();});
  expect(confirmMock).toHaveBeenCalledTimes(2);
  expect(confirmMock.mock.calls[0][0]).toMatchObject({title:'프로젝트를 지정하지 않고 저장할까요?',confirmLabel:'미지정으로 계속'});
  expect(confirmMock.mock.calls[0][0].details).toContainEqual({label:'프로젝트',value:'프로젝트 미지정'});
  expect(confirmMock.mock.calls[1][0]).toMatchObject({title:'새 업무를 등록할까요?',confirmLabel:'저장 확인'});
  expect(fetchMock).not.toHaveBeenCalled();expect(state.busy).toBe(false);
});

test('editing an already unassigned task does not repeat the unassigned warning',async()=>{
  confirmMock.mockResolvedValueOnce(null);await render();await act(async()=>{await state.run();});
  expect(confirmMock).toHaveBeenCalledOnce();expect(confirmMock.mock.calls[0][0]).toMatchObject({title:'업무 변경을 저장할까요?'});
  expect(fetchMock).not.toHaveBeenCalled();expect(state.busy).toBe(false);
});

test('removing an existing project requires the separate unassigned confirmation',async()=>{
  latest={...latest,task:{...latest.task,projectId:10}};
  const assigned=taskSnapshot(latest);
  options={...options,baseline:structuredClone(latest),detail:structuredClone(latest),draft:{...assigned,form:{...assigned.form,title:'내 초안',projectId:null}}};
  confirmMock.mockResolvedValueOnce(null);await render();await act(async()=>{await state.run();});
  expect(confirmMock).toHaveBeenCalledOnce();expect(confirmMock.mock.calls[0][0]).toMatchObject({title:'프로젝트를 지정하지 않고 저장할까요?'});
  expect(fetchMock).not.toHaveBeenCalled();expect(state.busy).toBe(false);
});

test.each(['timeout','scope','pagehide','unmount','route'])('%s during a sent request rejects late ACK and cannot unlock the document through a GET',async kind=>{
  vi.useFakeTimers();let release!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>release=done));await render();
  let pending!:Promise<void>;act(()=>{pending=state.run();});await flush();expect(fetchMock).toHaveBeenCalledOnce();
  if(kind==='timeout')await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
  if(kind==='scope')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(kind==='pagehide')act(()=>window.dispatchEvent(new Event('pagehide')));
  if(kind==='unmount'){act(()=>root!.unmount());root=undefined;}
  if(kind==='route'){options={...options,id:102};await render();}
  await act(async()=>{release(acknowledgement());await pending;});expect(options.committed).not.toHaveBeenCalled();expect(options.refreshed).not.toHaveBeenCalled();
  if(kind!=='unmount'){
    expect(state.busy).toBe(false);expect(state.recover(latest,options.boot)).toBe(false);
    await act(async()=>{await state.run();});expect(fetchMock).toHaveBeenCalledOnce();
  }
});
