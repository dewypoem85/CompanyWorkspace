// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import readSource from '../../../packages/workspace-ui/src/read-session.js?raw';
import {FeedbackBoard} from './FeedbackBoard';
import type {Bootstrap,FeedbackItem} from './types';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

let root:Root|undefined,node:HTMLDivElement,boot:Bootstrap;
const fetchMock=vi.fn(),confirmMock=vi.fn();
const emptyList={items:[],total:0,skip:0,take:50,commentCounts:[],attachmentCounts:[],canHandle:false};
const saved:FeedbackItem={id:7,projectId:3,reporterId:1,assigneeId:null,linkedTaskId:null,type:'bug',priority:'normal',status:'new',title:'저장 회귀 검사',body:'본문',resolution:'',version:1,createdAt:'2026-09-22T00:00:00Z',updatedAt:'2026-09-22T00:00:00Z'};

function json(value:unknown){return Response.json(value,{headers:{'Content-Type':'application/json'}});}
function receipt(){return Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'제보를 등록했습니다.',data:{operation:'create',actorId:'1',result:{item:saved}}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});}

beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);window.eval(readSource);vi.stubGlobal('fetch',fetchMock);
  Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});
  const me={id:1,name:'직원',department:'기획',departmentId:2,projectIds:[3],role:'employee',active:true,shared:false,access:true,isAdmin:false};
  boot={me,demo:false,csrfToken:'synthetic',employees:[me],departments:[{id:2,name:'기획',archived:false}],leads:[],projects:[{id:3,name:'프로젝트',color:'#123456',archived:false,version:1}],goals:[]};
  fetchMock.mockImplementation((input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
    if(url.pathname==='/api/feedback'&&init?.method==='POST')return Promise.resolve(receipt());
    if(url.pathname==='/api/feedback')return Promise.resolve(json(emptyList));
    throw Error(`Unexpected request: ${url.pathname}`);
  });
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});

afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;window.dispatchEvent(new Event('pagehide'));node.remove();vi.unstubAllGlobals();});

test('confirmed new feedback registers its form owner and sends exactly one write',async()=>{
  await act(async()=>root!.render(createElement(FeedbackBoard,{boot,open:vi.fn(),close:vi.fn(),openTask:vi.fn(),refreshIdentity:vi.fn(async()=>boot)})));
  await act(async()=>{});
  const create=[...node.querySelectorAll('button')].find(button=>button.textContent?.includes('제보 등록'))!;
  await act(async()=>create.click());
  const title=node.querySelector('input[required]') as HTMLInputElement;
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(title,'저장 회귀 검사');title.dispatchEvent(new Event('input',{bubbles:true}));});
  const save=[...node.querySelectorAll('button')].find(button=>button.textContent==='저장')!;
  await act(async()=>save.click());
  const writes=fetchMock.mock.calls.filter(([,init])=>(init as RequestInit|undefined)?.method==='POST');
  expect(confirmMock).toHaveBeenCalledOnce();expect(writes).toHaveLength(1);
  const [url,request]=writes[0],headers=(request as RequestInit).headers as Headers;expect(new URL(String(url)).pathname).toBe('/api/feedback');expect(headers.get('X-CSRF-TOKEN')).toBe('synthetic');expect(headers.get('X-Workspace-Actor')).toBe('1');
  expect(node.textContent).not.toContain('제보를 등록했습니다.');expect(document.body.textContent).toContain('제보를 등록했습니다.');expect(node.querySelector('input[required]')).toBeNull();
});
