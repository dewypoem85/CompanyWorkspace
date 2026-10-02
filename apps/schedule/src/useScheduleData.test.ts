// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import readSessionSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useScheduleData} from './useScheduleData';
import {bootstrapResponse,emptyBoard,type BoardQuery} from './scheduleReads';
import * as reads from './scheduleReads';
vi.mock('./scheduleReads',async original=>({...await original<typeof import('./scheduleReads')>(),scheduleGet:vi.fn(),readScheduleBoard:vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const me={id:1,name:'직원',department:'',departmentId:null,projectIds:[],role:'employee',active:true,access:true,shared:false,isAdmin:false};
const boot=bootstrapResponse({me,employees:[me],departments:[],projects:[],leads:[],demo:false,csrfToken:'test'});
type BoardResult=Awaited<ReturnType<typeof reads.readScheduleBoard>>;
let root:Root|undefined,node:HTMLDivElement,state:ReturnType<typeof useScheduleData>,query:BoardQuery,enabled:boolean;
function Harness(){state=useScheduleData(query,enabled);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
beforeEach(()=>{
  vi.resetAllMocks();vi.useRealTimers();window.eval(readSessionSource);
  query={view:'week',unscheduled:false,onlyWeek:false,week:'2026-09-07',loadedWeeks:2,limit:50,department:'',project:'',person:'',goal:''};enabled=true;
  vi.mocked(reads.scheduleGet).mockResolvedValue(boot);vi.mocked(reads.readScheduleBoard).mockResolvedValue({...emptyBoard(),cache:new Map()});
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());node.remove();vi.useRealTimers();});
test('initial retry reads identity, while list failure preserves a previously verified snapshot',async()=>{
  vi.mocked(reads.scheduleGet).mockRejectedValueOnce(Error('unavailable'));await render();expect(state.boot).toBeUndefined();expect(state.identityError?.kind).toBe('error');
  await act(async()=>{await state.bootstrap();});expect(state.boot?.me.id).toBe(1);expect(state.ready).toBe(true);
  vi.mocked(reads.readScheduleBoard).mockRejectedValueOnce(Error('failed'));await act(async()=>state.refresh());expect(state.ready).toBe(true);expect(state.outcome?.kind).toBe('error');
  await act(async()=>state.refresh());expect(state.outcome).toBeNull();
});
test('changed query cancels an ignored abort and a late finally cannot unlock its replacement',async()=>{
  await render();let oldResolve!:(v:BoardResult)=>void,nextResolve!:(v:BoardResult)=>void;
  vi.mocked(reads.readScheduleBoard).mockImplementationOnce(()=>new Promise(done=>oldResolve=done)).mockImplementationOnce(()=>new Promise(done=>nextResolve=done));
  let old!:Promise<void>;act(()=>{old=state.refresh();});await act(async()=>{});query={...query,project:'10'};await render();expect(state.ready).toBe(false);expect(state.loading).toBe(true);
  await act(async()=>{oldResolve({...emptyBoard(),cache:new Map()});await old;});expect(state.loading).toBe(true);expect(state.ready).toBe(false);
  await act(async()=>{nextResolve({...emptyBoard(),cache:new Map()});});expect(state.loading).toBe(false);expect(state.ready).toBe(true);
});
test.each(['scope','pagehide','owner'])('%s invalidates reads and cache permanently without restoring old board on a manual identity check',async kind=>{
  await render();
  if(kind==='owner'){vi.mocked(reads.scheduleGet).mockResolvedValueOnce({...boot,me:{...me,id:2}});await act(async()=>{await expect(state.bootstrap()).rejects.toThrow();});}
  else act(()=>kind==='scope'?document.dispatchEvent(new Event('workspace-entity-scope-change')):window.dispatchEvent(new Event('pagehide')));
  expect(state.invalid).toBe(true);expect(state.ready).toBe(false);const calls=vi.mocked(reads.readScheduleBoard).mock.calls.length;
  await act(async()=>{await state.bootstrap();await state.refresh();window.dispatchEvent(new Event('focus'));});expect(state.invalid).toBe(true);expect(reads.readScheduleBoard).toHaveBeenCalledTimes(calls);
});
test('common timeout settles hung reads and explicit retry does not wait for their late completion',async()=>{
  vi.useFakeTimers();await render();let release!:(v:BoardResult)=>void;
  vi.mocked(reads.readScheduleBoard).mockImplementationOnce(()=>new Promise(done=>release=done));
  let pending!:Promise<void>;act(()=>{pending=state.refresh();});await act(async()=>{await Promise.resolve();await vi.advanceTimersByTimeAsync(30000);await pending;});expect(state.loading).toBe(false);expect(state.outcome?.kind).toBe('error');
  await act(async()=>state.refresh());await act(async()=>release({...emptyBoard(),cache:new Map()}));expect(state.outcome).toBeNull();expect(state.ready).toBe(true);
});

test('editor verification after a same-owner check does not republish the invalidated board',async()=>{
  await render();act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await act(async()=>{await expect(state.refresh(true,true)).rejects.toThrow();});
  const before=vi.mocked(reads.readScheduleBoard).mock.calls.length;
  await act(async()=>{await state.bootstrap();await state.refresh(true,true);});
  expect(reads.readScheduleBoard).toHaveBeenCalledTimes(before+1);expect(state.invalid).toBe(true);expect(state.ready).toBe(false);expect(state.identityError?.kind).toBe('denied');
  act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await act(async()=>{await expect(state.refresh(true,true)).rejects.toThrow();});
});

test('changed actor revokes retained editor capabilities without changing its owner key',async()=>{
  await render();vi.mocked(reads.scheduleGet).mockResolvedValueOnce({...boot,me:{...me,id:2}});
  await act(async()=>{await expect(state.bootstrap()).rejects.toThrow();});
  expect(state.boot?.me).toMatchObject({id:1,active:false,access:false,isAdmin:false});expect(state.invalid).toBe(true);
});

test('background polling retains an error until an explicit retry instead of hiding it with a new request',async()=>{
  vi.useFakeTimers();await render();vi.mocked(reads.readScheduleBoard).mockRejectedValueOnce(Error('unavailable'));
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(state.outcome?.kind).toBe('error');
  const before=vi.mocked(reads.readScheduleBoard).mock.calls.length;
  await act(async()=>{await vi.advanceTimersByTimeAsync(90000);});expect(reads.readScheduleBoard).toHaveBeenCalledTimes(before);expect(state.outcome?.kind).toBe('error');
  await act(async()=>state.refresh());expect(state.outcome).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(reads.readScheduleBoard).toHaveBeenCalledTimes(before+2);
});
