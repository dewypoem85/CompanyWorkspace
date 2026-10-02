import {useEffect, useRef, useState} from 'react';
import {api} from './api';
import {confirmWorkspaceAction} from './generated/workspace-confirm';
import {createWorkspaceWriteTransport, type WorkspaceWriteTransport} from './generated/workspace-form';
import {createWorkspaceReadSession, type WorkspaceReadSession} from './generated/workspace-read';
import type {WorkspaceStateProps} from './generated/workspace-state';
import {confirmMigrationReceipt, confirmSyncReceipt} from './sheetWrites';
import type {AnalysisResult, KoreanSyncPreview, KoreanSyncResult, MigrationResult, RuntimeConfig, SnapshotRecord} from '../shared/types';

type Kind = 'migration' | 'translations';
type Refreshed = {config: RuntimeConfig; analysis: AnalysisResult; preview?: KoreanSyncPreview; snapshots: Array<Omit<SnapshotRecord, 'entries'>>};
type Options = {view: string; config: RuntimeConfig | null; analysis: AnalysisResult | null; preview: KoreanSyncPreview | null; loading: boolean; onRefreshed: (value: Refreshed) => void};
type ActiveWrite = {kind: Kind; current: () => boolean; analysis?: AnalysisResult; preview?: KoreanSyncPreview; result?: MigrationResult | KoreanSyncResult};

// Captured analysis/preview IDs remain immutable between confirmation and the explicit API write.
export function useSheetActions(options: Options) {
  const live = useRef(options); live.current = options;
  const locked = useRef(false), mounted = useRef(true), epoch = useRef(0), controller = useRef<AbortController | null>(null);
  const transport = useRef<WorkspaceWriteTransport | null>(null), reads = useRef<WorkspaceReadSession | null>(null), activeWrite = useRef<ActiveWrite | null>(null);
  const previous = useRef<{kind: Kind; target: string; confirmed: boolean} | null>(null);
  const [busy, setBusy] = useState(false), [needsRefresh, setNeedsRefresh] = useState(false), [outcome, setOutcome] = useState<WorkspaceStateProps | null>(null);
  const pendingRefresh = useRef(false);
  useEffect(() => {
    mounted.current = true;
    try {
      reads.current = createWorkspaceReadSession();
      transport.current = createWorkspaceWriteTransport({
        isConnected: () => mounted.current,
        onState: setOutcome,
        onConflict: () => { void refresh(); },
        onSaved: (value, sent, context) => {
          const active = activeWrite.current;
          if (!active?.current() || !context.isCurrent()) throw Error('시트 실행 중 대상·계정 또는 검토 결과가 변경되었습니다.');
          active.result = active.kind === 'migration'
            ? confirmMigrationReceipt(value, sent, active.analysis!)
            : confirmSyncReceipt(value, sent, active.preview!);
        },
      });
    } catch (error) {
      setOutcome({kind:'error', title:'공통 저장 도구를 시작하지 못했습니다.', message:error instanceof Error ? error.message : String(error)});
    }
    const changed = () => {
      epoch.current++; controller.current?.abort(); reads.current?.cancel('after-write');
      if (previous.current) {
        previous.current.confirmed = false; pendingRefresh.current = true; setNeedsRefresh(true);
        setOutcome({kind:'error', title:'로그인 상태가 변경되었습니다.', message:'현재 권한으로 데이터를 다시 확인해 주세요. 실행 요청은 자동 반복하지 않습니다.'});
      } else setOutcome(null);
    };
    document.addEventListener('workspace-entity-scope-change', changed);
    document.addEventListener('sheet-access-denied', changed);
    const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) changed(); };
    window.addEventListener('pagehide', pagehide);
    return () => { mounted.current = false; epoch.current++; controller.current?.abort(); transport.current?.dispose(); reads.current?.dispose(); transport.current=null; reads.current=null; activeWrite.current=null; document.removeEventListener('workspace-entity-scope-change', changed); document.removeEventListener('sheet-access-denied', changed); window.removeEventListener('pagehide', pagehide); };
  }, []);
  useEffect(() => { controller.current?.abort(); reads.current?.cancel('after-write'); }, [options.view]);

  async function readLatest(kind: Kind, target: string, scope: number) {
    const session=reads.current;if(!session)throw Error('공통 조회 도구를 사용할 수 없습니다.');
    const observed=await session.run('after-write',async signal=>{
      const [config, analysis, snapshots, preview] = await Promise.all([
        api.config(signal), api.analyze(target,signal), api.snapshots(signal),
        kind === 'translations' ? api.previewKoreanSync(target,signal) : Promise.resolve(undefined),
      ]);
      signal.throwIfAborted();
      if (analysis.spreadsheet.id !== target || (preview && preview.target.id !== target)) throw Error('조회 대상이 변경되었습니다.');
      return {config,analysis,snapshots,preview};
    },30_000);
    if(observed.status==='cancelled'||!mounted.current||epoch.current!==scope||!observed.isCurrent())return false;
    if(observed.status==='error')throw observed.error;
    live.current.onRefreshed(observed.value);
    pendingRefresh.current = false; setNeedsRefresh(false);return true;
  }

  async function refresh() {
    const last = previous.current;
    if (locked.current || !last) return;
    locked.current = true; setBusy(true); const scope = epoch.current;
    try {
      const updated=await readLatest(last.kind, last.target, scope);
      if (updated && mounted.current && epoch.current === scope) setOutcome(last.confirmed
        ? {kind:'success', title:'실행 후 데이터를 다시 확인했습니다.'}
        : {kind:'error', title:'현재 데이터를 다시 조회했습니다.', message:'이전 요청의 실행 여부가 확정된 것은 아닙니다. 스냅샷과 현재 셀 값을 확인한 뒤 필요한 작업만 새로 실행해 주세요.'});
    } catch (error) {
      if (mounted.current && epoch.current === scope) setOutcome({kind:last.confirmed ? 'success' : 'error', title:last.confirmed ? '실행은 완료되었지만 목록 조회에 실패했습니다.' : '실행 여부를 아직 확인하지 못했습니다.', message:String(error instanceof Error ? error.message : error)});
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  async function run(kind: Kind) {
    const captured = live.current, analysis = captured.analysis && structuredClone(captured.analysis), preview = captured.preview && structuredClone(captured.preview);
    const writer = transport.current;
    if (!writer || locked.current || pendingRefresh.current || captured.loading || captured.view !== kind
      || (kind === 'migration' ? !analysis || analysis.totals.blocked > 0 || analysis.totals.ready < 1 : !preview || preview.totals.changed < 1)) return;
    const target = kind === 'migration' ? analysis!.spreadsheet.id : preview!.target.id;
    const reviewed = JSON.stringify(kind === 'migration' ? analysis : preview);
    const scope = epoch.current, abort = new AbortController(); controller.current = abort;
    locked.current = true; setBusy(true); setOutcome(null);
    const valid = () => mounted.current && !abort.signal.aborted && epoch.current === scope && live.current.view === kind
      && !live.current.loading && live.current.config === captured.config && Boolean(live.current.config?.writesEnabled)
      && (kind === 'migration' ? live.current.analysis === captured.analysis : live.current.preview === captured.preview)
      && JSON.stringify(kind === 'migration' ? live.current.analysis : live.current.preview) === reviewed;
    const active: ActiveWrite = {kind, current: valid, analysis: analysis || undefined, preview: preview || undefined};
    activeWrite.current = active;
    let attempted = false, confirmed = false;
    try {
      const migration = kind === 'migration';
      const intent = await confirmWorkspaceAction({
        title: migration ? '수식을 일반 값으로 전환할까요?' : '한국어 원문을 갱신할까요?',
        message: migration ? `IMPORTRANGE ${analysis!.totals.formulas}개를 일반 값으로 전환합니다. 실행 직전에 복구 스냅샷을 생성합니다.` : `원본과 다른 Korean 셀 ${preview!.totals.changed}개를 최신 RAW 값으로 갱신합니다.`,
        details: [
          {label:'대상', value:migration ? analysis!.spreadsheet.title : preview!.target.title},
          {label:'보호 범위', value:'Korean 외 기존 번역 값은 변경하지 않습니다.'},
          {label:'실행 전 확인', value:'스냅샷 생성과 서버의 변경 충돌 검사를 통과한 뒤 실행합니다.'},
        ],
        confirmationText:migration ? '수식 제거' : '한국어 갱신',
        confirmLabel:migration ? '전환 실행' : '한국어 갱신',
        tone:migration ? 'danger' : undefined,
        disabledReason:captured.config?.writesEnabled ? undefined : 'Google 인증과 ALLOW_SHEET_WRITES=true 설정이 필요합니다.',
        signal:abort.signal,
        validate:() => valid() ? null : '대상·권한 또는 분석 결과가 바뀌었습니다. 취소 후 다시 확인해 주세요.',
      });
      if (!intent || !valid()) return;
      attempted = true; pendingRefresh.current = true; setNeedsRefresh(true);
      previous.current = {kind, target, confirmed:false};
      setOutcome({kind:'loading', title:'스냅샷 생성 및 실행 중…', message:'중복 실행하지 마세요. 완료 후 결과를 표시합니다.'});
      const write = migration
        ? {url:'/api/migrations/apply', json:{analysisId:analysis!.id, confirmation:intent.confirmation}}
        : {url:'/api/sync/korean/apply', json:{spreadsheetId:target, previewId:preview!.id, confirmation:intent.confirmation}};
      const sent = await writer.send({...write, method:'POST', signal:abort.signal, headers:{'X-Workspace-Actor':captured.config!.actorId,'X-Workspace-Sheet-State':migration?analysis!.id:preview!.id}});
      if (!sent.saved || !active.result || !valid()) return;
      const result = active.result;
      const message = migration
        ? `${(result as MigrationResult).converted}개 전환 · 남은 수식 ${(result as MigrationResult).remaining}개 · 스냅샷 ${(result as MigrationResult).snapshotId}`
        : `${(result as KoreanSyncResult).updated}개 갱신 · 변경 없음 ${(result as KoreanSyncResult).unchanged}개${(result as KoreanSyncResult).snapshotId ? ` · 스냅샷 ${(result as KoreanSyncResult).snapshotId}` : ''}`;
      confirmed = true;
      if (!mounted.current || epoch.current !== scope) return;
      previous.current = {kind, target, confirmed:true};
      setOutcome({kind:'success', title:migration ? '마이그레이션 완료' : '한국어 갱신 완료', message});
      try { if(!await readLatest(kind, target, scope))return; }
      catch {
        if (mounted.current && epoch.current === scope) setOutcome({kind:'success', title:'실행은 완료되었지만 목록 조회에 실패했습니다.', message:`${message}. 다시 실행하지 말고 데이터를 다시 확인해 주세요.`});
      }
    } catch (error) {
      if (mounted.current && epoch.current === scope) setOutcome({kind:'error', title:attempted && !confirmed ? '실행 결과를 확인해 주세요.' : '작업을 시작하지 못했습니다.', message:`${error instanceof Error ? error.message : '요청에 실패했습니다.'}${attempted ? ' 서버에 반영되었을 수 있으므로 자동 재전송하지 않습니다. 현재 데이터와 스냅샷을 확인해 주세요.' : ''}`});
    } finally { if (activeWrite.current === active) activeWrite.current=null; if (controller.current === abort) controller.current = null; locked.current = false; if (mounted.current) setBusy(false); }
  }
  return {busy, needsRefresh, outcome, run, refresh};
}
