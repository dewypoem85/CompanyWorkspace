// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useCommentWrites} from './useCommentWrites';
import type {CommentReceipt} from './commentWrites';
import type {Detail} from './types';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

type Options=Parameters<typeof useCommentWrites>[0];
let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useCommentWrites>,latest:Detail;
const fetchMock=vi.fn(),confirmMock=vi.fn();
function Harness(){state=useCommentWrites(options);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
const flush=async()=>act(async()=>{});
const stateA='a'.repeat(64),stateB='b'.repeat(64),stamp='2026-09-12T00:00:00Z';
function response(overrides:Partial<CommentReceipt>={}){
  const receipt:CommentReceipt={operation:'create',actorId:'1',previousStateToken:stateA,stateToken:stateB,
    comment:{id:8,taskId:101,authorId:1,parentId:null,body:'새 댓글 9223372036854775807',deleted:false,version:1,createdAt:stamp,editedAt:null},attachments:[],...overrides};
  return Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:receipt},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
}
beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});fetchMock.mockResolvedValue(response());
  const me={id:1,name:'직원',department:'',departmentId:null,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};
  latest={task:{id:101,title:'업무',body:'',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:stamp,updatedAt:stamp},canEdit:true,comments:[],attachments:[],history:[],commentEditing:{actorId:'1',createStateToken:stateA,comments:[]}};
  const boot={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'synthetic'};
  options={boot,detail:latest,draft:{body:'새 댓글 9223372036854775807',images:[],version:0},parentId:null,blocked:()=>false,hasDraft:true,readDetail:vi.fn(async()=>structuredClone(latest)),refreshIdentity:vi.fn(async()=>boot),review:vi.fn(),committed:vi.fn(),refreshed:vi.fn(async()=>{})};
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();});

test('confirmed comment uses shared transport and reconciles only the full receipt',async()=>{
  await render();await act(async()=>state.run());expect(confirmMock).toHaveBeenCalledOnce();expect(fetchMock).toHaveBeenCalledOnce();expect(options.committed).toHaveBeenCalledOnce();expect(options.refreshed).toHaveBeenCalledOnce();expect(state.outcome).toMatchObject({kind:'success',title:'댓글을 저장했습니다.'});
  const [url,request]=fetchMock.mock.calls[0];expect(new URL(url).pathname).toBe('/api/tasks/101/comments');expect(request.method).toBe('POST');expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(request.headers.get('X-Workspace-Target-State')).toBe(stateA);expect(request.headers.get('X-CSRF-TOKEN')).toBe('synthetic');expect(JSON.parse(request.body)).toEqual({body:'새 댓글 9223372036854775807',parentId:null,version:0,attachmentIds:[]});
});

test('cancelled confirmation sends no request and preserves the draft',async()=>{
  confirmMock.mockResolvedValue(null);await render();await act(async()=>state.run());expect(fetchMock).not.toHaveBeenCalled();expect(options.committed).not.toHaveBeenCalled();expect(options.draft.body).toContain('9223372036854775807');expect(state.busy).toBe(false);
});

test.each(['draft','actor','baseline'])('preflight %s changes prevent a stale request',async kind=>{
  await render();let release!:(value:Detail)=>void;(options.readDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>new Promise(done=>release=done));let pending!:Promise<void>;act(()=>{pending=state.run();});await flush();
  if(kind==='draft')options={...options,draft:{...options.draft,body:'나중 초안'}};
  if(kind==='actor')options={...options,boot:{...options.boot,me:{...options.boot.me,id:2}}};
  if(kind==='baseline')latest={...latest,commentEditing:{actorId:'1',createStateToken:'c'.repeat(64),comments:[]}};
  await render();await act(async()=>{release(structuredClone(latest));await pending;});expect(fetchMock).not.toHaveBeenCalled();expect(options.committed).not.toHaveBeenCalled();expect(state.outcome?.kind).not.toBe('loading');
});

test('malformed saved response locks the document and cannot be retried',async()=>{
  fetchMock.mockResolvedValue(response({attachments:undefined as never}));await render();await act(async()=>state.run());expect(fetchMock).toHaveBeenCalledOnce();expect(options.committed).not.toHaveBeenCalled();expect(state.locked).toBe(true);await act(async()=>state.run());expect(fetchMock).toHaveBeenCalledOnce();
});

test('scope change during a sent request rejects a late acknowledgement',async()=>{
  let release!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>release=done));await render();let pending!:Promise<void>;act(()=>{pending=state.run();});await flush();expect(fetchMock).toHaveBeenCalledOnce();act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await act(async()=>{release(response());await pending;});expect(options.committed).not.toHaveBeenCalled();expect(options.refreshed).not.toHaveBeenCalled();expect(state.locked).toBe(true);
});

test('an unsent scope invalidation recovers only after the original actor detail is validated',async()=>{
  await render();act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await flush();expect(state.locked).toBe(true);
  await act(async()=>{expect(state.recover(structuredClone(latest),options.boot)).toBe(true);});expect(state.locked).toBe(false);
  act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));await flush();
  const changed={...options.boot,me:{...options.boot.me,id:2}};expect(state.recover(structuredClone(latest),changed)).toBe(false);expect(state.locked).toBe(true);expect(fetchMock).not.toHaveBeenCalled();
});

test('failed follow-up read never repeats an acknowledged write',async()=>{
  (options.refreshed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Error('offline'));await render();await act(async()=>state.run());expect(fetchMock).toHaveBeenCalledOnce();expect(options.committed).toHaveBeenCalledOnce();expect(state.outcome).toMatchObject({kind:'success',title:'댓글은 저장했지만 목록 확인에 실패했습니다.'});await act(async()=>state.run());expect(fetchMock).toHaveBeenCalledOnce();
});
