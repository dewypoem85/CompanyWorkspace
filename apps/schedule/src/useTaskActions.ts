import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError} from './api';
import {commentActorScope} from './commentReview';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {captureTaskAction,confirmTaskActionReceipt,taskActionBaseline, taskActionSignature, taskActionTarget, verifyTaskActionRead, type TaskAction, type TaskActionKind, type TaskActionWrite} from './taskActions';
import type {Bootstrap, Detail} from './types';

type Options = {id?: number; detail?: Detail; boot: Bootstrap; blockedReason: string; refreshIdentity: () => Promise<Bootstrap>; readDetail: () => Promise<Detail>; applyDetail: (detail: Detail) => void; changed: () => Promise<void>; revalidated?: (detail:Detail,directory:Bootstrap)=>void};
type Outcome = WorkspaceStateProps;
type ActiveOperation={write:TaskActionWrite;lease:FormLease;current:()=>boolean};
let actionOwner=0;
export function useTaskActions(options: Options) {
  const live=useRef(options);live.current=options;
  const locked=useRef(false),mounted=useRef(true),epoch=useRef(0),controller=useRef<AbortController|null>(null),last=useRef<{id:number;confirmed?:TaskAction}|null>(null);
  const owner=useRef(`schedule-task-action-${++actionOwner}`);
  const forms=useRef<WorkspaceFormSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),operation=useRef<ActiveOperation|null>(null);
  const [busy,setBusy]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false),[outcome,setOutcome]=useState<Outcome|null>(null);
  const refreshRequired=useRef(false);
  const invalidate=useCallback(()=>{
    epoch.current++;controller.current?.abort();
    forms.current?.invalidate();
    if(last.current){last.current.confirmed=undefined;refreshRequired.current=true;setNeedsRefresh(true);setOutcome({kind:'error',title:'로그인 상태가 변경되었습니다.',message:'현재 권한으로 업무를 다시 확인해 주세요. 요청은 자동 반복하지 않습니다.'});}
  },[]);
  useEffect(()=>{
    mounted.current=true;
    let untrack:(()=>void)|undefined;
    try{
      forms.current=workspaceDocumentFormSession('schedule-task-actions');
      untrack=forms.current.track(owner.current,()=>false);
      transport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onSaved:(value,sent,context)=>{
        const active=operation.current;
        if(!active?.current()||!context.isCurrent())throw Error('업무 작업 중 대상 또는 계정이 변경되었습니다.');
        confirmTaskActionReceipt(value,active.write,sent);
      }});
    }catch(error){refreshRequired.current=true;setNeedsRefresh(true);setOutcome({kind:'error',title:'업무 작업 도구를 시작하지 못했습니다.',message:(error as Error).message});}
    document.addEventListener('workspace-entity-scope-change',invalidate);
    return()=>{mounted.current=false;epoch.current++;controller.current?.abort();operation.current?.lease.finish('unknown');transport.current?.dispose();untrack?.();document.removeEventListener('workspace-entity-scope-change',invalidate);};
  },[invalidate]);
  useEffect(()=>{epoch.current++;controller.current?.abort();last.current=null;refreshRequired.current=false;setNeedsRefresh(false);setOutcome(null);},[options.id]);
  const scopeKey=commentActorScope(options.boot.me),previousScope=useRef(scopeKey);
  useEffect(()=>{if(previousScope.current!==scopeKey){previousScope.current=scopeKey;invalidate();}},[scopeKey,invalidate]);

  const currentScope=()=>commentActorScope(live.current.boot.me);
  async function read(id:number,scope:string,generation:number,confirmed?:TaskAction) {
    const [detail,directory]=await Promise.all([live.current.readDetail(),live.current.refreshIdentity()]);
    if(!mounted.current||epoch.current!==generation||live.current.id!==id||currentScope()!==scope||commentActorScope(directory.me)!==scope)throw Error('조회 중 대상 또는 로그인 상태가 변경되었습니다.');
    if(detail.task.id!==id)throw Error('다른 업무의 조회 응답입니다.');
    if(confirmed)verifyTaskActionRead(detail,confirmed);
    live.current.applyDetail(detail);
    return {detail,directory};
  }
  async function refresh() {
    const previous=last.current;if(locked.current||!previous||previous.id!==live.current.id)return;
    locked.current=true;setBusy(true);const scope=currentScope(),generation=epoch.current;
    try {
      const checked=await read(previous.id,scope,generation,previous.confirmed);await live.current.changed();
      if(!mounted.current||epoch.current!==generation||live.current.id!==previous.id||currentScope()!==scope)return;
      live.current.revalidated?.(checked.detail,checked.directory);
      if(forms.current?.invalid&&!forms.current.recoverScope())throw Error('전송 여부가 불확실한 작업은 이 화면에서 다시 실행할 수 없습니다. 새로 연 화면에서 현재 상태를 확인해 주세요.');
      refreshRequired.current=false;setNeedsRefresh(false);
      setOutcome(previous.confirmed?{kind:'success',title:'처리 후 목록을 다시 확인했습니다.'}:{kind:'error',title:'현재 업무를 다시 조회했습니다.',message:'이전 요청이 반영되었을 수 있습니다. 현재 상태를 확인한 뒤 필요한 작업만 새로 실행해 주세요.'});
    }catch(error){if(mounted.current&&epoch.current===generation&&live.current.id===previous.id)setOutcome({kind:previous.confirmed?'success':'error',title:previous.confirmed?'처리는 완료되었지만 목록 확인에 실패했습니다.':'현재 상태를 확인하지 못했습니다.',message:(error as Error).message});}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  async function run(kind:TaskActionKind,commentId?:number) {
    const start=live.current,session=forms.current,writer=transport.current;
    if(locked.current||refreshRequired.current||start.blockedReason||!start.id||!start.detail||!session||!writer||session.invalid||operation.current)return;
    let write:TaskActionWrite;
    try{write=captureTaskAction(kind,start.id,start.detail,start.boot,commentId);}
    catch(error){setOutcome({kind:'error',title:'업무 작업을 시작하지 못했습니다.',message:(error as Error).message});return;}
    const lease=session.begin(owner.current,[`task-action:${kind}:${write.action.comment?.id??write.action.task.id}:${write.stateToken}`]);
    if(!lease){setOutcome({kind:'error',title:'이전 업무 기준으로 다시 실행할 수 없습니다.',message:'이미 처리했거나 변경된 기준입니다. 업무를 다시 조회해 주세요.'});return;}
    // Preflight awaits a read while disabling the trigger; capture its focus beforehand.
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    const id=start.id,scope=currentScope(),generation=epoch.current,abort=new AbortController();controller.current=abort;
    locked.current=true;setBusy(true);setOutcome({kind:'loading',title:'실행 대상과 권한을 확인합니다.'});last.current={id};
    let attempted=false,finished=false,acknowledged=false;
    const sameScope=()=>mounted.current&&!abort.signal.aborted&&epoch.current===generation&&live.current.id===id&&currentScope()===scope&&!live.current.blockedReason;
    const current=()=>{try{return sameScope()&&lease.current&&taskActionSignature(taskActionTarget(kind,id,live.current.detail!,live.current.boot.me,commentId))===taskActionSignature(write.action)&&taskActionBaseline(live.current.detail!,write.actorId,kind,commentId)===write.stateToken;}catch{return false;}};
    const active:ActiveOperation={write,lease,current};operation.current=active;
    try {
      const [fresh,directory]=await Promise.all([start.readDetail(),start.refreshIdentity()]);
      if(!sameScope()||commentActorScope(directory.me)!==scope)throw Error('대상 또는 로그인 상태가 변경되었습니다.');
      const checked=captureTaskAction(kind,id,fresh,directory,commentId);
      if(checked.actorScope!==write.actorScope||checked.stateToken!==write.stateToken||taskActionSignature(checked.action)!==taskActionSignature(write.action)){live.current.applyDetail(fresh);throw Error('업무 또는 댓글이 변경되었습니다. 최신 내용을 확인한 뒤 다시 실행해 주세요.');}
      const validate=()=>{
        if(!current())return '대상·권한 또는 업무 내용이 변경되었습니다. 취소 후 다시 확인해 주세요.';
        return null;
      };
      const title=kind==='archive'?'업무를 보관할까요?':kind==='restore'?'업무를 복원할까요?':'댓글을 삭제할까요?';
      setOutcome(null);
      const intent=await confirmWorkspaceAction({title,message:kind==='delete-comment'?'댓글 본문을 삭제하고 첨부 연결을 해제합니다. 답글과 감사 기록은 유지됩니다.':'업무의 보관 상태만 변경하며 댓글·이미지·기록은 유지됩니다.',
        details:[{label:'업무',value:checked.action.task.title},...(checked.action.comment?[{label:'삭제할 댓글',value:checked.action.comment.body||'(본문 없음)'}]:[]),{label:'검토 버전',value:String(checked.action.comment?.version??checked.action.task.version)}],
        confirmLabel:kind==='archive'?'보관':kind==='restore'?'복원':'댓글 삭제',tone:kind==='delete-comment'?'danger':undefined,returnFocus,signal:lease.signal,validate});
      if(!intent)return;
      const invalid=validate();if(invalid)throw Error(invalid);
      if(!lease.markSent())throw Error('업무 작업 범위가 변경되었습니다.');
      attempted=true;refreshRequired.current=true;setNeedsRefresh(true);setOutcome({kind:'loading',title:'요청을 처리하고 있습니다.',message:'중복 실행하지 마세요. 완료 후 결과를 표시합니다.'});
      const result=await writer.send({url:kind==='delete-comment'?`/api/comments/${write.action.comment!.id}?version=${write.body.version}`:`/api/tasks/${id}/${kind}`,method:kind==='delete-comment'?'DELETE':'POST',json:write.body,signal:lease.signal,
        headers:{'X-CSRF-TOKEN':directory.csrfToken,'X-Workspace-Actor':write.actorId,[kind==='delete-comment'?'X-Workspace-Target-State':'X-Workspace-State']:write.stateToken}});
      if(!result.saved){finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');return;}
      if(!current())throw Error('업무 작업 완료 전에 대상 또는 계정이 변경되었습니다.');
      acknowledged=true;finished=true;lease.finish('saved');
      last.current={id,confirmed:write.action};
      const completed=kind==='archive'?'업무를 보관했습니다.':kind==='restore'?'업무를 복원했습니다.':'댓글을 삭제했습니다.';
      setOutcome({kind:'success',title:completed});
      try {
        await read(id,scope,generation,write.action);await live.current.changed();
        if(sameScope()){refreshRequired.current=false;setNeedsRefresh(false);}
      }catch {if(mounted.current&&epoch.current===generation&&live.current.id===id)setOutcome({kind:'success',title:completed,message:'처리는 완료되었지만 목록 갱신에 실패했습니다. 다시 실행하지 말고 목록을 다시 확인해 주세요.'});}
    }catch(error){
      if(mounted.current&&epoch.current===generation&&live.current.id===id){
        refreshRequired.current=attempted;setNeedsRefresh(attempted);
        const uncertain=attempted&&(!(error instanceof ApiError)||error.status===0||error.status>=500);
        setOutcome({kind:acknowledged?'success':'error',title:acknowledged?'처리는 완료되었습니다.':uncertain?'실행 결과를 확인해 주세요.':'작업을 실행하지 못했습니다.',message:(error as Error).message+(uncertain?' 서버에 반영되었을 수 있으므로 자동 재전송하지 않습니다.':'')});
      }
    }finally{if(!finished)lease.finish(attempted?'unknown':'cancelled');if(operation.current===active)operation.current=null;if(controller.current===abort)controller.current=null;locked.current=false;if(mounted.current)setBusy(false);}
  }
  return {busy,needsRefresh,outcome,run,refresh};
}
