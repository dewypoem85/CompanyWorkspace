// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {useMilestoneWrites} from './useMilestoneWrites';
import type {MilestoneReceipt} from './milestoneWrites';
import type {Bootstrap,MilestonePage} from './types';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

type Options=Parameters<typeof useMilestoneWrites>[0];let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useMilestoneWrites>,page:MilestonePage,boot:Bootstrap;
const fetchMock=vi.fn(),confirmMock=vi.fn(),a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64);
const row={id:7,type:'review' as const,title:'검수',description:'준비',date:'2026-09-18',projectId:10,version:2};
function Harness(){state=useMilestoneWrites(options);return null;}const render=async()=>act(async()=>root!.render(createElement(Harness)));
function response(overrides:Partial<MilestoneReceipt>={}){const receipt:MilestoneReceipt={operation:'update',actorId:'1',previousStateToken:b,stateToken:c,milestone:{...row,title:'수정',version:3},deleted:false,...overrides};return Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:receipt},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});}
beforeEach(()=>{vi.resetAllMocks();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});fetchMock.mockResolvedValue(response());
  const me={id:1,name:'관리자',department:'개발',departmentId:1,projectIds:[10],role:'admin',active:true,shared:false,access:true,isAdmin:true};boot={me,employees:[me],projects:[{id:10,name:'게임',color:'#123456',archived:false,version:1}],departments:[],leads:[],demo:false,csrfToken:'synthetic'};page={items:[row],editing:{actorId:'1',createStateToken:a,milestones:[{id:7,stateToken:b}]}};
  options={boot,draft:{...row,title:'수정'},baseline:row,page,dirty:true,blocked:()=>false,refreshIdentity:vi.fn(async()=>boot),readPage:vi.fn(async()=>page),committed:vi.fn(),refreshed:vi.fn(),conflicted:vi.fn()};node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();});

test('확정한 주요 일정만 공통 transport로 저장하고 후속 조회한다',async()=>{await render();await act(async()=>state.run('update'));expect(confirmMock).toHaveBeenCalledOnce();expect(fetchMock).toHaveBeenCalledOnce();expect(options.committed,JSON.stringify(state.outcome)).toHaveBeenCalledOnce();expect(options.refreshed).toHaveBeenCalledOnce();const[url,request]=fetchMock.mock.calls[0];expect(new URL(url).pathname).toBe('/api/milestones/7');expect(request.method).toBe('PUT');expect(request.headers.get('X-Workspace-Milestone-State')).toBe(b);expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(JSON.parse(request.body)).toMatchObject({title:'수정',version:2});});
test('확인 취소와 사전 기준 변경은 요청을 보내지 않는다',async()=>{confirmMock.mockResolvedValueOnce(null);await render();await act(async()=>state.run('update'));expect(fetchMock).not.toHaveBeenCalled();const latest={...page,editing:{...page.editing,milestones:[{id:7,stateToken:c}]}};options={...options,readPage:vi.fn(async()=>latest)};await render();await act(async()=>state.run('update'));expect(fetchMock).not.toHaveBeenCalled();expect(options.committed).not.toHaveBeenCalled();});
test('전송 중 계정 변경과 손상 ACK는 문서를 잠근다',async()=>{fetchMock.mockResolvedValueOnce(response({milestone:{...row,title:'변조',version:3}}));await render();await act(async()=>state.run('update'));expect(options.committed).not.toHaveBeenCalled();expect(state.locked).toBe(true);await act(async()=>state.run('update'));expect(fetchMock).toHaveBeenCalledOnce();});
test('삭제는 버전만 전송하고 전체 삭제 영수증을 요구한다',async()=>{fetchMock.mockResolvedValueOnce(response({operation:'delete',milestone:row,deleted:true}));await render();await act(async()=>state.run('delete'));const[,request]=fetchMock.mock.calls[0];expect(request.method).toBe('DELETE');expect(JSON.parse(request.body)).toEqual({version:2});expect(options.committed).toHaveBeenCalledOnce();});
test('저장 후 조회 실패는 저장을 반복하지 않는다',async()=>{(options.readPage as ReturnType<typeof vi.fn>).mockResolvedValueOnce(page).mockRejectedValueOnce(Error('offline'));await render();await act(async()=>state.run('update'));expect(fetchMock).toHaveBeenCalledOnce();expect(state.outcome).toMatchObject({kind:'success',title:'저장은 완료했지만 목록 확인에 실패했습니다.'});await act(async()=>state.run('update'));expect(fetchMock).toHaveBeenCalledOnce();});
