import {useEffect,useRef,useState} from 'react';
import {createWorkspaceWriteTransport,workspaceDocumentFormSession,type WorkspaceFormSession,type WorkspaceWriteTransport} from './generated/workspace-form';
import type {WorkspaceStateProps} from './generated/workspace-state';
import type {Bootstrap} from './types';

export function usePlanningWrites(boot:Bootstrap,changed:()=>Promise<void>) {
  const [busy,setBusy]=useState(false),[outcome,setOutcome]=useState<WorkspaceStateProps|null>(null);
  const transport=useRef<WorkspaceWriteTransport|undefined>(undefined),session=useRef<WorkspaceFormSession|undefined>(undefined),expected=useRef(''),receipt=useRef(false),mounted=useRef(false),owner=useRef(`schedule-planning-${Date.now()}-${Math.random()}`),sequence=useRef(0);
  useEffect(()=>{
    mounted.current=true;
    let untrack:(()=>void)|undefined;
    try {
      const forms=workspaceDocumentFormSession('schedule-planning-writes');session.current=forms;untrack=forms.track(owner.current,()=>false);
      transport.current=createWorkspaceWriteTransport({onState:setOutcome,isConnected:()=>mounted.current,onSaved:(data,_sent,context)=>{
        const value=data as {operation?:unknown;value?:unknown};
        if(!context.isCurrent()||value?.operation!==expected.current||!value.value||typeof value.value!=='object')throw Error('저장 응답을 확인하지 못했습니다.');
        receipt.current=true;
      }});
    } catch(error) { setOutcome({kind:'error',message:(error as Error).message}); }
    return()=>{mounted.current=false;transport.current?.dispose();untrack?.();session.current=undefined;};
  },[]);
  async function run(operation:string,url:string,method:'POST'|'PUT'|'PATCH'|'DELETE',json:unknown) {
    const forms=session.current;
    if(busy||!transport.current||!forms)return false;
    // The document session survives panel unmounts. Include this hook owner's
    // identity so reopening the goal panel never reuses a spent create key.
    const lease=forms.begin(owner.current,[`${owner.current}:${operation}:${url}:${++sequence.current}`]);
    if(!lease){setOutcome({kind:'error',title:'최신 내용을 다시 확인해 주세요.',message:'이미 처리했거나 확인이 필요한 변경입니다.'});return false;}
    expected.current=operation;receipt.current=false;setBusy(true);let finished=false;
    try {
      if(!lease.markSent())return false;
      const result=await transport.current.send({url,method,json,signal:lease.signal,headers:{'X-CSRF-TOKEN':boot.csrfToken,'X-Workspace-Actor':String(boot.me.id)}});
      if(result.saved&&receipt.current){lease.finish('saved');finished=true;await changed();return true;}
      lease.finish(result.outcome==='invalid'?'invalid':result.outcome==='conflict'?'conflict':result.outcome==='not-sent'?'cancelled':'unknown');finished=true;return false;
    } finally {if(!finished)lease.finish('unknown');if(mounted.current)setBusy(false);}
  }
  return {busy,outcome,clear:()=>setOutcome(null),run};
}
