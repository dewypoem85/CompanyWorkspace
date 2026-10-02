import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError} from './api';
import {createWorkspaceReadSession,type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {bootstrapResponse,emptyBoard,readScheduleBoard,scheduleActorScope,scheduleGet,type BoardQuery} from './scheduleReads';
import type {Bootstrap} from './types';
import type {WeekData} from './timelineData';

export function useScheduleData(query:BoardQuery,enabled:boolean){
  const [boot,setBoot]=useState<Bootstrap>(),[identityError,setIdentityError]=useState<WorkspaceStateProps|null>(null);
  const [data,setData]=useState<WeekData>(emptyBoard),[readyKey,setReadyKey]=useState(''),[loading,setLoading]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null),[invalid,setInvalid]=useState(false);
  const key=JSON.stringify(query),live=useRef({query,key,enabled});live.current={query,key,enabled};
  const mounted=useRef(false),denied=useRef(false),identity=useRef<Bootstrap|undefined>(undefined),session=useRef<WorkspaceReadSession|undefined>(undefined),cache=useRef(new Map<string,WeekData>()),identityPending=useRef<Promise<Bootstrap>|null>(null);
  const scopeEpoch=useRef(0),verifiedEpoch=useRef(-1),boardPending=useRef<object|null>(null),boardFailed=useRef(false);
  const invalidate=useCallback(()=>{
    scopeEpoch.current++;verifiedEpoch.current=-1;boardPending.current=null;
    denied.current=true;session.current?.cancel('board');session.current?.cancel('bootstrap');identityPending.current=null;cache.current.clear();
    if(mounted.current){setInvalid(true);setLoading(false);setData(emptyBoard());setReadyKey('');setOutcome(null);setIdentityError({kind:'denied',title:'로그인·권한이 변경되었습니다.',message:'이전 일정 목록을 숨겼습니다. 페이지를 다시 열어 현재 계정을 확인해 주세요.'});}
  },[]);
  const bootstrap=useCallback((manual=true):Promise<Bootstrap>=>{
    if(!mounted.current||!session.current||denied.current&&!manual)return Promise.reject(Error('현재 페이지에서 회사 정보를 조회할 수 없습니다.'));
    if(identityPending.current)return identityPending.current;
    const expected=identity.current?scheduleActorScope(identity.current.me):null;
    const pending=(async()=>{
      const result=await session.current!.run('bootstrap',signal=>scheduleGet('/api/bootstrap',signal,bootstrapResponse));
      if(result.status==='cancelled'||!result.isCurrent())throw Error('회사 정보 조회가 취소되었습니다.');
      if(result.status==='error'){
        if(result.error instanceof ApiError&&[401,403].includes(result.error.status)){invalidate();document.dispatchEvent(new Event('workspace-entity-scope-change'));}
        else if(!denied.current)setIdentityError({kind:'error',title:'회사 정보를 불러오지 못했습니다.',message:'기존 화면은 유지됩니다. 회사 정보만 다시 확인해 주세요.'});
        throw result.error;
      }
      const next=result.value;
      if(expected!==null&&scheduleActorScope(next.me)!==expected){
        invalidate();document.dispatchEvent(new Event('workspace-entity-scope-change'));
        // Revoke retained editor capabilities without replacing its owner/key or discarding drafts.
        setBoot(previous=>previous?{...previous,me:{...previous.me,active:false,access:false,isAdmin:false},leads:[]}:previous);
        throw new ApiError(403,'회사 계정 또는 권한이 변경되었습니다.');
      }
      // Existing editors may explicitly re-check the same identity after a scope event;
      // this must not restore the invalidated board or silently replace their drafts.
      if(manual)verifiedEpoch.current=scopeEpoch.current;
      if(!denied.current){
        setIdentityError(null);
        if(!identity.current||JSON.stringify({...identity.current,csrfToken:''})!==JSON.stringify({...next,csrfToken:''})){
          cache.current.clear();session.current?.cancel('board');setData(emptyBoard());setReadyKey('');identity.current=next;setBoot(next);
        }
      }
      return next;
    })();
    identityPending.current=pending;
    void pending.finally(()=>{if(identityPending.current===pending)identityPending.current=null;}).catch(()=>{});
    return pending;
  },[invalidate]);
  const refresh=useCallback(async(force=true,requireSuccess=false)=>{
    const start=live.current;
    const epoch=scopeEpoch.current,verifyOnly=denied.current&&requireSuccess&&verifiedEpoch.current===epoch;
    if(!mounted.current||!session.current||!identity.current||denied.current&&!verifyOnly||!start.enabled){if(requireSuccess)throw Error('현재 일정 목록을 갱신할 수 없습니다.');return;}
    const ticket={};boardPending.current=ticket;boardFailed.current=false;
    if(!verifyOnly){setLoading(true);setOutcome(null);}
    const result=await session.current.run('board',signal=>readScheduleBoard(start.query,cache.current,force,signal));
    if(boardPending.current===ticket)boardPending.current=null;
    if(result.status==='cancelled'||!result.isCurrent()||live.current.key!==start.key||!live.current.enabled||scopeEpoch.current!==epoch){if(requireSuccess)throw Error('일정 조회 조건이 변경되었습니다.');return;}
    if(!verifyOnly)setLoading(false);
    if(result.status==='error'){
      boardFailed.current=true;
      if(result.error instanceof ApiError&&[401,403].includes(result.error.status)){invalidate();document.dispatchEvent(new Event('workspace-entity-scope-change'));}
      else if(!verifyOnly)setOutcome({kind:'error',title:'일정을 불러오지 못했습니다.',message:result.error instanceof Error?result.error.message:'조회에 실패했습니다. 다시 시도해 주세요.'});
      if(requireSuccess)throw result.error;return;
    }
    if(!verifyOnly){cache.current=result.value.cache;setData(result.value);setReadyKey(start.key);}
  },[invalidate]);
  useEffect(()=>{
    mounted.current=true;
    try{session.current=createWorkspaceReadSession();}catch{setIdentityError({kind:'error',title:'공통 조회 도구를 불러오지 못했습니다.',message:'페이지를 다시 열어 주세요.'});}
    void bootstrap(false).catch(()=>{});
    const focus=()=>{if(!denied.current)void bootstrap(false).catch(()=>{});},pagehide=()=>invalidate();
    const timer=setInterval(focus,60000);window.addEventListener('focus',focus);window.addEventListener('pagehide',pagehide);document.addEventListener('workspace-entity-scope-change',invalidate);
    return()=>{mounted.current=false;session.current?.dispose();identityPending.current=null;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('pagehide',pagehide);document.removeEventListener('workspace-entity-scope-change',invalidate);};
  },[bootstrap,invalidate]);
  useEffect(()=>{
    if(!boot||!enabled||denied.current){setLoading(false);return;}
    void refresh(false);const timer=setInterval(()=>{if(!boardPending.current&&!boardFailed.current)void refresh();},30000);
    return()=>{clearInterval(timer);session.current?.cancel('board');};
  },[boot,key,enabled,refresh]);
  return {boot,bootstrap,refresh,invalidate,invalid,identityError,outcome,loading,ready:readyKey===key,data:readyKey===key?data:emptyBoard()};
}
