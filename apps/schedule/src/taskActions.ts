import {commentActorScope} from './commentReview';
import type {Attachment, Bootstrap, Comment, Detail, Employee, Task} from './types';

export type TaskActionKind = 'archive' | 'restore' | 'delete-comment';
export type TaskAction = {kind: TaskActionKind; task: Task; comment?: Comment; attachments:Attachment[]};
export type TaskActionWrite = {action:TaskAction;actorId:string;actorScope:string;stateToken:string;body:{version:number}};
export type TaskActionReceipt = {operation:TaskActionKind;actorId:string;previousStateToken:string;stateToken:string;task?:Task;comment?:Comment;attachments:Attachment[];navigateTo?:string};
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unchangedTask = (task: Task) => [task.id,task.title,task.body,task.assigneeId,task.createdBy,task.projectId,task.startDate,task.endDate,task.status,task.createdAt];
const sameStamp=(a:string|null|undefined,b:string|null|undefined)=>(a??'').replace(/Z$/,'')===(b??'').replace(/Z$/,'');
const requireValue=(value:unknown,message='업무 작업 완료 응답을 확인하지 못했습니다.')=>{if(!value)throw Error(message);};

export function taskActionTarget(kind: TaskActionKind, taskId: number, detail: Detail, actor: Employee, commentId?: number): TaskAction {
  if (!actor.active || !actor.access || actor.shared || !positive(actor.id)) throw Error('현재 계정으로 이 작업을 실행할 수 없습니다.');
  if (!detail?.task || detail.task.id !== taskId || !positive(taskId) || !positive(detail.task.version)) throw Error('업무 확인 응답이 올바르지 않습니다.');
  if (kind === 'archive' && (detail.task.archived || !detail.canEdit)) throw Error('이 업무를 보관할 권한 또는 상태가 변경되었습니다.');
  if (kind === 'restore' && (!detail.task.archived || !actor.isAdmin)) throw Error('보관된 업무는 관리자만 복원할 수 있습니다.');
  let comment: Comment | undefined;
  if (kind === 'delete-comment') {
    const matches = detail.comments.filter(value => value.id === commentId);
    comment = matches[0];
    if (detail.task.archived || matches.length !== 1 || !comment || comment.deleted || comment.taskId !== taskId || !positive(comment.id) || !positive(comment.version)) throw Error('삭제할 댓글의 상태가 변경되었습니다.');
    if (comment.authorId !== actor.id && !actor.isAdmin) throw Error('댓글 작성자 또는 관리자만 삭제할 수 있습니다.');
  }
  const attachments=detail.attachments.filter(value=>value.taskId===taskId&&value.commentId===null);
  return structuredClone({kind,task:detail.task,comment,attachments});
}
export function taskActionSignature(action: TaskAction): string {
  return JSON.stringify([action.kind,unchangedTask(action.task),action.task.version,action.task.archived,action.comment??null,action.attachments]);
}
export function taskActionBaseline(detail:Detail,actorId:string,kind:TaskActionKind,commentId?:number):string{
  if(kind!=='delete-comment'){
    requireValue(detail.editing?.actorId===actorId&&token(detail.editing?.stateToken),'업무 작업 기준이 없습니다. 최신 서버에서 다시 조회해 주세요.');
    return detail.editing!.stateToken;
  }
  requireValue(detail.commentEditing?.actorId===actorId,'댓글 작업 계정 기준이 없습니다. 최신 서버에서 다시 조회해 주세요.');
  const rows=detail.commentEditing!.comments.filter(value=>value.id===commentId);
  requireValue(rows.length===1&&token(rows[0].stateToken),'댓글 작업 기준이 없습니다. 최신 댓글을 다시 조회해 주세요.');
  return rows[0].stateToken;
}
export function captureTaskAction(kind:TaskActionKind,taskId:number,detail:Detail,boot:Bootstrap,commentId?:number):TaskActionWrite{
  const action=taskActionTarget(kind,taskId,detail,boot.me,commentId),actorId=String(boot.me.id);
  return{action,actorId,actorScope:commentActorScope(boot.me),stateToken:taskActionBaseline(detail,actorId,kind,commentId),body:{version:action.comment?.version??action.task.version}};
}
export function confirmTaskActionResult(result: unknown, action: TaskAction): Task | undefined {
  if (action.kind === 'delete-comment') {
    // Legacy callers return undefined only for the existing HTTP 204 response.
    if (result !== undefined) throw Error('댓글 삭제 완료 응답을 확인하지 못했습니다.');
    return undefined;
  }
  const saved = result as Task | null;
  if (!saved || saved.id !== action.task.id || saved.version !== action.task.version + 1 || !positive(saved.version)
    || saved.archived !== (action.kind === 'archive') || typeof saved.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(saved.updatedAt)) || JSON.stringify(unchangedTask(saved)) !== JSON.stringify(unchangedTask(action.task))) throw Error('업무 처리 완료 응답을 확인하지 못했습니다.');
  return saved;
}
export function confirmTaskActionReceipt(value:unknown,write:TaskActionWrite,sent:unknown):TaskActionReceipt{
  const data=value as TaskActionReceipt,action=write.action;
  requireValue(data&&data.operation===action.kind&&data.actorId===write.actorId&&data.previousStateToken===write.stateToken&&token(data.stateToken)&&data.stateToken!==write.stateToken);
  requireValue(JSON.stringify(sent)===JSON.stringify(write.body)&&Array.isArray(data.attachments));
  if(action.kind!=='delete-comment'){
    const saved=confirmTaskActionResult(data.task,action)!;
    requireValue(data.navigateTo===`/tasks/${action.task.id}`&&data.comment===undefined&&data.attachments.length===action.attachments.length);
    const expected=new Map(action.attachments.map(item=>[item.id,item]));
    for(const item of data.attachments){const before=expected.get(item.id);requireValue(before&&item.taskId===saved.id&&item.commentId===null&&item.name===before.name&&item.contentType===before.contentType&&item.size===before.size);}
  }else{
    const before=action.comment!,comment=data.comment;
    requireValue(data.task===undefined&&data.navigateTo===undefined&&data.attachments.length===0&&comment&&comment.id===before.id&&comment.taskId===before.taskId&&comment.authorId===before.authorId&&comment.parentId===before.parentId&&comment.body===''&&comment.deleted&&comment.version===before.version+1&&sameStamp(comment.createdAt,before.createdAt)&&typeof comment.editedAt==='string'&&Number.isFinite(Date.parse(comment.editedAt)));
  }
  return data;
}
export function verifyTaskActionRead(detail: Detail, action: TaskAction) {
  if (detail.task.id !== action.task.id || !positive(detail.task.version)) throw Error('조회 대상 또는 버전이 올바르지 않습니다.');
  if (action.kind === 'delete-comment') {
    const matches = detail.comments.filter(c => c.id === action.comment!.id), comment = matches[0];
    if (matches.length !== 1 || !comment || comment.taskId !== action.task.id || !comment.deleted || !positive(comment.version) || comment.version < action.comment!.version + 1) throw Error('삭제 이후 최신 댓글 상태를 아직 읽지 못했습니다.');
  } else if (detail.task.version < action.task.version + 1 || (detail.task.version === action.task.version + 1 && detail.task.archived !== (action.kind === 'archive'))) throw Error('처리 이후 최신 업무 상태를 아직 읽지 못했습니다.');
}
