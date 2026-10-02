import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import {releaseSnapshot} from './releaseReview';
import {scheduleGet} from './scheduleReads';
import type {ReleaseRecord,LegacyReleaseRecord,ReleaseRevision} from './types';

export type ReleasePage<T>={items:T[];total:number};
export type ReleaseSeries={baseVersion:number;first:ReleaseRecord;latest:ReleaseRecord};
type Parser<T>=(value:unknown)=>ReleasePage<T>;
function page<T>(value:unknown,parse:(item:unknown)=>T,key:(item:T)=>number):ReleasePage<T> {
  const data=value as ReleasePage<unknown>;
  if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<data.items.length)throw Error('버전 목록 응답이 올바르지 않습니다.');
  const items=data.items.map(parse);
  if(new Set(items.map(key)).size!==items.length)throw Error('버전 목록에 중복된 기록이 있습니다.');
  return {items,total:data.total};
}
export const releaseSeriesPage=(value:unknown,projectId:number)=>page(value,item=>{
  const series=item as ReleaseSeries,first=releaseSnapshot(series?.first),latest=releaseSnapshot(series?.latest);
  if(first.projectId!==projectId||latest.projectId!==projectId||series.baseVersion!==first.baseVersion||latest.baseVersion!==first.baseVersion||first.minor!==0||latest.minor<first.minor)throw Error('현재 프로젝트의 기본 버전 목록이 아닙니다.');
  return {baseVersion:series.baseVersion,first,latest};
},item=>item.baseVersion);
export const releaseRecordsPage=(value:unknown,projectId:number,baseVersion:number)=>page(value,item=>{
  const record=releaseSnapshot(item);
  if(record.projectId!==projectId||record.baseVersion!==baseVersion)throw Error('현재 기본 버전의 마이너 목록이 아닙니다.');
  return record;
},item=>item.id);
export const releaseProjectPage=(value:unknown,projectId:number)=>page(value,item=>{
  const record=releaseSnapshot(item);
  if(record.projectId!==projectId)throw Error('현재 프로젝트의 참조 버전 목록이 아닙니다.');
  return record;
},item=>item.id);
export function releaseReferenceResponse(value:unknown,id:number,projectId:number){
  const record=releaseSnapshot(value);
  if(record.id!==id||record.projectId!==projectId)throw Error('참조 버전 응답이 일치하지 않습니다.');
  return record;
}
export const releaseRevisionPage=(value:unknown,record:Pick<ReleaseRecord,'id'|'projectId'>)=>page(value,item=>{
  const revision=structuredClone(item) as ReleaseRevision;
  if(!Number.isSafeInteger(revision?.id)||revision.id<1||revision.releaseId!==record.id||!Number.isSafeInteger(revision.actorId)||revision.actorId<0
    ||typeof revision.createdAt!=='string'||!Number.isFinite(Date.parse(revision.createdAt))||typeof revision.snapshot!=='string')throw Error('변경 이력 확인 정보가 일치하지 않습니다.');
  let snapshot:ReleaseRecord;try{snapshot=releaseSnapshot(JSON.parse(revision.snapshot));}catch{throw Error('변경 이력을 해석하지 못했습니다. 다시 조회해 주세요.');}
  if(snapshot.id!==record.id||snapshot.projectId!==record.projectId)throw Error('변경 이력 확인 정보가 일치하지 않습니다.');
  return revision;
},item=>item.id);
export const legacyReleasePage=(value:unknown,projectId:number)=>page(value,item=>{
  const record=item as LegacyReleaseRecord;
  if(!record||!Number.isSafeInteger(record.id)||record.id<1||record.projectId!==projectId||typeof record.notes!=='string'||typeof record.issue!=='string'||typeof record.sourceReference!=='string'
    ||record.releasedOn!==null&&(typeof record.releasedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.releasedOn)||!Number.isFinite(Date.parse(record.releasedOn))))throw Error('버전 미기재 기록 응답이 올바르지 않습니다.');
  return {...record};
},item=>item.id);

// Read-only pagination. An initial failure is not an empty result; refresh failures retain confirmed rows.
export function useReleaseList<T>(url:string,scope:string,parse:Parser<T>,key:(item:T)=>number,enabled=true) {
  const [data,setData]=useState<ReleasePage<T>>({items:[],total:0}),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [error,setError]=useState(''),[denied,setDenied]=useState(false);
  const generation=useRef(0),active=useRef(true),reading=useRef(false),session=useRef<WorkspaceReadSession|undefined>(undefined),live=useRef({data,parse,key});live.current={data,parse,key};
  const load=useCallback(async(more=false,requireSuccess=false)=>{
    if(!url||more&&reading.current)return;
    const current=++generation.current,previous=live.current.data,parser=live.current.parse,identity=live.current.key;
    reading.current=true;setBusy(true);setError('');setDenied(false);
    try {
      const reader=session.current;if(!reader)throw Error('공통 버전 조회 도구를 사용할 수 없습니다. 페이지를 다시 열어 주세요.');
      const result=await reader.run('release-list',signal=>scheduleGet(`${url}&skip=${more?previous.items.length:0}`,signal,parser));
      if(result.status==='cancelled'||!result.isCurrent()){if(requireSuccess)throw Error('버전 목록 조회가 취소되었습니다.');return;}
      if(result.status==='error')throw result.error;
      const next=result.value;
      if(active.current&&current===generation.current){
        const merged=more?{...next,items:[...new Map([...previous.items,...next.items].map(item=>[identity(item),item])).values()]}:next;
        live.current.data=merged;setData(merged);setLoaded(true);
      }
    } catch(cause) {
      if(active.current&&current===generation.current){
        const forbidden=cause instanceof ApiError&&[401,403].includes(cause.status);
        setError(cause instanceof SyntaxError?'버전 목록을 해석하지 못했습니다. 다시 조회해 주세요.':(cause as Error).message);setDenied(forbidden);
        if(forbidden){live.current.data={items:[],total:0};setData(live.current.data);setLoaded(false);}
      }
      if(requireSuccess)throw cause;
    } finally {if(active.current&&current===generation.current){reading.current=false;setBusy(false);}}
  },[url,scope]);
  useEffect(()=>{active.current=true;try{session.current=createWorkspaceReadSession();}catch(cause){setError((cause as Error).message);}return()=>{active.current=false;generation.current++;session.current?.dispose();};},[]);
  useEffect(()=>{
    generation.current++;reading.current=false;session.current?.cancel('release-list');setBusy(false);
    const empty={items:[] as T[],total:0};live.current.data=empty;setData(empty);setLoaded(false);setError('');setDenied(false);
    if(enabled&&url)void load();
    return()=>{generation.current++;reading.current=false;};
  },[load,enabled]);
  useEffect(()=>{
    const invalidate=()=>{generation.current++;reading.current=false;session.current?.cancel('release-list');live.current.data={items:[],total:0};setData(live.current.data);setBusy(false);setLoaded(false);setDenied(true);setError('로그인·권한이 변경되었습니다. 현재 계정으로 목록을 다시 확인해 주세요.');};
    document.addEventListener('workspace-entity-scope-change',invalidate);
    return()=>document.removeEventListener('workspace-entity-scope-change',invalidate);
  },[]);
  return {page:data,busy,loaded,error,denied,load};
}
