import {confirmReleaseSaved,currentRelease,releaseActorScope,releaseDraftSignature,releaseSnapshot,type ReleaseDraft} from './releaseReview';
import type {Bootstrap,ReleaseRecord} from './types';

export type ReleaseEditing={actorId:string;stateToken:string;record:ReleaseRecord|null};
export type ReleaseWriteKind='create'|'update'|'delete';
export type ReleaseWrite={kind:ReleaseWriteKind;actorId:string;actorScope:string;stateToken:string;before?:ReleaseRecord;draft:ReleaseDraft;body:ReleaseDraft|{version:number}};
export type ReleaseReceipt={operation:ReleaseWriteKind;actorId:string;previousStateToken:string;stateToken:string;release:ReleaseRecord;deleted:boolean};
const token=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const requireValue=(value:unknown,message='업데이트 버전 저장 확인 정보가 올바르지 않습니다.')=>{if(!value)throw Error(message);};

export function releaseEditingResponse(value:unknown,projectId:number,id?:number):ReleaseEditing{
  const editing=value as ReleaseEditing;
  requireValue(editing&&typeof editing.actorId==='string'&&token(editing.stateToken));
  if(id){const record=releaseSnapshot(editing.record);requireValue(record.id===id&&record.projectId===projectId);return{...editing,record};}
  requireValue(editing.record===null);return editing;
}

export function captureReleaseWrite(draft:ReleaseDraft,baseline:ReleaseDraft,boot:Bootstrap,editing:ReleaseEditing):ReleaseWrite{
  const kind:ReleaseWriteKind=draft.id?'update':'create',actorId=String(boot.me.id),before=kind==='update'?releaseSnapshot(baseline):undefined;
  requireValue(editing.actorId===actorId&&token(editing.stateToken));
  if(before){
    if(!editing.record||releaseDraftSignature(currentRelease(editing.record,before))!==releaseDraftSignature(before))throw Error('다른 사람이 업데이트 버전을 수정했습니다. 최신 내용과 초안을 비교해 주세요.');
  }
  else requireValue(editing.record===null);
  const captured=structuredClone(draft);
  return{kind,actorId,actorScope:releaseActorScope(boot),stateToken:editing.stateToken,before,draft:captured,body:structuredClone(captured)};
}

export function captureReleaseDelete(baseline:ReleaseDraft,boot:Bootstrap,editing:ReleaseEditing):ReleaseWrite{
  const before=releaseSnapshot(baseline),actorId=String(boot.me.id);
  requireValue(editing.actorId===actorId&&token(editing.stateToken));
  if(!editing.record||releaseDraftSignature(currentRelease(editing.record,before))!==releaseDraftSignature(before))throw Error('다른 사람이 업데이트 버전을 수정했습니다. 최신 내용을 다시 확인해 주세요.');
  return{kind:'delete',actorId,actorScope:releaseActorScope(boot),stateToken:editing.stateToken,before,draft:{...before},body:{version:before.version}};
}

export function confirmReleaseReceipt(value:unknown,write:ReleaseWrite,sent:unknown):ReleaseReceipt{
  const data=value as ReleaseReceipt;
  requireValue(data&&data.operation===write.kind&&data.actorId===write.actorId&&data.previousStateToken===write.stateToken&&token(data.stateToken)&&data.stateToken!==write.stateToken&&data.deleted===(write.kind==='delete'));
  requireValue(JSON.stringify(sent)===JSON.stringify(write.body));
  if(write.kind==='delete'){
    const release=releaseSnapshot(data.release),before=releaseSnapshot(write.before);
    requireValue(releaseDraftSignature(release)===releaseDraftSignature(before));
    return{...data,release};
  }
  const release=confirmReleaseSaved(data.release,write.draft,write.before,Number(write.actorId));
  requireValue(release.id===data.release.id&&releaseDraftSignature(release)===releaseDraftSignature(data.release));
  return{...data,release};
}
