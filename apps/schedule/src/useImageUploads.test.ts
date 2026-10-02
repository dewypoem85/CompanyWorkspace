// @vitest-environment jsdom
/// <reference types="vite/client" />
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import formsSource from '../../../packages/workspace-ui/src/forms.js?raw';
import {useImageUploads} from './useImageUploads';
import type {Attachment,Bootstrap} from './types';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

type Options=Parameters<typeof useImageUploads>[0];
let root:Root|undefined,node:HTMLDivElement,options:Options,state:ReturnType<typeof useImageUploads>,boot:Bootstrap,images:Attachment[];
const fetchMock=vi.fn(),confirmMock=vi.fn(),setImages=vi.fn(),busyChanged=vi.fn();
function Harness(){state=useImageUploads(options);return null;}
const render=async()=>act(async()=>root!.render(createElement(Harness)));
const file=()=>{const value=new File([new Uint8Array([1,2,3])],'첨부.png',{type:'image/png'});Object.defineProperty(value,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3]).buffer});return value;};
const saved=()=>Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'완료',data:{operation:'upload',actorId:'1',sha256:'0'.repeat(64),attachment:{id:'a'.repeat(32),ownerId:1,taskId:null,commentId:null,name:'첨부.png',contentType:'image/png',size:3,createdAt:'2026-09-12T00:00:00Z'}}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}});
beforeEach(()=>{
  vi.resetAllMocks();window.eval(formsSource);vi.stubGlobal('fetch',fetchMock);vi.stubGlobal('crypto',{subtle:{digest:vi.fn(async()=>new Uint8Array(32).buffer)}});Object.assign(window,{CompanyDialog:{confirm:confirmMock}});confirmMock.mockResolvedValue({confirmation:''});fetchMock.mockResolvedValue(saved());
  const me={id:1,name:'직원',department:'개발',departmentId:1,projectIds:[],role:'employee',active:true,shared:false,access:true,isAdmin:false};boot={me,employees:[me],projects:[],departments:[],leads:[],demo:false,csrfToken:'synthetic'};images=[];
  setImages.mockImplementation(value=>{images=value;});options={boot,refreshIdentity:vi.fn(async()=>boot),images,setImages,disabled:false,label:'업무 본문',busyChanged};
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;node.remove();vi.unstubAllGlobals();});

test('uploads through the shared multipart transport and accepts only the full receipt',async()=>{
  await render();await act(async()=>state.upload([file()]));expect(confirmMock).toHaveBeenCalledOnce();expect(fetchMock).toHaveBeenCalledOnce();expect(setImages).toHaveBeenCalledOnce();expect(images[0].id).toBe('a'.repeat(32));expect(state.outcome).toMatchObject({kind:'success',title:'이미지를 첨부했습니다.'});
  const [url,request]=fetchMock.mock.calls[0];expect(new URL(url).pathname).toBe('/api/images');expect(request.method).toBe('POST');expect(request.body).toBeInstanceOf(FormData);expect(request.headers.get('Content-Type')).toBeNull();expect(request.headers.get('X-Workspace-Actor')).toBe('1');expect(request.headers.get('X-CSRF-TOKEN')).toBe('synthetic');expect(busyChanged.mock.calls).toEqual([[true],[false]]);
});

test('selection confirmation can be cancelled without uploading',async()=>{
  confirmMock.mockResolvedValue(null);await render();await act(async()=>state.upload([file()]));expect(fetchMock).not.toHaveBeenCalled();expect(setImages).not.toHaveBeenCalled();expect(state.outcome).toBeNull();
});

test('changed identity or attachment list before confirmation prevents the request',async()=>{
  let decide!:(value:{confirmation:string})=>void;confirmMock.mockImplementation(()=>new Promise(resolve=>{decide=resolve;}));await render();let pending!:Promise<void>;act(()=>{pending=state.upload([file()]);});await act(async()=>{});options={...options,images:[{id:'b'.repeat(32),ownerId:1,taskId:null,commentId:null,name:'old.png',contentType:'image/png',size:1,createdAt:'2026-09-12T00:00:00Z'}]};await render();await act(async()=>{decide({confirmation:''});await pending;});expect(fetchMock).not.toHaveBeenCalled();expect(setImages).not.toHaveBeenCalled();
});

test('a second selection cannot open another confirmation while the first batch is pending',async()=>{
  let decide!:(value:{confirmation:string})=>void;confirmMock.mockImplementation(()=>new Promise(resolve=>{decide=resolve;}));await render();let pending!:Promise<void>,duplicate!:Promise<void>;act(()=>{pending=state.upload([file()]);duplicate=state.upload([file()]);});await act(async()=>duplicate);expect(confirmMock).toHaveBeenCalledOnce();expect(fetchMock).not.toHaveBeenCalled();await act(async()=>{decide({confirmation:''});await pending;});expect(fetchMock).toHaveBeenCalledOnce();
});

test('an unconfirmed upload locks this document and is never retried',async()=>{
  fetchMock.mockResolvedValue(Response.json({protocol:'workspace-form-v1',outcome:'saved',message:'broken',data:{operation:'upload'}},{headers:{'Content-Type':'application/vnd.company.workspace-form+json'}}));await render();await act(async()=>state.upload([file()]));expect(fetchMock).toHaveBeenCalledOnce();expect(setImages).not.toHaveBeenCalled();expect(state.locked).toBe(true);expect(state.outcome?.kind).toBe('error');await act(async()=>state.upload([file()]));expect(fetchMock).toHaveBeenCalledOnce();
});
