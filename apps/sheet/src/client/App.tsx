import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useSheetData } from './useSheetData';
import { useSheetActions } from './useSheetActions';
import { WorkspaceNavigation, useWorkspacePage } from './generated/workspace-navigation';
import { useWorkspaceDisclosure } from './generated/workspace-disclosure';
import { WorkspaceState } from './generated/workspace-state';
import { PAGES, additionalPages, type View } from './generated/workspace-pages';
import type {
  AnalysisResult,
  CellValue,
  KoreanSyncPreview,
  RuntimeConfig,
  SnapshotRecord,
} from '../shared/types';

const formatNumber = new Intl.NumberFormat('ko-KR');
const formatDate = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    migrate: <><path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/></>,
    language: <><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m14 22 4-9 4 9"/><path d="M16 18h4"/></>,
    release: <><path d="M12 2v13"/><path d="m7 10 5 5 5-5"/><path d="M5 22h14"/><path d="M5 18h14"/></>,
    snapshot: <><path d="M12 8v4l3 2"/><path d="M3.05 11a9 9 0 1 0 .5-3"/><path d="M3 4v7h7"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1"/></>,
    scan: <><path d="M3 7V3h4"/><path d="M17 3h4v4"/><path d="M21 17v4h-4"/><path d="M7 21H3v-4"/><path d="M7 12h10"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    alert: <><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.7 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/></>,
    external: <><path d="M15 3h6v6"/><path d="m10 14 11-11"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11"/><path d="M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></>,
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function MetricCard({ label, value, note, tone, icon }: {
  label: string; value: string; note: string; tone: string; icon: string;
}) {
  return <article className={`metric-card ${tone}`}>
    <div className="metric-icon"><Icon name={icon} /></div>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

function StatusPill({ status }: { status: 'ready' | 'blocked' }) {
  return <span className={`status-pill cw-state-pill ${status}`} data-tone={status === 'ready' ? 'success' : 'warning'}>
    <i />{status === 'ready' ? '전환 가능' : '확인 필요'}
  </span>;
}

function Overview({ analysis, loading, onAnalyze, setView }: {
  analysis: AnalysisResult | null;
  loading: boolean;
  onAnalyze: () => void;
  setView: (view: View) => void;
}) {
  const formulaSheets = analysis?.sheets.filter((sheet) => sheet.formulaCount > 0) ?? [];
  const max = Math.max(...formulaSheets.map((sheet) => sheet.formulaCount), 1);

  return <>
    <section className="hero-card">
      <div className="hero-copy">
        <span className="eyebrow"><i /> Google Sheets 안전 관리</span>
        <h1>수식 연결은 가볍게,<br /><span>데이터 배포는 확실하게.</span></h1>
        <p>`IMPORTRANGE`를 일반 값으로 전환하고 한국어 원문과 번역 상태를 릴리스 단위로 관리합니다.</p>
        <div className="hero-actions">
          <button className="cw-button" data-variant="primary" onClick={() => setView('migration')}>
            마이그레이션 검토 <span>→</span>
          </button>
          <button className="cw-button" onClick={onAnalyze} disabled={loading}>
            <Icon name="refresh" /> {loading ? '분석 중…' : '데이터 다시 분석'}
          </button>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <div className="source-node"><span>DATA</span><strong>PlayerInfoTable</strong><small>#소환술사 · D33</small></div>
        <div className="flow-line"><i /><b>RAW</b></div>
        <div className="target-node"><span>LOCALE</span><strong>I2Loc 번역</strong><small>Default · Korean</small></div>
        <div className="safe-badge"><Icon name="shield" /> 스냅샷 보호</div>
      </div>
    </section>

    <section className="metric-grid">
      <MetricCard label="발견된 수식" value={formatNumber.format(analysis?.totals.formulas ?? 0)} note="IMPORTRANGE" tone="blue" icon="scan" />
      <MetricCard label="전환 가능" value={formatNumber.format(analysis?.totals.ready ?? 0)} note="일반 값 변환 준비" tone="green" icon="check" />
      <MetricCard label="확인 필요" value={formatNumber.format(analysis?.totals.blocked ?? 0)} note="차단 오류" tone="amber" icon="alert" />
      <MetricCard label="원본 문서" value={`${analysis?.totals.sourceSpreadsheets ?? 0}`} note={`${analysis?.totals.sourceSheets ?? 0}개 원본 탭`} tone="violet" icon="link" />
    </section>

    <section className="dashboard-grid">
      <article className="panel formula-distribution">
        <div className="panel-heading"><div><span>수식 분포</span><h2>마이그레이션 대상 탭</h2></div><button className="cw-button" data-variant="quiet" data-size="compact" onClick={() => setView('migration')}>전체 보기</button></div>
        <div className="distribution-list">
          {formulaSheets.map((sheet) => <div className="distribution-row" key={sheet.sheetId}>
            <div className="sheet-glyph">{sheet.title.slice(0, 1)}</div>
            <div className="distribution-body">
              <div><strong>{sheet.title}</strong><span>{formatNumber.format(sheet.formulaCount)}개</span></div>
              <div className="bar"><i style={{ width: `${Math.max(4, (sheet.formulaCount / max) * 100)}%` }} /></div>
            </div>
          </div>)}
        </div>
      </article>
      <article className="panel activity-panel">
        <div className="panel-heading"><div><span>안전 체크</span><h2>실행 전 준비 상태</h2></div><span className="live-label cw-state-pill" data-tone="success"><i /> READY</span></div>
        <ol className="check-list">
          <li className="done"><Icon name="check" /><div><strong>테스트 복사본 확인</strong><span>{analysis?.spreadsheet.title ?? '연결 대기 중'}</span></div></li>
          <li className="done"><Icon name="check" /><div><strong>수식 규칙 분석</strong><span>단일 셀 참조 {formatNumber.format(analysis?.totals.ready ?? 0)}개</span></div></li>
          <li className={(analysis?.totals.blocked ?? 0) === 0 ? 'done' : 'warn'}><Icon name={(analysis?.totals.blocked ?? 0) === 0 ? 'check' : 'alert'} /><div><strong>차단 오류 검사</strong><span>{analysis?.totals.blocked ?? 0}개 확인 필요</span></div></li>
          <li><span className="step-number">4</span><div><strong>스냅샷 및 변환</strong><span>사용자 최종 확인 후 실행</span></div></li>
        </ol>
      </article>
    </section>
  </>;
}

function Migration({ analysis, config, loading, busy, onAnalyze, onMigrate }: {
  analysis: AnalysisResult | null;
  config: RuntimeConfig | null;
  loading: boolean;
  onAnalyze: () => void;
  onMigrate: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState('all');
  const rules = useMemo(() => (analysis?.rules ?? []).filter((rule) => {
    const matchesSheet = sheet === 'all' || rule.target.sheetTitle === sheet;
    const needle = query.toLowerCase();
    const matchesQuery = !needle || [rule.target.key, rule.target.cell, rule.source.sheetTitle, rule.source.cell]
      .some((value) => value.toLowerCase().includes(needle));
    return matchesSheet && matchesQuery;
  }), [analysis, query, sheet]);

  return <>
    <section className="page-title">
      <div><span className="eyebrow"><i /> MIGRATION CENTER</span><h1>수식 마이그레이션</h1><p>분산된 외부 참조 수식을 추적 가능한 갱신 규칙과 일반 값으로 전환합니다.</p></div>
      <button className="cw-button" data-variant="primary" onClick={onAnalyze} disabled={loading || busy}><Icon name="scan" /> {loading ? '분석 중…' : '복사본 분석'}</button>
    </section>

    <section className="migration-banner">
      <div className="migration-number"><span>준비율</span><strong>{analysis?.totals.formulas ? Math.round((analysis.totals.ready / analysis.totals.formulas) * 100) : 0}<small>%</small></strong></div>
      <div className="migration-copy"><h2>{formatNumber.format(analysis?.totals.ready ?? 0)}개의 셀이 전환 준비되었습니다.</h2><p>실행 시 전체 스냅샷을 먼저 생성하고, 현재 계산 결과를 RAW 일반 값으로 기록합니다.</p><div className="progress"><i style={{ width: `${analysis?.totals.formulas ? (analysis.totals.ready / analysis.totals.formulas) * 100 : 0}%` }} /></div></div>
      <div className="migration-cta">
        <button
          className="cw-button" data-variant="danger"
          disabled={busy || loading || !analysis || analysis.totals.blocked > 0 || analysis.totals.ready < 1}
          onClick={onMigrate}
        >수식 제거 실행</button>
        <span>{config?.writesEnabled ? '스냅샷 자동 생성' : '쓰기 설정이 비활성화됨'}</span>
      </div>
    </section>

    <section className="panel rules-panel">
      <div className="rules-toolbar">
        <div><span>연결 규칙 미리보기</span><h2>{formatNumber.format(analysis?.totals.formulas ?? 0)}개 매핑</h2></div>
        <div className="filters">
          <label className="cw-form-field">연결 규칙 검색<input className="cw-form-control" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="키, 셀, 탭 검색" /></label>
          <label className="cw-form-field">대상 탭<select className="cw-form-control" value={sheet} onChange={(event) => setSheet(event.target.value)}>
            <option value="all">전체 탭</option>
            {analysis?.sheets.filter((item) => item.formulaCount > 0).map((item) => <option key={item.sheetId}>{item.title}</option>)}
          </select></label>
        </div>
      </div>
      <div className="cw-table-scroll" tabIndex={0} role="region" aria-label="시트 비교 결과 표">
        <table className="rules-table cw-data-table">
          <thead><tr><th>번역 키</th><th>원본 위치</th><th></th><th>대상 위치</th><th>현재 값</th><th>상태</th></tr></thead>
          <tbody>{rules.map((rule) => <tr key={rule.id}>
            <td><strong>{rule.target.key || '(키 없음)'}</strong><small>{rule.target.language}</small></td>
            <td><span className="cell-tag source">{rule.source.sheetTitle}</span><code>{rule.source.cell}</code></td>
            <td className="arrow-cell">→</td>
            <td><span className="cell-tag target">{rule.target.sheetTitle}</span><code>{rule.target.cell}</code></td>
            <td className="value-cell" title={rule.formattedValue}>{rule.formattedValue || <em>빈 값</em>}</td>
            <td><StatusPill status={rule.status} /></td>
          </tr>)}{rules.length === 0 && <tr><td colSpan={6}><WorkspaceState kind="empty" title="조건에 맞는 연결 규칙이 없습니다." message="검색어나 대상 탭을 변경해 주세요." /></td></tr>}</tbody>
        </table>
      </div>
      <div className="table-footer"><span>분석 결과 중 최대 150개 규칙을 표시합니다.</span><strong>{rules.length}개 표시 중</strong></div>
    </section>
  </>;
}

function displayCellValue(value: CellValue): string {
  if (value === null || value === '') return '빈 값';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function KoreanSync({ preview, loading, busy, error, config, onPreview, onApply }: {
  preview: KoreanSyncPreview | null;
  loading: boolean;
  error: string;
  config: RuntimeConfig | null;
  onPreview: () => void;
  onApply: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'changed' | 'all'>('changed');
  const visible = useMemo(() => (preview?.items ?? []).filter((item) => {
    const needle = query.trim().toLowerCase();
    const statusMatches = status === 'all' || item.status === status;
    const queryMatches = !needle || [
      item.key,
      item.source.sheetTitle,
      item.source.cell,
      item.target.sheetTitle,
      item.target.cell,
      displayCellValue(item.source.value),
      displayCellValue(item.target.currentValue),
    ].some((value) => value.toLowerCase().includes(needle));
    return statusMatches && queryMatches;
  }).slice(0, 300), [preview, query, status]);

  return <>
    <section className="page-title">
      <div><span className="eyebrow"><i /> KOREAN SOURCE SYNC</span><h1>한국어 원문 갱신</h1><p>기존 IMPORTRANGE 연결 규칙을 이용해 데이터 시트의 최신 원문을 번역 시트로 가져옵니다.</p></div>
      <button className="cw-button" data-variant="primary" onClick={onPreview} disabled={loading || busy}><Icon name="refresh" /> {loading ? '원본 확인 중…' : preview ? '다시 비교' : '갱신 미리보기'}</button>
    </section>

    {error && <WorkspaceState kind="error" title="원문을 비교하지 못했습니다." message={error} actionLabel={busy ? undefined : "다시 시도"} onAction={onPreview} />}

    {!preview ? !error && <WorkspaceState kind={loading ? 'loading' : 'empty'} title={loading ? '원본값을 읽는 중…' : '원본과 번역 시트를 비교해 보세요.'} message="저장된 연결 규칙을 따라 Korean 셀만 검사합니다. 비교만으로는 시트가 변경되지 않습니다." actionLabel={loading ? undefined : '지금 비교하기'} onAction={onPreview} /> : <>
      <section className="metric-grid sync-metrics">
        <MetricCard label="추적 중인 한국어" value={formatNumber.format(preview.totals.tracked)} note="저장된 연결 규칙" tone="blue" icon="link" />
        <MetricCard label="갱신 필요" value={formatNumber.format(preview.totals.changed)} note="원본과 다른 셀" tone="amber" icon="refresh" />
        <MetricCard label="최신 상태" value={formatNumber.format(preview.totals.unchanged)} note="이미 동일한 셀" tone="green" icon="check" />
        <MetricCard label="원본 문서" value={String(preview.totals.sourceSpreadsheets)} note={`${preview.totals.sourceSheets}개 원본 탭`} tone="violet" icon="grid" />
      </section>

      <section className="sync-banner">
        <div><Icon name="shield" /></div>
        <div><h2>{preview.totals.changed > 0 ? `${formatNumber.format(preview.totals.changed)}개 한국어 셀을 갱신할 수 있습니다.` : '모든 한국어 셀이 최신 상태입니다.'}</h2><p>실행 직전에 변경 대상만 스냅샷으로 저장합니다. English, Chinese, Japanese, Spain 등 다른 언어 값은 수정하지 않습니다.</p></div>
        <button className="cw-button" data-variant="primary" disabled={busy || loading || preview.totals.changed === 0 || !config?.writesEnabled} onClick={onApply}>한국어 갱신 실행</button>
      </section>

      <section className="panel rules-panel sync-rules">
        <div className="rules-toolbar">
          <div><span>원본 비교 결과</span><h2>{formatNumber.format(visible.length)}개 표시 중</h2></div>
          <div className="filters">
            <label className="cw-form-field">비교 결과 검색<input className="cw-form-control" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="키, 값, 탭 검색" /></label>
            <label className="cw-form-field">비교 상태<select className="cw-form-control" value={status} onChange={(event) => setStatus(event.target.value as 'changed' | 'all')}><option value="changed">갱신 필요</option><option value="all">전체</option></select></label>
          </div>
        </div>
        <div className="cw-table-scroll" tabIndex={0} role="region" aria-label="시트 비교 결과 표">
          <table className="rules-table cw-data-table sync-table">
            <thead><tr><th>번역 키</th><th>원본 위치</th><th>최신 원문</th><th>대상 위치</th><th>현재 한국어</th><th>상태</th></tr></thead>
            <tbody>{visible.map((item) => <tr key={item.ruleId}>
              <td><strong>{item.key || '(키 없음)'}</strong><small>Korean</small></td>
              <td><span className="cell-tag source">{item.source.sheetTitle}</span><code>{item.source.cell}</code></td>
              <td className="value-cell" title={displayCellValue(item.source.value)}>{displayCellValue(item.source.value)}</td>
              <td><span className="cell-tag target">{item.target.sheetTitle}</span><code>{item.target.cell}</code></td>
              <td className="value-cell" title={displayCellValue(item.target.currentValue)}>{displayCellValue(item.target.currentValue)}</td>
              <td><span className={`sync-pill cw-state-pill ${item.status}`} data-tone={item.status === 'changed' ? 'warning' : 'success'}><i />{item.status === 'changed' ? '갱신 필요' : '최신'}</span></td>
            </tr>)}{visible.length === 0 && <tr><td colSpan={6}><WorkspaceState kind="empty" title="조건에 맞는 비교 결과가 없습니다." message="검색어나 비교 상태를 변경해 주세요." /></td></tr>}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>성능을 위해 검색 결과는 최대 300개까지 표시합니다.</span><strong>비교 시각 {formatDate.format(new Date(preview.createdAt))}</strong></div>
      </section>
    </>}
  </>;
}

function Snapshots({ snapshots }: { snapshots: Array<Omit<SnapshotRecord, 'entries'>> }) {
  const root = useRef<HTMLElement>(null);
  const disclosure = useWorkspaceDisclosure(root, { single: true });
  return <>
    <section className="page-title"><div><span className="eyebrow"><i /> RECOVERY POINTS</span><h1>스냅샷</h1><p>모든 쓰기 작업 이전의 수식과 값을 안전하게 보관합니다.</p></div></section>
    <section ref={root} className={snapshots.length ? 'panel snapshot-panel' : undefined}>
      {snapshots.length === 0 ? <WorkspaceState kind="empty" title="아직 생성된 스냅샷이 없습니다." message="첫 마이그레이션을 실행하면 복구 지점이 이곳에 표시됩니다." /> : snapshots.map((snapshot) => <article className="snapshot-row" key={snapshot.id}>
        <div className="snapshot-icon"><Icon name="snapshot" /></div>
        <div><strong>{snapshot.spreadsheetTitle}</strong><span>{formatDate.format(new Date(snapshot.createdAt))} · {formatNumber.format(snapshot.entryCount)}개 셀</span></div>
        <code>{snapshot.id.slice(0, 8)}</code>
        <button className="cw-button" type="button" disabled={!disclosure.ready} data-cw-disclosure={snapshot.id} data-cw-open-label="기록 정보 닫기" data-cw-closed-label="기록 정보">기록 정보</button>
        <div className="snapshot-details" data-cw-disclosure-panel={snapshot.id} hidden>
          <dl>
            <div><dt>기록 ID</dt><dd>{snapshot.id}</dd></div>
            <div><dt>작업 종류</dt><dd>{snapshot.kind === 'korean-sync' ? '한국어 원문 갱신' : snapshot.kind === 'migration' ? '수식 마이그레이션' : '이전 기록'}</dd></div>
            <div><dt>대상 문서 ID</dt><dd>{snapshot.spreadsheetId}</dd></div>
            <div><dt>분석 ID</dt><dd>{snapshot.analysisId}</dd></div>
            <div><dt>생성 시각</dt><dd>{formatDate.format(new Date(snapshot.createdAt))}</dd></div>
            <div><dt>보관 셀 수</dt><dd>{formatNumber.format(snapshot.entryCount)}</dd></div>
          </dl>
          <p>조회된 기록 정보입니다. 셀별 원문 조회나 복원은 실행하지 않습니다.</p>
        </div>
      </article>)}
    </section>
  </>;
}

function ComingSoon({ title }: { title: string }) {
  return <section className="panel coming-soon"><span><Icon name="release" /></span><p>다음 구현 단계</p><h1>{title}</h1><p>수식 마이그레이션 MVP 검증 후 연결됩니다.</p></section>;
}

export function App() {
  const { view, page, navigate } = useWorkspacePage(PAGES);
  const {config, analysis, snapshots, loading, initialized, error, syncPreview, syncLoading, syncError,
    invalid, analyze, initialize, previewKoreanSync, acceptRefreshed} = useSheetData(view);

  const actions = useSheetActions({view, config, analysis, preview:syncPreview, loading:loading || syncLoading,
    onRefreshed: acceptRefreshed,
  });

  const pageContent: Record<View, ReactNode> = {
    overview: <Overview analysis={analysis} loading={loading || actions.busy} onAnalyze={() => analyze()} setView={navigate} />,
    migration: <Migration analysis={analysis} config={config} loading={loading} busy={actions.busy || actions.needsRefresh} onAnalyze={() => analyze()} onMigrate={() => { void actions.run('migration'); }} />,
    snapshots: <Snapshots snapshots={snapshots} />,
    translations: <KoreanSync preview={syncPreview} loading={loading || syncLoading} busy={actions.busy || actions.needsRefresh} error={syncError} config={config} onPreview={previewKoreanSync} onApply={() => { void actions.run('translations'); }} />,
    releases: <ComingSoon title="개발 · 라이브 릴리스" />,
    ...additionalPages,
  };

  return <div className="app-shell">
    <WorkspaceNavigation service="sheet" />
    <main className="main-content">
      <header className="topbar">
        <div><strong data-route-title>{page.title}</strong><span className="breadcrumb">Dungeon Slasher <b>/</b> Localization</span></div>
        <div className="topbar-actions">
          {config && <span className="connection-badge cw-state-pill" data-tone={config.mode === 'google' ? 'success' : 'warning'}><i />{config.mode === 'google' ? 'Google 연결됨' : '데모 모드'}</span>}
          {analysis && <a href={analysis.spreadsheet.url} target="_blank" rel="noreferrer" className="source-link">원본 열기 <Icon name="external" /></a>}
        </div>
      </header>
      <div className="workspace">
        {invalid ? <WorkspaceState kind="denied" title="로그인 상태 또는 접근 권한이 변경되었습니다." message="이전 계정의 시트 정보는 표시하지 않습니다. 페이지를 다시 열어 현재 권한을 확인해 주세요. 실행 요청은 자동 반복하지 않습니다." actionLabel="페이지 다시 열기" onAction={() => window.location.reload()} /> : <>
        {actions.outcome && <WorkspaceState {...actions.outcome} actionLabel={actions.needsRefresh && !actions.busy ? "데이터 다시 확인" : undefined} onAction={() => { void actions.refresh(); }} />}
        {error && <WorkspaceState kind="error" title="시트 정보를 불러오지 못했습니다." message={error} actionLabel={actions.busy ? undefined : "다시 시도"} onAction={() => { void (initialized ? analyze() : initialize()); }} />}
        {loading && !analysis ? <WorkspaceState kind="loading" message="Google Sheets 구조를 분석하고 있습니다…" /> : initialized && <div data-workspace-view={view}>{pageContent[view]}</div>}
        </>}
      </div>
    </main>
  </div>;
}
