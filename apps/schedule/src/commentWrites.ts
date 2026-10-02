import type {Attachment,Bootstrap,Comment,Detail} from './types';
import {commentActorScope,commentSnapshot,commentValues,type CommentDraft,type CommentSnapshot} from './commentReview';
import {taskDetailResponse} from './scheduleReads';

export type CommentWriteKind='create'|'reply'|'update';
export type CommentWrite={kind:CommentWriteKind;actorId:string;actorScope:string;taskId:number;targetId?:number;
  before?:CommentSnapshot;draft:CommentDraft;stateToken:string;body:{body:string;parentId:number|null;version:number;attachmentIds:string[]}};
export type CommentReceipt={operation:CommentWriteKind;actorId:string;previousStateToken:string;stateToken:string;comment:Comment;attachments:Attachment[]};
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const trim=(value:string)=>value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,'');
const sameStamp=(a:string,b:string)=>a.replace(/Z$/,'')===b.replace(/Z$/,'');
function requireValue(value:unknown,message='댓글 저장 확인 정보가 올바르지 않습니다. 최신 내용을 확인해 주세요.'){if(!value)throw Error(message);}

export function commentWriteBaseline(detail:Detail,actorId:string,targetId?:number):string{
  taskDetailResponse(detail,detail.task.id);const editing=detail.commentEditing;
  requireValue(editing?.actorId===actorId&&token(editing.createStateToken),'댓글 저장 기준이 없습니다. 최신 서버로 다시 조회해 주세요.');
  if(targetId===undefined)return editing!.createStateToken;
  const matches=editing!.comments.filter(row=>row.id===targetId);requireValue(matches.length===1&&token(matches[0].stateToken));return matches[0].stateToken;
}

export function captureCommentWrite(draft:CommentDraft,detail:Detail,boot:Bootstrap,initial?:Comment,parentId:number|null=null):CommentWrite{
  requireValue(positive(boot.me.id)&&boot.me.active&&boot.me.access&&!boot.me.shared,'현재 계정으로 댓글을 저장할 수 없습니다.');
  requireValue(!detail.task.archived&&detail.task.id>0,'보관된 업무에는 댓글을 저장할 수 없습니다.');
  const copy=structuredClone(draft);const values=commentValues(copy),body=values.body[0];
  requireValue(trim(body).length<=10000&&(trim(body).length>0||values.attachmentIds.length>0)&&values.attachmentIds.length<=10,'댓글 또는 이미지를 남겨 주세요. 본문은 최대 10,000자입니다.');
  const actorId=String(boot.me.id),kind:CommentWriteKind=initial?'update':parentId===null?'create':'reply';
  let targetId: number|undefined,before:CommentSnapshot|undefined;
  if(initial){before=commentSnapshot(initial,detail.attachments.filter(a=>a.commentId===initial.id));targetId=initial.id;requireValue(initial.authorId===boot.me.id&&copy.version===initial.version,'작성자와 댓글 버전을 확인해 주세요.');}
  else {requireValue(copy.version===0,'신규 댓글 버전을 확인해 주세요.');if(parentId!==null){const parent=detail.comments.find(c=>c.id===parentId);requireValue(parent&&!parent.deleted&&parent.parentId===null,'답글 대상을 확인해 주세요.');targetId=parentId;}}
  const stateToken=commentWriteBaseline(detail,actorId,targetId);
  return {kind,actorId,actorScope:commentActorScope(boot.me),taskId:detail.task.id,targetId,before,draft:copy,stateToken,
    body:{body,parentId:initial?.parentId??parentId,version:copy.version,attachmentIds:values.attachmentIds}};
}

export function confirmCommentReceipt(value:unknown,write:CommentWrite,sent:unknown):CommentReceipt{
  const data=value as CommentReceipt;requireValue(data&&data.operation===write.kind&&data.actorId===write.actorId&&data.previousStateToken===write.stateToken&&token(data.stateToken)&&data.stateToken!==write.stateToken);
  requireValue(JSON.stringify(sent)===JSON.stringify(write.body));const comment=data.comment;
  requireValue(comment&&positive(comment.id)&&comment.taskId===write.taskId&&comment.authorId===Number(write.actorId)&&comment.parentId===write.body.parentId&&!comment.deleted&&comment.body===trim(write.body.body));
  requireValue(write.kind==='update'?(comment.id===write.targetId&&comment.version===write.draft.version+1):comment.version===1);
  requireValue(typeof comment.createdAt==='string'&&Number.isFinite(Date.parse(comment.createdAt))&&(comment.editedAt===null||typeof comment.editedAt==='string'&&Number.isFinite(Date.parse(comment.editedAt))));
  if(write.before){requireValue(sameStamp(comment.createdAt,write.before.createdAt)&&comment.editedAt!==null);}
  const expected=new Map(write.draft.images.map(image=>[image.id,image]));requireValue(Array.isArray(data.attachments)&&data.attachments.length===expected.size);
  for(const image of data.attachments){
    const before=expected.get(image.id);requireValue(before&&image.taskId===write.taskId&&image.commentId===comment.id&&positive(image.ownerId)&&typeof image.createdAt==='string'&&Number.isFinite(Date.parse(image.createdAt)));
    for(const key of ['name','contentType','size'] as const)requireValue(image[key]===before![key]);
    if(before!.ownerId!==undefined)requireValue(image.ownerId===before!.ownerId);if(before!.createdAt!==undefined)requireValue(sameStamp(image.createdAt!,before!.createdAt));
    if(before!.taskId===null)requireValue(String(image.ownerId)===write.actorId);
  }
  return data;
}
