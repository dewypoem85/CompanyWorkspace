// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import {useTaskActions} from './useTaskActions';
import {ApiError} from './api';
import {confirmWorkspaceAction,type ConfirmOptions,type Confirmation} from './generated/workspace-confirm';
import type {Bootstrap,Detail} from './types';
vi.mock('./generated/workspace-confirm',()=>({confirmWorkspaceAction:vi.fn()}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

type Options=Parameters<typeof useTaskActions>[0];
let root:Root|undefined,container:HTMLDivElement,options:Options,state:ReturnType<typeof useTaskActions>,latest:Detail,boot:Bootstrap,confirmation:ConfirmOptions,decide:(value:Confirmation|null)=>void;
const fetchMock=vi.fn(),taskState='a'.repeat(64),commentState='b'.repeat(64),nextState='c'.repeat(64),nextCommentState='d'.repeat(64);
const readDetailMock=vi.fn<()=>Promise<Detail>>();
function Harness(){state=useTaskActions(options);return null;}
const render=()=>act(()=>root!.render(createElement(Harness)));
const writes=()=>fetchMock.mock.calls;
const envelope=(data:unknown,status=200,outcome='saved')=>Response.json({protocol:'workspace-form-v1',outcome,message:'처리',data},{status,headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
function initial():Detail{return{task:{id:101,title:'검토 대상',body:'9007199254740993',assigneeId:1,createdBy:1,projectId:null,startDate:null,endDate:null,status:'planned',archived:false,version:1,createdAt:'2026-09-10T00:00:00Z',updatedAt:'2026-09-10T00:00:00Z'},canEdit:true,comments:[{id:7,taskId:101,authorId:1,parentId:null,body:'댓글 원문',deleted:false,version:1,createdAt:'2026-09-10T00:00:00Z',editedAt:null}],attachments:[],history:[],editing:{actorId:'1',stateToken:taskState},commentEditing:{actorId:'1',createStateToken:'e'.repeat(64),comments:[{id:7,stateToken:commentState}]}};}
function reply(url:unknown){
  const path=new URL(String(url),location.origin).pathname;
  if(path.endsWith('/archive')||path.endsWith('/restore')){
    const operation=path.endsWith('/archive')?'archive':'restore',before=structuredClone(latest),archived=operation==='archive';
    latest={...latest,canEdit:!archived,task:{...latest.task,archived,version:latest.task.version+1,updatedAt:'2026-09-10T01:00:00Z'},editing:{actorId:'1',stateToken:nextState}};
    return envelope({operation,actorId:'1',previousStateToken:before.editing!.stateToken,stateToken:nextState,task:latest.task,attachments:[],navigateTo:'/tasks/101'});
  }
  const before=latest.comments.find(item=>item.id===7)!;
  const saved={...before,body:'',deleted:true,version:before.version+1,editedAt:'2026-09-10T01:00:00Z'};
  latest={...latest,comments:latest.comments.map(item=>item.id===7?saved:item),commentEditing:{...latest.commentEditing!,comments:latest.commentEditing!.comments.map(item=>item.id===7?{...item,stateToken:nextCommentState}:item)}};
  return envelope({operation:'delete-comment',actorId:'1',previousStateToken:commentState,stateToken:nextCommentState,comment:saved,attachments:[]});
}
async function open(kind:Parameters<typeof state.run>[0]='archive',comment?:number){let pending!:Promise<void>;await act(async()=>{pending=state.run(kind,comment);await Promise.resolve();});return{pending};}

beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);vi.stubGlobal('fetch',fetchMock);latest=initial();
  const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'admin',active:true,shared:false,access:true,isAdmin:true};
  boot={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'test-csrf'};
  readDetailMock.mockImplementation(async()=>structuredClone(latest));
  options={id:101,detail:structuredClone(latest),boot,blockedReason:'',readDetail:readDetailMock,refreshIdentity:vi.fn(async()=>boot),applyDetail:vi.fn(value=>{options={...options,detail:value};render();}),changed:vi.fn(async()=>{})};
  fetchMock.mockImplementation(async url=>reply(url));
  vi.mocked(confirmWorkspaceAction).mockImplementation(value=>{confirmation=value;return new Promise(resolve=>{decide=resolve;});});
  container=document.createElement('div');document.body.append(container);root=createRoot(container);render();
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));container.remove();vi.unstubAllGlobals();});

test('사전 조회·계정 실패와 달라진 기준은 확인창이나 쓰기를 열지 않는다',async()=>{
  readDetailMock.mockRejectedValueOnce(new ApiError(403,'권한 없음'));
  await act(async()=>state.run('archive'));expect(confirmWorkspaceAction).not.toHaveBeenCalled();expect(writes()).toHaveLength(0);
  latest={...latest,task:{...latest.task,title:'동료 수정',version:2},editing:{actorId:'1',stateToken:nextState}};
  await act(async()=>state.run('archive'));expect(confirmWorkspaceAction).not.toHaveBeenCalled();expect(options.applyDetail).toHaveBeenLastCalledWith(latest);expect(writes()).toHaveLength(0);
});

test.each(['poll','draft','role','event','route','unmount'])('%s 변경은 이미 검토한 작업 의도를 무효화한다',async change=>{
  const {pending}=await open();expect(confirmWorkspaceAction).toHaveBeenCalledOnce();
  if(change==='poll')options={...options,detail:{...latest,editing:{actorId:'1',stateToken:nextState}}};
  if(change==='draft')options={...options,blockedReason:'작성 중인 초안'};
  if(change==='role')options={...options,boot:{...boot,me:{...boot.me,access:false}}};
  if(change==='route')options={...options,id:102};
  if(change==='unmount'){act(()=>root!.unmount());root=undefined;}
  else if(change==='event')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  else render();
  expect(confirmation.validate?.({confirmation:''})).toBeTruthy();
  await act(async()=>{decide({confirmation:''});await pending;});expect(writes()).toHaveLength(0);
});

test('확인 취소와 다른 편집 초안은 쓰기를 보내지 않는다',async()=>{
  const {pending}=await open();await act(async()=>{decide(null);await pending;});expect(state.busy).toBe(false);expect(state.needsRefresh).toBe(false);expect(writes()).toHaveLength(0);
  options={...options,blockedReason:'댓글 편집 중'};render();await act(async()=>state.run('archive'));expect(confirmWorkspaceAction).toHaveBeenCalledOnce();expect(writes()).toHaveLength(0);
});

test('확인된 보관은 공통 헤더와 본문을 보내고 후속 조회 실패에도 반복하지 않는다',async()=>{
  let reads=0;readDetailMock.mockImplementation(async()=>{reads++;if(reads===2)throw Error('후속 조회 실패');return structuredClone(latest);});
  const {pending}=await open();await act(async()=>{decide({confirmation:''});await pending;});expect(writes()).toHaveLength(1);
  const[url,request]=writes()[0];expect(new URL(String(url)).pathname).toBe('/api/tasks/101/archive');expect(request.method).toBe('POST');expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(request.headers.get('X-Workspace-State')).toBe(taskState);expect(request.headers.get('X-CSRF-TOKEN')).toBe('test-csrf');expect(JSON.parse(request.body)).toEqual({version:1});
  expect(state.outcome).toMatchObject({kind:'success'});expect(state.needsRefresh).toBe(true);await act(async()=>state.run('archive'));expect(writes()).toHaveLength(1);
  await act(async()=>state.refresh());expect(writes()).toHaveLength(1);expect(state.needsRefresh).toBe(false);
});

test.each(['malformed','network','conflict'])('%s 응답은 작업을 재전송하거나 성공으로 단정하지 않는다',async mode=>{
  if(mode==='malformed')fetchMock.mockResolvedValueOnce(envelope({operation:'archive'}));
  if(mode==='network')fetchMock.mockRejectedValueOnce(Error('연결 실패'));
  if(mode==='conflict')fetchMock.mockResolvedValueOnce(envelope(undefined,409,'conflict'));
  const {pending}=await open();await act(async()=>{decide({confirmation:''});await pending;await state.run('archive');});expect(writes()).toHaveLength(1);expect(state.needsRefresh).toBe(true);expect(state.outcome?.kind).not.toBe('success');
});

test('복원과 댓글 삭제는 각 기준 헤더·버전·전체 ACK를 사용하고 답글을 유지한다',async()=>{
  latest={...latest,canEdit:false,task:{...latest.task,archived:true},editing:{actorId:'1',stateToken:taskState}};options={...options,detail:structuredClone(latest)};render();
  const restore=await open('restore');await act(async()=>{decide({confirmation:''});await restore.pending;});let[url,request]=writes()[0];expect(new URL(String(url)).pathname).toBe('/api/tasks/101/restore');expect(request.headers.get('X-Workspace-State')).toBe(taskState);expect(JSON.parse(request.body)).toEqual({version:1});
  latest={...latest,comments:[{...initial().comments[0]}, {...initial().comments[0],id:8,parentId:7,body:'남을 답글'}],commentEditing:{actorId:'1',createStateToken:'e'.repeat(64),comments:[{id:7,stateToken:commentState},{id:8,stateToken:'f'.repeat(64)}]}};options={...options,detail:structuredClone(latest)};render();
  const deletion=await open('delete-comment',7);expect(confirmation.details?.[1].value).toBe('댓글 원문');await act(async()=>{decide({confirmation:''});await deletion.pending;});[url,request]=writes()[1];expect(new URL(String(url)).pathname).toBe('/api/comments/7');expect(request.method).toBe('DELETE');expect(request.headers.get('X-Workspace-Target-State')).toBe(commentState);expect(JSON.parse(request.body)).toEqual({version:1});expect(options.detail?.comments.find(item=>item.id===8)?.body).toBe('남을 답글');
});

test('계정 변경 뒤 늦게 온 저장 응답은 새 범위에 적용하지 않는다',async()=>{
  let finish!:(value:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const {pending}=await open();await act(async()=>{decide({confirmation:''});await Promise.resolve();});
  options={...options,boot:{...boot,me:{...boot.me,role:'employee',isAdmin:false}}};render();act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await act(async()=>{finish(reply('/api/tasks/101/archive'));await pending;});expect(state.outcome?.title).toMatch(/로그인|잠겼/);expect(options.applyDetail).not.toHaveBeenCalled();expect(options.changed).not.toHaveBeenCalled();expect(state.needsRefresh).toBe(true);expect(writes()).toHaveLength(1);
});
