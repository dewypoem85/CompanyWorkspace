// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import {useWorkspacePage,useWorkspaceNavigationRequest,useWorkspaceNavigationGuard} from './generated/workspace-navigation';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const pages=[{view:'home',path:'/',title:'홈'},{view:'next',path:'/next',title:'다음'},{view:'other',path:'/other',title:'그다음'}] as const;
type Context={source:'history'|'navigation';from:string;to:string;signal:AbortSignal};
type Permit=()=>boolean;
let root:Root,node:HTMLDivElement,state:ReturnType<typeof useWorkspacePage<typeof pages>>,visible=true,legacy=false;
let request:(context:Context)=>Promise<Permit|null>,canLeave:()=>boolean;
function Guard(){useWorkspaceNavigationRequest(request);return null;}
function Legacy(){useWorkspaceNavigationGuard(canLeave,'navigation');return null;}
function Harness(){state=useWorkspacePage(pages);return createElement('main',null,visible?createElement(Guard):null,legacy?createElement(Legacy):null,state.view);}
const render=()=>act(()=>root.render(createElement(StrictMode,null,createElement(Harness))));
beforeEach(()=>{history.replaceState({kept:'original'},'','/');visible=true;legacy=false;request=vi.fn(async()=>()=>true);canLeave=()=>true;node=document.createElement('div');document.body.append(node);root=createRoot(node);render();});
afterEach(()=>{act(()=>root.unmount());node.remove();});

test('navigation awaits current permission, preserves the old page and refuses duplicate requests',async()=>{
  let resolve!:(permit:Permit|null)=>void;request=vi.fn(()=>new Promise<Permit|null>(done=>resolve=done));render();let pending!:Promise<boolean>;
  await act(async()=>{pending=state.navigate('next');expect(await state.navigate('other')).toBe(false);});
  expect(location.pathname).toBe('/');expect(state.view).toBe('home');expect(request).toHaveBeenCalledTimes(1);
  const context=vi.mocked(request).mock.calls[0][0];expect(context).toMatchObject({source:'navigation',from:'/',to:'/next'});
  await act(async()=>{resolve(()=>true);expect(await pending).toBe(true);});expect(location.pathname).toBe('/next');expect(state.view).toBe('next');
  expect(context.signal.aborted).toBe(true);expect(history.state.__companyWorkspaceRoute.index).toBe(1);
});

test.each(['scope','guard-unmount','draft','throw'])('navigation rejects stale %s approval',async interruption=>{
  let resolve!:(permit:Permit|null)=>void;request=()=>new Promise(done=>resolve=done);render();let pending!:Promise<boolean>;
  await act(async()=>{pending=state.navigate('next');});
  if(interruption==='scope')act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  if(interruption==='guard-unmount'){visible=false;render();}
  await act(async()=>{resolve(()=>{if(interruption==='throw')throw Error('stale');return interruption!=='draft';});expect(await pending).toBe(false);});
  expect(location.pathname).toBe('/');expect(state.view).toBe('home');expect(history.state.kept).toBe('original');
});

test('legacy navigation guards still fail closed for false, Promise and exceptions',async()=>{
  visible=false;legacy=true;render();
  for(const guard of [()=>false,()=>Promise.resolve(true) as unknown as boolean,()=>{throw Error('guard');}]){
    canLeave=guard;render();await act(async()=>expect(await state.navigate('next')).toBe(false));expect(location.pathname).toBe('/');
  }
  canLeave=()=>true;render();await act(async()=>expect(await state.navigate('next')).toBe(true));expect(state.view).toBe('next');
});

test('history wrappers preserve caller properties and restore original methods on unmount',async()=>{
  const installed=history.pushState;history.replaceState({custom:{value:'kept'}},'','/');
  expect(history.state.custom).toEqual({value:'kept'});await act(async()=>state.navigate('next'));
  act(()=>root.unmount());expect(history.pushState).not.toBe(installed);root=createRoot(node);render();
  expect(state.view).toBe('next');expect(history.state.__companyWorkspaceRoute.index).toBe(1);
});
