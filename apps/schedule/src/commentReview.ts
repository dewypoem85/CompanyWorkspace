import type { Attachment, Comment, Detail, Employee } from './types';
import type { ReviewItem, ReviewSelection } from './generated/workspace-review';

export type CommentDraft = {body: string; images: Attachment[]; version: number};
export type CommentSnapshot = CommentDraft & {id: number; taskId: number; authorId: number; parentId: number | null;createdAt:string;editedAt:string|null};
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
export const commentActorScope = (me: Employee) => JSON.stringify([me.id,me.role,me.isAdmin,me.active,me.access,me.shared]);
export function commentValues(draft: CommentDraft): Record<string,string[]> {
  if (typeof draft.body !== 'string' || !Array.isArray(draft.images) || draft.images.some(a=>typeof a.id!=='string'||!a.id||typeof a.name!=='string') || new Set(draft.images.map(a=>a.id)).size!==draft.images.length) throw Error('댓글 또는 첨부 확인 정보가 올바르지 않습니다.');
  return {body:[draft.body],attachmentIds:draft.images.map(a=>a.id)};
}
export function commentSnapshot(comment: Comment, images: Attachment[]): CommentSnapshot {
  if (!positive(comment.id)||!positive(comment.taskId)||!positive(comment.authorId)||!positive(comment.version)||comment.parentId!==null&&!positive(comment.parentId)||comment.deleted!==false) throw Error('수정할 수 없는 댓글입니다. 삭제 여부와 식별자를 확인해 주세요.');
  const snapshot={id:comment.id,taskId:comment.taskId,authorId:comment.authorId,parentId:comment.parentId,createdAt:comment.createdAt,editedAt:comment.editedAt,version:comment.version,body:comment.body,images:[...images]};
  commentValues(snapshot);return snapshot;
}
export function currentComment(detail: Detail, before: CommentSnapshot, me: Employee): CommentSnapshot {
  if (detail.task.id!==before.taskId||detail.task.archived!==false||!me.active||!me.access||me.shared) throw Error('업무가 보관되었거나 현재 댓글 접근 권한이 없습니다.');
  const matches=detail.comments.filter(c=>c.id===before.id);
  if(matches.length!==1)throw Error('댓글을 찾을 수 없습니다. 기존 초안은 유지됩니다.');
  const current=commentSnapshot(matches[0],detail.attachments.filter(a=>a.commentId===before.id));
  if(current.taskId!==before.taskId||current.parentId!==before.parentId||current.authorId!==before.authorId||current.authorId!==me.id)throw Error('작성자만 원래 댓글을 수정할 수 있습니다.');
  if(current.version<before.version)throw Error('이전 버전의 댓글이 반환되었습니다. 다시 확인해 주세요.');
  return current;
}
export function commentReviewItem(before: CommentSnapshot, draft: CommentDraft, current: CommentSnapshot): ReviewItem {
  const values=[before,draft,current].map(commentValues),images=new Map([...before.images,...draft.images,...current.images].map(a=>[a.id,a.name]));
  return {id:String(before.id),label:`댓글 #${before.id}`,fields:[['body','본문'],['attachmentIds','첨부 이미지']].map(([key,label])=>({
    key,label,before:values[0][key],draft:values[1][key],current:values[2][key],set:key==='attachmentIds',
    format:items=>key==='body'?items[0]||'—':items.map(id=>`${images.get(id)||'첨부'} (#${id})`).join('\n')||'—'
  }))};
}
export function applyCommentReview(selection: ReviewSelection, before: CommentSnapshot, draft: CommentDraft, current: CommentSnapshot): CommentDraft {
  if(selection.id!==String(before.id)||current.id!==before.id||current.taskId!==before.taskId||current.authorId!==before.authorId||current.parentId!==before.parentId||!positive(current.version)||current.version<before.version)throw Error('원래 댓글의 비교 결과가 아닙니다.');
  const candidates=[before,draft,current].map(commentValues);
  for(const key of ['body','attachmentIds'])if(!Array.isArray(selection.fields[key])||!candidates.some(c=>JSON.stringify(c[key])===JSON.stringify(selection.fields[key])))throw Error('확인하지 않은 댓글 값입니다.');
  const body=selection.fields.body[0],ids=selection.fields.attachmentIds;
  if(body.trim().length>10000||(!body.trim()&&!ids.length))throw Error('댓글 또는 이미지를 남겨 주세요. 본문은 최대 10,000자입니다.');
  const available=new Map([...draft.images.filter(a=>!before.images.some(b=>b.id===a.id)),...current.images].map(a=>[a.id,a]));
  if(ids.length>10||ids.some(id=>!available.has(id)))throw Error('서버에서 제거된 첨부는 다시 업로드해야 합니다. 현재 서버 첨부를 선택하거나 취소 후 수정해 주세요.');
  return {body,images:ids.map(id=>available.get(id)!),version:current.version};
}
