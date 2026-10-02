import {milestoneTypes,type Bootstrap,type Milestone,type MilestonePage,type MilestoneSchedule,type MilestoneType} from './types';

export type MilestoneDraft=Partial<Milestone>;
export type MilestoneWriteKind='create'|'update'|'delete';
export type MilestoneBody={type:MilestoneType;title:string;description:string;deadlineMemo:string;date:string;endDate:string|null;additionalSchedules:MilestoneSchedule[];projectId:number|null;version:number};
export type MilestoneWrite={kind:MilestoneWriteKind;actorId:string;actorScope:string;targetId?:number;before?:Milestone;draft:MilestoneBody;stateToken:string;body:MilestoneBody|{version:number}};
export type MilestoneReceipt={operation:MilestoneWriteKind;actorId:string;previousStateToken:string;stateToken:string;milestone:Milestone;deleted:boolean};
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const token=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
function requireValue(value:unknown,message='주요 일정 저장 정보가 올바르지 않습니다. 최신 내용을 다시 확인해 주세요.'){if(!value)throw Error(message);}
export const milestoneActorScope=(boot:Bootstrap)=>JSON.stringify([boot.me.id,boot.me.role,boot.me.active,boot.me.shared,boot.me.access,boot.me.isAdmin,boot.me.departmentId,boot.leads.some(x=>x.employeeId===boot.me.id&&x.departmentId===boot.me.departmentId)]);

export function milestoneSnapshot(value:unknown):Milestone{
  const row=structuredClone(value) as Milestone;
  requireValue(row&&positive(row.id)&&typeof row.title==='string'&&typeof row.description==='string'&&(row.deadlineMemo===undefined||typeof row.deadlineMemo==='string'&&row.deadlineMemo.length<=200)&&date(row.date)&&(!row.endDate||date(row.endDate)&&row.endDate>=row.date)&&(row.projectId===null||positive(row.projectId))&&positive(row.version)&&Object.hasOwn(milestoneTypes,row.type||'general')&&validSchedules(row.additionalSchedules));
  return row;
}
export function milestoneBody(value:MilestoneDraft):MilestoneBody{
  requireValue((!value.endDate||date(value.endDate)&&!!value.date&&value.endDate>=value.date)&&validSchedules(value.additionalSchedules));
  const body={type:value.type||'general',title:(value.title||'').trim(),description:(value.description||'').trim(),deadlineMemo:(value.deadlineMemo||'').trim(),date:value.endDate||value.date||'',endDate:null,additionalSchedules:(value.additionalSchedules||[]).map(item=>({type:item.type,date:item.endDate||item.date,endDate:null,memo:(item.memo||'').trim()})),projectId:value.projectId||null,version:value.version||0};
  requireValue(Object.hasOwn(milestoneTypes,body.type)&&body.title.trim().length>0&&body.title.trim().length<=200&&body.description.length<=10000&&body.deadlineMemo.length<=200&&date(body.date)&&validSchedules(body.additionalSchedules)&&(body.projectId===null||positive(body.projectId))&&Number.isSafeInteger(body.version)&&body.version>=0);
  return body;
}
function validSchedules(value:unknown):value is MilestoneSchedule[]{return value===undefined||Array.isArray(value)&&value.length<=20&&value.every(item=>item&&Object.hasOwn(milestoneTypes,item.type)&&date(item.date)&&(!item.endDate||date(item.endDate)&&item.endDate>=item.date)&&(item.memo===undefined||typeof item.memo==='string'&&item.memo.length<=200));}
export function milestoneWriteBaseline(page:MilestonePage,actorId:string,id?:number){
  requireValue(page.editing.actorId===actorId&&token(page.editing.createStateToken),'주요 일정 저장 기준이 없습니다. 최신 서버에서 다시 조회해 주세요.');
  if(id===undefined)return page.editing.createStateToken;
  const rows=page.editing.milestones.filter(row=>row.id===id);requireValue(rows.length===1&&token(rows[0].stateToken));return rows[0].stateToken;
}
export function captureMilestoneWrite(kind:MilestoneWriteKind,draft:MilestoneDraft,baseline:Milestone|undefined,boot:Bootstrap,page:MilestonePage):MilestoneWrite{
  const canWrite=boot.me.active&&boot.me.access&&!boot.me.shared;requireValue(canWrite,'현재 계정으로 주요 일정을 저장할 수 없습니다.');
  if(kind==='delete')requireValue(boot.me.isAdmin||boot.leads.some(x=>x.employeeId===boot.me.id&&x.departmentId===boot.me.departmentId),'현재 계정으로 주요 일정을 삭제할 수 없습니다.');
  const actorId=String(boot.me.id),body=milestoneBody(draft);
  if(kind==='create'){requireValue(!draft.id&&body.version===0);return{kind,actorId,actorScope:milestoneActorScope(boot),draft:body,stateToken:milestoneWriteBaseline(page,actorId),body};}
  const before=milestoneSnapshot(baseline);requireValue(draft.id===before.id&&body.version===before.version);
  return{kind,actorId,actorScope:milestoneActorScope(boot),targetId:before.id,before,draft:body,stateToken:milestoneWriteBaseline(page,actorId,before.id),body:kind==='delete'?{version:before.version}:body};
}
export function confirmMilestoneReceipt(value:unknown,write:MilestoneWrite,sent:unknown):MilestoneReceipt{
  const data=value as MilestoneReceipt;requireValue(data&&data.operation===write.kind&&data.actorId===write.actorId&&data.previousStateToken===write.stateToken&&token(data.stateToken)&&data.stateToken!==write.stateToken&&JSON.stringify(sent)===JSON.stringify(write.body));
  const saved=milestoneSnapshot(data.milestone);requireValue(data.deleted===(write.kind==='delete'));
  const matches=()=>saved.title===write.draft.title.trim()&&saved.description===write.draft.description&&(saved.deadlineMemo||'')===write.draft.deadlineMemo&&saved.date===write.draft.date&&(saved.endDate||null)===write.draft.endDate&&JSON.stringify(saved.additionalSchedules||[])===JSON.stringify(write.draft.additionalSchedules)&&saved.projectId===write.draft.projectId&&(saved.type||'general')===write.draft.type;
  if(write.kind==='create')requireValue(saved.version===1&&matches());
  else{requireValue(saved.id===write.targetId);if(write.kind==='update')requireValue(saved.version===write.draft.version+1&&matches());else requireValue(JSON.stringify(saved)===JSON.stringify(write.before));}
  return data;
}
