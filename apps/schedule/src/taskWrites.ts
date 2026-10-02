import type {Attachment,Bootstrap,Detail,Status,Task} from './types';
import {taskFields,taskSnapshot,taskValues,type TaskSnapshot} from './taskReview';
import {taskDetailResponse,scheduleActorScope} from './scheduleReads';
export type TaskWriteKind='create'|'update'|'status';
export type TaskWrite={kind:TaskWriteKind;id?:number;actorId:string;actorScope:string;before?:Detail;draft:TaskSnapshot;stateToken:string|null;body:Record<string,unknown>};
export type TaskReceipt={operation:TaskWriteKind;actorId:string;previousStateToken:string|null;stateToken:string;task:Task;attachments:Attachment[];navigateTo:string};
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const safeId=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const requireValue=(value:unknown,message='업무 저장 응답이 올바르지 않습니다. 초안을 유지하고 내역을 확인해 주세요.')=>{if(!value)throw Error(message);};
const trim=(value:string)=>value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu,''); // .NET string.Trim, not JS BOM trimming.
const sameStamp=(a:string,b:string)=>a.replace(/Z$/,'')===b.replace(/Z$/,'');
const utcStamp=(value:string)=>Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)?value:value+'Z');
export function taskWriteBaseline(detail:Detail,actorId:string):string{
  taskDetailResponse(detail,detail.task.id);
  requireValue(detail.editing?.actorId===actorId&&token(detail.editing?.stateToken),'업무 저장 기준이 없습니다. 최신 서버로 다시 조회해 주세요.');
  return detail.editing!.stateToken;
}
export function captureTaskWrite(kind:TaskWriteKind,draft:TaskSnapshot,boot:Bootstrap,before?:Detail):TaskWrite{
  requireValue(safeId(boot.me.id)&&boot.me.active&&boot.me.access&&!boot.me.shared,'현재 계정으로 업무를 저장할 수 없습니다.');
  const copy=structuredClone(draft),actorId=String(boot.me.id);
  taskValues(copy);
  requireValue(copy.form.title.length<=200&&trim(copy.form.title).length>0&&trim(copy.form.body).length<=20000,'제목·본문 길이를 확인해 주세요.');
  requireValue(copy.images.length<=10&&['planned','progress','done'].includes(copy.form.status),'첨부 또는 상태를 확인해 주세요.');
  if(kind!=='create')requireValue(before?.canEdit&&!before.task.archived&&before.task.version===copy.form.version,'업무 또는 권한이 변경됐습니다. 최신 내용을 비교해 주세요.');
  else requireValue(copy.form.version===0,'신규 업무 작성 기준을 확인해 주세요.');
  const stateToken=kind==='create'?null:taskWriteBaseline(before!,actorId);
  const body=kind==='status'?{status:copy.form.status,version:copy.form.version}:{...copy.form,
    goal:{id:copy.form.goalId??null},attachmentIds:copy.images.map(a=>a.id)};
  return {kind,id:before?.task.id,actorId,actorScope:scheduleActorScope(boot.me),before:before&&structuredClone(before),draft:copy,stateToken,body};
}
export function statusDraft(detail:Detail,status:Status):TaskSnapshot{
  const snapshot=taskSnapshot(detail);snapshot.form.status=status;return snapshot;
}
export function confirmTaskReceipt(value:unknown,write:TaskWrite,sent:unknown):TaskReceipt{
  const data=value as TaskReceipt;
  requireValue(data&&data.operation===write.kind&&data.actorId===write.actorId&&data.previousStateToken===write.stateToken&&token(data.stateToken)&&data.stateToken!==write.stateToken);
  requireValue(JSON.stringify(sent)===JSON.stringify(write.body));
  requireValue(data.task&&safeId(data.task.id)&&(write.kind==='create'||data.task.id===write.id)&&data.navigateTo===`/tasks/${data.task.id}`);
  taskDetailResponse({task:data.task,canEdit:false,comments:[],attachments:data.attachments,history:[]},data.task.id);
  requireValue(data.task.version===write.draft.form.version+1&&!data.task.archived);
  for(const [key] of taskFields){
    const expected=write.draft.form[key]??null,actual=data.task[key]??null;
    requireValue(actual===(key==='title'||key==='body'?trim(expected as string):expected));
  }
  if(write.before){
    requireValue(data.task.createdBy===write.before.task.createdBy&&sameStamp(data.task.createdAt,write.before.task.createdAt));
    requireValue(utcStamp(data.task.updatedAt)>=utcStamp(write.before.task.updatedAt));
  }else requireValue(String(data.task.createdBy)===write.actorId);
  const expectedImages=new Map(write.draft.images.map(a=>[a.id,a]));
  requireValue(data.attachments.length===expectedImages.size);
  for(const image of data.attachments){
    const expected=expectedImages.get(image.id);
    requireValue(expected&&image.taskId===data.task.id&&image.commentId===null&&safeId(image.ownerId)&&typeof image.createdAt==='string'&&Number.isFinite(Date.parse(image.createdAt)));
    for(const key of ['name','contentType','size'] as const)requireValue(image[key]===expected![key]);
    if(expected!.ownerId!==undefined)requireValue(image.ownerId===expected!.ownerId);
    if(expected!.createdAt!==undefined)requireValue(sameStamp(image.createdAt!,expected!.createdAt));
    if(expected!.taskId===null)requireValue(String(image.ownerId)===write.actorId);
  }
  return data;
}
