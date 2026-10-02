// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useReleaseEditor} from './useReleaseEditor';
import {openWorkspaceReview,type ReviewOptions} from './generated/workspace-review';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import type {Bootstrap,ReleaseRecord} from './types';
import type {ReleaseDraft} from './releaseReview';
vi.mock('./generated/workspace-review',()=>({openWorkspaceReview:vi.fn()}));
vi.mock('./generated/workspace-confirm',()=>({confirmWorkspaceAction:vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,container:HTMLDivElement,boot:Bootstrap,record:ReleaseDraft,latest:ReleaseRecord,state:ReturnType<typeof useReleaseEditor>,saved:()=>Promise<void>,removed:()=>void,identity:()=>Promise<Bootstrap>;
const fetchMock=vi.fn(),firstToken='a'.repeat(64),nextToken='b'.repeat(64);
function Harness(){state=useReleaseEditor(record,boot,identity,saved,removed);return null;}
const render=()=>act(()=>root!.render(createElement(Harness)));
const writes=()=>fetchMock.mock.calls.filter(([,request])=>(request?.method||'GET')!=='GET');
const selectDraft=(options:ReviewOptions)=>[{id:options.items[0].id,fields:Object.fromEntries(options.items[0].fields.map(f=>[f.key,f.key==='notes'?f.draft:f.current]))}];
const envelope=(release:ReleaseRecord,operation:'create'|'update'|'delete',previousStateToken=firstToken)=>Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{operation,actorId:String(boot.me.id),previousStateToken,stateToken:nextToken,release,deleted:operation==='delete'}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
const readResponse=(input:unknown)=>{const url=new URL(String(input),location.href);return Response.json(url.pathname==='/api/releases/editing'?{actorId:String(boot.me.id),stateToken:firstToken,record:url.searchParams.has('id')?latest:null}:latest);};
beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);container=document.createElement('div');document.body.append(container);
  const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true};
  boot={me,employees:[me],projects:[{id:10,name:'프로젝트',archived:false,color:'#123456',version:1}],leads:[],departments:[],csrfToken:'test',demo:false};
  latest={id:70,projectId:10,baseVersion:770,minor:0,releasedOn:'2026-09-10',releasedOnUnknown:false,sourceReference:'',notes:'원본',status:'stable',issue:'',rollbackTargetId:null,resolvedInId:null,createdBy:1,version:1,updatedAt:'2026-09-10T03:00:00Z'};
  record={...latest};identity=vi.fn(async()=>boot);saved=vi.fn(async()=>{});removed=vi.fn();
  fetchMock.mockImplementation(async(input,request)=>{if((request?.method||'GET')==='GET')return readResponse(input);if(request.method==='DELETE')return envelope(latest,'delete');const body=JSON.parse(String(request.body)) as ReleaseDraft;latest={...latest,...body,id:body.id||80,version:request.method==='POST'?1:body.version+1,notes:body.notes.trim(),issue:body.issue.trim()};return envelope(latest,request.method==='POST'?'create':'update');});
  vi.mocked(openWorkspaceReview).mockImplementation(async options=>selectDraft(options));
  vi.mocked(confirmWorkspaceAction).mockResolvedValue({confirmation:''});
  root=createRoot(container);render();
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));container.remove();vi.unstubAllGlobals();});

test('draft close confirms exact version without saving and returns a current permission',async()=>{
  const signal=new AbortController();let permission:(()=>boolean)|null=null;
  await act(async()=>{permission=await state.requestDiscard({signal:signal.signal});});
  expect(permission!()).toBe(true);expect(confirmWorkspaceAction).not.toHaveBeenCalled();
  act(()=>state.change({notes:'닫기 전 원문 9223372036854775807'}));
  vi.mocked(confirmWorkspaceAction).mockResolvedValueOnce(null);
  await act(async()=>{permission=await state.requestDiscard({signal:signal.signal});});
  expect(permission).toBeNull();expect(state.form.notes).toBe('닫기 전 원문 9223372036854775807');expect(state.canCloseNow()).toBe(true);
  vi.mocked(confirmWorkspaceAction).mockResolvedValueOnce({confirmation:''});
  await act(async()=>{permission=await state.requestDiscard({signal:signal.signal});});
  expect(permission!()).toBe(true);expect(vi.mocked(confirmWorkspaceAction).mock.calls.at(-1)![0].details).toEqual([
    {label:'프로젝트',value:'프로젝트',entity:{kind:'project',id:'10',name:'프로젝트'}},{label:'버전',value:'770.0'},{label:'기록',value:'70'}]);
  act(()=>state.change({notes:'승인 이후 새 초안'}));expect(permission!()).toBe(false);expect(writes()).toHaveLength(0);
});

test.each(['scope','abort','draft'])('draft close rejects %s changes while awaiting intent',async interruption=>{
  act(()=>state.change({notes:'그대로 보존'}));const signal=new AbortController();let resolve!:(value:{confirmation:string})=>void;
  vi.mocked(confirmWorkspaceAction).mockImplementationOnce(()=>new Promise(done=>resolve=done));
  let pending!:Promise<(()=>boolean)|null>;
  await act(async()=>{pending=state.requestDiscard({signal:signal.signal});});
  expect(state.busy).toBe(true);expect(state.canCloseNow()).toBe(false);
  await act(async()=>{expect(await state.requestDiscard({signal:signal.signal})).toBeNull();await state.save();state.change({notes:'잠긴 입력'});});
  expect(state.form.notes).toBe('그대로 보존');expect(writes()).toHaveLength(0);
  await act(async()=>{
    if(interruption==='scope')document.dispatchEvent(new Event('workspace-entity-scope-change'));
    if(interruption==='abort')signal.abort();if(interruption==='draft')state.form.notes='프로그램으로 바뀐 초안';
    resolve({confirmation:''});expect(await pending).toBeNull();
  });
  expect(state.busy).toBe(false);expect(state.form.notes).toBe(interruption==='draft'?'프로그램으로 바뀐 초안':'그대로 보존');expect(writes()).toHaveLength(0);
});

test('stale data is compared before explicit saving; confirmed writes and list failures are separate',async()=>{
  act(()=>state.change({notes:'내 초안 9223372036854775807'}));latest={...latest,notes:'다른 수정',issue:'서버 메모',version:2};
  await act(async()=>state.save());expect(writes()).toHaveLength(0);expect(state.form.version).toBe(1);expect(state.unavailable).toBe(true);
  await act(async()=>state.review());expect(state.form).toMatchObject({version:2,notes:'내 초안 9223372036854775807',issue:'서버 메모'});expect(writes()).toHaveLength(0);
  vi.mocked(saved).mockRejectedValueOnce(Error('목록 장애'));await act(async()=>state.save());
  expect(state.form.version).toBe(3);expect(state.dirty).toBe(false);expect(state.outcome?.kind).toBe('success');expect(state.listFailed).toBe(true);expect(writes()).toHaveLength(1);
  await act(async()=>state.refreshList());expect(state.listFailed).toBe(false);expect(writes()).toHaveLength(1);expect(saved).toHaveBeenCalledTimes(2);
});

test('metadata and equivalent optional fields do not create an unsaved change',()=>{
  act(()=>state.change({releasedOnUnknown:undefined,sourceReference:'ignored display metadata'}));expect(state.dirty).toBe(false);
  act(()=>state.change({notes:'changed'}));expect(state.dirty).toBe(true);
  act(()=>state.change({notes:'원본'}));expect(state.dirty).toBe(false);
});

test.each(['partial','network','403','409','400'])('%s response preserves draft and does not claim success',async failure=>{
  act(()=>state.change({notes:'보존할 내용'}));
  fetchMock.mockImplementation(async(input,request)=>{if((request?.method||'GET')==='GET')return readResponse(input);if(failure==='network')throw Error('격리 오류');if(failure==='partial')return Response.json({success:true});if(failure==='403')return Response.json({message:'거부'},{status:403});const invalid=failure==='400';return Response.json({protocol:'workspace-form-v1',outcome:invalid?'invalid':'conflict',message:'격리 오류'},{status:invalid?422:409,headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});});
  await act(async()=>state.save());expect(state.form).toMatchObject({notes:'보존할 내용',version:1});expect(state.outcome?.kind).not.toBe('success');expect(saved).not.toHaveBeenCalled();
  expect(state.unavailable).toBe(failure!=='400');
  if(failure!=='400'){await act(async()=>state.save());expect(writes()).toHaveLength(1);}
});

test('synchronous double submit and changes during transmission are blocked',async()=>{
  act(()=>state.change({notes:'한 번만 저장'}));let resolve!:(value:unknown)=>void;
  fetchMock.mockImplementation(async(input,request)=>{if((request?.method||'GET')==='GET')return readResponse(input);return new Promise(done=>{resolve=done;});});
  let pending!:Promise<void>;await act(async()=>{pending=state.save();await state.save();});expect(writes()).toHaveLength(1);
  act(()=>state.change({notes:'전송 중 변경'}));expect(state.form.notes).toBe('한 번만 저장');expect(state.canLeave()).toBe(false);
  await act(async()=>{resolve(envelope({...latest,notes:'한 번만 저장',version:2},'update'));await pending;});expect(state.dirty).toBe(false);expect(saved).toHaveBeenCalledOnce();
});

test.each(['event','role','unmount'])('%s invalidates a delayed write without clearing or replacing the draft',async kind=>{
  act(()=>state.change({notes:'이전 계정 초안'}));let resolve!:(value:unknown)=>void;
  fetchMock.mockImplementation(async(input,request)=>{if((request?.method||'GET')==='GET')return readResponse(input);return new Promise(done=>{resolve=done;});});
  let pending!:Promise<void>;await act(async()=>{pending=state.save();});expect(writes()).toHaveLength(1);
  if(kind==='event')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(kind==='role'){boot={...boot,me:{...boot.me,isAdmin:false,role:'employee'}};render();}
  if(kind==='unmount'){act(()=>root!.unmount());root=undefined;}
  await act(async()=>{resolve(envelope({...latest,notes:'이전 계정 초안',version:2},'update'));await pending;});
  expect(state.form.version).toBe(1);expect(state.form.notes).toBe('이전 계정 초안');expect(saved).not.toHaveBeenCalled();
});

test('review cancellation, changed permissions, incomplete reads and scope changes preserve the baseline',async()=>{
  act(()=>state.change({notes:'초안'}));latest={...latest,notes:'서버',version:2};vi.mocked(openWorkspaceReview).mockResolvedValueOnce(null);
  await act(async()=>state.review());expect(state.form).toMatchObject({version:1,notes:'초안'});
  vi.mocked(identity).mockResolvedValueOnce({...boot,projects:[]});await act(async()=>state.review());expect(openWorkspaceReview).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(Response.json({success:true}));await act(async()=>state.review());expect(state.form.version).toBe(1);
  vi.mocked(openWorkspaceReview).mockImplementationOnce(async options=>{document.dispatchEvent(new Event('workspace-entity-scope-change'));expect(options.signal?.aborted).toBe(true);return selectDraft(options);});
  await act(async()=>state.review());expect(state.form).toMatchObject({version:1,notes:'초안'});expect(writes()).toHaveLength(0);
});

test('new records keep their draft on uncertain creation; successful creation adopts its permanent ID',async()=>{
  act(()=>root!.unmount());record={...record,id:undefined,version:0,notes:''};root=createRoot(container);render();
  act(()=>state.change({notes:'신규 내용'}));await act(async()=>state.save());expect(state.form).toMatchObject({id:80,version:1,notes:'신규 내용'});expect(state.dirty).toBe(false);expect(writes()[0][1].method).toBe('POST');
  act(()=>root!.unmount());record={...record,baseVersion:771};root=createRoot(container);render();
  act(()=>state.change({notes:'미확정 신규'}));fetchMock.mockImplementation(async(input,request)=>{if((request?.method||'GET')==='GET')return readResponse(input);return Response.json({success:true});});await act(async()=>state.save());
  expect(state.form.id).toBeUndefined();expect(state.form.notes).toBe('미확정 신규');expect(state.unavailable).toBe(true);expect(state.outcome?.message).toContain('자동으로 다시 전송하지 않습니다');
});

test('existing base and minor records delete only after exact confirmation and one acknowledged request',async()=>{
  await act(async()=>state.remove());expect(confirmWorkspaceAction).toHaveBeenCalledOnce();expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({method:'DELETE'});expect(JSON.parse(String(writes()[0][1].body))).toEqual({version:1});
  expect(saved).toHaveBeenCalledOnce();expect(removed).toHaveBeenCalledOnce();expect(state.deleted).toBe(true);expect(state.unavailable).toBe(true);
  await act(async()=>state.remove());expect(writes()).toHaveLength(1);
});
