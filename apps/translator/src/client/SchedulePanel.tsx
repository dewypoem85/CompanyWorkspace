import { useEffect, useRef, useState } from 'react';
import { api, DEFAULT_TEST_SHEET_URL, type ScheduleConfig, type ScheduleRunRecord, type ScheduleSnapshot } from './api';

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const LANG_OPTIONS = ['ENG', 'JPN', 'CHS', 'CHT', 'SPA', 'GER'];
const ALL_SHEETS_LABEL = '[전체 공식 시트 일괄 검수]';

const OPERATION_LABEL: Record<ScheduleConfig['operation_mode'], string> = {
  fill_empty: '⚡ 비어 있는 칸만 채우기 (시트에 번역 기록)',
  inspect_only: '📋 전수 검사 — 확인만 (시트 수정 안 함, 엑셀 보고서 생성)',
  audit_apply: '✏️ 전수 검사 + 적용 (오역을 시트에 바로 덮어쓰기)',
};

const STATUS_TONE: Record<ScheduleRunRecord['status'], 'success' | 'warning' | 'danger' | 'info'> = {
  success: 'success',
  started: 'info',
  'dry-run': 'info',
  skipped: 'warning',
  error: 'danger',
};

const STATUS_LABEL: Record<ScheduleRunRecord['status'], string> = {
  success: '완료',
  started: '시작됨',
  'dry-run': '시뮬레이션',
  skipped: '건너뜀',
  error: '오류',
};

const TRIGGER_LABEL: Record<ScheduleRunRecord['trigger'], string> = {
  schedule: '예약',
  manual: '수동',
  'dry-run': '시뮬레이션',
};

const OPERATION_SHORT: Record<ScheduleConfig['operation_mode'], string> = {
  fill_empty: '빈칸 채우기',
  inspect_only: '확인만',
  audit_apply: '검사+적용',
};

function fmtDuration(sec: number | undefined): string {
  if (sec === undefined) return '-';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function shortTarget(target: string | undefined): string {
  if (!target) return '-';
  // 시트 주소는 ID 앞부분만 보여주고 전체는 마우스를 올리면 표시
  const m = /^(테스트 시트: ).*\/d\/([\w-]{1,10})/.exec(target);
  return m ? `${m[1]}…${m[2]}` : target;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { hour12: false });
}

export function SchedulePanel({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [cfg, setCfg] = useState<ScheduleConfig | null>(null);
  const [snap, setSnap] = useState<ScheduleSnapshot | null>(null);
  const [sheets, setSheets] = useState<Array<{ name: string; url: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  const applySnapshot = (s: ScheduleSnapshot, keepForm = false) => {
    setSnap(s);
    if (!keepForm) {
      const loaded = s.schedule;
      if (loaded.mode === 'test' && !loaded.test_sheet_url.trim()) {
        setCfg({ ...loaded, test_sheet_url: DEFAULT_TEST_SHEET_URL });
        setDirty(true);
      } else {
        setCfg(loaded);
        setDirty(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const s = await api.getSchedule();
        if (mounted) applySnapshot(s, dirtyRef.current);
      } catch (err: any) {
        if (mounted) setMessage({ type: 'error', text: err.message || '스케줄을 불러오지 못했습니다.' });
      }
    };
    void load();
    // 이력/다음 실행 시각 갱신 (편집 중인 입력값은 덮어쓰지 않음)
    const timer = window.setInterval(() => void load(), 10_000);
    api
      .getSheets(false)
      .then((r) => {
        if (mounted && r?.sheets) setSheets(r.sheets.map((x) => ({ name: x.name, url: x.url })));
      })
      .catch(() => {});
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!cfg) {
    return (
      <section className="panel" style={{ margin: '24px 0', padding: '24px', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
        <strong>⏰ 자동 번역 스케줄</strong>
        <p style={{ color: 'var(--cw-muted)' }}>{message?.text || '불러오는 중…'}</p>
      </section>
    );
  }

  const update = (patch: Partial<ScheduleConfig>) => {
    setCfg({ ...cfg, ...patch });
    setDirty(true);
    setMessage(null);
  };

  const toggleDay = (d: number) => {
    const has = cfg.days.includes(d);
    const next = has ? cfg.days.filter((x) => x !== d) : [...cfg.days, d].sort();
    update({ days: next });
  };

  const toggleLang = (code: string) => {
    const has = cfg.languages.includes(code);
    update({ languages: has ? cfg.languages.filter((x) => x !== code) : [...cfg.languages, code] });
  };

  const selectSheet = (name: string) => {
    if (name === ALL_SHEETS_LABEL) {
      update({ sheet_name: name, sheet_url: 'ALL_OFFICIAL_I2_SHEETS' });
      return;
    }
    const found = sheets.find((s) => s.name === name);
    update({ sheet_name: name, sheet_url: found?.url || '' });
  };

  const save = async () => {
    if (cfg.days.length === 0) {
      setMessage({ type: 'error', text: '실행 요일을 하나 이상 선택해 주세요.' });
      return;
    }
    try {
      setBusy(true);
      const s = await api.saveSchedule(cfg);
      applySnapshot(s);
      setMessage({ type: 'success', text: cfg.enabled ? '✅ 스케줄이 저장되었습니다.' : '✅ 저장되었습니다. (스케줄 꺼짐)' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '스케줄 저장 실패' });
    } finally {
      setBusy(false);
    }
  };

  const run = async (dryRun: boolean) => {
    if (dirty) {
      setMessage({ type: 'error', text: '변경한 내용을 먼저 저장해 주세요. 저장된 설정으로 실행합니다.' });
      return;
    }
    if (!dryRun) {
      const ok = window.confirm(
        `지금 저장된 스케줄 설정으로 번역 작업을 실제로 시작합니다.\n\n작업 방식: ${OPERATION_LABEL[cfg.operation_mode]}\n\n계속할까요?`
      );
      if (!ok) return;
    }
    try {
      setBusy(true);
      const s = await api.runSchedule(dryRun);
      applySnapshot(s, false);
      const r = s.result;
      if (r) {
        setMessage({ type: r.status === 'error' ? 'error' : r.status === 'skipped' ? 'info' : 'success', text: r.message });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '실행 실패' });
    } finally {
      setBusy(false);
    }
  };

  // 테스트용: 서버 시각 기준 N분 뒤로 예약 시각 설정 (오늘 요일 포함)
  const setSoon = (minutes: number) => {
    const base = snap?.server_time ? new Date(snap.server_time) : new Date();
    const d = new Date(base.getTime() + minutes * 60_000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const days = cfg.days.includes(d.getDay()) ? cfg.days : [...cfg.days, d.getDay()].sort();
    update({ enabled: true, time: `${hh}:${mm}`, days });
  };

  const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '6px' };
  const noticeColor = message?.type === 'error' ? 'var(--cw-danger)' : message?.type === 'success' ? '#22c55e' : 'var(--cw-muted)';

  return (
    <section className="panel" style={{ margin: '24px 0', padding: '24px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
        <h3 style={{ margin: 0 }}>⏰ 자동 번역 스케줄</h3>
        <span className="cw-state-pill" data-tone={cfg.enabled && !dirty ? 'success' : 'info'}>
          <i></i> {cfg.enabled ? '사용 중' : '꺼짐'}
        </span>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
        정해진 시각에 번역/검수 작업을 자동으로 시작합니다. 이 웹 서버(<code>run_web.bat</code>)가 켜져 있는 동안에만 동작하며, 시각은 서버 PC 기준입니다.
      </p>

      <label className="cw-check-control" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px' }}>
        <input type="checkbox" className="cw-checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <strong>자동 실행 사용</strong>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <label style={fieldStyle}>
          <strong>실행 시각</strong>
          <input type="time" className="cw-form-control" value={cfg.time} onChange={(e) => update({ time: e.target.value })} />
        </label>

        <div style={fieldStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <strong>실행 요일</strong>
            <button type="button" className="cw-button" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => update({ days: [0, 1, 2, 3, 4, 5, 6] })}>
              전체 선택
            </button>
            <button type="button" className="cw-button" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => update({ days: [] })}>
              전체 해제
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                className="cw-button"
                data-variant={cfg.days.includes(d) ? 'primary' : undefined}
                aria-pressed={cfg.days.includes(d)}
                style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                onClick={() => toggleDay(d)}
              >
                {label}
              </button>
            ))}
          </div>
          {cfg.days.length === 0 && <small style={{ color: 'var(--cw-danger)' }}>요일을 하나 이상 선택해야 저장할 수 있습니다.</small>}
        </div>

        <label style={fieldStyle}>
          <strong>대상</strong>
          <select className="cw-form-control" value={cfg.mode} onChange={(e) => {
              const mode = e.target.value as 'main' | 'test';
              update(mode === 'test' && !cfg.test_sheet_url.trim() ? { mode, test_sheet_url: DEFAULT_TEST_SHEET_URL } : { mode });
            }}>
            <option value="main">메인 — I2 공식 시트</option>
            <option value="test">테스트 — 구글 시트 주소 직접 지정</option>
          </select>
        </label>

        {cfg.mode === 'main' ? (
          <label style={fieldStyle}>
            <strong>번역할 시트</strong>
            <select className="cw-form-control" value={cfg.sheet_name} onChange={(e) => selectSheet(e.target.value)}>
              <option value="">시트를 선택하세요</option>
              {cfg.sheet_name && !sheets.some((s) => s.name === cfg.sheet_name) && cfg.sheet_name !== ALL_SHEETS_LABEL && (
                <option value={cfg.sheet_name}>{cfg.sheet_name}</option>
              )}
              <option value={ALL_SHEETS_LABEL}>{ALL_SHEETS_LABEL}</option>
              {sheets
                .filter((s) => !s.name.includes('전체'))
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
            {sheets.length === 0 && (
              <small style={{ color: 'var(--cw-muted)' }}>시트 목록을 불러오지 못했습니다. 서비스 계정 키와 I2 연동을 먼저 확인해 주세요.</small>
            )}
          </label>
        ) : (
          <label style={fieldStyle}>
            <strong>구글 시트 주소</strong>
            <small style={{ color: 'var(--cw-muted)' }}>비워 두고 저장할 수 없습니다. 테스트 모드 화면과 같은 기본 시트로 채워져 있습니다.</small>
            <input
              type="url"
              className="cw-form-control"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={cfg.test_sheet_url}
              onChange={(e) => update({ test_sheet_url: e.target.value })}
            />
          </label>
        )}

        <label style={{ ...fieldStyle, gridColumn: 'span 2' }}>
          <strong>작업 방식</strong>
          <select
            className="cw-form-control"
            value={cfg.operation_mode}
            onChange={(e) => update({ operation_mode: e.target.value as ScheduleConfig['operation_mode'] })}
          >
            {(Object.keys(OPERATION_LABEL) as Array<ScheduleConfig['operation_mode']>).map((k) => (
              <option key={k} value={k}>
                {OPERATION_LABEL[k]}
              </option>
            ))}
          </select>
          {cfg.operation_mode !== 'inspect_only' && (
            <small style={{ color: '#eab308' }}>⚠️ 이 방식은 예약 실행 때 구글 시트를 수정합니다. 먼저 테스트 모드나 확인만 방식으로 점검하세요.</small>
          )}
        </label>
      </div>

      <div style={{ ...fieldStyle, marginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <strong>번역 대상 언어</strong>
          <button type="button" className="cw-button" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => update({ languages: [...LANG_OPTIONS] })}>
            전체 선택
          </button>
          <button type="button" className="cw-button" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => update({ languages: [] })}>
            전체 해제
          </button>
        </div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          {LANG_OPTIONS.map((code) => (
            <label key={code} className="cw-check-control" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input type="checkbox" className="cw-checkbox" checked={cfg.languages.includes(code)} onChange={() => toggleLang(code)} />
              <span>{code}</span>
            </label>
          ))}
          <small style={{ color: 'var(--cw-muted)' }}>{cfg.languages.length === 0 ? '선택 없음 = 시트에서 감지된 모든 언어' : `${cfg.languages.length}개 선택`}</small>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '20px' }}>
        <button type="button" className="cw-button" data-variant="primary" onClick={save} disabled={busy || !dirty}>
          {busy ? '처리 중…' : '💾 스케줄 저장'}
        </button>
        <button type="button" className="cw-button" onClick={() => run(true)} disabled={busy} title="번역 엔진을 시작하지 않고, 저장된 설정으로 어떤 작업이 시작될지만 확인합니다.">
          🧪 시뮬레이션 실행
        </button>
        <button
          type="button"
          className="cw-button"
          onClick={() => run(false)}
          disabled={busy || snap?.running}
          title="저장된 설정으로 지금 즉시 번역 작업을 시작합니다."
        >
          ▶ 지금 실제 실행
        </button>
        <span style={{ color: 'var(--cw-muted)', fontSize: '0.8rem' }}>예약 테스트:</span>
        {[1, 2].map((m) => (
          <button key={m} type="button" className="cw-button" style={{ padding: '4px 10px', fontSize: '0.82rem' }} onClick={() => setSoon(m)} disabled={busy}>
            {m}분 뒤로 설정
          </button>
        ))}
      </div>

      {message && <p style={{ margin: '12px 0 0', fontSize: '0.88rem', color: noticeColor }}>{message.text}</p>}

      <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--cw-muted)', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <span>
          다음 실행: <strong style={{ color: 'var(--cw-text)' }}>{snap?.schedule.enabled ? fmt(snap?.next_run) : '꺼짐'}</strong>
        </span>
        <span>서버 시각: {fmt(snap?.server_time)}</span>
        {snap?.running && <span style={{ color: '#eab308' }}>● 번역 작업 진행 중</span>}
      </div>

      {snap && snap.history.length > 0 && (
        <div style={{ marginTop: '14px', overflowX: 'auto' }}>
          <table className="cw-table" style={{ width: '100%', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>시각</th>
                <th style={{ textAlign: 'left' }}>구분</th>
                <th style={{ textAlign: 'left' }}>결과</th>
                <th style={{ textAlign: 'left' }}>대상</th>
                <th style={{ textAlign: 'left' }}>작업 방식</th>
                <th style={{ textAlign: 'left' }}>언어</th>
                <th style={{ textAlign: 'left' }}>소요</th>
                <th style={{ textAlign: 'left' }}>내용</th>
              </tr>
            </thead>
            <tbody>
              {snap.history.map((h, i) => (
                <tr key={`${h.at}-${i}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmt(h.at)}</td>
                  <td>{TRIGGER_LABEL[h.trigger]}</td>
                  <td>
                    <span className="cw-state-pill" data-tone={STATUS_TONE[h.status]}>
                      <i></i> {STATUS_LABEL[h.status]}
                    </span>
                  </td>
                  <td title={h.target || ''}>{shortTarget(h.target)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{h.operation_mode ? OPERATION_SHORT[h.operation_mode] : '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{h.languages ? (h.languages.length ? h.languages.join(', ') : '전체') : '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDuration(h.duration_sec)}</td>
                  <td>{h.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
