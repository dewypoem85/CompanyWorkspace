import { useState, useEffect, useRef } from 'react';
import { SchedulePanel } from './SchedulePanel';
import { api } from './api';

export type SettingsTab = 'connection' | 'ai' | 'schedule';

export const SETTINGS_TAB_KEY = 'smart-translator.settings-tab';

export const SETTINGS_TABS: Array<{ id: SettingsTab; icon: string; label: string; desc: string }> = [
  { id: 'connection', icon: '🔗', label: '데이터 연결', desc: '시트 주소 · 서비스 계정 키' },
  { id: 'ai', icon: '🤖', label: 'AI 모델', desc: 'API 키 · 인증 테스트' },
  { id: 'schedule', icon: '⏰', label: '자동 실행', desc: '예약 번역 · 실행 기록' },
];

export function readSavedTab(): SettingsTab {
  try {
    const v = window.localStorage.getItem(SETTINGS_TAB_KEY);
    if (v === 'connection' || v === 'ai' || v === 'schedule') return v;
  } catch {}
  return 'connection';
}

interface SettingsViewProps {
  onConfigSaved?: () => void;
  // 사이드바 서브 메뉴에서 선택한 설정 탭
  tab: SettingsTab;
  // 탭별 저장하지 않은 변경 여부를 사이드바에 알림
  onDirtyChange?: (dirty: Record<SettingsTab, boolean>) => void;
}

export function SettingsView({ onConfigSaved, tab, onDirtyChange }: SettingsViewProps) {
  const [savedSheetUrl, setSavedSheetUrl] = useState<string>('');
  const [scheduleDirty, setScheduleDirty] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // API 키 입력 필드 (비밀번호 형식, 복사 불가)
  const [claudeKey, setClaudeKey] = useState<string>('');
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [openaiKey, setOpenaiKey] = useState<string>('');

  // 현재 설정 여부 (정식 포맷 검증 통과 여부)
  const [keyStatus, setKeyStatus] = useState<{
    claude: boolean;
    gemini: boolean;
    openai: boolean;
  }>({ claude: false, gemini: false, openai: false });

  // 키 테스트 결과 메시지
  const [testResults, setTestResults] = useState<{
    claude?: { ok: boolean; msg: string };
    gemini?: { ok: boolean; msg: string };
    openai?: { ok: boolean; msg: string };
  }>({});

  // 서비스 계정 키 상태
  const [serviceAccounts, setServiceAccounts] = useState<
    Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>
  >([]);
  const [activeSa, setActiveSa] = useState<{
    filename: string;
    project_id: string;
    client_email: string;
    is_active: boolean;
  } | null>(null);
  const [targetSheetUrl, setTargetSheetUrl] = useState<string>('');
  const [savingSheetUrl, setSavingSheetUrl] = useState<boolean>(false);
  const [uploadingSa, setUploadingSa] = useState<boolean>(false);
  const [deletingSa, setDeletingSa] = useState<boolean>(false);
  const [testingSa, setTestingSa] = useState<boolean>(false);
  const [switchingSa, setSwitchingSa] = useState(false);
  const [saTestResult, setSaTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  // 용어집 시트 주소 (빈 값 = 기본 용어집). 저장하려면 현재 입력값으로 연결 테스트를 통과해야 함
  const [glossaryUrl, setGlossaryUrl] = useState<string>('');
  const [savedGlossaryUrl, setSavedGlossaryUrl] = useState<string>('');
  const [testingGlossary, setTestingGlossary] = useState(false);
  const [savingGlossary, setSavingGlossary] = useState(false);
  const [glossaryTest, setGlossaryTest] = useState<
    | { url: string; ok: true; title: string; tab: string; link: string; total: number; languages: string[]; warnings: string[] }
    | { url: string; ok: false; error: string }
    | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 초기 설정 및 서비스 계정 목록 로드
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const [configRes, saRes] = await Promise.all([
          api.getConfig().catch(() => ({ success: false, config: null })),
          api.getServiceAccounts().catch(() => ({ success: false, active: null, accounts: [] })),
        ]);
        if (!mounted) return;
        if (configRes.success && configRes.config) {
          const cfg = configRes.config;
          setKeyStatus({
            claude: Boolean(cfg.claude_api_key_set),
            gemini: Boolean(cfg.gemini_api_key_set),
            openai: Boolean(cfg.openai_api_key_set),
          });
          setTargetSheetUrl(cfg.target_sheet_url || '');
          setSavedSheetUrl(cfg.target_sheet_url || '');
          setGlossaryUrl(cfg.glossary_sheet_url || '');
          setSavedGlossaryUrl(cfg.glossary_sheet_url || '');
        }
        if (saRes.success) {
          setServiceAccounts(saRes.accounts || []);
          setActiveSa(saRes.active || null);
        }
        // 새로고침 후에도 선택한 키의 시트 접근 실패 상태를 보여줌 (느린 Python 조회라 화면 로딩을 막지 않고 백그라운드로 실행)
        if (saRes.success && saRes.active) {
          void api
            .getSheets(false)
            .then((sheetsRes: any) => {
              if (mounted && sheetsRes && sheetsRes.configured === false && sheetsRes.error) {
                setSaTestResult({ ok: false, msg: sheetsRes.error });
              }
            })
            .catch(() => {});
        }
      } catch (err: any) {
        if (mounted) setMessage({ type: 'error', text: err.message || '설정을 불러오지 못했습니다.' });
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  // 복사 / 잘라내기 차단 핸들러 (보안 강화)
  const blockClipboard = (e: React.ClipboardEvent) => {
    e.preventDefault();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);

      // 입력 형식 검증
      if (claudeKey.trim() && (!claudeKey.trim().startsWith('sk-ant-') || claudeKey.trim().length < 25)) {
        setMessage({ type: 'error', text: 'Anthropic Claude API 키는 "sk-ant-"로 시작해야 합니다.' });
        setSaving(false);
        return;
      }
      if (geminiKey.trim() && geminiKey.trim().startsWith('sk-')) {
        setMessage({ type: 'error', text: 'Google Gemini API 키로 OpenAI/Claude 키를 입력할 수 없습니다.' });
        setSaving(false);
        return;
      }
      if (openaiKey.trim() && (!openaiKey.trim().startsWith('sk-') || openaiKey.trim().startsWith('sk-ant-') || openaiKey.trim().length < 20)) {
        setMessage({ type: 'error', text: 'OpenAI API 키는 "sk-"로 시작해야 합니다. (Claude 키 제외)' });
        setSaving(false);
        return;
      }

      const payload: Record<string, string> = {};
      if (claudeKey.trim()) payload.claude_api_key = claudeKey.trim();
      if (geminiKey.trim()) payload.gemini_api_key = geminiKey.trim();
      if (openaiKey.trim()) payload.openai_api_key = openaiKey.trim();

      const res = await api.saveConfig(payload);
      if (res.success) {
        setMessage({
          type: 'success',
          text: '✅ API 키가 Windows DPAPI로 암호화되어 안전하게 저장되었습니다. (run_gui.bat 도구와 실시간 동기화)',
        });
        setClaudeKey('');
        setGeminiKey('');
        setOpenaiKey('');

        const refetched = await api.getConfig();
        if (refetched.success && refetched.config) {
          const cfg = refetched.config;
          setKeyStatus({
            claude: Boolean(cfg.claude_api_key_set),
            gemini: Boolean(cfg.gemini_api_key_set),
            openai: Boolean(cfg.openai_api_key_set),
          });
        }
        if (onConfigSaved) onConfigSaved();
      } else {
        setMessage({ type: 'error', text: res.message || '설정 저장 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '설정 저장 중 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  // 실시간 키 연결 테스트 실행
  const handleTestKey = async (provider: 'claude' | 'gemini' | 'openai') => {
    try {
      setTestingProvider(provider);
      setMessage(null);

      let keyToSend = '';
      if (provider === 'claude') keyToSend = claudeKey.trim();
      else if (provider === 'gemini') keyToSend = geminiKey.trim();
      else if (provider === 'openai') keyToSend = openaiKey.trim();

      const res = await api.testKey({ provider, key: keyToSend });
      setTestResults((prev) => ({
        ...prev,
        [provider]: { ok: res.success, msg: res.message || res.error || (res.success ? '인증 성공' : '호출 실패') },
      }));

      if (res.success) {
        setMessage({
          type: 'success',
          text: `🎉 [${provider.toUpperCase()}] API 키 테스트 성공: ${res.message}`,
        });
      } else {
        setMessage({
          type: 'error',
          text: `⚠️ [${provider.toUpperCase()}] API 키 테스트 실패: ${res.error || res.message}`,
        });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `키 테스트 중 오류 발생: ${err.message}` });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleDeleteKey = async (provider: 'claude' | 'gemini' | 'openai') => {
    try {
      setSaving(true);
      setMessage(null);
      const payload: Record<string, string> = {};
      if (provider === 'claude') payload.claude_api_key = 'DELETE';
      if (provider === 'gemini') payload.gemini_api_key = 'DELETE';
      if (provider === 'openai') payload.openai_api_key = 'DELETE';

      const res = await api.saveConfig(payload);
      if (res.success) {
        setMessage({ type: 'success', text: `✅ ${provider.toUpperCase()} API 키가 삭제되었습니다.` });
        if (provider === 'claude') setClaudeKey('');
        if (provider === 'gemini') setGeminiKey('');
        if (provider === 'openai') setOpenaiKey('');

        setTestResults((prev) => {
          const next = { ...prev };
          delete next[provider];
          return next;
        });

        const refetched = await api.getConfig();
        if (refetched.success && refetched.config) {
          const cfg = refetched.config;
          setKeyStatus({
            claude: Boolean(cfg.claude_api_key_set),
            gemini: Boolean(cfg.gemini_api_key_set),
            openai: Boolean(cfg.openai_api_key_set),
          });
        }
        if (onConfigSaved) onConfigSaved();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '키 삭제 실패' });
    } finally {
      setSaving(false);
    }
  };

  // 구글 서비스 계정 키 전환
  const handleSelectSa = async (filename: string) => {
    try {
      setSwitchingSa(true);
      setMessage(null);
      const res = await api.selectServiceAccount(filename);
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setMessage({ type: 'success', text: `✅ 구글 서비스 계정 키가 '${filename}'(으)로 전환되었습니다.` });
        if (onConfigSaved) onConfigSaved();
        // 키 전환 즉시 [연결 테스트]와 동일한 연결 검증 실행 (선택한 키 하나만 사용)
        if (targetSheetUrl.trim() || res.active) {
          await handleTestSa(filename);
        }
      } else {
        setMessage({ type: 'error', text: res.error || '서비스 계정 키 전환 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `서비스 계정 키 전환 실패: ${err.message}` });
    } finally {
      setSwitchingSa(false);
    }
  };

  // 새 구글 서비스 계정 키 파일 (.json) 업로드
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingSa(true);
      setMessage(null);
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        setMessage({ type: 'error', text: '선택한 파일이 올바른 JSON 형식이 아닙니다.' });
        return;
      }

      if (parsed.type !== 'service_account' || !parsed.client_email) {
        setMessage({
          type: 'error',
          text: 'Google Service Account 키 파일이 아닙니다. (type: "service_account", client_email 필수)',
        });
        return;
      }

      const res = await api.uploadServiceAccount({ filename: file.name, content: text });
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setMessage({
          type: 'success',
          text: `🎉 새 서비스 계정 키 '${res.active?.filename || file.name}' 업로드 및 즉시 적용 완료!`,
        });
        if (onConfigSaved) onConfigSaved();
      } else {
        setMessage({ type: 'error', text: res.error || '키 파일 업로드 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `키 파일 업로드 오류: ${err.message}` });
    } finally {
      setUploadingSa(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 구글 서비스 계정 키 및 시트 연동 권한 실시간 테스트
  const handleTestSa = async (filename?: string) => {
    try {
      setTestingSa(true);
      setSaTestResult(null);
      const target = filename || activeSa?.filename;
      const res = await api.testServiceAccount({
        filename: target,
        sheet_url: targetSheetUrl.trim(),
      });
      if (res.success) {
        setSaTestResult({ ok: true, msg: res.message || '시트 연동 인증 성공!' });
        if (onConfigSaved) onConfigSaved();
      } else {
        setSaTestResult({ ok: false, msg: res.error || res.message || '인증 실패' });
      }
    } catch (err: any) {
      setSaTestResult({ ok: false, msg: `테스트 실패: ${err.message}` });
    } finally {
      setTestingSa(false);
    }
  };

  // 구글 시트 URL 저장
  const handleSaveSheetUrl = async () => {
    try {
      setSavingSheetUrl(true);
      setMessage(null);
      const res = await api.saveConfig({ target_sheet_url: targetSheetUrl.trim() });
      if (res.success) {
        setSavedSheetUrl(targetSheetUrl.trim());
        setMessage({ type: 'success', text: '✅ 작업 대상 시트 주소가 저장되었습니다.' });
        if (onConfigSaved) onConfigSaved();
      } else {
        setMessage({ type: 'error', text: res.message || '시트 주소 저장 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `시트 주소 저장 오류: ${err.message}` });
    } finally {
      setSavingSheetUrl(false);
    }
  };

  // 용어집 시트 주소 연결 테스트 (읽기만 함)
  const handleTestGlossary = async () => {
    const url = glossaryUrl.trim();
    try {
      setTestingGlossary(true);
      setGlossaryTest(null);
      const res = await api.testGlossary(url);
      if (res.success && res.source) {
        setGlossaryTest({
          url,
          ok: true,
          title: res.source.sheet_title,
          tab: res.source.tab,
          link: res.source.url,
          total: res.total ?? 0,
          languages: res.languages || [],
          warnings: res.warnings || [],
        });
      } else {
        setGlossaryTest({ url, ok: false, error: res.error || '용어집 시트를 확인하지 못했습니다.' });
      }
    } catch (err: any) {
      setGlossaryTest({ url, ok: false, error: `테스트 실패: ${err.message}` });
    } finally {
      setTestingGlossary(false);
    }
  };

  // 용어집 시트 주소 저장 (현재 입력값으로 테스트를 통과한 경우에만)
  const glossaryTestedOk = glossaryTest?.ok === true && glossaryTest.url === glossaryUrl.trim();
  const handleSaveGlossaryUrl = async () => {
    if (!glossaryTestedOk) return;
    try {
      setSavingGlossary(true);
      setMessage(null);
      const res = await api.saveConfig({ glossary_sheet_url: glossaryUrl.trim() });
      if (res.success) {
        setSavedGlossaryUrl(glossaryUrl.trim());
        setMessage({ type: 'success', text: glossaryUrl.trim() ? '✅ 용어집 시트 주소가 저장되었습니다.' : '✅ 기본 용어집을 사용하도록 저장되었습니다.' });
        if (onConfigSaved) onConfigSaved();
      } else {
        setMessage({ type: 'error', text: (res as any).error || res.message || '용어집 시트 주소 저장 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `용어집 시트 주소 저장 오류: ${err.message}` });
    } finally {
      setSavingGlossary(false);
    }
  };

  // 구글 서비스 계정 키 파일 삭제
  const handleDeleteSa = async (filename?: string) => {
    const target = filename || activeSa?.filename;
    if (!target) return;
    if (!window.confirm(`선택한 구글 서비스 계정 키 파일('${target}')을 웹에서 삭제하시겠습니까?`)) {
      return;
    }
    try {
      setDeletingSa(true);
      setMessage(null);
      const res = await api.deleteServiceAccount(target);
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setSaTestResult(null);
        setMessage({ type: 'success', text: `✅ 서비스 계정 키 '${target}'(이)가 삭제되었습니다.` });
        if (onConfigSaved) onConfigSaved();
      } else {
        setMessage({ type: 'error', text: res.error || '서비스 계정 키 삭제 실패' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `키 삭제 오류: ${err.message}` });
    } finally {
      setDeletingSa(false);
    }
  };

  const dirtyByTab: Record<SettingsTab, boolean> = {
    connection: targetSheetUrl.trim() !== savedSheetUrl.trim() || glossaryUrl.trim() !== savedGlossaryUrl.trim(),
    ai: Boolean(claudeKey.trim() || geminiKey.trim() || openaiKey.trim()),
    schedule: scheduleDirty,
  };

  const dirtyKey = `${dirtyByTab.connection}|${dirtyByTab.ai}|${dirtyByTab.schedule}`;
  useEffect(() => {
    onDirtyChange?.(dirtyByTab);
  }, [dirtyKey]);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>환경 설정을 로드하고 있습니다…</div>;
  }

  return (
    <div className="settings-content">
      <div hidden={tab !== 'connection'}>
      {/* 1. 구글 스프레드시트 및 유니티 I2 연동 설정 (주소 & 키 관리) 섹션 */}
      <section className="panel" style={{ marginBottom: '24px', padding: '24px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🔗 데이터 연결 — 시트 주소와 인증 키
            </h2>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--cw-muted)' }}>
              번역 및 검수를 수행할 구글 스프레드시트 URL 또는 유니티 I2 웹서비스 주소를 설정합니다.
            </p>
          </div>
          <span className="cw-state-pill" data-tone="info">
            <i></i> 시트 주소 & 인증 키 관리
          </span>
        </div>

        {/* 1) 작업 대상 시트 주소 (Google Sheet URL 또는 I2 웹서비스 URL) 입력 박스 - 최상단 배치 */}
        <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--cw-line)', borderRadius: '6px', marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, marginBottom: '8px' }}>
            🌐 작업 대상 시트 주소 (구글 스프레드시트 URL 또는 유니티 I2 웹서비스 URL)
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="cw-form-control"
              style={{ flex: 1, minWidth: '320px' }}
              placeholder="https://script.google.com/macros/s/.../exec 또는 https://docs.google.com/spreadsheets/d/..."
              value={targetSheetUrl}
              onChange={(e) => setTargetSheetUrl(e.target.value)}
            />
            <button
              type="button"
              className="cw-button"
              data-variant="primary"
              onClick={handleSaveSheetUrl}
              disabled={savingSheetUrl || !targetSheetUrl.trim()}
              title="입력한 시트 주소를 환경 설정에 저장합니다."
            >
              {savingSheetUrl ? '저장 중…' : '💾 주소 저장'}
            </button>
            <button
              type="button"
              className="cw-button"
              onClick={() => handleTestSa()}
              disabled={testingSa || (!targetSheetUrl.trim() && !activeSa)}
              title="입력된 I2 웹서비스 URL 또는 구글 스프레드시트의 실시간 연동 상태를 테스트합니다."
            >
              {testingSa ? '⏳ 연결 검증 중…' : '🔍 연결 테스트'}
            </button>
          </div>

          <div style={{ marginTop: '10px', fontSize: '0.84rem', color: 'var(--cw-text-soft)', lineHeight: 1.6 }}>
            <div>
              <strong>🌐 유니티 I2 Web Service</strong>: 유니티 I2 Localization Web App URL(<code>script.google.com/.../exec</code>) 입력 시, 서비스 계정 키 파일(.json) 없이도 공식 시트 10종이 자동 연동됩니다.
            </div>
            <div>
              <strong>📄 일반 구글 스프레드시트</strong>: 개별 구글 시트 URL(<code>docs.google.com/spreadsheets/d/...</code>) 입력 시, 아래 등록된 서비스 계정 키(.json)를 통해 비공개 시트의 각 탭을 안전하게 연동합니다.
            </div>
          </div>

          {saTestResult && (
            <div style={{ marginTop: '12px', padding: '10px 14px', background: saTestResult.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `1px solid ${saTestResult.ok ? '#22c55e' : 'var(--cw-danger)'}`, borderRadius: '6px', fontSize: '0.85rem', color: saTestResult.ok ? '#22c55e' : 'var(--cw-danger)' }}>
              {saTestResult.ok ? '✅ ' : '⚠️ '}{saTestResult.msg}
            </div>
          )}
        </div>

        {/* 1-1) 용어집 시트 주소: 번역·검수 파이프라인과 용어집 화면이 함께 사용 */}
        <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--cw-line)', borderRadius: '6px', marginBottom: '16px' }}>
          <label htmlFor="glossary-sheet-url" style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, marginBottom: '8px' }}>
            📖 용어집 시트 주소 (번역·검수 시 강제 적용하는 고유명사 용어집)
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id="glossary-sheet-url"
              type="text"
              className="cw-form-control"
              style={{ flex: 1, minWidth: '320px' }}
              placeholder="비워 두면 기본 용어집 사용 · https://docs.google.com/spreadsheets/d/.../edit#gid=..."
              value={glossaryUrl}
              onChange={(e) => setGlossaryUrl(e.target.value)}
            />
            <button
              type="button"
              className="cw-button"
              onClick={handleTestGlossary}
              disabled={testingGlossary}
              title="시트를 열어 용어집 탭, 항목 수, 언어 열을 확인합니다. (시트는 수정하지 않음)"
            >
              {testingGlossary ? '⏳ 확인 중…' : '🔍 연결 테스트'}
            </button>
            <button
              type="button"
              className="cw-button"
              data-variant="primary"
              onClick={handleSaveGlossaryUrl}
              disabled={savingGlossary || glossaryUrl.trim() === savedGlossaryUrl.trim() || !glossaryTestedOk}
              title={glossaryTestedOk ? '용어집 시트 주소를 환경 설정에 저장합니다.' : '먼저 현재 주소로 연결 테스트를 통과해야 저장할 수 있습니다.'}
            >
              {savingGlossary ? '저장 중…' : '💾 저장'}
            </button>
          </div>
          <div style={{ marginTop: '10px', fontSize: '0.84rem', color: 'var(--cw-text-soft)', lineHeight: 1.6 }}>
            <div>
              현재 사용: <strong>{savedGlossaryUrl.trim() ? savedGlossaryUrl : '기본 용어집'}</strong>
            </div>
            <div>
              주소에 탭(<code>gid=</code>)이 있으면 그 탭을, 없으면 <code>Glossary</code> 또는 <code>번역키</code> 탭을 사용합니다. 아래 서비스 계정 키(없으면 용어집 전용 기본 키)로 접근하므로 시트를 키의 이메일에 공유해야 합니다.
            </div>
            <div>저장하려면 먼저 입력한 주소로 연결 테스트를 통과해야 합니다. 시트에 접근하지 못하면 번역은 로컬 용어집 파일로 대체됩니다.</div>
          </div>
          {glossaryTest && glossaryTest.url === glossaryUrl.trim() && (
            <div role="status" style={{ marginTop: '12px', padding: '10px 14px', background: glossaryTest.ok ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', border: `1px solid ${glossaryTest.ok ? '#22c55e' : 'var(--cw-danger)'}`, borderRadius: '6px', fontSize: '0.85rem', color: glossaryTest.ok ? '#22c55e' : 'var(--cw-danger)' }}>
              {glossaryTest.ok ? (
                <>
                  ✅ '{glossaryTest.title}' / 탭 '{glossaryTest.tab}' · 항목 {glossaryTest.total}개
                  {glossaryTest.languages.length > 0 && ` · 언어 ${glossaryTest.languages.join(', ')}`}{' '}
                  <a href={glossaryTest.link} target="_blank" rel="noreferrer">시트 열기 ↗</a>
                  {glossaryTest.warnings.map((w) => (
                    <div key={w} style={{ color: 'var(--cw-warning)' }}>⚠️ {w}</div>
                  ))}
                </>
              ) : (
                <>⚠️ {glossaryTest.error}</>
              )}
            </div>
          )}
        </div>

        {/* 2) 구글 서비스 계정 키 (.json) 관리 (비공개 스프레드시트 직접 접근용) - 주소 아래 배치 */}
        <div style={{ padding: '16px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--cw-line)', borderRadius: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <strong style={{ fontSize: '0.92rem' }}>🔑 구글 서비스 계정 키 (.json) 관리 (비공개 시트 직접 접근용)</strong>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="file"
                ref={fileInputRef}
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
              <button
                type="button"
                className="cw-button"
                data-variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingSa}
                title="새로운 구글 서비스 계정 JSON 키 파일을 업로드하여 바로 사용합니다."
              >
                {uploadingSa ? '⏳ 업로드 중…' : '📁 새 키 파일 업로드 (.json)'}
              </button>
              {activeSa && (
                <button
                  type="button"
                  className="cw-button"
                  style={{ color: 'var(--cw-danger)' }}
                  onClick={() => handleDeleteSa()}
                  disabled={deletingSa}
                  title="현재 활성화된 서비스 계정 키 파일을 웹에서 완전히 삭제합니다."
                >
                  {deletingSa ? '삭제 중…' : '🗑️ 키 삭제'}
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', alignItems: 'center' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--cw-muted)', marginBottom: '4px' }}>
                현재 활성화된 서비스 계정 키 파일
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  className="cw-form-control"
                  style={{ flex: 1, fontWeight: 500 }}
                  value={activeSa?.filename || ''}
                  onChange={(e) => handleSelectSa(e.target.value)}
                  disabled={serviceAccounts.length === 0 || switchingSa || testingSa}
                >
                  {serviceAccounts.length === 0 ? (
                    <option value="">등록된 서비스 계정 키가 없습니다. (I2 웹서비스 사용 시 불필요)</option>
                  ) : (
                    serviceAccounts.map((acc) => (
                      <option key={acc.filename} value={acc.filename}>
                        {acc.filename} {acc.is_active ? ' (현재 활성)' : ''}
                      </option>
                    ))
                  )}
                </select>
                {activeSa ? (
                  <span className="cw-state-pill" data-tone="success"><i></i> 활성</span>
                ) : (
                  <span className="cw-state-pill" data-tone="neutral"><i></i> 키 없음</span>
                )}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--cw-muted)', marginBottom: '4px' }}>
                서비스 계정 봇 이메일 (구글 시트 [공유] 대상)
              </label>
              <input
                type="text"
                readOnly
                className="cw-form-control"
                style={{ width: '100%', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)' }}
                value={activeSa?.client_email || '등록된 계정 없음 (I2 웹서비스 사용 시 불필요)'}
              />
            </div>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: '0.82rem', color: 'var(--cw-muted)' }}>
            ※ 유니티 I2 웹서비스 URL을 사용하시는 경우 서비스 계정 키가 필요하지 않습니다. 개별 비공개 구글 스프레드시트 URL 직접 연동 시에만 Google Cloud 콘솔에서 발급받은 서비스 계정 키(.json)를 등록하고 구글 시트 공유 메뉴에 봇 이메일을 '편집자'로 추가해 주세요.
          </p>
        </div>
      </section>

      </div>

      <div hidden={tab !== 'ai'}>
      {/* 2. AI 엔진 및 API 키 환경 설정 섹션 */}
      <section className="panel" style={{ padding: '24px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 style={{ margin: '0 0 6px', fontSize: '1.25rem' }}>🤖 AI 모델 — 엔진 및 API 키</h2>
            <p style={{ margin: 0, color: 'var(--cw-muted)', fontSize: '0.9rem' }}>
              SmartTranslator에서 사용할 LLM 제공자의 API 키를 등록합니다.
            </p>
          </div>
          <span className="cw-state-pill" data-tone="info">
            <i></i> Windows DPAPI 암호화 보관
          </span>
        </div>

        {/* 보안 및 저장 위치 안내 박스 */}
        <div
          style={{
            marginBottom: '20px',
            padding: '14px 16px',
            background: 'var(--cw-raised)',
            border: '1px solid var(--cw-line)',
            borderRadius: '6px',
            fontSize: '0.86rem',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'var(--cw-accent)', display: 'block', marginBottom: '4px' }}>
            🔒 보안 및 저장 안내:
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--cw-text-soft)' }}>
            <li>
              <strong>저장 위치</strong>: <code>apps/translator/engine/config.json</code> (웹 엔진 독립 환경)
            </li>
            <li>
              <strong>암호화 방식</strong>: Windows DPAPI(현재 로그인 사용자 계정 키)로 256비트 암호화되어 저장되므로, 외부 유출이나 타 계정에서 복호화가 불가능합니다.
            </li>
            <li>
              <strong>보안 정책</strong>: 브라우저 상에서 키 보기 및 <strong>클립보드 복사(Copy/Cut)가 전면 차단</strong>되며, 오직 안전한 단방향 입력 및 검증만 허용됩니다.
            </li>
          </ul>
        </div>

        {message && (
          <div
            style={{
              marginBottom: '20px',
              padding: '12px 16px',
              borderRadius: '6px',
              background:
                message.type === 'success'
                  ? 'rgba(34, 197, 94, 0.1)'
                  : message.type === 'error'
                  ? 'var(--cw-danger-bg)'
                  : 'rgba(64, 85, 216, 0.1)',
              color:
                message.type === 'success'
                  ? '#22c55e'
                  : message.type === 'error'
                  ? 'var(--cw-danger)'
                  : 'var(--cw-accent)',
              border: `1px solid ${
                message.type === 'success'
                  ? '#22c55e'
                  : message.type === 'error'
                  ? 'var(--cw-danger-line)'
                  : 'var(--cw-accent)'
              }`,
            }}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* 1. Claude API Key */}
            <div style={{ padding: '16px', border: '1px solid var(--cw-line)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ fontSize: '1rem' }}>Anthropic Claude API</strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {keyStatus.claude ? (
                    <span className="cw-state-pill" data-tone="success"><i></i> 사용 가능 (등록됨)</span>
                  ) : (
                    <span className="cw-state-pill" data-tone="warning"><i></i> 미등록 (사용 불가)</span>
                  )}
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
                다국어 게임 로컬라이제이션 최고 품질 평가 및 자동 교정 엔진 (접두어: <code>sk-ant-...</code>)
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onContextMenu={(e) => e.preventDefault()}
                  className="cw-form-control"
                  style={{ flex: 1 }}
                  placeholder={keyStatus.claude ? '●●●●●●●● (키 등록됨 - 변경 시 여기에 입력)' : 'sk-ant-api03-... (입력 전용, 복사 불가)'}
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                />
                <button
                  type="button"
                  className="cw-button"
                  onClick={() => handleTestKey('claude')}
                  disabled={testingProvider === 'claude' || (!keyStatus.claude && !claudeKey.trim())}
                  title="현재 입력된 키 또는 등록된 키의 유효성을 실시간 테스트합니다."
                >
                  {testingProvider === 'claude' ? '테스트 중…' : '🔑 키 테스트'}
                </button>
                {keyStatus.claude && (
                  <button
                    type="button"
                    className="cw-button"
                    style={{ color: 'var(--cw-danger)' }}
                    onClick={() => handleDeleteKey('claude')}
                  >
                    삭제
                  </button>
                )}
              </div>
              {testResults.claude && (
                <div style={{ marginTop: '8px', fontSize: '0.82rem', color: testResults.claude.ok ? '#22c55e' : 'var(--cw-danger)' }}>
                  {testResults.claude.msg}
                </div>
              )}
            </div>

            {/* 2. Google Gemini API Key */}
            <div style={{ padding: '16px', border: '1px solid var(--cw-line)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ fontSize: '1rem' }}>Google Gemini API</strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {keyStatus.gemini ? (
                    <span className="cw-state-pill" data-tone="success"><i></i> 사용 가능 (등록됨)</span>
                  ) : (
                    <span className="cw-state-pill" data-tone="warning"><i></i> 미등록 (사용 불가)</span>
                  )}
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
                초고속 실시간 배치 번역 및 전수 검수에 최적화된 구글 AI 엔진 (접두어: <code>AIzaSy...</code> 또는 <code>AQ....</code>)
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onContextMenu={(e) => e.preventDefault()}
                  className="cw-form-control"
                  style={{ flex: 1 }}
                  placeholder={keyStatus.gemini ? '●●●●●●●● (키 등록됨 - 변경 시 여기에 입력)' : 'AIzaSy... 또는 구글 토큰 (입력 전용, 복사 불가)'}
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="cw-button"
                  onClick={() => handleTestKey('gemini')}
                  disabled={testingProvider === 'gemini' || (!keyStatus.gemini && !geminiKey.trim())}
                  title="현재 입력된 키 또는 등록된 키의 유효성을 실시간 테스트합니다."
                >
                  {testingProvider === 'gemini' ? '테스트 중…' : '🔑 키 테스트'}
                </button>
                {keyStatus.gemini && (
                  <button
                    type="button"
                    className="cw-button"
                    style={{ color: 'var(--cw-danger)' }}
                    onClick={() => handleDeleteKey('gemini')}
                  >
                    삭제
                  </button>
                )}
              </div>
              {testResults.gemini && (
                <div style={{ marginTop: '8px', fontSize: '0.82rem', color: testResults.gemini.ok ? '#22c55e' : 'var(--cw-danger)' }}>
                  {testResults.gemini.msg}
                </div>
              )}
            </div>

            {/* 3. OpenAI ChatGPT API Key */}
            <div style={{ padding: '16px', border: '1px solid var(--cw-line)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <strong style={{ fontSize: '1rem' }}>OpenAI ChatGPT API</strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {keyStatus.openai ? (
                    <span className="cw-state-pill" data-tone="success"><i></i> 사용 가능 (등록됨)</span>
                  ) : (
                    <span className="cw-state-pill" data-tone="warning"><i></i> 미등록 (사용 불가)</span>
                  )}
                </div>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
                gpt-4o-mini 등 표준 LLM 번역 및 보조 검증용 엔진 (접두어: <code>sk-...</code>)
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  onCopy={blockClipboard}
                  onCut={blockClipboard}
                  onContextMenu={(e) => e.preventDefault()}
                  className="cw-form-control"
                  style={{ flex: 1 }}
                  placeholder={keyStatus.openai ? '●●●●●●●● (키 등록됨 - 변경 시 여기에 입력)' : 'sk-... (입력 전용, 복사 불가)'}
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="cw-button"
                  onClick={() => handleTestKey('openai')}
                  disabled={testingProvider === 'openai' || (!keyStatus.openai && !openaiKey.trim())}
                  title="현재 입력된 키 또는 등록된 키의 유효성을 실시간 테스트합니다."
                >
                  {testingProvider === 'openai' ? '테스트 중…' : '🔑 키 테스트'}
                </button>
                {keyStatus.openai && (
                  <button
                    type="button"
                    className="cw-button"
                    style={{ color: 'var(--cw-danger)' }}
                    onClick={() => handleDeleteKey('openai')}
                  >
                    삭제
                  </button>
                )}
              </div>
              {testResults.openai && (
                <div style={{ marginTop: '8px', fontSize: '0.82rem', color: testResults.openai.ok ? '#22c55e' : 'var(--cw-danger)' }}>
                  {testResults.openai.msg}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="submit"
              className="cw-button"
              data-variant="primary"
              disabled={saving || (!claudeKey.trim() && !geminiKey.trim() && !openaiKey.trim())}
            >
              {saving ? '저장 중…' : '💾 API 키 설정 저장'}
            </button>
          </div>
        </form>
      </section>

      </div>

      <div hidden={tab !== 'schedule'}>
        <SchedulePanel onDirtyChange={setScheduleDirty} />
      </div>
    </div>
  );
}
