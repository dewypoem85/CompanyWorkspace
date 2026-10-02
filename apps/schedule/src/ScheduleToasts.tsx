import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {WorkspaceState,type WorkspaceStateProps} from './generated/workspace-state';
import './ScheduleToasts.css';

export type ScheduleNotice={id:string;state:WorkspaceStateProps};
type Publish=(id:string,state:WorkspaceStateProps|null,signature:string)=>void;
const ToastContext=createContext<Publish|null>(null);

export function ScheduleToastProvider({children}:{children:ReactNode}){
  const [entries,setEntries]=useState<Map<string,{state:WorkspaceStateProps;signature:string}>>(()=>new Map());
  const publish=useCallback<Publish>((id,state,signature)=>setEntries(previous=>{
    const current=previous.get(id);
    if(!state){if(!current)return previous;const next=new Map(previous);next.delete(id);return next;}
    if(current?.signature===signature)return previous;
    const next=new Map(previous);next.set(id,{state,signature});return next;
  }),[]);
  const notices=useMemo(()=>[...entries].map(([id,entry])=>({id,state:entry.state})),[entries]);
  return <ToastContext.Provider value={publish}>{children}<ScheduleToasts notices={notices}/></ToastContext.Provider>;
}

export function ScheduleToastNotice({id,state}:{id:string;state:WorkspaceStateProps|null|undefined}){
  const publish=useContext(ToastContext),action=useRef(state?.onAction);action.current=state?.onAction;
  const signature=JSON.stringify(state?[state.kind,state.title||'',state.message||'',state.actionLabel||'',!!state.onAction]:null);
  const invoke=useCallback(()=>action.current?.(),[]);
  useEffect(()=>{
    if(!publish)return;
    publish(id,state?{...state,onAction:state.onAction?invoke:undefined}:null,signature);
    return()=>publish(id,null,'');
  },[publish,id,signature,invoke]);
  if(publish||!state)return null;
  return <ScheduleToasts notices={[{id,state}]}/>;
}

function Toast({notice}:{notice:ScheduleNotice}){
  const [dismissed,setDismissed]=useState(false);
  useEffect(()=>{
    setDismissed(false);
    if(notice.state.kind!=='success')return;
    const timer=window.setTimeout(()=>setDismissed(true),5000);
    return()=>window.clearTimeout(timer);
  },[notice.state.kind,notice.state.title,notice.state.message]);
  if(dismissed)return null;
  return <div className="schedule-toast" data-schedule-toast={notice.id}>
    <WorkspaceState {...notice.state}/>
    <button type="button" className="cw-button schedule-toast-close" data-size="compact" data-layout="icon" aria-label="알림 닫기" onClick={()=>setDismissed(true)}>×</button>
  </div>;
}

export function ScheduleToasts({notices}:{notices:ScheduleNotice[]}){
  if(!notices.length)return null;
  return createPortal(<div className="schedule-toast-stack" aria-label="일정 알림">{notices.map(notice=><Toast key={notice.id} notice={notice}/>)}</div>,document.body);
}
