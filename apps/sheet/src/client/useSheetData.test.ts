// @vitest-environment jsdom
import {act,createElement,StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import '../../../../packages/workspace-ui/src/read-session.js';
import {api} from './api';
import {useSheetData} from './useSheetData';
import {analysis,config,preview,snapshots} from '../test/sheetFixtures';
vi.mock('./api',()=>({api:{config:vi.fn(),analyze:vi.fn(),snapshots:vi.fn(),previewKoreanSync:vi.fn()}}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined,state:ReturnType<typeof useSheetData>,view:string;
const container=document.createElement('div');document.body.append(container);
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
function Harness(){state=useSheetData(view);return null;}
async function render(strict=false){await act(async()=>root!.render(strict?createElement(StrictMode,null,createElement(Harness)):createElement(Harness)));}
beforeEach(()=>{
  vi.resetAllMocks();view='translations';root=createRoot(container);
  vi.mocked(api.config).mockResolvedValue(config);vi.mocked(api.analyze).mockResolvedValue(analysis);
  vi.mocked(api.snapshots).mockResolvedValue(snapshots);vi.mocked(api.previewKoreanSync).mockResolvedValue(preview);
});
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;vi.useRealTimers();});
test('initial bundle is atomic and failure retries do not publish partial configuration',async()=>{
  vi.mocked(api.snapshots).mockRejectedValueOnce(Error('snapshot unavailable'));await render();
  expect(state.initialized).toBe(false);expect(state.config).toBeNull();expect(state.analysis).toBeNull();expect(state.error).toMatch(/snapshot unavailable/);
  await act(async()=>{await state.initialize();});expect(state.initialized).toBe(true);expect(state.snapshots).toEqual(snapshots);
});
test('latest analysis wins and old finally cannot unlock a newer request',async()=>{
  await render();const old=deferred<typeof analysis>(),fresh=deferred<typeof analysis>();
  vi.mocked(api.analyze).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  let first:Promise<void>,second:Promise<void>;
  act(()=>{first=state.analyze();});await act(async()=>{await Promise.resolve();});act(()=>{second=state.analyze();});
  await act(async()=>{await first;old.resolve({...analysis,id:'old'});});expect(state.loading).toBe(true);expect(state.analysis?.id).toBe('analysis');
  await act(async()=>{fresh.resolve({...analysis,id:'fresh'});await second;});expect(state.analysis?.id).toBe('fresh');expect(state.loading).toBe(false);
});
test('preview cancellation on navigation ignores late responses and preserves last good comparison',async()=>{
  await render();await act(async()=>{await state.previewKoreanSync();});
  const late=deferred<typeof preview>();vi.mocked(api.previewKoreanSync).mockReturnValueOnce(late.promise);
  let pending:Promise<void>;act(()=>{pending=state.previewKoreanSync();});view='snapshots';await render();
  await act(async()=>{late.resolve({...preview,id:'late'});await pending;});expect(state.syncLoading).toBe(false);expect(state.syncPreview?.id).toBe('preview');
  await act(async()=>{await state.previewKoreanSync();});expect(api.previewKoreanSync).toHaveBeenCalledTimes(2);
});
test('scope changes remove all data and late reads or follow-up writes cannot rehydrate the old document',async()=>{
  await render();await act(async()=>{await state.previewKoreanSync();});const late=deferred<typeof analysis>();vi.mocked(api.analyze).mockReturnValueOnce(late.promise);
  let pending:Promise<void>;act(()=>{pending=state.analyze();document.dispatchEvent(new Event('workspace-entity-scope-change'));});
  expect(state.invalid).toBe(true);expect(state.config).toBeNull();expect(state.analysis).toBeNull();expect(state.syncPreview).toBeNull();expect(state.snapshots).toEqual([]);
  await act(async()=>{late.resolve(analysis);await pending;await state.initialize();});expect(state.analysis).toBeNull();
  expect(()=>state.acceptRefreshed({config,analysis,snapshots})).toThrow(/로그인/);expect(api.config).toHaveBeenCalledTimes(1);
});
test('ordinary failure and target mismatch keep last good data while denial clears it',async()=>{
  await render();vi.mocked(api.analyze).mockRejectedValueOnce(Error('unavailable'));
  await act(async()=>{await state.analyze();});expect(state.analysis).toBe(analysis);expect(state.error).toBe('unavailable');
  vi.mocked(api.analyze).mockResolvedValueOnce({...analysis,spreadsheet:{...analysis.spreadsheet,id:'other'}});
  await act(async()=>{await state.analyze();});expect(state.error).toMatch(/대상/);expect(state.analysis).toBe(analysis);
  vi.mocked(api.previewKoreanSync).mockRejectedValueOnce(Object.assign(Error('denied'),{status:403}));
  await act(async()=>{await state.previewKoreanSync();});expect(state.invalid).toBe(true);expect(state.analysis).toBeNull();
});
test('deadline releases busy even if transport ignores abort and late completion cannot overwrite retry',async()=>{
  await render();vi.useFakeTimers();const late=deferred<typeof analysis>();vi.mocked(api.analyze).mockReturnValueOnce(late.promise);
  let pending:Promise<void>;act(()=>{pending=state.analyze();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(30_001);await pending;});expect(state.loading).toBe(false);expect(state.error).toMatch(/시간이 초과/);
  vi.mocked(api.analyze).mockResolvedValueOnce({...analysis,id:'retry'});await act(async()=>{await state.analyze();late.resolve({...analysis,id:'late'});});
  expect(state.analysis?.id).toBe('retry');expect(state.error).toBe('');
});
test('confirmed refresh cancels older analysis and clears stale preview without extra writes',async()=>{
  await render();await act(async()=>{await state.previewKoreanSync();});const late=deferred<typeof analysis>();vi.mocked(api.analyze).mockReturnValueOnce(late.promise);
  let pending:Promise<void>;act(()=>{pending=state.analyze();state.acceptRefreshed({config,analysis:{...analysis,id:'after-write'},snapshots});});
  await act(async()=>{late.resolve(analysis);await pending;});expect(state.analysis?.id).toBe('after-write');expect(state.syncPreview).toBeNull();
});
test('StrictMode restarts disposed initial reads and pagehide respects bfcache',async()=>{
  await render(true);expect(state.initialized).toBe(true);
  act(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));expect(state.invalid).toBe(false);
  act(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));expect(state.invalid).toBe(true);expect(state.analysis).toBeNull();
});
test('unmount aborts pending transport without publishing or starting analysis from a late config',async()=>{
  const late=deferred<typeof config>();vi.mocked(api.config).mockReturnValueOnce(late.promise);await render();
  const signal=vi.mocked(api.config).mock.calls[0][0];act(()=>root!.unmount());root=undefined;
  await act(async()=>{late.resolve(config);});expect(signal?.aborted).toBe(true);expect(api.analyze).not.toHaveBeenCalled();
});
