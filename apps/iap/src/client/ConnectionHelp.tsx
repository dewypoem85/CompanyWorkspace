import React,{useRef,type ReactNode} from 'react';
import {useWorkspaceDisclosure} from './generated/workspace-disclosure';

// The common disclosure owns visibility and ARIA; this adapter adds help triggers.
export function ConnectionHelp({id,label,summary,children}:{id:string;label:string;summary:string;children:ReactNode}){
  const root=useRef<HTMLDivElement>(null),pinned=useRef(false),focused=useRef(false);
  const disclosure=useWorkspaceDisclosure(root);
  return <div ref={root} onPointerLeave={()=>{if(!pinned.current&&!focused.current)disclosure.setOpen('help',false);}}
    onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();pinned.current=false;disclosure.setOpen('help',false);}}}>
    <div className="connection-field-heading"><label htmlFor={id}>{label}</label>
      <button type="button" className="cw-button" data-variant="quiet" data-size="compact" data-cw-disclosure="help"
        aria-label={`${label} 입력 도움말`} title={summary} disabled={!disclosure.ready}
        onPointerEnter={event=>{if(event.pointerType==='mouse')disclosure.setOpen('help',true);}}
        onFocus={()=>{focused.current=true;disclosure.setOpen('help',true);}}
        onBlur={()=>{focused.current=false;if(!pinned.current)disclosure.setOpen('help',false);}}
        onClick={event=>{event.stopPropagation();pinned.current=!pinned.current;disclosure.setOpen('help',pinned.current);}}>?</button>
    </div>
    <div id={`${id}-help`} data-cw-disclosure-panel="help" hidden>
      <section className="cw-callout" data-tone="info" role="note"><strong>{label} 입력 방법</strong><p>{children}</p></section>
    </div>
  </div>;
}
