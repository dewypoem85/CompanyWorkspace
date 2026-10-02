import { useState, useEffect, useRef, useMemo } from 'react';
import { api, DEFAULT_TEST_SHEET_URL } from './api';

interface SheetInfo {
  name: string;
  key: string;
  url: string;
}

interface LanguageResult {
  text: string;
  score_reason: string;
  status: 'passed' | 'suggested' | 'corrected' | 'new' | 'uninspected';
}

interface RowItem {
  key: string;
  korean: string;
  languages: Record<string, LanguageResult>;
  has_change?: boolean;
}

interface SummaryData {
  passed: number;
  suggested: number;
  corrected: number;
  new: number;
  total: number;
}

interface ExcelResults {
  summary: SummaryData;
  sheets: Record<string, RowItem[]>;
  excel_path: string;
  modified_time: number;
}

interface JobState {
  running: boolean;
  startedAt: string | null;
  completedAt: string | null;
  progress: {
    current: number;
    total: number;
    percent: number;
  };
  totalProgress?: {
    current: number;
    total: number;
    percent: number;
    message: string;
  };
  stepProgress?: {
    current: number;
    total: number;
    percent: number;
    message: string;
  };
  currentMessage: string;
  logs: string[];
  error: string | null;
  totalIssues: number;
}

interface SmartTranslatorViewProps {
  onNavigateToSettings?: (tab?: 'connection' | 'ai' | 'schedule') => void;
  isTestMode?: boolean;
  refreshKey?: number;
  isActive?: boolean;
}

const formatNumber = new Intl.NumberFormat('ko-KR');
// 제공자별 선택 가능한 AI 모델 (첫 단어가 실제 모델 ID로 전달됨)
const MODEL_OPTIONS: Record<'gemini' | 'claude' | 'openai', string[]> = {
  gemini: [
    '⚡ [Auto] 최신 최적 모델 자동 감지 (추천)',
    'gemini-3.8-flash (빠름)',
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-flash-lite-latest (최저 비용)',
  ],
  claude: [
    'claude-sonnet-5-5 (균형 / 최신)',
    'claude-opus-5-5 (최고 품질)',
    'claude-haiku-4-5-20251001 (빠름 / 저비용)',
    'claude-3-5-sonnet-20241022 (최고 품질 추천)',
  ],
  openai: ['gpt-4o-mini (가성비 추천)', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'],
};

type ModelProvider = 'gemini' | 'claude' | 'openai';
// 제공자 선택 시 기본으로 고르는 모델 (Gemini 는 자동 감지)
const defaultModelFor = (p: ModelProvider) => MODEL_OPTIONS[p][0];
// API 에서 조회한 모델 ID 목록에 기존 안내 문구(빠름·저비용 등)를 붙이고, 자동 감지 항목은 맨 앞에 유지
function buildModelOptions(p: ModelProvider, remote?: string[]): string[] {
  const base = MODEL_OPTIONS[p];
  if (!remote || remote.length === 0) return base;
  const labelOf = new Map(base.map((o) => [o.split(' ')[0], o]));
  const auto = base.filter((o) => o.includes('[Auto]'));
  return [...auto, ...remote.map((id) => labelOf.get(id) || id)];
}

const clientLangsCache = new Map<string, { count: number; languages: Array<{ code: string; name: string; label: string; raw_header: string }> }>();

export function SmartTranslatorView({
  onNavigateToSettings,
  isTestMode = false,
  refreshKey = 0,
  isActive = true,
}: SmartTranslatorViewProps) {
  const [sheets, setSheets] = useState<SheetInfo[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [customUrl, setCustomUrl] = useState<string>(DEFAULT_TEST_SHEET_URL);
  const [selectedLangs, setSelectedLangs] = useState<Record<string, boolean>>({
    ENG: true,
    JPN: true,
    CHS: true,
    CHT: true,
    SPA: true,
  });
  const [operationMode, setOperationMode] = useState<'fill_empty' | 'inspect_only' | 'audit_apply'>('fill_empty');
  const [model, setModel] = useState<string>('⚡ [Auto] 최신 최적 모델 자동 감지 (추천)');
  const [provider, setProvider] = useState<'claude' | 'gemini' | 'openai' | ''>('gemini');

  // 구글 시트 일괄 반영 옵션 & 진행도 & 반영 완료 목록 상태
  const [applyIncludeCorrections, setApplyIncludeCorrections] = useState<boolean>(true);
  const [applyIncludeSuggestions, setApplyIncludeSuggestions] = useState<boolean>(false);
  const [applyIncludeNews, setApplyIncludeNews] = useState<boolean>(true);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgressPercent, setApplyProgressPercent] = useState<number>(0);
  const [applyStepMessage, setApplyStepMessage] = useState<string>('');
  const [appliedList, setAppliedList] = useState<Array<{
    key: string;
    korean: string;
    lang: string;
    old_val: string;
    new_val: string;
    reason: string;
    type: string;
  }> | null>(null);

  // 시트 1행 헤더에서 감지된 동적 언어 목록 및 상태
  const [detectedLanguages, setDetectedLanguages] = useState<
    Array<{ code: string; name: string; label: string; raw_header: string }>
  >([]);
  const [detectingLangs, setDetectingLangs] = useState<boolean>(false);
  const [detectMessage, setDetectMessage] = useState<string>('');

  // 사용 가능한 제공자 목록 (실제 키 인증 통과한 것만)
  const [availableProviders, setAvailableProviders] = useState<string[]>([]);
  const [registeredProviders, setRegisteredProviders] = useState<string[]>([]);
  const [hasAnyKey, setHasAnyKey] = useState<boolean>(true);
  // 등록된 API 키로 조회한 제공자별 실제 모델 목록 (조회 실패 시 MODEL_OPTIONS 기본 목록 사용)
  const [remoteModels, setRemoteModels] = useState<Partial<Record<ModelProvider, string[]>>>({});
  const [modelList, setModelList] = useState<{ provider: string; status: 'loading' | 'ok' | 'failed'; error?: string } | null>(null);
  const [modelListReload, setModelListReload] = useState(0);

  // 구글 시트 접속 서비스 계정 키 (.json) 상태
  const [serviceAccounts, setServiceAccounts] = useState<
    Array<{ filename: string; project_id: string; client_email: string; is_active: boolean }>
  >([]);
  const [activeSa, setActiveSa] = useState<{
    filename: string;
    project_id: string;
    client_email: string;
    is_active: boolean;
  } | null>(null);
  const [configuredSheetTitle, setConfiguredSheetTitle] = useState<string>('');
  const [uploadingSa, setUploadingSa] = useState<boolean>(false);
  const [testingSa, setTestingSa] = useState<boolean>(false);
  const [deletingSa, setDeletingSa] = useState<boolean>(false);
  const [sheetAccessStatus, setSheetAccessStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [sheetAccessErrorMsg, setSheetAccessErrorMsg] = useState<string>('');
  const saFileInputRef = useRef<HTMLInputElement | null>(null);

  // 시트 1행 헤더 언어 감지 함수 (클라이언트 캐시 우선 적용, forceRefresh 시 최신 갱신)
  const triggerLanguageDetection = async (targetUrl?: string, forceRefresh = false) => {
    const urlToUse = (targetUrl !== undefined ? targetUrl : (isTestMode ? customUrl : '')).trim();
    const currentSheetObj = sheets.find((s) => s.name === selectedSheet);
    const finalUrl = urlToUse || (!isTestMode && currentSheetObj ? currentSheetObj.url : '');

    if (!finalUrl || finalUrl === 'ALL_OFFICIAL_I2_SHEETS') {
      return;
    }

    // 클라이언트 메모리 캐시 확인 (forceRefresh 시 무시하고 최신 재조회)
    const cacheKey = `${activeSa?.filename || 'none'}:${finalUrl}`;
    if (forceRefresh) {
      clientLangsCache.delete(cacheKey);
    } else if (clientLangsCache.has(cacheKey)) {
      const cached = clientLangsCache.get(cacheKey)!;
      setDetectedLanguages(cached.languages);
      setDetectMessage(`🌐 1행 헤더에서 총 ${cached.count}개 언어 감지됨 (즉시)`);
      setSelectedLangs((prev) => {
        const next = { ...prev };
        cached.languages.forEach((l) => {
          if (next[l.code] === undefined) {
            next[l.code] = true;
          }
        });
        return next;
      });
      return;
    }

    try {
      setDetectingLangs(true);
      setDetectMessage('');
      const res = await api.detectLanguages({
        target_sheet_url: finalUrl,
        target_source_mode: isTestMode ? 'custom_url' : 'i2_official',
        refresh: forceRefresh,
        filename: activeSa?.filename,
      });

      if (res.success && res.languages && res.languages.length > 0) {
        clientLangsCache.set(cacheKey, { count: res.count, languages: res.languages });
        setDetectedLanguages(res.languages);
        setDetectMessage(`🌐 1행 헤더에서 총 ${res.count}개 언어 감지됨`);
        setSheetAccessStatus('ok');
        setSheetAccessErrorMsg('');
        setSelectedLangs((prev) => {
          const next = { ...prev };
          res.languages.forEach((l) => {
            if (next[l.code] === undefined) {
              next[l.code] = true;
            }
          });
          return next;
        });
      } else {
        setSheetAccessStatus('error');
        setSheetAccessErrorMsg(res.error || '시트 1행에서 유효한 언어 헤더를 찾지 못했습니다.');
        setDetectMessage(res.error ? `⚠️ ${res.error}` : '⚠️ 시트 1행에서 유효한 언어 헤더를 찾지 못했습니다.');
      }
    } catch (err: any) {
      setSheetAccessStatus('error');
      setSheetAccessErrorMsg(err.message || '언어 감지 실패');
      setDetectMessage(`⚠️ 언어 감지 실패: ${err.message}`);
    } finally {
      setDetectingLangs(false);
    }
  };

  // 작업 상태 및 결과
  const [job, setJob] = useState<JobState | null>(null);
  const [results, setResults] = useState<ExcelResults | null>(null);
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'changed' | 'new' | 'corrected' | 'suggested' | 'passed' | 'all'>('changed');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(true);
  const [saLoaded, setSaLoaded] = useState<boolean>(false);
  const [selectingSa, setSelectingSa] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [applyMessage, setApplyMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const pollTimerRef = useRef<number | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // 시트 목록, 결과, 설정 로드 함수
  const loadData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      // 키 목록은 파일만 읽어 즉시 응답하므로 먼저 반영 (느린 시트 조회를 기다리는 동안 "키 없음"으로 보이지 않게)
      const saPromise = api.getServiceAccounts(isTestMode ? 'test' : 'main').catch(() => ({ success: false, active: null, accounts: [] }));
      void saPromise.then((r: any) => {
        if (r.success) {
          setServiceAccounts(r.accounts || []);
          setActiveSa(r.active || null);
        }
        setSaLoaded(true);
      });
      const [sheetsRes, resultsRes, statusRes, configRes, saRes] = await Promise.all([
        // 테스트 모드는 I2 시트 탭 목록이 필요 없으므로 느린 조회(Python 기동 + 시트 권한 검사)를 건너뜀
        isTestMode
          ? Promise.resolve({ success: false, sheets: [] as any[] })
          : api.getSheets(forceRefresh).catch(() => ({ success: false, sheets: [] as any[] })),
        api.getResults(isTestMode ? 'test' : 'main').catch(() => ({ success: false, data: null })),
        api.getStatus(isTestMode ? 'test' : 'main').catch(() => ({ success: false, job: null })),
        api.getConfig().catch(() => ({ success: false, config: null })),
        saPromise,
      ]);

      // 구글 서비스 계정 키 목록 처리
      let currentActiveSa: any = null;
      if (saRes.success) {
        setServiceAccounts(saRes.accounts || []);
        currentActiveSa = saRes.active || null;
        setActiveSa(currentActiveSa);
      } else {
        setServiceAccounts([]);
        setActiveSa(null);
      }

      // API 키 설정 상태 처리 (키 인증이 완료된 제공자만 available_providers에 포함됨)
      if (configRes.success && configRes.config) {
        const cfg = configRes.config;
        const av = (cfg.available_providers as string[]) || [];
        const reg = (cfg.registered_providers as string[]) || [];
        setAvailableProviders(av);
        setRegisteredProviders(reg);
        const hasKey = av.length > 0;
        setHasAnyKey(hasKey);

        if (hasKey) {
          if (!av.includes(provider)) {
            const firstP = av[0] as 'claude' | 'gemini' | 'openai';
            setProvider(firstP);
            setModel(defaultModelFor(firstP));
          }
        } else {
          setProvider('');
        }
      }

      // 키가 없거나 삭제되었거나 시트 조회가 실패한 경우 즉시 목록 비우기
      if (!isTestMode && !currentActiveSa) {
        setSheets([]);
        setSelectedSheet('');
        setConfiguredSheetTitle('');
      } else if (sheetsRes.success && sheetsRes.sheets && sheetsRes.sheets.length > 0) {
        setSheets(sheetsRes.sheets);
        setSelectedSheet((prev) => {
          if (prev && sheetsRes.sheets.some((s) => s.name === prev)) return prev;
          return sheetsRes.sheets[0].name;
        });
        setConfiguredSheetTitle((sheetsRes as any).sheet_title || '');
      } else {
        setSheets([]);
        setSelectedSheet('');
        setConfiguredSheetTitle('');
      }

      if (resultsRes.success && resultsRes.data) {
        setResults(resultsRes.data);
        const firstTab = Object.keys(resultsRes.data.sheets || {})[0];
        setActiveSheetTab((prev) => {
          if (prev && resultsRes.data.sheets && resultsRes.data.sheets[prev]) return prev;
          return firstTab || '';
        });
      } else {
        setResults(null);
        setActiveSheetTab('');
      }

      if (statusRes.success && statusRes.job) {
        setJob(statusRes.job);
      }

      // 테스트 모드일 경우 초기 URL 언어 자동 감지
      if (isTestMode && customUrl) {
        void triggerLanguageDetection(customUrl);
      }
    } catch (err: any) {
      setErrorMessage(err.message || '초기 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 초기 로드 및 탭 활성화/설정 변경 시 즉각 갱신
  useEffect(() => {
    if (isActive) {
      void loadData(true);
    }
  }, [refreshKey, isActive]);

  // 인증된 제공자를 고르면 해당 API 키로 실제 사용 가능한 모델 목록을 조회 (새로고침 버튼은 서버 캐시 무시)
  const modelReloadSeen = useRef(0);
  const providerReady = !!provider && availableProviders.includes(provider);
  useEffect(() => {
    if (!isActive || !providerReady) return;
    const p = provider as ModelProvider;
    const refresh = modelListReload !== modelReloadSeen.current;
    modelReloadSeen.current = modelListReload;
    const controller = new AbortController();
    setModelList({ provider: p, status: 'loading' });
    api
      .getModels(p, refresh, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.success && res.models && res.models.length > 0) {
          setRemoteModels((prev) => ({ ...prev, [p]: res.models }));
          setModelList({ provider: p, status: 'ok' });
        } else {
          setModelList({ provider: p, status: 'failed', error: res.error });
        }
      })
      .catch((err: any) => {
        if (controller.signal.aborted) return;
        setModelList({ provider: p, status: 'failed', error: err?.message });
      });
    return () => controller.abort();
  }, [provider, providerReady, isActive, modelListReload]);

  // 조회 실패 시에는 이전에 성공한 목록 대신 기본 목록을 보여 준다 (오래된 목록을 최신으로 오인하지 않게)
  const modelOptions = useMemo(() => {
    if (!provider) return [];
    const p = provider as ModelProvider;
    const ok = modelList?.provider === p && modelList.status === 'ok';
    return buildModelOptions(p, ok ? remoteModels[p] : undefined);
  }, [provider, modelList, remoteModels]);

  // 작업 진행 중일 때 주기적 폴링
  useEffect(() => {
    if (job?.running) {
      pollTimerRef.current = window.setInterval(async () => {
        try {
          const statusRes = await api.getStatus(isTestMode ? 'test' : 'main');
          if (statusRes.success && statusRes.job) {
            setJob(statusRes.job);
            if (!statusRes.job.running) {
              const loadResults = async () => {
                const resRes = await api.getResults(isTestMode ? 'test' : 'main');
                if (resRes.success && resRes.data) {
                  setResults(resRes.data);
                  const firstTab = Object.keys(resRes.data.sheets || {})[0];
                  if (firstTab) setActiveSheetTab((prev) => prev || firstTab);
                }
              };
              void loadResults();
              // 파일 I/O 기록 완료 보장을 위해 1초 후 재확인
              setTimeout(loadResults, 1000);
            }
          }
        } catch {}
      }, 1500);
    } else if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [job?.running]);

  // 로그 스크롤 자동 이동
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [job?.logs?.length]);

  // 구글 서비스 계정 키 선택/전환
  const handleSelectSa = async (filename: string) => {
    try {
      setActionBusy(true);
      setErrorMessage('');
      const res = await api.selectServiceAccount(filename, isTestMode ? 'test' : 'main');
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setApplyMessage(`✅ 구글 서비스 계정 키가 '${filename}'(으)로 변경되었습니다.`);
      } else {
        setErrorMessage(res.error || '서비스 계정 키 전환 실패');
      }
    } catch (err: any) {
      setErrorMessage(`서비스 계정 키 전환 실패: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  // 새 구글 서비스 계정 키 파일 (.json) 업로드
  const handleUploadSaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingSa(true);
      setErrorMessage('');
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        setErrorMessage('선택한 파일이 올바른 JSON 형식이 아닙니다.');
        return;
      }

      if (parsed.type !== 'service_account' || !parsed.client_email) {
        setErrorMessage('Google Service Account 키 파일이 아닙니다. (type: "service_account", client_email 필수)');
        return;
      }

        const res = await api.uploadServiceAccount({ filename: file.name, content: text, mode: isTestMode ? 'test' : 'main' });
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setSheetAccessStatus('idle');
        setSheetAccessErrorMsg('');
        setApplyMessage(`🎉 새 서비스 계정 키 '${res.active?.filename || file.name}' 업로드 및 즉시 적용 완료!`);
      } else {
        setErrorMessage(res.error || '키 파일 업로드 실패');
      }
    } catch (err: any) {
      setErrorMessage(`키 파일 업로드 오류: ${err.message}`);
    } finally {
      setUploadingSa(false);
      if (saFileInputRef.current) saFileInputRef.current.value = '';
    }
  };

  // 구글 서비스 계정 키 및 시트 접근 권한 테스트
  const handleTestSa = async (filename?: string) => {
    try {
      setTestingSa(true);
      setErrorMessage('');
      const target = filename || activeSa?.filename;
      const currentSheetObj = sheets.find((s) => s.name === selectedSheet);
      const targetUrl = isTestMode ? customUrl.trim() : (currentSheetObj?.url || '');

      const res = await api.testServiceAccount({
        filename: target,
        target_sheet_url: targetUrl,
      });
      if (res.success) {
        setSheetAccessStatus('ok');
        setSheetAccessErrorMsg('');
        setApplyMessage(`✅ ${res.message || '서비스 계정 인증 및 구글 시트 접근 성공'}`);
      } else {
        setSheetAccessStatus('error');
        setSheetAccessErrorMsg(res.error || res.message || '구글 시트 접근 실패');
        setErrorMessage(`⚠️ 구글 시트 접근 실패: ${res.error || res.message}`);
      }
    } catch (err: any) {
      setSheetAccessStatus('error');
      setSheetAccessErrorMsg(err.message || '서비스 계정 인증 오류');
      setErrorMessage(`서비스 계정 인증 오류: ${err.message}`);
    } finally {
      setTestingSa(false);
    }
  };

  // 등록된 서비스 계정 키 선택 변경 (선택한 키 하나만 시트 접속에 사용)
  const handleChangeSa = async (filename: string) => {
    if (!filename || filename === activeSa?.filename) return;
    try {
      setSelectingSa(true);
      setErrorMessage('');
      const res = await api.selectServiceAccount(filename, isTestMode ? 'test' : 'main');
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setSheetAccessStatus('idle');
        setSheetAccessErrorMsg('');
        // 키 선택 즉시 연결 검증 (테스트 모드: 입력한 시트 / 메인 모드: 환경설정의 I2 연동)
        if (!isTestMode || customUrl.trim()) {
          await handleTestSa(filename);
        }
        // 선택한 키로 언어 목록도 다시 감지 (이전 키로 조회한 결과/오류 제거)
        if (isTestMode && customUrl.trim()) {
          await triggerLanguageDetection(customUrl, true);
        }
        if (!isTestMode) {
          await loadData(true);
        }
      } else {
        setErrorMessage(res.error || '키 선택 실패');
      }
    } catch (err: any) {
      setErrorMessage(`키 선택 오류: ${err.message}`);
    } finally {
      setSelectingSa(false);
    }
  };

  const renderSaSelect = () => (
    <select
      className="cw-form-control"
      style={{ width: '170px', maxWidth: '100%', padding: '3px 6px', fontSize: '0.82rem', textOverflow: 'ellipsis' }}
      value={activeSa?.filename || ''}
      onChange={(e) => void handleChangeSa(e.target.value)}
      disabled={selectingSa || testingSa || Boolean(job?.running) || serviceAccounts.length === 0}
      title="시트 접속에 사용할 서비스 계정 키를 선택합니다. 선택한 키 하나만 사용됩니다."
    >
      {serviceAccounts.map((a) => (
        <option key={a.filename} value={a.filename} title={a.client_email || ''}>
          {a.filename}
        </option>
      ))}
    </select>
  );

  // 구글 서비스 계정 키 삭제
  const handleDeleteSa = async (filename?: string) => {
    const target = filename || activeSa?.filename;
    if (!target) return;
    if (
      !window.confirm(
        `선택한 구글 서비스 계정 키('${target}')를 삭제하시겠습니까?\n\n삭제 후 새로운 키 파일을 업로드하여 권한을 다시 설정할 수 있습니다.`
      )
    ) {
      return;
    }
    try {
      setDeletingSa(true);
      setErrorMessage('');
      const res = await api.deleteServiceAccount(target, isTestMode ? 'test' : 'main');
      if (res.success) {
        setServiceAccounts(res.accounts || []);
        setActiveSa(res.active || null);
        setSheets([]);
        setSelectedSheet('');
        setSheetAccessStatus('idle');
        setSheetAccessErrorMsg('');
        setApplyMessage(`구글 서비스 계정 키('${target}')가 삭제되었습니다.`);
      } else {
        setErrorMessage(res.error || '키 삭제 실패');
      }
    } catch (err: any) {
      setErrorMessage(`키 삭제 오류: ${err.message}`);
    } finally {
      setDeletingSa(false);
    }
  };

  // 언어 체크박스 토글
  const toggleLang = (lang: string) => {
    setSelectedLangs((prev) => ({ ...prev, [lang]: !prev[lang] }));
  };

  // 작업 시작
  const handleStart = async () => {
    if (detectingLangs) {
      setErrorMessage('시트의 언어를 감지하는 중입니다. 감지 완료 후 다시 시작해 주세요.');
      return;
    }

    if (!hasAnyKey || !provider) {
      setErrorMessage('사용 가능한 AI 엔진 API 키가 없습니다. [환경 설정] 탭에서 API 키를 먼저 입력해 주세요.');
      return;
    }

    if (isTestMode && !customUrl.trim()) {
      setErrorMessage('테스트할 구글 시트 URL을 입력해 주세요.');
      return;
    }

    const langs = Object.entries(selectedLangs)
      .filter(([_, v]) => v)
      .map(([k]) => k);

    if (langs.length === 0) {
      setErrorMessage('최소 하나 이상의 번역 대상 언어를 선택해 주세요.');
      return;
    }

    const currentSheetObj = sheets.find((s) => s.name === selectedSheet);
    const isAllSheets = !isTestMode && (selectedSheet === 'ALL_OFFICIAL_I2_SHEETS' || selectedSheet.includes('전체'));
    const options = {
      target_source_mode: isTestMode ? 'custom_url' : 'i2_official',
      i2_selected_sheet: isTestMode ? '테스트_시트' : selectedSheet,
      target_sheet_url: isTestMode
        ? customUrl.trim()
        : isAllSheets
        ? 'ALL_OFFICIAL_I2_SHEETS'
        : (currentSheetObj?.url || ''),
      target_languages: langs,
      operation_mode: operationMode,
      full_audit_mode: operationMode !== 'fill_empty',
      audit_apply_changes: operationMode === 'audit_apply',
      active_llm_provider: provider,
      claude_model: model,
      gemini_model: model,
      openai_model: model,
      model,
    };

    try {
      setActionBusy(true);
      setErrorMessage('');
      setApplyMessage('');
      setResults(null); // 이전 결과 초기화
      setAppliedList(null); // 이전 적용 내역 초기화
      const res = await api.startJob({ ...options, isTestMode });
      if (res.success) {
        const stRes = await api.getStatus(isTestMode ? 'test' : 'main');
        if (stRes.success && stRes.job) {
          setJob(stRes.job);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || '검수 시작에 실패했습니다.');
    } finally {
      setActionBusy(false);
    }
  };

  // 구글 시트 즉시 반영
  const handleApplyToSheet = async () => {
    if (!applyIncludeCorrections && !applyIncludeSuggestions && !applyIncludeNews) {
      window.alert(
        '구글 시트에 반영할 대상을 선택해주세요.\n\n• [교정 필요 (오역/결함)]\n• [제안 (선택적 권장안)]\n\n둘 중 최소 하나는 체크해야 구글 시트에 반영할 수 있습니다.'
      );
      return;
    }

    let progressTimer: any = null;
    try {
      setActionBusy(true);
      setErrorMessage('');
      setApplyMessage(''); // 1. 상단 안내 제거
      setIsApplying(true); // 2. 진행 상태 활성화 (기존 리스트 숨김)
      setAppliedList(null);
      setApplyProgressPercent(25);
      setApplyStepMessage('대상 구글 시트 구조(=IMPORTRANGE) 분석 및 원본 셀 위치 탐색 중...');

      // 진행도 시각 애니메이션
      progressTimer = setInterval(() => {
        setApplyProgressPercent((prev) => (prev < 85 ? prev + 15 : prev));
      }, 500);

      const currentSheetObj = sheets.find((s) => s.name === selectedSheet);
      const targetUrl = isTestMode ? customUrl.trim() : (currentSheetObj?.url || '');
      const res = await api.applyExcel({
        mode: isTestMode ? 'test' : 'main',
        target_source_mode: isTestMode ? 'custom_url' : 'i2_official',
        target_sheet_url: targetUrl,
        apply_corrections: applyIncludeCorrections,
        apply_suggestions: applyIncludeSuggestions,
        apply_news: applyIncludeNews,
      });

      if (progressTimer) clearInterval(progressTimer);
      setApplyProgressPercent(100);
      setApplyStepMessage('구글 시트 일괄 저장 완료!');

      if (res.success) {
        const count = res.appliedItems?.length ?? res.details?.updated_count ?? 0;
        setApplyMessage(`🎉 구글 시트에 총 ${formatNumber.format(count)}건이 안전하게 일괄 반영되었습니다!`);
        setAppliedList(res.appliedItems || []);
      } else {
        setErrorMessage(res.message || '시트 반영 실패');
      }
    } catch (err: any) {
      if (progressTimer) clearInterval(progressTimer);
      setErrorMessage(err.message || '시트 반영 실패');
      setApplyMessage('');
    } finally {
      setIsApplying(false);
      setActionBusy(false);
    }
  };

  const handleClearCache = async () => {
    if (
      !window.confirm(
        '기존 검수 캐시(audit_cache.json)를 완전히 삭제하시겠습니까?\n\n이전 검수 기록이 삭제되며, 다음 검수 시 모든 항목이 최신 AI 규칙에 따라 처음부터 새로 평가됩니다.'
      )
    ) {
      return;
    }
    try {
      setActionBusy(true);
      setErrorMessage('');
      const res = await api.clearCache();
      if (res.success) {
        alert('검수 캐시가 성공적으로 삭제되었습니다.\n다음 검수 시 모든 항목이 최신 AI 규칙으로 새로 검수됩니다.');
      } else {
        setErrorMessage('캐시 삭제에 실패했습니다.');
      }
    } catch (err: any) {
      setErrorMessage(`캐시 삭제 오류: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  const handleClearResults = async () => {
    const modeLabel = isTestMode ? '테스트 모드' : 'AI 번역 및 검수';
    if (
      !window.confirm(
        `현재 ${modeLabel}의 이전 검수 결과와 생성된 엑셀 보고서를 초기화(삭제)하시겠습니까?\n\n화면의 검수 결과 테이블과 요약 수치가 모두 초기화됩니다.`
      )
    ) {
      return;
    }
    try {
      setActionBusy(true);
      setErrorMessage('');
      const res = await api.clearResults(isTestMode ? 'test' : 'main');
      if (res.success) {
        setResults(null);
        setAppliedList(null);
        setActiveSheetTab('');
        setApplyMessage('');
        alert('검수 결과가 깨끗하게 초기화되었습니다.');
      } else {
        setErrorMessage(res.message || '결과 초기화 실패');
      }
    } catch (err: any) {
      setErrorMessage(`결과 초기화 오류: ${err.message}`);
    } finally {
      setActionBusy(false);
    }
  };

  // 현재 탭의 필터링된 행 목록
  const currentRows = useMemo(() => {
    if (!results || !activeSheetTab || !results.sheets[activeSheetTab]) return [];
    const list = results.sheets[activeSheetTab];
    return list.filter((row) => {
      const matchesSearch =
        !searchQuery.trim() ||
        row.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.korean.toLowerCase().includes(searchQuery.toLowerCase()) ||
        Object.values(row.languages).some((l) => l.text.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (statusFilter === 'changed') {
        return (
          row.has_change ||
          Object.values(row.languages).some((l) => l.status === 'new' || l.status === 'corrected' || l.status === 'suggested')
        );
      }
      if (statusFilter === 'all') return true;
      return Object.values(row.languages).some((l) => l.status === statusFilter);
    });
  }, [results, activeSheetTab, statusFilter, searchQuery]);

  // 결과 테이블에서 표시할 언어 목록 동적 산출 (GER 포함)
  const displayLangs = useMemo(() => {
    if (!currentRows || currentRows.length === 0) {
      if (results && activeSheetTab && results.sheets[activeSheetTab] && results.sheets[activeSheetTab].length > 0) {
        const found = new Set<string>();
        results.sheets[activeSheetTab].forEach((r) => {
          if (r.languages) Object.keys(r.languages).forEach((k) => found.add(k));
        });
        if (found.size > 0) return Array.from(found);
      }
      return ['ENG', 'JPN', 'CHS', 'CHT', 'SPA', 'GER'];
    }
    const found = new Set<string>();
    for (const r of currentRows) {
      if (r.languages) {
        Object.keys(r.languages).forEach((k) => found.add(k));
      }
    }
    return found.size > 0 ? Array.from(found) : ['ENG', 'JPN', 'CHS', 'CHT', 'SPA', 'GER'];
  }, [currentRows, results, activeSheetTab]);

  const LANG_NAMES: Record<string, string> = {
    ENG: 'English',
    JPN: 'Japanese',
    CHS: 'Chinese (Simplified)',
    CHT: 'Chinese (Traditional)',
    SPA: 'Spanish',
    GER: 'German',
    FRA: 'French',
    ITA: 'Italian',
    RUS: 'Russian',
    POR: 'Portuguese',
  };

  if (loading && !sheets.length && !hasAnyKey) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>스마트 번역 시스템을 초기화하고 있습니다…</div>;
  }

  return (
    <div className="smart-translator-container">
      {/* 1. 상단 타이틀 섹션 */}
      <section className="page-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <span style={{ fontSize: '0.8rem', color: isTestMode ? 'var(--cw-warning)' : 'var(--cw-accent)', fontWeight: 600, letterSpacing: '0.5px' }}>
            {isTestMode ? 'SMART TRANSLATOR TEST MODE' : 'SMART TRANSLATOR AI'}
          </span>
          <h1 style={{ margin: '4px 0 8px', fontSize: '1.75rem' }}>
            {isTestMode ? '🧪 AI 스마트 번역 및 검수 [테스트 모드]' : 'AI 스마트 번역 및 품질 검수'}
          </h1>
          <p style={{ margin: 0, color: 'var(--cw-muted)', fontSize: '0.92rem' }}>
            {isTestMode
              ? '임의의 구글 스프레드시트 URL을 직접 입력하여 고속 번역 및 품질 검수를 안전하게 테스트합니다.'
              : '던전슬래셔 공식 I2 번역 시트의 다국어 번역을 Gemini / Claude LLM(MQM 다면 평가)으로 감수 및 자동 교정합니다.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {results && (
            <button
              type="button"
              className="cw-button"
              data-variant="outline"
              onClick={handleClearResults}
              disabled={job?.running || actionBusy}
              title="현재 검수 결과와 생성된 엑셀 보고서를 초기화합니다."
            >
              🧹 결과 초기화
            </button>
          )}
          <button
            type="button"
            className="cw-button"
            data-variant="outline"
            onClick={handleClearCache}
            disabled={job?.running || actionBusy}
            title="이전 검수 캐시(audit_cache.json)를 삭제하여 모든 항목을 최신 AI 규칙으로 새로 검수합니다."
          >
            🗑️ 검수 캐시 삭제
          </button>
          {results && (
            <a
              href={`/api/smart-translator/download-excel?mode=${isTestMode ? 'test' : 'main'}`}
              className="cw-button"
              download={isTestMode ? 'audit_report_전수검사_결과_테스트.xlsx' : 'audit_report_전수검사_결과.xlsx'}
            >
              📥 엑셀 보고서 다운로드
            </a>
          )}
          <button
            className="cw-button"
            data-variant="primary"
            onClick={handleStart}
            disabled={!hasAnyKey || (!isTestMode && (!activeSa || sheets.length === 0)) || (isTestMode && !customUrl.trim()) || job?.running || actionBusy || detectingLangs}
            title={
              detectingLangs
                ? '시트 1행의 언어 목록을 감지하는 중입니다. 완료 후 시작할 수 있습니다.'
                : !hasAnyKey
                ? '환경 설정에서 AI 엔진 API 키를 먼저 등록해 주세요.'
                : !isTestMode && !activeSa
                ? '환경 설정에서 구글 서비스 계정 키(.json)를 먼저 등록해 주세요.'
                : !isTestMode && sheets.length === 0
                ? '환경 설정에서 작업 대상 구글 스프레드시트 주소를 등록해 주세요.'
                : ''
            }
          >
            {detectingLangs
              ? '⏳ 언어 감지 중…'
              : job?.running
              ? '⏳ 검수 작업 진행 중…'
              : '▶️ 검수 및 번역 시작'}
          </button>
        </div>
      </section>

      {/* 키 미등록 경고 배너 */}
      {!hasAnyKey && (
        <div style={{ margin: '16px 0', padding: '16px 20px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid #eab308', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ color: '#eab308', fontSize: '1rem', display: 'block', marginBottom: '4px' }}>
              ⚠️ 사용 가능한 AI 엔진 API 키가 없습니다.
            </strong>
            <span style={{ fontSize: '0.9rem', color: 'var(--cw-muted)' }}>
              번역 및 검수를 실행하려면 먼저 [환경 설정] 탭에서 사용할 AI 엔진(Claude, Gemini, OpenAI)의 API 키를 입력해 주세요.
            </span>
          </div>
          <button
            type="button"
            className="cw-button"
            data-variant="primary"
            onClick={() => onNavigateToSettings?.('ai')}
          >
            ⚙️ 환경 설정에서 키 입력하기
          </button>
        </div>
      )}

      {/* 구글 시트 또는 서비스 계정 미등록 배너 */}
      {!isTestMode && (!activeSa || sheets.length === 0) && (
        <div style={{ margin: '16px 0', padding: '16px 20px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <strong style={{ color: 'var(--cw-accent)', fontSize: '1rem', display: 'block', marginBottom: '4px' }}>
              📊 작업 대상 구글 스프레드시트 연동이 필요합니다.
            </strong>
            <span style={{ fontSize: '0.9rem', color: 'var(--cw-muted)' }}>
              {!activeSa
                ? '구글 서비스 계정 키(.json)가 등록되지 않았습니다. [환경 설정] 탭에서 키를 등록해 주세요.'
                : '작업 대상 구글 시트 주소가 설정되지 않았거나 접근 권한이 없습니다. [환경 설정] 탭에서 시트 URL을 입력하고 연동해 주세요.'}
            </span>
          </div>
          <button
            type="button"
            className="cw-button"
            data-variant="primary"
            onClick={() => onNavigateToSettings?.('connection')}
          >
            ⚙️ 환경 설정에서 시트 및 키 연동하기
          </button>
        </div>
      )}

      {errorMessage && (
        <div style={{ margin: '16px 0', padding: '12px 16px', background: 'var(--cw-danger-bg)', color: 'var(--cw-danger)', border: '1px solid var(--cw-danger-line)', borderRadius: '8px' }}>
          <strong>오류</strong>: {errorMessage}
        </div>
      )}

      {applyMessage && (
        <div style={{ margin: '16px 0', padding: '12px 16px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
          <strong>안내</strong>: {applyMessage}
        </div>
      )}

      {/* 2. 실행 설정 패널 */}
      <section className="panel" style={{ margin: '16px 0', padding: '20px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
        <h2 style={{ margin: '0 0 16px', fontSize: '1.15rem' }}>
          {isTestMode ? '🧪 테스트 실행 설정' : '⚙️ 검수 및 번역 실행 설정'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
          {/* 테스트 모드: 구글 시트 URL 직접 입력 */}
          {isTestMode ? (
            <div style={{ gridColumn: 'span 2' }}>
              <label className="cw-form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>테스트 대상 구글 시트 URL (직접 입력)</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--cw-accent)' }}>공개 또는 서비스계정 공유 시트</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="cw-form-control"
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    disabled={job?.running}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="cw-button"
                    onClick={() => triggerLanguageDetection(customUrl, true)}
                    disabled={detectingLangs || !customUrl.trim()}
                    title="입력한 구글 시트의 1행 헤더를 읽어 번역 언어 목록과 개수를 실시간 감지합니다."
                  >
                    {detectingLangs ? '⏳ 감지 중…' : '🔄 언어 감지'}
                  </button>
                </div>
                {detectMessage && (
                  <div style={{ marginTop: '4px', fontSize: '0.85rem' }}>
                    <span className="cw-state-pill" data-tone={detectMessage.includes('완료') || detectMessage.includes('감지됨') ? 'success' : 'warning'}>
                      <i></i> {detectMessage}
                    </span>
                  </div>
                )}
              </label>

              {/* 시트 접속 키: 테스트 대상 구글 시트 바로 밑으로 이동 & 조건부 노출 (성공 시 키 삭제만, 미등록 시 업로드) */}
              <div style={{ marginTop: '12px' }}>
                <input
                  type="file"
                  ref={saFileInputRef}
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleUploadSaFile}
                />

                {!saLoaded ? (
                  <div style={{ padding: '10px 14px', fontSize: '0.85rem', color: 'var(--cw-text-muted, #888)' }}>
                    🔑 시트 접속 키 확인 중...
                  </div>
                ) : !activeSa ? (
                  /* 1) 키가 없거나 방금 삭제된 경우 -> 키 업로드 및 권한 설정 UI 노출 */
                  <div
                    style={{
                      padding: '14px 18px',
                      background: 'rgba(234, 179, 8, 0.05)',
                      border: '1.5px dashed #eab308',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.94rem', color: '#eab308', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        ⚠️ 구글 서비스 계정 키(.json) 권한 설정이 필요합니다
                      </strong>
                      <span style={{ fontSize: '0.84rem', color: 'var(--cw-muted)' }}>
                        비공개 구글 시트 접근 및 번역 결과 시트 저장을 위해 구글 서비스 계정 키 파일을 업로드해 주세요.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="cw-button"
                      data-variant="primary"
                      onClick={() => saFileInputRef.current?.click()}
                      disabled={uploadingSa || job?.running}
                    >
                      {uploadingSa ? '⏳ 업로드 중…' : '📁 구글 서비스 계정 키(.json) 업로드'}
                    </button>
                  </div>
                ) : sheetAccessStatus === 'error' ? (
                  /* 2) 키는 등록되었으나 해당 시트 접근 권한 문제가 발생한 경우 -> 권한 에러 안내 + 키 교체/삭제 버튼 (이메일 공간 차지 제거) */
                  <div
                    style={{
                      padding: '12px 16px',
                      background: 'rgba(239, 68, 68, 0.06)',
                      border: '1.5px solid var(--cw-danger-line)',
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-start',
                      alignItems: 'stretch',
                      flexWrap: 'nowrap',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.92rem', color: 'var(--cw-danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        ❌ 시트 접근 권한 오류
                      </strong>
                      <span style={{ fontSize: '0.84rem', color: 'var(--cw-muted)' }}>
                        현재 키(<code>{activeSa.filename}</code>)로 해당 시트에 접근할 수 없습니다.
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                      <strong style={{ fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🔑 <span style={{ whiteSpace: 'nowrap' }}>시트 접속 키:</span> {renderSaSelect()}
                      </strong>
                      <button
                        type="button"
                        className="cw-button"
                        style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                        onClick={() => handleTestSa()}
                        disabled={testingSa || job?.running}
                      >
                        {testingSa ? '⏳ 재검사 중…' : '🔄 권한 다시 검사'}
                      </button>
                      <button
                        type="button"
                        className="cw-button"
                        data-variant="primary"
                        style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                        onClick={() => saFileInputRef.current?.click()}
                        disabled={uploadingSa || job?.running}
                      >
                        {uploadingSa ? '⏳ 업로드 중…' : '📁 다른 키로 교체'}
                      </button>
                      <button
                        type="button"
                        className="cw-button"
                        style={{ padding: '4px 10px', fontSize: '0.82rem', borderColor: 'var(--cw-danger-line)', color: 'var(--cw-danger)' }}
                        onClick={() => handleDeleteSa(activeSa.filename)}
                        disabled={deletingSa || job?.running}
                      >
                        {deletingSa ? '⏳ 삭제 중…' : '🗑️ 키 삭제'}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* 3) 키 등록 성공 및 정상 상태 -> 한 줄로 콤팩트하게 현재 키 및 [키 삭제] 버튼만 노출 (이메일 공간 차지 제거) */
                  <div
                    style={{
                      padding: '10px 16px',
                      background: 'var(--cw-surface-soft)',
                      border: '1px solid var(--cw-line)',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'flex-start',
                      alignItems: 'center',
                      flexWrap: 'nowrap',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                      <strong style={{ fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🔑 <span style={{ whiteSpace: 'nowrap' }}>시트 접속 키:</span> {renderSaSelect()}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="cw-button"
                        style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                        onClick={() => handleTestSa()}
                        disabled={testingSa || !customUrl.trim() || job?.running}
                        title="입력한 구글 시트에 이 서비스 계정 봇이 편집자로 공유되어 있는지 실시간 확인합니다."
                      >
                        {testingSa ? '⏳ 검사 중…' : '🔒 시트 권한 검사'}
                      </button>
                      <button
                        type="button"
                        className="cw-button"
                        style={{ padding: '4px 10px', fontSize: '0.82rem', borderColor: 'var(--cw-danger-line)', color: 'var(--cw-danger)' }}
                        onClick={() => handleDeleteSa(activeSa.filename)}
                        disabled={deletingSa || job?.running}
                        title="현재 서비스 계정 키를 삭제합니다. 삭제 후 새로운 키 파일을 업로드하여 권한을 다시 설정할 수 있습니다."
                      >
                        {deletingSa ? '⏳ 삭제 중…' : '🗑️ 키 삭제'}
                      </button>
                    </div>
                    <span
                      className="cw-state-pill"
                      data-tone={selectingSa || testingSa ? 'info' : 'success'}
                      style={{ fontSize: '0.78rem' }}
                    >
                      <i></i> {selectingSa || testingSa ? '연결 검증 중…' : '정상 연동'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 일반 메인 모드: 환경 설정에 등록된 구글 시트 탭 목록 선택 */
            <div style={{ gridColumn: 'span 2' }}>
              <label className="cw-form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong>작업 대상 구글 시트 탭 (Worksheet)</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {sheets.length > 0 && (
                      <button
                        type="button"
                        className="cw-button"
                        style={{ padding: '2px 8px', fontSize: '0.78rem' }}
                        onClick={() => triggerLanguageDetection(undefined, true)}
                        disabled={detectingLangs}
                      >
                        {detectingLangs ? '⏳ 감지 중…' : '🔄 언어 감지'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="cw-button"
                      style={{ padding: '2px 8px', fontSize: '0.78rem' }}
                      onClick={() => onNavigateToSettings?.('connection')}
                      title="작업할 구글 시트 주소나 서비스 계정 키를 변경하려면 환경 설정으로 이동합니다."
                    >
                      ⚙️ 시트 주소 및 키 변경
                    </button>
                  </div>
                </div>
                {sheets.length === 0 ? (
                  <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.05)', border: '1px dashed var(--cw-danger-line)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <span style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>
                      {!activeSa
                        ? '⚠️ 구글 서비스 계정 키(.json)가 등록되지 않았습니다.'
                        : '⚠️ 작업 대상 구글 스프레드시트 주소가 설정되지 않았거나 접근 권한이 없습니다.'}
                    </span>
                    <button
                      type="button"
                      className="cw-button"
                      data-variant="primary"
                      style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                      onClick={() => onNavigateToSettings?.('connection')}
                    >
                      ⚙️ 환경 설정에서 등록하기
                    </button>
                  </div>
                ) : (
                  <select
                    className="cw-form-control"
                    value={selectedSheet}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedSheet(val);
                      const found = sheets.find((s) => s.name === val);
                      if (found && found.url) {
                        void triggerLanguageDetection(found.url);
                      }
                    }}
                    disabled={job?.running}
                  >
                    {sheets.map((s) => (
                      <option key={s.key} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {detectMessage && (
                  <div style={{ marginTop: '4px', fontSize: '0.85rem' }}>
                    <span className="cw-state-pill" data-tone={detectMessage.includes('완료') || detectMessage.includes('감지됨') ? 'success' : 'warning'}>
                      <i></i> {detectMessage}
                    </span>
                  </div>
                )}
              </label>
            </div>
          )}




          {/* 모드 선택 (3단 모드) */}
          <div>
            <label className="cw-form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <strong>번역 및 검수 동작 모드</strong>
              <select
                className="cw-form-control"
                value={operationMode}
                onChange={(e) => setOperationMode(e.target.value as any)}
                disabled={job?.running}
              >
                <option value="fill_empty">⚡ [기본 모드] 비어 있는 칸만 채우기 (기존 번역 유지, 빈칸만 번역)</option>
                <option value="inspect_only">📋 [전수 검사] 전체 품질 확인만 (시트 수정 안 함 ➔ 엑셀 보고서로 오류 확인)</option>
                <option value="audit_apply">✏️ [전수 검사 + 적용] 전체 검사 후 올바른 번역 즉시 덮어쓰기 (오역 자동 교정)</option>
              </select>
            </label>
          </div>

          {/* AI 모델 선택 (인증 완료된 엔진만 선택 가능) */}
          <div>
            <label className="cw-form-field" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>AI 엔진 및 모델</strong>
                {!hasAnyKey ? (
                  <span style={{ fontSize: '0.8rem', color: '#eab308' }}>인증된 키 없음</span>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: '#22c55e' }}>인증 완료</span>
                )}
              </div>
              <select
                className="cw-form-control"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as any;
                  if (!availableProviders.includes(p)) return;
                  setProvider(p);
                  setModel(defaultModelFor(p));
                }}
                disabled={job?.running || !hasAnyKey}
              >
                {!hasAnyKey ? (
                  <option value="" disabled>⚠️ 키 인증 완료된 AI 엔진이 없습니다 (환경 설정 필요)</option>
                ) : (
                  <>
                    <option
                      value="gemini"
                      disabled={!availableProviders.includes('gemini')}
                    >
                      {availableProviders.includes('gemini')
                        ? 'Google Gemini (초고속 배치 번역 / 인증됨)'
                        : registeredProviders.includes('gemini')
                        ? 'Google Gemini (미인증: [키 테스트] 필요)'
                        : 'Google Gemini (미등록)'}
                    </option>
                    <option
                      value="claude"
                      disabled={!availableProviders.includes('claude')}
                    >
                      {availableProviders.includes('claude')
                        ? 'Anthropic Claude (최고 품질 추천 / 인증됨)'
                        : registeredProviders.includes('claude')
                        ? 'Anthropic Claude (미인증: [키 테스트] 필요)'
                        : 'Anthropic Claude (미등록)'}
                    </option>
                    <option
                      value="openai"
                      disabled={!availableProviders.includes('openai')}
                    >
                      {availableProviders.includes('openai')
                        ? 'OpenAI ChatGPT (gpt-4o-mini / 인증됨)'
                        : registeredProviders.includes('openai')
                        ? 'OpenAI ChatGPT (미인증: [키 테스트] 필요)'
                        : 'OpenAI ChatGPT (미등록)'}
                    </option>
                  </>
                )}
              </select>
              {hasAnyKey && provider && (
                <select
                  className="cw-form-control"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={job?.running}
                  title="번역·검수에 사용할 AI 모델을 선택합니다. (모델 ID는 첫 단어 기준)"
                >
                  {!modelOptions.includes(model) && model && (
                    <option value={model}>
                      {modelList?.status === 'ok' ? `${model} — 현재 키로 조회되지 않음 (자동 대체됨)` : model}
                    </option>
                  )}
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {hasAnyKey && provider && modelList?.provider === provider && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    className="cw-state-pill"
                    data-tone={modelList.status === 'ok' ? 'success' : modelList.status === 'failed' ? 'warning' : 'info'}
                    title={modelList.error || undefined}
                  >
                    <i></i>{' '}
                    {modelList.status === 'loading'
                      ? '모델 목록 불러오는 중…'
                      : modelList.status === 'ok'
                      ? `API에서 모델 ${remoteModels[provider as ModelProvider]?.length ?? 0}개 조회됨`
                      : '모델 목록 조회 실패 — 기본 목록 표시'}
                  </span>
                  <button
                    type="button"
                    className="cw-button"
                    style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                    onClick={() => setModelListReload((n) => n + 1)}
                    disabled={modelList.status === 'loading' || job?.running}
                  >
                    목록 새로고침
                  </button>
                </div>
              )}
            </label>
          </div>
        </div>

        {/* 대상 언어 체크박스 (1행 감지 결과 연동) */}
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--cw-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.96rem' }}>검수 대상 언어 선택</strong>
              <span className="cw-state-pill" data-tone={detectedLanguages.length > 0 ? 'success' : 'info'}>
                <i></i> {detectedLanguages.length > 0 ? `1행에서 ${detectedLanguages.length}개 언어 감지됨` : '기본 5개 언어'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="cw-button"
                style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                disabled={detectingLangs || job?.running}
                onClick={() => {
                  const allCodes = detectedLanguages.length > 0
                    ? detectedLanguages.map((l) => l.code)
                    : ['ENG', 'JPN', 'CHS', 'CHT', 'SPA'];
                  const updated = { ...selectedLangs };
                  allCodes.forEach((c) => { updated[c] = true; });
                  setSelectedLangs(updated);
                }}
              >
                전체 선택
              </button>
              <button
                type="button"
                className="cw-button"
                style={{ padding: '2px 10px', fontSize: '0.8rem' }}
                disabled={detectingLangs || job?.running}
                onClick={() => {
                  const allCodes = detectedLanguages.length > 0
                    ? detectedLanguages.map((l) => l.code)
                    : ['ENG', 'JPN', 'CHS', 'CHT', 'SPA'];
                  const updated = { ...selectedLangs };
                  allCodes.forEach((c) => { updated[c] = false; });
                  setSelectedLangs(updated);
                }}
              >
                전체 해제
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {(detectedLanguages.length > 0
              ? detectedLanguages
              : [
                  { code: 'ENG', label: 'ENG (영어)' },
                  { code: 'JPN', label: 'JPN (일본어)' },
                  { code: 'CHS', label: 'CHS (중국어 간체)' },
                  { code: 'CHT', label: 'CHT (중국어 번체)' },
                  { code: 'SPA', label: 'SPA (스페인어)' },
                ]
            ).map((l) => (
              <label
                key={l.code}
                className="cw-check-control"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', background: 'var(--cw-surface-soft)' }}
              >
                <input
                  type="checkbox"
                  className="cw-checkbox"
                  checked={selectedLangs[l.code] ?? true}
                  onChange={() => toggleLang(l.code)}
                  disabled={job?.running || detectingLangs}
                />
                <span style={{ fontSize: '0.88rem' }}>{l.label}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* 3. 진행 상황 섹션 (작업 중일 때) */}
      {job?.running && (
        <section className="panel" style={{ margin: '16px 0', padding: '20px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
          {/* (1) 전체 진행도 바 (0% ~ 100% 누적) */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <strong style={{ fontSize: '0.92rem' }}>
                🌐 {job.totalProgress?.message || job.currentMessage || '전체 진행도'}
              </strong>
              <span style={{ fontWeight: 'bold', color: 'var(--cw-accent)' }}>
                {job.totalProgress?.percent ?? job.progress.percent}%
              </span>
            </div>
            <div style={{ width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(3, job.totalProgress?.percent ?? job.progress.percent)}%`,
                  height: '100%',
                  background: 'var(--cw-accent)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* (2) 단계별 번역 세부 진행도 바 (0% ~ 100% 독립) */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.86rem', color: '#60a5fa' }}>
                ⚡ {job.stepProgress?.message || '단계별 세부 진행 대기 중...'}
              </span>
              <span style={{ fontWeight: 'bold', fontSize: '0.86rem', color: '#60a5fa' }}>
                {job.stepProgress?.percent ?? 0}%
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(2, job.stepProgress?.percent ?? 0)}%`,
                  height: '100%',
                  background: '#3b82f6',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* 터미널 로그 스트림 창 */}
          <div style={{ height: '140px', overflowY: 'auto', background: 'rgba(0,0,0,0.5)', padding: '10px 14px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: '1.4' }}>
            {job.logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      )}

      {/* 4. 결과 요약 카드 */}
      {results?.summary && (
        <section className="metric-grid" style={{ margin: '16px 0' }}>
          <article className="metric-card green">
            <div>
              <span style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>✅ 통과 (합격)</span>
              <strong style={{ fontSize: '1.5rem', display: 'block', margin: '4px 0' }}>{formatNumber.format(results.summary.passed)}</strong>
              <small style={{ color: 'var(--cw-muted)' }}>{results.summary.passed === 0 ? '검수 미수행' : '9.0 ~ 10.0점 (원문 유지)'}</small>
            </div>
          </article>
          <article className="metric-card amber">
            <div>
              <span style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>💡 제안 (참고)</span>
              <strong style={{ fontSize: '1.5rem', display: 'block', margin: '4px 0' }}>{formatNumber.format(results.summary.suggested)}</strong>
              <small style={{ color: 'var(--cw-muted)' }}>8.0 ~ 8.9점 (수정 금지, 캐시 보존)</small>
            </div>
          </article>
          <article className="metric-card red">
            <div>
              <span style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>✏️ 교정 대상</span>
              <strong style={{ fontSize: '1.5rem', display: 'block', margin: '4px 0' }}>{formatNumber.format(results.summary.corrected)}</strong>
              <small style={{ color: 'var(--cw-muted)' }}>8.0점 미만 (AI 교정안 제시)</small>
            </div>
          </article>
          <article className="metric-card blue">
            <div>
              <span style={{ fontSize: '0.88rem', color: 'var(--cw-muted)' }}>✨ 신규 번역</span>
              <strong style={{ fontSize: '1.5rem', display: 'block', margin: '4px 0' }}>{formatNumber.format(results.summary.new)}</strong>
              <small style={{ color: 'var(--cw-muted)' }}>누락된 빈 셀 신규 생성</small>
            </div>
          </article>
        </section>
      )}

      {/* 5. 시트 즉시 반영 섹션 (선택 옵션 & 진행도 & 완료 목록) */}
      {isApplying && (
        <section
          className="panel"
          style={{
            margin: '20px 0',
            padding: '36px 24px',
            background: 'var(--cw-surface)',
            border: '1px solid var(--cw-line)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>⚡</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '1.2rem' }}>구글 시트에 일괄 반영하는 중입니다...</h3>
          <p style={{ margin: '0 0 20px', color: 'var(--cw-muted)', fontSize: '0.9rem' }}>
            {applyStepMessage || '대상 시트의 =IMPORTRANGE 수식을 보호하면서 마스터 원본 시트에 안전하게 기록하고 있습니다.'}
          </p>
          <div
            style={{
              maxWidth: '520px',
              margin: '0 auto',
              background: 'var(--cw-bg)',
              borderRadius: '10px',
              height: '14px',
              overflow: 'hidden',
              border: '1px solid var(--cw-line)',
            }}
          >
            <div
              style={{
                width: `${applyProgressPercent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #3b82f6, #10b981)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ marginTop: '12px', fontSize: '0.88rem', color: 'var(--cw-muted)', fontWeight: 600 }}>
            {applyProgressPercent}% 진행됨
          </div>
        </section>
      )}

      {/* 5-1. 구글 시트 반영 완료 결과 전용 목록 */}
      {!isApplying && appliedList !== null && (
        <section
          className="panel"
          style={{
            margin: '20px 0',
            padding: '24px',
            background: 'var(--cw-surface)',
            border: '1px solid var(--cw-line)',
            borderRadius: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>🎉 구글 시트에 실제 반영된 항목 목록 ({appliedList.length}건)</h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
                온라인 구글 시트에 성공적으로 동기화된 항목들의 Before/After 상세 내역입니다.
              </p>
            </div>
            <button
              type="button"
              className="cw-button"
              data-variant="outline"
              onClick={() => setAppliedList(null)}
            >
              📋 전체 검수 결과 다시 보기
            </button>
          </div>

          {appliedList.length > 0 ? (
            <div className="cw-table-scroll" tabIndex={0} role="region" aria-label="반영 완료 표">
              <table className="cw-data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ width: '180px' }}>Keys</th>
                    <th style={{ width: '220px' }}>한글 원문</th>
                    <th style={{ width: '100px' }}>언어</th>
                    <th style={{ width: '240px' }}>변경 전 (기존 값)</th>
                    <th style={{ width: '260px' }}>➔ 변경 후 (시트 반영 완료)</th>
                    <th>적용 사유 및 구분</th>
                  </tr>
                </thead>
                <tbody>
                  {appliedList.map((item, idx) => (
                    <tr key={`${item.key}_${item.lang}_${idx}`}>
                      <td>
                        <code style={{ fontSize: '0.82rem' }}>{item.key}</code>
                      </td>
                      <td>
                        <strong style={{ fontSize: '0.88rem' }}>{item.korean}</strong>
                      </td>
                      <td>
                        <span className="cw-state-pill" data-tone="info" style={{ fontSize: '0.75rem' }}>
                          <i></i> {item.lang}
                        </span>
                      </td>
                      <td style={{ color: 'var(--cw-muted)', fontSize: '0.85rem' }}>
                        {item.old_val || <em style={{ color: 'var(--cw-faint)' }}>빈 값 (누락)</em>}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--cw-text)', fontSize: '0.88rem' }}>
                        {item.new_val}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="cw-state-pill"
                            data-tone={item.type === 'suggestion' ? 'warning' : (item.type === 'new' ? 'info' : 'success')}
                            style={{ fontSize: '0.75rem' }}
                          >
                            <i></i> {item.type === 'suggestion' ? '제안 반영' : (item.type === 'new' ? '신규 반영' : '교정 반영')}
                          </span>
                          <span style={{ fontSize: '0.82rem', color: 'var(--cw-muted)' }}>{item.reason}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--cw-muted)' }}>
              선택한 조건(교정/제안)에 해당하는 변경 항목이 없어 시트에 반영된 셀이 없습니다.
            </div>
          )}
        </section>
      )}

      {/* 5-2. 일괄 반영 컨트롤 배너 (전수 검사 [확인 전용] 모드 & 결과 있을 때만 노출) */}
      {!isApplying && appliedList === null && results && operationMode === 'inspect_only' && (
        <section
          style={{
            margin: '16px 0',
            padding: '16px 20px',
            background: 'var(--cw-surface)',
            border: '1px solid var(--cw-line)',
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>⚡ 엑셀 결과 시트 즉시 반영 제어</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
              검수한 AI 교정안 및 제안안 중 시트에 적용할 항목을 선택하여 일괄 저장합니다. (B시트 수식 보존)
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 1. 전수검사 엑셀 보고서 열기 (다운로드) - 즉시 반영 버튼 왼쪽에 배치 */}
            <a
              href={`/api/smart-translator/download-excel?mode=${isTestMode ? 'test' : 'main'}`}
              className="cw-button"
              data-variant="outline"
              download={isTestMode ? 'audit_report_전수검사_결과_테스트.xlsx' : 'audit_report_전수검사_결과.xlsx'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
              title="검수 결과 엑셀 보고서를 다운로드하여 직접 확인합니다."
            >
              📊 전수검사 엑셀 보고서 열기
            </a>

            {/* 2. 엑셀 결과 시트 즉시 반영 + 교정 필요 + 제안 체크박스 테두리로 묶음 */}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 14px',
                border: '1.5px solid var(--cw-accent, #3b82f6)',
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.05)',
                flexWrap: 'wrap',
              }}
            >
              <button
                type="button"
                className="cw-button"
                data-variant="primary"
                onClick={handleApplyToSheet}
                disabled={job?.running || actionBusy}
              >
                ⚡ 엑셀 결과 시트 즉시 반영
              </button>

              <label className="cw-check-control" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="cw-checkbox"
                  checked={applyIncludeNews}
                  onChange={(e) => setApplyIncludeNews(e.target.checked)}
                />
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  신규 번역 (누락 채우기: {formatNumber.format(results.summary?.new || 0)}건)
                </span>
              </label>

              <label className="cw-check-control" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="cw-checkbox"
                  checked={applyIncludeCorrections}
                  onChange={(e) => setApplyIncludeCorrections(e.target.checked)}
                />
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  교정 필요 (오역/결함: {formatNumber.format(results.summary?.corrected || 0)}건)
                </span>
              </label>

              <label className="cw-check-control" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="cw-checkbox"
                  checked={applyIncludeSuggestions}
                  onChange={(e) => setApplyIncludeSuggestions(e.target.checked)}
                />
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>
                  제안 (선택적 권장안: {formatNumber.format(results.summary?.suggested || 0)}건)
                </span>
              </label>
            </div>
          </div>
        </section>
      )}

      {/* 6. 결과 표 섹션 (미진행 & 완료목록 닫힘 상태일 때만 노출) */}
      {!isApplying && appliedList === null && results && results.sheets && Object.keys(results.sheets).length > 0 && (
        <section className="panel" style={{ margin: '16px 0', padding: '20px', background: 'var(--cw-surface)', border: '1px solid var(--cw-line)', borderRadius: '8px' }}>
          {/* 시트 탭 선택 */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
            {Object.keys(results.sheets).map((tabName) => (
              <button
                key={tabName}
                className="cw-button"
                data-variant={activeSheetTab === tabName ? 'primary' : undefined}
                onClick={() => setActiveSheetTab(tabName)}
                style={{ whiteSpace: 'nowrap' }}
              >
                📄 {tabName} ({results.sheets[tabName]?.length || 0})
              </button>
            ))}
          </div>

          {/* 필터 툴바 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label className="cw-form-field" style={{ margin: 0 }}>
                <input
                  type="search"
                  className="cw-form-control"
                  placeholder="키, 한글 원문, 번역 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ minWidth: '240px' }}
                />
              </label>

              <label className="cw-form-field" style={{ margin: 0 }}>
                <select
                  className="cw-form-control"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  style={{ minWidth: '240px', fontWeight: statusFilter === 'changed' ? 600 : 400 }}
                >
                  <option value="changed">⚡ 변경 내용 행만 보기 (신규/교정/제안) [기본]</option>
                  <option value="new">✨ 신규 번역 행만 보기</option>
                  <option value="corrected">✏️ 교정 대상 행만 보기</option>
                  <option value="suggested">💡 제안 항목 행만 보기</option>
                  <option value="passed">✅ 통과 (원문 유지) 행만 보기</option>
                  <option value="all">🌐 전체 모든 행 보기 (통과 포함)</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--cw-muted)' }}>
                {statusFilter === 'changed' ? '⚡ 변경된 항목만 표시 중: ' : '항목 표시 중: '}
                <strong style={{ color: 'var(--cw-text)', fontSize: '1rem' }}>{formatNumber.format(currentRows.length)}</strong>건
              </div>
              <button
                type="button"
                className="cw-button"
                data-variant="outline"
                style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                onClick={handleClearResults}
                disabled={job?.running || actionBusy}
                title="현재 검수 결과를 초기화합니다."
              >
                🧹 결과 초기화
              </button>
            </div>
          </div>

          {/* 데이터 테이블 */}
          <div className="cw-table-scroll" tabIndex={0} role="region" aria-label="검수 결과 표">
            <table className="cw-data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Keys</th>
                  <th style={{ width: '220px' }}>한글 원문</th>
                  {displayLangs.map((l) => (
                    <th key={l} style={{ minWidth: '150px' }}>
                      {LANG_NAMES[l] || l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentRows.map((row, idx) => (
                  <tr key={row.key || idx}>
                    <td>
                      <code style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{row.key}</code>
                    </td>
                    <td>
                      <strong style={{ fontSize: '0.9rem' }}>{row.korean}</strong>
                    </td>
                    {displayLangs.map((l) => {
                      const item = row.languages[l];
                      if (!item) return <td key={l} style={{ color: 'var(--cw-faint)' }}>-</td>;

                      let pillTone: 'success' | 'warning' | 'danger' | 'info' = 'success';
                      let statusText = '통과';
                      if (item.status === 'suggested') {
                        pillTone = 'warning';
                        statusText = '제안';
                      } else if (item.status === 'corrected') {
                        pillTone = 'danger';
                        statusText = '교정';
                      } else if (item.status === 'new') {
                        pillTone = 'info';
                        statusText = '신규';
                      } else if (item.status === 'uninspected') {
                        statusText = '유지 (미검수)';
                      }

                      return (
                        <td key={l} style={{ verticalAlign: 'top', minWidth: '160px' }}>
                          <div style={{ marginBottom: '4px' }}>
                            <span className="cw-state-pill" data-tone={pillTone} style={{ fontSize: '0.75rem', padding: '2px 6px' }}>
                              <i /> {statusText}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.85rem', marginBottom: '4px' }}>{item.text || <em style={{ color: 'var(--cw-faint)' }}>빈 값</em>}</div>
                          {item.score_reason && (
                            <small style={{ display: 'block', fontSize: '0.75rem', color: 'var(--cw-muted)', background: 'rgba(255,255,255,0.03)', padding: '4px 6px', borderRadius: '4px' }}>
                              {item.score_reason}
                            </small>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {currentRows.length === 0 && (
                  <tr>
                    <td colSpan={2 + displayLangs.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--cw-muted)' }}>
                      {statusFilter === 'changed' ? (
                        <div>
                          <p style={{ margin: '0 0 12px', fontSize: '0.95rem', color: 'var(--cw-text)' }}>
                            🎉 이번 작업에서 새로 변경되거나 교정된 행이 없습니다. (모든 항목 합격/원문 유지 완료)
                          </p>
                          <button
                            type="button"
                            className="cw-button"
                            data-variant="outline"
                            onClick={() => setStatusFilter('all')}
                            style={{ fontSize: '0.84rem' }}
                          >
                            🌐 전체 모든 행 보기
                          </button>
                        </div>
                      ) : (
                        '표시할 결과가 없습니다.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
