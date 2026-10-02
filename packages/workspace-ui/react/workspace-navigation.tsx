import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkspacePage = { view: string; path: string; title: string; aliases?: readonly string[] };
type NavigationSource = 'history' | 'navigation';
const beforeRouteChange = 'company-before-route-change';
type NavigationRequest = {source: NavigationSource; from: string; to: string; signal: AbortSignal};
type Permit = () => boolean;
type RequestGuard = {request: (context: NavigationRequest) => Promise<Permit | null>; cancel: Set<() => void>};
const requestGuards = new Set<RequestGuard>();
export function useWorkspaceNavigationRequest(request: RequestGuard['request']) {
  const latest=useRef(request);latest.current=request;
  useEffect(()=>{
    const guard:RequestGuard={request:context=>latest.current(context),cancel:new Set()};requestGuards.add(guard);
    return()=>{requestGuards.delete(guard);for(const cancel of guard.cancel)cancel();};
  },[]);
}
export function useWorkspaceNavigationGuard(canLeave: () => boolean, source: NavigationSource = 'history') {
  useEffect(() => {
    const guard = (event: Event) => {
      if ((event as CustomEvent<{ source: NavigationSource }>).detail.source !== source) return;
      try { if(canLeave() !== true)event.preventDefault(); } catch { event.preventDefault(); }
    };
    document.addEventListener(beforeRouteChange, guard);
    return () => document.removeEventListener(beforeRouteChange, guard);
  }, [canLeave, source]);
}
export function matchesWorkspacePath(pattern: string, path: string) {
  const expected=pattern.split('/'), actual=path.split('/');
  const named=(value:string)=>/^[a-zA-Z0-9_.-]{1,128}$/.test(value)&&value!=='.'&&value!=='..';
  return expected.length===actual.length && expected.every((part,index)=>part.startsWith(':')?(part===':id'?/^[1-9]\d*$/.test(actual[index]):named(actual[index])):part===actual[index]);
}
export function workspacePathParams(pattern:string,path:string){const expected=pattern.split('/'),actual=path.split('/');if(!matchesWorkspacePath(pattern,path))return null;return Object.fromEntries(expected.flatMap((part,index)=>part.startsWith(':')?[[part.slice(1),decodeURIComponent(actual[index])]]:[]));}
export function useWorkspacePage<const T extends readonly WorkspacePage[]>(pages: T) {
  type View = T[number]['view'];
  const currentPath=()=>location.pathname+location.search+location.hash;
  const [path, setPath] = useState(currentPath);
  const acceptedPath = useRef(path);
  const historyKey='__companyWorkspaceRoute';
  type Position={owner:string;index:number};
  const position=(state:unknown):Position|null=>{
    if(!state||typeof state!=='object')return null;
    const value=(state as Record<string,unknown>)[historyKey] as Position|undefined;
    return value&&typeof value.owner==='string'&&Number.isSafeInteger(value.index)&&value.index>=0?value:null;
  };
  const historyOwner=useRef(position(history.state)?.owner||crypto.randomUUID());
  const acceptedIndex=useRef(position(history.state)?.index||0);
  const currentIndex=()=>{const value=position(history.state);return value?.owner===historyOwner.current?value.index:null;};
  type Transition={abort:AbortController;from:string;index:number;to:string;target:number|null;mode:'navigation'|'restore'|'review'|'replay';permit?:Permit};
  const pending=useRef<Transition|null>(null);
  const cancelPending=useCallback(()=>{
    const transition=pending.current;transition?.abort.abort();
    if(transition&&['navigation','review'].includes(transition.mode))pending.current=null;
  },[]);
  const dispatchSync=(source:NavigationSource,from:string,to:string)=>document.dispatchEvent(new CustomEvent(beforeRouteChange,{cancelable:true,detail:{source,from,to}}));
  async function permission(transition:Transition,source:NavigationSource):Promise<Permit|null>{
    if(!dispatchSync(source,transition.from,transition.to))return null;
    const guards=[...requestGuards],permits:Permit[]=[],abort=()=>transition.abort.abort();
    const valid=()=>!transition.abort.signal.aborted&&guards.every(guard=>requestGuards.has(guard));
    let stop:()=>void=()=>{};
    const cancelled=new Promise<null>(resolve=>{stop=()=>resolve(null);transition.abort.signal.addEventListener('abort',stop,{once:true});});
    for(const guard of guards)guard.cancel.add(abort);
    try{
      for(const guard of guards){
        if(!valid())return null;
        const approve=await Promise.race([guard.request({source,from:transition.from,to:transition.to,signal:transition.abort.signal}),cancelled]);
        if(typeof approve!=='function'||!valid())return null;permits.push(approve);
      }
      return()=>valid()&&permits.every(approve=>approve()===true);
    }catch{return null;}
    finally{for(const guard of guards)guard.cancel.delete(abort);transition.abort.signal.removeEventListener('abort',stop);}
  }
  function applyPath(target:string){acceptedPath.current=target;acceptedIndex.current=currentIndex()??acceptedIndex.current;setPath(target);document.dispatchEvent(new CustomEvent('company-route-change'));}
  const pathname=new URL(path,location.origin).pathname;
  const page:WorkspacePage=pages.find(item=>[item.path,...(item.aliases||[])].some(pattern=>matchesWorkspacePath(pattern,pathname)))||pages[0];
  const navigate = useCallback(async(view: View, parameters?: number|Record<string,string|number>, hash = '') => {
    const next = pages.find(item => item.view === view);
    if (!next) throw new Error(`Unregistered workspace view: ${view}`);
    const values=typeof parameters==='number'?{id:parameters}:parameters??{};
    if(hash && !/^#[a-zA-Z0-9_-]+$/.test(hash))throw new Error('Invalid workspace fragment');
    const target=next.path.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g,(_,key:string)=>{const value=values[key];if(key==='id'&&(!Number.isSafeInteger(value)||Number(value)<1))throw new Error('A positive integer ID is required');const text=String(value??'');if(key!=='id'&&(!/^[a-zA-Z0-9_.-]{1,128}$/.test(text)||text==='.'||text==='..'))throw new Error(`Invalid workspace route parameter: ${key}`);return encodeURIComponent(text);})+hash;
    if(pending.current)return false;
    if(currentPath()===target){applyPath(target);return true;}
    const transition:Transition={abort:new AbortController(),from:acceptedPath.current,index:acceptedIndex.current,to:target,target:null,mode:'navigation'};pending.current=transition;
    try{
      const approve=await permission(transition,'navigation');
      if(pending.current!==transition||currentPath()!==transition.from||acceptedPath.current!==transition.from||!approve?.())return false;
      history.pushState({},'',target);applyPath(target);return true;
    }catch{return false;}
    finally{if(pending.current===transition)pending.current=null;transition.abort.abort();}
  }, [pages]);
  useEffect(() => {
    const originalPush=history.pushState,originalReplace=history.replaceState;
    const tagged=(state:unknown,index:number)=>state===null||state===undefined||typeof state==='object'&&!Array.isArray(state)
      ? {...state as object,[historyKey]:{owner:historyOwner.current,index}} : state;
    originalReplace.call(history,tagged(history.state,acceptedIndex.current),'');
    history.pushState=function(state,unused,url){
      const index=(currentIndex()??acceptedIndex.current)+1;
      originalPush.call(history,tagged(state,index),unused,url);
      if(currentPath()===acceptedPath.current)acceptedIndex.current=index;
    };
    history.replaceState=function(state,unused,url){originalReplace.call(history,tagged(state,currentIndex()??acceptedIndex.current),unused,url);};
    const installedPush=history.pushState,installedReplace=history.replaceState;
    const current=(transition:Transition)=>pending.current===transition&&!transition.abort.signal.aborted&&acceptedPath.current===transition.from&&acceptedIndex.current===transition.index;
    const settled=()=>document.dispatchEvent(new CustomEvent('company-route-change'));
    function restore(transition:Transition){
      transition.mode='restore';pending.current=transition;
      const index=currentIndex();
      if(index!==null&&index!==transition.index){history.go(transition.index-index);return;}
      // Non-router history states keep their original value/type. Retain the
      // legacy recovery for entries with no positional metadata.
      if(currentPath()!==transition.from)history.pushState({},'',transition.from);
      if(transition.abort.signal.aborted){pending.current=null;settled();}else void review(transition);
    }
    async function review(transition:Transition){
      if(!current(transition)){if(pending.current===transition)pending.current=null;return;}
      transition.mode='review';settled();
      const approve=await permission(transition,'history');
      try{
        if(!current(transition)||currentPath()!==transition.from||!approve?.()){if(pending.current===transition)pending.current=null;transition.abort.abort();return;}
        transition.permit=approve;transition.mode='replay';
        if(transition.target!==null&&transition.target!==transition.index)history.go(transition.target-transition.index);
        else{history.pushState({},'',transition.to);applyPath(transition.to);pending.current=null;transition.abort.abort();}
      }catch{if(pending.current===transition)pending.current=null;transition.abort.abort();}
    }
    const onPopState = () => {
      const target=currentPath(),index=currentIndex(),active=pending.current;
      if(active?.mode==='restore'&&target===active.from&&index===active.index){
        if(active.abort.signal.aborted){pending.current=null;settled();}else void review(active);return;
      }
      if(active?.mode==='replay'&&target===active.to&&index===active.target){
        try{if(current(active)&&active.permit?.()){applyPath(target);pending.current=null;active.abort.abort();return;}}catch{ /* Revalidation fails closed. */ }
        active.abort.abort();restore(active);return;
      }
      if(active){active.abort.abort();const rollback:Transition={...active,abort:new AbortController(),to:target,target:index,mode:'restore'};rollback.abort.abort();restore(rollback);return;}
      if(!requestGuards.size){
        if(dispatchSync('history',acceptedPath.current,target)){applyPath(target);return;}
        const rollback:Transition={abort:new AbortController(),from:acceptedPath.current,index:acceptedIndex.current,to:target,target:index,mode:'restore'};rollback.abort.abort();restore(rollback);return;
      }
      restore({abort:new AbortController(),from:acceptedPath.current,index:acceptedIndex.current,to:target,target:index,mode:'restore'});
    };
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-workspace-page][data-route-link]') : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href, location.href);
      const next = pages.find(item => matchesWorkspacePath(item.path,url.pathname));
      if (url.origin !== location.origin || !next) return;
      event.preventDefault(); void navigate(next.view as View,workspacePathParams(next.path,url.pathname)??undefined);
    };
    addEventListener('popstate', onPopState);
    document.addEventListener('click', onClick);
    document.addEventListener('workspace-entity-scope-change',cancelPending);
    return () => { pending.current?.abort.abort();pending.current=null;removeEventListener('popstate', onPopState); document.removeEventListener('click', onClick);document.removeEventListener('workspace-entity-scope-change',cancelPending);
      if(history.pushState===installedPush)history.pushState=originalPush;if(history.replaceState===installedReplace)history.replaceState=originalReplace;
    };
  }, [pages, navigate]);
  useEffect(() => { document.title = `${page.title}`; }, [page.title]);
  return { view: page.view as View, page, path, navigate };
}

// React owns only the mount. The common renderer owns all navigation descendants.
export function WorkspaceNavigation({ service, capabilities = [] }: { service: string; capabilities?: readonly string[] }) {
  return <aside className="cw-sidebar" data-workspace-navigation={service} data-workspace-capabilities={JSON.stringify(capabilities)} />;
}
