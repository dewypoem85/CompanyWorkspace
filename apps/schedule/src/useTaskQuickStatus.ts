import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {captureTaskWrite,confirmTaskReceipt,statusDraft,taskWriteBaseline,type TaskReceipt,type TaskWrite} from './taskWrites';
import {scheduleActorScope,scheduleGet,taskDetailResponse} from './scheduleReads';
import type {Bootstrap,Status,Task} from './types';
import {statuses} from './types';

type Options={
  boot?:Bootstrap;disabled:boolean;currentTask:(id:number)=>Task|undefined;
  refreshIdentity:()=>Promise<Bootstrap>;refreshBoard:()=>Promise<void>;invalidate:()=>void;
};
type Command={source:string;status:Status;write:TaskWrite;lease:FormLease;receipt?:TaskReceipt};
let nextOwner=0;

export function useTaskQuickStatus(options:Options){
  const live=useRef(options);live.current=options;
  const owner=useRef(`schedule-quick-status-${++nextOwner}`),actor=useRef<string|null>(options.boot?scheduleActorScope(options.boot.me):null);
  const mounted=useRef(false),forms=useRef<WorkspaceFormSession|undefined>(undefined),reads=useRef<WorkspaceReadSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),command=useRef<Command|null>(null);
  const [busyTaskId,setBusyTaskId]=useState<number|null>(null),[locked,setLocked]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  const sameOwner=useCallback(()=>!!(mounted.current&&live.current.boot&&actor.current===scheduleActorScope(live.current.boot.me)&&!forms.current?.invalid),[]);
  const current=useCallback((active:Command)=>sameOwner()&&active.lease.current&&command.current===active&&!live.current.disabled&&JSON.stringify(live.current.currentTask(active.write.id!))===active.source,[sameOwner]);

  useEffect(()=>{
    mounted.current=true;
    let untrack:(()=>void)|undefined,unsubscribe:(()=>void)|undefined;
    try{
      const session=workspaceDocumentFormSession('schedule-task-writes');forms.current=session;
      untrack=session.track(owner.current);const sync=()=>{if(mounted.current)setLocked(session.invalid);};unsubscribe=session.subscribe(sync);sync();
      reads.current=createWorkspaceReadSession();
      transport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onConflict:()=>void live.current.refreshBoard(),
        onSaved:(value,sent,context)=>{const active=command.current;if(!active||!current(active)||!context.isCurrent())throw Error('상태 저장 중 업무·계정 또는 화면이 변경되었습니다.');active.receipt=confirmTaskReceipt(value,active.write,sent);}});
    }catch(error){setLocked(true);setOutcome({kind:'error',title:'상태 변경 도구를 준비하지 못했습니다.',message:(error as Error).message});}
    const scopeChanged=()=>{if(command.current)command.current.lease.finish('unknown');command.current=null;setBusyTaskId(null);};
    document.addEventListener('workspace-entity-scope-change',scopeChanged);
    return()=>{mounted.current=false;command.current?.lease.finish('unknown');command.current=null;transport.current?.dispose();reads.current?.dispose();untrack?.();unsubscribe?.();document.removeEventListener('workspace-entity-scope-change',scopeChanged);};
  },[current]);
  useEffect(()=>{
    if(!options.boot)return;
    const scope=scheduleActorScope(options.boot.me);
    if(actor.current===null)actor.current=scope;else if(actor.current!==scope)forms.current?.invalidate();
  },[options.boot]);

  async function run(source:Task,status:Status){
    const start=live.current,session=forms.current,readSession=reads.current,writer=transport.current;
    if(status===source.status||!start.boot||start.disabled||locked||command.current||!session||!readSession||!writer||!sameOwner())return;
    const sourceSignature=JSON.stringify(source),actorScope=scheduleActorScope(start.boot.me);setBusyTaskId(source.id);setOutcome({kind:'loading',title:'업무와 계정을 다시 확인합니다.'});
    let active:Command|undefined,attempted=false,finished=false;
    try{
      const checked=await readSession.run('quick-status',async signal=>{
        const directory=await start.refreshIdentity();signal.throwIfAborted();
        const detail=await scheduleGet(`/api/tasks/${source.id}`,signal,value=>taskDetailResponse(value,source.id));signal.throwIfAborted();
        return {directory,detail};
      });
      if(checked.status==='cancelled'||!checked.isCurrent()||JSON.stringify(live.current.currentTask(source.id))!==sourceSignature)throw Error('확인 중 업무 또는 조회 조건이 변경되었습니다.');
      if(checked.status==='error')throw checked.error;
      if(scheduleActorScope(checked.value.directory.me)!==actorScope||!sameOwner())throw new ApiError(403,'로그인 상태 또는 권한이 변경되었습니다.');
      if(!checked.value.detail.canEdit||checked.value.detail.task.version!==source.version)throw Error('목록 이후 업무가 변경되었습니다. 최신 목록을 확인해 주세요.');
      taskWriteBaseline(checked.value.detail,String(checked.value.directory.me.id));
      const write=captureTaskWrite('status',statusDraft(checked.value.detail,status),checked.value.directory,checked.value.detail);
      const lease=session.begin(owner.current,[`task:${source.id}:${write.stateToken}`]);
      if(!lease)throw Error('다른 저장이 진행 중이거나 이 업무 기준이 이미 사용되었습니다. 최신 목록을 확인해 주세요.');
      active={source:sourceSignature,status,write,lease};command.current=active;
      const validate=()=>current(active!)?null:'확인 중 업무·계정 또는 조회 조건이 변경되었습니다. 취소 후 다시 시도해 주세요.';
      setOutcome(null);
      const assignee=checked.value.directory.employees.find(employee=>employee.id===write.draft.form.assigneeId);
      const intent=await confirmWorkspaceAction({title:'업무 상태를 변경할까요?',message:'최신 업무 기준을 확인했습니다. 저장 결과가 확인될 때까지 같은 업무를 다시 변경하지 않습니다.',confirmLabel:'상태 변경',signal:lease.signal,validate,
        details:[{label:'업무',value:write.draft.form.title},{label:'담당자',value:assignee?.name||'직원',entity:{kind:'employee',id:String(write.draft.form.assigneeId),name:assignee?.name||'직원'}},{label:'변경 상태',value:statuses[status]}]});
      if(!intent){finished=true;lease.finish('cancelled');setOutcome(null);return;}
      const invalid=validate();if(invalid)throw Error(invalid);
      attempted=true;if(!lease.markSent())throw Error('저장 직전 계정 범위가 변경되었습니다.');
      const result=await writer.send({url:`/api/tasks/${source.id}/status`,method:'PATCH',json:write.body,signal:lease.signal,
        headers:{'X-CSRF-TOKEN':checked.value.directory.csrfToken,'X-Workspace-Actor':write.actorId,'X-Workspace-State':write.stateToken!}});
      const receipt=active.receipt;
      if(result.saved&&receipt&&current(active)){
        finished=true;lease.finish('saved');command.current=null;
        try{await live.current.refreshBoard();if(mounted.current&&sameOwner())setOutcome({kind:'success',title:'업무 상태를 변경했습니다.',message:`${statuses[receipt.task.status]} 상태로 저장했습니다.`});}
        catch{if(mounted.current&&sameOwner())setOutcome({kind:'success',title:'상태 변경은 완료했지만 목록 확인에 실패했습니다.',message:'같은 변경을 다시 보내지 말고 목록만 다시 조회해 주세요.',actionLabel:'일정 다시 조회',onAction:()=>void live.current.refreshBoard()});}
      }else{
        finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');
        if(result.outcome==='denied'){live.current.invalidate();document.dispatchEvent(new Event('workspace-entity-scope-change'));}
      }
    }catch(error){
      if(error instanceof ApiError&&[401,403].includes(error.status)){live.current.invalidate();document.dispatchEvent(new Event('workspace-entity-scope-change'));}
      if(mounted.current&&sameOwner())setOutcome({kind:'error',title:attempted?'상태 변경 결과를 확인해 주세요.':'상태 변경 요청을 보내지 않았습니다.',message:(error as Error).message,actionLabel:'일정 다시 조회',onAction:()=>void live.current.refreshBoard()});
    }finally{
      if(active&&!finished)active.lease.finish(attempted?'unknown':'cancelled');
      if(command.current===active)command.current=null;
      if(mounted.current)setBusyTaskId(null);
    }
  }
  return {run,busyTaskId,locked,outcome};
}
