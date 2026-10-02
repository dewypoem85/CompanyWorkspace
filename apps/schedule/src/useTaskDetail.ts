import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {assertCurrentTaskDetail,scheduleActorScope,scheduleGet,taskDetailResponse} from './scheduleReads';
import type {Bootstrap,Detail} from './types';

type Options={id?:number;boot:Bootstrap;refreshIdentity:()=>Promise<Bootstrap>;pollPaused:()=>boolean};
export function useTaskDetail(options:Options){
  const live=useRef(options);live.current=options;
  const [detail,setDetail]=useState<Detail>(),[loading,setLoading]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null),[invalid,setInvalid]=useState(false);
  const owner=useRef(scheduleActorScope(options.boot.me)),snapshot=useRef<Detail|undefined>(undefined),mounted=useRef(false),closed=useRef(false),revoked=useRef(false),failed=useRef(false),epoch=useRef(0);
  const session=useRef<WorkspaceReadSession|undefined>(undefined),pending=useRef<object|null>(null);
  const invalidate=useCallback(()=>{
    epoch.current++;revoked.current=true;pending.current=null;session.current?.cancel('detail');
    if(mounted.current){setLoading(false);setInvalid(true);setOutcome({kind:'denied',title:'업무 조회의 로그인·권한을 다시 확인해 주세요.',message:'이전 조회 내용과 작성 중인 초안은 보관했습니다. 자동 갱신을 중지했으며 현재 계정으로 다시 확인해야 합니다.'});}
  },[]);
  const applyDetail=useCallback((value:Detail)=>{
    if(!mounted.current||closed.current||revoked.current||scheduleActorScope(live.current.boot.me)!==owner.current||value.task.id!==live.current.id)return;
    const next=taskDetailResponse(value,live.current.id!);assertCurrentTaskDetail(snapshot.current,next);
    // An explicit action/review result supersedes an in-flight background read.
    session.current?.cancel('detail');pending.current=null;setLoading(false);snapshot.current=next;setDetail(next);
  },[]);
  const refresh=useCallback(async(background=false):Promise<Detail|undefined>=>{
    const start=live.current,id=start.id;
    if(!id)return;
    if(!mounted.current||closed.current||!session.current)throw Error('업무 조회 화면을 다시 열어 주세요.');
    if(background&&(pending.current||failed.current||revoked.current||start.pollPaused()))return;
    if(scheduleActorScope(start.boot.me)!==owner.current){invalidate();throw new ApiError(403,'이 화면을 열었던 계정·권한과 다릅니다. 페이지를 다시 열어 주세요.');}
    const generation=epoch.current,ticket={};pending.current=ticket;setLoading(true);
    if(!background)setOutcome(null);
    const current=()=>mounted.current&&!closed.current&&epoch.current===generation&&live.current.id===id&&scheduleActorScope(live.current.boot.me)===owner.current;
    const result=await session.current.run('detail',async signal=>{
      if(revoked.current){
        const directory=await start.refreshIdentity();signal.throwIfAborted();
        if(scheduleActorScope(directory.me)!==owner.current)throw new ApiError(403,'이 화면을 열었던 계정·권한과 다릅니다. 페이지를 다시 열어 주세요.');
      }
      return scheduleGet(`/api/tasks/${id}`,signal,v=>taskDetailResponse(v,id));
    });
    if(pending.current===ticket){pending.current=null;if(mounted.current)setLoading(false);}
    if(result.status==='cancelled'||!result.isCurrent()||!current())throw Error('업무 조회 중 대상 또는 로그인 상태가 변경되었습니다.');
    try{
      if(result.status==='error')throw result.error;
      assertCurrentTaskDetail(snapshot.current,result.value);
      revoked.current=false;failed.current=false;setInvalid(false);setOutcome(null);snapshot.current=result.value;setDetail(result.value);return result.value;
    }catch(error){
      failed.current=true;
      if(error instanceof ApiError&&[401,403].includes(error.status))invalidate();
      else setOutcome({kind:'error',title:'업무 상세를 불러오지 못했습니다.',message:error instanceof Error?error.message:'다시 조회해 주세요. 마지막 정상 내용과 초안은 유지됩니다.'});
      throw error;
    }
  },[invalidate]);
  useEffect(()=>{
    mounted.current=true;closed.current=false;
    try{session.current=createWorkspaceReadSession();}catch(error){setOutcome({kind:'error',message:(error as Error).message});}
    const hide=()=>{closed.current=true;invalidate();session.current?.dispose();};
    document.addEventListener('workspace-entity-scope-change',invalidate);window.addEventListener('pagehide',hide);
    return()=>{mounted.current=false;closed.current=true;epoch.current++;pending.current=null;session.current?.dispose();document.removeEventListener('workspace-entity-scope-change',invalidate);window.removeEventListener('pagehide',hide);};
  },[invalidate]);
  const scope=scheduleActorScope(options.boot.me);
  useEffect(()=>{if(scope!==owner.current)invalidate();},[scope,invalidate]);
  useEffect(()=>{
    snapshot.current=undefined;setDetail(undefined);failed.current=false;
    void refresh().catch(()=>{});
    const timer=setInterval(()=>void refresh(true).catch(()=>{}),30000);
    return()=>{epoch.current++;clearInterval(timer);session.current?.cancel('detail');};
  },[options.id,refresh]);
  return {detail,loading,outcome,invalid,refresh,applyDetail};
}
