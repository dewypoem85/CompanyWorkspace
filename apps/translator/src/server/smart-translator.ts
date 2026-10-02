import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getEngineDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'engine'),
    path.resolve(process.cwd(), 'apps/translator/engine'),
    path.resolve(__dirname, '../engine'),
    path.resolve(__dirname, '../../engine'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'web_runner.py'))) {
      return c;
    }
  }
  return path.resolve(process.cwd(), 'apps/translator/engine');
}

export const SMART_TRANSLATOR_DIR = getEngineDir();
// 엔진 폴더 구조 (engine/paths.py 와 동일): config/ keys/ data/ output/
export const CONFIG_DIR = path.join(SMART_TRANSLATOR_DIR, 'config');
export const KEYS_DIR = path.join(SMART_TRANSLATOR_DIR, 'keys');
export const DATA_DIR = path.join(SMART_TRANSLATOR_DIR, 'data');
export const OUTPUT_DIR = path.join(SMART_TRANSLATOR_DIR, 'output');
const RUNNER_SCRIPT = path.join(SMART_TRANSLATOR_DIR, 'web_runner.py');
const EXCEL_REPORT_PATH = path.join(OUTPUT_DIR, 'audit_report_전수검사_결과.xlsx');
const EXCEL_TEST_REPORT_PATH = path.join(OUTPUT_DIR, 'audit_report_테스트_결과.xlsx');

// 예전 구조(모두 루트)의 파일을 새 폴더로 한 번 이동 (engine/paths.py 의 migrate_legacy_files 와 같은 규칙, 대상에 이미 있으면 건드리지 않음)
function migrateLegacyLayout(): void {
  try {
    for (const d of [CONFIG_DIR, KEYS_DIR, DATA_DIR, OUTPUT_DIR]) fs.mkdirSync(d, { recursive: true });
    const mv = (name: string, destDir: string) => {
      const src = path.join(SMART_TRANSLATOR_DIR, name);
      const dst = path.join(destDir, name);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        try {
          fs.renameSync(src, dst);
        } catch {}
      }
    };
    for (const n of ['config.json', 'languages.json']) mv(n, CONFIG_DIR);
    for (const n of ['audit_cache.json', 'schedule_state.json', 'I2_Glossary_고유명사용어사전.csv', 'I2_Glossary_고유명사용어사전.xlsx']) mv(n, DATA_DIR);
    for (const name of fs.readdirSync(SMART_TRANSLATOR_DIR)) {
      const full = path.join(SMART_TRANSLATOR_DIR, name);
      const low = name.toLowerCase();
      const st = fs.statSync(full);
      if (st.isFile() && low.endsWith('.json') && !['config.json', 'languages.json'].includes(low)) {
        try {
          if (JSON.parse(fs.readFileSync(full, 'utf-8')).type === 'service_account') mv(name, KEYS_DIR);
        } catch {}
      } else if (st.isFile() && low.endsWith('.xlsx') && !name.startsWith('~$') && !low.startsWith('i2_glossary')) {
        mv(name, OUTPUT_DIR);
      } else if (st.isDirectory() && name === 'evidence') {
        mv(name, OUTPUT_DIR);
      }
    }
  } catch {}
}
migrateLegacyLayout();

export interface RunSummary {
  new: number;
  corrected: number;
  suggested: number;
  passed: number;
  total: number;
}

interface JobState {
  running: boolean;
  mode?: 'main' | 'test';
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
  summary: RunSummary | null;
}

const currentJob: JobState = {
  running: false,
  mode: undefined,
  startedAt: null,
  completedAt: null,
  progress: { current: 0, total: 0, percent: 0 },
  totalProgress: { current: 0, total: 100, percent: 0, message: '파이프라인 초기화 중...' },
  stepProgress: { current: 0, total: 100, percent: 0, message: '시작 대기 중...' },
  currentMessage: '',
  logs: [],
  error: null,
  totalIssues: 0,
  summary: null,
};

let activeProcess: ChildProcessWithoutNullStreams | null = null;

function runPythonCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [RUNNER_SCRIPT, ...args], {
      cwd: SMART_TRANSLATOR_DIR,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8');
    });
    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8');
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Python command failed with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// --- 인메모리 고속 캐시 계층 ---
let sheetsCache: { data: any; timestamp: number } | null = null;
let glossaryCache: { data: any; timestamp: number } | null = null;
const resultsCacheMap = new Map<string, { mtimeMs: number; data: any }>();
const detectedLangsCache = new Map<string, { data: any; timestamp: number }>();
const modelsCache = new Map<string, { data: any; timestamp: number }>(); // 제공자별 실제 사용 가능 모델 목록
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

function isValidKeyForProvider(provider: string, keyStr: string): boolean {
  const k = (keyStr || '').trim();
  if (!k || k === '******' || k.length < 15) return false;
  if (provider === 'claude') return k.startsWith('sk-ant-') && k.length >= 25;
  if (provider === 'gemini') return (k.startsWith('AIzaSy') || k.startsWith('AQ.') || !k.startsWith('sk-')) && k.length >= 20;
  if (provider === 'openai') return k.startsWith('sk-') && !k.startsWith('sk-ant-') && k.length >= 20;
  return false;
}

export async function handleGetSheets(req: Request, res: Response): Promise<void> {
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();
  if (!forceRefresh && sheetsCache && now - sheetsCache.timestamp < 10000) {
    res.json(sheetsCache.data);
    return;
  }

  try {
    const raw = await runPythonCommand(['--action', 'list_sheets']);
    const data = JSON.parse(raw);
    if (data.success) {
      sheetsCache = { data, timestamp: now };
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleGetConfig(_req: Request, res: Response): Promise<void> {
  // Node.js 고속 직통 경로: config.json을 직접 읽어 파이썬 Cold Start(1.5초) 제거
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const cfg = JSON.parse(content);
      const safeCfg = { ...cfg };

      const verifiedDict = safeCfg.verified_providers || {};
      const registeredProviders: string[] = [];
      const verifiedProviders: string[] = [];

      for (const [p, k] of [
        ['claude', 'claude_api_key'],
        ['gemini', 'gemini_api_key'],
        ['openai', 'openai_api_key'],
      ] as const) {
        const val = (safeCfg[k] || '').trim();
        const isValid = isValidKeyForProvider(p, val);
        safeCfg[k + '_set'] = isValid;
        safeCfg[k] = isValid ? '******' : '';
        if (isValid) {
          registeredProviders.push(p);
          if (verifiedDict[p] === true) {
            verifiedProviders.push(p);
          }
        }
      }

      safeCfg.registered_providers = registeredProviders;
      safeCfg.available_providers = verifiedProviders;
      safeCfg.has_any_key = verifiedProviders.length > 0;
      safeCfg.verified_providers = {
        claude: verifiedProviders.includes('claude'),
        gemini: verifiedProviders.includes('gemini'),
        openai: verifiedProviders.includes('openai'),
      };
      safeCfg.api_key_set = safeCfg.has_any_key;
      safeCfg.api_key = safeCfg.has_any_key ? '******' : '';

      const saList = listAvailableServiceAccounts();
      const activeSa = saList.find((a) => a.is_active) || (saList.length > 0 ? saList[0] : null);
      safeCfg.available_service_accounts = saList;
      safeCfg.active_service_account = activeSa;
      safeCfg.service_account_email = activeSa?.client_email || '';

      res.json({ success: true, config: safeCfg });
      return;
    }
  } catch {}

  // 로컬 파싱 실패 시 폴백
  try {
    const raw = await runPythonCommand(['--action', 'get_config']);
    const data = JSON.parse(raw);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleSaveConfig(req: Request, res: Response): Promise<void> {
  try {
    const options = req.body || {};
    sheetsCache = null; // 설정 변경 시 시트 캐시 즉시 무효화
    modelsCache.clear(); // API 키가 바뀌면 조회 가능한 모델도 달라짐
    const raw = await runPythonCommand(['--action', 'save_config', '--options', JSON.stringify(options)]);
    const data = JSON.parse(raw);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleGetGlossary(req: Request, res: Response): Promise<void> {
  const forceRefresh = req.query.refresh === 'true';
  const now = Date.now();

  if (!forceRefresh && glossaryCache && now - glossaryCache.timestamp < 15 * 60 * 1000) {
    res.json(glossaryCache.data);
    return;
  }

  try {
    const raw = await runPythonCommand(['--action', 'get_glossary']);
    const data = JSON.parse(raw);
    if (data.success) {
      glossaryCache = { data, timestamp: now };
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleSaveGlossary(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body || {};
    const raw = await runPythonCommand(['--action', 'save_glossary', '--options', JSON.stringify(payload)]);
    const data = JSON.parse(raw);
    if (data.success) {
      glossaryCache = null; // 저장 시 캐시 무효화
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleTestKey(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body || {};
    const raw = await runPythonCommand(['--action', 'test_key', '--options', JSON.stringify(payload)]);
    const data = JSON.parse(raw);
    if (data?.success) modelsCache.clear();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// 등록된 API 키로 제공자별 실제 사용 가능 모델 목록 조회 (성공 결과만 10분 캐시, ?refresh=1 로 강제 재조회)
export async function handleGetModels(req: Request, res: Response): Promise<void> {
  const provider = String(req.query.provider || '');
  if (!['gemini', 'claude', 'openai'].includes(provider)) {
    res.status(400).json({ success: false, error: '지원되지 않는 제공자입니다.' });
    return;
  }
  const cached = modelsCache.get(provider);
  if (cached && req.query.refresh !== '1' && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    res.json(cached.data);
    return;
  }
  try {
    const raw = await runPythonCommand(['--action', 'list_models', '--options', JSON.stringify({ provider })]);
    const data = JSON.parse(raw);
    if (data?.success) modelsCache.set(provider, { data, timestamp: Date.now() });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleDetectLanguages(req: Request, res: Response): Promise<void> {
  const payload = req.body || {};
  const isForceRefresh = payload.refresh === true || req.query.refresh === 'true';

  const detectMode: SaMode = payload.target_source_mode === 'custom_url' ? 'test' : 'main';
  const saList = listAvailableServiceAccounts(detectMode);
  const activeSa = saList.find((a) => a.is_active) || null;
  const saKey = activeSa?.filename || '';
  // 클라이언트가 보낸(오래됐을 수 있는) 키 이름이 아닌, 서버에 저장된 선택 키만 사용
  payload.filename = saKey;

  const targetUrl = (payload.target_sheet_url || payload.i2_selected_sheet || 'default').trim();
  const cacheKey = `${saKey}:${targetUrl}`;
  const now = Date.now();

  if (isForceRefresh) {
    detectedLangsCache.delete(cacheKey);
  } else if (cacheKey && detectedLangsCache.has(cacheKey)) {
    // 1. 인메모리 캐시 확인 (동일 시트 즉시 0ms 반환)
    const cached = detectedLangsCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_TTL_MS) {
      res.json(cached.data);
      return;
    }
  }

  // 2. 구글 시트 URL 빠른 추출 시도 (공개 시트인 경우 0.2초 초고속 경로)
  const match = targetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    const sheetId = match[1];
    const gidMatch = targetUrl.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const csvResp = await fetch(csvUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (csvResp.ok) {
        const text = await csvResp.text();
        const firstLine = text.split('\n')[0] || '';
        if (firstLine.includes(',') || firstLine.includes('\t')) {
          const rawHeaders = firstLine.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
          const IGNORE_KEYS = new Set([
            'keys', 'key', 'type', 'description', 'desc', 'korean', 'kor',
            'mqm', 'score', '점수', '사유', 'reason', 'notes', 'note'
          ]);
          const languages: Array<{ code: string; label: string }> = [];
          for (const h of rawHeaders) {
            if (!h || IGNORE_KEYS.has(h.toLowerCase())) continue;
            languages.push({ code: h.toUpperCase(), label: `${h.toUpperCase()} (${h})` });
          }
          if (languages.length > 0) {
            const resultData = { success: true, count: languages.length, languages };
            detectedLangsCache.set(cacheKey, { data: resultData, timestamp: now });
            res.json(resultData);
            return;
          }
        }
      }
    } catch {}
  }

  // 3. 기존 파이썬 엔진 폴백
  try {
    const raw = await runPythonCommand(['--action', 'detect_languages', '--options', JSON.stringify(payload)]);
    const data = JSON.parse(raw);
    if (data.success && data.languages) {
      detectedLangsCache.set(cacheKey, { data, timestamp: now });
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, count: 0, languages: [] });
  }
}

export async function handleGetResults(req: Request, res: Response): Promise<void> {
  const mode = req.query.mode === 'test' ? 'test' : 'main';
  const targetPath = mode === 'test' ? EXCEL_TEST_REPORT_PATH : EXCEL_REPORT_PATH;

  // 해당 모드의 결과 파일이 없으면 즉시 null 반환 (메인 모드에 테스트 모드 결과가 노출되지 않도록 엄격 분리!)
  if (!fs.existsSync(targetPath)) {
    res.json({ success: true, data: null });
    return;
  }

  try {
    // 보고서 파일뿐 아니라 파서(web_runner.py)가 바뀌어도 캐시를 무효화
    const stat = fs.statSync(targetPath);
    const parserMtime = fs.existsSync(RUNNER_SCRIPT) ? fs.statSync(RUNNER_SCRIPT).mtimeMs : 0;
    const cacheStamp = stat.mtimeMs + parserMtime;
    const cached = resultsCacheMap.get(mode);
    if (cached && cached.mtimeMs === cacheStamp) {
      res.json(cached.data);
      return;
    }

    const raw = await runPythonCommand(['--action', 'get_results', '--options', JSON.stringify({ mode })]);
    const data = JSON.parse(raw);
    if (data.success) {
      resultsCacheMap.set(mode, { mtimeMs: cacheStamp, data });
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleClearResults(req: Request, res: Response): Promise<void> {
  try {
    const mode = req.query.mode === 'test' ? 'test' : 'main';
    const targetFile = mode === 'test' ? EXCEL_TEST_REPORT_PATH : EXCEL_REPORT_PATH;

    if (fs.existsSync(targetFile)) {
      try {
        fs.unlinkSync(targetFile);
      } catch (err: any) {
        console.warn(`[ClearResults] Failed to delete file: ${err.message}`);
      }
    }

    resultsCacheMap.delete(mode);

    res.json({
      success: true,
      message: `${mode === 'test' ? '테스트' : '메인'} 검수 결과가 초기화되었습니다.`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export function handleGetStatus(req: Request, res: Response): void {
  const reqMode = req.query.mode as string | undefined;
  // 요청한 모드와 현재 작업의 모드가 다르고 실행 중이 아니라면 빈 상태(null) 반환하여 화면 간 간섭 방지
  if (reqMode && currentJob.mode && currentJob.mode !== reqMode && !currentJob.running) {
    res.json({
      success: true,
      job: null,
    });
    return;
  }

  res.json({
    success: true,
    job: currentJob,
  });
}

export interface JobFinishInfo {
  mode: 'main' | 'test';
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  totalIssues: number;
  summary: RunSummary | null;
}

const jobFinishListeners: Array<(info: JobFinishInfo) => void> = [];

// 작업(수동/예약)이 끝났을 때 호출될 리스너 등록 (예약 실행 결과 기록용)
export function onJobFinished(listener: (info: JobFinishInfo) => void): void {
  jobFinishListeners.push(listener);
}

export function isJobRunning(): boolean {
  return currentJob.running;
}

export function handleStartJob(req: Request, res: Response): void {
  const result = startJobInternal(req.body || {});
  if (!result.ok) {
    res.status(409).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, message: '번역 작업이 시작되었습니다.' });
}

// 수동 시작과 예약 실행이 같은 경로로 번역 작업을 시작
export function startJobInternal(options: any): { ok: true } | { ok: false; error: string } {
  if (currentJob.running) {
    return { ok: false, error: '이미 다른 번역/검수 작업이 진행 중입니다.' };
  }

  const isTest = options.target_source_mode === 'custom_url' || options.isTestMode === true;
  const mode: 'main' | 'test' = isTest ? 'test' : 'main';

  currentJob.running = true;
  currentJob.mode = mode;
  currentJob.startedAt = new Date().toISOString();
  currentJob.completedAt = null;
  currentJob.progress = { current: 0, total: 0, percent: 0 };
  currentJob.totalProgress = { current: 0, total: 100, percent: 0, message: '파이프라인 초기화 중...' };
  currentJob.stepProgress = { current: 0, total: 100, percent: 0, message: '시작 대기 중...' };
  currentJob.currentMessage = '작업을 시작합니다...';
  currentJob.logs = ['[작업 시작] 파이썬 번역 엔진 초기화 중...'];
  currentJob.error = null;
  currentJob.totalIssues = 0;
  currentJob.summary = null;

  activeProcess = spawn('python', [RUNNER_SCRIPT, '--action', 'run', '--options', JSON.stringify(options)], {
    cwd: SMART_TRANSLATOR_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let lineBuffer = '';

  activeProcess.stdout.on('data', (chunk) => {
    lineBuffer += chunk.toString('utf-8');
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'log') {
          currentJob.logs.push(event.message);
          currentJob.currentMessage = event.message;
          if (event.progress) {
            currentJob.progress = event.progress;
          }
          if (event.total_progress) {
            currentJob.totalProgress = event.total_progress;
          }
          if (event.step_progress) {
            currentJob.stepProgress = event.step_progress;
          }
          if (currentJob.logs.length > 500) {
            currentJob.logs.shift();
          }
        } else if (event.type === 'complete') {
          currentJob.running = false;
          currentJob.completedAt = new Date().toISOString();
          currentJob.totalIssues = event.total_issues || 0;
          currentJob.summary = event.summary && typeof event.summary === 'object' ? (event.summary as RunSummary) : null;
          currentJob.currentMessage = currentJob.summary
            ? `작업 완료! (신규 ${currentJob.summary.new} · 교정 ${currentJob.summary.corrected} · 제안 ${currentJob.summary.suggested})`
            : `작업 완료! (총 ${event.total_issues ?? 0}건 발견/교정)`;
          currentJob.totalProgress = { current: 100, total: 100, percent: 100, message: '✅ 전체 완료 (100%)' };
          currentJob.stepProgress = { current: 100, total: 100, percent: 100, message: '✅ 작업 완료 (100%)' };
          currentJob.logs.push(`🎉 [완료] 작업이 성공적으로 종료되었습니다.`);
        } else if (event.type === 'error') {
          currentJob.running = false;
          currentJob.completedAt = new Date().toISOString();
          currentJob.error = event.error || '오류 발생';
          currentJob.logs.push(`❌ [오류] ${event.error}`);
        }
      } catch {
        currentJob.logs.push(trimmed);
      }
    }
  });

  activeProcess.stderr.on('data', (chunk) => {
    const errText = chunk.toString('utf-8').trim();
    if (errText) {
      currentJob.logs.push(`[stderr] ${errText}`);
    }
  });

  activeProcess.on('close', (code) => {
    currentJob.running = false;
    currentJob.completedAt = new Date().toISOString();
    activeProcess = null;
    if (code !== 0 && !currentJob.error) {
      currentJob.error = `프로세스가 비정상 종료되었습니다 (코드: ${code})`;
    }
    const info: JobFinishInfo = {
      mode,
      startedAt: currentJob.startedAt,
      completedAt: currentJob.completedAt,
      error: currentJob.error,
      totalIssues: currentJob.totalIssues,
      summary: currentJob.summary,
    };
    for (const listener of jobFinishListeners) {
      try {
        listener(info);
      } catch {}
    }
  });

  return { ok: true };
}

export async function handleApplyExcel(req: Request, res: Response): Promise<void> {
  if (currentJob.running) {
    res.status(409).json({ success: false, error: '번역/검수 작업이 진행 중일 때는 시트에 반영할 수 없습니다.' });
    return;
  }

  try {
    const options = req.body || {};
    const raw = await runPythonCommand(['--action', 'apply_excel', '--options', JSON.stringify(options)]);
    const lines = raw.split('\n');
    let lastEvent: any = null;
    const logMessages: string[] = [];
    for (const l of lines) {
      try {
        const parsed = JSON.parse(l.trim());
        if (parsed.type === 'log') logMessages.push(parsed.message);
        if (parsed.type === 'apply_complete') lastEvent = parsed;
        if (parsed.type === 'error') throw new Error(parsed.error);
      } catch {}
    }

    res.json({
      success: true,
      message: lastEvent ? `구글 시트에 총 ${lastEvent.updated_count || 0}건이 일괄 반영되었습니다.` : '엑셀 결과가 구글 시트에 반영되었습니다.',
      details: lastEvent,
      appliedItems: lastEvent?.applied_items || [],
      logs: logMessages,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export function handleDownloadExcel(req: Request, res: Response): void {
  const isTest = req.query.mode === 'test';
  const filePath = isTest ? EXCEL_TEST_REPORT_PATH : EXCEL_REPORT_PATH;
  const fileName = isTest ? 'audit_report_전수검사_결과_테스트.xlsx' : 'audit_report_전수검사_결과.xlsx';

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, error: '생성된 엑셀 보고서 파일이 없습니다.' });
    return;
  }

  res.download(filePath, fileName);
}

export async function handleClearCache(_req: Request, res: Response): Promise<void> {
  try {
    const raw = await runPythonCommand(['--action', 'clear_cache']);
    const data = JSON.parse(raw);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export interface ServiceAccountInfo {
  filename: string;
  project_id: string;
  client_email: string;
  is_active: boolean;
}

export type SaMode = 'main' | 'test';

function saModeOf(value: unknown): SaMode {
  return value === 'test' ? 'test' : 'main';
}

function saConfigKey(mode: SaMode): string {
  return mode === 'test' ? 'test_service_account_json_path' : 'service_account_json_path';
}

function readConfigObj(): any {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {}
  return null;
}

// 모드별 선택 키 파일명 (테스트 키가 아직 없으면 현재 메인 키를 한 번만 복사해 이후 독립 관리)
function getSelectedSaFilename(mode: SaMode): string {
  const cfg = readConfigObj();
  if (!cfg) return mode === 'main' ? 'service_account.json' : '';
  if (mode === 'main') return path.basename(cfg.service_account_json_path || 'service_account.json');
  if (cfg.test_service_account_json_path === undefined) {
    cfg.test_service_account_json_path = cfg.service_account_json_path || '';
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch {}
  }
  return cfg.test_service_account_json_path ? path.basename(cfg.test_service_account_json_path) : '';
}

function setSelectedSaFilename(mode: SaMode, filename: string): void {
  const cfg = readConfigObj();
  if (!cfg) return;
  cfg[saConfigKey(mode)] = filename;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
}

export function listAvailableServiceAccounts(mode: SaMode = 'main'): ServiceAccountInfo[] {
  const accounts: ServiceAccountInfo[] = [];
  const seen = new Set<string>();

  const activeFilename = getSelectedSaFilename(mode);

  // 다른 PC 설치 및 독립 배포를 위해 외부 디렉터리를 일절 참조하지 않고 오직 웹 엔진 디렉터리만 사용
  const searchDirs = [KEYS_DIR];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.toLowerCase().endsWith('.json') && !seen.has(f.toLowerCase())) {
          if (['config.json', 'audit_cache.json', 'package.json', 'tsconfig.json'].includes(f.toLowerCase())) continue;
          const fullPath = path.join(dir, f);
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const parsed = JSON.parse(content);
            if (parsed.type === 'service_account' && parsed.client_email) {
              accounts.push({
                filename: f,
                project_id: parsed.project_id || '',
                client_email: parsed.client_email || '',
                is_active: f.toLowerCase() === activeFilename.toLowerCase(),
              });
              seen.add(f.toLowerCase());
            }
          } catch {}
        }
      }
    } catch {}
  }

  accounts.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));
  return accounts;
}

export async function handleGetServiceAccounts(_req: Request, res: Response): Promise<void> {
  try {
    const mode = saModeOf(_req.query.mode);
    const list = listAvailableServiceAccounts(mode);
    const active = list.find((a) => a.is_active) || null;
    res.json({
      success: true,
      active,
      accounts: list,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleUploadServiceAccount(req: Request, res: Response): Promise<void> {
  try {
    const { filename, content, json } = req.body || {};
    const mode = saModeOf(req.body?.mode);
    let parsed: any = null;

    if (json && typeof json === 'object') {
      parsed = json;
    } else if (content) {
      parsed = JSON.parse(content);
    } else {
      res.status(400).json({ success: false, error: '업로드할 서비스 계정 키(JSON) 내용이 비어 있습니다.' });
      return;
    }

    if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
      res.status(400).json({
        success: false,
        error: '올바른 Google Service Account JSON 파일이 아닙니다. (type: "service_account", client_email, private_key 필수)',
      });
      return;
    }

    let safeName = (filename || `service_account_${parsed.project_id || 'key'}.json`).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeName.toLowerCase().endsWith('.json')) safeName += '.json';

    fs.mkdirSync(KEYS_DIR, { recursive: true });
    const targetPath1 = path.join(KEYS_DIR, safeName);
    fs.writeFileSync(targetPath1, JSON.stringify(parsed, null, 2), 'utf-8');

    try {
      getSelectedSaFilename('test'); // 테스트 키 독립화(초기 복사) 후 해당 모드 키만 변경
      setSelectedSaFilename(mode, safeName);
    } catch {}

    sheetsCache = null;
    detectedLangsCache.clear();
    const list = listAvailableServiceAccounts(mode);
    const active = list.find((a) => a.filename.toLowerCase() === safeName.toLowerCase()) || null;

    res.json({
      success: true,
      message: `구글 서비스 계정 키('${safeName}')가 성공적으로 등록되었습니다.`,
      active,
      accounts: list,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleSelectServiceAccount(req: Request, res: Response): Promise<void> {
  try {
    const { filename } = req.body || {};
    const mode = saModeOf(req.body?.mode);
    if (!filename) {
      res.status(400).json({ success: false, error: '선택할 서비스 계정 키 파일명이 지정되지 않았습니다.' });
      return;
    }

    const safeName = path.basename(filename);
    try {
      getSelectedSaFilename('test'); // 테스트 키 독립화(초기 복사) 후 해당 모드 키만 변경
      setSelectedSaFilename(mode, safeName);
    } catch {}

    sheetsCache = null;
    detectedLangsCache.clear();
    const list = listAvailableServiceAccounts(mode);
    const active = list.find((a) => a.filename.toLowerCase() === safeName.toLowerCase()) || null;

    res.json({
      success: true,
      message: `구글 서비스 계정 키가 '${safeName}'(으)로 변경되었습니다.`,
      active,
      accounts: list,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleDeleteServiceAccount(req: Request, res: Response): Promise<void> {
  try {
    const { filename } = req.body || {};
    if (!filename) {
      res.status(400).json({ success: false, error: '삭제할 서비스 계정 키 파일명이 지정되지 않았습니다.' });
      return;
    }

    const safeName = path.basename(filename);
    const targetPath = path.join(KEYS_DIR, safeName);

    if (fs.existsSync(targetPath)) {
      try {
        fs.unlinkSync(targetPath);
      } catch (err: any) {
        res.status(500).json({ success: false, error: `파일 삭제 실패: ${err.message}` });
        return;
      }
    }

    sheetsCache = null;
    detectedLangsCache.clear();

    // 삭제한 키를 선택 중이던 모드만 남은 첫 키로 갱신하거나 비움 (다른 모드 선택은 유지)
    const mode = saModeOf(req.body?.mode);
    try {
      getSelectedSaFilename('test');
      for (const m of ['main', 'test'] as SaMode[]) {
        if (getSelectedSaFilename(m).toLowerCase() === safeName.toLowerCase()) {
          const remaining = listAvailableServiceAccounts(m);
          setSelectedSaFilename(m, remaining.length > 0 ? remaining[0].filename : '');
        }
      }
    } catch {}

    const list = listAvailableServiceAccounts(mode);
    const active = list.find((a) => a.is_active) || null;

    res.json({
      success: true,
      message: `구글 서비스 계정 키('${safeName}')가 성공적으로 삭제되었습니다.`,
      active,
      accounts: list,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function handleTestServiceAccount(req: Request, res: Response): Promise<void> {
  try {
    const payload = req.body || {};
    const raw = await runPythonCommand(['--action', 'test_service_account', '--options', JSON.stringify(payload)]);
    const data = JSON.parse(raw);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}


