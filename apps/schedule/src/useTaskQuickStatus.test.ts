// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useTaskQuickStatus} from './useTaskQuickStatus';
import type {Bootstrap,Detail,Task} from './types';
import type {ConfirmOptions} from './generated/workspace-confirm';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

type Options=Parameters<typeof useTaskQuickStatus>[0];
let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useTaskQuickStatus>,boot:Bootstrap,detail:Detail,current:Task;
const fetchMock=vi.fn(),confirmMock=vi.fn(),refreshBoard=vi.fn(),invalidate=vi.fn();
function Harness(){state=useTaskQuickStatus(options);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
const flush=async()=>act(async()=>{});
function reply(status:'done'|'progress'='done'){
  const task={...detail.task,status,version:detail.task.version+1,updatedAt:'2026-09-12T01:00:00Z'};
  return Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'상태 변경 완료',data:{operation:'status',actorId:'1',previousStateToken:'a'.repeat(64),stateToken:'b'.repeat(64),task,attachments:[],navigateTo:'/tasks/101'}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
}
beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});
  const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
  boot={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'synthetic'};
  current={id:101,title:'칸반 업무',body:'원문',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'2026-09-12T00:00:00Z',updatedAt:'2026-09-12T00:00:00Z'};
  detail={task:{...current},canEdit:true,comments:[],attachments:[],history:[],editing:{actorId:'1',stateToken:'a'.repeat(64)}};
  options={boot,disabled:false,currentTask:id=>id===current.id?current:undefined,refreshIdentity:vi.fn(async()=>boot),refreshBoard,invalidate};
  fetchMock.mockImplementation(async(_url,request)=>request?.method==='PATCH'?reply():Response.json(detail));
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();vi.useRealTimers();});

test('kanban status uses the shared checked write and refreshes only after a full acknowledgement',async()=>{
  await render();await act(async()=>state.run(current,'done'));
  expect(confirmMock).toHaveBeenCalledOnce();expect(fetchMock).toHaveBeenCalledTimes(2);expect(refreshBoard).toHaveBeenCalledOnce();expect(state.outcome).toMatchObject({kind:'success',title:'업무 상태를 변경했습니다.'});
  const [url,request]=fetchMock.mock.calls[1];expect(new URL(url).pathname).toBe('/api/tasks/101/status');expect(request.method).toBe('PATCH');expect(JSON.parse(request.body)).toEqual({status:'done',version:1});
  expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(request.headers.get('X-Workspace-State')).toBe('a'.repeat(64));expect(request.headers.get('X-CSRF-TOKEN')).toBe('synthetic');
});

test('a changed board row during preflight cannot open confirmation or write',async()=>{
  let release!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>release=done));await render();
  let pending!:Promise<void>;act(()=>{pending=state.run(current,'done');});await flush();current={...current,version:2};await render();
  await act(async()=>{release(Response.json(detail));await pending;});expect(confirmMock).not.toHaveBeenCalled();expect(fetchMock).toHaveBeenCalledOnce();expect(refreshBoard).not.toHaveBeenCalled();expect(state.busyTaskId).toBeNull();
});

test('confirmation cancellation preserves the row and sends no mutation',async()=>{
  confirmMock.mockResolvedValue(null);await render();await act(async()=>state.run(current,'done'));
  expect(fetchMock).toHaveBeenCalledOnce();expect(refreshBoard).not.toHaveBeenCalled();expect(state.outcome).toBeNull();expect(current.status).toBe('planned');
});

test('changes while confirming invalidate the intent before transmission',async()=>{
  let confirmOptions!:ConfirmOptions,release!:(value:{confirmation:string})=>void;confirmMock.mockImplementation((value:ConfirmOptions)=>{confirmOptions=value;return new Promise(done=>release=done);});await render();
  let pending!:Promise<void>;act(()=>{pending=state.run(current,'done');});await flush();expect(confirmOptions.validate?.({confirmation:''})).toBeNull();
  current={...current,title:'다른 목록 내용'};await render();expect(confirmOptions.validate?.({confirmation:''})).toContain('변경');
  await act(async()=>{release({confirmation:''});await pending;});expect(fetchMock).toHaveBeenCalledOnce();expect(refreshBoard).not.toHaveBeenCalled();
});

test('a malformed acknowledgement is uncertain, locks the document and is never retried',async()=>{
  fetchMock.mockImplementation(async(_url,request)=>request?.method==='PATCH'?Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'잘못된 응답',data:{wrong:true}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}}):Response.json(detail));
  await render();await act(async()=>state.run(current,'done'));await flush();expect(fetchMock).toHaveBeenCalledTimes(2);expect(refreshBoard).not.toHaveBeenCalled();expect(state.locked).toBe(true);expect(state.outcome?.kind).toBe('error');
  await act(async()=>state.run(current,'progress'));expect(fetchMock).toHaveBeenCalledTimes(2);
});
