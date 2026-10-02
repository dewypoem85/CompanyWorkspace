import {releaseName,releaseStatuses,type Bootstrap,type ReleaseRecord} from './types';
import type {ReviewItem,ReviewSelection} from './generated/workspace-review';

export type ReleaseDraft=Omit<ReleaseRecord,'id'|'createdBy'|'updatedAt'> & {id?:number};
export const releaseDraftSignature=(draft:ReleaseDraft)=>JSON.stringify([draft.id??null,draft.projectId,draft.baseVersion,draft.minor,draft.version,draft.releasedOn,draft.releasedOnUnknown??false,draft.notes,draft.status,draft.issue,draft.rollbackTargetId,draft.resolvedInId]);
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const versionNumber=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=99999;
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const link=(value:unknown)=>value===null||positive(value);
export const releaseActorScope=(boot:Bootstrap)=>JSON.stringify([boot.me.id,boot.me.role,boot.me.isAdmin,boot.me.active,boot.me.access,boot.me.shared,boot.me.departmentId,boot.leads.some(l=>l.employeeId===boot.me.id&&l.departmentId===boot.me.departmentId)]);
export function canManageRelease(boot:Bootstrap,projectId:number,existing=false) {
  return boot.me.active&&boot.me.access&&!boot.me.shared&&boot.projects.some(p=>p.id===projectId&&(existing||!p.archived))
    &&(boot.me.isAdmin||boot.leads.some(l=>l.employeeId===boot.me.id&&l.departmentId===boot.me.departmentId));
}
export function releaseValues(draft:ReleaseDraft):Record<string,string[]> {
  if(!positive(draft.projectId)||!versionNumber(draft.baseVersion)||!versionNumber(draft.minor)||!date(draft.releasedOn)
    ||typeof draft.notes!=='string'||typeof draft.issue!=='string'||!Object.hasOwn(releaseStatuses,draft.status)
    ||!link(draft.rollbackTargetId)||!link(draft.resolvedInId)||draft.releasedOnUnknown!==undefined&&typeof draft.releasedOnUnknown!=='boolean')throw Error('업데이트 버전 확인 정보가 올바르지 않습니다.');
  return {releasedOn:[draft.releasedOn,draft.releasedOnUnknown?'unknown':'known'],notes:[draft.notes],status:[draft.status],issue:[draft.issue],rollbackTargetId:[draft.rollbackTargetId===null?'':String(draft.rollbackTargetId)],resolvedInId:[draft.resolvedInId===null?'':String(draft.resolvedInId)]};
}
export function releaseSnapshot(value:unknown):ReleaseRecord {
  if(!value||typeof value!=='object')throw Error('업데이트 버전 응답이 없습니다.');
  const record=value as ReleaseRecord;releaseValues(record);
  if(!positive(record.id)||!positive(record.version)||!Number.isSafeInteger(record.createdBy)||record.createdBy<0
    ||typeof record.updatedAt!=='string'||!Number.isFinite(Date.parse(record.updatedAt))||record.sourceReference!==undefined&&typeof record.sourceReference!=='string')throw Error('업데이트 버전 식별자 또는 버전이 올바르지 않습니다.');
  return {...record};
}
export function currentRelease(value:unknown,before:ReleaseRecord) {
  const current=releaseSnapshot(value);
  if(current.id!==before.id||current.projectId!==before.projectId||current.baseVersion!==before.baseVersion||current.minor!==before.minor||current.createdBy!==before.createdBy
    ||current.version<before.version||(current.sourceReference||'')!==(before.sourceReference||''))throw Error('원래 업데이트 버전의 최신 응답이 아닙니다.');
  return current;
}
export function validateReleaseDraft(draft:ReleaseDraft,current?:ReleaseRecord,targets?:Map<number,ReleaseRecord>) {
  releaseValues(draft);
  if(current&&(draft.id!==current.id||draft.projectId!==current.projectId||draft.baseVersion!==current.baseVersion||draft.minor!==current.minor||draft.version!==current.version))throw Error('기존 기록의 식별자 또는 편집 기준 버전이 변경되었습니다.');
  if(!draft.notes.trim()||draft.notes.trim().length>20000||draft.issue.trim().length>10000||!['stable','unrecorded'].includes(draft.status)&&!draft.issue.trim())throw Error('패치 내용과 상태에 필요한 문제·조치 내용을 확인해 주세요.');
  if(draft.status==='skipped'&&draft.minor!==0)throw Error('버전 건너뜀은 기본 버전에만 적용할 수 있습니다.');
  if(draft.releasedOnUnknown&&current?.releasedOnUnknown!==true)throw Error('출시일 미기재 상태로 되돌릴 수 없습니다. 출시일을 선택해 주세요.');
  if(draft.status==='rolled_back'?!draft.rollbackTargetId:draft.rollbackTargetId!==null)throw Error('롤백 상태와 복귀 버전을 함께 확인해 주세요.');
  if(draft.resolvedInId&&!draft.issue.trim())throw Error('해결 마이너를 지정하려면 문제 내용을 남겨 주세요.');
  if(targets)for(const key of ['rollbackTargetId','resolvedInId'] as const){
    const id=draft[key];if(id===null)continue;
    const target=targets.get(id);
    if(!target||target.projectId!==draft.projectId||target.id===draft.id)throw Error('참조 버전을 현재 프로젝트에서 확인할 수 없습니다.');
    if(key==='rollbackTargetId'&&!(target.baseVersion<draft.baseVersion||target.baseVersion===draft.baseVersion&&target.minor<draft.minor))throw Error('복귀 버전은 같은 프로젝트의 더 낮은 버전이어야 합니다.');
    if(key==='resolvedInId'&&!(target.baseVersion===draft.baseVersion&&target.minor>draft.minor&&target.status==='stable'))throw Error('해결 버전은 같은 기본 버전의 더 높은 안정 마이너여야 합니다.');
  }
}
const fields=[['releasedOn','출시일'],['notes','패치 내용'],['status','버전 상태'],['issue','문제·조치 내용'],['rollbackTargetId','복귀 버전'],['resolvedInId','해결 마이너']] as const;
export function releaseReviewItem(before:ReleaseRecord,draft:ReleaseDraft,current:ReleaseRecord,targets:Map<number,ReleaseRecord>):ReviewItem {
  const values=[before,draft,current].map(releaseValues);
  return {id:String(before.id),label:`버전 ${releaseName(before)}`,fields:fields.map(([key,label])=>({key,label,before:values[0][key],draft:values[1][key],current:values[2][key],format:items=>key==='releasedOn'?items[1]==='unknown'?'출시일 미기재':items[0]:key==='status'?releaseStatuses[items[0] as keyof typeof releaseStatuses]:key.endsWith('Id')?items[0]?`${targets.has(Number(items[0]))?releaseName(targets.get(Number(items[0]))!):'확인 불가'} (#${items[0]})`:'미지정':items[0]||'—'}))};
}
export function applyReleaseReview(selection:ReviewSelection,before:ReleaseRecord,draft:ReleaseDraft,current:ReleaseRecord,targets:Map<number,ReleaseRecord>):ReleaseDraft {
  currentRelease(current,before);
  if(selection?.id!==String(before.id))throw Error('다른 업데이트 버전의 비교 결과입니다.');
  const candidates=[before,draft,current].map(releaseValues);
  for(const [key] of fields)if(!Array.isArray(selection.fields[key])||!candidates.some(v=>JSON.stringify(v[key])===JSON.stringify(selection.fields[key])))throw Error('검토하지 않은 버전 값입니다.');
  const chosen=selection.fields;
  const merged={...current,releasedOn:chosen.releasedOn[0],releasedOnUnknown:chosen.releasedOn[1]==='unknown',notes:chosen.notes[0],status:chosen.status[0] as ReleaseRecord['status'],issue:chosen.issue[0],rollbackTargetId:chosen.rollbackTargetId[0]?Number(chosen.rollbackTargetId[0]):null,resolvedInId:chosen.resolvedInId[0]?Number(chosen.resolvedInId[0]):null};
  validateReleaseDraft(merged,current,targets);return merged;
}
export function confirmReleaseSaved(value:unknown,submitted:ReleaseDraft,before:ReleaseRecord|undefined,actorId:number):ReleaseRecord {
  const result=releaseSnapshot(value);
  if(result.projectId!==submitted.projectId||result.baseVersion!==submitted.baseVersion||result.minor!==submitted.minor
    ||result.id!==(submitted.id||result.id)||result.version!==(before?submitted.version+1:1)||result.createdBy!==(before?.createdBy??actorId)
    ||(result.sourceReference||'')!==(before?.sourceReference||''))throw Error('저장된 업데이트 버전의 대상·버전이 일치하지 않습니다.');
  const normalized={...submitted,notes:submitted.notes.trim(),issue:submitted.issue.trim()};
  if(JSON.stringify(releaseValues(result))!==JSON.stringify(releaseValues(normalized)))throw Error('저장 확인 내용이 요청과 일치하지 않습니다.');
  return result;
}
