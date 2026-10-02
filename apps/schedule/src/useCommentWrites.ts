import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {commentActorScope,commentValues,type CommentDraft} from './commentReview';
import {captureCommentWrite,commentWriteBaseline,confirmCommentReceipt,type CommentReceipt,type CommentWrite} from './commentWrites';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {workspaceDocumentFormSession,createWorkspaceWriteTransport,type FormLease,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import type {Bootstrap,Comment,Detail} from './types';

type Options={boot:Bootstrap;detail:Detail;draft:CommentDraft;initial?:Comment;parentId:number|null;blocked:()=>boolean;hasDraft:boolean;
  readDetail:()=>Promise<Detail>;refreshIdentity:()=>Promise<Bootstrap>;review:()=>void;
  committed:(receipt:CommentReceipt)=>void;refreshed:(comment:Comment)=>Promise<void>};
type Operation={write:CommentWrite;lease:FormLease;current:()=>boolean;receipt?:CommentReceipt};
let ownerSequence=0;

export function useCommentWrites(options:Options){
  const live=useRef(options);live.current=options;
  const owner=useRef(`schedule-comment-${++ownerSequence}`),actor=useRef(commentActorScope(options.boot.me));
  const mounted=useRef(false),session=useRef<WorkspaceFormSession|undefined>(undefined),transport=useRef<WorkspaceWriteTransport|undefined>(undefined),reads=useRef<WorkspaceReadSession|undefined>(undefined),operation=useRef<Operation|null>(null);
  const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  const sameOwner=useCallback(()=>mounted.current&&commentActorScope(live.current.boot.me)===actor.current&&!session.current?.invalid,[]);
  useEffect(()=>{
    mounted.current=true;let untrack:(()=>void)|undefined,unsubscribe:(()=>void)|undefined;
    try{
      const forms=workspaceDocumentFormSession('schedule-comment-writes');session.current=forms;untrack=forms.track(owner.current,()=>live.current.hasDraft);
      const sync=()=>{if(mounted.current)setLocked(forms.invalid);};unsubscribe=forms.subscribe(sync);sync();reads.current=createWorkspaceReadSession();
      transport.current=createWorkspaceWriteTransport({isConnected:()=>mounted.current,onState:setOutcome,onConflict:()=>live.current.review(),
        onSaved:(value,sent,context)=>{const active=operation.current;if(!active?.current()||!context.isCurrent())throw Error('댓글 저장 중 대상·계정 또는 초안이 변경되었습니다.');active.receipt=confirmCommentReceipt(value,active.write,sent);}});
    }catch(error){setLocked(true);setOutcome({kind:'error',title:'댓글 저장 도구를 준비하지 못했습니다.',message:(error as Error).message});}
    return()=>{mounted.current=false;operation.current?.lease.finish('unknown');operation.current=null;transport.current?.dispose();reads.current?.dispose();untrack?.();unsubscribe?.();};
  },[]);
  useEffect(()=>{if(commentActorScope(options.boot.me)!==actor.current)session.current?.invalidate();},[options.boot.me]);
  function recover(detail:Detail,directory:Bootstrap){
    if(!session.current?.invalid||operation.current||commentActorScope(directory.me)!==actor.current||commentActorScope(live.current.boot.me)!==actor.current)return false;
    try{commentWriteBaseline(detail,String(directory.me.id),live.current.initial?.id??live.current.parentId??undefined);}catch{return false;}
    return session.current.recoverScope();
  }

  async function run(){
    const start=live.current,forms=session.current,writer=transport.current,reader=reads.current;
    if(!forms||!writer||!reader||operation.current||start.blocked()||!sameOwner())return;
    let write:CommentWrite;
    try{write=captureCommentWrite(start.draft,start.detail,start.boot,start.initial,start.parentId);}
    catch(error){setOutcome({kind:'error',title:'댓글 저장 요청을 보내지 않았습니다.',message:(error as Error).message,actionLabel:start.initial?'댓글 변경 비교':undefined,onAction:start.initial?start.review:undefined});return;}
    const resource=`comment:${write.taskId}:${write.targetId??'new'}:${write.stateToken}`,lease=forms.begin(owner.current,[resource]);
    if(!lease){setOutcome({kind:'error',title:'이전 댓글 기준으로 다시 저장할 수 없습니다.',message:'이미 처리했거나 변경된 기준입니다. 현재 댓글을 비교하거나 업무를 다시 조회해 주세요.',actionLabel:start.initial?'댓글 변경 비교':undefined,onAction:start.initial?start.review:undefined});return;}
    const signature=JSON.stringify(commentValues(write.draft));
    const current=()=>sameOwner()&&lease.current&&!live.current.blocked()&&live.current.detail.task.id===write.taskId&&JSON.stringify(commentValues(live.current.draft))===signature;
    const active:Operation={write,lease,current};operation.current=active;setBusy(true);setOutcome({kind:'loading',title:'댓글 대상과 계정을 확인합니다.'});let attempted=false,finished=false;
    try{
      const fresh=await reader.run('preflight',async signal=>{const directory=await start.refreshIdentity();signal.throwIfAborted();const detail=await start.readDetail();signal.throwIfAborted();return {directory,detail};});
      if(fresh.status==='cancelled'||!current())throw Error('확인 중 계정·대상 또는 댓글 초안이 변경되었습니다.');
      if(!fresh.isCurrent())throw Error('현재 댓글 저장 확인이 아닙니다.');if(fresh.status==='error')throw fresh.error;
      if(commentActorScope(fresh.value.directory.me)!==write.actorScope)throw Error('로그인 상태가 변경되었습니다.');
      if(commentWriteBaseline(fresh.value.detail,write.actorId,write.targetId)!==write.stateToken)throw Error('업무·댓글 또는 첨부가 변경됐습니다. 최신 내용을 비교해 주세요.');
      const validate=()=>{try{return current()&&commentWriteBaseline(live.current.detail,write.actorId,write.targetId)===write.stateToken?null:'대상·계정 또는 댓글 초안이 변경되었습니다. 취소 후 다시 확인해 주세요.';}catch{return '현재 댓글 저장 기준을 확인할 수 없습니다.';}};
      setOutcome(null);const intent=await confirmWorkspaceAction({title:write.kind==='update'?'댓글 변경을 저장할까요?':write.kind==='reply'?'답글을 등록할까요?':'댓글을 등록할까요?',
        message:'확인한 댓글과 첨부만 저장합니다. 저장 결과를 확인하기 전에는 초안을 지우지 않습니다.',confirmLabel:write.kind==='update'?'댓글 수정':'댓글 등록',signal:lease.signal,validate,
        details:[{label:'업무',value:fresh.value.detail.task.title},{label:write.kind==='reply'?'답글':'본문',value:write.body.body.trim()||'(이미지만 첨부)'},{label:'첨부 이미지',value:`${write.draft.images.length}개`} ]});
      if(!intent)return;const invalid=validate();if(invalid)throw Error(invalid);attempted=true;if(!lease.markSent())throw Error('댓글 저장 계정 범위가 변경되었습니다.');
      const result=await writer.send({url:write.kind==='update'?`/api/comments/${write.targetId}`:`/api/tasks/${write.taskId}/comments`,method:write.kind==='update'?'PUT':'POST',json:write.body,signal:lease.signal,
        headers:{'X-CSRF-TOKEN':fresh.value.directory.csrfToken,'X-Workspace-Actor':write.actorId,'X-Workspace-Target-State':write.stateToken}});
      const receipt=active.receipt;
      if(result.saved&&receipt&&current()){
        finished=true;lease.finish('saved');live.current.committed(receipt);setOutcome({kind:'success',title:'댓글을 저장했습니다.'});
        try{await live.current.refreshed(receipt.comment);}catch{if(mounted.current)setOutcome({kind:'success',title:'댓글은 저장했지만 목록 확인에 실패했습니다.',message:'다시 저장하지 말고 업무를 다시 조회해 주세요. 작성 내용과 저장 확인 결과는 유지합니다.'});}
      }else{finished=true;lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');}
    }catch(error){
      if(error instanceof ApiError&&[401,403].includes(error.status))document.dispatchEvent(new Event('workspace-entity-scope-change'));
      if(sameOwner())setOutcome({kind:'error',title:attempted?'댓글 저장 결과를 확인해 주세요.':'댓글 저장 요청을 보내지 않았습니다.',message:(error as Error).message+' 댓글 초안은 유지됩니다.',actionLabel:!attempted&&write.kind==='update'?'댓글 변경 비교':undefined,onAction:!attempted&&write.kind==='update'?start.review:undefined});
    }finally{if(!finished)lease.finish(attempted?'unknown':'cancelled');if(operation.current===active)operation.current=null;if(mounted.current)setBusy(false);}
  }
  const visibleOutcome=locked&&(!outcome||outcome.kind==='loading'||outcome.kind==='success')?{kind:'denied' as const,title:'이 페이지의 댓글 저장이 잠겼습니다.',message:'계정 변경 또는 미확정 요청이 있습니다. 초안을 보관하고 다른 탭에서 댓글 내역을 확인한 뒤 페이지를 다시 열어 주세요.'}:outcome;
  return {run,busy,locked,recover,outcome:visibleOutcome};
}
