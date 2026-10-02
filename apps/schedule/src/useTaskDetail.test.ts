// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import readSessionSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useTaskDetail} from './useTaskDetail';
import type {Detail} from './types';
import {taskDetailResponse,assertCurrentTaskDetail} from './scheduleReads';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Options=Parameters<typeof useTaskDetail>[0];
let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useTaskDetail>,latest:Detail;
const fetchMock=vi.fn();
function Harness(){state=useTaskDetail(options);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
beforeEach(()=>{
  vi.resetAllMocks();vi.useRealTimers();window.eval(readSessionSource);vi.stubGlobal('fetch',fetchMock);
  const me={id:1,name:'직원',department:'',departmentId:null,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
  options={id:101,boot:{me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'test'},refreshIdentity:vi.fn(async()=>options.boot),pollPaused:()=>false};
  latest={task:{id:101,title:'업무',body:'9223372036854775807 원문',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z'},canEdit:true,comments:[],attachments:[],history:[]};
  fetchMock.mockImplementation(async()=>Response.json(structuredClone(latest)));
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;node.remove();vi.unstubAllGlobals();vi.useRealTimers();});

test('full detail validates the target, all collections, deleted parent replies and exact original text',()=>{
  const parent={id:7,taskId:101,authorId:1,parentId:null,body:'',deleted:true,version:2,createdAt:'2026-09-11',editedAt:null};
  const reply={...parent,id:8,parentId:7,deleted:false,body:'원문 9007199254740993'};
  const valid={...latest,comments:[parent,reply],attachments:[{id:'image',taskId:101,commentId:8,name:'image.png',contentType:'image/png',size:12}],history:[{id:1,actorId:1,action:'update',details:'9223372036854775807',createdAt:'2026-09-11'}]};
  expect(taskDetailResponse(valid,101)).toBe(valid);
  const broken:unknown[]=[null,{...valid,canEdit:'yes'},{...valid,task:{...valid.task,id:102}},{...valid,task:{...valid.task,archived:true}}, {...valid,comments:[parent,parent]}, {...valid,comments:[{...reply,parentId:9}]}, {...valid,comments:[parent,{...reply,parentId:8}]}, {...valid,comments:[{...parent,id:9007199254740992}]}, {...valid,attachments:[{...valid.attachments[0],commentId:7}]}, {...valid,attachments:[{...valid.attachments[0],taskId:102}]}, {...valid,history:[{...valid.history[0],details:null}]}, {...valid,attachments:null}];
  for(const value of broken)expect(()=>taskDetailResponse(value,101)).toThrow();
  expect(()=>assertCurrentTaskDetail(valid,{...valid,comments:[parent]})).toThrow();
  expect(()=>assertCurrentTaskDetail(valid,{...valid,comments:[{...parent,version:1},reply]})).toThrow();
});
test('initial failure is visible, manual GET retry recovers and later malformed reads retain last good data',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('oops',{status:500}));await render();expect(state.detail).toBeUndefined();expect(state.outcome?.kind).toBe('error');
  await act(async()=>{await state.refresh();});expect(state.detail?.task.body).toBe(latest.task.body);
  fetchMock.mockResolvedValueOnce(Response.json({...latest,task:{...latest.task,id:102}}));await act(async()=>{await expect(state.refresh()).rejects.toThrow();});expect(state.detail?.task.id).toBe(101);expect(state.outcome?.kind).toBe('error');
});
test('background errors remain visible and polls never supersede a pending request or an explicit failure',async()=>{
  vi.useFakeTimers();await render();fetchMock.mockRejectedValueOnce(Error('unavailable'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(state.outcome?.kind).toBe('error');const before=fetchMock.mock.calls.length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(90000);});expect(fetchMock).toHaveBeenCalledTimes(before);
  await act(async()=>{await state.refresh();});expect(state.outcome).toBeNull();
  options={...options,pollPaused:()=>true};await render();const paused=fetchMock.mock.calls.length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(fetchMock).toHaveBeenCalledTimes(paused);
});
test('common observation timeout settles an ignored abort and rejects the late body after a retry',async()=>{
  vi.useFakeTimers();await render();let finish!:(r:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(done=>finish=done));let pending!:Promise<unknown>;
  act(()=>{pending=state.refresh().catch(()=>{});});await act(async()=>{await vi.advanceTimersByTimeAsync(30000);await pending;});expect(state.loading).toBe(false);expect(state.outcome?.kind).toBe('error');
  latest={...latest,task:{...latest.task,version:3,title:'현재 업무'}};await act(async()=>{await state.refresh();finish(Response.json({...latest,task:{...latest.task,version:2,title:'늦은 업무'}}));});expect(state.detail?.task.title).toBe('현재 업무');
});
test.each(['scope','pagehide','unmount','route'])('%s cancels non-abortable reads; old completion cannot replace content or unlock a new read',async kind=>{
  await render();let finish!:(r:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>finish=done));let pending!:Promise<unknown>;
  act(()=>{pending=state.refresh().catch(()=>{});});await act(async()=>{});
  if(kind==='scope')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(kind==='pagehide')act(()=>window.dispatchEvent(new Event('pagehide')));
  if(kind==='unmount'){act(()=>root!.unmount());root=undefined;}
  if(kind==='route'){options={...options,id:102};latest={...latest,task:{...latest.task,id:102}};await render();}
  await act(async()=>{finish(Response.json({...latest,task:{...latest.task,id:101,title:'늦은 값',version:2}}));await pending;});
  if(kind!=='unmount'){expect(state.detail?.task.title).not.toBe('늦은 값');expect(state.loading).toBe(false);}
  if(kind==='route')expect(state.detail?.task.id).toBe(102);
  if(kind==='pagehide')await expect(state.refresh()).rejects.toThrow();
});
test.each([401,403])('HTTP %s locks writes and stops automatic polling, same-owner explicit recheck recovers',async status=>{
  vi.useFakeTimers();await render();fetchMock.mockResolvedValueOnce(new Response('denied',{status}));await act(async()=>{await expect(state.refresh()).rejects.toThrow();});expect(state.invalid).toBe(true);expect(state.detail?.task.id).toBe(101);
  const before=fetchMock.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});expect(fetchMock).toHaveBeenCalledTimes(before);
  await act(async()=>{await state.refresh();});expect(options.refreshIdentity).toHaveBeenCalledOnce();expect(state.invalid).toBe(false);
});
test('a different identity never republishes an existing editor snapshot',async()=>{
  await render();act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  vi.mocked(options.refreshIdentity).mockResolvedValueOnce({...options.boot,me:{...options.boot.me,id:2}});
  await act(async()=>{await expect(state.refresh()).rejects.toThrow();});expect(state.invalid).toBe(true);expect(fetchMock).toHaveBeenCalledOnce();
  options={...options,boot:{...options.boot,me:{...options.boot.me,id:2}}};await render();act(()=>state.applyDetail({...latest,task:{...latest.task,title:'다른 계정의 값'}}));expect(state.detail?.task.title).toBe('업무');
  await act(async()=>{await expect(state.refresh()).rejects.toThrow();});expect(state.outcome?.kind).toBe('denied');expect(fetchMock).toHaveBeenCalledOnce();
});
test('a replaced manual read cannot unlock or overwrite its still-pending successor',async()=>{
  await render();let oldFinish!:(r:Response)=>void,nextFinish!:(r:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(done=>oldFinish=done)).mockImplementationOnce(()=>new Promise(done=>nextFinish=done));
  let first!:Promise<unknown>,second!:Promise<unknown>;
  act(()=>{first=state.refresh().catch(()=>{});});await act(async()=>{});act(()=>{second=state.refresh();});await act(async()=>{});
  await act(async()=>{oldFinish(Response.json({...latest,task:{...latest.task,title:'무시할 응답'}}));await first;});expect(state.loading).toBe(true);expect(state.detail?.task.title).toBe('업무');
  await act(async()=>{nextFinish(Response.json({...latest,task:{...latest.task,title:'현재 응답',version:2}}));await second;});expect(state.loading).toBe(false);expect(state.detail?.task.title).toBe('현재 응답');
});
test('confirmed external detail invalidates an older pending poll; regressed versions do not erase known data',async()=>{
  await render();let finish!:(r:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>finish=done));let pending!:Promise<unknown>;
  act(()=>{pending=state.refresh().catch(()=>{});});await act(async()=>{});
  const newer={...latest,task:{...latest.task,version:3,title:'확인된 최신 업무'}};act(()=>state.applyDetail(newer));await act(async()=>{finish(Response.json(latest));await pending;});expect(state.detail).toEqual(newer);
  await act(async()=>{await expect(state.refresh()).rejects.toThrow();});expect(state.detail).toEqual(newer);expect(state.outcome?.kind).toBe('error');
});
