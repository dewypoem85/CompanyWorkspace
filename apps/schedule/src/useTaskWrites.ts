import {useEffect,useRef,useState} from 'react';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {captureTaskWrite,confirmTaskReceipt,statusDraft,taskWriteBaseline,type TaskReceipt,type TaskWrite} from './taskWrites';
import {scheduleActorScope,scheduleGet,taskDetailResponse} from './scheduleReads';
import {taskValues,type TaskSnapshot} from './taskReview';
import type {Bootstrap,Detail,Status} from './types';
import {statuses} from './types';

type Options={id?:number;boot:Bootstrap;draft:TaskSnapshot;baseline?:Detail;detail?:Detail;blocked:()=>boolean;hasDraft:boolean;
  readDetail:()=>Promise<Detail>;refreshIdentity:()=>Promise<Bootstrap>;changed:()=>Promise<void>;
  committed:(receipt:TaskReceipt)=>void;refreshed:(receipt:TaskReceipt,detail:Detail)=>void;review:()=>void};
type Operation={write:TaskWrite;lease:FormLease;current:()=>boolean;receipt?:TaskReceipt};
let nextOwner=0;
export function useTaskWrites(options:Options){
  const live=useRef(options);live.current=options;
  const owner=useRef(`schedule-task-${++nextOwner}`),actor=useRef(scheduleActorScope(options.boot.me));
  const mounted=useRef(false),session=useRef<WorkspaceFormSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),reads=useRef<WorkspaceReadSession|undefined>(undefined);
  const operation=useRef<Operation|null>(null),confirmed=useRef<TaskReceipt|null>(null),reading=useRef(false);
  const [busy,setBusy]=useState(false),[transmitting,setTransmitting]=useState(false),[locked,setLocked]=useState(false),[needsRefresh,setNeedsRefresh]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  useEffect(()=>{
    mounted.current=true;
    let untrack:(()=>void)|undefined,unsubscribe:(()=>void)|undefined;
    try{
      const forms=workspaceDocumentFormSession('schedule-task-writes');session.current=forms;
      untrack=forms.track(owner.current,()=>live.current.hasDraft);
      const sync=()=>{if(mounted.current)setLocked(forms.invalid);};unsubscribe=forms.subscribe(sync);sync();
      reads.current=createWorkspaceReadSession();
      transport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onConflict:()=>live.current.review(),
        onSaved:(value,sent,context)=>{
          const active=operation.current;
          if(!active?.current()||!context.isCurrent())throw Error('저장 중 대상·계정 또는 초안이 변경되었습니다.');
          active.receipt=confirmTaskReceipt(value,active.write,sent);
        }});
    }catch(error){setLocked(true);setOutcome({kind:'error',message:(error as Error).message});}
    return()=>{mounted.current=false;transport.current?.dispose();reads.current?.dispose();untrack?.();unsubscribe?.();};
  },[]);
  useEffect(()=>{if(scheduleActorScope(options.boot.me)!==actor.current)session.current?.invalidate();},[options.boot.me]);
  const sameOwner=()=>mounted.current&&scheduleActorScope(live.current.boot.me)===actor.current&&!session.current?.invalid;
  function recover(detail:Detail,directory:Bootstrap){
    if(!session.current?.invalid||!mounted.current||operation.current||reading.current||scheduleActorScope(directory.me)!==actor.current||scheduleActorScope(live.current.boot.me)!==actor.current||detail.task.id!==live.current.id)return false;
    taskWriteBaseline(detail,String(directory.me.id));
    return session.current?.recoverScope()??false;
  }
  async function refreshSaved(){
    const receipt=confirmed.current,start=live.current;
    if(!receipt||reading.current||!sameOwner()||!reads.current)return;
    reading.current=true;setBusy(true);
    try{
      const result=await reads.current.run('saved',async signal=>{
        const directory=await start.refreshIdentity();signal.throwIfAborted();
        if(scheduleActorScope(directory.me)!==actor.current)throw Error('계정 또는 권한이 변경되었습니다.');
        const detail=start.id?await start.readDetail():await scheduleGet(`/api/tasks/${receipt.task.id}`,signal,v=>taskDetailResponse(v,receipt.task.id));
        signal.throwIfAborted();
        if(detail.task.id!==receipt.task.id||detail.task.version<receipt.task.version)throw Error('저장된 버전보다 이전 조회입니다.');
        if(detail.task.version===receipt.task.version&&taskWriteBaseline(detail,receipt.actorId)!==receipt.stateToken)throw Error('저장된 내용과 조회 기준이 다릅니다.');
        await start.changed();signal.throwIfAborted();return detail;
      });
      if(!sameOwner()||confirmed.current!==receipt||live.current.id!==start.id)return;
      if(result.status==='cancelled')throw Error('결과 조회가 중단됐습니다.');
      if(!result.isCurrent())return;
      if(result.status==='error')throw result.error;
      setNeedsRefresh(false);confirmed.current=null;
      setOutcome({kind:'success',title:'업무를 저장했습니다.'});
      live.current.refreshed(receipt,result.value);
    }catch{
      if(sameOwner())setOutcome({kind:'success',title:'저장은 완료했지만 목록 확인에 실패했습니다.',message:'다시 저장하지 마세요. 작성 내용과 저장된 업무를 유지하며 조회만 다시 진행합니다.'});
    }finally{reading.current=false;if(mounted.current)setBusy(false);}
  }
  async function run(status?:Status){
    const start=live.current,forms=session.current;
    if(!forms||!transport.current||!reads.current||operation.current||reading.current||confirmed.current||start.blocked()||!sameOwner())return;
    let write:TaskWrite;
    try{write=captureTaskWrite(status?'status':start.id?'update':'create',status?statusDraft(start.detail!,status):start.draft,start.boot,status?start.detail:start.baseline);}
    catch(error){setOutcome({kind:'error',message:(error as Error).message,actionLabel:start.id?'변경 내용 비교':undefined,onAction:start.id?start.review:undefined});return;}
    const resource=write.id?`task:${write.id}:${write.stateToken}`:`new-task:${write.actorId}:${JSON.stringify(write.body)}`;
    const lease=forms.begin(owner.current,[resource]);
    if(!lease){setOutcome({kind:'error',title:'이전 작성 기준으로 다시 저장할 수 없습니다.',message:'이미 처리했거나 변경된 기준입니다. 최신 내용을 비교하거나 페이지를 다시 열어 주세요.',actionLabel:start.id?'변경 내용 비교':undefined,onAction:start.id?start.review:undefined});return;}
    const signature=JSON.stringify(taskValues(write.draft));
    const current=()=>{
      try{return sameOwner()&&lease.current&&live.current.id===start.id&&!live.current.blocked()&&
        JSON.stringify(taskValues(status?statusDraft(live.current.detail!,status):live.current.draft))===signature;
      }catch{return false;}
    };
    const active:Operation={write,lease,current};operation.current=active;setBusy(true);setOutcome({kind:'loading',title:'저장 대상과 계정을 확인합니다.'});
    let attempted=false,finished=false;
    try{
      const fresh=await reads.current.run('preflight',async signal=>{
        const directory=await start.refreshIdentity();signal.throwIfAborted();
        const detail=write.id?await start.readDetail():undefined;signal.throwIfAborted();return {directory,detail};
      });
      if(fresh.status==='cancelled'||!current())throw Error('확인 중 계정·대상 또는 초안이 변경되었습니다.');
      if(!fresh.isCurrent())throw Error('현재 저장 확인이 아닙니다.');
      if(fresh.status==='error')throw fresh.error;
      if(scheduleActorScope(fresh.value.directory.me)!==write.actorScope)throw Error('로그인 상태가 변경되었습니다.');
      if(write.id&&(!fresh.value.detail?.canEdit||taskWriteBaseline(fresh.value.detail,write.actorId)!==write.stateToken))throw Error('업무 또는 첨부가 변경됐습니다. 최신 내용을 비교해 주세요.');
      const validate=()=>{
        try{
          if(!current())return '대상·계정 또는 작성 내용이 변경되었습니다. 취소 후 다시 확인해 주세요.';
          if(write.id&&taskWriteBaseline(live.current.detail!,write.actorId)!==write.stateToken)return '확인 중 업무가 변경되었습니다. 최신 내용을 비교해 주세요.';
          return null;
        }catch{return '현재 업무 기준을 확인할 수 없습니다.';}
      };
      setOutcome(null);
      const assignee=fresh.value.directory.employees.find(e=>e.id===write.draft.form.assigneeId);
      const needsUnassignedProjectConfirmation=write.kind!=='status'&&write.draft.form.projectId===null&&
        (write.kind==='create'||write.before?.task.projectId!==null);
      if(needsUnassignedProjectConfirmation){
        const unassignedIntent=await confirmWorkspaceAction({title:'프로젝트를 지정하지 않고 저장할까요?',
          message:'프로젝트별 보기와 필터에서 이 업무가 빠질 수 있습니다. 프로젝트 누락이 아니라 의도적인 미지정인지 다시 확인해 주세요.',confirmLabel:'미지정으로 계속',signal:lease.signal,validate,
          details:[{label:'업무',value:write.draft.form.title},{label:'담당자',value:assignee?.name||'직원',entity:{kind:'employee',id:String(write.draft.form.assigneeId),name:assignee?.name||'직원'}},
            {label:'프로젝트',value:'프로젝트 미지정'}]});
        if(!unassignedIntent)return;
        const unassignedInvalid=validate();if(unassignedInvalid)throw Error(unassignedInvalid);
      }
      const intent=await confirmWorkspaceAction({title:status?'업무 상태를 변경할까요?':write.id?'업무 변경을 저장할까요?':'새 업무를 등록할까요?',
        message:'확인한 내용으로 업무를 저장합니다. 저장 결과를 확인하기 전에는 초안을 지우지 않습니다.',confirmLabel:'저장 확인',signal:lease.signal,validate,
        details:[{label:'업무',value:write.draft.form.title},{label:'담당자',value:assignee?.name||'직원',entity:{kind:'employee',id:String(write.draft.form.assigneeId),name:assignee?.name||'직원'}},
          {label:'진행 상태',value:statuses[write.draft.form.status]},{label:'본문 첨부',value:`${write.draft.images.length}개`}]});
      if(!intent)return;
      const invalid=validate();if(invalid)throw Error(invalid);
      attempted=true;
      if(!lease.markSent())throw Error('저장 계정 범위가 변경되었습니다.');
      setTransmitting(true);
      const result=await transport.current.send({url:write.id?`/api/tasks/${write.id}${status?'/status':''}`:'/api/tasks',method:status?'PATCH':write.id?'PUT':'POST',json:write.body,signal:lease.signal,
        headers:{'X-CSRF-TOKEN':fresh.value.directory.csrfToken,'X-Workspace-Actor':write.actorId,...(write.stateToken?{'X-Workspace-State':write.stateToken}:{})}});
      const receipt=active.receipt;
      if(result.saved&&receipt&&current()){
        finished=true;lease.finish('saved');confirmed.current=receipt;setNeedsRefresh(true);
        start.committed(receipt);
      }else{
        finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');
      }
    }catch(error){
      if(sameOwner())setOutcome({kind:'error',title:attempted?'저장 결과를 확인해 주세요.':'저장 요청을 보내지 않았습니다.',message:(error as Error).message+' 작성 내용은 유지됩니다.',actionLabel:!attempted&&write.id?'변경 내용 비교':undefined,onAction:!attempted&&write.id?start.review:undefined});
    }finally{
      if(!finished)lease.finish(attempted?'unknown':'cancelled');
      if(operation.current===active)operation.current=null;
      if(mounted.current){setBusy(false);setTransmitting(false);}
    }
    if(confirmed.current&&sameOwner())await refreshSaved();
  }
  const visibleOutcome=locked&&(!outcome||outcome.kind==='loading'||outcome.kind==='success')?
    {kind:'denied' as const,title:'이 페이지의 저장이 잠겼습니다.',message:'계정 변경 또는 미확정 요청이 있습니다. 초안을 보관하고 다른 탭에서 내역을 확인한 뒤 페이지를 다시 열어 주세요.'}:outcome;
  return {run,busy,transmitting,locked,needsRefresh,recover,refreshSaved,outcome:visibleOutcome};
}
