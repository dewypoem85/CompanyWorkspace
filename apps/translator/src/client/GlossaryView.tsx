import { useState, useEffect, useMemo } from 'react';
import { api } from './api';

interface GlossaryRow {
  id: number;
  Korean: string;
  English: string;
  Japanese: string;
  Chinese: string;
  'Chinese (Taiwan)': string;
  Spain: string;
  _isNew?: boolean;
}

export function GlossaryView() {
  const [headers, setHeaders] = useState<string[]>([
    'Korean',
    'English',
    'Japanese',
    'Chinese',
    'Chinese (Taiwan)',
    'Spain',
  ]);
  const [rows, setRows] = useState<GlossaryRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [syncedFromSheet, setSyncedFromSheet] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 페이지네이션
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // 용어집 데이터 로드
  const loadData = async (refresh = false) => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.getGlossary(refresh);
      if (res.success) {
        if (res.headers && res.headers.length > 0) setHeaders(res.headers);
        setRows((res.rows as GlossaryRow[]) || []);
        setSyncedFromSheet(Boolean(res.synced_from_sheet));
        setIsDirty(false);
      } else {
        setMessage({ type: 'error', text: '용어집 데이터를 불러오지 못했습니다.' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '용어집 로드 실패' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(false);
  }, []);

  // 셀 값 수정
  const handleCellChange = (id: number, field: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          return { ...r, [field]: value };
        }
        return r;
      })
    );
    setIsDirty(true);
  };

  // 새 행 추가
  const handleAddRow = () => {
    const nextId = rows.length > 0 ? Math.max(...rows.map((r) => r.id)) + 1 : 1;
    const newRow: GlossaryRow = {
      id: nextId,
      Korean: '',
      English: '',
      Japanese: '',
      Chinese: '',
      'Chinese (Taiwan)': '',
      Spain: '',
      _isNew: true,
    };
    setRows([newRow, ...rows]);
    setIsDirty(true);
    setPage(1);
  };

  // 행 삭제
  const handleDeleteRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setIsDirty(true);
  };

  // 저장 실행
  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      // 빈 한국어 원문 제외 필터링
      const cleanRows = rows.filter((r) => r.Korean && r.Korean.trim());
      if (cleanRows.length === 0) {
        setMessage({ type: 'error', text: '저장할 유효한 용어 항목이 없습니다.' });
        return;
      }

      const res = await api.saveGlossary({ headers, rows: cleanRows });
      if (res.success) {
        setMessage({
          type: 'success',
          text: res.message || '용어집이 성공적으로 저장 및 구글 시트에 동기화되었습니다.',
        });
        setIsDirty(false);
        setSyncedFromSheet(Boolean(res.sheet_synced));
      } else {
        setMessage({ type: 'error', text: res.message || '용어집 저장 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '용어집 저장 중 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  // 검색 필터링
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      headers.some((h) => {
        const val = String((r as any)[h] || '').toLowerCase();
        return val.includes(q);
      })
    );
  }, [rows, headers, searchQuery]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  if (loading && rows.length === 0) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>용어집 데이터를 불러오고 있습니다…</div>;
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* 1. 상단 타이틀 및 액션 바 */}
      <section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.6rem' }}>📖 I2 공식 용어집 (Glossary) 관리</h1>
            {syncedFromSheet ? (
              <span className="cw-state-pill" data-tone="success">
                <i></i> 구글 시트 실시간 연결
              </span>
            ) : (
              <span className="cw-state-pill" data-tone="warning">
                <i></i> 로컬 캐시 동기화
              </span>
            )}
            {isDirty && (
              <span className="cw-state-pill" data-tone="warning">
                <i></i> 변경 사항 있음 (미저장)
              </span>
            )}
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--cw-muted)', fontSize: '0.92rem' }}>
            던전슬래셔 공식 다국어 용어집입니다. 웹에서 셀을 직접 편집하거나 추가/삭제 후 저장하면 구글 시트와 로컬 AI 검수 엔진에 즉시 반영됩니다.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="cw-button"
            onClick={() => void loadData(true)}
            disabled={loading}
            title="구글 시트의 최신 원본 용어집을 강제로 다시 가져옵니다."
          >
            {loading ? '⏳ 동기화 중…' : '🔄 시트 새로고침'}
          </button>
          <a
            href="https://docs.google.com/spreadsheets/d/1rrbDpylaH9580GkUYtrXEqNGr0OHuzIFQNlsSzK7QPI/edit#gid=181735466"
            target="_blank"
            rel="noreferrer"
            className="cw-button"
          >
            🔗 구글 시트 원본 ↗
          </a>
          <button type="button" className="cw-button" onClick={handleAddRow}>
            ➕ 새 용어 추가
          </button>
          <button
            type="button"
            className="cw-button"
            data-variant="primary"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? '저장 및 동기화 중…' : '💾 용어집 저장 및 시트 동기화'}
          </button>
        </div>
      </section>

      {/* 안내 / 에러 메시지 */}
      {message && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '6px',
            background: message.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'var(--cw-danger-bg)',
            color: message.type === 'success' ? '#22c55e' : 'var(--cw-danger)',
            border: `1px solid ${message.type === 'success' ? '#22c55e' : 'var(--cw-danger-line)'}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* 2. 검색 및 컨트롤 툴바 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '280px', maxWidth: '480px' }}>
          <input
            type="text"
            className="cw-form-control"
            placeholder="🔍 한국어 원문 또는 번역어 실시간 검색..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>
          총 <strong>{filteredRows.length}</strong>개 항목 (페이지 {page} / {totalPages})
        </div>
      </div>

      {/* 3. 용어집 편집 데이터 테이블 */}
      <div
        style={{
          background: 'var(--cw-surface)',
          border: '1px solid var(--cw-line)',
          borderRadius: '8px',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ background: 'var(--cw-raised)', borderBottom: '1px solid var(--cw-line)' }}>
              <th style={{ padding: '12px 14px', width: '50px', color: 'var(--cw-muted)' }}>#</th>
              <th style={{ padding: '12px 14px', minWidth: '150px' }}>
                <span style={{ color: 'var(--cw-accent)', fontWeight: 600 }}>한국어 원문 (Korean)</span>
              </th>
              <th style={{ padding: '12px 14px', minWidth: '160px' }}>English</th>
              <th style={{ padding: '12px 14px', minWidth: '160px' }}>Japanese</th>
              <th style={{ padding: '12px 14px', minWidth: '150px' }}>Chinese (간체)</th>
              <th style={{ padding: '12px 14px', minWidth: '150px' }}>Chinese (번체)</th>
              <th style={{ padding: '12px 14px', minWidth: '160px' }}>Spain</th>
              <th style={{ padding: '12px 14px', width: '70px', textAlign: 'center' }}>작업</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--cw-muted)' }}>
                  검색 결과와 일치하는 용어가 없습니다.
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: '1px solid var(--cw-line)',
                    background: row._isNew ? 'rgba(64, 85, 216, 0.05)' : undefined,
                  }}
                >
                  <td style={{ padding: '8px 14px', color: 'var(--cw-muted)', fontSize: '0.82rem' }}>
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row.Korean || ''}
                      onChange={(e) => handleCellChange(row.id, 'Korean', e.target.value)}
                      placeholder="원문 단어"
                      style={{ fontWeight: 600, width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row.English || ''}
                      onChange={(e) => handleCellChange(row.id, 'English', e.target.value)}
                      placeholder="English"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row.Japanese || ''}
                      onChange={(e) => handleCellChange(row.id, 'Japanese', e.target.value)}
                      placeholder="Japanese"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row.Chinese || ''}
                      onChange={(e) => handleCellChange(row.id, 'Chinese', e.target.value)}
                      placeholder="Chinese"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row['Chinese (Taiwan)'] || ''}
                      onChange={(e) => handleCellChange(row.id, 'Chinese (Taiwan)', e.target.value)}
                      placeholder="Chinese (Taiwan)"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <input
                      type="text"
                      className="cw-form-control"
                      value={row.Spain || ''}
                      onChange={(e) => handleCellChange(row.id, 'Spain', e.target.value)}
                      placeholder="Spain"
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <button
                      type="button"
                      className="cw-button"
                      style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--cw-danger)' }}
                      onClick={() => handleDeleteRow(row.id)}
                      title="용어 삭제"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 4. 페이지네이션 바 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            className="cw-button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            ◀ 이전
          </button>
          <span style={{ fontSize: '0.9rem', color: 'var(--cw-muted)', padding: '0 8px' }}>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="cw-button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            다음 ▶
          </button>
        </div>
      )}
    </div>
  );
}
