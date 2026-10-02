// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { PAGES } from './generated/workspace-pages';
import { WorkspaceNavigation, useWorkspacePage, useWorkspaceNavigationGuard, matchesWorkspacePath, workspacePathParams } from './generated/workspace-navigation';
import { PAGE_PATHS } from '../shared/workspace-routes';

let root: Root | undefined;
const container = document.createElement('div');
document.body.append(container);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { if(root)act(()=>root!.unmount()); root=undefined; container.replaceChildren(); });
function mount() {
  history.replaceState({}, '', '/');
  function TestApp() {
    const { view, page, navigate } = useWorkspacePage(PAGES);
    return createElement('div', {},
      createElement('output', {}, view),
      createElement('strong', {}, page.title),
      createElement(WorkspaceNavigation, {service:'sheet'}),
      createElement('a', {'href':'/migration','data-workspace-page':'sheet.migration','data-route-link':''}, 'menu'),
      createElement('button',{onClick:()=>navigate('snapshots')},'body link'));
  }
  root=createRoot(container);act(()=>root!.render(createElement(TestApp)));
}

test('React routes and server HTML paths come from the same contract',()=>{
  expect(PAGE_PATHS).toEqual(PAGES.flatMap(page=>[page.path,...('aliases' in page?page.aliases:[])]));
  expect(PAGE_PATHS).not.toContain('/api/config');
  expect(PAGE_PATHS).not.toContain('/auth/callback');
});

test('shared React adapter routes menu and body links and handles popstate',async()=>{
  mount();expect(container.querySelector('output')!.textContent).toBe('overview');
  const event=new MouseEvent('click',{bubbles:true,cancelable:true});
  await act(async()=>{container.querySelector('a')!.dispatchEvent(event);});
  expect(event.defaultPrevented).toBe(true);expect(location.pathname).toBe('/migration');
  expect(container.querySelector('output')!.textContent).toBe('migration');
  await act(async()=>{container.querySelector('button')!.click();});
  expect(location.pathname).toBe('/snapshots');expect(document.title).toContain('스냅샷');
  await act(async()=>{history.replaceState({},'','/translations');dispatchEvent(new PopStateEvent('popstate'));});
  expect(container.querySelector('output')!.textContent).toBe('translations');
});

test('modifier navigation remains native and adapter owns no duplicated menu descendants',async()=>{
  mount();
  const link=container.querySelector('a')!;
  // A hash target avoids jsdom's unsupported native document navigation.
  link.href='#native';
  const event=new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});
  act(()=>link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);expect(location.pathname).toBe('/');
  expect(container.querySelector('aside')!.childElementCount).toBe(0);
  // Let jsdom finish this native hash navigation before the next test changes URLs.
  await new Promise(resolve=>setTimeout(resolve,0));
});

test('shared React adapter handles numeric detail URLs, fragments and browser history',async()=>{
  const pages=[{view:'week',path:'/',title:'주간 일정'},{view:'task',path:'/tasks/:id',title:'업무 상세'}] as const;
  let navigate!: ReturnType<typeof useWorkspacePage<typeof pages>>['navigate'];
  history.replaceState({},'','/tasks/101#comment-7');
  function TestApp(){
    const route=useWorkspacePage(pages);navigate=route.navigate;
    return createElement('output',{},route.view+' '+route.path);
  }
  root=createRoot(container);act(()=>root!.render(createElement(TestApp)));
  expect(container.textContent).toBe('task /tasks/101#comment-7');
  await act(async()=>{await navigate('task',102,'#comment-8');});
  expect(location.pathname+location.hash).toBe('/tasks/102#comment-8');
  for(const id of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await expect(navigate('task',id)).rejects.toThrow('A positive integer ID is required');
  await expect(navigate('task',102,'#unsafe/fragment')).rejects.toThrow('Invalid workspace fragment');
  await act(async()=>{history.replaceState({},'','/');dispatchEvent(new PopStateEvent('popstate'));});
  expect(container.textContent).toBe('week /');
  for(const path of ['/tasks/0','/tasks/-1','/tasks/101/extra','/tasks/nope'])expect(matchesWorkspacePath('/tasks/:id',path)).toBe(false);
});

test('shared React adapter supports validated named route segments without weakening numeric id routes',async()=>{
  const pages=[{view:'products',path:'/',title:'상품 목록'},{view:'product',path:'/projects/:gameId/products/:productKey',title:'상품 상세'}] as const;
  let navigate!: ReturnType<typeof useWorkspacePage<typeof pages>>['navigate'];
  history.replaceState({},'','/projects/dungeon-slasher/products/pack_monthly.1');
  function TestApp(){const route=useWorkspacePage(pages);navigate=route.navigate;return createElement('output',{},route.view);}
  root=createRoot(container);act(()=>root!.render(createElement(TestApp)));
  expect(container.textContent).toBe('product');
  expect(workspacePathParams('/projects/:gameId/products/:productKey',location.pathname)).toEqual({gameId:'dungeon-slasher',productKey:'pack_monthly.1'});
  await act(async()=>{await navigate('product',{gameId:'game.2',productKey:'offer_2026-09'});});
  expect(location.pathname).toBe('/projects/game.2/products/offer_2026-09');
  await expect(navigate('product',{gameId:'../unsafe',productKey:'ok'})).rejects.toThrow('Invalid workspace route parameter');
  expect(matchesWorkspacePath('/tasks/:id','/tasks/not-a-number')).toBe(false);
});

test('navigation guards run before page state changes and preserve the complete accepted URL',async()=>{
  let allow=false;
  history.replaceState({},'','/migration?mode=test#draft');
  function TestApp(){
    const route=useWorkspacePage(PAGES);
    useWorkspaceNavigationGuard(()=>allow);
    useWorkspaceNavigationGuard(()=>allow,'navigation');
    return createElement('div',{},createElement('output',{},route.path),createElement('button',{onClick:()=>route.navigate('snapshots')},'navigate'));
  }
  root=createRoot(container);act(()=>root!.render(createElement(TestApp)));
  await act(async()=>{container.querySelector('button')!.click();});
  expect(container.querySelector('output')!.textContent).toBe('/migration?mode=test#draft');
  await act(async()=>{history.replaceState({},'','/');dispatchEvent(new PopStateEvent('popstate'));});
  expect(location.pathname+location.search+location.hash).toBe('/migration?mode=test#draft');
  expect(container.querySelector('output')!.textContent).toBe('/migration?mode=test#draft');
  allow=true;await act(async()=>{container.querySelector('button')!.click();});
  expect(container.querySelector('output')!.textContent).toBe('/snapshots');
});
