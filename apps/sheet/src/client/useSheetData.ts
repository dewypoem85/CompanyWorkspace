import {useEffect, useRef, useState} from 'react';
import {api} from './api';
import {createWorkspaceReadSession, type WorkspaceReadSession} from './generated/workspace-read';
import type {AnalysisResult, KoreanSyncPreview, RuntimeConfig, SnapshotRecord} from '../shared/types';

type Bundle = {config: RuntimeConfig; analysis: AnalysisResult; snapshots: Array<Omit<SnapshotRecord, 'entries'>>; preview?: KoreanSyncPreview};
type Channel = 'main' | 'preview';
const message = (error: unknown) => error instanceof Error ? error.message : '시트 조회에 실패했습니다.';
const checkTarget = (config: RuntimeConfig, analysis: AnalysisResult) => {
  if (analysis.spreadsheet.id !== config.defaultSpreadsheetId || analysis.mode !== config.mode) throw Error('조회 대상 또는 연결 모드가 변경되었습니다. 페이지를 다시 열어 확인해 주세요.');
};

// Owns app read state, not Google writes. The shared session owns observation;
// analyze/preview remain POST endpoints and may finish on the server.
export function useSheetData(view: string) {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [snapshots, setSnapshots] = useState<Bundle['snapshots']>([]);
  const [syncPreview, setSyncPreview] = useState<KoreanSyncPreview | null>(null);
  const [loading, setLoading] = useState(true), [syncLoading, setSyncLoading] = useState(false);
  const [initialized, setInitialized] = useState(false), [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(''), [syncError, setSyncError] = useState('');
  const mounted = useRef(false), invalidated = useRef(false);
  const readSession = useRef<WorkspaceReadSession | null>(null);
  const readOwners = useRef<Partial<Record<Channel, symbol>>>({});
  const live = useRef({config, view}); live.current = {config, view};

  function cancel(channel: Channel) {
    delete readOwners.current[channel]; readSession.current?.cancel(channel);
  }
  function clear() {
    invalidated.current = true; cancel('main'); cancel('preview');
    if (!mounted.current) return;
    setInvalid(true); setConfig(null); setAnalysis(null); setSnapshots([]); setSyncPreview(null);
    setInitialized(false); setLoading(false); setSyncLoading(false); setError(''); setSyncError('');
  }
  async function read<T>(channel: Channel, work: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
    const session = readSession.current;
    if (!session || !mounted.current || invalidated.current) return;
    cancel(channel);
    const owner = Symbol(channel); readOwners.current[channel] = owner;
    const current = () => mounted.current && !invalidated.current && readOwners.current[channel] === owner;
    const busy = channel === 'main' ? setLoading : setSyncLoading;
    const failure = channel === 'main' ? setError : setSyncError;
    busy(true); failure('');
    const result = await session.run(channel, work, 30_000);
    if (!current() || result.status === 'cancelled' || !result.isCurrent()) return;
    try {
      if (result.status === 'success') apply(result.value);
      else if ((result.error as {status?: number})?.status === 401 || (result.error as {status?: number})?.status === 403) clear();
      else failure(message(result.error));
    } finally {
      if (current() && result.isCurrent()) { delete readOwners.current[channel]; busy(false); }
    }
  }
  function initialize() {
    return read('main', async signal => {
      const runtime = await api.config(signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const [initial, saved] = await Promise.all([api.analyze(runtime.defaultSpreadsheetUrl, signal), api.snapshots(signal)]);
      checkTarget(runtime, initial);
      return {config: runtime, analysis: initial, snapshots: saved};
    }, value => {
      setConfig(value.config); setAnalysis(value.analysis); setSnapshots(value.snapshots); setInitialized(true);
    });
  }
  function analyze() {
    const runtime = live.current.config;
    if (!runtime || invalidated.current) return Promise.resolve();
    cancel('preview'); setSyncLoading(false);
    return read('main', async signal => {
      const value = await api.analyze(runtime.defaultSpreadsheetUrl, signal);
      checkTarget(runtime, value); return value;
    }, value => { setAnalysis(value); setSyncPreview(null); setSyncError(''); });
  }
  function previewKoreanSync() {
    const runtime = live.current.config;
    if (!runtime || live.current.view !== 'translations' || readOwners.current.main || invalidated.current) return Promise.resolve();
    return read('preview', async signal => {
      const value = await api.previewKoreanSync(runtime.defaultSpreadsheetUrl, signal);
      if (value.target.id !== runtime.defaultSpreadsheetId) throw Error('비교 대상이 변경되었습니다. 페이지를 다시 열어 확인해 주세요.');
      return value;
    }, setSyncPreview);
  }
  function acceptRefreshed(value: Bundle) {
    if (!mounted.current || invalidated.current) throw Error('로그인 상태가 변경되었습니다. 페이지를 다시 열어 주세요.');
    checkTarget(value.config, value.analysis);
    if (value.config.defaultSpreadsheetId !== live.current.config?.defaultSpreadsheetId
      || (value.preview && value.preview.target.id !== value.config.defaultSpreadsheetId)) throw Error('조회 대상이 변경되었습니다.');
    cancel('main'); cancel('preview'); setLoading(false); setSyncLoading(false);
    setConfig(value.config); setAnalysis(value.analysis); setSnapshots(value.snapshots);
    setSyncPreview(value.preview ?? null); setError(''); setSyncError(''); setInitialized(true);
  }
  useEffect(() => {
    const session = createWorkspaceReadSession(); readSession.current = session; mounted.current = true;
    const pagehide = (event: PageTransitionEvent) => { if (!event.persisted) clear(); };
    document.addEventListener('workspace-entity-scope-change', clear);
    document.addEventListener('sheet-access-denied', clear);
    window.addEventListener('pagehide', pagehide);
    void initialize();
    return () => {
      mounted.current = false; readOwners.current = {}; session.dispose();
      if (readSession.current === session) readSession.current = null;
      document.removeEventListener('workspace-entity-scope-change', clear);
      document.removeEventListener('sheet-access-denied', clear);
      window.removeEventListener('pagehide', pagehide);
    };
  }, []);
  useEffect(() => {
    if (view !== 'translations') { cancel('preview'); setSyncLoading(false); }
  }, [view]);
  return {config, analysis, snapshots, syncPreview, loading, syncLoading, initialized, invalid, error, syncError,
    initialize, analyze, previewKoreanSync, acceptRefreshed};
}
