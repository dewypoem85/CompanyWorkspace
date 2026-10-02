// @vitest-environment jsdom
import {act, createElement} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {useSheetActions} from './useSheetActions';
import {api} from './api';
import {confirmWorkspaceAction, type ConfirmOptions, type Confirmation} from './generated/workspace-confirm';
import {createWorkspaceWriteTransport, type WorkspaceWriteTransport, type WriteTransportOptions, type WriteResult} from './generated/workspace-form';
import {createWorkspaceReadSession, type WorkspaceReadSession} from './generated/workspace-read';
vi.mock('./api',()=>({api:{config:vi.fn(),analyze:vi.fn(),snapshots:vi.fn(),previewKoreanSync:vi.fn()}}));
vi.mock('./generated/workspace-confirm',()=>({confirmWorkspaceAction:vi.fn()}));
vi.mock('./generated/workspace-form',()=>({createWorkspaceWriteTransport:vi.fn()}));
vi.mock('./generated/workspace-read',()=>({createWorkspaceReadSession:vi.fn()}));
type Options=Parameters<typeof useSheetActions>[0];
const container=document.createElement('div');document.body.append(container);
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined, state:ReturnType<typeof useSheetActions>, options:Options, confirmation:ConfirmOptions, decide:(value:Confirmation|null)=>void;
let writeOptions:WriteTransportOptions, send:ReturnType<typeof vi.fn>, dispose:ReturnType<typeof vi.fn>, runRead:ReturnType<typeof vi.fn>, cancelRead:ReturnType<typeof vi.fn>, disposeRead:ReturnType<typeof vi.fn>;
const result={id:'result',spreadsheetId:'sheet',snapshotId:'snapshot',ruleFile:'sheet.json',startedAt:'2026-09-10',completedAt:'2026-09-10',converted:1,remaining:0};
const receipt={operation:'migration',analysisId:'analysis',spreadsheetId:'sheet',result};
function Harness(){state=useSheetActions(options);return null;}
function render(){act(()=>root!.render(createElement(Harness)));}
function accept(request:{json:unknown}){writeOptions.onSaved(receipt,structuredClone(request.json),{signal:new AbortController().signal,isCurrent:()=>true});return Promise.resolve({saved:true,outcome:'saved'} as WriteResult);}
beforeEach(()=>{
  vi.resetAllMocks();
  options={view:'migration',loading:false,config:{mode:'google',writesEnabled:true,actorId:'employee-1',defaultSpreadsheetId:'sheet',defaultSpreadsheetUrl:'sheet'},analysis:{id:'analysis',spreadsheet:{id:'sheet',title:'Sheet'},totals:{blocked:0,ready:1,formulas:1},rules:[{}]} as Options['analysis'],preview:null,onRefreshed:vi.fn()};
  vi.mocked(confirmWorkspaceAction).mockImplementation(value=>{confirmation=value;return new Promise(resolve=>{decide=resolve;});});
  vi.mocked(api.config).mockResolvedValue(options.config!);vi.mocked(api.analyze).mockResolvedValue(options.analysis!);vi.mocked(api.snapshots).mockResolvedValue([]);
  send=vi.fn(accept);dispose=vi.fn();vi.mocked(createWorkspaceWriteTransport).mockImplementation(value=>{writeOptions=value;return{busy:false,send:send as WorkspaceWriteTransport['send'],dispose:dispose as WorkspaceWriteTransport['dispose']};});
  runRead=vi.fn(async(_channel,work)=>{try{return{status:'success',value:await work(new AbortController().signal),isCurrent:():boolean=>true};}catch(error){return{status:'error',error,isCurrent:():boolean=>true};}});cancelRead=vi.fn();disposeRead=vi.fn();vi.mocked(createWorkspaceReadSession).mockReturnValue({run:runRead as WorkspaceReadSession['run'],cancel:cancelRead,dispose:disposeRead} as WorkspaceReadSession);
  root=createRoot(container);render();
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;container.replaceChildren();});
test('replaced analysis, revoked config and route changes cannot write after an old confirmation resolves',async()=>{
  for(const change of ['analysis','config','view']){
    let pending:Promise<void>;act(()=>{pending=state.run('migration');});
    const original=options;
    options=change==='analysis'?{...options,analysis:{...options.analysis!,id:'new'}}:change==='config'?{...options,config:{...options.config!,writesEnabled:false}}:{...options,view:'snapshots'};render();
    expect(confirmation.validate?.({confirmation:'수식 제거'})).toMatch(/바뀌었습니다/);
    await act(async()=>{decide({confirmation:'수식 제거'});await pending;});
    expect(send).not.toHaveBeenCalled();options=original;render();
  }
});
test('scope changes and unmount abort confirmation even if a late modal result arrives',async()=>{
  let pending:Promise<void>;act(()=>{pending=state.run('migration');});
  act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));expect(confirmation.signal?.aborted).toBe(true);
  await act(async()=>{decide({confirmation:'수식 제거'});await pending;});expect(send).not.toHaveBeenCalled();
  act(()=>{pending=state.run('migration');});act(()=>root!.unmount());root=undefined;expect(confirmation.signal?.aborted).toBe(true);expect(dispose).toHaveBeenCalledOnce();expect(disposeRead).toHaveBeenCalledOnce();
  await act(async()=>{decide({confirmation:'수식 제거'});await pending;});expect(send).not.toHaveBeenCalled();
});
test('in-place mutations cannot change the captured analysis id or reviewed counts',async()=>{
  let pending:Promise<void>;act(()=>{pending=state.run('migration');});
  options.analysis!.id='mutated-analysis';options.analysis!.totals.ready=4;
  expect(confirmation.validate?.({confirmation:'수식 제거'})).toMatch(/바뀌었습니다/);
  await act(async()=>{decide({confirmation:'수식 제거'});await pending;});expect(send).not.toHaveBeenCalled();
});
test('page departure invalidates a late write result and does not publish it',async()=>{
  let finish:(value:WriteResult)=>void;send.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let pending:Promise<void>;act(()=>{pending=state.run('migration');window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));});
  expect(confirmation.signal?.aborted).toBe(false);
  await act(async()=>{decide({confirmation:'수식 제거'});await Promise.resolve();});
  act(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  await act(async()=>{finish!({saved:false,outcome:'disposed'});await pending;});
  expect(api.analyze).not.toHaveBeenCalled();expect(options.onRefreshed).not.toHaveBeenCalled();
});
test('one acknowledged common write survives duplicate callbacks and a failed follow-up read without retrying',async()=>{
  vi.mocked(api.snapshots).mockRejectedValueOnce(Error('read failure'));
  let pending:Promise<void>;act(()=>{pending=state.run('migration');});
  await act(async()=>{await state.run('migration');decide({confirmation:'수식 제거'});await pending;});
  expect(send).toHaveBeenCalledExactlyOnceWith({url:'/api/migrations/apply',method:'POST',json:{analysisId:'analysis',confirmation:'수식 제거'},signal:expect.any(AbortSignal),headers:{'X-Workspace-Actor':'employee-1','X-Workspace-Sheet-State':'analysis'}});
  expect(state.outcome?.kind).toBe('success');expect(state.outcome?.title).toMatch(/목록 조회에 실패/);expect(state.needsRefresh).toBe(true);
  await act(async()=>{await state.run('migration');});expect(send).toHaveBeenCalledTimes(1);
  await act(async()=>{await state.refresh();});expect(state.needsRefresh).toBe(false);expect(send).toHaveBeenCalledTimes(1);
});
test('late write completion from a previous account does not refresh the new scope',async()=>{
  let finish:(value:WriteResult)=>void;send.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let pending:Promise<void>;act(()=>{pending=state.run('migration');});
  await act(async()=>{decide({confirmation:'수식 제거'});await Promise.resolve();});
  act(()=>document.dispatchEvent(new Event('workspace-entity-scope-change')));
  await act(async()=>{finish!({saved:false,outcome:'scope-changed'});await pending;});
  expect(state.outcome?.title).toBe('로그인 상태가 변경되었습니다.');expect(api.analyze).not.toHaveBeenCalled();expect(options.onRefreshed).not.toHaveBeenCalled();
  await act(async()=>{await state.refresh();});expect(options.onRefreshed).toHaveBeenCalledOnce();expect(send).toHaveBeenCalledTimes(1);
});
test('post-write reads use one bounded common channel and a route change rejects their late result',async()=>{
  let finish:(value:{status:'cancelled'})=>void;runRead.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  let pending:Promise<void>;act(()=>{pending=state.run('migration');});
  await act(async()=>{decide({confirmation:'수식 제거'});await Promise.resolve();});
  expect(runRead).toHaveBeenCalledWith('after-write',expect.any(Function),30_000);
  options={...options,view:'snapshots'};render();expect(cancelRead).toHaveBeenCalledWith('after-write');
  await act(async()=>{finish!({status:'cancelled'});await pending;});expect(options.onRefreshed).not.toHaveBeenCalled();
});
