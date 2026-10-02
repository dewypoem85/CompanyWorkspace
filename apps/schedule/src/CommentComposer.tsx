import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { Editor } from './Editor';
import { WorkspaceState } from './generated/workspace-state';
import { openWorkspaceReview } from './generated/workspace-review';
import { applyCommentReview, commentActorScope, commentReviewItem, commentSnapshot, commentValues, currentComment, type CommentDraft, type CommentSnapshot } from './commentReview';
import { useCommentWrites } from './useCommentWrites';
import type { CommentReceipt } from './commentWrites';
import type { Attachment, Bootstrap, Comment, Detail } from './types';
import { ScheduleToastNotice } from './ScheduleToasts';

type Props = {
  boot: Bootstrap; detail: Detail; initial?: Comment; images?: Attachment[]; parentId?: number|null;
  readBlocked?: boolean;
  readDetail: () => Promise<Detail>;
  refreshIdentity: () => Promise<Bootstrap>;
  saved: (comment: Comment) => Promise<void>; cancel?: () => void; dirtyChanged: (value:boolean) => void;
};
export function CommentComposer({boot,detail,initial,images:initialImages=[],parentId=null,refreshIdentity,saved,cancel,dirtyChanged,readBlocked=false,readDetail}: Props) {
  const [draft,setDraft]=useState<CommentDraft>(()=>({body:initial?.body||'',images:initialImages,version:initial?.version||0}));
  const original=useRef<{comment:Comment;images:Attachment[]}|null>(initial?{comment:{...initial},images:[...initialImages]}:null);
  const baseline=useRef<CommentSnapshot|null>(null),identity=useRef(commentActorScope(boot.me)),mounted=useRef(true),request=useRef<AbortController|null>(null);
  const [uploading,setUploading]=useState(false),[reviewing,setReviewing]=useState(false),[reviewBlocked,setReviewBlocked]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [messageKind,setMessageKind]=useState<'empty'|'success'>('empty');
  const [scopeChanged,setScopeChanged]=useState(false);
  const previousReadBlocked=useRef(readBlocked);
  useEffect(()=>{
    // Parent recovery publishes only a fully validated detail for the original actor.
    if(previousReadBlocked.current&&!readBlocked&&identity.current===commentActorScope(boot.me)){setScopeChanged(false);writes.recover(detail,boot);}
    previousReadBlocked.current=readBlocked;
  },[readBlocked,boot.me]);
  const live=useRef({draft,boot,detail,initial,uploading});live.current={draft,boot,detail,initial,uploading};
  useEffect(()=>{mounted.current=true;const abort=()=>{request.current?.abort();if(mounted.current)setScopeChanged(true);};document.addEventListener('workspace-entity-scope-change',abort);return()=>{mounted.current=false;abort();document.removeEventListener('workspace-entity-scope-change',abort);};},[]);
  useEffect(()=>()=>request.current?.abort(),[boot.me.id,boot.me.role,boot.me.isAdmin,boot.me.active,boot.me.access,boot.me.shared]);
  const baseUnavailable=readBlocked||scopeChanged||reviewBlocked||detail.task.archived||initial?.deleted||!!initial&&initial.authorId!==boot.me.id||identity.current!==commentActorScope(boot.me)||!boot.me.active||!boot.me.access||boot.me.shared;
  function reportDirty(next:CommentDraft,busy=uploading) {
    const before=baseline.current||{body:original.current?.comment.body||'',images:original.current?.images||[],version:original.current?.comment.version||0};
    dirtyChanged(busy||JSON.stringify(commentValues(next))!==JSON.stringify(commentValues(before)));
  }
  function change(patch: Partial<CommentDraft>) {if(writes.busy)return;const next={...live.current.draft,...patch};live.current.draft=next;setDraft(next);reportDirty(next);setMessage('');}
  async function review() {
    if(!original.current||request.current||writes.busy||uploading)return;
    const captured=JSON.stringify(draft),scope=commentActorScope(boot.me),abort=new AbortController();request.current=abort;setReviewing(true);setError('');setMessage('');setMessageKind('empty');
    const unchanged=()=>mounted.current&&!abort.signal.aborted&&!live.current.uploading&&JSON.stringify(live.current.draft)===captured&&commentActorScope(live.current.boot.me)===scope&&identity.current===scope;
    try {
      const before=baseline.current||commentSnapshot(original.current.comment,original.current.images);
      const latest=await readDetail();
      if(!unchanged())throw Error('조회 중 초안 또는 로그인 상태가 바뀌었습니다.');
      const directory=await refreshIdentity();
      if(!unchanged()||commentActorScope(directory.me)!==scope)throw Error('조회 중 초안 또는 로그인 상태가 바뀌었습니다.');
      writes.recover(latest,directory);
      setReviewBlocked(true);
      const current=currentComment(latest,before,directory.me);setReviewBlocked(false);
      const selected=await openWorkspaceReview({title:'댓글 변경 내용 비교',items:[commentReviewItem(before,draft,current)],signal:abort.signal,
        validate:items=>{try{applyCommentReview(items[0],before,draft,current);return null;}catch(e){return (e as Error).message;}}});
      if(!selected){if(mounted.current)setMessage('비교를 취소했습니다. 기존 댓글 초안과 버전은 유지됩니다.');return;}
      if(!unchanged())throw Error('비교 중 초안 또는 로그인 상태가 바뀌었습니다.');
      if(live.current.detail.task.archived||live.current.initial?.deleted||live.current.initial?.authorId!==before.authorId)throw Error('비교 중 업무가 보관되었거나 댓글 상태가 변경되었습니다.');
      const merged=applyCommentReview(selected[0],before,draft,current);
      baseline.current=current;setDraft(merged);setScopeChanged(false);dirtyChanged(JSON.stringify(commentValues(merged))!==JSON.stringify(commentValues(current)));
      setMessage('검토한 값으로 댓글 초안을 갱신했습니다. 아직 저장하지 않았습니다. 댓글 수정을 눌러 저장해 주세요.');
    }catch(e){if(mounted.current){if(e instanceof ApiError&&[401,403,404].includes(e.status))setReviewBlocked(true);setError((e as Error).message+' 기존 초안은 유지됩니다.');}}
    finally{if(request.current===abort)request.current=null;if(mounted.current)setReviewing(false);}
  }
  function committed(receipt:CommentReceipt){
    if(initial){const next=commentSnapshot(receipt.comment,receipt.attachments);baseline.current=next;live.current.draft=next;setDraft(next);}
    else {const next={body:'',images:[],version:0};live.current.draft=next;setDraft(next);}
    dirtyChanged(false);setError('');setMessage('');
  }
  const writes=useCommentWrites({boot,detail,draft,initial,parentId,blocked:()=>!!request.current||uploading||reviewing||baseUnavailable,hasDraft:JSON.stringify(commentValues(draft))!==JSON.stringify(commentValues(baseline.current||{body:initial?.body||'',images:initialImages,version:initial?.version||0})),readDetail,refreshIdentity,review:()=>void review(),committed,refreshed:saved});
  const unavailable=baseUnavailable||writes.locked;
  const noticeKey=initial?`edit-${initial.id}`:parentId?`reply-${parentId}`:`new-${detail.task.id}`;
  return <form className="comment-composer" onSubmit={e=>{e.preventDefault();void writes.run();}}>
    <Editor label={initial?'댓글 수정':'새 댓글'} value={draft.body} onChange={body=>change({body})} images={draft.images} setImages={images=>change({images})} employees={boot.employees} boot={boot} refreshIdentity={refreshIdentity} disabled={writes.busy} uploadDisabled={unavailable} busyChanged={value=>{setUploading(value);reportDirty(live.current.draft,value);}} />
    {baseUnavailable&&<WorkspaceState kind="denied" message="현재 댓글을 저장할 수 없습니다. 삭제·보관 또는 계정 권한을 확인해 주세요. 작성 내용은 남아 있습니다." />}
    {initial&&<WorkspaceState kind={reviewing?'loading':'empty'} title={reviewing?'현재 댓글을 확인합니다.':initial.version>draft.version?'서버의 댓글이 변경되었습니다.':'저장 전 댓글 변경 확인'} message="수정 전·내 초안·현재 서버 값을 비교합니다. 적용 후 저장은 별도로 실행합니다." actionLabel={reviewing?undefined:'댓글 변경 비교'} onAction={reviewing?undefined:()=>void review()} />}
    <ScheduleToastNotice id={`comment-${noticeKey}-write`} state={writes.outcome}/>
    <ScheduleToastNotice id={`comment-${noticeKey}-message`} state={message?{kind:messageKind,message}:null}/>
    <ScheduleToastNotice id={`comment-${noticeKey}-error`} state={error?{kind:'error',message:error}:null}/>
    <div className="form-actions">{cancel&&<button className="cw-button" type="button" disabled={writes.busy} onClick={cancel}>취소</button>}<button className="cw-button" data-variant="primary" disabled={writes.busy||reviewing||uploading||unavailable||(!draft.body.trim()&&!draft.images.length)}>{writes.busy?'저장 중…':initial?'댓글 수정':'댓글 등록'}</button></div>
  </form>;
}
