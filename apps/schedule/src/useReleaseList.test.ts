// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import readSessionSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useReleaseList,releaseSeriesPage,releaseRecordsPage,releaseProjectPage,releaseReferenceResponse,releaseRevisionPage,legacyReleasePage} from './useReleaseList';
import type {ReleaseRecord} from './types';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const record:ReleaseRecord={id:1,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',notes:'원문 9223372036854775807',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
let root:Root|undefined,node:HTMLDivElement,state:ReturnType<typeof useReleaseList<ReleaseRecord>>,scope:string,url:string,enabled:boolean;
const fetchMock=vi.fn();
function Harness(){state=useReleaseList(url,scope,value=>releaseRecordsPage(value,10,770),item=>item.id,enabled);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
beforeEach(()=>{vi.resetAllMocks();vi.useRealTimers();window.eval(readSessionSource);vi.stubGlobal('fetch',fetchMock);scope='one';url='/api/releases?projectId=10';enabled=true;node=document.createElement('div');document.body.append(node);root=createRoot(node);fetchMock.mockResolvedValue(Response.json({items:[record],total:1}));});
afterEach(()=>{if(root)act(()=>root!.unmount());node.remove();vi.unstubAllGlobals();vi.useRealTimers();});

test('validates complete pages, unique records and project/version identity',()=>{
  expect(releaseRecordsPage({items:[record],total:1},10,770).items[0].notes).toBe(record.notes);
  for(const value of [null,{items:[record],total:0},{items:[record,record],total:2},{items:[{...record,projectId:20}],total:1},{items:[{...record,baseVersion:771}],total:1}])expect(()=>releaseRecordsPage(value,10,770)).toThrow();
  const series={baseVersion:770,first:record,latest:record};expect(releaseSeriesPage({items:[series],total:1},10).total).toBe(1);
  expect(()=>releaseSeriesPage({items:[{...series,first:{...record,minor:1}}],total:1},10)).toThrow();
  expect(()=>releaseSeriesPage({items:[{...series,latest:{...record,projectId:20}}],total:1},10)).toThrow();
  expect(legacyReleasePage({items:[{id:1,projectId:10,releasedOn:null,notes:'',issue:'',sourceReference:''}],total:1},10).total).toBe(1);
  expect(()=>legacyReleasePage({items:[{id:1,projectId:20}],total:1},10)).toThrow();
});
test('validates reference targets and revision snapshots before rendering them',()=>{
  expect(releaseReferenceResponse(record,1,10)).toEqual(record);
  expect(releaseProjectPage({items:[record],total:1},10).items).toEqual([record]);
  const revision={id:9,releaseId:1,actorId:1,snapshot:JSON.stringify(record),createdAt:'2026-09-12T00:00:00Z'};
  expect(releaseRevisionPage({items:[revision],total:1},record).items).toEqual([revision]);
  for(const value of [{...record,id:2},{...record,projectId:20}])expect(()=>releaseReferenceResponse(value,1,10)).toThrow();
  expect(()=>releaseProjectPage({items:[{...record,projectId:20}],total:1},10)).toThrow();
  for(const bad of [{...revision,releaseId:2},{...revision,snapshot:'{'},{...revision,snapshot:JSON.stringify({...record,projectId:20})}])expect(()=>releaseRevisionPage({items:[bad],total:1},record)).toThrow();
});
test('initial failure is not empty success; explicit retry only reads',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('조회 장애',{status:503}));await render();expect(state.loaded).toBe(false);expect(state.error).toContain('일정 조회에 실패');
  await act(async()=>state.load());expect(state.loaded).toBe(true);expect(state.page.items).toHaveLength(1);expect(state.error).toBe('');expect(fetchMock.mock.calls.every(call=>call[1]?.headers?.Accept==='application/json')).toBe(true);
});
test('refresh failure retains rows, propagates when required, but access denial clears them',async()=>{
  await render();fetchMock.mockResolvedValueOnce(new Response('실패',{status:503}));
  await act(async()=>{await expect(state.load(false,true)).rejects.toThrow();});expect(state.page.items).toHaveLength(1);
  fetchMock.mockResolvedValueOnce(new Response('권한 없음',{status:403}));await act(async()=>state.load());expect(state.denied).toBe(true);expect(state.page.items).toHaveLength(0);expect(state.loaded).toBe(false);
});
test('pagination locks duplicate reads and combines overlapping IDs without duplicates',async()=>{
  fetchMock.mockResolvedValueOnce(Response.json({items:[record],total:3}));await render();let release!:(value:Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(done=>{release=done;}));let pending!:Promise<void>;
  await act(async()=>{pending=state.load(true);await state.load(true);});expect(fetchMock).toHaveBeenCalledTimes(2);expect(String(fetchMock.mock.calls[1][0])).toContain('skip=1');
  await act(async()=>{release(Response.json({items:[record,{...record,id:2,minor:1}],total:3}));await pending;});expect(state.page.items.map(item=>item.id)).toEqual([1,2]);
});
test.each(['scope','event','closed','unmount'])('%s discards an old pending read',async kind=>{
  let release!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>{release=done;}));await render();
  if(kind==='scope'){scope='two';fetchMock.mockResolvedValueOnce(Response.json({items:[],total:0}));await render();}
  if(kind==='event')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(kind==='closed'){enabled=false;await render();}
  if(kind==='unmount'){act(()=>root!.unmount());root=undefined;}
  await act(async()=>{release(Response.json({items:[record],total:1}));});expect(state.page.items).toHaveLength(0);
});
