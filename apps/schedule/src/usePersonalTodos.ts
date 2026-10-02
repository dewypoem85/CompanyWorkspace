import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import {useWorkspaceNavigationRequest} from './generated/workspace-navigation';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {requireTodoActor,todoActorScope,todoSignature,validateTodoList,type TodoCommand} from './personalTodoContract';
import {captureTodoWrite,confirmTodoReceipt,todoEditingResponse,todoWriteResource,type TodoReceipt,type TodoWrite} from './personalTodoWrites';
import {scheduleGet} from './scheduleReads';
import type {Bootstrap,PersonalTodo} from './types';

type TodoOperation={write:TodoWrite;lease:FormLease;current:()=>boolean;receipt?:TodoReceipt};
let ownerSequence=0;

export function usePersonalTodos(boot:Bootstrap,refreshIdentity:()=>Promise<Bootstrap>) {
  const [items,setItems]=useState<PersonalTodo[]>([]),[archived,setArchived]=useState(false);
  const [title,setTitle]=useState(''),[editor,setEditor]=useState<{item:PersonalTodo;draft:string}|null>(null);
  const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false);
  const [outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  const live=useRef({boot,refreshIdentity,archived,items,title,editor,ready});live.current={boot,refreshIdentity,archived,items,title,editor,ready};
  const owner=useRef(`schedule-todo-${++ownerSequence}`),locked=useRef(false),blocked=useRef(false),mounted=useRef(true),epoch=useRef(0),readId=useRef(0);
  const readSession=useRef<WorkspaceReadSession|undefined>(undefined),writeSession=useRef<WorkspaceFormSession|undefined>(undefined),writeTransport=useRef<WorkspaceWriteTransport|undefined>(undefined),operation=useRef<TodoOperation|null>(null);
  const editCancelRequest=useRef<AbortController|null>(null),editSwitchRequest=useRef<AbortController|null>(null),tabSwitchRequest=useRef<AbortController|null>(null),navigationDiscardRequest=useRef<AbortController|null>(null);
  const completed=useRef('');
  const scope=todoActorScope(boot.me),previousScope=useRef(scope),writeActor=useRef(scope);
  const dirty=Boolean(title.trim()||editor&&editor.draft!==editor.item.title);
  async function requestTodoNavigationDiscard({source,to,signal}:{source:'history'|'navigation';from:string;to:string;signal:AbortSignal}):Promise<(()=>boolean)|null>{
    if(locked.current||signal.aborted||!mounted.current||editCancelRequest.current||editSwitchRequest.current||tabSwitchRequest.current||navigationDiscardRequest.current)return null;
    const start=live.current,generation=epoch.current,actor=todoActorScope(start.boot.me),tab=start.archived,newTitle=start.title;
    const editorSnapshot=start.editor?JSON.stringify([todoSignature(start.editor.item),start.editor.draft]):null;
    const editorDirty=Boolean(start.editor&&start.editor.draft!==start.editor.item.title),newDirty=Boolean(newTitle.trim());
    const stable=()=>current(generation,actor,tab)&&!signal.aborted&&!locked.current&&!editCancelRequest.current&&!editSwitchRequest.current&&!tabSwitchRequest.current&&live.current.title===newTitle
      && (live.current.editor?JSON.stringify([todoSignature(live.current.editor.item),live.current.editor.draft]):null)===editorSnapshot;
    if(!newDirty&&!editorDirty)return stable;
    const abort=new AbortController(),cancel=()=>abort.abort();signal.addEventListener('abort',cancel,{once:true});navigationDiscardRequest.current=abort;
    try {
      const details=[{label:'이동 위치',value:new URL(to,location.origin).pathname},{label:'이동 방식',value:source==='history'?'브라우저 이전·다음':'사이드바·링크'}];
      if(newDirty)details.push({label:'새 TODO',value:newTitle});
      if(editorDirty&&start.editor)details.push({label:'TODO 수정',value:start.editor.draft},{label:'원래 TODO',value:`${start.editor.item.title} (v${start.editor.item.version})`});
      const intent=await confirmWorkspaceAction({title:'작성 중인 TODO를 버리고 이동할까요?',message:'저장하지 않은 TODO 내용은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,details,
        validate:()=>stable()&&!abort.signal.aborted?null:'TODO 초안·목록 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      return intent&&stable()&&!abort.signal.aborted?stable:null;
    } catch(error) {if(stable()&&!abort.signal.aborted)setOutcome({kind:'error',title:'TODO 이동 확인창을 열지 못했습니다.',message:(error as Error).message});return null;}
    finally {signal.removeEventListener('abort',cancel);if(navigationDiscardRequest.current===abort)navigationDiscardRequest.current=null;}
  }
  useWorkspaceNavigationRequest(requestTodoNavigationDiscard);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty||locked.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
  const invalidate=useCallback(()=>{
    epoch.current++;readId.current++;readSession.current?.cancel('personal-todos');readSession.current?.cancel('todo-write-preflight');writeSession.current?.invalidate();editCancelRequest.current?.abort();editSwitchRequest.current?.abort();tabSwitchRequest.current?.abort();navigationDiscardRequest.current?.abort();blocked.current=true;completed.current='';
    setNeedsRefresh(true);setItems([]);setReady(false);
    setOutcome({kind:'denied',title:'로그인·권한이 변경되었습니다.',message:'이전 응답을 적용하지 않습니다. 현재 계정으로 목록을 다시 확인해 주세요.'});
  },[]);
  useEffect(()=>{
    mounted.current=true;let untrack:(()=>void)|undefined;
    try{
      readSession.current=createWorkspaceReadSession();
      writeSession.current=workspaceDocumentFormSession('schedule-todo-writes');
      untrack=writeSession.current.track(owner.current,()=>Boolean(live.current.title.trim()||live.current.editor&&live.current.editor.draft!==live.current.editor.item.title));
      writeTransport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onSaved:(value,sent,context)=>{
        const active=operation.current;if(!active?.current()||!context.isCurrent())throw Error('TODO 저장 중 대상·계정 또는 초안이 변경되었습니다.');
        active.receipt=confirmTodoReceipt(value,active.write,sent);
      }});
    }catch(cause){blocked.current=true;setNeedsRefresh(true);setOutcome({kind:'error',title:'개인 TODO 작업을 준비하지 못했습니다.',message:(cause as Error).message});}
    document.addEventListener('workspace-entity-scope-change',invalidate);
    return()=>{mounted.current=false;epoch.current++;readId.current++;operation.current?.lease.finish('unknown');writeTransport.current?.dispose();readSession.current?.dispose();editCancelRequest.current?.abort();editSwitchRequest.current?.abort();tabSwitchRequest.current?.abort();navigationDiscardRequest.current?.abort();untrack?.();document.removeEventListener('workspace-entity-scope-change',invalidate);};
  },[invalidate]);
  useEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;invalidate();}},[scope,invalidate]);
  const current=(generation:number,actor:string,tab:boolean)=>mounted.current&&epoch.current===generation&&todoActorScope(live.current.boot.me)===actor&&live.current.archived===tab;
  async function read(generation:number,actor:string,tab:boolean) {
    const request=++readId.current,session=readSession.current,ownerId=live.current.boot.me.id;
    if(!session)throw Error('공통 TODO 조회 도구를 사용할 수 없습니다. 페이지를 다시 열어 주세요.');
    const [result,directory]=await Promise.all([session.run('personal-todos',signal=>scheduleGet(`/api/personal-todos?archived=${tab}`,signal,value=>validateTodoList(value,ownerId))),live.current.refreshIdentity()]);
    if(!current(generation,actor,tab)||request!==readId.current||todoActorScope(directory.me)!==actor)throw Error('조회 중 계정 또는 목록이 변경되었습니다.');
    if(result.status==='cancelled'||!result.isCurrent())throw Error('TODO 목록 조회가 취소되었습니다.');
    if(result.status==='error')throw result.error;
    requireTodoActor(directory.me);if(directory.me.id!==ownerId)throw Error('조회 중 TODO 소유 계정이 변경되었습니다.');
    return result.value;
  }
  async function refresh(manual=true) {
    if(locked.current||!manual&&(blocked.current||live.current.ready&&(live.current.editor||live.current.title.trim())))return;
    locked.current=true;setBusy(true);const generation=epoch.current,actor=todoActorScope(live.current.boot.me),tab=live.current.archived;
    if(manual)setOutcome({kind:'loading',title:'개인 TODO를 확인합니다.'});
    try {
      const next=await read(generation,actor,tab);if(!current(generation,actor,tab))return;
      setItems(next);setReady(true);
      const writes=writeSession.current,recovered=!writes?.invalid||(actor===writeActor.current&&writes.recoverScope());
      blocked.current=!recovered;setNeedsRefresh(!recovered);
      if(!recovered){setOutcome({kind:'denied',title:'TODO 저장은 계속 잠겨 있습니다.',message:'전송 결과가 불명확하거나 계정이 변경되었습니다. 목록은 확인했지만 다시 저장하려면 페이지를 새로 열어 주세요.'});return;}
      if(manual)setOutcome(completed.current?{kind:'success',title:completed.current,message:'최신 목록을 다시 확인했습니다. 변경 요청은 반복하지 않았습니다.'}:{kind:'success',title:'목록을 확인했습니다.',message:'편집 초안은 유지했습니다. 이전 요청이 반영되었을 수 있으므로 현재 목록을 확인하세요.'});
    }catch(error){if(current(generation,actor,tab)){blocked.current=true;setNeedsRefresh(true);setOutcome({kind:completed.current?'success':'error',title:completed.current||'개인 TODO를 불러오지 못했습니다.',message:(error as Error).message});}}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  useEffect(()=>{
    const initial=setTimeout(()=>void refresh(false),0);
    const timer=setInterval(()=>void refresh(false),60000),focus=()=>void refresh(false);
    window.addEventListener('focus',focus);return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',focus);};
  },[archived]);
  function applyTabSwitch(next:boolean) {
    epoch.current++;readId.current++;readSession.current?.cancel('personal-todos');setEditor(null);setItems([]);setReady(false);setArchived(next);
    // A tab switch must not unlock an uncertain mutation or changed identity.
    if(!blocked.current){completed.current='';setOutcome(null);}
  }
  async function switchTab(next:boolean) {
    if(locked.current||next===live.current.archived||editCancelRequest.current||editSwitchRequest.current||tabSwitchRequest.current||navigationDiscardRequest.current)return;
    const start=live.current.editor;if(!start||start.draft===start.item.title){applyTabSwitch(next);return;}
    const generation=epoch.current,actor=todoActorScope(live.current.boot.me),tab=live.current.archived,snapshot=JSON.stringify([todoSignature(start.item),start.draft]),abort=new AbortController();
    const stable=()=>current(generation,actor,tab)&&!abort.signal.aborted&&live.current.archived!==next&&Boolean(live.current.editor)&&JSON.stringify([todoSignature(live.current.editor!.item),live.current.editor!.draft])===snapshot;
    tabSwitchRequest.current=abort;
    try {
      const intent=await confirmWorkspaceAction({title:'TODO 목록을 전환할까요?',message:'현재 저장하지 않은 수정 내용은 사라집니다.',confirmLabel:'목록 전환',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'현재 초안',value:start.draft},{label:'이동할 목록',value:next?'보관함':'할 일'},{label:'원래 TODO',value:start.item.title},{label:'검토 버전',value:String(start.item.version)}],validate:()=>stable()?null:'TODO 초안·목록 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(intent&&stable())applyTabSwitch(next);
    } catch(error) {if(stable())setOutcome({kind:'error',title:'TODO 목록을 전환하지 못했습니다.',message:(error as Error).message});}
    finally {if(tabSwitchRequest.current===abort)tabSwitchRequest.current=null;}
  }
  async function edit(item:PersonalTodo) {
    if(locked.current||blocked.current||editCancelRequest.current||editSwitchRequest.current||tabSwitchRequest.current||navigationDiscardRequest.current)return;
    const start=live.current.editor,target={...item};
    if(!start){setEditor({item:target,draft:target.title});return;}
    if(start.item.id===target.id)return;
    if(start.draft===start.item.title){setEditor({item:target,draft:target.title});return;}
    const generation=epoch.current,actor=todoActorScope(live.current.boot.me),tab=live.current.archived,snapshot=JSON.stringify([todoSignature(start.item),start.draft]),targetSignature=todoSignature(target),abort=new AbortController();
    const stable=()=>current(generation,actor,tab)&&!abort.signal.aborted&&Boolean(live.current.editor)&&JSON.stringify([todoSignature(live.current.editor!.item),live.current.editor!.draft])===snapshot&&live.current.items.some(value=>todoSignature(value)===targetSignature);
    editSwitchRequest.current=abort;
    try {
      const intent=await confirmWorkspaceAction({title:'다른 TODO를 수정할까요?',message:'현재 저장하지 않은 수정 내용은 사라집니다.',confirmLabel:'TODO 전환',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'현재 초안',value:start.draft},{label:'이동할 TODO',value:target.title},{label:'현재 버전',value:String(start.item.version)},{label:'대상 버전',value:String(target.version)}],validate:()=>stable()?null:'TODO 초안·대상 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(intent&&stable())setEditor({item:target,draft:target.title});
    } catch(error) {if(stable())setOutcome({kind:'error',title:'다른 TODO를 열지 못했습니다.',message:(error as Error).message});}
    finally {if(editSwitchRequest.current===abort)editSwitchRequest.current=null;}
  }
  async function cancelEdit() {
    if(locked.current||editCancelRequest.current||editSwitchRequest.current||tabSwitchRequest.current||navigationDiscardRequest.current)return;
    const start=live.current.editor;if(!start)return;
    if(start.draft===start.item.title){setEditor(null);return;}
    const generation=epoch.current,actor=todoActorScope(live.current.boot.me),tab=live.current.archived,snapshot=JSON.stringify([todoSignature(start.item),start.draft]),abort=new AbortController();
    const stable=()=>current(generation,actor,tab)&&!abort.signal.aborted&&Boolean(live.current.editor)&&JSON.stringify([todoSignature(live.current.editor!.item),live.current.editor!.draft])===snapshot;
    editCancelRequest.current=abort;
    try {
      const intent=await confirmWorkspaceAction({title:'TODO 수정을 취소할까요?',message:'저장하지 않은 수정 내용은 사라집니다.',confirmLabel:'수정 취소',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'TODO',value:start.draft},{label:'원래 내용',value:start.item.title},{label:'검토 버전',value:String(start.item.version)}],validate:()=>stable()?null:'TODO 초안 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(intent&&stable())setEditor(null);
    } catch(error) {if(stable())setOutcome({kind:'error',title:'TODO 편집을 닫지 못했습니다.',message:(error as Error).message});}
    finally {if(editCancelRequest.current===abort)editCancelRequest.current=null;}
  }
  async function run(command:TodoCommand) {
    const start=live.current,forms=writeSession.current,writer=writeTransport.current,reader=readSession.current;
    if(!forms||!writer||!reader||forms.invalid||locked.current||blocked.current||operation.current||tabSwitchRequest.current||navigationDiscardRequest.current||!ready)return;
    if(start.editor&&command.kind!=='save')return;
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    const generation=epoch.current,actor=todoActorScope(start.boot.me),tab=start.archived,ownerId=start.boot.me.id;
    const resource=todoWriteResource(command,start.items,ownerId,tab),lease=forms.begin(owner.current,[resource]);
    if(!lease){setOutcome({kind:'error',title:'이전 TODO 기준으로 다시 저장할 수 없습니다.',message:'이미 처리했거나 변경된 기준입니다. 최신 목록을 다시 확인해 주세요.'});return;}
    locked.current=true;readId.current++;setBusy(true);setOutcome({kind:'loading',title:'TODO 대상과 계정을 확인합니다.'});completed.current='';
    let attempted=false,finished=false,active:TodoOperation|undefined;
    const draftCurrent=()=>current(generation,actor,tab)&&lease.current
      && (command.kind!=='save'||live.current.editor?.item===start.editor?.item&&live.current.editor?.draft.trim()===command.title)
      && (command.kind!=='add'||live.current.title.trim()===command.title);
    try {
      requireTodoActor(start.boot.me);
      if('item' in command&&command.item.ownerId!==ownerId)throw Error('현재 계정의 TODO가 아닙니다.');
      const id='item' in command?command.item.id:undefined;
      const preflight=await reader.run('todo-write-preflight',async signal=>{
        const [directory,editing]=await Promise.all([
          start.refreshIdentity(),
          scheduleGet(`/api/personal-todos/editing?archived=${tab}${id===undefined?'':`&id=${id}`}`,signal,value=>todoEditingResponse(value,ownerId,id))
        ]);
        signal.throwIfAborted();return{directory,editing};
      });
      if(preflight.status==='cancelled'||!draftCurrent())throw Error('확인 중 계정·목록 또는 초안이 변경되었습니다.');
      if(!preflight.isCurrent())throw Error('현재 TODO 저장 확인이 아닙니다.');
      if(preflight.status==='error')throw preflight.error;
      if(todoActorScope(preflight.value.directory.me)!==actor)throw Error('로그인 상태 또는 권한이 변경되었습니다.');
      const write=captureTodoWrite(command,start.boot,start.items,preflight.value.editing);
      const valid=()=>{
        if(!draftCurrent())return false;
        try{return captureTodoWrite(command,live.current.boot,live.current.items,preflight.value.editing).actorScope===write.actorScope;}
        catch{return false;}
      };
      active={write,lease,current:valid};operation.current=active;
      if(command.kind==='delete') {
        const target=preflight.value.editing.todos[0];
        const intent=await confirmWorkspaceAction({title:'개인 TODO를 삭제할까요?',message:'이 할 일은 영구 삭제되며 되돌릴 수 없습니다.',
          details:[{label:'삭제할 내용',value:target.title},{label:'검토 버전',value:String(target.version)}],tone:'danger',confirmLabel:'TODO 삭제',returnFocus,signal:lease.signal,
          validate:()=>valid()?null:'대상 또는 로그인 상태가 변경되었습니다. 취소 후 다시 확인해 주세요.'});
        if(!intent)return;
      }
      if(!valid())throw Error('확인한 TODO 또는 초안이 변경되었습니다.');
      attempted=true;if(!lease.markSent())throw Error('TODO 저장 계정 범위가 변경되었습니다.');
      blocked.current=true;setNeedsRefresh(true);
      const url=command.kind==='add'?'/api/personal-todos':command.kind==='order'?'/api/personal-todos/order':command.kind==='complete'?`/api/personal-todos/${command.item.id}/completion`:command.kind==='save'?`/api/personal-todos/${command.item.id}`:`/api/personal-todos/${command.item.id}?version=${command.item.version}`;
      const method=command.kind==='add'?'POST':command.kind==='complete'?'PATCH':command.kind==='delete'?'DELETE':'PUT';
      const result=await writer.send({url,method,json:write.body,signal:lease.signal,headers:{'X-CSRF-TOKEN':preflight.value.directory.csrfToken,'X-Workspace-Actor':write.actorId,'X-Workspace-Todo-State':write.stateToken}});
      const receipt=active.receipt;
      if(result.saved&&receipt&&valid()){
        finished=true;lease.finish('saved');
        if(command.kind==='add')setTitle('');if(command.kind==='save')setEditor(null);
        completed.current=command.kind==='delete'?'TODO를 삭제했습니다.':command.kind==='add'?'TODO를 추가했습니다.':command.kind==='order'?'TODO 순서를 변경했습니다.':command.kind==='save'?'TODO를 저장했습니다.':command.completed?'TODO를 완료했습니다.':'TODO를 할 일로 되돌렸습니다.';
        setOutcome({kind:'success',title:completed.current});
        try{const next=await read(generation,actor,tab);if(!current(generation,actor,tab))return;setItems(next);setReady(true);blocked.current=false;setNeedsRefresh(false);}
        catch(error){if(current(generation,actor,tab))setOutcome({kind:'success',title:'변경은 완료되었지만 목록 갱신에 실패했습니다.',message:completed.current+' '+(error as Error).message+' 다시 저장하지 말고 목록만 다시 확인해 주세요.'});}
      }else{
        finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');
        const retryable=result.outcome==='invalid'||result.outcome==='not-sent';blocked.current=!retryable;setNeedsRefresh(!retryable);
      }
    }catch(error){
      if(error instanceof ApiError&&[401,403].includes(error.status))document.dispatchEvent(new Event('workspace-entity-scope-change'));
      if(current(generation,actor,tab)){blocked.current=attempted||!(error instanceof ApiError&&error.status===400);setNeedsRefresh(blocked.current);setOutcome({kind:error instanceof ApiError&&[401,403].includes(error.status)?'denied':'error',title:attempted?'TODO 저장 결과를 확인해 주세요.':'TODO 요청을 보내지 않았습니다.',message:(error as Error).message+' 작성 내용은 유지됩니다.'});}
    }finally{
      if(!finished)lease.finish(attempted?'unknown':'cancelled');
      if(active&&operation.current===active)operation.current=null;
      locked.current=false;if(mounted.current)setBusy(false);
    }
  }
  return {items,archived,title,setTitle,editor,setEditor,busy,ready,needsRefresh,outcome,switchTab,edit,cancelEdit,run,refresh};
}
