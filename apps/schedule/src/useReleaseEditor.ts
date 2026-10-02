import {useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {openWorkspaceReview} from './generated/workspace-review';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import {useWorkspaceNavigationRequest} from './generated/workspace-navigation';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {applyReleaseReview,canManageRelease,currentRelease,releaseActorScope,releaseDraftSignature,releaseReviewItem,releaseSnapshot,validateReleaseDraft,type ReleaseDraft} from './releaseReview';
import {captureReleaseDelete,captureReleaseWrite,confirmReleaseReceipt,releaseEditingResponse,type ReleaseReceipt,type ReleaseWrite} from './releaseWrites';
import {scheduleGet} from './scheduleReads';
import {releaseReferenceResponse} from './useReleaseList';
import type {Bootstrap,ReleaseRecord} from './types';

type Operation={write:ReleaseWrite;lease:FormLease;current:()=>boolean;receipt?:ReleaseReceipt};
let releaseOwner=0;
export function useReleaseEditor(record:ReleaseDraft,boot:Bootstrap,refreshIdentity:()=>Promise<Bootstrap>,saved:()=>Promise<void>,removed:()=>void=()=>{}) {
  const [form,setForm]=useState<ReleaseDraft>(()=>({...record})),[busy,setBusy]=useState(false),[blocked,setBlocked]=useState(false);
  const [closing,setClosing]=useState(false),[deleted,setDeleted]=useState(false);
  const [outcome,setOutcome]=useState<WorkspaceStateProps|null>(null),[listFailed,setListFailed]=useState(false);
  const baseline=useRef<ReleaseDraft>({...record}),locked=useRef(false),blockedRef=useRef(false),deletedRef=useRef(false),mounted=useRef(true),epoch=useRef(0),abort=useRef<AbortController|null>(null);
  const owner=useRef(`schedule-release-${++releaseOwner}`),forms=useRef<WorkspaceFormSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),reads=useRef<WorkspaceReadSession|undefined>(undefined),operation=useRef<Operation|null>(null);
  const originalScope=useRef(releaseActorScope(boot)),previousScope=useRef(originalScope.current);
  const live=useRef({form,boot,refreshIdentity,saved,removed});live.current={form,boot,refreshIdentity,saved,removed};
  const dirty=releaseDraftSignature(form)!==releaseDraftSignature(baseline.current),scope=releaseActorScope(boot);
  const unavailable=deleted||blocked||scope!==originalScope.current||!canManageRelease(boot,form.projectId,!!form.id);
  const block=(value:boolean)=>{blockedRef.current=value;setBlocked(value);};
  function invalidate(){epoch.current++;abort.current?.abort();forms.current?.invalidate();block(true);setListFailed(false);setOutcome({kind:'denied',title:'로그인·권한이 변경되었습니다.',message:'이전 요청의 응답은 적용하지 않습니다. 초안을 확인한 뒤 업데이트 버전을 다시 열어 주세요.'});}
  useEffect(()=>{mounted.current=true;let untrack:(()=>void)|undefined,unsubscribe:(()=>void)|undefined;try{
    forms.current=workspaceDocumentFormSession('schedule-release-writes');untrack=forms.current.track(owner.current,()=>releaseDraftSignature(live.current.form)!==releaseDraftSignature(baseline.current));
    const sync=()=>{if(mounted.current&&forms.current?.invalid)block(true);};unsubscribe=forms.current.subscribe(sync);sync();reads.current=createWorkspaceReadSession();
    transport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onSaved:(value,sent,context)=>{const active=operation.current;if(!active?.current()||!context.isCurrent())throw Error('업데이트 버전 저장 중 대상·계정 또는 초안이 변경되었습니다.');active.receipt=confirmReleaseReceipt(value,active.write,sent);}});
  }catch(error){block(true);setOutcome({kind:'error',title:'업데이트 버전 저장 도구를 시작하지 못했습니다.',message:(error as Error).message});}
  document.addEventListener('workspace-entity-scope-change',invalidate);return()=>{mounted.current=false;epoch.current++;abort.current?.abort();operation.current?.lease.finish('unknown');transport.current?.dispose();reads.current?.dispose();untrack?.();unsubscribe?.();document.removeEventListener('workspace-entity-scope-change',invalidate);};},[]);
  useEffect(()=>{if(previousScope.current!==scope){previousScope.current=scope;invalidate();}},[scope]);
  function canLeave(){return !locked.current&&!dirty;}
  const canCloseNow=()=>!locked.current;
  async function requestDiscard({signal}:{signal:AbortSignal}):Promise<(()=>boolean)|null>{
    if(locked.current||signal.aborted||!mounted.current)return null;
    const start=live.current,generation=epoch.current,actor=releaseActorScope(start.boot),captured=JSON.stringify(start.form);
    const before=JSON.stringify(baseline.current),controller=new AbortController();
    const stable=()=>valid(generation,actor,captured)&&JSON.stringify(baseline.current)===before&&!signal.aborted&&!controller.signal.aborted;
    const approve=()=>stable()&&!locked.current;
    if(releaseDraftSignature(start.form)===releaseDraftSignature(baseline.current))return approve;
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});
    locked.current=true;abort.current=controller;setClosing(true);
    try{
      const project=start.boot.projects.find(item=>item.id===start.form.projectId),projectName=project?.name||String(start.form.projectId);
      const intent=await confirmWorkspaceAction({title:'버전 초안 버리기',message:'작성 중인 업데이트 버전을 닫을까요? 저장하지 않은 내용은 사라집니다.',confirmLabel:'버리기',tone:'danger',returnFocus,signal:controller.signal,
        details:[{label:'프로젝트',value:projectName,entity:{kind:'project',id:project?String(project.id):null,name:projectName}},
          {label:'버전',value:`${start.form.baseVersion}.${start.form.minor}`},{label:'기록',value:start.form.id?String(start.form.id):'신규 등록'}],
        validate:()=>stable()?null:'계정 또는 초안이 변경되었습니다. 취소 후 다시 확인해 주세요.'});
      return intent&&stable()?approve:null;
    }catch{if(stable())setOutcome({kind:'error',title:'초안 확인창을 열지 못했습니다.',message:'작성 중인 내용은 유지했습니다.'});return null;}
    finally{signal.removeEventListener('abort',cancel);if(abort.current===controller){abort.current=null;locked.current=false;if(mounted.current)setClosing(false);}}
  }
  useWorkspaceNavigationRequest(requestDiscard);
  useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(dirty||locked.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[dirty]);
  function change(patch:Partial<ReleaseDraft>){if(locked.current)return;const next={...live.current.form,...patch};live.current.form=next;setForm(next);}
  const valid=(generation:number,actor:string,captured?:string)=>mounted.current&&epoch.current===generation&&releaseActorScope(live.current.boot)===actor&&actor===originalScope.current&&(captured===undefined||JSON.stringify(live.current.form)===captured);
  async function review(){
    const start=live.current,reader=reads.current;if(locked.current||!start.form.id||!reader)return;
    const generation=epoch.current,actor=releaseActorScope(start.boot),captured=JSON.stringify(start.form),controller=new AbortController();
    const returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    locked.current=true;abort.current=controller;setBusy(true);setOutcome({kind:'loading',title:'현재 업데이트 버전을 확인합니다.'});
    try{
      const before=releaseSnapshot(baseline.current),draft={...start.form};
      const cancel=()=>reader.cancel('release-review');controller.signal.addEventListener('abort',cancel,{once:true});
      const checked=await reader.run('release-review',async signal=>{const [value,directory]=await Promise.all([scheduleGet(`/api/releases/${before.id}`,signal,value=>currentRelease(value,before)),start.refreshIdentity()]);signal.throwIfAborted();if(releaseActorScope(directory)!==actor||!canManageRelease(directory,draft.projectId,true))throw Error('현재 계정에서 이 업데이트 버전을 편집할 수 없습니다.');
        const ids=[...new Set([before,draft,value].flatMap(item=>[item.rollbackTargetId,item.resolvedInId]).filter((id):id is number=>id!==null))];
        const targets=new Map<number,ReleaseRecord>();await Promise.all(ids.map(async id=>{try{targets.set(id,await scheduleGet(`/api/releases/${id}`,signal,value=>releaseReferenceResponse(value,id,before.projectId)));}catch(error){if(!(error instanceof ApiError&&error.status===404))throw error;}}));signal.throwIfAborted();return{current:value,targets};});
      controller.signal.removeEventListener('abort',cancel);if(checked.status==='cancelled'||!checked.isCurrent()||!valid(generation,actor,captured)||controller.signal.aborted)return;if(checked.status==='error')throw checked.error;
      const {current,targets}=checked.value;
      if(!valid(generation,actor,captured)||controller.signal.aborted)return;
      const selected=await openWorkspaceReview({title:'업데이트 버전 변경 비교',items:[releaseReviewItem(before,draft,current,targets)],returnFocus,signal:controller.signal,
        validate:items=>{try{if(!valid(generation,actor,captured))throw Error('검토 중 계정 또는 초안이 변경되었습니다.');applyReleaseReview(items[0],before,draft,current,targets);return null;}catch(error){return (error as Error).message;}}});
      if(!valid(generation,actor,captured)||controller.signal.aborted)return;
      if(!selected){setOutcome({kind:'empty',title:'비교를 취소했습니다.',message:'기존 초안과 편집 기준 버전을 유지했습니다.'});return;}
      const merged=applyReleaseReview(selected[0],before,draft,current,targets);
      baseline.current=current;live.current.form=merged;setForm(merged);block(false);setListFailed(false);
      setOutcome({kind:'empty',title:'검토한 값을 초안에 적용했습니다.',message:'아직 저장하지 않았습니다. 내용을 확인한 뒤 업데이트 버전 저장을 눌러 주세요.'});
    }catch(error){if(valid(generation,actor)){block(true);setOutcome({kind:error instanceof ApiError&&[401,403,404].includes(error.status)?'denied':'error',title:'업데이트 버전을 비교하지 못했습니다.',message:(error as Error).message+' 기존 초안과 버전은 유지됩니다.'});}}
    finally{if(abort.current===controller)abort.current=null;locked.current=false;if(mounted.current)setBusy(false);}
  }
  async function refreshList(){
    if(locked.current)return;locked.current=true;setBusy(true);const generation=epoch.current,actor=releaseActorScope(live.current.boot);
    try{await live.current.saved();if(valid(generation,actor)){setListFailed(false);if(deletedRef.current)live.current.removed();else setOutcome({kind:'success',title:'저장된 버전 목록을 확인했습니다.',message:'저장 요청은 반복하지 않았습니다.'});}}
    catch(error){if(valid(generation,actor))setOutcome({kind:'success',title:deletedRef.current?'업데이트 버전은 삭제되었습니다.':'업데이트 버전은 저장되었습니다.',message:'목록 갱신에 실패했습니다. '+(error as Error).message});}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  async function run(deleting=false){
    const start=live.current,session=forms.current,writer=transport.current,reader=reads.current,dirtyNow=releaseDraftSignature(start.form)!==releaseDraftSignature(baseline.current);
    if(locked.current||blockedRef.current||deletedRef.current||operation.current||!session||!writer||!reader||session.invalid||!canManageRelease(start.boot,start.form.projectId,!!start.form.id)||(deleting?(!start.form.id||dirtyNow):!dirtyNow))return;
    const submitted={...start.form},beforeDraft={...baseline.current};let before:ReleaseRecord|undefined;
    try{before=submitted.id?releaseSnapshot(beforeDraft):undefined;if(!deleting)validateReleaseDraft(submitted,before);}catch(error){setOutcome({kind:'error',title:`업데이트 버전 ${deleting?'삭제':'저장'} 요청을 보내지 않았습니다.`,message:(error as Error).message+' 작성 내용은 유지됩니다.'});return;}
    const lease=session.begin(owner.current,[`release:${deleting?'delete':'save'}:${submitted.id??'new'}:${releaseDraftSignature(beforeDraft)}`]);if(!lease){block(true);setOutcome({kind:'error',title:`이전 버전 기준으로 다시 ${deleting?'삭제':'저장'}할 수 없습니다.`,message:'이미 처리했거나 변경된 기준입니다. 업데이트 버전을 다시 열어 주세요.'});return;}
    locked.current=true;setBusy(true);setListFailed(false);setOutcome({kind:'loading',title:'업데이트 버전 저장을 준비합니다.'});
    const generation=epoch.current,actor=releaseActorScope(start.boot),captured=JSON.stringify(submitted),draftSignature=releaseDraftSignature(submitted),baselineSignature=releaseDraftSignature(beforeDraft),returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    let attempted=false,finished=false,active:Operation|undefined;
    const current=()=>mounted.current&&epoch.current===generation&&releaseActorScope(live.current.boot)===actor&&actor===originalScope.current&&releaseDraftSignature(live.current.form)===draftSignature&&releaseDraftSignature(baseline.current)===baselineSignature&&lease.current;
    try{
      const checked=await reader.run('preflight',async signal=>{const query=new URLSearchParams({projectId:String(submitted.projectId)});if(submitted.id)query.set('id',String(submitted.id));const[directory,editing]=await Promise.all([start.refreshIdentity(),scheduleGet(`/api/releases/editing?${query}`,signal,value=>releaseEditingResponse(value,submitted.projectId,submitted.id))]);signal.throwIfAborted();return{directory,editing};});
      if(checked.status==='cancelled'||!current())throw Error('확인 중 계정·대상 또는 초안이 변경되었습니다.');if(!checked.isCurrent())throw Error('현재 업데이트 버전 저장 확인이 아닙니다.');if(checked.status==='error')throw checked.error;
      let write:ReleaseWrite;try{write=deleting?captureReleaseDelete(beforeDraft,checked.value.directory,checked.value.editing):captureReleaseWrite(submitted,beforeDraft,checked.value.directory,checked.value.editing);}catch(error){block(true);throw error;}if(write.actorScope!==actor)throw Error('현재 계정에서 이 업데이트 버전을 편집할 수 없습니다.');
      active={write,lease,current};operation.current=active;
      const validate=()=>current()?null:'대상·계정 또는 초안이 변경되었습니다. 취소 후 다시 확인해 주세요.';const project=checked.value.directory.projects.find(item=>item.id===submitted.projectId);setOutcome(null);
      const intent=await confirmWorkspaceAction({title:deleting?`버전 ${submitted.baseVersion}.${submitted.minor} 기록을 삭제할까요?`:submitted.id?'업데이트 버전 변경을 저장할까요?':'새 업데이트 버전을 등록할까요?',message:deleting?'삭제한 기록과 변경 이력은 복구할 수 없습니다. 연결된 마이너나 복귀·해결 대상이 있으면 삭제되지 않습니다.':'확인한 내용으로 업데이트 버전을 저장합니다. 결과 확인 전에는 초안을 지우지 않습니다.',confirmLabel:deleting?'삭제':'저장',tone:deleting?'danger':undefined,returnFocus,signal:lease.signal,validate,details:[{label:'프로젝트',value:project?.name||String(submitted.projectId),entity:{kind:'project',id:String(submitted.projectId),name:project?.name||String(submitted.projectId)}},{label:'버전',value:`${submitted.baseVersion}.${submitted.minor}`},{label:'기록',value:submitted.id?String(submitted.id):'신규 등록'}]});
      if(!intent)return;const invalid=validate();if(invalid)throw Error(invalid);attempted=true;if(!lease.markSent())throw Error(`${deleting?'삭제':'저장'} 계정 범위가 변경되었습니다.`);block(true);setOutcome({kind:'loading',title:`업데이트 버전을 ${deleting?'삭제':'저장'}합니다.`,message:'중복 요청을 보내지 않습니다.'});
      const resultState=await writer.send({url:submitted.id?`/api/releases/${submitted.id}`:'/api/releases',method:deleting?'DELETE':submitted.id?'PUT':'POST',json:write.body,signal:lease.signal,headers:{'X-CSRF-TOKEN':checked.value.directory.csrfToken,'X-Workspace-Actor':write.actorId,'X-Workspace-Release-State':write.stateToken}});const receipt=active.receipt;
      if(!resultState.saved||!receipt||!current()){finished=true;lease.finish(resultState.outcome==='invalid'?'invalid':resultState.outcome==='conflict'?'conflict':resultState.outcome==='not-sent'?'cancelled':'unknown');block(resultState.outcome!=='invalid'&&resultState.outcome!=='not-sent');return;}
      finished=true;lease.finish('saved');const result=receipt.release;
      if(deleting){deletedRef.current=true;setDeleted(true);setOutcome({kind:'success',title:'업데이트 버전을 삭제했습니다.'});try{await live.current.saved();if(valid(generation,actor))live.current.removed();}catch(error){if(valid(generation,actor)){setListFailed(true);setOutcome({kind:'success',title:'업데이트 버전은 삭제되었습니다.',message:'목록 갱신에 실패했습니다. 삭제 요청을 반복하지 않고 목록만 다시 확인할 수 있습니다. '+(error as Error).message});}}return;}
      baseline.current=result;live.current.form=result;setForm(result);block(false);setOutcome({kind:'success',title:'업데이트 버전을 저장했습니다.'});
      try{await live.current.saved();}catch(error){if(valid(generation,actor)){setListFailed(true);setOutcome({kind:'success',title:'업데이트 버전은 저장되었습니다.',message:'목록 갱신에 실패했습니다. 다시 저장하지 않고 목록만 확인할 수 있습니다. '+(error as Error).message});}}
    }catch(error){if(valid(generation,actor)){
      const rejected=error instanceof ApiError&&error.status>0&&error.status<500;if(attempted||error instanceof ApiError&&[401,403,404,409].includes(error.status))block(true);
      setOutcome({kind:error instanceof ApiError&&[401,403,404].includes(error.status)?'denied':'error',title:attempted&&!rejected?`${deleting?'삭제':'저장'} 반영 여부를 확인해야 합니다.`:`업데이트 버전을 ${deleting?'삭제':'저장'}하지 못했습니다.`,message:(error as Error).message+(attempted&&!rejected?` 서버에 반영되었을 수 있습니다. ${deleting?'목록에서 기록 존재 여부를 확인한 뒤 다시 여세요.':'기존 기록은 변경 비교로 확인하고, 신규 등록은 목록에서 확인한 뒤 다시 여세요.'} 자동 재전송하지 않습니다.`:' 기존 초안과 편집 기준은 유지됩니다.')});
    }}finally{if(!finished)lease.finish(attempted?'unknown':'cancelled');if(active&&operation.current===active)operation.current=null;locked.current=false;if(mounted.current){setBusy(false);if(returnFocus)requestAnimationFrame(()=>{if(returnFocus.isConnected&&!returnFocus.matches(':disabled'))returnFocus.focus();});}}
  }
  return {form,change,save:()=>run(false),remove:()=>run(true),review,refreshList,busy:busy||closing,closing,dirty,deleted,unavailable,outcome,listFailed,canLeave,canCloseNow,requestDiscard};
}
