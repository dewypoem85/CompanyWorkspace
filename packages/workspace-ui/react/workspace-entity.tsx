import { useEffect, useRef } from 'react';

export type WorkspaceEntityProps = {
  kind: 'employee' | 'project';
  id?: string | number | null;
  name?: string;
  className?: string;
};

// The DOM adapter owns the image, current profile revision and broken-image fallback.
export function WorkspaceEntity({kind,id,name='',className=''}:WorkspaceEntityProps){
  const node=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const runtime=(window as unknown as {CompanyEntityDisplay?:{scan:()=>void}}).CompanyEntityDisplay;
    if(runtime)runtime.scan();
    else if(node.current)node.current.textContent=Array.from(name.trim())[0]||(kind==='project'?'P':'?');
  },[kind,id,name]);
  return <span ref={node} className={['cw-entity-avatar',className].filter(Boolean).join(' ')} data-workspace-entity={kind}
    data-workspace-entity-id={id??undefined} data-workspace-entity-name={name}
    aria-label={name ? `${name} ${kind==='employee'?'프로필':'프로젝트 아이콘'}` : undefined}
    aria-hidden={name ? undefined : true} />;
}
