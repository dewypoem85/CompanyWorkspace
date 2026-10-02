import { useTaskActions } from './useTaskActions';
import { useTaskDetail } from './useTaskDetail';
import { useTaskWrites } from './useTaskWrites';
import { CommentComposer } from './CommentComposer';
import { DatePicker } from './DatePicker';
import { useWorkspaceNavigationRequest } from './generated/workspace-navigation';
import { openWorkspaceReview } from './generated/workspace-review';
import { confirmWorkspaceAction } from './generated/workspace-confirm';
import { WorkspaceState } from './generated/workspace-state';
import { ScheduleToastNotice } from './ScheduleToasts';
import { useWorkspaceModal } from './generated/workspace-modal';
import { commentActorScope } from './commentReview';
import { applyTaskReview, taskReviewItem, taskSnapshot, taskValues, type TaskDraft, type TaskSnapshot } from './taskReview';
import { TaskLinkProvider } from './TaskLinks';
import { ProjectIcon } from './ProjectIcon';
import { Avatar } from './Avatar';
import { defaultProjectId, recommendedProjects } from './organization';
import { useEffect, useRef, useState } from 'react';
import { stamp } from './api';
import { Body, Editor, ImageList } from './Editor';
import { TaskPlanning } from './TaskPlanning';
import type { Attachment, Bootstrap, Comment, Detail, Status } from './types';
import { statuses } from './types';

export type NewTask = { assigneeId: number; date: string | null };
type Props = { id?: number; initial?: NewTask; boot: Bootstrap; close: () => Promise<boolean>; changed: (requireSuccess?: boolean) => Promise<void>; opened: (id: number, commentId?: number) => Promise<boolean>; refreshIdentity: () => Promise<Bootstrap> };
export function TaskPanel({ id, initial, boot, close, changed, opened, refreshIdentity }: Props) {
  const dialog = useRef<HTMLDialogElement>(null); const [error, setError] = useState(''); const [editing, setEditing] = useState(!id); const [dirty, setDirty] = useState(false); const [historyOpen, setHistoryOpen] = useState(false);
  const [form, setForm] = useState<TaskDraft>(() => {
    const assigneeId = initial?.assigneeId || (boot.me.role !== 'master' && !boot.me.isPrivate ? boot.me.id : boot.employees.find(p => p.active && !p.shared)?.id || 0);
    return { title: '', body: '', assigneeId, projectId: defaultProjectId(boot.projects, boot.employees.find(p => p.id === assigneeId)), goalId:null, startDate: initial?.date || null, endDate: initial?.date || null, status: 'planned', version: 0 };
  });
  const [images, setImages] = useState<Attachment[]>([]); const [uploading, setUploading] = useState(false); const [commentDirty, setCommentDirty] = useState(false); const [replyDirty, setReplyDirty] = useState(false);
  const [replyEditorOpen,setReplyEditorOpen] = useState(false);
  const actionBusy=useRef(false),writeBusy=useRef(false),writeBaseline=useRef<Detail|undefined>(undefined);
  const baseline = useRef<TaskSnapshot | null>(null), reviewRequest = useRef<AbortController | null>(null), taskDiscardRequest=useRef<AbortController|null>(null),commentTransitionRequest=useRef<AbortController|null>(null),navigationDiscardRequest=useRef<AbortController|null>(null),taskJumpRequest=useRef<AbortController|null>(null),taskCloseRequest=useRef<AbortController|null>(null),taskDiscardPermit=useRef(false),mounted = useRef(true);
  const newCommentRevision=useRef(0),nestedCommentRevision=useRef(0);
  const [reviewing,setReviewing] = useState(false),[taskDiscarding,setTaskDiscarding]=useState(false),[commentTransitioning,setCommentTransitioning]=useState(false),[navigationDiscarding,setNavigationDiscarding]=useState(false),[taskJumping,setTaskJumping]=useState(false),[taskClosing,setTaskClosing]=useState(false), [reviewMessage,setReviewMessage] = useState('');
  const reads=useTaskDetail({id,boot,refreshIdentity,pollPaused:()=>writeBusy.current||uploading||actionBusy.current});
  const {detail,applyDetail,refresh:fetchDetail}=reads;
  async function readDetail(){const value=await fetchDetail();if(!value)throw Error('업무 상세를 확인하지 못했습니다.');return value;}
  const currentDraft = useRef({id,form,images,boot,editing,detail});currentDraft.current={id,form,images,boot,editing,detail};
  useEffect(()=>{ mounted.current=true; const cancel=()=>{reviewRequest.current?.abort();taskDiscardRequest.current?.abort();commentTransitionRequest.current?.abort();navigationDiscardRequest.current?.abort();taskJumpRequest.current?.abort();taskCloseRequest.current?.abort();};document.addEventListener('workspace-entity-scope-change',cancel);return()=>{mounted.current=false;cancel();document.removeEventListener('workspace-entity-scope-change',cancel);}; },[]);
  useEffect(()=>()=>{reviewRequest.current?.abort();taskDiscardRequest.current?.abort();commentTransitionRequest.current?.abort();navigationDiscardRequest.current?.abort();taskJumpRequest.current?.abort();taskCloseRequest.current?.abort();},[boot.me.id,boot.me.role,boot.me.isAdmin,boot.me.active,boot.me.access,boot.me.shared]);
  const writes=useTaskWrites({id,boot,detail,baseline:writeBaseline.current,draft:{form,images},hasDraft:dirty,
    blocked:()=>reads.invalid||actions.busy||uploading||reviewRequest.current!==null,
    readDetail,refreshIdentity,changed:()=>changed(true),review:()=>void reviewChanges(),
    committed:receipt=>{
      if(receipt.operation!=='status'){const stored=taskSnapshot({task:receipt.task,attachments:receipt.attachments,comments:[],history:[],canEdit:false});setForm(stored.form);setImages(stored.images);setDirty(false);}
      if(detail){const stored={...detail,task:receipt.task,attachments:[...detail.attachments.filter(a=>a.commentId!==null),...receipt.attachments],canEdit:false,editing:{actorId:receipt.actorId,stateToken:receipt.stateToken}};writeBaseline.current=stored;applyDetail(stored);}
    },
    refreshed:(receipt,fresh)=>{writeBaseline.current=fresh;if(receipt.operation!=='status'){setEditing(false);setDirty(false);}if(!id)opened(receipt.task.id);}
  });
  const saving=writes.busy;writeBusy.current=writes.transmitting||writes.needsRefresh;
  const blockedReason=reads.invalid||writes.locked?'로그인·권한과 저장 상태를 다시 확인해 주세요.':editing||dirty||commentDirty||replyDirty||replyEditorOpen||saving||writes.needsRefresh||uploading||reviewing?'작성 중인 업무·댓글을 먼저 저장하거나 취소해 주세요.':'';
  const actions=useTaskActions({id,detail,boot,blockedReason,refreshIdentity,readDetail,applyDetail,changed:()=>changed(true),revalidated:(fresh,directory)=>{writes.recover(fresh,directory);}});
  // Confirmation remains live to server changes; only the preflight/write/read phase pauses polls.
  actionBusy.current=actions.busy&&actions.outcome?.kind==='loading';
  const actionUnavailable=actions.busy||actions.needsRefresh||Boolean(blockedReason);
  const modal = useWorkspaceModal(dialog, {scope:'retain', canClose:()=>!actions.busy&&!saving&&!uploading&&!reviewing&&!taskDiscarding&&!commentTransitioning&&!navigationDiscarding&&!taskJumping, beforeCloseRequest:requestPanelCloseDiscard, onClose:()=>void close()});
  useEffect(() => { if (!detail || !location.hash.startsWith('#comment-')) return; document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [detail]);
  useEffect(() => { const unload = (e: BeforeUnloadEvent) => { if (dirty || commentDirty || replyDirty || uploading || actions.busy || saving) { e.preventDefault(); } }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload); }, [dirty, commentDirty, replyDirty, uploading, actions.busy, saving]);
  useWorkspaceNavigationRequest(requestPanelNavigationDiscard);
  function requestClose() { modal.close(); }
  async function jumpToTask(nextId: number, commentId?: number) {
    if(actions.busy||saving||taskJumpRequest.current)return;
    if(nextId!==id){await requestTaskJump(nextId,commentId);return;}
    await opened(nextId, commentId);
    if (nextId === id) requestAnimationFrame(() => { if (commentId) document.getElementById('comment-' + commentId)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); else dialog.current?.querySelector('.detail-panel')?.scrollTo({ top: 0, behavior: 'smooth' }); });
  }
  function beginTaskEdit() { if(actions.busy||reads.invalid||!detail)return; try { const initial=taskSnapshot(detail); baseline.current=initial;writeBaseline.current=detail;setCommentDirty(false);setReplyDirty(false);setForm(initial.form);setImages(initial.images);setEditing(true);setDirty(false);setError('');setReviewMessage(''); } catch(e) {setError((e as Error).message);} }
  async function reviewChanges() {
    if (!id || !baseline.current || reviewRequest.current || saving || uploading) return;
    const before=baseline.current, draft={form,images}, captured=JSON.stringify(draft), actorId=boot.me.id;
    const actorScope=(directory:Bootstrap)=>JSON.stringify([directory.me.id,directory.me.role,directory.me.isAdmin,directory.me.active,directory.me.access,directory.me.shared]);
    const originalScope=actorScope(boot);
    const abort=new AbortController();reviewRequest.current=abort;setReviewing(true);setReviewMessage('');setError('');
    const unchanged=()=>mounted.current&&!abort.signal.aborted&&currentDraft.current.editing&&JSON.stringify({form:currentDraft.current.form,images:currentDraft.current.images})===captured&&actorScope(currentDraft.current.boot)===originalScope;
    try {
      const latest=await fetchDetail();if(!latest||!unchanged())throw Error('초안 또는 로그인 상태가 바뀌었습니다.');
      const directory=await refreshIdentity();
      if (!unchanged()) throw Error('조회 중 초안 또는 로그인 상태가 바뀌었습니다. 다시 비교해 주세요.');
      if (latest.task.id!==id || !latest.canEdit || latest.task.archived || directory.me.id!==actorId || actorScope(directory)!==originalScope) throw Error('현재 이 업무를 수정할 권한 또는 로그인 상태가 변경되었습니다.');
      writes.recover(latest,directory);
      const current=taskSnapshot(latest);if(current.form.version<before.form.version)throw Error('서버 버전이 이전 값입니다. 다시 확인해 주세요.');
      const selected=await openWorkspaceReview({title:'업무 변경 내용 비교',items:[taskReviewItem(id,before,draft,current,directory)],signal:abort.signal,
        validate:items=>{try {applyTaskReview(items[0],id,before,draft,current,directory);return null;}catch(e){return (e as Error).message;}}});
      if (!selected) {if(mounted.current)setReviewMessage('비교를 취소했습니다. 기존 초안과 버전은 유지됩니다.');return;}
      if (!unchanged()) throw Error('비교 중 초안 또는 로그인 상태가 바뀌었습니다. 다시 비교해 주세요.');
      if (currentDraft.current.detail?.canEdit===false || currentDraft.current.detail?.task.archived) throw Error('비교 중 업무가 보관되었거나 편집 권한이 변경되었습니다.');
      // A poll may have received an even newer version while the review was open; keep that knowledge.
      const merged=applyTaskReview(selected[0],id,before,draft,current,currentDraft.current.boot);
      baseline.current=current;writeBaseline.current=latest;setForm(merged.form);setImages(merged.images);
      setDirty(JSON.stringify(taskValues(merged))!==JSON.stringify(taskValues(current)));
      setReviewMessage('검토한 값으로 초안을 갱신했습니다. 아직 저장하지 않았습니다. 확인 후 업무 저장을 눌러 주세요.');
    } catch(e) {if(mounted.current)setError((e as Error).message+' 기존 초안은 유지됩니다.');}
    finally {if(reviewRequest.current===abort)reviewRequest.current=null;if(mounted.current)setReviewing(false);}
  }
  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) { setForm(f => ({ ...f, [key]: value })); setDirty(true); }
  const taskDiscardLive=useRef({id,form,images,boot,editing,dirty,uploading,saving,actionsBusy:actions.busy,reviewing});taskDiscardLive.current={id,form,images,boot,editing,dirty,uploading,saving,actionsBusy:actions.busy,reviewing};
  async function requestTaskEditCancel() {
    if(taskDiscardRequest.current||actions.busy||saving||uploading||reviewing)return;
    if(!dirty){if(id){setEditing(false);setDirty(false);}else await close();return;}
    const start=taskDiscardLive.current,captured=JSON.stringify({form:start.form,images:start.images}),scope=commentActorScope(start.boot.me),abort=new AbortController();taskDiscardRequest.current=abort;setTaskDiscarding(true);setError('');
    const stable=()=>{const value=taskDiscardLive.current;return mounted.current&&!abort.signal.aborted&&value.id===start.id&&value.editing&&value.dirty&&!value.uploading&&!value.saving&&!value.actionsBusy&&!value.reviewing&&commentActorScope(value.boot.me)===scope&&JSON.stringify({form:value.form,images:value.images})===captured;};
    try {
      const assignee=start.boot.employees.find(value=>value.id===start.form.assigneeId),project=start.boot.projects.find(value=>value.id===start.form.projectId);
      const intent=await confirmWorkspaceAction({title:'업무 편집 초안을 버릴까요?',message:'저장하지 않은 업무 내용과 첨부 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'업무',value:start.form.title||'새 업무'},{label:'담당자',value:assignee?.name||'이전 직원',entity:{kind:'employee',id:assignee?String(assignee.id):null,name:assignee?.name||'이전 직원'}},{label:'프로젝트',value:project?.name||'프로젝트 미지정',entity:{kind:'project',id:project?String(project.id):null,name:project?.name||'프로젝트 미지정'}}],validate:()=>stable()?null:'업무 초안 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(!intent||!stable())return;
      if(id){setEditing(false);setDirty(false);return;}
      taskDiscardPermit.current=true;const closed=await close();taskDiscardPermit.current=false;if(!closed&&stable())setError('업무 초안은 유지했습니다. 페이지 이동 조건을 다시 확인해 주세요.');
    } catch(error) {if(mounted.current&&!abort.signal.aborted)setError((error as Error).message+' 기존 업무 초안은 유지됩니다.');}
    finally {taskDiscardPermit.current=false;if(taskDiscardRequest.current===abort)taskDiscardRequest.current=null;if(mounted.current)setTaskDiscarding(false);}
  }
  const panelNavigationLive=useRef({id,form,images,boot,detail,editing,dirty,commentDirty,replyDirty,uploading,saving,actionsBusy:actions.busy,reviewing,taskDiscarding,commentTransitioning});panelNavigationLive.current={id,form,images,boot,detail,editing,dirty,commentDirty,replyDirty,uploading,saving,actionsBusy:actions.busy,reviewing,taskDiscarding,commentTransitioning};
  async function requestPanelNavigationDiscard({source,to,signal}:{source:'history'|'navigation';from:string;to:string;signal:AbortSignal}):Promise<(()=>boolean)|null> {
    if(source!=='history')return()=>true;
    if(taskDiscardPermit.current)return()=>taskDiscardPermit.current;
    if(navigationDiscardRequest.current||taskJumpRequest.current||actions.busy||saving||uploading||reviewing||taskDiscarding||commentTransitioning)return null;
    const start=panelNavigationLive.current,scope=commentActorScope(start.boot.me),draft=JSON.stringify({form:start.form,images:start.images}),revisions=JSON.stringify([newCommentRevision.current,nestedCommentRevision.current]),controller=new AbortController();
    const taskSignature=(value:Detail|undefined)=>value?JSON.stringify([value.task.id,value.task.title,value.task.version,value.task.projectId,value.task.archived,value.canEdit]):'';
    const capturedTask=taskSignature(start.detail),stable=()=>{const value=panelNavigationLive.current;return mounted.current&&!signal.aborted&&!controller.signal.aborted&&!value.uploading&&!value.saving&&!value.actionsBusy&&!value.reviewing&&!value.taskDiscarding&&!value.commentTransitioning&&value.id===start.id&&value.editing===start.editing&&value.dirty===start.dirty&&value.commentDirty===start.commentDirty&&value.replyDirty===start.replyDirty&&commentActorScope(value.boot.me)===scope&&JSON.stringify({form:value.form,images:value.images})===draft&&taskSignature(value.detail)===capturedTask&&JSON.stringify([newCommentRevision.current,nestedCommentRevision.current])===revisions;};
    if(!start.dirty&&!start.commentDirty&&!start.replyDirty)return stable;
    const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});navigationDiscardRequest.current=controller;setNavigationDiscarding(true);setError('');
    try {
      const project=start.boot.projects.find(value=>value.id===(start.detail?.task.projectId??start.form.projectId)),drafts=[start.dirty?'업무 수정':'',start.commentDirty?'새 댓글':'',start.replyDirty?'답글·댓글 수정':''].filter(Boolean).join(' · '),destination=new URL(to,location.origin).pathname;
      const intent=await confirmWorkspaceAction({title:'작성 중인 내용을 버리고 이전 화면으로 이동할까요?',message:'저장하지 않은 업무와 댓글 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:controller.signal,
        details:[{label:'업무',value:start.detail?.task.title||start.form.title||'새 업무'},{label:'작성 중',value:drafts},{label:'프로젝트',value:project?.name||'프로젝트 미지정',entity:{kind:'project',id:project?String(project.id):null,name:project?.name||'프로젝트 미지정'}},{label:'이동 위치',value:destination}],validate:()=>stable()?null:'업무 초안·댓글 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      return intent&&stable()?stable:null;
    } catch(error) {if(mounted.current&&!controller.signal.aborted)setError((error as Error).message+' 작성 중인 내용은 유지됩니다.');return null;}
    finally {signal.removeEventListener('abort',cancel);if(navigationDiscardRequest.current===controller)navigationDiscardRequest.current=null;if(mounted.current)setNavigationDiscarding(false);}
  }
  async function requestTaskJump(nextId:number,commentId?:number) {
    if(taskJumpRequest.current||actions.busy||saving||uploading||reviewing||taskDiscarding||commentTransitioning||navigationDiscarding)return;
    const start=panelNavigationLive.current;
    if(!start.dirty&&!start.commentDirty&&!start.replyDirty){if(!await opened(nextId,commentId)&&mounted.current)setError('다른 업무로 이동하지 못했습니다. 현재 업무를 유지합니다.');return;}
    const scope=commentActorScope(start.boot.me),draft=JSON.stringify({form:start.form,images:start.images}),revisions=JSON.stringify([newCommentRevision.current,nestedCommentRevision.current]),controller=new AbortController();taskJumpRequest.current=controller;setTaskJumping(true);setError('');
    const taskSignature=(value:Detail|undefined)=>value?JSON.stringify([value.task.id,value.task.title,value.task.version,value.task.projectId,value.task.archived,value.canEdit]):'';
    const capturedTask=taskSignature(start.detail),stable=()=>{const value=panelNavigationLive.current;return mounted.current&&!controller.signal.aborted&&!value.uploading&&!value.saving&&!value.actionsBusy&&!value.reviewing&&!value.taskDiscarding&&!value.commentTransitioning&&value.id===start.id&&value.editing===start.editing&&value.dirty===start.dirty&&value.commentDirty===start.commentDirty&&value.replyDirty===start.replyDirty&&commentActorScope(value.boot.me)===scope&&JSON.stringify({form:value.form,images:value.images})===draft&&taskSignature(value.detail)===capturedTask&&JSON.stringify([newCommentRevision.current,nestedCommentRevision.current])===revisions;};
    try {
      const project=start.boot.projects.find(value=>value.id===(start.detail?.task.projectId??start.form.projectId)),drafts=[start.dirty?'업무 수정':'',start.commentDirty?'새 댓글':'',start.replyDirty?'답글·댓글 수정':''].filter(Boolean).join(' · ');
      const intent=await confirmWorkspaceAction({title:'작성 중인 내용을 버리고 다른 업무로 이동할까요?',message:'저장하지 않은 업무와 댓글 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:controller.signal,
        details:[{label:'현재 업무',value:start.detail?.task.title||start.form.title||'새 업무'},{label:'작성 중',value:drafts},{label:'프로젝트',value:project?.name||'프로젝트 미지정',entity:{kind:'project',id:project?String(project.id):null,name:project?.name||'프로젝트 미지정'}},{label:'이동 대상',value:`업무 #${nextId}${commentId?` · 댓글 #${commentId}`:''}`}],validate:()=>stable()?null:'업무 초안·댓글 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(!intent||!stable())return;
      const moved=await opened(nextId,commentId);if(!moved&&stable())setError('다른 업무로 이동하지 못했습니다. 작성 중인 내용은 유지됩니다.');
    } catch(error) {if(mounted.current&&!controller.signal.aborted)setError((error as Error).message+' 작성 중인 내용은 유지됩니다.');}
    finally {if(taskJumpRequest.current===controller)taskJumpRequest.current=null;if(mounted.current)setTaskJumping(false);}
  }
  async function requestPanelCloseDiscard({signal}:{reason:string;signal:AbortSignal}):Promise<(()=>boolean)|null> {
    if(taskCloseRequest.current||taskJumpRequest.current||navigationDiscardRequest.current||actions.busy||saving||uploading||reviewing||taskDiscarding||commentTransitioning||taskJumping)return null;
    const start=panelNavigationLive.current,scope=commentActorScope(start.boot.me),draft=JSON.stringify({form:start.form,images:start.images}),revisions=JSON.stringify([newCommentRevision.current,nestedCommentRevision.current]),controller=new AbortController();
    const taskSignature=(value:Detail|undefined)=>value?JSON.stringify([value.task.id,value.task.title,value.task.version,value.task.projectId,value.task.archived,value.canEdit]):'';
    const capturedTask=taskSignature(start.detail),stable=()=>{const value=panelNavigationLive.current;return mounted.current&&!signal.aborted&&!controller.signal.aborted&&!value.uploading&&!value.saving&&!value.actionsBusy&&!value.reviewing&&!value.taskDiscarding&&!value.commentTransitioning&&value.id===start.id&&value.editing===start.editing&&value.dirty===start.dirty&&value.commentDirty===start.commentDirty&&value.replyDirty===start.replyDirty&&commentActorScope(value.boot.me)===scope&&JSON.stringify({form:value.form,images:value.images})===draft&&taskSignature(value.detail)===capturedTask&&JSON.stringify([newCommentRevision.current,nestedCommentRevision.current])===revisions;};
    if(!start.dirty&&!start.commentDirty&&!start.replyDirty)return stable;
    const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});taskCloseRequest.current=controller;setTaskClosing(true);setError('');
    try {
      const project=start.boot.projects.find(value=>value.id===(start.editing?start.form.projectId:start.detail?.task.projectId)),drafts=[start.dirty?'업무 수정':'',start.commentDirty?'새 댓글':'',start.replyDirty?'답글·댓글 수정':''].filter(Boolean).join(' · '),taskTitle=start.editing?start.form.title:start.detail?.task.title;
      const intent=await confirmWorkspaceAction({title:'작성 중인 내용을 버리고 업무를 닫을까요?',message:'저장하지 않은 업무와 댓글 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:controller.signal,
        details:[{label:'업무',value:taskTitle||'새 업무'},{label:'작성 중',value:drafts},{label:'프로젝트',value:project?.name||'프로젝트 미지정',entity:{kind:'project',id:project?String(project.id):null,name:project?.name||'프로젝트 미지정'}}],validate:()=>stable()?null:'업무 초안·댓글 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      return intent&&stable()?stable:null;
    } catch(error) {if(mounted.current&&!controller.signal.aborted)setError((error as Error).message+' 작성 중인 내용은 유지됩니다.');return null;}
    finally {signal.removeEventListener('abort',cancel);if(taskCloseRequest.current===controller)taskCloseRequest.current=null;if(mounted.current)setTaskClosing(false);}
  }
  const commentTransitionLive=useRef({id,boot,detail,editing,historyOpen,commentDirty,replyDirty,saving,actionsBusy:actions.busy,readInvalid:reads.invalid});commentTransitionLive.current={id,boot,detail,editing,historyOpen,commentDirty,replyDirty,saving,actionsBusy:actions.busy,readInvalid:reads.invalid};
  function reportNewCommentDirty(value:boolean){newCommentRevision.current++;setCommentDirty(value);}
  function reportNestedCommentDirty(value:boolean){nestedCommentRevision.current++;setReplyDirty(value);}
  async function requestCommentTransition(kind:'edit-task'|'history',apply:()=>void) {
    if(commentTransitionRequest.current||actions.busy||saving||reads.invalid)return;
    if(!commentDirty&&!replyDirty){apply();return;}
    const start=commentTransitionLive.current,scope=commentActorScope(start.boot.me),revisions=JSON.stringify([newCommentRevision.current,nestedCommentRevision.current]),abort=new AbortController();commentTransitionRequest.current=abort;setCommentTransitioning(true);setError('');
    const taskSignature=(value:Detail|undefined)=>value?JSON.stringify([value.task.id,value.task.title,value.task.version,value.task.projectId,value.task.archived,value.canEdit]):'';
    const captured=taskSignature(start.detail),stable=()=>{const value=commentTransitionLive.current;return mounted.current&&!abort.signal.aborted&&!value.editing&&!value.saving&&!value.actionsBusy&&!value.readInvalid&&value.id===start.id&&value.historyOpen===start.historyOpen&&value.commentDirty===start.commentDirty&&value.replyDirty===start.replyDirty&&commentActorScope(value.boot.me)===scope&&taskSignature(value.detail)===captured&&JSON.stringify([newCommentRevision.current,nestedCommentRevision.current])===revisions;};
    try {
      const project=start.boot.projects.find(value=>value.id===start.detail?.task.projectId),drafts=[start.commentDirty?'새 댓글':'',start.replyDirty?'답글·댓글 수정':''].filter(Boolean).join(' · ');
      const intent=await confirmWorkspaceAction({title:kind==='edit-task'?'댓글 초안을 버리고 업무를 수정할까요?':'댓글 초안을 버리고 변경 이력을 열까요?',message:'저장하지 않은 댓글 내용과 첨부 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'업무',value:start.detail?.task.title||'현재 업무'},{label:'작성 중',value:drafts},{label:'프로젝트',value:project?.name||'프로젝트 미지정',entity:{kind:'project',id:project?String(project.id):null,name:project?.name||'프로젝트 미지정'}}],validate:()=>stable()?null:'댓글 초안·업무 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(intent&&stable())apply();
    } catch(error) {if(mounted.current&&!abort.signal.aborted)setError((error as Error).message+' 기존 댓글 초안은 유지됩니다.');}
    finally {if(commentTransitionRequest.current===abort)commentTransitionRequest.current=null;if(mounted.current)setCommentTransitioning(false);}
  }
  const assignable = boot.employees.filter(p => p.active && p.access && !p.shared && (!id || boot.me.isAdmin || p.id === boot.me.id || (p.departmentId != null && p.departmentId === boot.me.departmentId && boot.leads.some(l => l.employeeId === boot.me.id && l.departmentId === p.departmentId))));
  const name = (person: number) => boot.employees.find(p => p.id === person)?.name || '이전 직원';
  const authorId = id ? detail?.task.createdBy : boot.me.id;
  const author = authorId === boot.me.id ? boot.me : boot.employees.find(p => p.id === authorId);
  const authorInfo = (!id || detail) && <p className="task-author" aria-label="작성자"><span>작성자</span>{author && <Avatar id={author.id} name={author.name} />}<b>{author?.name || '작성자 정보 없음'}</b>{detail && <time dateTime={detail.task.createdAt.endsWith('Z') ? detail.task.createdAt : detail.task.createdAt + 'Z'} title="한국 시간 기준 최초 작성 시각">작성일 {stamp(detail.task.createdAt, true)}</time>}</p>;
  return <TaskLinkProvider open={jumpToTask} projects={boot.projects} enabled={!reads.invalid}><dialog className="cw-modal task-dialog task-detail-dialog" aria-label={id ? `업무 #${id}` : '새 업무'} ref={dialog}><section className="detail-panel"><div className="task-detail-toolbar"><div className="detail-top"><span className="eyebrow">{id ? `업무 #${id}` : '새 업무'}</span>{id && <button className="cw-button" data-size="compact" onClick={() => navigator.clipboard.writeText(location.origin + `/tasks/${id}`).catch(() => setError('주소창의 업무 링크를 복사해 주세요.'))}>링크 복사</button>}</div><button className="cw-button close" data-variant="quiet" aria-label="업무 닫기" disabled={actions.busy||saving||taskClosing} onClick={requestClose}>×</button></div><div className="task-detail-content">
  <ScheduleToastNotice id={`task-${id||'new'}-error`} state={error?{kind:'error',message:error}:null}/>
  <ScheduleToastNotice id={`task-${id||'new'}-read`} state={reads.loading&&!writes.needsRefresh?{kind:'loading',title:'업무 상세를 확인하고 있습니다.'}:reads.outcome&&!writes.needsRefresh?{...reads.outcome,actionLabel:!reads.loading&&!actions.busy?'업무 다시 조회':undefined,onAction:()=>void fetchDetail().catch(()=>{})}:null}/>
  <ScheduleToastNotice id={`task-${id||'new'}-review`} state={reviewMessage?{kind:'empty',message:reviewMessage}:null}/>
  <ScheduleToastNotice id={`task-${id||'new'}-write`} state={writes.outcome?{...writes.outcome,actionLabel:writes.needsRefresh&&!saving?'저장 결과 다시 조회':!editing&&writes.outcome.actionLabel?'현재 업무 다시 조회':undefined,onAction:writes.needsRefresh?()=>void writes.refreshSaved():!editing&&writes.outcome.onAction?()=>void readDetail().catch(e=>setError((e as Error).message)):undefined}:null}/>
  <ScheduleToastNotice id={`task-${id||'new'}-action`} state={actions.outcome?{...actions.outcome,actionLabel:actions.needsRefresh&&!actions.busy?'목록 다시 확인':undefined,onAction:()=>void actions.refresh()}:null}/>
  {blockedReason&&!editing&&!reads.invalid && <WorkspaceState kind="empty" title="작성 중인 내용이 있습니다." message={blockedReason+' 보관·복원·삭제는 이후 실행할 수 있습니다.'} />}
  <fieldset className="task-action-content" disabled={actions.busy||saving||taskDiscarding||commentTransitioning||navigationDiscarding||taskJumping||taskClosing||writes.needsRefresh} aria-label="업무 내용">
  {editing ? <form className="task-editor" onSubmit={e => { e.preventDefault(); void writes.run(); }}><h1>{id ? '업무 수정' : '새 업무 등록'}</h1>{authorInfo}<label className="cw-form-field">제목<input className="cw-form-control" required maxLength={200} autoFocus value={form.title} onChange={e => setField('title', e.target.value)} placeholder="어떤 업무인가요?" /></label><div className="cw-form-fields task-form-grid"><label className="cw-form-field">담당자<select className="cw-form-control" data-company-picker="employee" aria-label="담당자" value={form.assigneeId} onChange={e => setField('assigneeId', Number(e.target.value))}>{assignable.map(p => <option key={p.id} value={p.id}>{p.name}{p.isPrivate ? ' · 비공개' : ''} · {p.department || '미지정'}</option>)}</select></label><label className="cw-form-field">프로젝트<select className="cw-form-control" data-company-picker="project" aria-label="프로젝트" value={form.projectId ?? ''} onChange={e => { const projectId=e.target.value ? Number(e.target.value) : null;setForm(value=>({...value,projectId,goalId:(boot.goals||[]).some(goal=>goal.id===value.goalId&&(goal.projectId===null||goal.projectId===projectId))?value.goalId:null}));setDirty(true); }}><option value="">미지정</option>{recommendedProjects(boot.projects, boot.employees.find(e => e.id === form.assigneeId), form.projectId).map(p => <option key={p.id} value={p.id}>{p.name}{p.isPrivate ? ' · 비공개' : ''}{(boot.employees.find(e => e.id === form.assigneeId)?.projectIds || []).includes(p.id) ? ' · 참여 중' : ''}{p.archived ? ' · 보관됨' : ''}</option>)}</select></label><label className="cw-form-field">업무 목표<select className="cw-form-control" aria-label="업무 목표" value={form.goalId??''} onChange={e=>setField('goalId',e.target.value?Number(e.target.value):null)}><option value="">목표 미지정</option>{(boot.goals||[]).filter(goal=>(!goal.closedAt||goal.id===form.goalId)&&(goal.projectId===null||goal.projectId===form.projectId)).map(goal=><option key={goal.id} value={goal.id}>{goal.title}{goal.closedAt?' · 종료됨':''}</option>)}</select></label><label className="cw-form-field">시작일<DatePicker label="시작일" value={form.startDate || ''} onChange={value => { const date = value || null; setForm(f => ({ ...f, startDate: date, endDate: date ? f.endDate || date : null })); setDirty(true); }} /></label><label className="cw-form-field">종료일<DatePicker label="종료일" min={form.startDate || undefined} value={form.endDate || ''} onChange={value => setField('endDate', value || null)} /></label><label className="cw-form-field">진행 상태<select className="cw-form-control" value={form.status} onChange={e => setField('status', e.target.value as Status)}>{Object.entries(statuses).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div><button className="cw-button" data-variant="quiet" type="button" onClick={() => { setForm(f => ({ ...f, startDate: null, endDate: null })); setDirty(true); }}>날짜 미정으로 두기</button><Editor value={form.body} onChange={v => setField('body', v)} images={images} setImages={v => { setImages(v); setDirty(true); }} employees={boot.employees} boot={boot} refreshIdentity={refreshIdentity} label="업무 본문" disabled={saving||taskDiscarding||taskClosing} uploadDisabled={reads.invalid||writes.locked||writes.needsRefresh} busyChanged={setUploading} />
  {id && <WorkspaceState kind={reviewing?'loading':'empty'} title={reviewing?'현재 업무를 확인합니다.':detail?.task.version!==form.version?'서버의 업무가 변경되었습니다.':'저장 전 변경 내용 확인'} message="수정 전·내 초안·현재 서버 값을 비교합니다. 비교만으로 저장하지 않습니다." actionLabel={reviewing?undefined:'변경 내용 비교'} onAction={reviewing?undefined:()=>void reviewChanges()} />}
  {!id && form.assigneeId !== boot.me.id && <p className="assignment-notice" role="status">저장하면 담당자에게 업무 등록 알림이 전달됩니다.</p>}<div className="form-actions"><button className="cw-button" type="button" disabled={taskDiscarding} onClick={() => void requestTaskEditCancel()}>취소</button><button className="cw-button" data-variant="primary" disabled={reads.invalid || writes.locked || writes.needsRefresh || saving || uploading || taskDiscarding}>{saving ? '저장 중…' : '업무 저장'}</button></div></form> : detail ? <><h1>{detail.task.title}</h1>{authorInfo}{detail.task.archived && <div className="warning">보관된 업무 · 읽기 전용{boot.me.isAdmin && <button className="cw-button" disabled={actionUnavailable} title={blockedReason||undefined} onClick={() => void actions.run('restore')}>복원</button>}</div>}<div className="detail-properties"><span><small>담당자</small><Avatar id={detail.task.assigneeId} name={name(detail.task.assigneeId)} />{name(detail.task.assigneeId)}</span><span><small>프로젝트</small><ProjectIcon id={detail.task.projectId} />{boot.projects.find(p => p.id === detail.task.projectId)?.name || '미지정'}</span><span><small>업무 목표</small>{(boot.goals||[]).find(goal=>goal.id===detail.task.goalId)?.title||'미지정'}</span><span><small>일정</small>{detail.task.startDate ? `${detail.task.startDate} ~ ${detail.task.endDate}` : '날짜 미정'}</span><label className="cw-form-field task-status"><small>상태</small>{detail.canEdit ? <select className="cw-form-control" aria-label="업무 상태" disabled={reads.invalid||writes.locked||writes.needsRefresh} value={detail.task.status} onChange={e => { void writes.run(e.target.value as Status); }}>{Object.entries(statuses).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select> : statuses[detail.task.status]}</label></div><Body text={detail.task.body || '아직 본문이 없습니다.'} employees={boot.employees} /><ImageList images={detail.attachments.filter(a => a.commentId === null)} />{detail.canEdit && <div className="form-actions"><button className="cw-button" disabled={reads.invalid||commentTransitioning} onClick={() => void requestCommentTransition('edit-task',beginTaskEdit)}>업무 수정</button><button className="cw-button" data-variant="quiet" disabled={actionUnavailable} title={blockedReason||undefined} onClick={() => void actions.run('archive')}>보관</button></div>}<TaskPlanning boot={boot} detail={detail} reload={async()=>{await readDetail();}} disabled={reads.invalid||actions.busy||saving}/>
  <div className="discussion-heading"><h2>논의 <span>{detail.comments.filter(c => !c.deleted).length}</span></h2><button className="cw-button" data-variant="quiet" disabled={reads.invalid||commentTransitioning} onClick={() => void requestCommentTransition('history',()=>{setCommentDirty(false);setReplyDirty(false);setHistoryOpen(value=>!value);})}>{historyOpen ? '댓글 보기' : '변경 이력'}</button></div>
  {historyOpen ? <ol className="history-list">{detail.history.map(h => <li key={h.id}><b><Avatar id={h.actorId} name={name(h.actorId)} />{name(h.actorId)}</b> {h.action}<time>{stamp(h.createdAt)}</time></li>)}</ol> : <><Discussion readDetail={readDetail} readBlocked={reads.invalid} detail={detail} boot={boot} refreshIdentity={refreshIdentity} reload={async () => { await fetchDetail(); await changed(); }} dirtyChanged={reportNestedCommentDirty} editorChanged={setReplyEditorOpen} actionUnavailable={actionUnavailable} remove={c=>actions.run('delete-comment',c.id)} />{!detail.task.archived && <CommentComposer readDetail={readDetail} readBlocked={reads.invalid} key={`new-${id}`} boot={boot} detail={detail} refreshIdentity={refreshIdentity} dirtyChanged={reportNewCommentDirty} saved={async () => { await fetchDetail(); await changed(); }} />}</>}
  </> : null}</fieldset></div></section></dialog></TaskLinkProvider>;
}

function Discussion({ detail, boot, reload, dirtyChanged, refreshIdentity, editorChanged, actionUnavailable, remove, readBlocked, readDetail }: { readDetail:()=>Promise<Detail>; readBlocked:boolean; detail: Detail; boot: Bootstrap; refreshIdentity: () => Promise<Bootstrap>; reload: () => Promise<void>; dirtyChanged: (v: boolean) => void; editorChanged:(value:boolean)=>void; actionUnavailable:boolean; remove:(comment:Comment)=>Promise<void> }) {
  const [reply, setReply] = useState<number>(); const [editing, setEditing] = useState<number>();
  const [composerDirty, setComposerDirty] = useState(false),[discarding,setDiscarding]=useState(false),[discardError,setDiscardError]=useState('');
  const discard=useRef<AbortController|null>(null),discardRevision=useRef(0),mounted=useRef(true);
  const scope=commentActorScope(boot.me),live=useRef({composerDirty,reply,editing,detail,scope});live.current={composerDirty,reply,editing,detail,scope};
  useEffect(()=>{editorChanged(editing!==undefined||reply!==undefined);return()=>editorChanged(false);},[editing,reply,editorChanged]);
  useEffect(()=>{mounted.current=true;const abort=()=>discard.current?.abort();document.addEventListener('workspace-entity-scope-change',abort);return()=>{mounted.current=false;abort();document.removeEventListener('workspace-entity-scope-change',abort);};},[]);
  useEffect(()=>()=>discard.current?.abort(),[scope,detail.task.id]);
  function setDirty(v: boolean) { discardRevision.current++;setComposerDirty(v); dirtyChanged(v); }
  const commentSignature=(value:Comment|undefined)=>value?JSON.stringify([value.id,value.taskId,value.authorId,value.parentId,value.body,value.deleted,value.version]):'';
  async function requestCommentDiscard(kind:'switch'|'cancel-edit'|'cancel-reply',targetId:number,apply:()=>void) {
    if(discard.current)return;
    if(!composerDirty){apply();return;}
    const start=live.current,sourceId=start.editing??start.reply,target=start.detail.comments.find(value=>value.id===targetId);
    const captured={revision:discardRevision.current,scope:start.scope,taskId:start.detail.task.id,taskVersion:start.detail.task.version,editing:start.editing,reply:start.reply,source:commentSignature(start.detail.comments.find(value=>value.id===sourceId)),target:commentSignature(target)};
    const abort=new AbortController();discard.current=abort;setDiscarding(true);setDiscardError('');
    const stable=()=>{const value=live.current;return mounted.current&&!abort.signal.aborted&&discardRevision.current===captured.revision&&value.composerDirty&&value.scope===captured.scope&&value.detail.task.id===captured.taskId&&value.detail.task.version===captured.taskVersion&&value.editing===captured.editing&&value.reply===captured.reply&&commentSignature(value.detail.comments.find(item=>item.id===(value.editing??value.reply)))===captured.source&&commentSignature(value.detail.comments.find(item=>item.id===targetId))===captured.target;};
    try {
      const title=kind==='switch'?'작성 중인 댓글을 버리고 이동할까요?':kind==='cancel-edit'?'댓글 수정 초안을 버릴까요?':'답글 초안을 버릴까요?';
      const intent=await confirmWorkspaceAction({title,message:'저장하지 않은 댓글 내용과 첨부 변경은 사라집니다.',confirmLabel:'초안 버리기',tone:'danger',returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:undefined,signal:abort.signal,
        details:[{label:'작성 중',value:start.editing!==undefined?'댓글 수정':'답글 작성'},{label:kind==='switch'?'이동할 댓글':'현재 댓글',value:target?.body||'(본문 없음)'}],validate:()=>stable()?null:'댓글 초안·대상 또는 로그인 상태가 변경되었습니다. 현재 내용을 다시 확인해 주세요.'});
      if(intent&&stable())apply();
    } catch(error) {if(mounted.current&&!abort.signal.aborted)setDiscardError((error as Error).message+' 기존 댓글 초안은 유지됩니다.');}
    finally {if(discard.current===abort)discard.current=null;if(mounted.current)setDiscarding(false);}
  }
  function switchEditor(next: number, mode: 'reply' | 'edit') { void requestCommentDiscard('switch',next,()=>{setDirty(false);setReply(mode === 'reply' ? next : undefined);setEditing(mode === 'edit' ? next : undefined);}); }
  function render(c: Comment) {
    const author = boot.employees.find(p => p.id === c.authorId);
    return <article className={`comment ${c.parentId ? 'reply' : ''}`} id={`comment-${c.id}`} key={c.id}><div className="comment-heading"><Avatar id={c.authorId} name={author?.name} /><b>{author?.name || '이전 직원'}</b><time>{stamp(c.createdAt)}{c.editedAt && !c.deleted ? ' · 수정됨' : ''}</time></div>{editing === c.id ? <CommentComposer readDetail={readDetail} readBlocked={readBlocked} key={`edit-${c.id}`} boot={boot} detail={detail} refreshIdentity={refreshIdentity} initial={c} images={detail.attachments.filter(a => a.commentId === c.id)} dirtyChanged={setDirty} cancel={() => void requestCommentDiscard('cancel-edit',c.id,()=>{setEditing(undefined);setDirty(false);})} saved={async () => { await reload(); setEditing(undefined); setDirty(false); }} /> : c.deleted ? <p className="muted">삭제된 댓글입니다.</p> : <><Body text={c.body} employees={boot.employees} /><ImageList images={detail.attachments.filter(a => a.commentId === c.id)} /></>}
    {!detail.task.archived && <div className="comment-actions">{!c.parentId && <button className="cw-button" data-size="compact" data-variant="quiet" disabled={discarding} onClick={() => switchEditor(c.id, 'reply')}>답글</button>}{!c.deleted && c.authorId === boot.me.id && <button className="cw-button" disabled={discarding} onClick={() => switchEditor(c.id, 'edit')}>수정</button>}{!c.deleted && (c.authorId === boot.me.id || boot.me.isAdmin) && <button className="cw-button" data-size="compact" data-variant="danger" disabled={actionUnavailable||discarding} onClick={() => void remove(c)}>삭제</button>}</div>}
    {reply === c.id && <CommentComposer readDetail={readDetail} readBlocked={readBlocked} boot={boot} detail={detail} refreshIdentity={refreshIdentity} parentId={c.id} dirtyChanged={setDirty} cancel={() => void requestCommentDiscard('cancel-reply',c.id,()=>{setReply(undefined);setDirty(false);})} saved={async () => { await reload(); setReply(undefined); setDirty(false); }} />}</article>;
  }
  return <><ScheduleToastNotice id={`discussion-${detail.task.id}`} state={discardError?{kind:'error',title:'댓글 전환을 완료하지 못했습니다.',message:discardError}:null}/>{detail.comments.filter(c => c.parentId === null).map(c => <div key={c.id}>{render(c)}{detail.comments.filter(r => r.parentId === c.id).map(render)}</div>)}{detail.comments.length === 0 && <p className="empty-note">아직 논의가 없습니다. 의견이나 참고 이미지를 남겨보세요.</p>}</>;
}
